"""Native Discord component bridge for Kurami Dev Orchestrator controls."""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo


CONTROL_ID = re.compile(
    r"^kurami:(status|take_control|preview_start|preview_stop|stop|discard_prompt|discard_local|discard_published_prompt|discard_published|ci_repair|ai_review|review_fix):(r_[A-Za-z0-9_]+)$"
)
METADATA_CONTROL_ID = re.compile(
    r"^kurami:metadata_(details|accept|skip|discuss|exclude|restore|retry):(pmb_[a-f0-9]+)$"
)

_ACTION_LABELS = {
    "take_control": "Take control",
    "preview_start": "Start preview",
    "preview_stop": "Stop preview",
    "stop": "Cancel run",
    "discard_local": "Discard local work",
    "discard_published": "Close draft PR and discard published work",
    "ci_repair": "Attempt CI fix",
    "ai_review": "AI Code Review",
    "review_fix": "Fix Review",
}

_METADATA_DISCUSSION_INTRO = (
    "Discuss this metadata proposal batch here. Discussion is advisory and never "
    "changes SQLite or GitHub. Use Review proposals on the digest card to exclude "
    "an item, then Accept or Skip the batch. The thread is archived after a batch decision."
)


def discard_confirmation_id(run_id: str) -> str:
    """Return the exact allowlisted destructive-confirmation component ID."""

    if not re.fullmatch(r"r_[A-Za-z0-9_]+", run_id):
        raise ValueError("Invalid run ID")
    return f"kurami:discard_local:{run_id}"


def published_discard_confirmation_id(run_id: str) -> str:
    """Return the exact allowlisted published-discard confirmation ID."""

    if not re.fullmatch(r"r_[A-Za-z0-9_]+", run_id):
        raise ValueError("Invalid run ID")
    return f"kurami:discard_published:{run_id}"


def parse_control_id(custom_id: object) -> Optional[tuple[str, str]]:
    """Return an allowlisted ``(action, run_id)`` pair or ``None``."""

    if not isinstance(custom_id, str):
        return None
    match = CONTROL_ID.fullmatch(custom_id)
    if match is None:
        return None
    return match.group(1), match.group(2)


def parse_metadata_control_id(custom_id: object) -> Optional[tuple[str, str]]:
    """Return an allowlisted metadata ``(action, batch_id)`` pair or ``None``."""

    if not isinstance(custom_id, str):
        return None
    match = METADATA_CONTROL_ID.fullmatch(custom_id)
    if match is None:
        return None
    return match.group(1), match.group(2)


def _paths() -> tuple[Path, Path, Path]:
    home = Path(
        os.environ.get(
            "ORCHESTRATOR_HOME",
            "/home/shagon1k/_hermes/_orchestrator",
        )
    ).resolve()
    return (
        home / "runtime/node/bin/node",
        home / "app/src/run-controls.ts",
        home / "app/src/notify-discord-controls.ts",
    )


def _metadata_paths() -> tuple[Path, Path, Path]:
    home = Path(
        os.environ.get(
            "ORCHESTRATOR_HOME",
            "/home/shagon1k/_hermes/_orchestrator",
        )
    ).resolve()
    return (
        home / "runtime/node/bin/node",
        home / "app/src/metadata-proposal-controls.ts",
        home / "app/src/notify-discord-digest.ts",
    )


async def _run_metadata_control(
    action: str,
    batch_id: str,
    proposal_ids: Optional[list[str]] = None,
    thread_id: Optional[str] = None,
) -> dict[str, Any]:
    node, control, _ = _metadata_paths()
    if not node.is_file() or not control.is_file():
        raise RuntimeError("Kurami metadata control runtime is unavailable")
    args = [str(node), str(control), action, "--batch-id", batch_id]
    for proposal_id in proposal_ids or []:
        if not re.fullmatch(r"pmp_[a-f0-9]+", proposal_id):
            raise RuntimeError("Invalid metadata proposal selection")
        args.extend(["--proposal-id", proposal_id])
    if thread_id is not None:
        if not thread_id.isdigit():
            raise RuntimeError("Invalid Discord discussion thread ID")
        args.extend(["--thread-id", thread_id])
    if action != "status":
        args.append("--apply")
    env = dict(os.environ)
    env["ORCHESTRATOR_HOME"] = str(control.parents[2])
    process = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("Kurami metadata control timed out") from None
    output = stdout.decode("utf-8", errors="replace").strip()
    error = stderr.decode("utf-8", errors="replace").strip()
    last_line = next((line for line in reversed(output.splitlines()) if line), "")
    try:
        payload = json.loads(last_line) if last_line else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError("Kurami metadata control returned invalid output") from exc
    if process.returncode != 0 or not payload.get("ok"):
        message = payload.get("error") or error or "Kurami metadata control failed"
        raise RuntimeError(str(message)[:400])
    return payload


