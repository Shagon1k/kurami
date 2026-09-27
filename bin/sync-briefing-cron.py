#!/usr/bin/env python3
"""Check/update the existing Daily job prompt and attached skills."""
import argparse
import json
import os
from pathlib import Path
import sys

DAILY_SKILLS = ["kurami-daily-briefing"]


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
    jobs = [j for j in list_jobs(include_disabled=True) if j.get("name") == "kurami-daily-briefing"]
    if len(jobs) != 1:
        raise SystemExit("Expected exactly one existing Daily job; no job created")
    job = jobs[0]
    if args.apply and args.expect_job_id != job["id"]:
        raise SystemExit("Pass --expect-job-id with the ID from a fresh read-only check")
    prompt = (root / "integrations/hermes/briefing-cron-prompt.md").read_text().strip()
    prompt_drift = job.get("prompt", "").strip() != prompt
    skills_drift = job.get("skills") != DAILY_SKILLS
    delivery_compatible = job.get("deliver") == "local"
    schedule_unchanged = True
    enabled_unchanged = True
    delivery_unchanged = True
    if not delivery_compatible and args.apply:
        raise SystemExit("Daily job delivery is not local; refusing prompt/skill update")
    if (prompt_drift or skills_drift) and args.apply:
        updated = update_job(job["id"], {"prompt": prompt, "skills": DAILY_SKILLS})
        if not updated:
            raise SystemExit("Daily job update returned no record")
        schedule_unchanged = updated.get("schedule") == job.get("schedule")
        enabled_unchanged = updated.get("enabled") == job.get("enabled")
        delivery_unchanged = updated.get("deliver") == job.get("deliver")
        if not schedule_unchanged or not enabled_unchanged or not delivery_unchanged:
            raise SystemExit("Daily job schedule, enabled state, or delivery changed unexpectedly")
        prompt_drift = updated.get("prompt", "").strip() != prompt
        skills_drift = updated.get("skills") != DAILY_SKILLS
    print(json.dumps({
        "hermesHome": str(hermes),
        "jobId": job["id"],
        "jobEnabled": job.get("enabled"),
        "promptSynchronized": not prompt_drift,
        "skillsSynchronized": not skills_drift,
        "deliveryCompatible": delivery_compatible,
        "scheduleUnchanged": schedule_unchanged,
        "enabledUnchanged": enabled_unchanged,
        "deliveryUnchanged": delivery_unchanged,
    }))
    return int(prompt_drift or skills_drift or not delivery_compatible)


if __name__ == "__main__":
    raise SystemExit(main())
