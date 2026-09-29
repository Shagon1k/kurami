# Human docs: build and release boundary

The human documentation is a separate static site in this repository, not a route inside the Digest server. `src/human-docs/content.ts` assembles pages from the five section modules in `src/human-docs/content/`; the theme, fonts and shared foundations live in `src/ui-library/`, and generated files in ignored `dist/human-docs/`. Both `/en/` and `/ru/` have complete matching routes. The production origin redirects `/` and `/index.html` to `/en/`; the artifact has no language-choice page. This site describes the currently verified system, not planned capabilities.

## Content authoring

Add a page to its section module under `src/human-docs/content/`. Keep the EN and RU title, navigation title, summary and blocks together. A page answers one reader question. Prefer explicit `diagram` (registered visual ID plus a prose equivalent), `table` (caption, columns and rows), `callout` (note/limit/warning), `example` (visibly synthetic), `technical` (inline disclosure, with optional escaped pseudocode) and `source-links` blocks. The `html` and `details` blocks remain for existing copy during migration; do not embed visual markers or disclosure markup in HTML. Register a new visual ID in `content/schema.ts` and implement it in `render.ts`; for an SVG, keep editable source and a text equivalent alongside the image.

Digest's visible sidebar order and subgroup labels live in `digestNavigation` in `content/digest.ts`. Keep `For me` with Daily news, and keep Weekly and Cinema as separate entries. The older `weekly-cinema` and `stocks-review` comparison URLs stay generated for existing links but are not menu parents.

The build checks unique safe routes, non-empty EN/RU fields, block structure and table dimensions, unsafe markup, locale-specific links and referenced repository paths before replacing a preview artifact. `source-links` paths (or legacy page-level `sources`) are repository-relative; rendered GitHub links point to an exact revision. A docs-only or preview source revision is **not** evidence that the application code is deployed. Add source references while fact-checking each section, not by copying every internal file into the public page.

For a UI screenshot, first author only invented data in `src/human-docs/fixtures/`. The current `synthetic-daily.ts` generator emits a CSP-locked, network-isolated example and captures it into ignored `dist/human-docs-synthetic/` with `npm run docs:capture-synthetic -- en light /absolute/path/to/chromium` (choose `en|ru` and `light|dark`). Do not point this command at a live or authenticated site. Review every captured pixel, locale, theme and width before moving an image into tracked docs assets; keep the visible synthetic label and a text equivalent. The headless-shell binary successfully captured and visually checked all four language/theme variants; the standard Chromium binary hung locally. These preview PNGs are **not** a claim about the current Digest UI and are not approved for publication in an article.

For an editorial change, run `npm run check`, `npm run test:docs` and `npm run docs:build`, then inspect both languages, mobile layout, keyboard flow and light/dark contrast. The content model catches structural mistakes; it cannot prove that a claim is current, that a diagram is readable, or that a deployment happened. A later app-bound release still needs the trusted deployment revision and curated bilingual changelog classification described below. For product pull requests, use the [documentation-impact map](human-docs-impact-map.md) and its CI declaration gate; that check does not write prose for you.

For the Daily section, `npm run test:docs:browser-daily -- /absolute/path/to/headless-shell` checks `daily`, `daily-addons` and `daily-lifecycle` in EN/RU at 390, 800 and 1280 px in both themes. It needs a built preview and writes five representative screenshots, including the expanded mobile section list, to ignored `dist/human-docs-browser-qa/`. It also checks Enter-key operation of the mobile menu, grouped section list, inline disclosure and theme switch on one representative route. This is local layout, asset and basic keyboard QA, not authenticated production smoke or a replacement for manual focus-order, contrast and content review.

For the Weekly/Cinema batch, run `npm run test:docs:browser-weekly -- /absolute/path/to/headless-shell` after rebuilding the preview. It applies the same checks to `weekly-cinema`, `weekly` and `cinema`. The screenshot filenames include the route and language, so both batches can share the ignored output directory.

For the Operations section, run `node tests/human-docs/browser-preview.ts --routes=health,scheduling,recovery /absolute/path/to/headless-shell` and then the same command with `--routes=maintenance,connector-authority,automation-boundaries`. Both commands inspect an unpublished local build only. The Recovery topology is generated from editable EN/RU Excalidraw scenes with `node src/human-docs/diagrams/build-recovery-topology.ts`; after regeneration inspect the SVG at mobile size, both themes and both languages, and keep the adjacent prose and source/limit table. The Health card on its page is synthetic HTML, not a live Discord capture.

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
| `drafting` | Waits until the summary is two minutes old (or four hours pass). No change → `empty`, no card. Otherwise drops paths outside the allowlist (`src/human-docs/content/*.ts` except `schema.ts`, `src/human-docs/changelog.json`, `tests/human-docs/verify.ts`, `docs/human-docs-coverage-audit.md`), runs `tests/human-docs/verify.ts`, commits, pushes, opens a PR and posts the card to the audit job's Discord destination → `ready`. Failed checks → `failed` with a card offering Discuss and Reject. |
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

## Visual provenance

The site shares the `src/ui-library/` theme, foundations and self-hosted fonts (with their OFL licence texts) with Digest. Docs-specific components live in `src/human-docs/`; Digest-specific story components remain in Digest; the fox and favicon come from the existing Kurami preview assets. The homepage map is responsive HTML. The article system map, Daily publication/recovery map and Project run-state map have editable EN/RU Excalidraw scenes under `src/human-docs/diagrams/`. Regenerate their static SVGs with the corresponding `node src/human-docs/diagrams/build-*.ts` script named in the diagram catalog. Each image needs a text alternative and adjacent prose; inspect each export at native and narrow-screen width after editing. Avoid screenshots from private live data unless reviewed and redacted before committing.
