# Human docs: build and release boundary

The human documentation is a separate static site in this repository, not a route inside the Digest server. `src/human-docs/content.ts` loads the Markdown pages under `src/human-docs/content/pages/` (one `.ru.md` and one `.en.md` per page); the theme, fonts and shared foundations live in `src/ui-library/`, and generated files in ignored `dist/human-docs/`. Both `/en/` and `/ru/` have complete matching routes. The production origin redirects `/` and `/index.html` to `/en/`; the artifact has no language-choice page. This site describes the currently verified system, not planned capabilities.

## Content authoring

Write pages as described in `docs/human-docs-concept.md`: a Markdown file per language under `src/human-docs/content/pages/<section>/`, placed in the menu by its frontmatter (`section`, `group`, `order`). The build rejects raw HTML, unknown blocks, links to missing pages or repository paths, diagrams wider than 980 px and any structural difference between the EN and RU versions. Check a page with `node src/human-docs/tools/check-pages.ts <slug> --shots=/abs/dir` and look at the screenshots.

Routes of the first site that no longer exist as pages are kept as redirects in `aliases` in `src/human-docs/content/site.ts`; every route in `legacyRoutes` must stay a page or an alias, because changelog entries and bookmarks use them. Reference tables of states and database tables are generated from `migrations/` by `src/human-docs/reference.ts`; describe every new table in `src/human-docs/reference-notes.ts` or the build fails.

The build checks unique safe routes, non-empty EN/RU fields, block structure and table dimensions, unsafe markup, locale-specific links and referenced repository paths before replacing a preview artifact. `source-links` paths (or legacy page-level `sources`) are repository-relative; rendered GitHub links point to an exact revision. A docs-only or preview source revision is **not** evidence that the application code is deployed. Add source references while fact-checking each section, not by copying every internal file into the public page.

For a UI screenshot, first author only invented data in `src/human-docs/fixtures/`. The current `synthetic-daily.ts` generator emits a CSP-locked, network-isolated example and captures it into ignored `dist/human-docs-synthetic/` with `npm run docs:capture-synthetic -- en light /absolute/path/to/chromium` (choose `en|ru` and `light|dark`). Do not point this command at a live or authenticated site. Review every captured pixel, locale, theme and width before moving an image into tracked docs assets; keep the visible synthetic label and a text equivalent. The headless-shell binary successfully captured and visually checked all four language/theme variants; the standard Chromium binary hung locally. These preview PNGs are **not** a claim about the current Digest UI and are not approved for publication in an article.

For an editorial change, run `npm run check`, `npm run test:docs` and `npm run docs:build`, then inspect both languages, mobile layout, keyboard flow and light/dark contrast. The content model catches structural mistakes; it cannot prove that a claim is current, that a diagram is readable, or that a deployment happened. A later app-bound release still needs the trusted deployment revision and curated bilingual changelog classification described below. For product pull requests, use the [documentation-impact map](human-docs-impact-map.md) and its CI declaration gate; that check does not write prose for you.

For the Daily section, `npm run test:docs:browser-daily -- /absolute/path/to/headless-shell` checks `daily`, `daily-addons` and `daily-lifecycle` in EN/RU at 390, 800 and 1280 px in both themes. It needs a built preview and writes five representative screenshots, including the expanded mobile section list, to ignored `dist/human-docs-browser-qa/`. It also checks Enter-key operation of the mobile menu, grouped section list, inline disclosure and theme switch on one representative route. This is local layout, asset and basic keyboard QA, not authenticated production smoke or a replacement for manual focus-order, contrast and content review.

For the Weekly/Cinema batch, run `npm run test:docs:browser-weekly -- /absolute/path/to/headless-shell` after rebuilding the preview. It applies the same checks to `weekly-cinema`, `weekly` and `cinema`. The screenshot filenames include the route and language, so both batches can share the ignored output directory.

To check a subset of routes in a browser, pass `--routes=<slug,slug>` to `node tests/human-docs/browser-preview.ts` with the headless-shell path. These commands inspect an unpublished local build only.

