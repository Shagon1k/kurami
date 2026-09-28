# Technical debt roadmap

This roadmap records verified Kurami debt. Update **Status** as fixes land:
`Open` → `In progress` → `Done`. `Done` below means implemented, merged, and
verified at code level; it does not by itself claim a production rollout. The **Jira**
column remains empty unless the owner asks for tickets.

_Last audit: 2026-09-28. Scope: Daily Briefing skill, Digest persistence, and Orchestrator runtime boundaries._

## Summary

| Severity | Open | In progress | Done |
| --- | ---: | ---: | ---: |
| High | 0 | 0 | 0 |
| Medium | 5 | 1 | 5 |
| Low | 0 | 0 | 1 |

## Rollout evidence

PR [#11](https://github.com/Shagon1k/kurami/pull/11) merged the cleanup into
`main` on 2026-09-27. The same day, only the changed Daily skill files were
installed in the active Hermes profile. The active Daily job now has the
versioned prompt and only the Daily skill; it remains enabled with local
delivery and the same schedule. The gateway remained active. No application
deploy or broad five-skill sync was performed. At rollout, the next scheduled
run was 2026-09-28 at 06:00 UTC; its result is tracked in M1.

## High

| ID | Category | Location | Description | Suggested fix | Status | Jira |
| --- | --- | --- | --- | --- | --- | --- |

## Medium

| ID | Category | Location | Description | Suggested fix | Status | Jira |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | configuration | `bin/sync-briefing-cron.py:22` | The active Daily job now matches the versioned prompt and skill list, with schedule, enabled state, and delivery preserved. The older `~/.hermes` profile caused a false outage diagnosis and has been archived. A post-rollout scheduled attempt has not yet run. | After the next scheduled run, verify its durable attempt, publication or failure state, and notification receipt before closing this item. | In progress | — |
| M2 | maintainability | `integrations/hermes/skills/kurami-daily-briefing/SKILL.md:283` | The scheduled skill loaded the worker's low-level publish checklist and exact-ID recovery commands even though the agent calls one completion operation. This blurred ownership and enlarged every run's context. | Keep the scheduled path in `SKILL.md`; load `references/operator-recovery.md` only for manual media staging or authorized recovery. | Done | — |
| M3 | consistency | `integrations/hermes/skills/kurami-daily-briefing/SKILL.md:317` | The skill asked for a detailed final report while the cron prompt required `[SILENT]`; it also repeated weather collection after `collect-live`. These instructions could steer the agent away from the guarded path. | Give scheduled and interactive responses separate rules, and read weather only from the runtime snapshot. | Done | — |
| M4 | configuration | `deploy/config/briefing.yaml:85` | A renderer-skill capability and attached UI skill suggested model-driven HTML work even though the completion worker renders the accepted payload. This loaded unrelated UI instructions into scheduled runs. | Remove the unused renderer-skill setting and require only `kurami-daily-briefing` in the versioned cron contract; keep UI skill available for manual UI work. | Done | — |
| M5 | testing | `tests/verify-hermes-skills.ts:68` | String-presence tests required a dead weather profile and low-level commands in the main skill, but did not check prompt, skill-list, delivery, schedule, or enabled-state drift. | Assert the scheduled contract and exercise cron sync against a fake job record, including incompatible delivery and preservation of operator controls. | Done | — |
| M6 | configuration | `integrations/hermes/skills/kurami-daily-briefing/references/editorial-policy.md:126` | The active skill targeted one Kurami Note per five stories while Git specified one per eight. The owner chose the active `/5` rule, and the tracked reference now matches it. | Keep the versioned `/5` rule aligned with the active skill; do not let an unrelated broad sync change editorial policy. | Done | — |
| M7 | maintainability | `src/briefing/store.ts:281` | The store still combines preview files, publication transactions, mail actions, and retention. Edition lookup, interest-profile persistence, and Telegram validation/commit planning are separate on this branch. | Move preview/publication file operations into a cohesive module; retain the current `store.ts` API and test each transition before removing the facade. | Open | — |
| M8 | maintainability | `src/orchestrator/projects/sessions/manager.ts:763` | Session claims, Codex startup, cleanup, handoff, and recovery still share a 2700-line CLI module. A change to one transition is hard to review against the others. | Extract claim/start and stop/handoff operations behind explicit state and side-effect boundaries; keep the CLI entry point and add restart/failure tests for each boundary. | Open | — |
| M9 | maintainability | `src/orchestrator/runtime/controller.ts:362` | Request and automatic planning are separate, but reconciliation and internal/external action execution still occupy the controller CLI. This keeps planning tests from covering the full transition boundary. | Extract reconciliation by lifecycle and action execution behind typed interfaces, preserving decision order and the existing dry-run output. | Open | — |
| M10 | error-handling | `src/briefing/store.ts:1147` | A failed Weekly mail observation is caught and logged while the mail action completes, with no durable failure receipt. Weekly mail counts can remain incomplete without a retry target. | Record a bounded, edition-bound observation failure and clear it after a successful retry; test that mail archival remains committed and the failure stays visible. | Open | — |
| M11 | testing | `package.json:26` | The repository has a full local regression command, but no tracked GitHub workflow, and PR #13 reports no checks. A reviewer cannot rely on automatic regression evidence for each push. | Add a secretless PR workflow that runs `npm ci` and `npm test`; decide separately whether the check should become a required merge gate. | Open | — |

## Low

| ID | Category | Location | Description | Suggested fix | Status | Jira |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | maintainability | `integrations/hermes/skills/kurami-daily-briefing/references/provider-hermes-weather.md:1` | The `hermes-weather` profile had no configured source or runtime adapter; a test alone kept it present. It could mislead future recovery work. | Remove the unused profile while retaining the tested Open-Meteo selection. | Done | — |
