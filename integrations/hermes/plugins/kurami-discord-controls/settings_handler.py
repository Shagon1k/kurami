"""Owner-only Discord UI for bounded Kurami runtime settings."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional


_PROJECT = re.compile(r"^[a-z0-9-]+$")
_MUTATIONS = {"apply", "reset", "rollback"}
_COMPOSIO_TOOLKIT = re.compile(r"^[a-z0-9_]+$")
_COMPOSIO_TOOL = re.compile(r"^[A-Z][A-Z0-9_]+$")
_COMPOSIO_FIELD = re.compile(r"^[a-z0-9_.-]+$")
_COMPOSIO_SAFE_VALUE = re.compile(r"^[A-Za-z0-9_. ,+%-]*$")
_COMPOSIO_CONTOURS = ("broad", "read", "automation")
_COMPOSIO_CONTOUR_LABELS = {
    "broad": "Broad",
    "read": "Read-only",
    "automation": "Automation",
}
_COMPOSIO_CONTOUR_DESCRIPTIONS = {
    "broad": "Interactive capabilities; writes require approval",
    "read": "Autonomous ingestion; read-only leaf tools",
    "automation": "Autonomous writes; trust: full; exact pre-approved allowlist",
}


def _kurami_home() -> Path:
    return Path(
        os.environ.get("KURAMI_HOME")
        or "/home/shagon1k/_hermes/_kurami"
    ).absolute()


def _settings_subprocess_env(*, include_hermes: bool = False) -> dict[str, str]:
    home = str(_kurami_home())
    env = {
        "KURAMI_HOME": home,
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "NODE_NO_WARNINGS": "1",
    }
    if include_hermes:
        env["HERMES_HOME"] = os.environ.get(
            "HERMES_HOME", "/home/shagon1k/_hermes/_core"
        )
    return env


def _paths() -> tuple[Path, Path]:
    home = _kurami_home()
    return (
        home / "runtime/node/bin/node",
        home / "app/src/orchestrator/settings/orchestrator-settings.ts",
    )


def _health_paths() -> tuple[Path, Path]:
    home = _kurami_home()
    return (
        home / "runtime/node/bin/node",
        home / "app/src/system/health/health-settings.ts",
    )


def _integer(value: object, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise RuntimeError(f"{name} must be an integer")
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


@lru_cache(maxsize=1)
def _schema() -> dict[str, Any]:
    path = _kurami_home() / "app/src/orchestrator/settings/settings-schema.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("version") != 1:
        raise RuntimeError("Unsupported Kurami settings schema")
    return value


def _field(name: str) -> dict[str, Any]:
    return next(field for field in _schema()["fields"] if field["name"] == name)


def _field_label(name: str) -> str:
    field = _schema()["projectWip"] if name.startswith("project:") else _field(name)
    label = f"WIP {name.removeprefix('project:')}" if name.startswith("project:") else field["label"]["en"]
    return f"{label} ({field['min']}-{field['max']})"


def _validated_settings(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeError("Kurami settings payload is invalid")
    project_wip = value.get("project_wip")
    if not isinstance(project_wip, dict) or not project_wip:
        raise RuntimeError("Kurami project WIP payload is invalid")
    projects: dict[str, int] = {}
    for project, limit in sorted(project_wip.items()):
        if not isinstance(project, str) or _PROJECT.fullmatch(project) is None:
            raise RuntimeError("Kurami settings contain an invalid project")
        field = _schema()["projectWip"]
        projects[project] = _integer(limit, f"WIP {project}", field["min"], field["max"])
    settings = {
        "version": 1,
        **{field["name"]: _integer(value.get(field["name"]), field["label"]["en"], field["min"], field["max"]) for field in _schema()["fields"]},
        "project_wip": projects,
    }
    for rule in _schema()["constraints"]:
        if rule["left"] == "project_wip.*":
            for project, value in projects.items():
                if value > settings[rule["right"]]:
                    raise RuntimeError(rule["message"].replace("{project}", project))
        elif settings[rule["left"]] > settings[rule["right"]]:
            raise RuntimeError(rule["message"])
    return settings


def _control_args(
    action: str,
    actor_id: Optional[str] = None,
    expected_revision: Optional[int] = None,
    settings: Optional[dict[str, Any]] = None,
) -> list[str]:
    if action != "status" and action not in _MUTATIONS:
        raise RuntimeError("Invalid Kurami settings action")
    node, control = _paths()
    if not node.is_file() or not control.is_file():
        raise RuntimeError("Kurami settings runtime is unavailable")
    args = [str(node), str(control), action]
    if action == "status":
        return args
    if not actor_id or not actor_id.isdigit() or expected_revision is None:
        raise RuntimeError("Kurami settings mutation has no owner or revision")
    args.extend(
        [
            "--expected-revision",
            str(expected_revision),
            "--actor-id",
            actor_id,
            "--via",
            "discord",
        ]
    )
    if action == "apply":
        validated = _validated_settings(settings)
        for field in _schema()["fields"]:
            if field["group"] != "previews":
                args.extend([field["flag"], str(validated[field["name"]])])
        for project, limit in validated["project_wip"].items():
            args.extend([_schema()["projectWip"]["flag"], f"{project}={limit}"])
        for field in _schema()["fields"]:
            if field["group"] == "previews":
                args.extend([field["flag"], str(validated[field["name"]])])
    return args


async def _run_settings_control(
    action: str,
    actor_id: Optional[str] = None,
    expected_revision: Optional[int] = None,
    settings: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    args = _control_args(action, actor_id, expected_revision, settings)
    process = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_settings_subprocess_env(),
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("Kurami settings request timed out") from None
    output = stdout.decode("utf-8", errors="replace").strip()
    error = stderr.decode("utf-8", errors="replace").strip()
    last_line = next((line for line in reversed(output.splitlines()) if line), "")
    try:
        payload = json.loads(last_line) if last_line else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError("Kurami settings returned invalid output") from exc
    if process.returncode != 0 or not payload.get("ok"):
        message = payload.get("error") or error or "Kurami settings request failed"
        raise RuntimeError(str(message)[:500])
    _validated_settings(payload.get("settings"))
    if not isinstance(payload.get("revision"), int):
        raise RuntimeError("Kurami settings returned no revision")
    return payload


async def _run_health_settings_control(
    action: str,
    actor_id: Optional[str] = None,
    expected_revision: Optional[int] = None,
    minutes: Optional[int] = None,
) -> dict[str, Any]:
    if action not in {"status", "apply"}:
        raise RuntimeError("Invalid Kurami health settings action")
    node, control = _health_paths()
    if not node.is_file() or not control.is_file():
        raise RuntimeError("Kurami health settings runtime is unavailable")
    args = [str(node), str(control), action]
    if action == "apply":
        if (
            not actor_id
            or not actor_id.isdigit()
            or expected_revision is None
            or minutes not in _schema()["health"]["allowedIntervals"]
        ):
            raise RuntimeError("Kurami health settings mutation is invalid")
        args.extend(
            [
                "--minutes", str(minutes),
                "--expected-revision", str(expected_revision),
                "--actor-id", actor_id,
            ]
        )
    process = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_settings_subprocess_env(include_hermes=True),
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=20)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("Kurami health settings request timed out") from None
    output = stdout.decode("utf-8", errors="replace").strip()
    error = stderr.decode("utf-8", errors="replace").strip()
    last_line = next((line for line in reversed(output.splitlines()) if line), "")
    try:
        payload = json.loads(last_line) if last_line else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError("Kurami health settings returned invalid output") from exc
    if process.returncode != 0 or not payload.get("ok"):
        message = payload.get("error") or error or "Kurami health settings failed"
        raise RuntimeError(str(message)[:500])
    if (
        not isinstance(payload.get("revision"), int)
        or payload.get("intervalMinutes") not in _schema()["health"]["allowedIntervals"]
    ):
        raise RuntimeError("Kurami health settings payload is invalid")
    return payload


def _composio_path() -> Path:
    return _kurami_home() / "app/bin/kurami-composio-session"


def _composio_args(action: str, contour: str) -> list[str]:
    if action not in {"check", "apply"}:
        raise RuntimeError("Invalid Composio Session action")
    if contour not in _COMPOSIO_CONTOURS:
        raise RuntimeError("Invalid Composio capability contour")
    control = _composio_path()
    if not control.is_file():
        raise RuntimeError("Composio Session control is unavailable")
    return [str(control), action, "--contour", contour, "--json"]


def _safe_composio_scalar(value: object) -> object:
    if value is None or isinstance(value, (bool, int)):
        return value
    if not isinstance(value, str) or len(value) > 120:
        raise RuntimeError("Composio Session diff contains an invalid value")
    if _COMPOSIO_SAFE_VALUE.fullmatch(value) is None:
        raise RuntimeError("Composio Session diff contains a private value")
    lowered = value.lower()
    if "ca_" in lowered or "trs_" in lowered or "api_key" in lowered:
        raise RuntimeError("Composio Session diff contains a private identifier")
    return value


def _validated_composio_payload(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("ok") is not True:
        raise RuntimeError("Composio Session payload is invalid")
    mode = value.get("mode")
    contour = value.get("contour")
    changed = value.get("changed")
    config_version = value.get("configVersion")
    raw_tools = value.get("tools")
    raw_diff = value.get("diff")
    if (
        mode not in {"check", "apply"}
        or contour not in _COMPOSIO_CONTOURS
        or not isinstance(changed, bool)
        or isinstance(config_version, bool)
        or (config_version is not None and not isinstance(config_version, int))
        or not isinstance(raw_tools, list)
        or len(raw_tools) > 100
        or not isinstance(raw_diff, list)
        or len(raw_diff) > 100
    ):
        raise RuntimeError("Composio Session status is invalid")
    tools = sorted(
        {
            tool
            for tool in raw_tools
            if isinstance(tool, str) and _COMPOSIO_TOOL.fullmatch(tool) is not None
        }
    )
    if len(tools) != len(raw_tools):
        raise RuntimeError("Composio Session tool inventory is invalid")
    diff: list[dict[str, object]] = []
    for raw_entry in raw_diff:
        if not isinstance(raw_entry, dict):
            raise RuntimeError("Composio Session diff is invalid")
        kind = raw_entry.get("kind")
        field = raw_entry.get("field")
        if (
            kind not in {"add", "remove", "change"}
            or not isinstance(field, str)
            or _COMPOSIO_FIELD.fullmatch(field) is None
        ):
            raise RuntimeError("Composio Session diff entry is invalid")
        entry: dict[str, object] = {"kind": kind, "field": field}
        if "before" in raw_entry:
            entry["before"] = _safe_composio_scalar(raw_entry.get("before"))
        if "after" in raw_entry:
            entry["after"] = _safe_composio_scalar(raw_entry.get("after"))
        diff.append(entry)
    if changed is not bool(diff):
        raise RuntimeError("Composio Session changed state does not match its diff")

    counts: dict[str, dict[str, int]] = {}
    for key in ("activeAccountCounts", "selectedAccountCounts"):
        raw_counts = value.get(key)
        if not isinstance(raw_counts, dict):
            raise RuntimeError("Composio Session account counts are invalid")
        normalized: dict[str, int] = {}
        for toolkit, count in raw_counts.items():
            if (
                not isinstance(toolkit, str)
                or _COMPOSIO_TOOLKIT.fullmatch(toolkit) is None
                or isinstance(count, bool)
                or not isinstance(count, int)
                or count < 0
                or count > 100
            ):
                raise RuntimeError("Composio Session account count is invalid")
            normalized[toolkit] = count
        counts[key] = normalized
    warnings = value.get("warnings")
    if not isinstance(warnings, list) or warnings:
        # Runtime warnings can mention environment-variable names. Keep the
        # Discord surface fail-closed until each warning type has explicit UX.
        raise RuntimeError("Composio Session requires operator review in the CLI")
    return {
        "ok": True,
        "mode": mode,
        "contour": contour,
        "changed": changed,
        "configVersion": config_version,
        "tools": tools,
        "diff": diff,
        **counts,
        "warnings": [],
    }


async def _run_composio_control(action: str, contour: str) -> dict[str, Any]:
    process = await asyncio.create_subprocess_exec(
        *_composio_args(action, contour),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_settings_subprocess_env(),
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=30)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("Composio Session request timed out") from None
    output = stdout.decode("utf-8", errors="replace").strip()
    error = stderr.decode("utf-8", errors="replace").strip()
    last_line = next((line for line in reversed(output.splitlines()) if line), "")
    try:
        payload = json.loads(last_line) if last_line else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError("Composio Session returned invalid output") from exc
    allowed_return_codes = {0, 2} if action == "check" else {0}
    if process.returncode not in allowed_return_codes or not payload.get("ok"):
        message = payload.get("error") or error or "Composio Session request failed"
        raise RuntimeError(str(message)[:500])
    validated = _validated_composio_payload(payload)
    if validated["mode"] != action:
        raise RuntimeError("Composio Session returned the wrong operation mode")
    if validated["contour"] != contour:
        raise RuntimeError("Composio Session returned the wrong capability contour")
    return validated


def _composio_diff_signature(payload: dict[str, Any]) -> str:
    validated = _validated_composio_payload(payload)
    canonical = json.dumps(
        {
            "contour": validated["contour"],
            "configVersion": validated["configVersion"],
            "tools": validated["tools"],
            "diff": validated["diff"],
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _composio_message(payload: dict[str, Any], notice: str = "") -> str:
    status = _validated_composio_payload(payload)
    contour = str(status["contour"])
    selected = status["selectedAccountCounts"]
    config_version = status["configVersion"]
    lines = [
        f"## Composio · {_COMPOSIO_CONTOUR_LABELS[contour]}",
        "⚠️ **Changes require review**" if status["changed"] else "✅ **In sync**",
        _COMPOSIO_CONTOUR_DESCRIPTIONS[contour],
        (
            f"{len(selected)} toolkits · {sum(selected.values())} selected accounts"
            f" · config v{config_version if config_version is not None else '?'}"
        ),
    ]
    tools = status["tools"]
    if tools:
        lines.append(f"Tools · {', '.join(f'`{tool}`' for tool in tools[:6])}")
        if len(tools) > 6:
            lines.append(f"…and {len(tools) - 6} more tools. Use the CLI to review.")
    if notice:
        lines.extend(["", notice])
    diff = status["diff"]
    if diff:
        lines.extend(["", "### Proposed diff"])
        markers = {"add": "+", "remove": "−", "change": "~"}
        for entry in diff[:12]:
            marker = markers[str(entry["kind"])]
            if entry["kind"] == "add":
                detail = f"{entry['field']}: {entry.get('after')}"
            elif entry["kind"] == "remove":
                detail = f"{entry['field']}: {entry.get('before')}"
            else:
                detail = f"{entry['field']}: {entry.get('before')} → {entry.get('after')}"
            lines.append(f"`{marker}` {detail}")
        if len(diff) > 12:
            lines.append(f"…and {len(diff) - 12} more changes. Use the CLI to review.")
    else:
        lines.extend(["", "Desired state and the persistent Session match."])
    lines.extend(["", "-# Owner-only · no Session or MCP URL rotation"])
    return "\n".join(lines)[:3900]


def _build_composio_view(
    authorized: Callable[[Any], bool],
    payloads: dict[str, dict[str, Any]],
    actor_id: str,
) -> Any:
    import discord

    class ComposioView(discord.ui.LayoutView):
        def __init__(self) -> None:
            super().__init__(timeout=300)
            if set(payloads) != set(_COMPOSIO_CONTOURS):
                raise RuntimeError("Composio contour overview is incomplete")
            self.payloads = {
                contour: _validated_composio_payload(payloads[contour])
                for contour in _COMPOSIO_CONTOURS
            }
            for contour, status in self.payloads.items():
                if status["contour"] != contour:
                    raise RuntimeError("Composio contour overview is inconsistent")
            self.contour = "broad"
            self.actor_id = actor_id
            self.signatures = {
                contour: _composio_diff_signature(status)
                for contour, status in self.payloads.items()
            }
            self.notice = ""
            self._render()

        def _render(self) -> None:
            self.clear_items()
            payload = self.payloads[self.contour]
            contour_select = discord.ui.Select(
                custom_id="kurami:composio:contour",
                placeholder="Choose capability contour…",
                min_values=1,
                max_values=1,
                options=[
                    discord.SelectOption(
                        label=_COMPOSIO_CONTOUR_LABELS[contour],
                        value=contour,
                        description=_COMPOSIO_CONTOUR_DESCRIPTIONS[contour][:100],
                        default=contour == self.contour,
                    )
                    for contour in _COMPOSIO_CONTOURS
                ],
            )
            contour_select.callback = self._select_contour
            content: list[Any] = [
                discord.ui.TextDisplay(_composio_message(payload, self.notice)),
                discord.ui.Separator(),
                discord.ui.ActionRow(contour_select),
            ]
            if payload["changed"]:
                apply_button = discord.ui.Button(
                    label=f"Apply {_COMPOSIO_CONTOUR_LABELS[self.contour]} changes",
                    style=discord.ButtonStyle.success,
                    custom_id=f"kurami:composio:apply:{self.contour}",
                )
                apply_button.callback = self._apply
                content.extend([
                    discord.ui.ActionRow(apply_button),
                ])
            self.add_item(discord.ui.Container(*content, accent_color=0x5865F2))

        async def interaction_check(self, interaction: Any) -> bool:
            interaction_actor = str(
                getattr(getattr(interaction, "user", None), "id", "")
            )
            if interaction_actor != self.actor_id or not authorized(interaction):
                if not interaction.response.is_done():
                    await interaction.response.send_message(
                        "This Composio Session control is owner-only.", ephemeral=True
                    )
                return False
            return True

        async def _select_contour(self, interaction: Any) -> None:
            data = getattr(interaction, "data", None)
            values = data.get("values", []) if isinstance(data, dict) else []
            selected = str(values[0]) if values else ""
            if selected not in _COMPOSIO_CONTOURS:
                await interaction.response.send_message(
                    "Unknown Composio capability contour.", ephemeral=True
                )
                return
            self.contour = selected
            self.notice = ""
            self._render()
            await interaction.response.edit_message(view=self)

        async def _apply(self, interaction: Any) -> None:
            contour = self.contour
            expected_signature = self.signatures[contour]
            await interaction.response.defer()
            try:
                fresh = await _run_composio_control("check", contour)
                fresh_signature = _composio_diff_signature(fresh)
                if not fresh["changed"]:
                    self.payloads[contour] = fresh
                    self.signatures[contour] = fresh_signature
                    self.notice = "No changes remain; nothing was applied."
                elif fresh_signature != expected_signature:
                    self.payloads[contour] = fresh
                    self.signatures[contour] = fresh_signature
                    self.notice = (
                        "⚠️ The diff changed since this panel opened. Review it, then "
                        "press Apply again."
                    )
                else:
                    await _run_composio_control("apply", contour)
                    verified = await _run_composio_control("check", contour)
                    self.payloads[contour] = verified
                    self.signatures[contour] = _composio_diff_signature(verified)
                    self.notice = "✅ Changes applied and the Session was verified."
                self._render()
                await interaction.edit_original_response(view=self)
            except Exception as exc:
                self.notice = f"❌ Composio update rejected safely: {str(exc)[:350]}"
                self._render()
                await interaction.edit_original_response(view=self)

    return ComposioView()


def _settings_diff(
    current: dict[str, Any], proposed: dict[str, Any]
) -> list[tuple[str, int, int]]:
    before = _validated_settings(current)
    after = _validated_settings(proposed)
    labels = {field["name"]: field["label"]["en"] for field in _schema()["fields"]}
    result: list[tuple[str, int, int]] = []
    for key, label in labels.items():
        if before[key] != after[key]:
            result.append((label, before[key], after[key]))
    for project in sorted(set(before["project_wip"]) | set(after["project_wip"])):
        left = before["project_wip"].get(project, 0)
        right = after["project_wip"].get(project, 0)
        if left != right:
            result.append((f"WIP {project}", left, right))
    return result


def _settings_message(
    payload: dict[str, Any],
    proposed: Optional[dict[str, Any]] = None,
    notice: str = "",
    health: Optional[dict[str, Any]] = None,
) -> str:
    current = _validated_settings(payload.get("settings"))
    draft = _validated_settings(proposed or current)
    revision = int(payload.get("revision", 0))
    idle = payload.get("idle") if isinstance(payload.get("idle"), dict) else {}
    is_idle = idle.get("idle") is True
    def table(rows: list[tuple[str, object]]) -> str:
        return "\n".join(
            [
                "```text",
                *(
                    f"{label[:18]:<18}  {str(value)[:18]:<18}"
                    for label, value in rows
                ),
                "```",
            ]
        )

    capacity = [
        ("Concurrent LLM", f"{draft['max_llm_running_global']} / {_field('max_llm_running_global')['max']}"),
        ("Global WIP", draft["max_active_global"]),
        ("AI triage", f"{draft['ai_triage_daily']} / project/day"),
    ]
    capacity.extend(
        (f"WIP {project}", limit) for project, limit in draft["project_wip"].items()
    )
    lines = [
        "## Kurami settings",
        f"-# Revision {revision} · {payload.get('source', 'unknown')}",
        "### System Health",
        table(
            [
                (
                    "Check interval",
                    f"{int((health or {}).get('intervalMinutes', _schema()['health']['defaultIntervalMinutes']))} minutes",
                ),
            ]
        ),
        "### Project Orchestrator",
        "### Capacity",
        table(capacity),
        "### Previews",
        table(
            [
                ("Active", draft["max_previews_global"]),
                ("Concurrent builds", draft["max_preview_builds_global"]),
                ("Lifetime", f"{draft['preview_ttl_hours']}h"),
            ]
        ),
    ]
    diff = _settings_diff(current, draft)
    if diff:
        lines.append("### Pending changes")
        lines.extend(f"- **{label}** · {before} → {after}" for label, before, after in diff)
    if is_idle:
        lines.append("✅ **Changes allowed** · no active sessions")
    else:
        reasons = idle.get("reasons") if isinstance(idle.get("reasons"), list) else []
        detail = "; ".join(str(reason)[:120] for reason in reasons[:5]) or "runtime is busy"
        lines.append(f"🔒 **Changes locked** · {detail}")
    if notice:
        lines.extend(["", str(notice)[:500]])
    return "\n".join(lines)[:3900]


async def _send_audit(client: Any, payload: dict[str, Any], actor_id: str) -> Optional[str]:
    changes = payload.get("changes")
    if not isinstance(changes, list) or not changes:
        return None
    channel_id = str(payload.get("maintenanceChannelId") or "")
    if not channel_id.isdigit():
        return "maintenance audit channel is unavailable"
    lines = [
        f"⚙️ **Kurami settings · revision {payload.get('revision')}**",
        f"Owner: `{actor_id}` · action: `{payload.get('action')}`",
    ]
    for change in changes[:12]:
        if not isinstance(change, dict):
            continue
        name = str(change.get("name") or "setting")[:80]
        before = change.get("before")
        after = change.get("after")
        lines.append(f"- `{name}`: `{before}` → `{after}`")
    import discord

    last_error: Optional[Exception] = None
    for delay in (0.0, 0.5, 1.5):
        if delay:
            await asyncio.sleep(delay)
        try:
            channel = client.get_channel(int(channel_id)) or await client.fetch_channel(
                int(channel_id)
            )
            await channel.send(
                "\n".join(lines)[:1900],
                allowed_mentions=discord.AllowedMentions.none(),
            )
            return None
        except Exception as exc:  # pragma: no cover - transport-specific
            last_error = exc
    return f"settings applied, but Discord audit delivery failed: {type(last_error).__name__}"


def _build_settings_view(
    client: Any,
    authorized: Callable[[Any], bool],
    payload: dict[str, Any],
    health_payload: dict[str, Any],
    actor_id: str,
) -> Any:
    import discord

    class SettingsView(discord.ui.LayoutView):
        def __init__(self) -> None:
            super().__init__(timeout=300)
            self.payload = payload
            self.health_payload = health_payload
            self.draft = copy.deepcopy(_validated_settings(payload.get("settings")))
            self.actor_id = actor_id
            self.edit_select: Any = None
            self.notice = ""
            self._render()

        def _idle(self) -> bool:
            idle = self.payload.get("idle")
            return isinstance(idle, dict) and idle.get("idle") is True

        def _render(self) -> None:
            diff = bool(_settings_diff(self.payload["settings"], self.draft))
            self.clear_items()
            self.edit_select = discord.ui.Select(
                custom_id="kurami:settings:edit",
                placeholder="Choose settings section…",
                min_values=1,
                max_values=1,
                options=[
                    discord.SelectOption(
                        label="System Health", value="system_health",
                        description="Health check schedule",
                    ),
                    discord.SelectOption(
                        label="Capacity & WIP", value="capacity",
                        description="LLM and project limits",
                    ),
                    discord.SelectOption(
                        label="AI triage", value="triage",
                        description="Daily issue analysis limit",
                    ),
                    discord.SelectOption(
                        label="Previews", value="previews",
                        description="Slots, builds, and lifetime",
                    ),
                ],
            )
            self.edit_select.callback = self._edit
            apply_button = discord.ui.Button(
                label="Apply",
                style=discord.ButtonStyle.success,
                custom_id="kurami:settings:apply",
                disabled=not self._idle() or not diff,
            )
            apply_button.callback = self._apply
            undo_button = discord.ui.Button(
                label="Undo last",
                style=discord.ButtonStyle.secondary,
                custom_id="kurami:settings:undo",
                disabled=not self._idle() or int(self.payload.get("revision", 0)) == 0,
            )
            undo_button.callback = self._undo
            reset_button = discord.ui.Button(
                label="Reset defaults",
                style=discord.ButtonStyle.danger,
                custom_id="kurami:settings:reset",
                disabled=not self._idle() or not _settings_diff(
                    self.payload["settings"], self.payload["defaults"]
                ),
            )
            reset_button.callback = self._reset
            self.add_item(
                discord.ui.Container(
                    discord.ui.TextDisplay(
                        _settings_message(
                            self.payload,
                            self.draft,
                            self.notice,
                            self.health_payload,
                        )
                    ),
                    discord.ui.Separator(),
                    discord.ui.ActionRow(self.edit_select),
                    discord.ui.ActionRow(apply_button, undo_button, reset_button),
                    accent_color=0x5865F2,
                )
            )

        async def interaction_check(self, interaction: Any) -> bool:
            interaction_actor = str(
                getattr(getattr(interaction, "user", None), "id", "")
            )
            if interaction_actor != self.actor_id or not authorized(interaction):
                if not interaction.response.is_done():
                    await interaction.response.send_message(
                        "This Kurami settings panel is owner-only.", ephemeral=True
                    )
                return False
            return True

        async def _apply_action(
            self, interaction: Any, action: str, settings: Optional[dict[str, Any]] = None
        ) -> None:
            # This is an update to the existing ephemeral panel. A type-6 defer
            # keeps edit_original_response anchored to that source message.
            await interaction.response.defer()
            try:
                fresh = await _run_settings_control(
                    action,
                    actor_id=self.actor_id,
                    expected_revision=int(self.payload.get("revision", 0)),
                    settings=settings,
                )
                audit_warning = await _send_audit(client, fresh, self.actor_id)
                self.payload = fresh
                self.draft = copy.deepcopy(_validated_settings(fresh["settings"]))
                notice = {
                    "applied": "✅ Settings applied.",
                    "reset": "✅ Safe defaults restored.",
                    "rolled_back": "✅ Previous settings restored as a new revision.",
                    "unchanged": "No settings changed.",
                }.get(str(fresh.get("action")), "Settings updated.")
                if audit_warning:
                    notice = f"{notice} ⚠️ {audit_warning}"
                self.notice = notice
                self._render()
                await interaction.edit_original_response(view=self)
            except Exception as exc:
                self.notice = f"❌ Settings rejected safely: {str(exc)[:400]}"
                self._render()
                await interaction.edit_original_response(view=self)

        async def _capacity(self, interaction: Any) -> None:
            parent = self

            class CapacityModal(discord.ui.Modal):
                def __init__(self) -> None:
                    super().__init__(title="Kurami capacity", timeout=180)
                    self.inputs: list[tuple[str, Any]] = []
                    fields = [
                        ("max_llm_running_global", _field_label("max_llm_running_global")),
                        ("max_active_global", _field_label("max_active_global")),
                    ]
                    fields.extend(
                        (f"project:{name}", _field_label(f"project:{name}"))
                        for name in list(parent.draft["project_wip"])[:3]
                    )
                    for key, label in fields:
                        value = (
                            parent.draft["project_wip"][key.removeprefix("project:")]
                            if key.startswith("project:")
                            else parent.draft[key]
                        )
                        item = discord.ui.TextInput(
                            label=label[:45],
                            default=str(value),
                            min_length=1,
                            max_length=len(str((_schema()["projectWip"] if key.startswith("project:") else _field(key))["max"])),
                        )
                        self.inputs.append((key, item))
                        self.add_item(item)

                async def on_submit(self, modal_interaction: Any) -> None:
                    try:
                        for key, item in self.inputs:
                            value = int(str(item.value))
                            if key.startswith("project:"):
                                parent.draft["project_wip"][key.removeprefix("project:")] = value
                            else:
                                parent.draft[key] = value
                        parent.draft = _validated_settings(parent.draft)
                        parent._render()
                        await modal_interaction.response.edit_message(
                            view=parent,
                        )
                    except Exception as exc:
                        await modal_interaction.response.send_message(
                            f"Capacity values rejected: {str(exc)[:350]}", ephemeral=True
                        )

            await interaction.response.send_modal(CapacityModal())

        async def _triage(self, interaction: Any) -> None:
            parent = self

            class TriageModal(discord.ui.Modal):
                def __init__(self) -> None:
                    super().__init__(title="Kurami AI triage", timeout=180)
                    self.limit = discord.ui.TextInput(
                        label=_field_label("ai_triage_daily"),
                        default=str(parent.draft["ai_triage_daily"]),
                        min_length=1,
                        max_length=len(str(_field("ai_triage_daily")["max"])),
                    )
                    self.add_item(self.limit)

                async def on_submit(self, modal_interaction: Any) -> None:
                    try:
                        parent.draft["ai_triage_daily"] = int(str(self.limit.value))
                        parent.draft = _validated_settings(parent.draft)
                        parent._render()
                        await modal_interaction.response.edit_message(
                            view=parent,
                        )
                    except Exception as exc:
                        await modal_interaction.response.send_message(
                            f"AI triage value rejected: {str(exc)[:350]}", ephemeral=True
                        )

            await interaction.response.send_modal(TriageModal())

        async def _previews(self, interaction: Any) -> None:
            parent = self

            class PreviewModal(discord.ui.Modal):
                def __init__(self) -> None:
                    super().__init__(title="Kurami previews", timeout=180)
                    self.inputs: list[tuple[str, Any]] = []
                    for field in (field for field in _schema()["fields"] if field["group"] == "previews"):
                        key, label, maximum = field["name"], _field_label(field["name"]), len(str(field["max"]))
                        item = discord.ui.TextInput(
                            label=label,
                            default=str(parent.draft[key]),
                            min_length=1,
                            max_length=maximum,
                        )
                        self.inputs.append((key, item))
                        self.add_item(item)

                async def on_submit(self, modal_interaction: Any) -> None:
                    try:
                        for key, item in self.inputs:
                            parent.draft[key] = int(str(item.value))
                        parent.draft = _validated_settings(parent.draft)
                        parent._render()
                        await modal_interaction.response.edit_message(
                            view=parent,
                        )
                    except Exception as exc:
                        await modal_interaction.response.send_message(
                            f"Preview values rejected: {str(exc)[:350]}", ephemeral=True
                        )

            await interaction.response.send_modal(PreviewModal())

        async def _system_health(self, interaction: Any) -> None:
            parent = self

            class HealthIntervalModal(discord.ui.Modal):
                def __init__(self) -> None:
                    super().__init__(title="System Health settings", timeout=180)
                    self.minutes = discord.ui.TextInput(
                        label="Check interval (minutes)",
                        default=str(parent.health_payload["intervalMinutes"]),
                        placeholder=", ".join(map(str, _schema()["health"]["allowedIntervals"])),
                        min_length=1,
                        max_length=2,
                    )
                    self.add_item(self.minutes)

                async def on_submit(self, modal_interaction: Any) -> None:
                    await modal_interaction.response.defer()
                    try:
                        fresh = await _run_health_settings_control(
                            "apply",
                            actor_id=parent.actor_id,
                            expected_revision=int(
                                parent.health_payload.get("revision", 0)
                            ),
                            minutes=int(str(self.minutes.value)),
                        )
                        before_minutes = int(
                            parent.health_payload.get("intervalMinutes", _schema()["health"]["defaultIntervalMinutes"])
                        )
                        audit_warning = await _send_audit(
                            client,
                            {
                                **fresh,
                                "maintenanceChannelId": parent.payload.get(
                                    "maintenanceChannelId"
                                ),
                                "changes": (
                                    []
                                    if before_minutes == fresh["intervalMinutes"]
                                    else [
                                        {
                                            "name": "health_check_minutes",
                                            "before": before_minutes,
                                            "after": fresh["intervalMinutes"],
                                        }
                                    ]
                                ),
                            },
                            parent.actor_id,
                        )
                        parent.health_payload = fresh
                        parent.notice = (
                            "✅ Health interval updated."
                            if fresh.get("action") == "applied"
                            else "Health interval is unchanged."
                        )
                        if audit_warning:
                            parent.notice = f"{parent.notice} ⚠️ {audit_warning}"
                    except Exception as exc:
                        parent.notice = (
                            "❌ Health interval rejected safely: "
                            f"{str(exc)[:350]}"
                        )
                    parent._render()
                    await modal_interaction.edit_original_response(view=parent)

            await interaction.response.send_modal(HealthIntervalModal())

        async def _edit(self, interaction: Any) -> None:
            selected = str(self.edit_select.values[0]) if self.edit_select.values else ""
            if selected == "system_health":
                await self._system_health(interaction)
            elif not self._idle():
                await interaction.response.send_message(
                    "Project Orchestrator settings are locked while sessions are active.",
                    ephemeral=True,
                )
            elif selected == "capacity":
                await self._capacity(interaction)
            elif selected == "triage":
                await self._triage(interaction)
            elif selected == "previews":
                await self._previews(interaction)
            else:
                await interaction.response.send_message(
                    "Unknown settings section.", ephemeral=True
                )

        async def _apply(self, interaction: Any) -> None:
            await self._apply_action(interaction, "apply", self.draft)

        async def _undo(self, interaction: Any) -> None:
            await self._apply_action(interaction, "rollback")

        async def _reset(self, interaction: Any) -> None:
            await self._apply_action(interaction, "reset")

    return SettingsView()


def install_settings_command(
    client: Any,
    authorized: Callable[[Any], bool],
    refresh_dashboard: Optional[Callable[[str], Awaitable[dict[str, Any]]]] = None,
) -> None:
    """Register the concise owner-only ``/kurami`` command group."""

    if getattr(client, "_kurami_settings_command_installed", False):
        return
    import discord

    existing = {
        str(getattr(command, "name", ""))
        for command in client.tree.get_commands()
    }
    if "kurami" in existing:
        raise RuntimeError("Discord already has a top-level /kurami command")
    kurami = discord.app_commands.Group(
        name="kurami", description="Kurami owner controls"
    )

    if refresh_dashboard is not None:

        @kurami.command(
            name="status",
            description="Move the current run dashboard to the bottom of this thread",
        )
        async def status(interaction: Any) -> None:
            if not authorized(interaction):
                await interaction.response.send_message(
                    "This Kurami status command is owner-only.", ephemeral=True
                )
                return
            thread_id = str(getattr(interaction, "channel_id", "") or "")
            if not thread_id.isdigit():
                await interaction.response.send_message(
                    "Use /kurami status inside an active Kurami session thread.",
                    ephemeral=True,
                )
                return
            await interaction.response.defer(ephemeral=True, thinking=True)
            try:
                payload = await refresh_dashboard(thread_id)
                guild_id = str(payload.get("guildId") or "")
                message_id = str(payload.get("messageId") or "")
                if not guild_id.isdigit() or not message_id.isdigit():
                    raise RuntimeError("Kurami returned no dashboard location")
                url = f"https://discord.com/channels/{guild_id}/{thread_id}/{message_id}"
                await interaction.followup.send(
                    f"Dashboard refreshed: [open current status]({url}).",
                    ephemeral=True,
                )
            except Exception as exc:
                await interaction.followup.send(
                    "Kurami status is available only inside an active session thread: "
                    f"{str(exc)[:350]}",
                    ephemeral=True,
                )

    @kurami.command(
        name="composio-check",
        description="Check Composio Session drift and review safe synchronization",
    )
    async def composio_check(interaction: Any) -> None:
        if not authorized(interaction):
            await interaction.response.send_message(
                "This Composio Session command is owner-only.", ephemeral=True
            )
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            results = await asyncio.gather(
                *(
                    _run_composio_control("check", contour)
                    for contour in _COMPOSIO_CONTOURS
                )
            )
            payloads = dict(zip(_COMPOSIO_CONTOURS, results, strict=True))
            actor_id = str(getattr(getattr(interaction, "user", None), "id", ""))
            view = _build_composio_view(authorized, payloads, actor_id)
            await interaction.followup.send(view=view, ephemeral=True)
        except Exception as exc:
            await interaction.followup.send(
                f"Composio Session check failed safely: {str(exc)[:400]}",
                ephemeral=True,
            )

    @kurami.command(
        name="settings", description="View or change Kurami system settings"
    )
    async def settings(interaction: Any) -> None:
        if not authorized(interaction):
            await interaction.response.send_message(
                "This Kurami settings command is owner-only.", ephemeral=True
            )
            return
        try:
            payload, health_payload = await asyncio.gather(
                _run_settings_control("status"),
                _run_health_settings_control("status"),
            )
            guild_id = str(getattr(interaction, "guild_id", "") or "")
            allowed_guilds = {
                str(value)
                for value in payload.get("allowedGuildIds", [])
                if str(value).isdigit()
            }
            if not guild_id or guild_id not in allowed_guilds:
                await interaction.response.send_message(
                    "Kurami settings are available only inside the configured project guild.",
                    ephemeral=True,
                )
                return
            actor_id = str(getattr(getattr(interaction, "user", None), "id", ""))
            view = _build_settings_view(
                client, authorized, payload, health_payload, actor_id
            )
            await interaction.response.send_message(view=view, ephemeral=True)
        except Exception as exc:
            await interaction.response.send_message(
                f"Kurami settings could not be opened safely: {str(exc)[:400]}",
                ephemeral=True,
            )

    client.tree.add_command(kurami)
    client._kurami_settings_command_installed = True


__all__ = [
    "install_settings_command",
    "_control_args",
    "_settings_diff",
    "_settings_message",
    "_validated_settings",
    "_composio_args",
    "_composio_diff_signature",
    "_composio_message",
    "_validated_composio_payload",
]
