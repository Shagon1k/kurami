# Projects delivery

Projects provides the owner with one table across configured GitHub Projects,
task details, and eventually the existing Kurami controls. The entry screen is
the table. Discord remains the main notification channel. GitHub remains the
authority for work intent and delivery status; the Run Store owns execution.

The owner accepts about one minute of delay for changes made in GitHub, with
visible source freshness. Changing card order and metadata follows the core
workflow. The long-term goal includes all owner actions currently used in Discord.

## Delivery sequence

| Phase | Outcome | Dependency | Acceptance and evidence |
| --- | --- | --- | --- |
| 1 — current | Owner can inspect tasks across projects | Existing Run Store and registry | Real-schema read-only tests; owner-only HTTP tests; table/detail/filter browser checks; joint UI checks |
| 2 — next | Owner can request AI Review from Projects | Phase 1 and shared control policy | One durable exact-SHA request; duplicate and stale requests rejected; both interfaces show the same result |
| 3 | Owner can change Project status | Phase 1 and guarded GitHub writes | The normal poller observes the transition exactly once; conflict and failure states are visible |
| 4 | Owner can use the remaining Kurami actions | Phase 2 | Parity with current Discord eligibility and confirmation rules; shared request results |
| 5 | Owner can manage order and metadata | Phases 3–4 | Each supported field has an explicit authority and conflict policy |

Phase 1 includes the server, read model, table, task panel, filters, freshness,
owner access validation, and an inactive deployment unit for port 8777. The
service exposes no mutation route. Its initial release is the inspection slice,
before the writable first-release scope agreed in the questionnaire is complete.

Elaborate the active and next phase as work approaches. Later phases describe
capabilities and dependencies; their endpoint and migration details stay open.
If temporary phase notes are needed, link them here while active, consolidate
durable facts into this plan and [architecture](ARCHITECTURE.md), then remove them.

## Release boundaries

Code readiness requires passing automated checks. The owner then reviews the
synthetic interface and the proposed release scope. Commit, push and production
deployment follow the repository's delivery approval rule. Installing the unit
and verifying the protected hostname are separate from code readiness.

Before publication, resolve the Projects-specific Cloudflare Access audience,
team and owner identity. Verify that unauthenticated requests disclose no task
data, the origin is loopback-only, and the tunnel routes to port 8777. The owner
controls that release decision. The service adds no durable data to back up;
existing Run Store recovery remains applicable.

## Open and deferred decisions

- Cloudflare Access is the implemented access path; live application configuration
  and owner allowlist are pending before deployment. Secrets stay outside Git.
- Mutation rollout and web request provenance require a later shared control
  boundary and additive migration. Do not label site requests as Discord or CLI.
- Priority, Effort, card order, issue text, comments, bulk edits and a board view
  are deferred until the table and core actions have been exercised.
- Public access, billing, uploads, browser push and offline copies are outside the
  current owner-only product. Revisit only if the product boundary changes.

The questionnaire and existing source define the scope. Verification evidence
is supplied by `test:projects-site`, `test:projects-browser`, and the repository
UI checks. This phase has not been deployed or accepted by the owner.
