# Projects delivery

Projects provides the owner with one table across configured GitHub Projects,
task details, and the existing Kurami run controls. The entry screen is
the table. Discord remains the main notification channel. GitHub remains the
authority for work intent and delivery status; the Run Store owns execution.

The owner accepts about one minute of delay for changes made in GitHub, with
visible source freshness. Changing card order and metadata follows the core
workflow. The long-term goal includes all owner actions currently used in Discord.

## Delivery sequence

| Phase | Outcome | Dependency | Acceptance and evidence |
| --- | --- | --- | --- |
| 1 — implemented | Owner can inspect tasks across projects | Existing Run Store and registry | Real-schema read-only tests; tunnel-hosting and optional Access HTTP tests; table/detail/search browser checks; joint UI checks |
| 2 — implemented | Owner can request AI Review from Projects | Phase 1 and shared control policy | One durable exact-SHA request; duplicate and stale requests rejected; both interfaces show the same result |
| 3 — implemented | Owner can change Project status | Phase 1 and guarded GitHub writes | A stable transition produces one normal poller event; concurrent requests, conflicts and lost replies have explicit outcomes |
| 4 — implemented | Owner can use the remaining Kurami actions | Phase 2 | Shared queue admission and request results; displayed-run checks; exact-SHA fix workers; explicit discard confirmation; preview acknowledgement provenance |
| 5 — next | Owner can manage order and metadata | Phases 3–4 | Each supported field has an explicit authority and conflict policy |

Phase 1 includes the server, read model, table, task panel, project selection, search, freshness,
optional owner Access validation, and a loopback service for port 8777.
Controls remain disabled by default. Phase 2 adds a guarded AI Review request
through the existing control queue, an explicit Projects source, and a PR/SHA
context validated before the worker starts. Phase 3 adds a guarded status selector,
durable write intent and read-only recovery for uncertain GitHub replies. The
writable first-release scope is implemented. Phase 4 adds the remaining run
actions and exact-preview acknowledgement. Production acceptance remains pending.

Elaborate the active and next phase as work approaches. Later phases describe
capabilities and dependencies; their endpoint and migration details stay open.
If temporary phase notes are needed, link them here while active, consolidate
durable facts into this plan and [architecture](ARCHITECTURE.md), then remove them.

## Release boundaries

The owner requested a compact working screen, small thematic icons and removal
of empty introductory copy. The first implementation is committed as `40fa422`;
the interface revision and AI Review capability are committed as `650a829`,
and status changes as `d2a7afd`.

Code readiness requires passing automated checks. The owner then reviews the
synthetic interface and the proposed release scope. Commit, push and production
deployment follow the repository's delivery approval rule. Installing the unit
and verifying the configured hostname are separate from code readiness.

The owner confirmed that Cloudflare and its Zero Trust policy are configured and
approved hosting the page and all controls on loopback port 8777. Application
Access validation is optional; normal tunnel hosting records an origin actor marker.
Control requests and their PR/SHA context live in the existing Run Store; its
backup and recovery cover these records.

## Interface revision — approved for rollout

The revised interface defaults to English, with a Russian switch. It replaces
view/status filters and Apply/Refresh buttons with live search, header project
tabs and sortable Task/Status/Kurami columns. Desktop tables fit the viewport;
mobile task details use a full-screen dialog with swipe and history navigation.

Shared status pills, a Sync popover, visible action groups and distinct danger
controls replace the draft presentation. Suggested next reads the same persisted
ranking as the Discord digest. Projects is enabled in the shared Sites menu.

Verification uses the Projects unit/browser suites and the library, guard and
joint browser gates. On 2026-10-01 the owner approved the scoped commit, push and
rollout. Integrate the completed shared UI changes before deployment and repeat
the relevant checks on the combined revision. Record runtime smoke evidence
outside Git after restarting the origins and promoting the static Docs menu.

## Open and deferred decisions

- The existing Zero Trust policy protects the tunnel route. Optional application
  Access validation requires its own audience and owner allowlist. Secrets stay outside Git.
- AI Review rollout requires schema 33 and the optional controls service drop-in.
  Status writes additionally require schema 34, GitHub CLI credentials and the
  separate status drop-in. Remaining run actions and Projects preview
  acknowledgement require schema 35. Both write flags default to disabled.
- GitHub has no conditional status mutation. The implementation checks before
  and after writing, but a simultaneous external edit can still be overwritten
  between those checks. See [architecture](ARCHITECTURE.md#project-status-requests).
- Priority, Effort, card order, issue text, comments, bulk edits and a board view
  are deferred until the table and core actions have been exercised.
- Public access, billing, uploads, browser push and offline copies are outside the
  current owner-only product. Revisit only if the product boundary changes.

The questionnaire and existing source define the scope. Verification evidence
is supplied by `test:projects-site`, `test:projects-browser`, and the repository
UI checks. The origin and schema 35 are deployed; owner acceptance of the live workflow remains pending.
