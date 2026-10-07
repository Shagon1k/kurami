# Projects runtime

`src/projects-site/server.ts` serves a standalone Node origin on loopback port
8777. The Cloudflare hostname is intended to route to this origin. The service
reads the existing registry and Run Store. Its optional AI Review action writes
a guarded request to the existing queue. Its optional status action writes the
configured GitHub Project field. It does not run a background poller or deliver
Discord messages.

## Data and trust boundaries

`snapshot.ts` validates the registry and reads SQLite in one read-only
transaction. Only present items in configured projects enter the view. A run is
the latest attempt for that Project item. The shared `projectRunStatus` policy
interprets repairs, current review SHAs and attention. Local resource paths,
configuration, tokens and review payloads are not part of the view model.

Issue and PR links must refer to the configured GitHub repository. Discord links
must match the configured guild and parent channel. Preview links require an
active running lease, an allowed hostname and an unexpired TTL. Rendering
escapes issue titles, descriptions of run stages and other source text.

The existing Cloudflare Zero Trust policy controls access to the tunnel route.
Projects binds to loopback and is reached only through the unified gateway at
`kurami.shagon1k.win`; the old `projects.shagon1k.win` host is gone. The gateway
verifies the signed Cloudflare Access assertion (`src/web/access.ts`, which uses
`access.ts` for issuer, algorithm, time bounds, audience, signature and owner email)
and marks the request as mounted. A request that does not come through the
gateway gets no owner identity and is refused; controls accept only the
`https://kurami.shagon1k.win` origin.

Public `/health` returns process liveness only; `/robots.txt` disallows indexing.
Responses are private and are not cached by the browser. CSP restricts scripts,
styles and connections to the same origin.

The site has no dependency on Hub's renderer, controls or access module.

## Runtime and commands

Use the bundled Node 24 runtime, then run:

```bash
npm run projects:serve
npm run test:projects-site
npm run test:projects-browser
```

`PROJECTS_PORT` defaults to the reserved port. `KURAMI_HOME` selects the directory
containing `config/projects.yaml` and `state/orchestrator.db`; set it explicitly
when running from a worktree. Access is verified by the gateway (`KURAMI_WEB_ACCESS_*`).
The tracked systemd unit reads an optional untracked Projects environment file.
Normal tunnel hosting does not require this file or the Access variables.

The browser checks SQLite-derived HTML every 30 seconds; this is a proposed UI
refresh interval. The server caches reads for five seconds. Project freshness
uses the existing two-minute admission boundary. These intervals do not change
the existing one-minute GitHub poller.

HTTP supports `GET` and `HEAD` for `/`, `/api/fragment`, and exact asset paths.
With `PROJECTS_STATUS_ENABLED=1`, `POST /api/status` accepts a status request.
With `PROJECTS_CONTROLS_ENABLED=1`, `POST /api/run-action` accepts other run
controls. Other mutation routes are rejected. With `PROJECTS_CONTROLS_ENABLED=1`,
`POST /api/ai-review` accepts a JSON request from the exact Projects
origin. Missing or cross-site Origin, other content types and bodies over 4 KiB
are rejected before the write adapter is called. Missing or incompatible SQLite state produces a
visible unavailable model without initializing a database. Private auth assertions
and underlying exception contents never enter logs or responses.

## Interface state and recommendations

English is the default; `?lang=ru` selects Russian. The fragment uses the same
query parameters as the page. Controls send their UI language through
`Accept-Language`; the HTTP boundary translates known request errors without
changing the underlying queue policy. Source content retains its original text.

Header project tabs set `project`. `sort=task|status|kurami` and `dir=asc|desc`
select a stable display sort. `q` is an immediate client search over the loaded
project rows. Retired `view` and `status` query filters no longer hide tasks.
History navigation retains the current task, project, search and sort selection.
Table/panel scroll and unchanged status drafts survive fragment replacement.

The snapshot reads `project_triage_rankings` joined to `project_triage_state` on
project and factual hash in the existing read transaction. A recommendation
must match the item's ID and issue number, a present backlog Issue, a fresh
project and a non-active run. Future/invalid ranking times and changed facts are
excluded. The view exposes only the explanation and recommendation timestamps;
it does not modify ranking state, query Discord or start a separate scheduler.

## AI Review requests

`actions.ts` writes one control request and its Projects context in a single
`BEGIN IMMEDIATE` transaction. Shared stable-worktree eligibility is also used
by the existing request CLI. The site additionally checks the current run,
configured repository, source freshness, displayed SHA, conflicting work and
already completed review evidence. A client nonce provides durable retry
identity; an existing pending AI Review request from Discord is reused.

Migration 33 adds `projects` to the source allowlist and a context table with the
actor marker (or signed subject in Access mode), PR URL and expected SHA. Its table rebuild preserves
control history, dependent evidence and indexes, including schema 32 recovery
operations. The origin never applies migrations or starts workers itself.

The review manager validates the Projects context against the live PR and local
worktree before starting the existing worker. A different PR/SHA or missing
Projects context rejects the request. Existing Discord/CLI request behavior is
preserved. The normal Discord reconciliation observes the same pending request
and review result; Projects reads that same queue and evidence on refresh.

