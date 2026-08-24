"""Owner-only Discord UI for bounded Kurami runtime settings."""

from __future__ import annotations

import asyncio
import copy
import json
import os
import re
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional


_PROJECT = re.compile(r"^[a-z0-9-]+$")
_MUTATIONS = {"apply", "reset", "rollback"}


def _paths() -> tuple[Path, Path]:
    home = Path(
        os.environ.get(
            "ORCHESTRATOR_HOME",
            "/home/shagon1k/_hermes/_orchestrator",
        )
    ).resolve()
    return home / "runtime/node/bin/node", home / "app/src/orchestrator-settings.ts"


def _integer(value: object, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise RuntimeError(f"{name} must be an integer")
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


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
        projects[project] = _integer(limit, f"WIP {project}", 1, 3)
    settings = {
        "version": 1,
        "max_llm_running_global": _integer(
            value.get("max_llm_running_global"), "Max LLM", 1, 3
        ),
        "ai_triage_daily": _integer(
            value.get("ai_triage_daily"), "AI triage/day", 0, 40
        ),
        "max_active_global": _integer(
            value.get("max_active_global"), "Global WIP", 1, 6
        ),
        "project_wip": projects,
        "max_previews_global": _integer(
            value.get("max_previews_global"), "Active previews", 1, 6
        ),
        "max_preview_builds_global": _integer(
            value.get("max_preview_builds_global"), "Preview builds", 1, 2
        ),
        "preview_ttl_hours": _integer(
            value.get("preview_ttl_hours"), "Preview lifetime", 6, 72
        ),
    }
    if any(limit > settings["max_active_global"] for limit in projects.values()):
        raise RuntimeError("Project WIP cannot exceed Global WIP")
    if settings["max_preview_builds_global"] > settings["max_previews_global"]:
        raise RuntimeError("Preview builds cannot exceed active previews")
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
        args.extend(
            [
                "--max-llm",
                str(validated["max_llm_running_global"]),
                "--ai-triage-daily",
                str(validated["ai_triage_daily"]),
                "--global-wip",
                str(validated["max_active_global"]),
            ]
        )
        for project, limit in validated["project_wip"].items():
            args.extend(["--project-wip", f"{project}={limit}"])
        args.extend(
            [
                "--max-previews",
                str(validated["max_previews_global"]),
                "--max-preview-builds",
                str(validated["max_preview_builds_global"]),
                "--preview-ttl-hours",
                str(validated["preview_ttl_hours"]),
            ]
        )
    return args


async def _run_settings_control(
    action: str,
    actor_id: Optional[str] = None,
    expected_revision: Optional[int] = None,
    settings: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    args = _control_args(action, actor_id, expected_revision, settings)
    _, control = _paths()
    env = {
        "ORCHESTRATOR_HOME": str(control.parents[2]),
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "NODE_NO_WARNINGS": "1",
    }
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


def _settings_diff(
    current: dict[str, Any], proposed: dict[str, Any]
) -> list[tuple[str, int, int]]:
    before = _validated_settings(current)
    after = _validated_settings(proposed)
    labels = {
        "max_llm_running_global": "Concurrent LLM",
        "ai_triage_daily": "AI triage/day",
        "max_active_global": "Global WIP",
        "max_previews_global": "Active previews",
        "max_preview_builds_global": "Preview builds",
        "preview_ttl_hours": "Preview lifetime (hours)",
    }
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
) -> str:
    current = _validated_settings(payload.get("settings"))
    draft = _validated_settings(proposed or current)
    revision = int(payload.get("revision", 0))
    idle = payload.get("idle") if isinstance(payload.get("idle"), dict) else {}
    is_idle = idle.get("idle") is True
    lines = [
        "**Kurami Orchestrator settings**",
        f"Revision: `{revision}` · source: `{payload.get('source', 'unknown')}`",
        "",
        f"Concurrent LLM: **{draft['max_llm_running_global']}**",
        f"AI triage/day: **{draft['ai_triage_daily']}** issues/project",
        f"Global WIP: **{draft['max_active_global']}**",
    ]
    for project, limit in draft["project_wip"].items():
        lines.append(f"WIP {project}: **{limit}**")
    lines.extend(
        [
            f"Active previews: **{draft['max_previews_global']}**",
            f"Concurrent preview builds: **{draft['max_preview_builds_global']}**",
            f"Preview lifetime: **{draft['preview_ttl_hours']}h**",
            "",
        ]
    )
    diff = _settings_diff(current, draft)
    if diff:
        lines.append("**Pending diff**")
        lines.extend(f"- {label}: `{before}` → `{after}`" for label, before, after in diff)
        lines.append("")
    if is_idle:
        lines.append("✅ Idle gate passed. Apply affects future runs only.")
    else:
        reasons = idle.get("reasons") if isinstance(idle.get("reasons"), list) else []
        detail = "; ".join(str(reason)[:120] for reason in reasons[:5]) or "runtime is busy"
        lines.append(f"🔒 Apply is locked until the orchestrator is idle: {detail}.")
    if notice:
        lines.extend(["", str(notice)[:500]])
    return "\n".join(lines)[:1950]


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
    actor_id: str,
) -> Any:
    import discord

    class SettingsView(discord.ui.View):
        def __init__(self) -> None:
            super().__init__(timeout=300)
            self.payload = payload
            self.draft = copy.deepcopy(_validated_settings(payload.get("settings")))
            self.actor_id = actor_id
            self._sync_buttons()

        def _idle(self) -> bool:
            idle = self.payload.get("idle")
            return isinstance(idle, dict) and idle.get("idle") is True

        def _sync_buttons(self) -> None:
            diff = bool(_settings_diff(self.payload["settings"], self.draft))
            for item in self.children:
                custom_id = str(getattr(item, "custom_id", ""))
                if custom_id in {
                    "kurami:settings:capacity",
                    "kurami:settings:triage",
                    "kurami:settings:previews",
                }:
                    item.disabled = not self._idle()
                elif custom_id == "kurami:settings:apply":
                    item.disabled = not self._idle() or not diff
                elif custom_id == "kurami:settings:undo":
                    item.disabled = not self._idle() or int(self.payload.get("revision", 0)) == 0
                elif custom_id == "kurami:settings:reset":
                    item.disabled = not self._idle() or not _settings_diff(
                        self.payload["settings"], self.payload["defaults"]
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
                self._sync_buttons()
                notice = {
                    "applied": "✅ Settings applied.",
                    "reset": "✅ Safe defaults restored.",
                    "rolled_back": "✅ Previous settings restored as a new revision.",
                    "unchanged": "No settings changed.",
                }.get(str(fresh.get("action")), "Settings updated.")
                if audit_warning:
                    notice = f"{notice} ⚠️ {audit_warning}"
                await interaction.edit_original_response(
                    content=_settings_message(fresh, notice=notice), view=self
                )
            except Exception as exc:
                await interaction.edit_original_response(
                    content=_settings_message(
                        self.payload,
                        self.draft,
                        notice=f"❌ Settings rejected safely: {str(exc)[:400]}",
                    ),
                    view=self,
                )

        @discord.ui.button(
            label="Concurrency & WIP",
            style=discord.ButtonStyle.secondary,
            custom_id="kurami:settings:capacity",
        )
        async def capacity(self, interaction: Any, _button: Any) -> None:
            parent = self

            class CapacityModal(discord.ui.Modal):
                def __init__(self) -> None:
                    super().__init__(title="Kurami capacity", timeout=180)
                    self.inputs: list[tuple[str, Any]] = []
                    fields = [
                        ("max_llm_running_global", "Concurrent LLM (1-3)"),
                        ("max_active_global", "Global WIP (1-6)"),
                    ]
                    fields.extend(
                        (f"project:{name}", f"WIP {name} (1-3)")
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
                            max_length=1,
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
                        parent._sync_buttons()
                        await modal_interaction.response.edit_message(
                            content=_settings_message(parent.payload, parent.draft),
                            view=parent,
                        )
                    except Exception as exc:
                        await modal_interaction.response.send_message(
                            f"Capacity values rejected: {str(exc)[:350]}", ephemeral=True
                        )

            await interaction.response.send_modal(CapacityModal())

        @discord.ui.button(
            label="AI triage",
            style=discord.ButtonStyle.secondary,
            custom_id="kurami:settings:triage",
        )
        async def triage(self, interaction: Any, _button: Any) -> None:
            parent = self

            class TriageModal(discord.ui.Modal):
                def __init__(self) -> None:
                    super().__init__(title="Kurami AI triage", timeout=180)
                    self.limit = discord.ui.TextInput(
                        label="Issues per project/day (0-40)",
                        default=str(parent.draft["ai_triage_daily"]),
                        min_length=1,
                        max_length=2,
                    )
                    self.add_item(self.limit)

                async def on_submit(self, modal_interaction: Any) -> None:
                    try:
                        parent.draft["ai_triage_daily"] = int(str(self.limit.value))
                        parent.draft = _validated_settings(parent.draft)
                        parent._sync_buttons()
                        await modal_interaction.response.edit_message(
                            content=_settings_message(parent.payload, parent.draft),
                            view=parent,
                        )
                    except Exception as exc:
                        await modal_interaction.response.send_message(
                            f"AI triage value rejected: {str(exc)[:350]}", ephemeral=True
                        )

            await interaction.response.send_modal(TriageModal())

        @discord.ui.button(
            label="Previews",
            style=discord.ButtonStyle.secondary,
            custom_id="kurami:settings:previews",
        )
        async def previews(self, interaction: Any, _button: Any) -> None:
            parent = self

            class PreviewModal(discord.ui.Modal):
                def __init__(self) -> None:
                    super().__init__(title="Kurami previews", timeout=180)
                    self.inputs: list[tuple[str, Any]] = []
                    for key, label, maximum in [
                        ("max_previews_global", "Active previews (1-6)", 1),
                        ("max_preview_builds_global", "Concurrent builds (1-2)", 1),
                        ("preview_ttl_hours", "Preview lifetime hours (6-72)", 2),
                    ]:
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
                        parent._sync_buttons()
                        await modal_interaction.response.edit_message(
                            content=_settings_message(parent.payload, parent.draft),
                            view=parent,
                        )
                    except Exception as exc:
                        await modal_interaction.response.send_message(
                            f"Preview values rejected: {str(exc)[:350]}", ephemeral=True
                        )

            await interaction.response.send_modal(PreviewModal())

        @discord.ui.button(
            label="Apply",
            style=discord.ButtonStyle.success,
            custom_id="kurami:settings:apply",
        )
        async def apply(self, interaction: Any, _button: Any) -> None:
            await self._apply_action(interaction, "apply", self.draft)

        @discord.ui.button(
            label="Undo last",
            style=discord.ButtonStyle.secondary,
            custom_id="kurami:settings:undo",
        )
        async def undo(self, interaction: Any, _button: Any) -> None:
            await self._apply_action(interaction, "rollback")

        @discord.ui.button(
            label="Reset defaults",
            style=discord.ButtonStyle.danger,
            custom_id="kurami:settings:reset",
        )
        async def reset(self, interaction: Any, _button: Any) -> None:
            await self._apply_action(interaction, "reset")

    return SettingsView()


def install_settings_command(
    client: Any,
    authorized: Callable[[Any], bool],
    refresh_dashboard: Optional[Callable[[str], Awaitable[dict[str, Any]]]] = None,
) -> None:
    """Register one nested ``/kurami orchestrator settings`` command."""

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
        name="kurami", description="Kurami Orchestrator owner controls"
    )
    orchestrator = discord.app_commands.Group(
        name="orchestrator",
        description="Orchestrator runtime controls",
        parent=kurami,
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

    @orchestrator.command(
        name="settings", description="View or change bounded runtime settings"
    )
    async def settings(interaction: Any) -> None:
        if not authorized(interaction):
            await interaction.response.send_message(
                "This Kurami settings command is owner-only.", ephemeral=True
            )
            return
        try:
            payload = await _run_settings_control("status")
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
            view = _build_settings_view(client, authorized, payload, actor_id)
            await interaction.response.send_message(
                _settings_message(payload), view=view, ephemeral=True
            )
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
]
