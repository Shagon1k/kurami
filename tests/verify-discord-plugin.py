"""Isolated syntax and allowlist checks for the Kurami Discord bridge."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    default_plugin_dir = Path(__file__).with_name("kurami-discord-controls")
    plugin_dir = Path(os.environ.get("KURAMI_DISCORD_PLUGIN_DIR", default_plugin_dir))
    module_path = plugin_dir / "control_handler.py"
    spec = importlib.util.spec_from_file_location("kurami_control_handler", module_path)
    require(spec is not None and spec.loader is not None, "Cannot load control handler")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    settings_path = plugin_dir / "settings_handler.py"
    settings_spec = importlib.util.spec_from_file_location(
        "kurami_settings_handler", settings_path
    )
    require(
        settings_spec is not None and settings_spec.loader is not None,
        "Cannot load settings handler",
    )
    settings_module = importlib.util.module_from_spec(settings_spec)
    settings_spec.loader.exec_module(settings_module)
    previous_kurami_home = os.environ.get("KURAMI_HOME")
    try:
        os.environ["KURAMI_HOME"] = "/tmp/kurami-new-home"
        require(
            str(settings_module._paths()[0]).startswith("/tmp/kurami-new-home/")
            and str(module._paths()[0]).startswith("/tmp/kurami-new-home/"),
            "KURAMI_HOME does not select the canonical home",
        )
        require(
            module._preview_manager_path()
            == Path("/tmp/kurami-new-home/app/src/orchestrator/projects/previews/manager.ts"),
            "Preview acknowledgement does not use the canonical preview manager",
        )
        subprocess_env = module._kurami_subprocess_env()
        settings_subprocess_env = settings_module._settings_subprocess_env()
        health_subprocess_env = settings_module._settings_subprocess_env(
            include_hermes=True
        )
        require(
            subprocess_env["KURAMI_HOME"] == "/tmp/kurami-new-home",
            "Plugin subprocess environment does not preserve canonical Kurami home",
        )
        require(
            settings_subprocess_env["KURAMI_HOME"] == "/tmp/kurami-new-home"
            and "HERMES_HOME" not in settings_subprocess_env
            and health_subprocess_env["HERMES_HOME"],
            "Settings subprocess environment does not preserve canonical homes",
        )
    finally:
        if previous_kurami_home is None:
            os.environ.pop("KURAMI_HOME", None)
        else:
            os.environ["KURAMI_HOME"] = previous_kurami_home
    settings_source = settings_path.read_text()
    control_source = module_path.read_text()
    require(
        "control.parents[2]" not in control_source,
        "Plugin subprocess home still depends on source-file nesting depth",
    )
    require(
        "control.parents[2]" not in settings_source,
        "Settings subprocess home still depends on source-file nesting depth",
    )
    require(
        settings_source.index('label="System Health"')
        < settings_source.index('label="Capacity & WIP"'),
        "System Health is not the first settings dropdown option",
    )
    require(
        'custom_id="kurami:settings:health-interval"' not in settings_source
        and 'selected == "system_health"' in settings_source,
        "Health interval still bypasses the shared settings dropdown",
    )

    accepted = {
        "kurami:status:r_abc123": ("status", "r_abc123"),
        "kurami:take_control:r_run_1": ("take_control", "r_run_1"),
        "kurami:preview_start:r_9": ("preview_start", "r_9"),
        "kurami:preview_stop:r_9": ("preview_stop", "r_9"),
        "kurami:preview_extend:r_9": ("preview_extend", "r_9"),
        "kurami:preview_reviewed:r_9": ("preview_reviewed", "r_9"),
        "kurami:stop:r_9": ("stop", "r_9"),
        "kurami:discard_prompt:r_9": ("discard_prompt", "r_9"),
        "kurami:discard_local:r_9": ("discard_local", "r_9"),
        "kurami:discard_published_prompt:r_9": (
            "discard_published_prompt",
            "r_9",
        ),
        "kurami:discard_published:r_9": ("discard_published", "r_9"),
        "kurami:ci_repair:r_9": ("ci_repair", "r_9"),
        "kurami:ai_review:r_9": ("ai_review", "r_9"),
        "kurami:review_fix:r_9": ("review_fix", "r_9"),
    }
    for custom_id, expected in accepted.items():
        require(module.parse_control_id(custom_id) == expected, f"Rejected {custom_id}")

    rejected = [
        None,
        42,
        "kurami:merge:r_9",
        "kurami:status:9",
        "kurami:status:r_9;rm",
        "other:status:r_9",
        "kurami:status:r_9:extra",
    ]
    for custom_id in rejected:
        require(module.parse_control_id(custom_id) is None, f"Accepted {custom_id!r}")

    require(
        module.parse_run_actions_id(
            "kurami:run_actions:r_abc123", ["ai_review"]
        )
        == ("ai_review", "r_abc123"),
        "Dashboard overflow rejected an allowlisted action",
    )
    for custom_id, values in [
        ("kurami:run_actions:r_abc123", ["merge"]),
        ("kurami:run_actions:r_abc123", ["ai_review", "stop"]),
        ("kurami:run_actions:abc123", ["stop"]),
        ("kurami:run_actions:r_abc123", "stop"),
    ]:
        require(
            module.parse_run_actions_id(custom_id, values) is None,
            f"Dashboard overflow accepted unsafe selection {custom_id!r} {values!r}",
        )

    require(
        module.parse_health_history_selection(
            "kurami:health:history", ["1787742589000"]
        )
        == "1787742589000",
        "Health history selection was rejected",
    )
    for custom_id, values in [
        ("kurami:health:history", []),
        ("kurami:health:history", ["../../secret"]),
        ("kurami:health:history:extra", ["1787742589000"]),
    ]:
        require(
            module.parse_health_history_selection(custom_id, values) is None,
            "Health history accepted an unsafe selection",
        )
    history_message = module._health_history_message(
        {
            "checkedAt": "2026-08-26T11:20:00.000Z",
            "ok": True,
            "cpuPercent": 12.4,
            "memoryPercent": 24.8,
            "diskPercent": 18,
            "networkStatus": "online",
            "networkLatencyMs": 18.2,
            "downloadMbps": 1202.9,
            "uploadMbps": 85.1,
            "runningContainers": 2,
            "unhealthyContainers": 0,
        }
    )
    require(
        "Health snapshot" in history_message
        and "1202.9↓ / 85.1↑ Mbps" in history_message,
        "Health history snapshot lost trend data",
    )

    metadata_accepted = {
        "kurami:metadata_details:pmb_abc123": ("details", "pmb_abc123"),
        "kurami:metadata_accept:pmb_abc123": ("accept", "pmb_abc123"),
        "kurami:metadata_skip:pmb_abc123": ("skip", "pmb_abc123"),
        "kurami:metadata_discuss:pmb_abc123": ("discuss", "pmb_abc123"),
        "kurami:metadata_exclude:pmb_abc123": ("exclude", "pmb_abc123"),
        "kurami:metadata_restore:pmb_abc123": ("restore", "pmb_abc123"),
        "kurami:metadata_retry:pmb_abc123": ("retry", "pmb_abc123"),
    }
    for custom_id, expected in metadata_accepted.items():
        require(
            module.parse_metadata_control_id(custom_id) == expected,
            f"Rejected metadata control {custom_id}",
        )
    metadata_rejected = [
        None,
        42,
        "kurami:metadata_apply:pmb_abc123",
        "kurami:metadata_accept:abc123",
        "kurami:metadata_accept:pmb_abc123;rm",
        "kurami:metadata_accept:pmb_ABC123",
        "kurami:metadata_accept:pmb_abc123:extra",
    ]
    for custom_id in metadata_rejected:
        require(
            module.parse_metadata_control_id(custom_id) is None,
            f"Accepted metadata control {custom_id!r}",
        )
    require(
        module.parse_metadata_page_control_id("kurami:metadata_page:pmb_abc123:2")
        == ("pmb_abc123", 2),
        "Rejected metadata pagination control",
    )
    require(
        module.parse_metadata_selection_control_id(
            "kurami:metadata_exclude:pmb_abc123:2"
        )
        == ("exclude", "pmb_abc123", 2),
        "Rejected paged metadata selection",
    )
    require(
        module.parse_metadata_page_control_id("kurami:metadata_page:pmb_abc123:100")
        is None,
        "Accepted out-of-range metadata page ID",
    )

    metadata_details = module._metadata_details_message(
        {
            "project": "tailortales",
            "batchNumber": 1,
            "summary": "2 metadata proposals ready for 2 issues.",
            "proposals": [
                {
                    "issueNumber": 55,
                    "field": "priority",
                    "proposedValue": "P1",
                    "confidence": "high",
                    "title": "Select a Merchant of Record",
                    "reason": "Owner impact is explicit.",
                    "state": "pending",
                }
            ],
        }
    )
    require("batch 1" in metadata_details, "Metadata details lost batch identity")
    metadata_embeds = module._metadata_details_embeds(
        {
            "summary": "12 metadata proposals ready for 12 issues.",
            "proposals": [
                {
                    "issueNumber": number,
                    "field": "priority" if number == 55 else "effort",
                    "proposedValue": "P1" if number == 55 else "M",
                    "confidence": "high",
                    "title": f"Proposal issue {number}",
                    "url": f"https://example.invalid/issues/{number}",
                    "reason": "Owner impact is explicit.",
                    "state": "pending",
                }
                for number in range(55, 67)
            ],
        }
    )
    require(
        "#55 · priority → P1" in metadata_embeds[0]["fields"][0]["name"],
        "Metadata embed lost proposal",
    )
    require(
        len(metadata_embeds[0]["fields"]) == 12,
        "Metadata embed truncated the bounded 12-proposal batch",
    )
    paginated = module._metadata_paginated_payload(
        {
            "proposals": [
                {"issueNumber": number, "state": "pending"}
                for number in range(1, 41)
            ]
        },
        2,
    )
    require(
        paginated["_pages"] == 4
        and paginated["_page"] == 2
        and len(paginated["proposals"]) == 12
        and paginated["proposals"][0]["issueNumber"] == 25,
        "Metadata review pagination is not stable at the 40-issue limit",
    )
    require("Nothing is written to GitHub" in metadata_details, "Metadata safety boundary is hidden")
    require(
        "advisory" in module._METADATA_DISCUSSION_INTRO
        and "never changes SQLite or GitHub" in module._METADATA_DISCUSSION_INTRO,
        "Metadata discussion can be mistaken for a mutation control",
    )

    class MessageFlags:
        ephemeral = True

    require(
        module._metadata_updates_source_message("accept", MessageFlags()),
        "Ephemeral accept does not replace its source review panel",
    )
    require(
        not module._metadata_updates_source_message("discuss", MessageFlags()),
        "Discussion unexpectedly replaces the digest source message",
    )
    require(
        not module._metadata_updates_source_message("accept", None),
        "Public digest accept unexpectedly replaces the source card",
    )

    status = module._status_message(
        {
            "project": "tailortales",
            "issue_number": 92,
            "state": "parked_review",
            "owner_state": "none",
            "preview_url": "https://preview-1.shagon1k.win",
            "issue_url": "https://example.invalid/issues/92",
        }
    )
    require("tailortales #92" in status, "Status summary lost ticket identity")
    require("Status snapshot" in status, "Status response is not labeled as a snapshot")
    require("Captured:" in status, "Status snapshot has no capture time")
    require("preview-1.shagon1k.win" in status, "Status summary lost preview URL")
    cancel = module._request_message(
        "stop", {"action": "created", "requestState": "pending"}
    )
    require("Cancel run" in cancel, "Cancellation response uses an ambiguous label")
    repair = module._request_message(
        "ci_repair", {"action": "created", "requestState": "pending"}
    )
    require("Attempt CI fix" in repair, "CI repair response uses an ambiguous label")
    review = module._request_message(
        "ai_review", {"action": "created", "requestState": "pending"}
    )
    require("AI Code Review" in review, "AI review response uses an ambiguous label")
    fix_review = module._request_message(
        "review_fix", {"action": "created", "requestState": "pending"}
    )
    require("Fix Review" in fix_review, "Review fix response uses an ambiguous label")
    reviewed = module._request_message(
        "preview_reviewed", {"action": "reviewed"}
    )
    require(
        reviewed.startswith("Preview reviewed"),
        "Preview acknowledgement response is ambiguous",
    )
    successor = module._request_message(
        "take_control",
        {
            "action": "created",
            "requestState": "pending",
            "intent": "autonomous_successor",
        },
    )
    require(
        "Remote task is finished" in successor
        and "fresh managed Codex task" in successor,
        "Autonomous successor response lost the explicit owner boundary",
    )
    require(
        module.discard_confirmation_id("r_9") == "kurami:discard_local:r_9",
        "Discard confirmation ID is not deterministic",
    )
    require(
        module.published_discard_confirmation_id("r_9")
        == "kurami:discard_published:r_9",
        "Published discard confirmation ID is not deterministic",
    )

    runtime_settings = {
        "version": 1,
        "max_llm_running_global": 3,
        "ai_triage_daily": 12,
        "max_active_global": 3,
        "project_wip": {"tailortales": 3, "pickflick": 3},
        "max_previews_global": 6,
        "max_preview_builds_global": 2,
        "preview_ttl_hours": 24,
    }
    validated = settings_module._validated_settings(runtime_settings)
    require(
        validated["project_wip"]["tailortales"]
        + validated["project_wip"]["pickflick"]
        > validated["max_active_global"],
        "Settings UI incorrectly reserves the sum of project WIP caps",
    )
    for invalid in [
        {**runtime_settings, "max_llm_running_global": 4},
        {**runtime_settings, "ai_triage_daily": 41},
        {
            **runtime_settings,
            "max_active_global": 2,
            "project_wip": {"tailortales": 3, "pickflick": 2},
        },
        {**runtime_settings, "max_preview_builds_global": 7},
        {**runtime_settings, "preview_ttl_hours": 5},
    ]:
        try:
            settings_module._validated_settings(invalid)
        except RuntimeError:
            pass
        else:
            raise AssertionError(f"Accepted invalid runtime settings: {invalid}")

    settings_module._paths = lambda: (Path(__file__), Path(__file__))
    settings_module._health_paths = lambda: (Path(__file__), Path(__file__))
    control_args = settings_module._control_args(
        "apply",
        actor_id="234723725168082944",
        expected_revision=7,
        settings=runtime_settings,
    )
    require(
        control_args[-2:] == ["--preview-ttl-hours", "24"]
        and control_args[control_args.index("--ai-triage-daily") + 1] == "12"
        and control_args.count("--project-wip") == 2
        and not any("TOKEN" in value or "SECRET" in value for value in control_args),
        "Settings subprocess arguments are not strictly bounded",
    )
    payload = {
        "revision": 7,
        "source": "runtime_override",
        "settings": runtime_settings,
        "defaults": {**runtime_settings, "max_llm_running_global": 1},
        "idle": {"idle": True, "reasons": []},
    }
    draft = {**runtime_settings, "max_llm_running_global": 2}
    message = settings_module._settings_message(payload, draft)
    require(
        "Pending changes" in message
        and "Concurrent LLM** · 3 → 2" in message
        and "Changes allowed" in message
        and "### Capacity" in message
        and "### Previews" in message,
        "Settings review message lost diff or idle evidence",
    )
    locked = settings_module._settings_message(
        {**payload, "idle": {"idle": False, "reasons": ["non-terminal runs: 1"]}}
    )
    require(
        "Changes locked" in locked and "non-terminal runs: 1" in locked,
        "Settings locked UX lost its reason",
    )

    class FakeGroup:
        def __init__(self, *, name, description, parent=None):
            self.name = name
            self.description = description
            self.children = {}
            if parent is not None:
                parent.children[name] = self

        def command(self, *, name, description):
            def decorator(callback):
                self.children[name] = SimpleNamespace(
                    name=name, description=description, callback=callback
                )
                return callback

            return decorator

    class FakeTree:
        def __init__(self):
            self.commands = {}

        def get_commands(self):
            return list(self.commands.values())

        def add_command(self, command):
            self.commands[command.name] = command

    import sys

    old_discord = sys.modules.get("discord")
    sys.modules["discord"] = SimpleNamespace(
        app_commands=SimpleNamespace(Group=FakeGroup)
    )
    try:
        client = SimpleNamespace(tree=FakeTree())
        async def refresh_dashboard(_thread_id):
            return {"ok": True}

        settings_module.install_settings_command(
            client, lambda _interaction: True, refresh_dashboard
        )
        require(
            "kurami" in client.tree.commands
            and "status" in client.tree.commands["kurami"].children
            and "settings"
            in client.tree.commands["kurami"].children,
            "Concise /kurami settings command was not registered",
        )
        settings_module.install_settings_command(
            client, lambda _interaction: True, refresh_dashboard
        )
        require(
            len(client.tree.commands) == 1,
            "Settings slash command registration is not idempotent",
        )
    finally:
        if old_discord is None:
            sys.modules.pop("discord", None)
        else:
            sys.modules["discord"] = old_discord

    print(
        json.dumps(
            {
                "ok": True,
                "accepted": len(accepted),
                "rejected": len(rejected),
                "metadata_accepted": len(metadata_accepted),
                "metadata_rejected": len(metadata_rejected),
                "listener": "strict_component_allowlist",
                "settings": "owner_only_kurami_settings",
                "run_status": "owner_only_kurami_status",
                "settings_shared_pool": True,
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
