"""Offline contract tests for the tool-free Hermes trial wrapper."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

runner = Path(__file__).resolve().parents[2] / "bin/investment-review-trial.py"
with tempfile.TemporaryDirectory(prefix="kurami-review-runner-") as temp:
    root = Path(temp)
    hermes = root / "hermes"
    (hermes / "hermes_cli").mkdir(parents=True)
    (hermes / "hermes_cli/__init__.py").write_text("")
    (hermes / "hermes_cli/config.py").write_text(
        "def load_config_readonly(): return {'model': {'default': 'test-model'}}\n"
    )
    (hermes / "hermes_cli/runtime_provider.py").write_text(
        "def resolve_runtime_provider(**kwargs): return {'provider':'test','api_key':'never-print-test-secret'}\n"
    )
    packet = root / "packet.json"
    packet.write_text(json.dumps({"prompt": "Synthetic frozen evidence"}))
    packet.chmod(0o600)
    prefix = """
class AIAgent:
    def __init__(self, **kw):
        assert kw['enabled_toolsets'] == []
        assert kw['skip_memory'] and kw['skip_background_review']
        assert kw['skip_context_files'] and not kw['save_trajectories']
        assert not kw['checkpoints_enabled']
        self.tools = TOOLS
        self.valid_tool_names = set(TOOLS)
    def run_conversation(self, prompt):
        assert prompt == 'Synthetic frozen evidence'
        return RESULT
"""
    for case, tools, result, success in [
        ("ok", [], {"completed": True, "final_response": '{"version":2}', "api_calls": 1}, True),
        ("tools", ["terminal"], {"completed": True, "final_response": "{}"}, False),
        ("failed", [], {"completed": False, "failed": True}, False),
        ("invalid", [], {"completed": True, "final_response": "not JSON"}, False),
    ]:
        (hermes / "run_agent.py").write_text(
            "TOOLS = " + repr(tools) + "\nRESULT = " + repr(result) + "\n" + prefix
        )
        output = root / case
        cmd = [sys.executable, "-B", str(runner), "--hermes-repo", str(hermes),
               "--packet", str(packet), "--output", str(output)]
        process = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        assert (process.returncode == 0) == success, process.stderr
        status = json.loads((output / "status.json").read_text())
        assert status["completed"] == success
        assert "never-print-test-secret" not in process.stdout + process.stderr
        assert output.stat().st_mode & 0o077 == 0
        for file in output.iterdir():
            assert file.stat().st_mode & 0o077 == 0
        assert (output / "draft.json").exists() == success
        if success:
            before = (output / "draft.json").read_bytes()
            repeated = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            assert repeated.returncode != 0
            assert (output / "draft.json").read_bytes() == before
    packet.chmod(0o644)
    denied = subprocess.run([sys.executable, "-B", str(runner), "--hermes-repo", str(hermes),
                            "--packet", str(packet), "--output", str(root / "unsafe")],
                            capture_output=True, text=True, timeout=10)
    assert denied.returncode != 0 and not (root / "unsafe").exists()
print("Hermes trial: no tools/background work, private artifacts, no overwrite, failure isolation verified offline.")
