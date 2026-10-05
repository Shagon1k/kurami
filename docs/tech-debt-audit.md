# Technical debt roadmap

This roadmap records verified Kurami debt. Update **Status** as fixes land:
`Open` → `In progress` → `Done`. `Done` below means implemented, merged, and
verified at code level; it does not by itself claim a production rollout. The **Jira**
column remains empty unless the owner asks for tickets.

_Last audit: 2026-10-05. Scope: prior items retained; duplication in Projects, Orchestrator projections, env parsing and Digest topic persistence._

## Summary

| Severity | Open | In progress | Done |
| --- | ---: | ---: | ---: |
| High | 0 | 0 | 0 |
| Medium | 5 | 1 | 8 |
| Low | 0 | 0 | 3 |

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
| M7 | maintainability | `src/briefing/store.ts:75` | Preview, publication, finalization, mail, and retention persistence now have separate modules on this branch. The public `store.ts` API remains intact; isolated tests cover transaction rollback and retention path boundaries. | Merge and verify the refactor before marking this item Done; no application rollout is implied. | Open | — |
| M8 | maintainability | `src/orchestrator/projects/sessions/manager.ts:840` | Session claim/start and stop/handoff now live in separate modules on this branch. The CLI still owns sync, cleanup, and recovery operations; tests cover failed-start retry and repeated handoff without a second tmux side effect. | Merge and verify the session refactor before marking this item Done; no application rollout is implied. | Open | — |
| M9 | maintainability | `src/orchestrator/runtime/controller.ts:164` | CI repair, review-fix, AI review, and progress reconciliation now have separate modules on this branch. Focused tests check cycle order and typed action/receipt dispatch; the CLI dry-run branch is unchanged. | Merge and verify the controller refactor before marking this item Done; no application rollout is implied. | Open | — |
| M10 | error-handling | `src/briefing/weekly/mail-observation.ts:21` | The inline catch on `main` can hide a failed Weekly mail observation after the mail action completes. This branch adds an action- and edition-bound failure receipt with idempotent history replay. | Merge the tested handler and migration, then verify the populated database upgrade before marking this item done. | Open | — |
| M11 | testing | `.github/workflows/regression.yml:1` | A secretless PR and main workflow is present on this branch, but no successful GitHub run has been verified yet. Reviewers still lack confirmed automatic regression evidence. | Verify the workflow on PR #13, then decide separately whether its check should become a required merge gate. | Open | — |
| M12 | maintainability | `src/projects-site/action-request.ts:9` | Four Projects actions repeated POST transport, busy cleanup and ambiguous-error handling. They now use one request helper; operation-specific refresh timing and receipt handling stay with each action. | Verify focused and browser regressions, then release the scoped refactor. | Done | — |
| M13 | consistency | `src/projects-site/action-presentation.ts:6` | Server-rendered status notes and browser notifications maintained separate state/message/tone maps. A typed source now supplies both presentations. | Verify all EN/RU state mappings and status-request recovery before release. | Done | — |
| M14 | maintainability | `src/orchestrator/runtime/run-projections.ts:2` | Controls, Discord, succession and runtime reads duplicated attention/successor projections. Shared SQL keeps filters and ordering consistent; COUNT and EXISTS remain separate to preserve semantics. | Run control, Discord, succession and controller regressions before release. | Done | — |

## Low

| ID | Category | Location | Description | Suggested fix | Status | Jira |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | maintainability | `integrations/hermes/skills/kurami-daily-briefing/references/provider-hermes-weather.md:1` | The `hermes-weather` profile had no configured source or runtime adapter; a test alone kept it present. It could mislead future recovery work. | Remove the unused profile while retaining the tested Open-Meteo selection. | Done | — |
| L2 | maintainability | `src/core/env-value.ts:2` | Four modules copied the Hermes env-file parser. One helper now preserves first-match, empty-value and quoted-value behavior without shell evaluation. | Verify format tests and affected delivery suites before release. | Done | — |
| L3 | maintainability | `src/briefing/topic-registry-store.ts:4` | Preview preparation and published-news updates duplicated the topic upsert. One prepared statement now preserves active status and existing aliases inside caller-owned transactions. | Verify topic preservation, rollback and Digest regression suites before release. | Done | — |
