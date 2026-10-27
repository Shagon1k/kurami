"""Isolated syntax and allowlist checks for the Kurami Discord bridge."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def verify_docs_listener(module) -> dict[str, object]:
    """Owner-only docs buttons: a stranger changes nothing; Discuss opens and records one thread."""

    import asyncio

    calls: list[tuple] = []

    async def fake_control(action, proposal_id, thread_id=None, actor_id=None):
        calls.append((action, proposal_id, thread_id, actor_id))
        if action == "discuss":
            return {"ok": True, "needsThread": True, "title": "Docs proposal · dp_0123456789ab"}
        return {"ok": True}

    class Response:
        def __init__(self):
            self.done = False
            self.sent: list[str] = []

        def is_done(self):
            return self.done

        async def send_message(self, text, ephemeral=False):
            self.done = True
            self.sent.append(text)

        async def defer(self, ephemeral=False, thinking=False):
            self.done = True

    class Thread:
        id = 987654321

    class Message:
        async def create_thread(self, name, auto_archive_duration, reason):
            require(name.startswith("Docs proposal"), "Docs thread name lost its label")
            return Thread()

    class Followup:
        def __init__(self):
            self.sent: list[str] = []

        async def send(self, text, ephemeral=False):
            require(ephemeral, "Docs control reply must be ephemeral")
            self.sent.append(text)

    class User:
        id = 42

    class Interaction:
        def __init__(self, custom_id):
            self.data = {"custom_id": custom_id}
            self.response = Response()
            self.followup = Followup()
            self.message = Message()
            self.user = User()

    class Client:
        def __init__(self):
            self.listeners = []

        def add_listener(self, callback, name=None):
            self.listeners.append(callback)

        def event(self, callback):
            self.listeners.append(callback)
            return callback

    original = module._run_docs_control
    module._run_docs_control = fake_control
    try:
        client = Client()
        module.install_control_listener(client, lambda interaction: interaction.user.id == 42)
        require(client.listeners, "Docs listener was not installed")
        listener = client.listeners[-1]

        stranger = Interaction("kurami:docs_publish:dp_0123456789ab")
        stranger.user = type("Stranger", (), {"id": 7})()
        asyncio.run(listener(stranger))
        require(not calls, "A non-owner docs click reached the control runtime")
        require("not authorized" in stranger.response.sent[0], "Non-owner was not told why")

        discuss = Interaction("kurami:docs_discuss:dp_0123456789ab")
        asyncio.run(listener(discuss))
        require(
            [call[0] for call in calls] == ["discuss", "record-thread"]
            and calls[1][2] == "987654321",
            f"Discuss did not record exactly one thread: {calls}",
        )
        require("<#987654321>" in discuss.followup.sent[0], "Discuss reply lost the thread link")

        calls.clear()
        publish = Interaction("kurami:docs_publish:dp_0123456789ab")
        asyncio.run(listener(publish))
        require(calls == [("publish", "dp_0123456789ab", None, "42")], f"Publish call is wrong: {calls}")
        require("Publish queued" in publish.followup.sent[0], "Publish reply is missing")
    finally:
        module._run_docs_control = original
    return {"docs_owner_only": True, "docs_discuss_thread": True}


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
            and str(module._paths()[0]).startswith("/tmp/kurami-new-home/")
            and settings_module._composio_path()
            == Path("/tmp/kurami-new-home/app/bin/kurami-composio-session"),
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

    composio_payload = {
        "ok": True,
        "mode": "check",
        "contour": "broad",
        "changed": True,
        "configVersion": 2,
        "tools": ["COMPOSIO_SEARCH_TOOLS"],
        "diff": [
            {"kind": "add", "field": "toolkit", "after": "slack"},
            {
                "kind": "change",
                "field": "accounts.slack",
                "before": 0,
                "after": 1,
            },
        ],
        "activeAccountCounts": {"gmail": 1, "slack": 1},
        "selectedAccountCounts": {"gmail": 1, "slack": 1},
        "warnings": [],
    }
    composio_validated = settings_module._validated_composio_payload(
        composio_payload
    )
    require(
        composio_validated["changed"] is True
        and "Changes require review"
        in settings_module._composio_message(composio_payload)
        and "toolkit: slack" in settings_module._composio_message(composio_payload)
        and "COMPOSIO_SEARCH_TOOLS"
        in settings_module._composio_message(composio_payload),
        "Composio check panel lost its bounded diff",
    )
    require(
        settings_module._composio_diff_signature(composio_payload)
        != settings_module._composio_diff_signature(
            {**composio_payload, "configVersion": 3}
        ),
        "Composio apply confirmation is not revision-bound",
    )
    require(
        settings_module._composio_diff_signature(composio_payload)
        != settings_module._composio_diff_signature(
            {**composio_payload, "contour": "automation"}
        ),
        "Composio apply confirmation is not contour-bound",
    )
    require(
        settings_module._composio_diff_signature(composio_payload)
        != settings_module._composio_diff_signature(
            {**composio_payload, "tools": ["GMAIL_FETCH_EMAILS"]}
        ),
        "Composio apply confirmation is not tool-inventory-bound",
    )
    require(
        "trust: full"
        in settings_module._composio_message(
            {
                **composio_payload,
                "contour": "automation",
                "tools": ["GMAIL_BATCH_MODIFY_MESSAGES"],
            }
        ),
        "Automation contour lost its unattended-write warning",
    )
    try:
        settings_module._validated_composio_payload(
            {**composio_payload, "contour": "unknown"}
        )
        raise AssertionError("Composio panel accepted an unknown contour")
    except RuntimeError:
        pass
    try:
        settings_module._validated_composio_payload(
            {**composio_payload, "tools": ["GMAIL_SEND_EMAIL", "bad-tool"]}
        )
        raise AssertionError("Composio panel accepted an invalid tool inventory")
    except RuntimeError:
        pass
    try:
        settings_module._validated_composio_payload(
            {
                **composio_payload,
                "diff": [
                    {"kind": "add", "field": "toolkit", "after": "ca_private"}
                ],
            }
        )
        raise AssertionError("Composio panel accepted a private account identifier")
    except RuntimeError:
        pass
    original_composio_path = settings_module._composio_path
    try:
        settings_module._composio_path = lambda: settings_path
        require(
            settings_module._composio_args("check", "broad")
            == [
                str(settings_path),
                "check",
                "--contour",
                "broad",
                "--json",
            ]
            and settings_module._composio_args("apply", "automation")
            == [
                str(settings_path),
                "apply",
                "--contour",
                "automation",
                "--json",
            ],
            "Composio subprocess arguments are not exact",
        )
        try:
            settings_module._composio_args("check", "unknown")
            raise AssertionError("Composio subprocess accepted an unknown contour")
        except RuntimeError:
            pass
    finally:
        settings_module._composio_path = original_composio_path

    require(
        'custom_id="kurami:composio:contour"' in settings_source
        and 'custom_id=f"kurami:composio:apply:{self.contour}"' in settings_source
        and "_COMPOSIO_CONTOURS" in settings_source,
        "Composio contour selector or contour-bound Apply control is missing",
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
        "kurami:retry:r_retry": ("retry", "r_retry"),
        "kurami:recover_managed_task:r_9": ("recover_managed_task", "r_9"),
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
    require(module.parse_run_actions_id("kurami:review_actions:r_abc123", ["spec_review"]) == ("spec_review","r_abc123"), "Spec review menu was rejected")
    require(module.parse_run_actions_id("kurami:review_actions:r_abc123", ["clarity_review"]) == ("clarity_review","r_abc123"), "Clarity review menu was rejected")
    require(module.parse_run_actions_id("kurami:fix_actions:r_abc123", ["clarity_fix"]) == ("clarity_fix","r_abc123"), "Clarity fixes menu was rejected")
    require(module.parse_run_actions_id("kurami:review_actions:r_abc123", ["stop"]) is None, "Review menu accepted an unrelated action")
    require(module.parse_control_id("kurami:review_fix_all:r_abc123") == ("review_fix_all", "r_abc123"), "Combined fix button was rejected")
    captured_args = []
    original_spawn = module.asyncio.create_subprocess_exec
    original_paths = module._paths
    class ControlProcess:
        returncode = 0
        async def communicate(self):
            return b'{"ok":true,"action":"create"}', b''
    async def fake_control_spawn(*args, **kwargs):
        captured_args.append(args)
        return ControlProcess()
    module._paths = lambda: (Path(__file__), Path(__file__), Path(__file__))
    module.asyncio.create_subprocess_exec = fake_control_spawn
    try:
        token = "a" * 24
        require(module.DECISION_ID.fullmatch(f"kurami:decision_ready:r_abc123:{token}") is not None, "Decision button lost its exact attempt")
        require(module.DECISION_ID.fullmatch("kurami:decision_ready:r_abc123") is None, "Unfenced decision button accepted")
        asyncio.run(module._run_control("decision_ready", "r_abc123", decision_token=token))
        require(captured_args[-1][-2:] == ("--decision-token", token), "Decision attempt was not forwarded to the control route")
        try:
            asyncio.run(module._run_control("decision_ready", "r_abc123"))
            raise AssertionError("Missing decision attempt was accepted")
        except RuntimeError:
            pass
        asyncio.run(module._run_control("review_fix_all", "r_abc123"))
        require(captured_args[-1][-1] == "--all-reviews" and captured_args[-1][captured_args[-1].index("--action") + 1] == "review_fix", "Combined fix did not reach the shared queue")
        asyncio.run(module._run_control("spec_review", "r_abc123"))
        require(captured_args[-1][-2:] == ("--profile", "spec") and captured_args[-1][captured_args[-1].index("--action") + 1] == "ai_review", "Spec review lost its profile or shared action")
        asyncio.run(module._run_control("clarity_fix", "r_abc123"))
        require(captured_args[-1][-2:] == ("--profile", "clarity"), "Legacy Clarity fix lost its selected profile")
    finally:
        module.asyncio.create_subprocess_exec = original_spawn
        module._paths = original_paths
    for action in ["clarity_review", "clarity_fix"]:
        require(module.parse_run_actions_id("kurami:run_actions:r_abc123", [action]) == (action,"r_abc123"), "Review menu rejected its selected profile")
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
    docs_accepted = {
        "kurami:docs_discuss:dp_0123456789ab": ("discuss", "dp_0123456789ab"),
        "kurami:docs_revise:dp_0123456789ab": ("revise", "dp_0123456789ab"),
        "kurami:docs_publish:dp_0123456789ab": ("publish", "dp_0123456789ab"),
        "kurami:docs_reject:dp_0123456789ab": ("reject", "dp_0123456789ab"),
    }
    for custom_id, expected in docs_accepted.items():
        require(
            module.parse_docs_control_id(custom_id) == expected,
            f"Rejected docs control {custom_id}",
        )
    docs_rejected = [
        None,
        "kurami:docs_merge:dp_0123456789ab",
        "kurami:docs_publish:dp_0123456789",
        "kurami:docs_publish:dp_0123456789AB",
        "kurami:docs_publish:dp_0123456789ab;rm",
        "kurami:docs_publish:dp_0123456789ab:extra",
        "kurami:docs_publish:pmb_0123456789ab",
    ]
    for custom_id in docs_rejected:
        require(
            module.parse_docs_control_id(custom_id) is None,
            f"Accepted docs control {custom_id!r}",
        )
    docs_listener = verify_docs_listener(module)

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
    require("General Review" in review, "AI review response uses an ambiguous label")
    fix_review = module._request_message(
        "review_fix", {"action": "created", "requestState": "pending"}
    )
    require("Fix Review" in fix_review, "Review fix response uses an ambiguous label")
    recovery = module._request_message(
        "recover_managed_task", {"action": "created", "requestState": "pending"}
    )
    require(
        "Recover delivered fix" in recovery,
        "Managed recovery response uses an ambiguous label",
    )
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
    # Exercise the real schema loader against an isolated home, not the developer's VPS.
    from tempfile import TemporaryDirectory
    with TemporaryDirectory(prefix="kurami-discord-schema-") as schema_home:
        schema_path = Path(schema_home) / "app/src/orchestrator/settings/settings-schema.json"
        schema_path.parent.mkdir(parents=True)
        canonical_schema = Path(__file__).resolve().parents[1] / "src/orchestrator/settings/settings-schema.json"
        schema_path.write_text(canonical_schema.read_text(encoding="utf-8"), encoding="utf-8")
        original_home = settings_module._kurami_home
        settings_module._kurami_home = lambda: Path(schema_home)
        schema = settings_module._schema()
        require(schema == json.loads(canonical_schema.read_text(encoding="utf-8")), "Discord must load the canonical shared schema")
        validated = settings_module._validated_settings(runtime_settings)
        settings_module._kurami_home = original_home
    settings_module._schema = lambda: schema
    require(settings_module._schema() == schema, "Discord must load the canonical shared schema")
    for field in schema["fields"]:
        for value in [field["min"] - 1, field["max"] + 1, True]:
            try:
                settings_module._validated_settings({**runtime_settings, field["name"]: value})
            except RuntimeError:
                pass
            else:
                raise AssertionError(f"Schema boundary accepted: {field['name']}={value}")
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
    for field in schema["fields"]:
        require(control_args[control_args.index(field["flag"]) + 1] == str(runtime_settings[field["name"]]), "Discord flags drifted from the shared schema")
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
            in client.tree.commands["kurami"].children
            and "composio-check" in client.tree.commands["kurami"].children,
            "Concise /kurami command group was not registered",
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
                "docs_accepted": len(docs_accepted),
                "docs_rejected": len(docs_rejected),
                **docs_listener,
                "listener": "strict_component_allowlist",
                "settings": "owner_only_kurami_settings",
                "run_status": "owner_only_kurami_status",
                "composio": "owner_only_three_contour_check_with_bound_apply",
                "settings_shared_pool": True,
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
