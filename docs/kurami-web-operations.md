# Unified web entry: release and rollback

This runbook covers the candidate gateway on `127.0.0.1:8888` for
`https://kurami.shagon1k.win`. It does not prove that the candidate is deployed.
The owner approves committing, pushing and deploying separately from local work.
The migration plan is [kurami-web-plan.md](kurami-web-plan.md).

## Architecture

The gateway validates Cloudflare Access assertions, selects an app and streams
its response. It does not rewrite response bodies. Existing services remain:

| App | Loopback port | Public EN entry |
| --- | --- | --- |
| Hub | 8800 | `/en/` |
| Digest | 8787 | `/en/digest/` |
| Projects | 8777 | `/en/projects/` |
| Docs | 8799 | `/en/docs/` |

RU changes the first segment to `/ru/`. `/` redirects to `/en/`. App-owned APIs,
fonts, media and styles use `/_apps/<app>/…`; filters, query strings and anchors
are preserved. Product presentation code generates mounted URLs. Docs builds
both native and mounted HTML/CSS as immutable artifacts under one release;
the server does not rewrite the published bytes. An older Docs release without
mounted artifacts returns 503 at the unified entry, not incorrectly rooted HTML.

Native hostnames remain functional. Hermes, Dokploy, preview and go are outside
the gateway. Their configuration and services are not part of this release.
Ordinary upstream reads have a 15-second inactivity timeout; writes and Hub
control reads allow 90 seconds so existing 60-second commands can finish.

## Before release

1. Get the owner's approval for the reviewed changes and the release scope.
2. Create an Access application for the new hostname with the owner-only policy.
   A tunnel hostname alone is insufficient. Obtain its Application AUD and team
   issuer; keep the owner's email and all credentials outside Git.
3. Create `$KURAMI_HOME/secrets/kurami-web.env` from
   `deploy/config/kurami-web.env.example`. Supply `KURAMI_WEB_ACCESS_TEAM`,
   `KURAMI_WEB_ACCESS_AUDIENCE`. The team value is
   the HTTPS Cloudflare Access team origin, without a trailing slash.
   Missing team/audience fails closed with 403. The owner-only Access policy
   determines who can enter; the gateway still requires a signed, unexpired
   human app assertion for that issuer and audience. Service-token assertions
   cannot enter as owner. `KURAMI_WEB_OWNER_EMAIL` optionally adds an email
   restriction; leave it empty to use the owner's approved edge policy.
   Do not use test authorization callbacks in a running service.
4. Leave `KURAMI_WEB_DOCS_AUDIENCE` empty unless a separate Docs reader policy
   is ready. Configure the Docs-only Access application/path policy and verify
   its issuer and audience. Its signed assertion allows only Docs GET/HEAD;
   it must be denied at Hub, Projects and all write endpoints. Existing Docs
   service-token credentials remain out of Git and keep their native scope.
5. Record the current app revision, installed service units, and the promoted
   Docs release/rollback path. Keep the old tunnel routes and Access apps.
6. Run `npm run check`, `test:web`, `test:web-browser`, `test:ui-library`,
   `test:ui-guard`, `test:ui-browser`, and the affected product regressions.
   Review the screenshots, not just test exit codes. Real Android installation
   still needs the owner; headless Chromium does not verify launcher appearance.

## Owner-approved deployment

Deploy the reviewed Git revision using the existing release process. Install the
repository versions of `kurami-web.service`, `kurami-hub.service` and
`kurami-projects.service` into the user systemd configuration. Hub and Projects
load the same optional private web environment file in addition to their native
settings, so mounted controls can validate the new Access AUD. Preserve existing
unit drop-ins and native Access audiences; do not replace them with the new AUD.

Rebuild and promote Docs through its approved release process from a clean
checkout; see [human-docs-operations.md](human-docs-operations.md). Its generated
`build.json` must include `webMount: true`. Do not turn preview metadata into a
release or treat `HEAD` as deployment evidence. Docs-only publication records
`revision: null`; app-bound publication requires the trusted deployment manifest
and reviewed bilingual classifications for the final commit SHA.

Reload user systemd and restart the affected backend services: Hub, Digest,
Projects and Docs. Enable/start `kurami-web`. Its unit binds only to loopback on
8888. No database migration or live agent/session restart is needed. The
Cloudflare tunnel target is `http://127.0.0.1:8888`, not a public listener.

Verify locally that `/health` returns only `{ "ok": true }` and a private request
without an assertion is denied. The health endpoint is liveness, not a claim
that all four backends are ready. Verify each backend and signed route separately.

## Acceptance checks

- An anonymous public request reaches Access login, not app content.
- The owner opens all four EN/RU modules, deep Docs links, Daily/Cinema archives,
  Weekly, Stocks, and Projects task details. Reload, Back, language switching,
  search, filters and saved theme work under the new paths.
- Read-only control views work. Write controls retain their origin/CSRF and
  explicit-confirmation protections. Do not smoke-test Restart, Reset, mail
  archival, or destructive task actions without specific owner approval.
- A Docs reader can fetch only Docs. Wrong audience, tampered/expired assertion,
  service-token owner access, foreign origin and malformed routes are denied.
  The owner verifies the Access policy's identity restriction; if an additional
  email allowlist is configured, a different email is also denied by the gateway.
- CSS, fonts, icons and media load after an ordinary reload. Unavailable app
  responses are bounded 502 errors; other apps remain reachable.
- Android Chrome installs **Kurami** from Hub; its manifest has stable ID `/`,
  start URL `/en/` and scope `/`. Switching among the four apps stays in the
  installed window. Hermes/Dokploy are external links. The icon uses the existing
  transparent 512px fox, with no illustrated backdrop; the Android launcher may
  add its own plate. Any replacement backdrop needs the owner's visual approval.
- One `/sw.js` worker covers the new origin. Private HTML, API responses and
  login pages are not cached. Offline navigation shows a connection placeholder,
  not an old dashboard. Restoring the network restores normal navigation.
- The old hostnames still work. Redirect cutover and removal need separate
  approval after installed-phone acceptance; never remove preview/go routes.

## Rollback

If the new origin fails acceptance, stop the new gateway and continue using the
retained native hostnames. Keep the reviewed candidate and logs for diagnosis;
do not delete services, credentials, data or branch history. If a backend change
also breaks a native hostname, redeploy its previously recorded revision/unit
through the normal release process. Restore the recorded Docs release using
its documented rollback process. Reload/restart only affected services.

Because cutover is separate, rollback does not require reconstructing deleted
DNS records or tunnel routes. Clear only this origin's Kurami service-worker
registration if browser diagnosis requires it; do not clear unrelated apps.