async def _refresh_digest(project: str) -> None:
    node, control, notifier = _metadata_paths()
    if not node.is_file() or not notifier.is_file():
        raise RuntimeError("Kurami Projects Digest notifier is unavailable")
    env = dict(os.environ)
    env["ORCHESTRATOR_HOME"] = str(control.parents[2])
    process = await asyncio.create_subprocess_exec(
        str(node),
        str(notifier),
        "--project",
        project,
        "--apply",
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=15)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("Kurami Projects Digest refresh timed out") from None
    if process.returncode != 0:
        error = stderr.decode("utf-8", errors="replace").strip()
        output = stdout.decode("utf-8", errors="replace").strip()
        raise RuntimeError(error or output or "Kurami Projects Digest refresh failed")


def _metadata_details_message(payload: dict[str, Any]) -> str:
    counts = payload.get("counts") or {}
    state = str(payload.get("batchState") or "")
    if state in {"applied", "partially_applied", "failed"}:
        return (
            f"**Review sync result · {payload.get('project')} · batch {payload.get('batchNumber')}**\n"
            f"{counts.get('applied', 0)} applied · {counts.get('conflicted', 0)} owner values preserved · "
            f"{counts.get('failed', 0)} failed."
        )
    if state == "accepted":
        return (
            f"**Review approved batch · {payload.get('project')} · batch {payload.get('batchNumber')}**\n"
            f"{counts.get('accepted', 0)} approved · guarded GitHub sync "
            f"{payload.get('syncState') or 'queued'}."
        )
    return (
        f"**Review proposals · {payload.get('project')} · batch {payload.get('batchNumber')}**\n"
        f"{counts.get('pending', 0)} pending · {counts.get('skipped', 0)} excluded. "
        "Select only proposals that should be excluded, or restore an accidental exclusion. "
        "Nothing is written to GitHub."
    )


def _metadata_details_embeds(payload: dict[str, Any]) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for proposal in payload.get("proposals") or []:
        state = str(proposal.get("state") or "unknown")
        marker = (
            "✅"
            if state in {"accepted", "applied"}
            else "⚠️"
            if state == "conflicted"
            else "❌"
            if state == "failed"
            else "↩️"
            if state == "skipped"
            else "📋"
        )
        title = str(proposal.get("title") or "")[:180]
        reason = str(proposal.get("reason") or "")[:450]
        url = str(proposal.get("url") or "")
        title_line = f"[{title}]({url})" if url.startswith("https://") else title
        result = ""
        if state == "applied":
            result = f"\nApplied: {proposal.get('appliedValue')}"
        elif state == "conflicted":
            result = f"\nPreserved current value: {proposal.get('previousValue')}"
        elif state == "failed" and proposal.get("failureReason"):
            result = f"\nFailed: {str(proposal.get('failureReason'))[:250]}"
        fields.append(
            {
                "name": (
                    f"{marker} #{proposal.get('issueNumber')} · "
                    f"{proposal.get('field')} → {proposal.get('proposedValue')} · "
                    f"{proposal.get('confidence')}"
                )[:256],
                "value": f"{title_line}\n{reason}{result}"[:1024],
                "inline": False,
            }
        )
    return [
        {
            "title": "Metadata proposal batch",
            "description": str(payload.get("summary") or "Owner review required.")[:500],
            "color": 0x5865F2,
            "fields": fields[:25],
            "footer": {
                "text": (
                    "Guarded sync preserves owner-authored GitHub values."
                    if str(payload.get("batchState") or "")
                    in {"applied", "partially_applied", "failed"}
                    else "Accept remaining approves only SQLite state; GitHub remains unchanged."
                )
            },
        }
    ]


def _metadata_embed_objects(payload: dict[str, Any]) -> list[Any]:
    import discord

    return [discord.Embed.from_dict(embed) for embed in _metadata_details_embeds(payload)]


