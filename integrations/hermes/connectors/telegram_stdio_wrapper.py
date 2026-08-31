#!/usr/bin/env python3
"""Kurami-owned additions to the pinned Telegram MCP stdio process."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
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
)
from telegram_mcp.tools import *  # type: ignore[import-not-found]  # noqa: E402,F403
from telegram_mcp.tools.media import download_media  # type: ignore[import-not-found]  # noqa: E402

MAX_BATCH_MEDIA = 256
MAX_BATCH_MARK_READ = 64
PLAN_DIGEST = re.compile(r"^[a-f0-9]{64}$")


def _safe_error(value: str) -> str:
    value = " ".join(value.split())
    return value[:500] if value else "download failed"


def _briefing_database_path() -> Path:
    home = Path(os.environ.get("KURAMI_HOME", "/home/shagon1k/_hermes/_kurami"))
    return home / "state" / "briefing" / "briefing.db"


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