Controls default to disabled. The base service retains a read-only filesystem.
After applying schema 33 through the existing migration workflow, install the
optional `deploy/systemd/kurami-projects.service.d/controls.conf` drop-in under
the user service's `kurami-projects.service.d/` directory. It enables controls
and permits writes only under the state directory. Avoid overriding its enable
flag in the environment file. Removing the drop-in restores inspection mode.
Queued requests retain their existing controller lifecycle.

## Project status requests

`status.ts` validates the displayed status, registry allowlist, current item and
successful source observation under the two-minute freshness boundary. A short
`BEGIN IMMEDIATE` transaction records the actor, nonce and intended transition
in migration 34's `project_status_requests`. One active request per item prevents
concurrent browser requests from issuing multiple writes. No network operation
runs inside the transaction.

`integrations/github/project-fields.ts` resolves the personal Project, its
configured single-select field and the target option through `gh api graphql`.
The action checks live item membership, repository or draft identity, archive
state and the previous status. It writes once, verifies the resulting field,
then waits for the normal GitHub poller. Only that poller updates `project_items`
and produces `project_events`; Discord and the controller consume their existing
flow. The site never changes the local item snapshot to simulate success.

A failed preflight creates no GitHub write. A lost write reply becomes
`uncertain`. After 30 seconds, checking the durable request reads GitHub and
resolves it without replaying the mutation. A new deliberate attempt uses a new
nonce after the prior operation has resolved. Pending intent survives a service
restart; stale checking/writing requests use the same read-only recovery.
`clientMutationId` verifies response identity and is not an idempotency guarantee.

GitHub's [status mutation input](https://docs.github.com/en/graphql/reference/projects#updateprojectv2itemfieldvalueinput)
has no expected previous value or conditional version. Preflight and subsequent
verification detect conflicts before and after a write, but cannot prevent an
external change in the interval between checking and writing from being
overwritten. A later conflicting edit is reported and is never rolled back.
Minute polling also observes snapshots, so rapid intermediate status changes
may not each become an event. The stable-transition test exercises the actual
poller twice and verifies one event for the requested change.

Status writes default to disabled independently of AI Review. After applying
schema 34 through the existing migration workflow, install the optional
`deploy/systemd/kurami-projects.service.d/status.conf` drop-in and provide the
service with authenticated GitHub CLI access to the configured Projects.
The drop-in enables status writes and grants access only to the state directory.
Removing it restores inspection-only status behavior. The origin never migrates
the Run Store. Status intent uses its existing backup and recovery.

## Remaining run actions

`run-actions.ts` uses the existing control menu and `requestRunControl` admission
policy exported from `controls/run.ts`. The CLI still uses these functions, with
its existing source allowlist and defaults. Projects contributes its actor marker,
durable nonce and fingerprint of the displayed run, resources, PR/SHA and preview
lease. Fresh source data, item presence, configured repository and latest run
are revalidated in one `BEGIN IMMEDIATE` transaction. A different fingerprint
requires refreshing before a new action. Existing pending requests from Discord
are reused, and retries of completed nonces return the stored result.

Migration 35 adds `project_action_requests` for this audit evidence. Queue actions
are inserted through the shared request function inside the same transaction,
including its pending progress-card presentation. The controller and Discord
continue their normal reconciliation. CI repair and Fix Review also record the
displayed PR/SHA in `run_control_project_context`; session startup validates that
context before capturing a repair or fetching actionable review threads.

Preview review is a direct acknowledgement through the existing preview manager
function, not a worker launch. Projects additionally requires an unexpired
running lease for the currently observed commit. The migration rebuilds
`preview_leases` to add `projects` to its review-source allowlist, preserving all
leases, static metadata, indexes and triggers. Acknowledgement, required-preview
satisfaction, history and owner audit commit together. The lease stores a hash
of the actor with Projects provenance; the audit stores the actor marker or signed subject in Access mode.
Existing Discord/CLI acknowledgement behavior and output remain unchanged.

Local and published discard require explicit confirmation in the browser and
`confirmed: true` on the authenticated request. Shared cancellation resolution
still validates the preserved work and live draft PR before cleanup. Projects
does not delete worktrees, stop processes or close PRs itself.

Apply schema 35 before offering these controls with the existing optional
controls drop-in. Older schemas keep the overview and AI Review available and
show that additional run actions are unavailable. No extra writable filesystem
paths or production services are required.

## Delivery and recovery

The service unit is `deploy/systemd/kurami-projects.service`. It listens on `http://127.0.0.1:8777` and is mounted by the gateway under
`kurami.shagon1k.win/<lang>/projects/`; the old `projects.shagon1k.win` route and
the `PROJECTS_ACCESS_*` variables are retired.
After changing runtime values, run
`systemctl --user restart kurami-projects.service`.
`curl http://127.0.0.1:8777/health` checks liveness; opening the hostname checks
the Cloudflare route and dashboard. The health endpoint does not verify Access
or database readiness.
Stopping only the Projects service rolls back this interface. The existing
GitHub/Discord process and Run Store continue to provide their normal workflow.

Metadata management follows [delivery](ROADMAP.md). It must retain explicit
field authority and shared eligibility/request boundaries.