For a site-wide local pass, build the preview and run `node tests/human-docs/browser-preview.ts --all --a11y /absolute/path/to/headless-shell`. This covers home, changelog and every article in EN/RU at 390, 800 and 1280 px in both themes. It checks overflow, image loading, headings, captions, control and navigation names, current-page semantics, theme state and visible-text contrast against the nearest opaque background. At mobile width it also operates skip navigation, menus, disclosures and the theme switch by keyboard, and checks reduced-motion scrolling. This does not inspect text baked into SVGs, every translucent colour layer, the full screen-reader experience or the authenticated production site. Review representative screenshots and diagram labels manually.

## Local preview

```sh
npm run check
npm run test:docs
npm run docs:build
python3 -m http.server 8799 --bind 127.0.0.1 --directory dist/human-docs
```

Open `http://127.0.0.1:8799/ru/`. The preview changelog intentionally contains no entries and says it has no confirmed deployment revision. A locally served preview is **not** Cloudflare Access protected; never bind this preview to a public address or serve it through the production hostname.

## Changelog contract

`src/human-docs/changelog.json` contains reviewed English and Russian summaries keyed by full commit SHA. The baseline is a Git commit. With a **trusted deployment controller's** successful app revision, the builder reads the actual commit range from baseline through that revision. It does not use `HEAD` as the deployed app revision. Every content-bearing commit in that range needs a classification. A docs-only commit may be explicitly excluded; the builder checks its changed paths against the narrow human-docs allowlist. The one internal Interest Profile reference correction is allowed by its exact path, not by exempting all `docs/` files. A `package.json` difference is allowed only when all other fields and scripts match and the difference is limited to `docs:*`, `test:docs` or `test:docs:*` scripts. An internal refactor may be explicitly classified as having no reader-visible change, with a specific review reason; the builder cannot prove that judgment, so the reviewer must inspect it. A contentless merge is skipped only when its tree matches a parent. A missing classification, unsafe linked route, failed manifest, unknown SHA, or non-ancestor revision fails the app-bound release build.

A build-time flag is **not proof** by itself. The release controller must supply a manifest outside the repository after verifying a successful application deployment:

```json
{"status":"succeeded","appSha":"<full Git commit SHA of verified deployed app>"}
```

If the app deployment cannot be verified, `npm run docs:build-docs-release` from a clean checkout publishes only the docs snapshot. It records `docsSha` as the docs source revision and `revision: null` for the app; the changelog stays empty and explicitly says it has no verified app revision. This is not a substitute for the app-bound changelog. When deployment evidence arrives, run `npm run docs:build-release -- /absolute/path/to/trusted-manifest.json` from a clean checkout. The app-bound build rejects application-code changes newer than the verified app revision; docs-only commits may follow it. `dist/human-docs/build.json` records both the docs SHA and verified app revision (or null). Do not claim that a new code commit is live just because it was pushed or because docs built.

For each meaningful behavior change, update its short human page and prepare a bilingual changelog summary, whether the change uses a PR or a direct commit. Once the final commit SHA exists, classify it in the ledger before an app-bound release. For an internal-only change, record why the reader-facing contract is unchanged. The PR docs-impact gate checks declarations and affected sections only for PRs; the release gate checks the SHA ledger and deployment revision for either path. Neither generates copy from raw commit subjects. A periodic audit can catch drift but cannot prove that its own prose is correct or that a commit was deployed.

### Weekly drift audit — installed, first delivery pending

The owner chose `#updates` for a short Hermes report about documentation and changelog freshness. The read-only inventory is `npm run docs:audit -- --source-ref HEAD`, with optional `--docs-build /absolute/path/to/promoted/build.json` and `--deployment-manifest /absolute/path/to/trusted/manifest.json`. It uses the promoted docs SHA as the comparison point, falling back to the changelog baseline when no release marker is supplied; a failed audit cannot advance either marker. It lists direct commits, changed paths and missing SHA classifications without reading commit prose, writing files, fetching Git refs or sending Discord messages. The installed Hermes job is named `kurami-docs-freshness`; its task text is in `src/human-docs/automation/weekly-audit.md`. Keep the delivery channel ID in Hermes configuration, not rendered pages or Git. Git `HEAD`, a push and the job's success are not deploy evidence. When the deployed revision is unknown, report that limit and do not add app-visible changelog entries.

The installed configuration has these boundaries:

