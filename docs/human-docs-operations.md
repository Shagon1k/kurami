# Human docs: build and release boundary

The human documentation is a separate static site in this repository, not a route inside the Digest server. Source pages are in `src/human-docs/content.ts`, visual tokens in `src/shared-ui/tokens.ts`, and generated files in ignored `dist/human-docs/`. Both `/en/` and `/ru/` have complete matching routes. The production origin redirects `/` and `/index.html` to `/en/`; the artifact has no language-choice page. This site describes the currently verified system, not planned capabilities.

## Local preview

```sh
npm run check
npm run test:docs
npm run docs:build
python3 -m http.server 8799 --bind 127.0.0.1 --directory dist/human-docs
```

Open `http://127.0.0.1:8799/ru/`. The preview changelog intentionally contains no entries and says it has no confirmed deployment revision. A locally served preview is **not** Cloudflare Access protected; never bind this preview to a public address or serve it through the production hostname.

## Changelog contract

`src/human-docs/changelog.json` contains reviewed English and Russian summaries keyed by full commit SHA. The baseline is a Git commit. With a **trusted deployment controller's** successful app revision, the builder reads the actual commit range from baseline through that revision. It does not use `HEAD` as the deployed app revision. Every commit in that range requires a bilingual classification; a docs-only commit may be explicitly excluded, but the builder checks that its changed paths are only human docs sources/tests or the two human docs design/operations documents. A missing classification, unsafe linked route, failed manifest, unknown SHA, or non-ancestor revision fails the app-bound release build.

A build-time flag is **not proof** by itself. The release controller must supply a manifest outside the repository after verifying a successful application deployment:

```json
{"status":"succeeded","appSha":"<full Git commit SHA of verified deployed app>"}
```

If the app deployment cannot be verified, `npm run docs:build-docs-release` from a clean checkout publishes only the docs snapshot. It records `docsSha` as the docs source revision and `revision: null` for the app; the changelog stays empty and explicitly says it has no verified app revision. This is not a substitute for the app-bound changelog. When deployment evidence arrives, run `npm run docs:build-release -- /absolute/path/to/trusted-manifest.json` from a clean checkout. The app-bound build rejects application-code changes newer than the verified app revision; docs-only commits may follow it. `dist/human-docs/build.json` records both the docs SHA and verified app revision (or null). Do not claim that a new code commit is live just because it was pushed or because docs built.

For each meaningful behavior change, update its short human page and add a bilingual changelog entry or a narrowly justified docs-only exclusion in the same change. A periodic audit can catch drift, but must not replace this review gate. Do not generate public copy from raw commit subjects or model summaries during deployment.

## Publication — localhost origin

The repository includes `deploy/systemd/kurami-human-docs.service`. The user unit is linked and enabled, rooted at `/home/shagon1k/_hermes/_kurami/state/human-docs/release/` and bound to `127.0.0.1:8799`. The server rejects preview builds, serves only generated routes/assets, and does not expose `build.json`. A fixture smoke test on this exact port passed before the first docs-only release. A later app-bound release must use a verified manifest, be promoted to the dedicated state directory, and be followed by a service restart and local/authenticated smoke checks. Never point the unit at `dist/human-docs/`: preview builds can overwrite that path.

At inspection time, `docs.shagon1k.win` resolved and unauthenticated requests for `/`, `/ru/`, `/en/`, and `/assets/docs.css` each returned HTTP 302 to Cloudflare Access. This verifies the anonymous edge gate, **not** the Access identity policy or the origin behind it. Do not recreate or overwrite the existing DNS/Access setup on assumption. Before any provider mutation, inspect the existing Tunnel route and Access application read-only, confirm exact owner-approved changes, and check that unauthenticated requests cannot reach `/`, `/ru/`, `/en/` or assets. The static origin should bind only to localhost behind the authenticated ingress; never bind it to `0.0.0.0`. Keep content safe even behind Access: no credentials, personal mail, portfolio holdings, or raw provider data in Git or screenshots.

Deployment and provider-side changes require explicit owner approval for the exact operation. The origin does not itself prove the Tunnel's authenticated route or Access policy; verify those separately without provider mutation.

## Visual provenance

The site shares semantic theme tokens with Digest. Generic docs components live separately; Digest-specific story components remain in Digest. Fonts are bundled under `src/human-docs/assets/` with their OFL license texts; the fox and favicon come from the existing Kurami preview assets. The system map is responsive HTML so its text stays accessible. Diagram authorship can move to Excalidraw sources where a more complex diagram earns the maintenance cost. Avoid screenshots from private live data unless reviewed and redacted before committing.