async def _metadata_review_view(payload: dict[str, Any]) -> Any:
    import discord

    view = discord.ui.View(timeout=300)
    pending = [
        proposal
        for proposal in payload.get("proposals") or []
        if proposal.get("state") == "pending"
    ][:25]
    if pending and payload.get("batchState") in {"ready", "discussing"}:
        options = []
        for proposal in pending:
            title = str(proposal.get("title") or "")
            options.append(
                discord.SelectOption(
                    label=(
                        f"#{proposal.get('issueNumber')} · "
                        f"{proposal.get('field')} → {proposal.get('proposedValue')}"
                    )[:100],
                    description=title[:100] or "Exclude this proposal",
                    value=str(proposal.get("proposalId")),
                )
            )
        view.add_item(
            discord.ui.Select(
                custom_id=f"kurami:metadata_exclude:{payload.get('batchId')}",
                placeholder="Exclude selected proposals from this batch",
                min_values=1,
                max_values=len(options),
                options=options,
            )
        )
    skipped = [
        proposal
        for proposal in payload.get("proposals") or []
        if proposal.get("state") == "skipped"
    ][:25]
    if skipped and payload.get("batchState") in {"ready", "discussing"}:
        options = []
        for proposal in skipped:
            title = str(proposal.get("title") or "")
            options.append(
                discord.SelectOption(
                    label=(
                        f"#{proposal.get('issueNumber')} · "
                        f"{proposal.get('field')} → {proposal.get('proposedValue')}"
                    )[:100],
                    description=title[:100] or "Restore this proposal",
                    value=str(proposal.get("proposalId")),
                )
            )
        view.add_item(
            discord.ui.Select(
                custom_id=f"kurami:metadata_restore:{payload.get('batchId')}",
                placeholder="Restore excluded proposals",
                min_values=1,
                max_values=len(options),
                options=options,
            )
        )
    if pending and payload.get("batchState") in {"ready", "discussing"}:
        view.add_item(
            discord.ui.Button(
                custom_id=f"kurami:metadata_accept:{payload.get('batchId')}",
                label="Accept remaining",
                style=discord.ButtonStyle.success,
            )
        )
    return view


async def _archive_metadata_thread(client: Any, thread_id: object) -> bool:
    if not isinstance(thread_id, str) or not thread_id.isdigit():
        return False
    try:
        thread = client.get_channel(int(thread_id)) or await client.fetch_channel(
            int(thread_id)
        )
        await thread.edit(archived=True, reason="Kurami metadata batch decided")
        return True
    except Exception:
        return False


def _metadata_updates_source_message(action: str, message_flags: object) -> bool:
    return action == "accept" and bool(getattr(message_flags, "ephemeral", False))


async def _run_control(action: str, run_id: str) -> dict[str, Any]:
    node, control, _ = _paths()
    if not node.is_file() or not control.is_file():
        raise RuntimeError("Kurami control runtime is unavailable")

    args = [str(node), str(control), "status", "--run-id", run_id]
    if action != "status":
        args = [
            str(node),
            str(control),
            "request",
            "--run-id",
            run_id,
            "--action",
            action,
            "--via",
            "discord",
            "--apply",
        ]

    env = dict(os.environ)
    env["ORCHESTRATOR_HOME"] = str(control.parents[2])
    process = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("Kurami control request timed out") from None

    output = stdout.decode("utf-8", errors="replace").strip()
    error = stderr.decode("utf-8", errors="replace").strip()
    last_line = next((line for line in reversed(output.splitlines()) if line), "")
    try:
        payload = json.loads(last_line) if last_line else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError("Kurami control returned invalid output") from exc
    if process.returncode != 0 or not payload.get("ok"):
        message = payload.get("error") or error or "Kurami control request failed"
        raise RuntimeError(str(message)[:400])
    return payload


async def _refresh_control_card(run_id: str) -> None:
    node, control, notifier = _paths()
    if not node.is_file() or not notifier.is_file():
        raise RuntimeError("Kurami Discord notifier is unavailable")
    env = dict(os.environ)
    env["ORCHESTRATOR_HOME"] = str(control.parents[2])
    process = await asyncio.create_subprocess_exec(
        str(node),
        str(notifier),
        "show",
        "--run-id",
        run_id,
        "--apply",
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=15)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("Kurami card refresh timed out") from None
    if process.returncode != 0:
        error = stderr.decode("utf-8", errors="replace").strip()
        output = stdout.decode("utf-8", errors="replace").strip()
        raise RuntimeError(error or output or "Kurami card refresh failed")


def _status_message(payload: dict[str, Any]) -> str:
    issue = payload.get("issue_number")
    project = str(payload.get("project") or "run")
    state = str(payload.get("state") or "unknown")
    owner = str(payload.get("owner_state") or "none")
    preview = payload.get("preview_url")
    captured = datetime.now(ZoneInfo("Europe/Vilnius")).strftime("%d.%m.%y %H:%M")
    lines = [
        f"**Status snapshot · {project} #{issue}**",
        f"Captured: {captured}",
        f"State: `{state}` · owner: `{owner}`",
    ]
    if preview:
        lines.append(f"Preview: {preview}")
    if payload.get("issue_url"):
        lines.append(f"Issue: {payload['issue_url']}")
    return "\n".join(lines)


