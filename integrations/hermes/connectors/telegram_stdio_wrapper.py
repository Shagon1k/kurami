#!/usr/bin/env python3
"""Kurami-owned additions to the pinned Telegram MCP stdio process."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

# Hermes starts this file with cwd set to the pinned external connector. Keep
# the checkout unmodified while importing its installed package and venv.
sys.path.insert(0, str(Path.cwd()))

from mcp.types import ToolAnnotations  # type: ignore[import-not-found]  # noqa: E402
from telethon import functions as telethon_functions  # type: ignore[import-not-found]  # noqa: E402
from telethon import types as telethon_types  # type: ignore[import-not-found]  # noqa: E402
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

MAX_BATCH_MEDIA = 12
MAX_BATCH_EXACT_MESSAGES = 256
MAX_BATCH_MARK_READ = 64
MAX_CAPTURE_PAGE = 50
PLAN_DIGEST = re.compile(r"^[a-f0-9]{64}$")
EDITION_ID = re.compile(r"^daily:(?P<date>\d{4}-\d{2}-\d{2})$")
TELEGRAM_USERNAME = re.compile(r"^[A-Za-z0-9_]{5,32}$")
CANONICAL_MEDIA_FILE = re.compile(
    r"^telegram_(?P<chat>-?[1-9]\d*)_(?P<message>[1-9]\d*)_(?P<timestamp>\d+)(?:\.[A-Za-z0-9]{1,16})?$"
)
IMAGE_MEDIA_EXTENSIONS = frozenset({".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"})


def _safe_error(value: str) -> str:
    value = " ".join(value.split())
    return value[:500] if value else "download failed"


def _briefing_media_inbox_path() -> Path:
    home = Path(os.environ.get("KURAMI_HOME", "/home/shagon1k/_hermes/_kurami"))
    return home / "state" / "briefing" / "media-inbox"


def _briefing_home_path() -> Path:
    return Path(os.environ.get("KURAMI_HOME", "/home/shagon1k/_hermes/_kurami")).resolve()


def _capture_paths(edition_id: str, attempt_id: str) -> tuple[Path, Path, Path]:
    match = EDITION_ID.fullmatch(edition_id) if isinstance(edition_id, str) else None
    if match is None:
        raise ValueError("edition_id must identify one daily edition")
    local_date = datetime.now(ZoneInfo("Europe/Vilnius")).date().isoformat()
    if match.group("date") != local_date:
        raise ValueError("capture is allowed only for today's Europe/Vilnius edition")
    status = _briefing_cli(["attempt-status", "--attempt", attempt_id])
    attempt = status.get("attempt")
    if not isinstance(attempt, dict) or attempt.get("editionId") != edition_id:
        raise ValueError("attempt_id does not belong to edition_id")
    home = _briefing_home_path()
    runs = (home / "state" / "briefing" / "runs").resolve()
    run_directory = attempt.get("runDirectory")
    if not isinstance(run_directory, str):
        raise ValueError("attempt run directory is unavailable")
    run = Path(run_directory)
    resolved = run.resolve()
    if run.is_symlink() or not _is_within(resolved, runs):
        raise ValueError("capture run directory is outside the briefing runs root")
    return resolved, resolved / "telegram-raw.json", resolved / "telegram-normalized.json"


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    encoded = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if len(encoded) > 8 * 1024 * 1024:
        raise ValueError("captured Telegram batch exceeds 8 MiB")
    with tempfile.NamedTemporaryFile(
        mode="wb",
        dir=path.parent,
        prefix=f".{path.name}.",
        delete=False,
    ) as temporary:
        temporary.write(encoded)
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    try:
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _briefing_cli(arguments: list[str]) -> dict[str, Any]:
    home = _briefing_home_path()
    node = home / "runtime" / "node" / "bin" / "node"
    cli = home / "app" / "dist" / "briefing" / "cli.js"
    result = subprocess.run(
        [str(node), str(cli), *arguments],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError("briefing runtime command failed")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("briefing runtime returned invalid JSON") from error
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise RuntimeError("briefing runtime rejected the command")
    return payload


def _telegram_capture_config() -> dict[str, Any]:
    payload = _briefing_cli(["telegram-capture-config"])
    channels = payload.get("channels")
    if not isinstance(channels, list) or not channels:
        raise RuntimeError("Telegram capture config has no enabled channels")
    return payload


def _normalize_and_validate_capture(
    config_path: str,
    raw_path: Path,
    normalized_path: Path,
    attempt_id: str,
) -> dict[str, Any]:
    home = _briefing_home_path()
    normalizer = (
        home
        / "../_core/skills/kurami-daily-briefing/scripts/normalize_telegram_albums.py"
    ).resolve()
    temporary = normalized_path.parent / f".{normalized_path.name}.{os.getpid()}.tmp"
    temporary.unlink(missing_ok=True)
    try:
        result = subprocess.run(
            [sys.executable, str(normalizer), "--input", str(raw_path), "--output", str(temporary)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0 or not temporary.is_file():
            raise RuntimeError("Telegram album normalization failed")
        os.chmod(temporary, 0o600)
        os.replace(temporary, normalized_path)
    finally:
        temporary.unlink(missing_ok=True)
    return _briefing_cli(
        [
            "validate-telegram-batch",
            "--config",
            config_path,
            "--raw",
            str(raw_path),
            "--normalized",
            str(normalized_path),
            "--attempt",
            attempt_id,
        ]
    )


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _canonical_media_identity(path: Path) -> Optional[tuple[int, int, int]]:
    match = CANONICAL_MEDIA_FILE.fullmatch(path.name)
    if not match:
        return None
    return (
        int(match.group("chat")),
        int(match.group("message")),
        int(match.group("timestamp")),
    )


def _validated_inbox_media_path(
    path: Path,
    chat_id: int,
    message_id: int,
) -> Optional[Path]:
    inbox = _briefing_media_inbox_path().resolve()
    try:
        if path.is_symlink():
            return None
        resolved = path.resolve(strict=True)
        identity = _canonical_media_identity(resolved)
        if (
            identity is None
            or identity[:2] != (chat_id, message_id)
            or not _is_within(resolved, inbox)
            or resolved.suffix.lower() not in IMAGE_MEDIA_EXTENSIONS
        ):
            return None
        stat = resolved.stat()
        if not resolved.is_file() or stat.st_size < 1:
            return None
        return resolved
    except OSError:
        return None


def _find_reusable_media(chat_id: int, message_id: int) -> Optional[Path]:
    inbox = _briefing_media_inbox_path()
    matches: list[tuple[int, int, str, Path]] = []
    for directory, child_directories, file_names in os.walk(inbox, followlinks=False):
        root = Path(directory)
        child_directories[:] = sorted(
            name for name in child_directories if not (root / name).is_symlink()
        )
        for file_name in sorted(file_names):
            candidate = root / file_name
            identity = _canonical_media_identity(candidate)
            if identity is None or identity[:2] != (chat_id, message_id):
                continue
            validated = _validated_inbox_media_path(candidate, chat_id, message_id)
            if validated is not None:
                try:
                    modified = validated.stat().st_mtime_ns
                except OSError:
                    continue
                matches.append((modified, identity[2], str(validated), validated))
    if not matches:
        return None
    matches.sort(key=lambda match: (match[0], match[1], match[2]), reverse=True)
    return matches[0][3]


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


def _chat_payload(entity: Any, chat_id: int) -> dict[str, Any]:
    payload: dict[str, Any] = {"id": chat_id}
    title = getattr(entity, "title", None)
    if isinstance(title, str) and title.strip():
        payload["title"] = sanitize_name(title)
    username = getattr(entity, "username", None)
    if isinstance(username, str) and TELEGRAM_USERNAME.fullmatch(username.strip()):
        payload["username"] = username.strip()
    return payload


def _telegram_message_url(entity: Any, chat_id: int, message_id: int) -> Optional[str]:
    username = getattr(entity, "username", None)
    if isinstance(username, str) and TELEGRAM_USERNAME.fullmatch(username.strip()):
        return f"https://t.me/{username.strip()}/{message_id}"
    internal_chat_id = str(abs(chat_id))
    if internal_chat_id.startswith("100") and len(internal_chat_id) > 3:
        return f"https://t.me/c/{internal_chat_id[3:]}/{message_id}"
    return None


def _media_type(message: Any, media: Any) -> str:
    video = getattr(message, "video", None)
    if video is not None:
        return "video"
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
    # Telethon may expose a video thumbnail through ``message.photo`` while
    # the owning attachment is still a video document. Document MIME therefore
    # has priority over the convenience photo attribute.
    if getattr(message, "photo", None) is not None:
        return "photo"
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
    video = getattr(message, "video", None)
    document = video if video is not None else getattr(message, "document", None)
    # Owning video/document identity takes priority over a thumbnail photo.
    media_id = _integer_or_none(getattr(document, "id", None))
    if media_id is None:
        media_id = _integer_or_none(getattr(photo, "id", None))
    if media_id is not None:
        payload["id"] = media_id

    file = getattr(message, "file", None)
    file_name = getattr(file, "name", None)
    if isinstance(file_name, str) and file_name.strip():
        payload["fileName"] = sanitize_name(file_name)
    mime_type = getattr(document, "mime_type", None) or getattr(file, "mime_type", None)
    if isinstance(mime_type, str) and mime_type.strip():
        payload["mimeType"] = mime_type.strip()
    size = _integer_or_none(getattr(document, "size", None))
    if size is None:
        size = _integer_or_none(getattr(file, "size", None))
    if size is not None:
        payload["size"] = size
    duration = _integer_or_none(getattr(file, "duration", None))
    if duration is not None:
        payload["duration"] = duration
    return payload


def _image_media_type(message: Any) -> Optional[str]:
    media = getattr(message, "media", None)
    if media is None:
        return None
    media_type = _media_type(message, media)
    if media_type in {"photo", "image"}:
        return media_type
    if media_type in {"video", "audio", "document"}:
        return None
    video = getattr(message, "video", None)
    document = video if video is not None else getattr(message, "document", None)
    mime_type = getattr(document, "mime_type", None)
    if not isinstance(mime_type, str):
        mime_type = getattr(getattr(message, "file", None), "mime_type", None)
    if isinstance(mime_type, str) and mime_type.lower().startswith("image/"):
        return "image"
    return None


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


def _exact_message_payload(chat_id: int, message: Any, entity: Any) -> dict[str, Any]:
    message_id = int(getattr(message, "id"))
    payload: dict[str, Any] = {
        "status": "found",
        "chatId": chat_id,
        "id": message_id,
        "date": _iso_datetime(getattr(message, "date", None)),
        "text": sanitize_user_content(getattr(message, "message", None), max_length=4096),
        "chat": _chat_payload(entity, chat_id),
        "sender": _sender_payload(message),
        "media": _media_payload(message),
        "grouped_id": _integer_or_none(getattr(message, "grouped_id", None)),
        "reply": _reply_payload(message),
        "engagement": _engagement_payload(message),
    }
    external_url = _telegram_message_url(entity, chat_id, message_id)
    if external_url is not None:
        payload["externalUrl"] = external_url
    return payload


def _captured_item(source: dict[str, Any], message: Any, entity: Any) -> dict[str, Any]:
    chat_id = int(source["id"])
    exact = _exact_message_payload(chat_id, message, entity)
    message_id = int(exact["id"])
    content = exact.get("text") if isinstance(exact.get("text"), str) else ""
    first_line = next((line.strip() for line in content.splitlines() if line.strip()), "Telegram post")
    media = exact.get("media") if isinstance(exact.get("media"), dict) else None
    metadata: dict[str, Any] = {
        "hasMedia": media is not None,
        "telegramChatId": chat_id,
        "telegramMessageId": message_id,
    }
    group_id = exact.get("grouped_id")
    if isinstance(group_id, int) and not isinstance(group_id, bool):
        # Telegram album/group identifiers are signed 64-bit values and may
        # exceed JavaScript's safe-integer range. They are opaque identities,
        # not quantities, so persist them losslessly as decimal strings.
        metadata["telegramGroupId"] = str(group_id)
    if media is not None:
        media_type = media.get("type")
        metadata["mediaType"] = media_type if isinstance(media_type, str) and media_type else "unknown"
        mime_type = media.get("mimeType")
        if isinstance(mime_type, str) and mime_type:
            metadata["mediaMimeType"] = mime_type
    engagement = exact.get("engagement")
    if isinstance(engagement, dict):
        metadata["engagement"] = engagement
    sender = exact.get("sender")
    if isinstance(sender, dict):
        metadata["sender"] = sender
    return {
        "id": f"telegram:{source['key']}:{message_id}",
        "kind": "news",
        "source": "Telegram",
        "sourceProfile": "telegram-user",
        "sourceDetail": source["label"],
        "sourceItemId": f"{chat_id}:{message_id}",
        "title": first_line[:240],
        "content": content,
        "publishedAt": exact.get("date"),
        "externalUrl": exact.get("externalUrl"),
        "metadata": metadata,
    }


@mcp.tool(
    annotations=ToolAnnotations(
        title="Capture Daily Briefing Telegram Batch",
        readOnlyHint=True,
        openWorldHint=False,
        destructiveHint=False,
        idempotentHint=True,
    )
)
async def capture_daily_briefing_batch(
    edition_id: str,
    attempt_id: str,
    ctx: Optional[Context] = None,
    account: str = None,
) -> str:
    """Persist today's complete configured unread Telegram ledger.

    The tool reads the authoritative Kurami briefing source registry, captures
    each configured channel through the existing single Telethon client, writes
    the bounded raw and normalized artifacts atomically, and validates them.
    It never advances unread state or downloads media. Existing valid artifacts
    are reused so an automatic retry cannot silently move the 09:00 cutoff.
    """

    del ctx
    try:
        _, raw_path, normalized_path = _capture_paths(edition_id, attempt_id)
        config = _telegram_capture_config()
        config_path = str(config["configPath"])
        if raw_path.is_file() and normalized_path.is_file():
            attempt_status = _briefing_cli(["attempt-status", "--attempt", attempt_id]).get("attempt", {})
            if isinstance(attempt_status, dict) and attempt_status.get("state") == "live-collected":
                _briefing_cli(["advance-attempt", "--attempt", attempt_id, "--stage", "telegram-captured"])
            report = _briefing_cli(
                [
                    "validate-telegram-batch",
                    "--config",
                    config_path,
                    "--raw",
                    str(raw_path),
                    "--normalized",
                    str(normalized_path),
                    "--attempt",
                    attempt_id,
                ]
            )
            return json.dumps(
                {
                    "ok": report.get("complete") is True,
                    "reused": True,
                    "rawPath": str(raw_path),
                    "normalizedPath": str(normalized_path),
                    "report": report,
                },
                ensure_ascii=False,
            )

        client = get_client(account)
        await ensure_connected(client)
        discovery_limit = int(config["discoveryLimit"])
        capture_channels: list[dict[str, Any]] = []
        items: list[dict[str, Any]] = []
        failed = False
        partial = False

        for source in config["channels"]:
            chat_id = int(source["id"])
            try:
                entity = await resolve_entity(chat_id, client)
                input_peer = await client.get_input_entity(entity)
                peer_dialogs = await client(
                    telethon_functions.messages.GetPeerDialogsRequest(
                        peers=[telethon_types.InputDialogPeer(peer=input_peer)]
                    )
                )
                dialogs = getattr(peer_dialogs, "dialogs", None)
                if not dialogs:
                    raise RuntimeError("configured channel dialog is unavailable")
                dialog = dialogs[0]
            except Exception:
                failed = True
                capture_channels.append(
                    {
                        "sourceKey": source["key"],
                        "channelId": chat_id,
                        "label": source["label"],
                        "status": "failed",
                        "capturedUnreadCount": 0,
                        "upperMessageId": None,
                        "fetchedMessageIds": [],
                    }
                )
                continue

            unread_count = int(getattr(dialog, "unread_count", 0) or 0)
            if unread_count < 1:
                capture_channels.append(
                    {
                        "sourceKey": source["key"],
                        "channelId": chat_id,
                        "label": source["label"],
                        "status": "empty",
                        "capturedUnreadCount": 0,
                        "upperMessageId": None,
                        "fetchedMessageIds": [],
                    }
                )
                continue

            upper_message_id = _integer_or_none(getattr(dialog, "top_message", None))
            read_max = _integer_or_none(getattr(dialog, "read_inbox_max_id", None)) or 0
            requested = min(unread_count, discovery_limit)
            fetched: list[Any] = []
            async for message in client.iter_messages(entity, min_id=read_max):
                message_id = _integer_or_none(getattr(message, "id", None))
                if message_id is None:
                    continue
                if upper_message_id is not None and message_id > upper_message_id:
                    continue
                fetched.append(message)
                if len(fetched) >= requested:
                    break
            fetched.sort(key=lambda message: int(getattr(message, "id")), reverse=True)
            fetched_ids = [int(getattr(message, "id")) for message in fetched]
            channel_status = "ready" if len(fetched_ids) == unread_count else "partial"
            if channel_status == "partial":
                partial = True
            capture_channels.append(
                {
                    "sourceKey": source["key"],
                    "channelId": chat_id,
                    "label": source["label"],
                    "status": channel_status,
                    "capturedUnreadCount": unread_count,
                    "upperMessageId": upper_message_id,
                    "fetchedMessageIds": fetched_ids,
                }
            )
            items.extend(_captured_item(source, message, entity) for message in fetched)

        root_status = "failed" if failed else "partial" if partial else "ready"
        raw = {
            "sourceKey": "news",
            "profile": "telegram-user",
            "status": root_status,
            "fetchedAt": datetime.now().astimezone().isoformat(),
            "capture": {"channels": capture_channels},
            "items": items,
            "diagnostics": [],
        }
        _atomic_json(raw_path, raw)
        _briefing_cli(["advance-attempt", "--attempt", attempt_id, "--stage", "telegram-captured"])
        report = _normalize_and_validate_capture(config_path, raw_path, normalized_path, attempt_id)
        return json.dumps(
            {
                "ok": report.get("complete") is True,
                "reused": False,
                "rawPath": str(raw_path),
                "normalizedPath": str(normalized_path),
                "report": report,
            },
            ensure_ascii=False,
        )
    except Exception as error:
        return json.dumps(
            {"ok": False, "error": _safe_error(str(error))},
            ensure_ascii=False,
        )


@mcp.tool(
    annotations=ToolAnnotations(
        title="Read Captured Daily Briefing Telegram Page",
        readOnlyHint=True,
        openWorldHint=False,
        destructiveHint=False,
        idempotentHint=True,
    )
)
async def read_daily_briefing_batch_page(
    edition_id: str,
    attempt_id: str,
    offset: int = 0,
    limit: int = 25,
    ctx: Optional[Context] = None,
    account: str = None,
) -> str:
    """Read one bounded page from the persisted normalized Telegram ledger."""

    del ctx, account
    if (
        not isinstance(offset, int)
        or isinstance(offset, bool)
        or offset < 0
        or not isinstance(limit, int)
        or isinstance(limit, bool)
        or not 1 <= limit <= MAX_CAPTURE_PAGE
    ):
        return json.dumps({"ok": False, "error": "offset or limit is invalid"})
    try:
        _, _, normalized_path = _capture_paths(edition_id, attempt_id)
        payload = json.loads(normalized_path.read_text(encoding="utf-8"))
        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            raise ValueError("normalized Telegram capture is unavailable")
        page = items[offset : offset + limit]
        return json.dumps(
            {
                "ok": True,
                "offset": offset,
                "limit": limit,
                "total": len(items),
                "nextOffset": offset + len(page) if offset + len(page) < len(items) else None,
                "items": page,
            },
            ensure_ascii=False,
        )
    except Exception as error:
        return json.dumps({"ok": False, "error": _safe_error(str(error))}, ensure_ascii=False)


def _validate_commit_plan(
    edition_id: str,
    attempt_id: str,
    plan_digest: str,
    items: list[dict[str, Any]],
) -> tuple[bool, str]:
    if not isinstance(edition_id, str) or not re.fullmatch(r"daily:\d{4}-\d{2}-\d{2}", edition_id):
        return False, "edition_id must identify one daily edition"
    if not isinstance(plan_digest, str) or not PLAN_DIGEST.fullmatch(plan_digest):
        return False, "plan_digest is invalid"
    try:
        plan = _briefing_cli(
            [
                "telegram-commit-plan",
                "--id",
                edition_id,
                "--attempt",
                attempt_id,
            ]
        )
    except (OSError, RuntimeError, ValueError) as error:
        return False, f"commit plan unavailable: {_safe_error(str(error))}"
    if plan.get("planDigest") != plan_digest or not isinstance(plan.get("sources"), list):
        return False, "commit plan is missing, stale, or belongs to another edition"
    try:
        expected = sorted(
            (int(source["chatId"]), int(source["maxId"]))
            for source in plan["sources"]
        )
        actual = sorted((int(item["chat_id"]), int(item["max_id"])) for item in items)
    except (KeyError, TypeError, ValueError):
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
                        results[index] = _exact_message_payload(chat_id, message, entity)
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
    """Download or reuse a small bounded list of Telegram message attachments.

    Each item must contain only ``chat_id`` and ``message_id``. The existing
    upstream ``download_media`` implementation owns entity resolution, allowed
    root enforcement, type detection, and the actual Telegram download. A
    non-empty canonical image file for the exact pair already in the briefing
    media inbox is returned as ``reused`` only after Telegram confirms that the
    message attachment is an image. Video and other media are reported as
    ``skipped`` without download or reuse.
    """

    if not isinstance(items, list) or not 1 <= len(items) <= MAX_BATCH_MEDIA:
        return json.dumps(
            {
                "ok": False,
                "error": f"items must contain one to {MAX_BATCH_MEDIA} entries",
                "requested": len(items) if isinstance(items, list) else 0,
                "downloaded": 0,
                "reused": 0,
                "skipped": 0,
                "failed": 0,
                "results": [],
            }
        )

    validated: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict) or set(item) != {"chat_id", "message_id"}:
            return json.dumps(
                {
                    "ok": False,
                    "error": f"item {index} must contain exactly chat_id and message_id",
                    "requested": len(items),
                    "downloaded": 0,
                    "reused": 0,
                    "skipped": 0,
                    "failed": 0,
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
                    "requested": len(items),
                    "downloaded": 0,
                    "reused": 0,
                    "skipped": 0,
                    "failed": 0,
                    "results": [],
                }
            )
        identity = (chat_id, message_id)
        if identity in seen:
            return json.dumps(
                {
                    "ok": False,
                    "error": f"duplicate item for chat_id {chat_id} and message_id {message_id}",
                    "requested": len(items),
                    "downloaded": 0,
                    "reused": 0,
                    "skipped": 0,
                    "failed": 0,
                    "results": [],
                }
            )
        seen.add(identity)
        validated.append(identity)

    grouped: dict[int, list[int]] = defaultdict(list)
    for chat_id, message_id in validated:
        grouped[chat_id].append(message_id)
    preflight: dict[tuple[int, int], dict[str, Any]] = {}
    client = get_client(account)
    try:
        await ensure_connected(client)
    except Exception as error:
        safe_error = _safe_error(str(error))
        for chat_id, message_id in validated:
            preflight[(chat_id, message_id)] = {
                "status": "failed",
                "error": safe_error,
            }
    else:
        for chat_id, message_ids in grouped.items():
            try:
                entity = await resolve_entity(chat_id, client)
                fetched = await client.get_messages(entity, ids=message_ids)
                if fetched is None:
                    messages: list[Any] = []
                elif isinstance(fetched, (list, tuple)):
                    messages = list(fetched)
                else:
                    messages = [fetched]
                by_id = {
                    message_id: message
                    for message in messages
                    if message is not None
                    and (message_id := _integer_or_none(getattr(message, "id", None))) is not None
                    and message_id in message_ids
                }
                for message_id in message_ids:
                    message = by_id.get(message_id)
                    if message is None:
                        preflight[(chat_id, message_id)] = {
                            "status": "failed",
                            "error": "Telegram message is unavailable",
                        }
                        continue
                    image_type = _image_media_type(message)
                    if image_type is None:
                        media = getattr(message, "media", None)
                        media_type = _media_type(message, media) if media is not None else "none"
                        preflight[(chat_id, message_id)] = {
                            "status": "skipped",
                            "reason": "non-image-media",
                            "mediaType": media_type,
                        }
                    else:
                        preflight[(chat_id, message_id)] = {
                            "status": "eligible",
                            "mediaType": image_type,
                        }
            except Exception as error:
                safe_error = _safe_error(str(error))
                for message_id in message_ids:
                    preflight[(chat_id, message_id)] = {
                        "status": "failed",
                        "error": safe_error,
                    }

    results: list[dict[str, Any]] = []
    for chat_id, message_id in validated:
        eligibility = preflight[(chat_id, message_id)]
        if eligibility["status"] != "eligible":
            results.append({
                "chatId": chat_id,
                "messageId": message_id,
                **eligibility,
            })
            continue
        reusable = _find_reusable_media(chat_id, message_id)
        if reusable is not None:
            results.append(
                {
                    "chatId": chat_id,
                    "messageId": message_id,
                    "status": "reused",
                    "path": str(reusable),
                }
            )
            continue

        try:
            response = await download_media(
                chat_id=chat_id,
                message_id=message_id,
                file_path=None,
                ctx=ctx,
                account=account,
            )
        except Exception as error:
            response = f"Download failed: {_safe_error(str(error))}"
        prefix = "Media downloaded to "
        path: Optional[Path] = None
        if isinstance(response, str) and response.startswith(prefix) and response.endswith("."):
            path = _validated_inbox_media_path(
                Path(response[len(prefix) : -1]),
                chat_id,
                message_id,
            )
        if path is not None:
            results.append(
                {
                    "chatId": chat_id,
                    "messageId": message_id,
                    "status": "downloaded",
                    "path": str(path),
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
    reused = sum(result.get("status") == "reused" for result in results)
    skipped = sum(result.get("status") == "skipped" for result in results)
    failed = sum(result.get("status") == "failed" for result in results)
    return json.dumps(
        {
            "ok": failed == 0 and downloaded + reused + skipped == len(validated),
            "requested": len(validated),
            "downloaded": downloaded,
            "reused": reused,
            "skipped": skipped,
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
    attempt_id: str,
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

    plan_ok, plan_error = _validate_commit_plan(edition_id, attempt_id, plan_digest, items)
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
