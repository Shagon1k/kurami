# Kurami web consolidation

Status: unified entry deployed on 1 October 2026 with owner approval; gateway
liveness and native origins checked. Authenticated unified-origin and Android
acceptance remain with the owner; full visual and mobile audit is pending.
Audit procedure: [kurami-ui-audit-plan.md](kurami-ui-audit-plan.md).
Release instructions: [kurami-web-operations.md](kurami-web-operations.md).

## Approved boundary

Kurami uses `https://kurami.shagon1k.win` and a loopback gateway on port 8888.
Hub, Digest, Projects and Docs remain independently running services. Their
existing hostnames stay available until a separately approved cutover. Hermes,
Dokploy, preview and go are outside the migration.

Routes are `/en/` (Hub), `/en/digest/`, `/en/projects/`, `/en/docs/` and their
Russian equivalents. Digest retains Daily, Cinema, Weekly and Stocks. `/`
defaults to English. One installed PWA is named Kurami.

No new metrics, orchestrator behaviour, source-content translations, SPA rewrite
or database migration belongs to this work. Existing functions remain intact.

## Delivery sequence

| Phase | Outcome | Evidence and acceptance | Status |
| --- | --- | --- | --- |
| 1. Baseline and contracts | Known route, authorization and rollback boundaries | Route and signed Access tests; loopback-only service; retained native ingress | Locally verified |
| 2. Unified entry | All modules work under the new origin | Real-server gateway/browser tests; native product regressions; immutable Docs variants | Deployed; anonymous Access redirect and native origins verified; owner's authenticated smoke pending |
| 3. PWA | One installation covers all modules | Manifest ID/scope, one worker, offline recovery and private-cache checks | Deployed; real Android acceptance pending |
| 4. Shared visual rules | Equal component roles look consistent | UI-library tests/guard/export; populated EN/RU light/dark screens; classified style exceptions | Selected shared changes checked; full visual audit pending |
| 5. Mobile polish | Layouts are comfortable on narrow devices | Hub period capsule and Tasks spacing; populated app screens, overlays and real phone checks | Selected fixes checked; full mobile audit and phone acceptance pending |
| 6. Release readiness | Integrated candidate is ready for owner acceptance | Type checks, product regressions, visual acceptance, bilingual docs and rollback runbook | Scoped deployment approved and executed; full visual and installed-phone acceptance pending |

Phase 2 depends on phase 1. PWA depends on the routing contract; visual and mobile
work does not depend on production cutover. Expand implementation detail only
for the active phase. Temporary notes must be consolidated into durable docs
when their phase closes; do not create a second permanent source of truth.

Readiness, human acceptance, and production deployment are separate boundaries.
Stage/commit/push/deploy only after explicit owner approval of the release scope.
Keep old ingress available for rollback; change it to redirects only after new
origin and installed-PWA checks pass.

## Security and operational requirements

- Validate signed Access assertions; the new gateway fails closed without Access configuration.
- The owner-only Access policy is the identity source of truth. An optional email allowlist adds a local restriction; human app assertions are required for owner access.
- Owner access and read-only Docs service access have different scopes. Docs credentials never grant Hub/Projects access.
- Preserve Origin/CSRF checks and confirmations for actions. Do not test real destructive controls during browser QA.
- Gateway routing must not rewrite arbitrary upstream HTML or disable CSP/CORS.
- Public URLs are projected by the owning application's presentation layer; retained Digest editions keep their stored content.
- Namespace app APIs/resources, preserve filters/query/anchors, and reject ambiguous/traversal paths.
- Cache only explicitly allowed public static assets; never cache private dashboards, API responses, login pages or mutations.
- Observe gateway health and bounded failures without exposing secrets or private data.

## Visual contract

Use Hub/Docs as references: warm surfaces, restrained borders, ochre data accents,
red brand/failure accents, and semantic status colours. Reading pages and task
tables may retain different density. Reuse `src/ui-library/`; remove local
component overrides rather than adding competing styles.

Rename Sites to Apps/Приложения, distinguish external admin links, and show
Kurami. Hub/Digest/Projects/Docs in the shared header. Mobile Hub gets one global
7/30-day control without a dedicated header row; it must account for safe areas
and leave clearance for the final content and primary actions.

The PWA icon uses the existing fox illustration, not the favicon. Use the
transparent 512px source; do not add an illustrated background. Android may add
its own launcher background: verify on the owner's phone and seek approval for
any alternative instead of silently adding a maskable backdrop.

## Remaining acceptance and cutover

- Owner confirmed the new owner-only Access policy; its AUD was obtained from Cloudflare-signed metadata. Gateway binds to `127.0.0.1:8888` and rejects requests without an assertion.
- No new Docs reader audience is configured. Existing native Docs service access retains its scope; a unified Docs reader needs a separately approved policy.
- Owner reviews representative visual changes and tests the installed PWA on Android Chrome.
- Verify the authenticated unified entry and approve hostname redirect cutover separately. Old hostnames remain available.

## Local evidence

- `npm run check`, `test:web`, `test:web-browser`: routes, resources, APIs,
  malformed paths, signed owner assertions, separate Docs reader scope, private
  cache policy, 48 mounted EN/RU views at 320/390/1280px, shared theme, ordinary
  reload, Projects details/language links, control reads and offline recovery.
- `test:hub`, `test:hub-browser`, `test:projects-site`, `test:projects-browser`:
  existing snapshots, controls, confirmations and native-origin interactions.
- `test:briefing-header`, `test:briefing-stocks`, `test:briefing-weekly`,
  `test:briefing-mail-ui`, `test:briefing-interest`, `test:briefing-cinema`:
  existing Digest sections and actions remain covered by temporary fixtures.
- `test:docs`: 66 bilingual pages, release-only serving, native/mounted byte
  separation, audit/deployment boundaries. Preview metadata was not promoted.
- `test:ui-library`, `test:ui-guard`, `test:ui-browser`, `ui:export`: shared
  component contracts, 584 accessibility/inventory/theme checks, 60 light/dark
  screenshots. Frozen style exceptions reduced from 60 to 58; none added.
- Screenshots are generated under `dist/ui-browser`, `dist/hub-browser` and
  `dist/web-browser`. They contain synthetic data and are not release artifacts.

These counts do not prove a complete visual audit. Weekly/Stocks screenshots
include empty states; Cinema's legacy-header example and minimal Digest gateway
fixtures do not cover full editions. Execute the linked audit plan with populated
screens, disclosures and mobile states before closing phases 4 and 5. The 58
guard exceptions require classification, not automatic treatment as 58 UI defects.

The local tests did not change Access policy or exercise real mutation controls.
The subsequently approved deployment restarted the four web backends, promoted
a clean Docs snapshot with native/mounted variants, and enabled the new gateway.
Previous Docs artifacts and unit files were retained for rollback. Docs remains
a docs-only release (`revision: null`), not an app-bound changelog publication.
An anonymous Access redirect and a local health response do not prove the owner's
authenticated experience or installed-phone acceptance.
