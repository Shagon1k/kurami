# Kurami web consolidation

Status: unified entry, PWA and agreed visual/mobile fixes deployed; the owner
accepted the phone walkthrough on 2 October 2026 ("Прошелся, норм"). The agreed
consolidation and UI scope is complete. On 3 October the owner accepted the latest mobile menus and confirmed deleting the four old app hostnames.
Audit procedure: [kurami-ui-audit-plan.md](kurami-ui-audit-plan.md).
Release history, automated evidence and coverage limits:
[kurami-ui-audit-findings.md](kurami-ui-audit-findings.md). The latest product
feedback fixes were `ea22cdf`, their bilingual classification was `96a6b4b`, and
their published release journal was `22ad7df`. The subsequent refinement package
`97e3952` is now deployed; its release evidence is in the refinement plan below.
Owner acceptance is recorded separately
from automated checks; it is not a claim that every device/state was tested.
Release instructions: [kurami-web-operations.md](kurami-web-operations.md).

The next UI refinement is planned separately in
[kurami-ui-refinement-plan.md](kurami-ui-refinement-plan.md); local implementation
and checks completed on 2 October. The owner approved its release; all four
backends are updated and read-only origin smoke passed. Phone acceptance of the
new drag gestures was followed by the owner's final "Все норм" on 3 October.
The latest deployed correction is `b8056db`, classified by `788787f`: footer
underlines, text-only On page, wider panda and compact outline icons in Docs.
The owner's deletion of the old hostnames is recorded as owner evidence, not a
provider API read-back. Loopback origins remain required by the gateway.

The remaining migration cleanup is now implemented locally: canonical Digest
notification/report links, a unified Docs verifier and a guarded `web:release`
controller. Its first execution and app-bound Docs promotion require approval
of this package; no new deployment is claimed by these source changes.

## Approved boundary

Kurami uses `https://kurami.shagon1k.win` and a loopback gateway on port 8888.
Hub, Digest, Projects and Docs remain independently running services. Their
old public hostnames have been removed by the owner. Hermes,
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
| 2. Unified entry | All modules work under the new origin | Real-server gateway/browser tests; native product regressions; immutable Docs variants | Deployed and checked; owner accepted the phone walkthrough |
| 3. PWA | One installation covers all modules | Manifest ID/scope, credentialed manifest fetch behind Access, one worker, offline recovery and private-cache checks | Deployed; installation and icon follow-up accepted by owner |
| 4. Shared visual rules | Equal component roles look consistent | UI-library tests/guard/export; populated EN/RU light/dark screens; classified style exceptions | Agreed audit fixes verified and released; owner accepted reviewed UI |
| 5. Mobile polish | Layouts are comfortable on narrow devices | Hub period capsule and Tasks spacing; populated app screens, overlays and real phone checks | Agreed fixes verified and released; phone walkthrough accepted |
| 6. Release readiness | Integrated candidate is ready for owner acceptance | Type checks, product regressions, visual acceptance, bilingual docs and rollback runbook | Release verified; owner acceptance received on 2 October |

Phase 2 depends on phase 1. PWA depends on the routing contract; visual and mobile
work does not depend on production cutover. Expand implementation detail only
for the active phase. Temporary notes must be consolidated into durable docs
when their phase closes; do not create a second permanent source of truth.

Readiness, human acceptance, and production deployment are separate boundaries.
Stage/commit/push/deploy only after explicit owner approval of the release scope.
The owner has retired the old public app hostnames. Preserve loopback origins
and recorded code/Docs artifacts for rollback under the unified hostname.

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

The PWA uses the fox illustration, not the favicon. The owner accepted the
installed app, then requested a sharper splash mark and a larger launcher fox.
The cosmetic follow-up adds a reviewed high-resolution reconstruction with
transparent and adaptive exports; the adaptive background is plain theme paper,
not an illustration. Native header/favicons stay unchanged. This follow-up is
released and accepted by the owner before the UI audit continued. Export details
are in [the brand asset notes](../src/ui-library/assets/brand/README.md).

## Remaining acceptance and cutover

- Owner confirmed the new owner-only Access policy; its AUD was obtained from Cloudflare-signed metadata. Gateway binds to `127.0.0.1:8888` and rejects requests without an assertion.
- No new Docs reader audience is configured. Existing native Docs service access retains its scope; a unified Docs reader needs a separately approved policy.
- Owner accepted the phone walkthrough on 2 October after the final UI follow-up. Detailed screen-reader, font CLS and every cold/warm/network state are not individually certified by that report.
- Owner confirmed deletion of the four native app hostnames on 3 October. No redirect rollout or closure of the loopback origins is part of this operation.

## Initial local evidence (historical)

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

These initial counts did not prove a complete visual audit. Weekly/Stocks screenshots
include empty states; Cinema's legacy-header example and minimal Digest gateway
fixtures did not cover full editions. The subsequent populated audit, additional
states, regression results and owner acceptance are recorded in the linked
journal. The current guard retains 57 exceptions; they are not
automatically 57 UI defects or a reason to rewrite legitimate product layouts.

The local tests did not change Access policy or exercise real mutation controls.
The subsequently approved deployment restarted the four web backends, promoted
a clean Docs snapshot with native/mounted variants, and enabled the new gateway.
Previous Docs artifacts and unit files were retained for rollback. Docs remains
a docs-only release (`revision: null`), not an app-bound changelog publication.
An anonymous Access redirect and a local health response do not prove the owner's
authenticated experience or installed-phone acceptance. The subsequent owner
walkthrough provides human acceptance separately from this initial smoke.