1. A dedicated standalone clone of `main` has full history and a local `.git/kurami-docs-audit` marker. It is separate from the application checkout and managed worktrees. The wrapper refuses unmarked clones, linked worktrees, dirty trees, non-`main` branches and a local `main` ahead of `origin/main`.
2. The active Hermes profile has a copy of `src/human-docs/automation/hermes-wrapper.sh` in `scripts/` and a local launcher there. The launcher supplies the clone and promoted `build.json` paths outside Git. No app-deployment manifest is configured because none has been verified. Hermes does not apply an agent job's `workdir` to its pre-run script.
3. The enabled job has candidate ticks at `0 3,4 * * 1` on the observed UTC scheduler. `cron-payload.ts` silently skips whichever tick is not Monday 06:00 in `Europe/Vilnius`. The first candidate is due on 2026-10-05 at 03:00 UTC. The job's Discord destination is stored only in Hermes configuration.
4. The clone guard, winter/summer gate, clean fast-forward, syntax and off-tick skip passed local tests. The first scheduled agent run and Discord delivery are not yet observed. Pause `kurami-docs-freshness` if a live failure or unexpected report needs investigation; preserve the clone and job history for diagnosis.

On the due tick, the wrapper fetches and fast-forwards only its marked clone from `origin/main` before running the read-only inventory. It never updates the canonical application checkout. A divergent or unreachable remote fails the pre-run script; Hermes passes that failure to the agent as an error for reporting, rather than silently treating it as a successful audit. Git read access passed with the scheduler's sanitized subprocess environment. Live delivery still needs the first scheduled smoke. Do not point the job at an active development worktree.

The task requests a concise `#updates` report even for an empty successful audit, distinguishing checked, drafted and awaiting-owner states. Do not send a public release announcement merely because the audit ran. The owner chose Monday at 06:00 local time to keep the report separate from Daily at 09:00. Changelog day headings use the Git committer's calendar date and say so explicitly; they are not deployment or docs-publication dates. Keep `#maintenance` for backup and housekeeping reports.

### Owner-approved proposals

The audit no longer stops at a report. `cron-payload.ts` asks `src/human-docs/approval/prepare.ts` for a draft: a linked worktree of the audit clone on its own `docs/weekly-<date>-<id>` branch under `state/human-docs/drafts/<id>/`, recorded as `drafting` in `state/human-docs/proposals.db`. While another proposal is `drafting`, `ready`, `revising` or `publishing`, no draft is created and the payload says which one blocks it. The agent edits only that worktree and, last, writes `summary.json` next to it.

The worker `src/human-docs/approval/worker.ts` runs every minute through the Hermes `no_agent` job `kurami-docs-approval` (`integrations/hermes/scripts/kurami-docs-approval.sh` → `run-docs-approval.sh`, `flock`-guarded; a busy tick exits silently). Per proposal:

| State | Worker step |
| --- | --- |
| `drafting` | Waits until the summary is two minutes old (or four hours pass). No change → `empty`, no card. Otherwise drops paths outside the allowlist (the Markdown pages under `src/human-docs/content/pages/`, `src/human-docs/changelog.json`, `tests/human-docs/verify.ts`, `docs/human-docs-coverage-audit.md`), runs `tests/human-docs/verify.ts`, commits, pushes, opens a PR and posts the card to the audit job's Discord destination → `ready`. Failed checks → `failed` with a card offering Discuss and Reject. |
| `revising` | Reads the discussion thread after the stored cursor, keeps only the single allowed owner's non-bot messages, runs `codex exec` in the draft with `workspace-write` sandbox and an output schema, then applies the same allowlist and checks. Failure resets the branch to the last good head and says why in the thread. |
| `publishing` | Requires the PR head to equal the head the card showed and every PR file to be allowlisted, squash-merges with `--match-head-commit`, builds `--docs-release` from `origin/main` in a throwaway detached worktree, swaps it into `release/` with the previous release kept as `rollback-<docsSha>`, restarts `kurami-human-docs` and requests `/en/` and `/ru/what-is-kurami/`. A failed smoke check puts the previous release back. A merge whose release failed shows only a release retry. |
| `published`, `rejected`, `empty` | Closes a rejected PR (the branch stays on GitHub), removes the draft worktree and local branch. |

