#!/usr/bin/env python3
"""Focused contract checks for the Kurami Telegram stdio wrapper."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import types
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace


class FakeAnnotations:
    def __init__(self, **values: object) -> None:
        self.values = values


class FakeMcp:
    def __init__(self) -> None:
        self.registered: dict[str, FakeAnnotations] = {}

    def tool(self, *, annotations: FakeAnnotations):
        def register(function):
            self.registered[function.__name__] = annotations
            return function

        return register


fake_mcp = FakeMcp()
mcp_package = types.ModuleType("mcp")
mcp_package.__path__ = []
mcp_types = types.ModuleType("mcp.types")
mcp_types.ToolAnnotations = FakeAnnotations

telegram_package = types.ModuleType("telegram_mcp")
telegram_package.__path__ = []
telegram_runner = types.ModuleType("telegram_mcp.runner")
telegram_runner.main = lambda: None
telegram_runtime = types.ModuleType("telegram_mcp.runtime")
telegram_runtime.Context = object
telegram_runtime.ensure_connected = lambda client: None
telegram_runtime.get_client = lambda account: None
telegram_runtime.mcp = fake_mcp
telegram_runtime.resolve_entity = lambda chat_id, client: None
telegram_runtime.sanitize_name = lambda text, max_length=256: str(text or "[empty]").strip()[:max_length]
telegram_runtime.sanitize_user_content = (
    lambda text, max_length=4096: str(text or "[empty]").strip()[:max_length]
)
telegram_tools = types.ModuleType("telegram_mcp.tools")
telegram_tools.__path__ = []
telegram_tools.__all__ = []
telegram_media = types.ModuleType("telegram_mcp.tools.media")


async def unused_download_media(**_kwargs):
    raise AssertionError("download_media must not be used by exact-ID collection")


telegram_media.download_media = unused_download_media
sys.modules.update(
    {
        "mcp": mcp_package,
        "mcp.types": mcp_types,
        "telegram_mcp": telegram_package,
        "telegram_mcp.runner": telegram_runner,
        "telegram_mcp.runtime": telegram_runtime,
        "telegram_mcp.tools": telegram_tools,
        "telegram_mcp.tools.media": telegram_media,
    }
)

root = Path(__file__).resolve().parents[1]
wrapper_path = root / "integrations" / "hermes" / "connectors" / "telegram_stdio_wrapper.py"
spec = importlib.util.spec_from_file_location("kurami_telegram_wrapper_test", wrapper_path)
assert spec and spec.loader
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)


class MessageMediaPhoto:
    pass


class ReactionEmoji:
    def __init__(self, emoticon: str) -> None:
        self.emoticon = emoticon


def message(message_id: int, *, with_media: bool = False):
    media = MessageMediaPhoto() if with_media else None
    return SimpleNamespace(
        id=message_id,
        date=datetime(2026, 8, 31, 9, message_id, tzinfo=timezone.utc),
        message=f"message-{message_id}",
        sender_id=700 + message_id,
        sender=SimpleNamespace(
            id=700 + message_id,
            first_name="Kurami",
            last_name="Source",
            title=None,
            username="source_channel",
        ),
        post_author="Editor",
        media=media,
        photo=SimpleNamespace(id=900 + message_id) if with_media else None,
        document=None,
        file=(
            SimpleNamespace(name="cover.jpg", mime_type="image/jpeg", size=1234, duration=None)
            if with_media
            else None
        ),
        grouped_id=8800 if with_media else None,
        reply_to=SimpleNamespace(reply_to_msg_id=2, reply_to_top_id=1, forum_topic=False),
        reply_to_msg_id=2,
        replies=SimpleNamespace(replies=6),
        reactions=SimpleNamespace(
            results=[
                SimpleNamespace(
                    reaction=ReactionEmoji("👍"),
                    count=8,
                    chosen_order=0,
                )
            ]
        ),
        views=120,
        forwards=3,
    )


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[int, list[int]]] = []
        self.connected = False

    async def get_messages(self, entity: SimpleNamespace, *, ids: list[int]):
        self.calls.append((entity.id, ids))
        if entity.id == 20:
            raise RuntimeError("provider failed\nwithout leaking request state")
        # Deliberately return provider data out of order and omit ID 3.
        return [message(4, with_media=True), message(1), None]


client = FakeClient()


async def ensure_connected(value: FakeClient) -> None:
    assert value is client
    value.connected = True


async def resolve_entity(chat_id: int, value: FakeClient) -> SimpleNamespace:
    assert value is client
    return SimpleNamespace(id=chat_id, username="public_channel", title="Public Channel")


wrapper.get_client = lambda account: client
wrapper.ensure_connected = ensure_connected
wrapper.resolve_entity = resolve_entity

request = [
    {"chat_id": 10, "message_id": 1},
    {"chat_id": 20, "message_id": 2},
    {"chat_id": 10, "message_id": 3},
    {"chat_id": 10, "message_id": 4},
]
response = json.loads(asyncio.run(wrapper.get_messages_exact_batch(request)))
assert client.connected
assert client.calls == [(10, [1, 3, 4]), (20, [2])]
assert [item["id"] for item in response["results"]] == [1, 2, 3, 4]
assert [item["status"] for item in response["results"]] == ["found", "error", "missing", "found"]
assert response["found"] == 2 and response["missing"] == 1 and response["errors"] == 1
assert response["ok"] is False

found = response["results"][3]
assert found["date"] == "2026-08-31T09:04:00+00:00"
assert found["text"] == "message-4"
assert found["chat"] == {
    "id": 10,
    "title": "Public Channel",
    "username": "public_channel",
}
assert found["externalUrl"] == "https://t.me/public_channel/4"
assert found["sender"] == {
    "id": 704,
    "name": "Kurami Source",
    "username": "source_channel",
    "postAuthor": "Editor",
}
assert found["media"] == {
    "type": "photo",
    "id": 904,
    "fileName": "cover.jpg",
    "mimeType": "image/jpeg",
    "size": 1234,
}
assert found["grouped_id"] == 8800
assert found["reply"] == {"messageId": 2, "topMessageId": 1, "forumTopic": False}
assert found["engagement"] == {
    "views": 120,
    "forwards": 3,
    "replies": 6,
    "reactions": [{"reaction": "👍", "count": 8, "chosenOrder": 0}],
}

calls_before_rejection = list(client.calls)
duplicate = json.loads(
    asyncio.run(
        wrapper.get_messages_exact_batch(
            [
                {"chat_id": 10, "message_id": 1},
                {"chat_id": 10, "message_id": 1},
            ]
        )
    )
)
assert duplicate["ok"] is False and "duplicate" in duplicate["error"]
malformed = json.loads(
    asyncio.run(wrapper.get_messages_exact_batch([{"chat_id": 10, "message_id": True}]))
)
assert malformed["ok"] is False and "positive integer" in malformed["error"]
assert client.calls == calls_before_rejection

annotations = fake_mcp.registered["get_messages_exact_batch"].values
assert annotations["readOnlyHint"] is True
assert annotations["openWorldHint"] is False
assert annotations["destructiveHint"] is False
assert wrapper._telegram_message_url(SimpleNamespace(username=None), -1001234567890, 55) == (
    "https://t.me/c/1234567890/55"
)


with tempfile.TemporaryDirectory() as temporary_home:
    os.environ["KURAMI_HOME"] = temporary_home
    inbox = Path(temporary_home) / "state" / "briefing" / "media-inbox"
    nested = inbox / "downloads" / "recovery" / "chunk-1"
    nested.mkdir(parents=True)

    older = nested / "telegram_10_100_1000.jpg"
    newer = nested / "telegram_10_100_2000.jpg"
    older.write_bytes(b"older")
    newer.write_bytes(b"newer")
    os.utime(older, ns=(1_000_000_000, 1_000_000_000))
    os.utime(newer, ns=(2_000_000_000, 2_000_000_000))
    (nested / "telegram_110_100_3000.jpg").write_bytes(b"wrong-chat")
    (nested / "telegram_10_1000_3000.jpg").write_bytes(b"wrong-message")
    (nested / "telegram_11_101_3000.jpg").write_bytes(b"")

    media_calls: list[tuple[int, int]] = []

    async def fake_download_media(**kwargs):
        chat_id = kwargs["chat_id"]
        message_id = kwargs["message_id"]
        media_calls.append((chat_id, message_id))
        if (chat_id, message_id) == (11, 101):
            downloaded = inbox / "downloads" / "nested" / "telegram_11_101_4000.webp"
            downloaded.parent.mkdir(parents=True, exist_ok=True)
            downloaded.write_bytes(b"downloaded")
            return f"Media downloaded to {downloaded}."
        return "No media found in the specified message."

    wrapper.download_media = fake_download_media
    media_response = json.loads(
        asyncio.run(
            wrapper.download_media_batch(
                [
                    {"chat_id": 10, "message_id": 100},
                    {"chat_id": 11, "message_id": 101},
                    {"chat_id": 12, "message_id": 102},
                ]
            )
        )
    )
    assert [item["status"] for item in media_response["results"]] == [
        "reused",
        "downloaded",
        "failed",
    ]
    assert media_response["results"][0]["path"] == str(newer.resolve())
    assert media_response["downloaded"] == 1
    assert media_response["reused"] == 1
    assert media_response["failed"] == 1
    assert media_response["ok"] is False
    assert media_calls == [(11, 101), (12, 102)]

    calls_before_media_rejection = list(media_calls)
    too_large = json.loads(
        asyncio.run(
            wrapper.download_media_batch(
                [
                    {"chat_id": chat_id, "message_id": 1}
                    for chat_id in range(1, 14)
                ]
            )
        )
    )
    assert too_large["ok"] is False and "one to 12" in too_large["error"]
    duplicate_media = json.loads(
        asyncio.run(
            wrapper.download_media_batch(
                [
                    {"chat_id": 10, "message_id": 100},
                    {"chat_id": 10, "message_id": 100},
                ]
            )
        )
    )
    assert duplicate_media["ok"] is False and "duplicate" in duplicate_media["error"]
    assert media_calls == calls_before_media_rejection

print("Verified exact-ID collection and resumable bounded Telegram media transport.")
