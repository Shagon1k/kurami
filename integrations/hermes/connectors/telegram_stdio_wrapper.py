#!/usr/bin/env python3
"""Kurami-owned additions to the pinned Telegram MCP stdio process."""

from __future__ import annotations

import json
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


def _safe_error(value: str) -> str:
    value = " ".join(value.split())
    return value[:500] if value else "download failed"


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
    ctx: Optional[Context] = None,
    account: str = None,
) -> str:
    """Mark configured chats read only through their captured maximum message IDs.

    Each item must contain exactly ``chat_id`` and ``max_id``. This fixed-shape
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