def _request_message(action: str, payload: dict[str, Any]) -> str:
    request_state = payload.get("requestState") or payload.get("request_state")
    if payload.get("action") == "existing":
        return f"{_ACTION_LABELS[action]} is already queued (`{request_state}`)."
    return f"{_ACTION_LABELS[action]} queued. The live card will update after reconciliation."


def install_control_listener(
    client: Any,
    authorized: Callable[[Any], bool],
) -> None:
    """Attach exactly one listener to an existing Hermes Discord client."""

    if getattr(client, "_kurami_control_listener_installed", False):
        return

    async def on_interaction(interaction: Any) -> None:
        data = getattr(interaction, "data", None)
        custom_id = data.get("custom_id") if isinstance(data, dict) else None
        metadata_parsed = parse_metadata_control_id(custom_id)
        parsed = parse_control_id(custom_id)
        if metadata_parsed is not None:
            action, batch_id = metadata_parsed
            if not authorized(interaction):
                if not interaction.response.is_done():
                    await interaction.response.send_message(
                        "This Kurami metadata control is not authorized for your account.",
                        ephemeral=True,
                    )
                return
            if action == "details":
                try:
                    payload = await _run_metadata_control("status", batch_id)
                    view = await _metadata_review_view(payload)
                    await interaction.response.send_message(
                        _metadata_details_message(payload),
                        embeds=_metadata_embed_objects(payload),
                        view=view,
                        ephemeral=True,
                    )
                except Exception as exc:
                    await interaction.response.send_message(
                        f"Metadata review could not be opened safely: {str(exc)[:350]}",
                        ephemeral=True,
                    )
                return
            if action in {"exclude", "restore"}:
                if not interaction.response.is_done():
                    await interaction.response.defer(ephemeral=True)
                try:
                    values = data.get("values") if isinstance(data, dict) else None
                    if not isinstance(values, list):
                        raise RuntimeError("No metadata proposals were selected")
                    payload = await _run_metadata_control(
                        action, batch_id, [str(value) for value in values]
                    )
                    fresh = await _run_metadata_control("status", batch_id)
                    view = await _metadata_review_view(fresh)
                    verb = "Excluded" if action == "exclude" else "Restored"
                    message = (
                        f"{verb} {payload.get('proposals')} proposals. "
                        f"{payload.get('remaining')} remain pending. GitHub is unchanged.\n\n"
                        f"{_metadata_details_message(fresh)}"
                    )
                    await interaction.edit_original_response(
                        content=message[:1950],
                        embeds=_metadata_embed_objects(fresh),
                        view=view,
                    )
                    project = str(fresh.get("project") or "")
                    if project:
                        await _refresh_digest(project)
                except Exception as exc:
                    await interaction.edit_original_response(
                        content=(
                            "Metadata selection was rejected safely: "
                            f"{str(exc)[:400]}"
                        ),
                        embeds=[],
                        view=None,
                    )
                return
            message_flags = getattr(getattr(interaction, "message", None), "flags", None)
            updates_source = _metadata_updates_source_message(action, message_flags)
            if not interaction.response.is_done():
                if updates_source:
                    await interaction.response.defer()
                else:
                    await interaction.response.defer(ephemeral=True, thinking=True)
            try:
                if action == "discuss":
                    payload = await _run_metadata_control("discuss", batch_id)
                    thread_id = payload.get("discussionThreadId")
                    if isinstance(thread_id, str) and thread_id.isdigit():
                        thread = client.get_channel(int(thread_id)) or await client.fetch_channel(
                            int(thread_id)
                        )
                        await thread.edit(archived=False, locked=False)
                    else:
                        thread = await interaction.message.create_thread(
                            name=(
                                f"{payload.get('project')} · metadata batch "
                                f"{payload.get('batchNumber')}"
                            )[:100],
                            auto_archive_duration=1440,
                            reason="Owner requested Kurami metadata discussion",
                        )
                        await _run_metadata_control(
                            "record-thread", batch_id, thread_id=str(thread.id)
                        )
                        thread_id = str(thread.id)
                        await thread.send(_METADATA_DISCUSSION_INTRO)
                    message = f"Discussion opened: <#{thread_id}>"
                elif action == "accept":
                    before = await _run_metadata_control("status", batch_id)
                    thread_id = before.get("discussionThreadId")
                    archived = await _archive_metadata_thread(client, thread_id)
                    if isinstance(thread_id, str) and thread_id.isdigit() and not archived:
                        raise RuntimeError(
                            "The discussion thread could not be archived; the batch was not accepted"
                        )
                    payload = await _run_metadata_control("accept", batch_id)
                    if archived:
                        await _run_metadata_control("record-archive", batch_id)
                    message = (
                        f"Accepted {payload.get('proposals')} proposals. "
                        "GitHub is unchanged; guarded sync is the next stage."
                    )
                elif action == "retry":
                    payload = await _run_metadata_control("retry-sync", batch_id)
                    message = "Guarded metadata sync retry queued."
                else:
                    before = await _run_metadata_control("status", batch_id)
                    thread_id = before.get("discussionThreadId")
                    archived = await _archive_metadata_thread(client, thread_id)
                    if isinstance(thread_id, str) and thread_id.isdigit() and not archived:
                        raise RuntimeError(
                            "The discussion thread could not be archived; the batch was not skipped"
                        )
                    payload = await _run_metadata_control("skip", batch_id)
                    if archived:
                        await _run_metadata_control("record-archive", batch_id)
                    message = "Metadata proposal batch skipped. GitHub is unchanged."
                project = str(payload.get("project") or "")
                if not project:
                    status_payload = await _run_metadata_control("status", batch_id)
                    project = str(status_payload.get("project") or "")
                if project:
                    await _refresh_digest(project)
            except Exception as exc:
                message = f"Metadata control rejected safely: {str(exc)[:400]}"
            if updates_source:
                await interaction.edit_original_response(
                    content=message,
                    embeds=[],
                    view=None,
                )
            else:
                await interaction.followup.send(message, ephemeral=True)
            return
        if parsed is None:
            return

        action, run_id = parsed
        if not authorized(interaction):
            if not interaction.response.is_done():
                await interaction.response.send_message(
                    "This Kurami control is not authorized for your account.",
                    ephemeral=True,
                )
            return

        if action == "discard_prompt":
            try:
                import discord

                view = discord.ui.View(timeout=120)
                view.add_item(
                    discord.ui.Button(
                        label="Discard preserved local work",
                        style=discord.ButtonStyle.danger,
                        custom_id=discard_confirmation_id(run_id),
                    )
                )
                await interaction.response.send_message(
                    "This permanently deletes the unpublished managed worktree "
                    "and local branch. Published commits or remote branches are "
                    "refused by the orchestrator. Confirm only if the preserved "
                    "local result is no longer needed.",
                    view=view,
                    ephemeral=True,
                )
            except Exception as exc:
                if not interaction.response.is_done():
                    await interaction.response.send_message(
                        f"Confirmation could not be opened safely: {str(exc)[:300]}",
                        ephemeral=True,
                    )
            return

        if action == "discard_published_prompt":
            try:
                import discord

                view = discord.ui.View(timeout=120)
                view.add_item(
                    discord.ui.Button(
                        label="Close draft PR & discard",
                        style=discord.ButtonStyle.danger,
                        custom_id=published_discard_confirmation_id(run_id),
                    )
                )
                await interaction.response.send_message(
                    "This closes only the exact open Draft PR created for this "
                    "managed run, deletes its matching remote branch, worktree, "
                    "and local branch, then returns the issue to Backlog. Merged "
                    "PRs, non-draft PRs, mismatched heads, and dirty worktrees are "
                    "refused. Confirm only if the published result is no longer needed.",
                    view=view,
                    ephemeral=True,
                )
            except Exception as exc:
                if not interaction.response.is_done():
                    await interaction.response.send_message(
                        f"Confirmation could not be opened safely: {str(exc)[:300]}",
                        ephemeral=True,
                    )
            return

        if not interaction.response.is_done():
            await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            payload = await _run_control(action, run_id)
            message = (
                _status_message(payload)
                if action == "status"
                else _request_message(action, payload)
            )
        except Exception as exc:
            message = f"Control rejected safely: {str(exc)[:400]}"
        await interaction.followup.send(message, ephemeral=True)
        if action != "status" and message.startswith(_ACTION_LABELS[action]):
            try:
                await _refresh_control_card(run_id)
            except Exception:
                # The durable request remains authoritative. The minute controller
                # and notifier tick are the fallback if this fast refresh fails.
                pass

    client.add_listener(on_interaction, "on_interaction")
    client._kurami_control_listener_installed = True
