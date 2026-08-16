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
    r"^kurami:(status|take_control|preview_start|preview_stop|stop):(r_[A-Za-z0-9_]+)$"
)

_ACTION_LABELS = {
    "take_control": "Take control",
    "preview_start": "Start preview",
    "preview_stop": "Stop preview",
    "stop": "Cancel run",
}


def parse_control_id(custom_id: object) -> Optional[tuple[str, str]]:
    """Return an allowlisted ``(action, run_id)`` pair or ``None``."""

    if not isinstance(custom_id, str):
        return None
    match = CONTROL_ID.fullmatch(custom_id)
    if match is None:
        return None
    return match.group(1), match.group(2)


def _paths() -> tuple[Path, Path]:
    home = Path(
        os.environ.get(
            "ORCHESTRATOR_HOME",
            "/home/shagon1k/_hermes/_orchestrator",
        )
    ).resolve()
    return home / "runtime/node/bin/node", home / "app/src/run-controls.ts"


async def _run_control(action: str, run_id: str) -> dict[str, Any]:
    node, control = _paths()
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
        parsed = parse_control_id(data.get("custom_id") if isinstance(data, dict) else None)
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

    client.add_listener(on_interaction, "on_interaction")
    client._kurami_control_listener_installed = True
