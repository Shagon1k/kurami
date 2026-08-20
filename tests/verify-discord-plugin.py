"""Isolated syntax and allowlist checks for the Kurami Discord bridge."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path


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
    require(
        module.discard_confirmation_id("r_9") == "kurami:discard_local:r_9",
        "Discard confirmation ID is not deterministic",
    )
    require(
        module.published_discard_confirmation_id("r_9")
        == "kurami:discard_published:r_9",
        "Published discard confirmation ID is not deterministic",
    )

    print(
        json.dumps(
            {
                "ok": True,
                "accepted": len(accepted),
                "rejected": len(rejected),
                "metadata_accepted": len(metadata_accepted),
                "metadata_rejected": len(metadata_rejected),
                "listener": "strict_component_allowlist",
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