Owner clicks arrive through the Discord plugin (`kurami:docs_(discuss|revise|publish|reject):dp_<12 hex>`, owner-only) and `src/human-docs/approval/controls.ts`, which only performs a guarded state change and refreshes the card. A click on a stale card is refused. The worker never deploys application code, never publishes without a Publish click, and a docs-only release still leaves the application changelog empty until a trusted deployment manifest exists.

Install after the change is on the live checkout:

```bash
bash bin/sync-hermes-plugin.sh --apply
systemctl --user restart hermes-gateway
install -m 0755 integrations/hermes/scripts/kurami-docs-approval.sh /home/shagon1k/_hermes/_core/scripts/
hermes cron create '* * * * *' --name kurami-docs-approval --script kurami-docs-approval.sh --no-agent --deliver local
python3 bin/sync-docs-audit-cron.py --apply --expect-job-id <kurami-docs-freshness id>
```

The worker log is `logs/docs-approval.log`. Pause `kurami-docs-approval` to stop all proposal activity; state stays in `proposals.db`.

## Publication — localhost origin

The repository includes `deploy/systemd/kurami-human-docs.service`. The user unit is linked and enabled, rooted at `/home/shagon1k/_hermes/_kurami/state/human-docs/release/` and bound to `127.0.0.1:8799`. The server rejects preview builds, serves only generated routes/assets, and does not expose `build.json`. A fixture smoke test on this exact port passed before the first docs-only release. A later app-bound release must use a verified manifest, be promoted to the dedicated state directory, and be followed by a service restart and local/authenticated smoke checks. Never point the unit at `dist/human-docs/`: preview builds can overwrite that path.

At inspection time, `docs.shagon1k.win` resolved and unauthenticated requests for `/`, `/ru/`, `/en/`, and `/assets/docs.css` each returned HTTP 302 to Cloudflare Access. This verifies the anonymous edge gate, **not** the Access identity policy or the origin behind it. Do not recreate or overwrite the existing DNS/Access setup on assumption. Before any provider mutation, inspect the existing Tunnel route and Access application read-only, confirm exact owner-approved changes, and check that unauthenticated requests cannot reach `/`, `/ru/`, `/en/` or assets. The static origin should bind only to localhost behind the authenticated ingress; never bind it to `0.0.0.0`. Keep content safe even behind Access: no credentials, personal mail, portfolio holdings, or raw provider data in Git or screenshots.

Deployment and provider-side changes require explicit owner approval for the exact operation. The origin does not itself prove the Tunnel's authenticated route or Access policy; verify those separately without provider mutation.

After any release, `npm run docs:verify-access` checks the public edge read-only. Anonymous requests for pages and an asset must redirect to Cloudflare Access; with the Access service token in `state/human-docs/access-client.json` (mode 600, exactly `client_id` and `client_secret`, never in Git) every page and asset must be byte-identical to `state/human-docs/release/`. Byte equality ties the edge to a release that the repository's own checks rendered, so the check needs no browser and does not break when page markup changes. Credentials are sent only to the docs origin.

Each release keeps the previous one as `rollback-<docsSha>`. The approval worker keeps the three newest rollback copies and removes older ones, plus `failed-*`/`stage-*` leftovers older than a day; `npm run docs:prune-releases` shows the same plan and `-- --apply` performs it after a manual release. Only folders holding a release `build.json` are touched. Any removed copy can be rebuilt from its docs revision.

## Visual provenance

The site shares the `src/ui-library/` theme, foundations and self-hosted fonts (with their OFL licence texts) with Digest and Hub. Docs-specific blocks (glance, steps, compare, cards, terms, guarantees, code map, figures) are docs layout in `src/human-docs/styles.ts`, built only from theme roles. Every diagram is a ```` ```diagram ```` block drawn at build time by `src/human-docs/diagrams/kit.ts` into SVG in the diagram palette; `inlineDiagram` maps those colours to theme roles, and each figure links a standalone SVG at `/assets/diagram-<id>.svg`. Screenshots are PNG files in `src/human-docs/assets/`, used only on guide pages in two sizes (`card`, `wide`). Avoid screenshots from private live data unless reviewed and redacted before committing.
