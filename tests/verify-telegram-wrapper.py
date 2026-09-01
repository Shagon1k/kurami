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
telethon_package = types.ModuleType("telethon")


class FakeGetPeerDialogsRequest:
    def __init__(self, *, peers):
        self.peers = peers


class FakeInputDialogPeer:
    def __init__(self, *, peer):
        self.peer = peer


telethon_package.functions = SimpleNamespace(
    messages=SimpleNamespace(GetPeerDialogsRequest=FakeGetPeerDialogsRequest)
)
telethon_package.types = SimpleNamespace(InputDialogPeer=FakeInputDialogPeer)


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
        "telethon": telethon_package,
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


class MessageMediaDocument:
    pass


class ReactionEmoji:
    def __init__(self, emoticon: str) -> None:
        self.emoticon = emoticon


def message(message_id: int, *, with_media: bool = False):
    media = MessageMediaPhoto() if with_media else None
    return SimpleNamespace(
        id=message_id,
        date=datetime(2026, 8, 31, 9, message_id % 60, tzinfo=timezone.utc),
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
        video=None,
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


def media_message(message_id: int, kind: str):
    if kind == "image":
        return message(message_id, with_media=True)
    if kind in {"video", "video-with-thumbnail"}:
        document = SimpleNamespace(id=1_000 + message_id, mime_type="video/mp4", size=42)
        return SimpleNamespace(
            **{
                **message(message_id).__dict__,
                "media": MessageMediaDocument(),
                "photo": (
                    SimpleNamespace(id=2_000 + message_id)
                    if kind == "video-with-thumbnail"
                    else None
                ),
                "video": document,
                "document": document,
                "file": SimpleNamespace(
                    name="clip.mp4",
                    mime_type=("image/jpeg" if kind == "video-with-thumbnail" else "video/mp4"),
                    size=42,
                    duration=3,
                ),
            }
        )
    raise AssertionError(f"unsupported fake media kind {kind}")


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
thumbnail_video_payload = wrapper._media_payload(media_message(104, "video-with-thumbnail"))
assert thumbnail_video_payload["type"] == "video"
assert thumbnail_video_payload["id"] == 1104
assert thumbnail_video_payload["mimeType"] == "video/mp4"
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

# The destructive acknowledgement revalidates the runtime mutation policy and
# exact attempt-bound plan immediately before Telegram is contacted.
original_briefing_cli = wrapper._briefing_cli
plan_calls: list[list[str]] = []
wrapper._briefing_cli = lambda arguments: (
    plan_calls.append(arguments)
    or {
        "ok": True,
        "planDigest": "a" * 64,
        "sources": [{"sourceKey": "telegram:test", "chatId": -1001, "maxId": 55}],
    }
)
plan_ok, plan_error = wrapper._validate_commit_plan(
    "daily:2026-09-01",
    "daily-2026-09-01--manual-abcdef",
    "a" * 64,
    [{"chat_id": -1001, "max_id": 55}],
)
assert plan_ok is True and plan_error == ""
assert plan_calls == [[
    "telegram-commit-plan",
    "--id",
    "daily:2026-09-01",
    "--attempt",
    "daily-2026-09-01--manual-abcdef",
]]
plan_ok, _ = wrapper._validate_commit_plan(
    "daily:2026-09-01",
    "daily-2026-09-01--manual-abcdef",
    "a" * 64,
    [{"chat_id": -1001, "max_id": 56}],
)
assert plan_ok is False
wrapper._briefing_cli = original_briefing_cli


with tempfile.TemporaryDirectory() as capture_home:
    os.environ["KURAMI_HOME"] = capture_home
    local_date = datetime.now(wrapper.ZoneInfo("Europe/Vilnius")).date().isoformat()
    capture_edition = f"daily:{local_date}"
    capture_attempt = f"daily-{local_date}--manual-abcdef"
    capture_run = Path(capture_home) / "state" / "briefing" / "runs" / capture_attempt
    capture_run.mkdir(parents=True)
    capture_config = {
        "configPath": str(Path(capture_home) / "config" / "briefing.yaml"),
        "profile": "telegram-user",
        "pageSize": 100,
        "discoveryLimit": 200,
        "channels": [
            {"key": "alpha", "id": -1001, "label": "Alpha"},
            {"key": "empty", "id": -1002, "label": "Empty"},
        ],
    }
    capture_calls = {"count": 0}

    class CaptureClient:
        async def get_input_entity(self, entity: SimpleNamespace):
            return entity

        async def __call__(self, request: FakeGetPeerDialogsRequest):
            chat_id = request.peers[0].peer.id
            if chat_id == -1001:
                dialog = SimpleNamespace(
                    unread_count=2,
                    top_message=12,
                    read_inbox_max_id=10,
                )
            else:
                dialog = SimpleNamespace(
                    unread_count=0,
                    top_message=20,
                    read_inbox_max_id=20,
                )
            return SimpleNamespace(dialogs=[dialog])

        async def iter_messages(self, entity: SimpleNamespace, *, min_id: int):
            capture_calls["count"] += 1
            assert entity.id == -1001 and min_id == 10
            for item in (message(12, with_media=True), message(11)):
                yield item

    capture_client = CaptureClient()

    async def ensure_capture_connected(value: CaptureClient) -> None:
        assert value is capture_client

    async def resolve_capture_entity(chat_id: int, value: CaptureClient) -> SimpleNamespace:
        assert value is capture_client
        return SimpleNamespace(
            id=chat_id,
            username="alpha_channel" if chat_id == -1001 else "empty_channel",
            title="Alpha" if chat_id == -1001 else "Empty",
        )

    def fake_normalize_validate(config_path: str, raw_path: Path, normalized_path: Path, attempt_id: str):
        assert config_path == capture_config["configPath"]
        assert attempt_id == capture_attempt
        raw = json.loads(raw_path.read_text())
        for item in raw["items"]:
            metadata = item["metadata"]
            if metadata["hasMedia"]:
                message_id = metadata["telegramMessageId"]
                metadata["allMediaMessageIds"] = [message_id]
                metadata["mediaMessageIds"] = [message_id]
                metadata["nonImageMediaMessageIds"] = []
        normalized_path.write_text(json.dumps(raw))
        return {
            "ok": True,
            "complete": True,
            "configuredChannels": 2,
            "capturedUnread": 2,
            "fetched": 2,
            "normalized": 2,
            "mediaMessages": 1,
            "channels": [
                {
                    "sourceKey": "alpha",
                    "channelId": -1001,
                    "state": "ready",
                    "capturedUnread": 2,
                    "fetched": 2,
                    "normalized": 2,
                    "upperMessageId": 12,
                    "itemIds": [12, 11],
                    "mediaItemIds": [12],
                    "nonImageMediaItemIds": [],
                },
                {
                    "sourceKey": "empty",
                    "channelId": -1002,
                    "state": "empty",
                    "capturedUnread": 0,
                    "fetched": 0,
                    "normalized": 0,
                    "upperMessageId": None,
                    "itemIds": [],
                    "mediaItemIds": [],
                    "nonImageMediaItemIds": [],
                },
            ],
        }

    wrapper._telegram_capture_config = lambda: capture_config
    wrapper._normalize_and_validate_capture = fake_normalize_validate
    wrapper._capture_paths = lambda edition_id, attempt_id: (
        capture_run,
        capture_run / "telegram-raw.json",
        capture_run / "telegram-normalized.json",
    )
    wrapper._briefing_cli = lambda arguments: {"ok": True, "attempt": {"state": "live-collected"}}
    wrapper.get_client = lambda account: capture_client
    wrapper.ensure_connected = ensure_capture_connected
    wrapper.resolve_entity = resolve_capture_entity

    captured = json.loads(asyncio.run(wrapper.capture_daily_briefing_batch(capture_edition, capture_attempt)))
    assert captured["ok"] is True and captured["reused"] is False
    assert captured["report"]["capturedUnread"] == 2
    assert Path(captured["rawPath"]).is_file()
    assert Path(captured["normalizedPath"]).is_file()
    page = json.loads(
        asyncio.run(wrapper.read_daily_briefing_batch_page(capture_edition, capture_attempt, offset=0, limit=1))
    )
    assert page["ok"] is True and page["total"] == 2 and page["nextOffset"] == 1
    assert page["items"][0]["sourceItemId"] == "-1001:12"
    assert capture_calls["count"] == 1
    capture_annotations = fake_mcp.registered["capture_daily_briefing_batch"].values
    assert capture_annotations["readOnlyHint"] is True
    assert capture_annotations["destructiveHint"] is False

    # A valid capture is immutable for the edition. The retry validates and
    # reuses it instead of moving the unread cutoff.
    def reused_cli(arguments):
        if arguments[0] == "attempt-status":
            return {"ok": True, "attempt": {"state": "capture-validated"}}
        return fake_normalize_validate(
            capture_config["configPath"],
            Path(captured["rawPath"]),
            Path(captured["normalizedPath"]),
            capture_attempt,
        )

    wrapper._briefing_cli = reused_cli
    reused = json.loads(asyncio.run(wrapper.capture_daily_briefing_batch(capture_edition, capture_attempt)))
    assert reused["ok"] is True and reused["reused"] is True
    assert capture_calls["count"] == 1


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

    class MediaClient:
        async def get_messages(self, entity: SimpleNamespace, *, ids: list[int]):
            available = {
                100: media_message(100, "image"),
                101: media_message(101, "image"),
                102: media_message(102, "video"),
                103: media_message(103, "image"),
                104: media_message(104, "video-with-thumbnail"),
            }
            return [available.get(message_id) for message_id in ids]

    media_client = MediaClient()

    async def ensure_media_connected(value: MediaClient) -> None:
        assert value is media_client

    async def resolve_media_entity(chat_id: int, value: MediaClient) -> SimpleNamespace:
        assert value is media_client
        return SimpleNamespace(id=chat_id)

    wrapper.get_client = lambda account: media_client
    wrapper.ensure_connected = ensure_media_connected
    wrapper.resolve_entity = resolve_media_entity

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
        "skipped",
    ]
    assert media_response["results"][0]["path"] == str(newer.resolve())
    assert media_response["downloaded"] == 1
    assert media_response["reused"] == 1
    assert media_response["skipped"] == 1
    assert media_response["failed"] == 0
    assert media_response["ok"] is True
    assert media_response["results"][2]["reason"] == "non-image-media"
    assert media_calls == [(11, 101)]

    thumbnail_video = json.loads(
        asyncio.run(
            wrapper.download_media_batch([{"chat_id": 14, "message_id": 104}])
        )
    )
    assert thumbnail_video["ok"] is True
    assert thumbnail_video["results"][0]["status"] == "skipped"
    assert thumbnail_video["results"][0]["mediaType"] == "video"
    assert media_calls == [(11, 101)]

    # Even a pre-existing canonical video must never be reused or downloaded.
    canonical_video = nested / "telegram_12_102_5000.mp4"
    canonical_video.write_bytes(b"legacy-video")
    only_video = json.loads(
        asyncio.run(
            wrapper.download_media_batch([{"chat_id": 12, "message_id": 102}])
        )
    )
    assert only_video["ok"] is True
    assert only_video["downloaded"] == 0 and only_video["reused"] == 0
    assert only_video["skipped"] == 1 and only_video["failed"] == 0
    assert only_video["results"][0]["status"] == "skipped"
    assert media_calls == [(11, 101)]

    failed_image = json.loads(
        asyncio.run(
            wrapper.download_media_batch([{"chat_id": 13, "message_id": 103}])
        )
    )
    assert failed_image["ok"] is False
    assert failed_image["failed"] == 1 and failed_image["skipped"] == 0
    assert media_calls == [(11, 101), (13, 103)]

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
