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
        "kurami:stop:r_9": ("stop", "r_9"),
        "kurami:discard_prompt:r_9": ("discard_prompt", "r_9"),
        "kurami:discard_local:r_9": ("discard_local", "r_9"),
        "kurami:discard_published_prompt:r_9": (
            "discard_published_prompt",
            "r_9",
        ),
        "kurami:discard_published:r_9": ("discard_published", "r_9"),
        "kurami:ci_repair:r_9": ("ci_repair", "r_9"),
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
                "listener": "strict_component_allowlist",
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
