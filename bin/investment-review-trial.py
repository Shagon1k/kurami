#!/usr/bin/env python3
"""One private frozen-input Hermes synthesis trial; no tools or scheduling.

Run with the installed Hermes Python environment. Caller supplies the Hermes
repository, private packet and output directory. No portfolio defaults live here.
"""
import argparse
import contextlib
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-repo", required=True)
    parser.add_argument("--packet", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    packet_path = Path(args.packet)
    if packet_path.is_symlink() or not packet_path.is_file() or packet_path.stat().st_mode & 0o077:
        raise ValueError("Packet must be a private regular file")
    if packet_path.stat().st_size > 2_000_000:
        raise ValueError("Packet too large")
    packet = json.loads(packet_path.read_text())
    if not isinstance(packet.get("prompt"), str) or not packet["prompt"]:
        raise ValueError("Missing trial prompt")
    os.umask(0o077)
    output = Path(args.output)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    sys.path.insert(0, str(Path(args.hermes_repo).resolve()))
    # A manual trial must not inherit a dispatcher task or invoke background work.
    os.environ.pop("HERMES_KANBAN_TASK", None)
    metadata = {"tools": 0, "scheduled": False, "published": False}
    try:
        with (output / "runtime.log").open("x") as log, contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            from hermes_cli.config import load_config_readonly
            from hermes_cli.runtime_provider import resolve_runtime_provider
            from run_agent import AIAgent
            config = load_config_readonly()
            model = config.get("model", {}).get("default")
            if not model:
                raise RuntimeError("No configured model")
            runtime = resolve_runtime_provider(target_model=model)
            kwargs = {key: runtime[key] for key in (
                "provider", "api_mode", "base_url", "api_key", "acp_command", "acp_args"
            ) if key in runtime}
            agent = AIAgent(
                **kwargs, model=model, enabled_toolsets=[], max_iterations=2,
                max_tokens=20000, quiet_mode=True, save_trajectories=False,
                skip_context_files=True, load_soul_identity=True,
                skip_memory=True, skip_background_review=True,
                checkpoints_enabled=False,
            )
            if agent.tools or agent.valid_tool_names:
                raise RuntimeError("Tool-free trial invariant failed")
            result = agent.run_conversation(packet["prompt"])
            if result.get("failed") or not result.get("completed"):
                raise RuntimeError("Hermes did not complete the trial")
            raw = result.get("final_response")
            if not isinstance(raw, str) or not raw:
                raise RuntimeError("Empty trial response")
            (output / "response.txt").write_text(raw)
            # No repair/manual rewriting: a fenced JSON answer is only unwrapped.
            content = raw.strip()
            if content.startswith("```json\n") and content.endswith("\n```"):
                content = content[8:-4]
            draft = json.loads(content)
            (output / "draft.json").write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n")
            metadata.update(model=model, completed=True, apiCalls=result.get("api_calls"))
    except Exception as exc:
        metadata.update(completed=False, errorType=type(exc).__name__)
        (output / "status.json").write_text(json.dumps(metadata, indent=2) + "\n")
        print(json.dumps(metadata))
        return 1
    (output / "status.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata))
    return 0


if __name__ == "__main__":
    sys.exit(main())
