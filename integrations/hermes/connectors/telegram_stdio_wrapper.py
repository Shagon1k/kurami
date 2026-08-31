#!/usr/bin/env python3
"""Kurami-owned additions to the pinned Telegram MCP stdio process."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

# Hermes starts this file with cwd set to the pinned external connector. Keep
# the checkout unmodified while importing its installed package and venv.
sys.path.insert(0, str(Path.cwd()))

from mcp.types import ToolAnnotations  # type: ignore[import-not-found]  # noqa: E402
from telegram_mcp.runner import main  # type: ignore[import-not-found]  # noqa: E402
from telegram_mcp.runtime import (  # type: ignore[import-not-found]  # noqa: E402
    Context,
    ensure_connected,
    get_client,
    mcp,
    resolve_entity,
    sanitize_name,
    sanitize_user_content,
)
from telegram_mcp.tools import *  # type: ignore[import-not-found]  # noqa: E402,F403
from telegram_mcp.tools.media import download_media  # type: ignore[import-not-found]  # noqa: E402

MAX_BATCH_MEDIA = 256
MAX_BATCH_EXACT_MESSAGES = 256
MAX_BATCH_MARK_READ = 64
PLAN_DIGEST = re.compile(r"^[a-f0-9]{64}$")


def _safe_error(value: str) -> str:
    value = " ".join(value.split())
    return value[:500] if value else "download failed"


def _briefing_database_path() -> Path:
    home = Path(os.environ.get("KURAMI_HOME", "/home/shagon1k/_hermes/_kurami"))
    return home / "state" / "briefing" / "briefing.db"


def _integer_or_none(value: Any) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _iso_datetime(value: Any) -> Optional[str]:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return None


def _sender_payload(message: Any) -> dict[str, Any]:
    sender = getattr(message, "sender", None)
    sender_id = _integer_or_none(getattr(message, "sender_id", None))
    if sender_id is None and sender is not None:
        sender_id = _integer_or_none(getattr(sender, "id", None))

    parts = [
        sanitize_name(value)
        for value in (
            getattr(sender, "first_name", None),
            getattr(sender, "last_name", None),
            getattr(sender, "title", None),
        )
        if isinstance(value, str) and value.strip()
    ]
    payload: dict[str, Any] = {"id": sender_id}
    if parts:
        payload["name"] = " ".join(parts)
    username = getattr(sender, "username", None)
    if isinstance(username, str) and username.strip():
        payload["username"] = sanitize_name(username)
    post_author = getattr(message, "post_author", None)
    if isinstance(post_author, str) and post_author.strip():
        payload["postAuthor"] = sanitize_name(post_author)
    return payload


def _media_type(message: Any, media: Any) -> str:
    if getattr(message, "photo", None) is not None:
        return "photo"
    document = getattr(message, "document", None)
    mime_type = getattr(document, "mime_type", None)
    if isinstance(mime_type, str):
        if mime_type.startswith("video/"):
            return "video"
        if mime_type.startswith("image/"):
            return "image"
        if mime_type.startswith("audio/"):
            return "audio"
        if mime_type:
            return "document"
    class_name = type(media).__name__
    if class_name.startswith("MessageMedia"):
        class_name = class_name[len("MessageMedia") :]
    normalized = re.sub(r"(?<!^)(?=[A-Z])", "_", class_name).lower()
    return normalized or "unknown"


def _media_payload(message: Any) -> Optional[dict[str, Any]]:
    media = getattr(message, "media", None)
    if media is None:
        return None

    payload: dict[str, Any] = {"type": _media_type(message, media)}
    photo = getattr(message, "photo", None)
    document = getattr(message, "document", None)
    media_id = _integer_or_none(getattr(photo, "id", None))
    if media_id is None:
        media_id = _integer_or_none(getattr(document, "id", None))
    if media_id is not None:
        payload["id"] = media_id

    file = getattr(message, "file", None)
    file_name = getattr(file, "name", None)
    if isinstance(file_name, str) and file_name.strip():
        payload["fileName"] = sanitize_name(file_name)
    mime_type = getattr(file, "mime_type", None) or getattr(document, "mime_type", None)
    if isinstance(mime_type, str) and mime_type.strip():
        payload["mimeType"] = mime_type.strip()
    size = _integer_or_none(getattr(file, "size", None))
    if size is None:
        size = _integer_or_none(getattr(document, "size", None))
    if size is not None:
        payload["size"] = size
    duration = _integer_or_none(getattr(file, "duration", None))
    if duration is not None:
        payload["duration"] = duration
    return payload


def _reply_payload(message: Any) -> Optional[dict[str, Any]]:
    reply = getattr(message, "reply_to", None)
    reply_id = _integer_or_none(getattr(message, "reply_to_msg_id", None))
    if reply_id is None and reply is not None:
        reply_id = _integer_or_none(getattr(reply, "reply_to_msg_id", None))
    top_id = _integer_or_none(getattr(reply, "reply_to_top_id", None)) if reply is not None else None
    if reply_id is None and top_id is None:
        return None
    payload: dict[str, Any] = {"messageId": reply_id}
    if top_id is not None:
        payload["topMessageId"] = top_id
    if reply is not None and isinstance(getattr(reply, "forum_topic", None), bool):
        payload["forumTopic"] = getattr(reply, "forum_topic")
    return payload


def _reaction_name(reaction: Any) -> str:
    emoticon = getattr(reaction, "emoticon", None)
    if isinstance(emoticon, str) and emoticon:
        return emoticon
    document_id = _integer_or_none(getattr(reaction, "document_id", None))
    if document_id is not None:
        return f"custom:{document_id}"
    return type(reaction).__name__


def _engagement_payload(message: Any) -> dict[str, Any]:
    replies = getattr(message, "replies", None)
    reply_count = _integer_or_none(getattr(replies, "replies", None))
    reactions = getattr(message, "reactions", None)
    reaction_results = getattr(reactions, "results", None)
    serialized_reactions: list[dict[str, Any]] = []
    if isinstance(reaction_results, (list, tuple)):
        for result in reaction_results:
            count = _integer_or_none(getattr(result, "count", None))
            reaction = getattr(result, "reaction", None)
            if count is None or reaction is None:
                continue
            item: dict[str, Any] = {
                "reaction": _reaction_name(reaction),
                "count": count,
            }
            chosen_order = _integer_or_none(getattr(result, "chosen_order", None))
            if chosen_order is not None:
                item["chosenOrder"] = chosen_order
            serialized_reactions.append(item)
    return {
        "views": _integer_or_none(getattr(message, "views", None)),
        "forwards": _integer_or_none(getattr(message, "forwards", None)),
        "replies": reply_count,
        "reactions": serialized_reactions,
    }


def _exact_message_payload(chat_id: int, message: Any) -> dict[str, Any]:
    return {
        "status": "found",
        "chatId": chat_id,
        "id": int(getattr(message, "id")),
        "date": _iso_datetime(getattr(message, "date", None)),
        "text": sanitize_user_content(getattr(message, "message", None), max_length=4096),
        "sender": _sender_payload(message),
        "media": _media_payload(message),
        "grouped_id": _integer_or_none(getattr(message, "grouped_id", None)),
        "reply": _reply_payload(message),
        "engagement": _engagement_payload(message),
    }


def _validate_commit_plan(
    edition_id: str,
    plan_digest: str,
    items: list[dict[str, Any]],
) -> tuple[bool, str]:
    if not isinstance(edition_id, str) or not re.fullmatch(r"daily:\d{4}-\d{2}-\d{2}", edition_id):
        return False, "edition_id must identify one daily edition"
    if not isinstance(plan_digest, str) or not PLAN_DIGEST.fullmatch(plan_digest):
        return False, "plan_digest is invalid"
    database_path = _briefing_database_path()
    try:
        database = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
        row = database.execute(
            """
            SELECT receipts.commit_plan_json, receipts.commit_plan_digest, editions.state
            FROM telegram_validation_receipts receipts
            JOIN editions ON editions.id = receipts.edition_id
            WHERE receipts.edition_id = ?
            """,
            (edition_id,),
        ).fetchone()
    except (OSError, sqlite3.Error) as error:
        return False, f"commit plan unavailable: {_safe_error(str(error))}"
    finally:
        if "database" in locals():
            database.close()
    if not row or row[2] != "prepared" or row[1] != plan_digest or not row[0]:
        return False, "commit plan is missing, stale, or belongs to another edition"
    try:
        plan = json.loads(row[0])
        expected = sorted(
            (int(source["chatId"]), int(source["maxId"]))
            for source in plan["sources"]
        )
        actual = sorted((int(item["chat_id"]), int(item["max_id"])) for item in items)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return False, "stored commit plan is malformed"
    if expected != actual:
        return False, "items differ from the validated Telegram commit plan"
    return True, ""


@mcp.tool(
    annotations=ToolAnnotations(
        title="Get Exact Telegram Messages Batch",
        readOnlyHint=True,
        openWorldHint=False,
        destructiveHint=False,
        idempotentHint=True,
    )
)
async def get_messages_exact_batch(
    items: list[dict[str, Any]],
    ctx: Optional[Context] = None,
    account: str = None,
) -> str:
    """Fetch a bounded ordered batch of exact Telegram message IDs.

    Each item must contain exactly ``chat_id`` and ``message_id``. Requests are
    grouped by chat so the existing single Telethon client performs one exact
    ID lookup per chat. This operation never advances unread state, downloads
    media, or performs a provider mutation.
    """

    del ctx
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_BATCH_EXACT_MESSAGES:
        return json.dumps(
            {
                "ok": False,
                "error": f"items must contain one to {MAX_BATCH_EXACT_MESSAGES} entries",
                "results": [],
            }
        )

    grouped: dict[int, list[tuple[int, int]]] = defaultdict(list)
    seen: set[tuple[int, int]] = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict) or set(item) != {"chat_id", "message_id"}:
            return json.dumps(
                {
                    "ok": False,
                    "error": f"item {index} must contain exactly chat_id and message_id",
                    "results": [],
                }
            )
        chat_id = item.get("chat_id")
        message_id = item.get("message_id")
        if (
            not isinstance(chat_id, int)
            or isinstance(chat_id, bool)
            or chat_id == 0
            or not isinstance(message_id, int)
            or isinstance(message_id, bool)
            or message_id < 1
        ):
            return json.dumps(
                {
                    "ok": False,
                    "error": f"item {index} requires a non-zero integer chat_id and positive integer message_id",
                    "results": [],
                }
            )
        identity = (chat_id, message_id)
        if identity in seen:
            return json.dumps(
                {
                    "ok": False,
                    "error": f"duplicate item for chat_id {chat_id} and message_id {message_id}",
                    "results": [],
                }
            )
        seen.add(identity)
        grouped[chat_id].append((index, message_id))

    results: list[Optional[dict[str, Any]]] = [None] * len(items)
    client = get_client(account)
    try:
        await ensure_connected(client)
    except Exception as error:
        safe_error = _safe_error(str(error))
        for index, item in enumerate(items):
            results[index] = {
                "status": "error",
                "chatId": item["chat_id"],
                "id": item["message_id"],
                "error": safe_error,
            }
    else:
        for chat_id, indexed_ids in grouped.items():
            requested_ids = [message_id for _, message_id in indexed_ids]
            try:
                entity = await resolve_entity(chat_id, client)
                fetched = await client.get_messages(entity, ids=requested_ids)
                if fetched is None:
                    messages: list[Any] = []
                elif isinstance(fetched, (list, tuple)):
                    messages = list(fetched)
                else:
                    messages = [fetched]
                by_id: dict[int, Any] = {}
                for message in messages:
                    if message is None:
                        continue
                    message_id = _integer_or_none(getattr(message, "id", None))
                    if message_id is not None and message_id in requested_ids and message_id not in by_id:
                        by_id[message_id] = message
                for index, message_id in indexed_ids:
                    message = by_id.get(message_id)
                    if message is None:
                        results[index] = {
                            "status": "missing",
                            "chatId": chat_id,
                            "id": message_id,
                        }
                    else:
                        results[index] = _exact_message_payload(chat_id, message)
            except Exception as error:
                safe_error = _safe_error(str(error))
                for index, message_id in indexed_ids:
                    results[index] = {
                        "status": "error",
                        "chatId": chat_id,
                        "id": message_id,
                        "error": safe_error,
                    }

    finalized = [
        result
        if result is not None
        else {
            "status": "error",
            "chatId": items[index]["chat_id"],
            "id": items[index]["message_id"],
            "error": "result unavailable",
        }
        for index, result in enumerate(results)
    ]
    found = sum(result["status"] == "found" for result in finalized)
    missing = sum(result["status"] == "missing" for result in finalized)
    errors = sum(result["status"] == "error" for result in finalized)
    return json.dumps(
        {
            "ok": missing == 0 and errors == 0,
            "requested": len(items),
            "found": found,
            "missing": missing,
            "errors": errors,
            "results": finalized,
        },
        ensure_ascii=False,
    )


@mcp.tool(
    annotations=ToolAnnotations(
        title="Download Media Batch",
        openWorldHint=False,
        destructiveHint=True,
    )
)
async def download_media_batch(
    items: list[dict[str, Any]],
    ctx: Optional[Context] = None,
    account: str = None,
) -> str:
    """Download a bounded list of Telegram message attachments to the first allowed root.

    Each item must contain only ``chat_id`` and ``message_id``. The existing
    upstream ``download_media`` implementation owns entity resolution, allowed
    root enforcement, type detection, and the actual Telegram download.
    """

    if not isinstance(items, list) or not 1 <= len(items) <= MAX_BATCH_MEDIA:
        return json.dumps(
            {
                "ok": False,
                "error": f"items must contain one to {MAX_BATCH_MEDIA} entries",
                "results": [],
            }
        )

    seen: set[tuple[int, int]] = set()
    results: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or set(item) != {"chat_id", "message_id"}:
            results.append(
                {
                    "index": index,
                    "status": "failed",
                    "error": "item must contain exactly chat_id and message_id",
                }
            )
            continue
        chat_id = item.get("chat_id")
        message_id = item.get("message_id")
        if (
            not isinstance(chat_id, int)
            or isinstance(chat_id, bool)
            or not isinstance(message_id, int)
            or isinstance(message_id, bool)
        ):
            results.append(
                {
                    "index": index,
                    "status": "failed",
                    "error": "chat_id and message_id must be integers",
                }
            )
            continue
        identity = (chat_id, message_id)
        if identity in seen:
            results.append(
                {
                    "chatId": chat_id,
                    "messageId": message_id,
                    "status": "duplicate",
                }
            )
            continue
        seen.add(identity)
        response = await download_media(
            chat_id=chat_id,
            message_id=message_id,
            file_path=None,
            ctx=ctx,
            account=account,
        )
        prefix = "Media downloaded to "
        if isinstance(response, str) and response.startswith(prefix) and response.endswith("."):
            results.append(
                {
                    "chatId": chat_id,
                    "messageId": message_id,
                    "status": "downloaded",
                    "path": response[len(prefix) : -1],
                }
            )
        else:
            results.append(
                {
                    "chatId": chat_id,
                    "messageId": message_id,
                    "status": "failed",
                    "error": _safe_error(str(response)),
                }
            )

    downloaded = sum(result.get("status") == "downloaded" for result in results)
    failed = sum(result.get("status") == "failed" for result in results)
    return json.dumps(
        {
            "ok": failed == 0,
            "requested": len(items),
            "downloaded": downloaded,
            "failed": failed,
            "results": results,
        },
        ensure_ascii=False,
    )


@mcp.tool(
    annotations=ToolAnnotations(
        title="Mark Telegram Sources Read Through",
        openWorldHint=False,
        destructiveHint=True,
        idempotentHint=True,
    )
)
async def mark_read_through_batch(
    items: list[dict[str, Any]],
    edition_id: str,
    plan_digest: str,
    ctx: Optional[Context] = None,
    account: str = None,
) -> str:
    """Mark configured chats read only through their captured maximum message IDs.

    Each item must contain exactly ``chat_id`` and ``max_id`` and match the
    persisted, content-covered commit plan for ``edition_id``. This fixed-shape
    operation is intentionally narrower than the upstream unbounded
    ``mark_as_read`` tool and runs in the existing single Telegram process.
    """

    del ctx
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_BATCH_MARK_READ:
        return json.dumps(
            {
                "ok": False,
                "error": f"items must contain one to {MAX_BATCH_MARK_READ} entries",
                "results": [],
            }
        )

    validated: list[tuple[int, int]] = []
    seen: set[int] = set()
    for item in items:
        if not isinstance(item, dict) or set(item) != {"chat_id", "max_id"}:
            return json.dumps(
                {"ok": False, "error": "each item must contain exactly chat_id and max_id", "results": []}
            )
        chat_id = item.get("chat_id")
        max_id = item.get("max_id")
        if (
            not isinstance(chat_id, int)
            or isinstance(chat_id, bool)
            or not isinstance(max_id, int)
            or isinstance(max_id, bool)
            or max_id < 1
        ):
            return json.dumps(
                {"ok": False, "error": "chat_id and positive max_id must be integers", "results": []}
            )
        if chat_id in seen:
            return json.dumps({"ok": False, "error": f"duplicate chat_id {chat_id}", "results": []})
        seen.add(chat_id)
        validated.append((chat_id, max_id))

    plan_ok, plan_error = _validate_commit_plan(edition_id, plan_digest, items)
    if not plan_ok:
        return json.dumps({"ok": False, "error": plan_error, "results": []})

    client = get_client(account)
    await ensure_connected(client)
    results: list[dict[str, Any]] = []
    for chat_id, max_id in validated:
        try:
            entity = await resolve_entity(chat_id, client)
            await client.send_read_acknowledge(entity, max_id=max_id)
            results.append({"chatId": chat_id, "maxId": max_id, "status": "committed"})
        except Exception as error:  # provider failures must remain visible per channel
            results.append(
                {
                    "chatId": chat_id,
                    "maxId": max_id,
                    "status": "failed",
                    "error": _safe_error(str(error)),
                }
            )

    committed = sum(result["status"] == "committed" for result in results)
    failed = len(results) - committed
    return json.dumps(
        {
            "ok": failed == 0,
            "requested": len(validated),
            "committed": committed,
            "failed": failed,
            "results": results,
        },
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
