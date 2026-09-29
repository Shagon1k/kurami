#!/usr/bin/env python3
"""Check/update only the prompt of the existing weekly docs-freshness job."""
import argparse
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expect-job-id")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    hermes = Path(os.environ.get("HERMES_HOME", "/home/shagon1k/_hermes/_core"))
    os.environ["HERMES_HOME"] = str(hermes)
    sys.path.insert(0, str(hermes / "hermes-agent"))
    from cron.jobs import list_jobs, update_job
    jobs = [j for j in list_jobs(include_disabled=True) if j.get("name") == "kurami-docs-freshness"]
    if len(jobs) != 1:
        raise SystemExit("Expected exactly one existing docs-freshness job; no job created")
    job = jobs[0]
    if args.apply and args.expect_job_id != job["id"]:
        raise SystemExit("Pass --expect-job-id with the ID from a fresh read-only check")
    prompt = (root / "src/human-docs/automation/weekly-audit.md").read_text().strip()
    drift = job.get("prompt", "").strip() != prompt
    unchanged = True
    if drift and args.apply:
        updated = update_job(job["id"], {"prompt": prompt})
        if not updated:
            raise SystemExit("Docs-freshness job update returned no record")
        unchanged = all(updated.get(key) == job.get(key) for key in ("schedule", "enabled", "deliver", "skills", "script"))
        if not unchanged:
            raise SystemExit("Docs-freshness job schedule, state, delivery, skills or script changed unexpectedly")
        drift = updated.get("prompt", "").strip() != prompt
    print(json.dumps({"jobId": job["id"], "jobEnabled": job.get("enabled"), "promptSynchronized": not drift, "otherFieldsUnchanged": unchanged}))
    return int(drift)


if __name__ == "__main__":
    raise SystemExit(main())
