# Technical debt roadmap

This roadmap records verified Kurami debt. Update **Status** as fixes land:
`Open` → `In progress` → `Done`. `Done` below means implemented and verified in
the current cleanup branch; it does not claim a production rollout. The **Jira**
column remains empty unless the owner asks for tickets.

_Last audit: 2026-09-27. Scope: Daily Briefing skill and scheduled-job contract._

## Summary

| Severity | Open | In progress | Done |
| --- | ---: | ---: | ---: |
| High | 0 | 0 | 0 |
| Medium | 1 | 0 | 4 |
| Low | 0 | 0 | 1 |

## High

| ID | Category | Location | Description | Suggested fix | Status | Jira |
| --- | --- | --- | --- | --- | --- | --- |

## Medium

| ID | Category | Location | Description | Suggested fix | Status | Jira |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | configuration | `bin/sync-briefing-cron.py` | The active Hermes profile has an enabled, locally delivered Daily job, but its prompt and attached skills differ from the versioned contract. An older `~/.hermes` profile held a paused job; reading it without setting `HERMES_HOME` caused a false outage diagnosis. The 2026-09-27 scheduled attempt reached `notified`, and its edition was published. | Keep the sync tool pinned to the gateway profile and require the exact job ID before an authorized `--apply`. Then update only the active job's prompt and skills, preserving schedule and enabled state; check the next real attempt and receipts. | Open | — |
| M2 | maintainability | `integrations/hermes/skills/kurami-daily-briefing/SKILL.md:283` | The scheduled skill loaded the worker's low-level publish checklist and exact-ID recovery commands even though the agent calls one completion operation. This blurred ownership and enlarged every run's context. | Keep the scheduled path in `SKILL.md`; load `references/operator-recovery.md` only for manual media staging or authorized recovery. | Done | — |
| M3 | consistency | `integrations/hermes/skills/kurami-daily-briefing/SKILL.md:317` | The skill asked for a detailed final report while the cron prompt required `[SILENT]`; it also repeated weather collection after `collect-live`. These instructions could steer the agent away from the guarded path. | Give scheduled and interactive responses separate rules, and read weather only from the runtime snapshot. | Done | — |
| M4 | configuration | `deploy/config/briefing.yaml:85` | A renderer-skill capability and attached UI skill suggested model-driven HTML work even though the completion worker renders the accepted payload. This loaded unrelated UI instructions into scheduled runs. | Remove the unused renderer-skill setting and require only `kurami-daily-briefing` in the versioned cron contract; keep UI skill available for manual UI work. | Done | — |
| M5 | testing | `tests/verify-hermes-skills.ts:68` | String-presence tests required a dead weather profile and low-level commands in the main skill, but did not check prompt, skill-list, delivery, schedule, or enabled-state drift. | Assert the scheduled contract and exercise cron sync against a fake job record, including incompatible delivery and preservation of operator controls. | Done | — |

## Low

| ID | Category | Location | Description | Suggested fix | Status | Jira |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | maintainability | `integrations/hermes/skills/kurami-daily-briefing/references/provider-hermes-weather.md:1` | The `hermes-weather` profile had no configured source or runtime adapter; a test alone kept it present. It could mislead future recovery work. | Remove the unused profile while retaining the tested Open-Meteo selection. | Done | — |
