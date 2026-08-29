#!/usr/bin/env python3
"""Add complete, ordered Telegram album media references to a normalized batch."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def integer(metadata: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        if isinstance(value, str) and value.lstrip("-").isdigit():
            return int(value)
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    document = json.loads(args.input.read_text(encoding="utf-8"))
    items = document.get("items") if isinstance(document, dict) else None
    if not isinstance(items, list):
        raise SystemExit("input must be a normalized source batch with an items array")

    groups: dict[tuple[int, int], list[int]] = {}
    normalized: list[tuple[dict[str, Any], dict[str, Any], int | None, int | None, int | None]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        metadata = item.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
            item["metadata"] = metadata
        chat_id = integer(metadata, "telegramChatId", "chatId", "chat_id")
        message_id = integer(metadata, "telegramMessageId", "messageId", "message_id")
        group_id = integer(metadata, "telegramGroupId", "groupedId", "grouped_id")
        normalized.append((item, metadata, chat_id, message_id, group_id))
        if chat_id is not None and message_id is not None and group_id is not None:
            groups.setdefault((chat_id, group_id), []).append(message_id)

    for _, metadata, chat_id, message_id, group_id in normalized:
        if message_id is None or not metadata.get("hasMedia"):
            continue
        if chat_id is not None and group_id is not None:
            media_ids = sorted(set(groups.get((chat_id, group_id), [message_id])))
            metadata["telegramGroupId"] = group_id
        else:
            media_ids = [message_id]
        metadata["telegramMessageId"] = message_id
        if chat_id is not None:
            metadata["telegramChatId"] = chat_id
        metadata["mediaMessageIds"] = media_ids

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
