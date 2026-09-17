#!/usr/bin/env python3
"""Check/update only the existing Daily job prompt through Hermes' locked API."""
import argparse
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    hermes = Path(os.environ.get("HERMES_HOME", "/home/shagon1k/_hermes/_core"))
    sys.path.insert(0, str(hermes / "hermes-agent"))
    from cron.jobs import list_jobs, update_job
    jobs = [j for j in list_jobs(include_disabled=True) if j.get("name") == "kurami-daily-briefing"]
    if len(jobs) != 1:
        raise SystemExit("Expected exactly one existing Daily job; no job created")
    job = jobs[0]
    prompt = (root / "integrations/hermes/briefing-cron-prompt.md").read_text().strip()
    drift = job.get("prompt", "").strip() != prompt
    if drift and args.apply:
        updated = update_job(job["id"], {"prompt":prompt})
        assert updated and updated["prompt"] == prompt
        assert updated["schedule"] == job["schedule"]
        drift = False
    print(json.dumps({"promptSynchronized":not drift, "scheduleUnchanged":True}))
    return int(drift)


if __name__ == "__main__":
    raise SystemExit(main())
