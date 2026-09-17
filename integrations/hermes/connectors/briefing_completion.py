"""Deterministic, same-process Telegram completion; no MCP client or LLM."""
from __future__ import annotations

import asyncio
import fcntl
import json
import os
from pathlib import Path
from typing import Any, Callable


class CompletionFailure(Exception):
    """A bounded diagnostic suitable for the run card."""


async def finish(edition_id: str, attempt_id: str, *, cli: Callable, download: Callable,
                 acknowledge: Callable, atomic_json: Callable, valid_path: Callable,
                 home: Path) -> dict[str, Any]:
    async def command(*arguments: str) -> dict[str, Any]:
        return await asyncio.to_thread(cli, list(arguments))

    context = await command("completion-context", "--id", edition_id, "--attempt", attempt_id)
    run = Path(context["runDirectory"])
    # One writer across duplicate MCP calls or a connector reconnect.
    descriptor = os.open(run / "completion.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"ok": False, "state": "busy", "errorCode": "completion_already_running"}
        context = await command("completion-context", "--id", edition_id, "--attempt", attempt_id)
        current_stage = "context"
        async def execute() -> dict[str, Any]:
            nonlocal current_stage
            state = context["attempt"]["state"]
            if state == "notified":
                return await command("assert-complete", "--id", edition_id, "--attempt", attempt_id)
            if state == "editorialized":
                current_stage = "render"
                await command("render-preview", "--payload", context["payloadPath"], "--attempt", attempt_id)
                state = "prepared"
            if state == "prepared":
                current_stage = "media"
                pairs = context["pairs"]
                expected = {(p["chat_id"], p["message_id"]) for p in pairs}
                receipt_path = run / "completion-downloads.json"
                receipts: dict[tuple[int, int], dict[str, Any]] = {}
                if receipt_path.exists():
                    if receipt_path.is_symlink() or receipt_path.stat().st_size > 8 * 1024 * 1024:
                        raise CompletionFailure("completion_receipts_invalid")
                    saved = json.loads(receipt_path.read_text())
                    if saved.get("editionId") != edition_id or saved.get("pairDigest") != context["pairDigest"]:
                        raise CompletionFailure("completion_receipts_mismatch")
                    for item in saved.get("results", []):
                        key = (item.get("chatId"), item.get("messageId"))
                        if key not in expected or key in receipts:
                            raise CompletionFailure("completion_receipts_invalid")
                        if item.get("status") in {"downloaded", "reused"} and valid_path(Path(item.get("path", "")), *key):
                            receipts[key] = item
                for retry in range(3):
                    missing = [p for p in pairs if (p["chat_id"], p["message_id"]) not in receipts]
                    if not missing:
                        break
                    if retry:
                        await asyncio.sleep(retry)
                    for offset in range(0, len(missing), 12):
                        chunk = missing[offset:offset + 12]
                        chunk_keys = {(p["chat_id"], p["message_id"]) for p in chunk}
                        try:
                            result = json.loads(await asyncio.wait_for(download(chunk), timeout=90))
                        except (TimeoutError, OSError):
                            continue
                        returned: set[tuple[int, int]] = set()
                        for item in result.get("results", []):
                            key = (item.get("chatId"), item.get("messageId"))
                            if key not in chunk_keys or key in returned:
                                raise CompletionFailure("completion_download_identity_mismatch")
                            returned.add(key)
                            if item.get("status") in {"downloaded", "reused"} and valid_path(Path(item.get("path", "")), *key):
                                receipts[key] = {k:item[k] for k in ("chatId", "messageId", "status", "path")}
                        atomic_json(receipt_path, {"editionId":edition_id, "pairDigest":context["pairDigest"],
                            "results":[receipts[(p["chat_id"],p["message_id"])] for p in pairs if (p["chat_id"],p["message_id"]) in receipts]})
                        atomic_json(run / "completion-progress.json", {"stage":"media", "expected":len(pairs), "completed":len(receipts)})
                if len(receipts) != len(pairs):
                    raise CompletionFailure("completion_media_incomplete")
                # Empty editions still get an exact, empty receipt set.
                atomic_json(receipt_path, {"editionId":edition_id, "pairDigest":context["pairDigest"],
                    "results":[receipts[(p["chat_id"],p["message_id"])] for p in pairs]})
                current_stage = "import"
                manifest = await command("build-media-manifest", "--id", edition_id, "--downloads", str(receipt_path),
                                         "--output", str(run / "completion-manifest.json"))
                if manifest["outputPath"]:
                    await command("import-media", "--manifest", manifest["outputPath"], "--attempt", attempt_id)
                else:
                    await command("media-ready", "--attempt", attempt_id)
                state = "media-ready"
            if state in {"media-ready", "commit-planned"}:
                if state == "media-ready":
                    current_stage = "live_refresh"
                    await command("refresh-before-publish", "--id", edition_id, "--attempt", attempt_id)
                current_stage = "validation"
                await command("validate-telegram-batch", "--config", str(home / "config/briefing.yaml"),
                    "--raw", str(run / "telegram-raw.json"), "--normalized", str(run / "telegram-normalized.json"),
                    "--id", edition_id, "--attempt", attempt_id)
                plan = await command("telegram-commit-plan", "--id", edition_id, "--attempt", attempt_id)
                current_stage = "acknowledgement"
                commits_path = run / "completion-commits.json"
                commits = None
                if commits_path.exists():
                    if commits_path.is_symlink() or commits_path.stat().st_size > 128 * 1024:
                        raise CompletionFailure("completion_commits_invalid")
                    commits = json.loads(commits_path.read_text())
                    if commits.get("editionId") != edition_id or commits.get("planDigest") != plan["planDigest"]:
                        raise CompletionFailure("completion_commits_mismatch")
                if commits is None:
                    items = [{"chat_id":s["chatId"], "max_id":s["maxId"]} for s in plan["sources"]]
                    outcome = json.loads(await acknowledge(items, edition_id, attempt_id, plan["planDigest"]))
                    expected_ids = {(i["chat_id"], i["max_id"]) for i in items}
                    results = outcome.get("results", [])
                    if (len(results) != len(items) or
                        {(r.get("chatId"),r.get("maxId")) for r in results} != expected_ids or
                        any(r.get("status") not in {"committed","failed"} for r in results)):
                        raise CompletionFailure("completion_acknowledgement_invalid")
                    by_id = {r["chatId"]: r for r in results}
                    commits = {"editionId":edition_id, "planDigest":plan["planDigest"], "results":[
                        {"sourceKey":s["sourceKey"], "status":by_id[s["chatId"]]["status"],
                         **({"errorCode":"telegram_acknowledgement_failed"} if by_id[s["chatId"]]["status"] == "failed" else {})}
                        for s in plan["sources"]]}
                    atomic_json(commits_path, commits)
                current_stage = "publish"
                await command("finalize", "--id", edition_id, "--receipts", str(commits_path), "--attempt", attempt_id)
                state = "published"
            if state == "telegram-committed":
                # Finalize succeeded but the process stopped before its stage receipt.
                current_stage = "publish"
                await command("finalize", "--id", edition_id, "--receipts", str(run / "completion-commits.json"), "--attempt", attempt_id)
                state = "published"
            if state == "published":
                current_stage = "notification"
                await command("notify-release", "--id", edition_id, "--attempt", attempt_id)
            current_stage = "verification"
            return await command("assert-complete", "--id", edition_id, "--attempt", attempt_id)
        try:
            result = await asyncio.wait_for(execute(), timeout=900)
            atomic_json(run / "completion-progress.json", {"stage":"notified", "complete":True})
            return result
        except (Exception, asyncio.CancelledError) as error:
            code = str(error) if isinstance(error, CompletionFailure) else "completion_" + current_stage + "_failed"
            atomic_json(run / "completion-progress.json", {"stage":current_stage, "complete":False, "errorCode":code})
            # Preserve published state for the notifier-only guard. Never report
            # success just because the model or transport finished its turn.
            status = await command("attempt-status", "--attempt", attempt_id)
            if status["attempt"]["state"] not in {"published", "notified", "failed", "skipped"}:
                await command("advance-attempt", "--attempt", attempt_id, "--stage", "failed", "--error-code", code)
            if isinstance(error, asyncio.CancelledError):
                raise
            return {"ok":False, "editionId":edition_id, "stage":current_stage, "errorCode":code}
    finally:
        os.close(descriptor)
