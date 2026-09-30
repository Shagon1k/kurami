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
| 1 — implemented | Owner can inspect tasks across projects | Existing Run Store and registry | Real-schema read-only tests; owner-only HTTP tests; table/detail/filter browser checks; joint UI checks |
| 2 — implemented | Owner can request AI Review from Projects | Phase 1 and shared control policy | One durable exact-SHA request; duplicate and stale requests rejected; both interfaces show the same result |
| 3 — implemented | Owner can change Project status | Phase 1 and guarded GitHub writes | A stable transition produces one normal poller event; concurrent requests, conflicts and lost replies have explicit outcomes |
| 4 — next | Owner can use the remaining Kurami actions | Phase 2 | Parity with current Discord eligibility and confirmation rules; shared request results |
| 5 | Owner can manage order and metadata | Phases 3–4 | Each supported field has an explicit authority and conflict policy |

Phase 1 includes the server, read model, table, task panel, filters, freshness,
owner access validation, and an inactive deployment unit for port 8777.
Controls remain disabled by default. Phase 2 adds a guarded AI Review request
through the existing control queue, an explicit Projects source, and a PR/SHA
context validated before the worker starts. Phase 3 adds a guarded status selector,
durable write intent and read-only recovery for uncertain GitHub replies. The
writable first-release scope still requires the remaining controls.

Elaborate the active and next phase as work approaches. Later phases describe
capabilities and dependencies; their endpoint and migration details stay open.
If temporary phase notes are needed, link them here while active, consolidate
durable facts into this plan and [architecture](ARCHITECTURE.md), then remove them.

## Release boundaries

The owner requested a compact working screen, small thematic icons and removal
of empty introductory copy. The first implementation is committed as `40fa422`;
the interface revision and AI Review capability are committed as `650a829`.

Code readiness requires passing automated checks. The owner then reviews the
synthetic interface and the proposed release scope. Commit, push and production
deployment follow the repository's delivery approval rule. Installing the unit
and verifying the protected hostname are separate from code readiness.

Before publication, resolve the Projects-specific Cloudflare Access audience,
team and owner identity. Verify that unauthenticated requests disclose no task
data, the origin is loopback-only, and the tunnel routes to port 8777. The owner
controls that release decision. Control requests and their PR/SHA context live in the existing Run Store; its
backup and recovery cover these records.

## Open and deferred decisions

- Cloudflare Access is the implemented access path; live application configuration
  and owner allowlist are pending before deployment. Secrets stay outside Git.
- AI Review rollout requires schema 33 and the optional controls service drop-in.
  Status writes additionally require schema 34, GitHub CLI credentials and the
  separate status drop-in. Both capabilities default to disabled.
- GitHub has no conditional status mutation. The implementation checks before
  and after writing, but a simultaneous external edit can still be overwritten
  between those checks. See [architecture](ARCHITECTURE.md#project-status-requests).
- Priority, Effort, card order, issue text, comments, bulk edits and a board view
  are deferred until the table and core actions have been exercised.
- Public access, billing, uploads, browser push and offline copies are outside the
  current owner-only product. Revisit only if the product boundary changes.

The questionnaire and existing source define the scope. Verification evidence
is supplied by `test:projects-site`, `test:projects-browser`, and the repository
UI checks. This phase has not been deployed or accepted by the owner.
