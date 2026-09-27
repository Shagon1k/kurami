#!/usr/bin/env python3
"""Verify Daily cron sync without reading or updating the live job store."""

from contextlib import redirect_stdout
from io import StringIO
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import ModuleType
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "bin/sync-briefing-cron.py"
PROMPT = (ROOT / "integrations/hermes/briefing-cron-prompt.md").read_text().strip()
spec = importlib.util.spec_from_file_location("sync_briefing_cron", SCRIPT)
assert spec and spec.loader
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def run(job, apply=False, changed_field=None, expected_job_id="daily-job"):
    calls = []
    cron = ModuleType("cron")
    cron.__path__ = []
    jobs = ModuleType("cron.jobs")
    def list_jobs(include_disabled):
        assert include_disabled
        assert os.environ["HERMES_HOME"] == "/home/shagon1k/_hermes/_core"
        return [job.copy()]

    jobs.list_jobs = list_jobs

    def update_job(job_id, updates):
        assert job_id == job["id"]
        assert set(updates) == {"prompt", "skills"}
        calls.append(updates)
        updated = {**job, **updates}
        if changed_field:
            updated[changed_field] = not job[changed_field] if changed_field == "enabled" else {"kind": "every"}
        return updated

    jobs.update_job = update_job
    output = StringIO()
    with patch.dict(sys.modules, {"cron": cron, "cron.jobs": jobs}):
        with patch.dict(os.environ, {}, clear=True):
            args = [str(SCRIPT)]
            if apply:
                args += ["--apply"]
                if expected_job_id is not None:
                    args += ["--expect-job-id", expected_job_id]
            with patch.object(sys, "argv", args):
                with redirect_stdout(output):
                    try:
                        status = sync.main()
                    except SystemExit as error:
                        status = error.code
    return status, json.loads(output.getvalue()) if output.getvalue() else None, calls


base = {
    "id": "daily-job",
    "name": "kurami-daily-briefing",
    "prompt": "old prompt",
    "skills": ["kurami-daily-briefing", "kurami-ui-preview-language"],
    "schedule": {"kind": "cron", "expr": "0 6,7 * * *"},
    "enabled": False,
    "deliver": "local",
}

status, report, calls = run(base)
assert status == 1 and not calls
assert report["promptSynchronized"] is False
assert report["skillsSynchronized"] is False
assert report["jobId"] == "daily-job"
assert report["jobEnabled"] is False
assert report["hermesHome"] == "/home/shagon1k/_hermes/_core"

for wrong_id in (None, "other-job"):
    status, report, calls = run(base, apply=True, expected_job_id=wrong_id)
    assert status == "Pass --expect-job-id with the ID from a fresh read-only check"
    assert report is None and not calls

status, report, calls = run(base, apply=True)
assert status == 0 and len(calls) == 1
assert calls[0] == {"prompt": PROMPT, "skills": ["kurami-daily-briefing"]}
assert report["promptSynchronized"] is True
assert report["skillsSynchronized"] is True
assert report["scheduleUnchanged"] is True
assert report["enabledUnchanged"] is True
assert report["deliveryCompatible"] is True
assert report["deliveryUnchanged"] is True

status, report, calls = run({**base, "prompt": PROMPT, "skills": ["kurami-daily-briefing"]}, apply=True)
assert status == 0 and not calls
assert report["promptSynchronized"] is True
assert report["skillsSynchronized"] is True

status, report, calls = run(base, apply=True, changed_field="enabled")
assert status == "Daily job schedule, enabled state, or delivery changed unexpectedly"
assert report is None and len(calls) == 1

status, report, calls = run({**base, "deliver": "discord"}, apply=True)
assert status == "Daily job delivery is not local; refusing prompt/skill update"
assert report is None and not calls

print("Daily cron sync preserves schedule, enabled state, and delivery boundary.")
