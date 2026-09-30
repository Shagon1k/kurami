# Projects runtime

`src/projects-site/server.ts` serves a standalone Node origin on loopback port
8777. The Cloudflare hostname is intended to route to this origin. The service
reads the existing registry and Run Store without changing either. It does not
poll GitHub or deliver Discord messages.

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

All task pages, fragments and assets require a signed Cloudflare Access assertion
for the configured application audience and owner email. `access.ts` verifies
issuer, algorithm, time bounds, application type, audience, signature and owner.
Missing configuration denies access. Public `/health` returns process liveness
only; `/robots.txt` disallows indexing. Responses are private and are not cached
by the browser. CSP restricts scripts, styles and connections to the same origin.

The access protocol follows [Cloudflare's JWT validation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
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
when running from a worktree. Private runtime variables are
`PROJECTS_ACCESS_TEAM`, `PROJECTS_ACCESS_AUDIENCE`, and `PROJECTS_OWNER_EMAIL`.
The tracked systemd unit reads these from the untracked Projects environment file.

The browser checks SQLite-derived HTML every 30 seconds; this is a proposed UI
refresh interval. The server caches reads for five seconds. Project freshness
uses the existing two-minute admission boundary. These intervals do not change
the existing one-minute GitHub poller.

HTTP supports `GET` and `HEAD` for `/`, `/api/fragment`, and exact asset paths.
Mutation methods are rejected. Missing or incompatible SQLite state produces a
visible unavailable model without initializing a database. Private auth assertions
and underlying exception contents never enter logs or responses.

## Delivery and recovery

The unit is prepared but not installed by this phase. Production requires the
Access application, owner policy, tunnel route and explicit release approval.
Stopping only the Projects service rolls back this interface. The existing
GitHub/Discord process and Run Store continue to provide their normal workflow.

Future actions must call shared eligibility and request boundaries, preserve
the requested PR SHA, and record web provenance. Project status changes must
write through GitHub and allow normal observation to create the transition;
updating the local item snapshot first could suppress that event. These changes
belong to the later phases in [delivery](ROADMAP.md).
