---
title: How the docs are built
nav: Docs system
summary: What this site is assembled from, which checks keep pages from drifting away from the code, and how the weekly proposal of edits becomes a new release with a rollback.
section: platform
group: internals
order: 70
next: ui-library
---

The documentation is a static site built from Markdown files in the repository and published only after checks and your decision. The owner's weekly view is in [How the docs are updated](@docs-process).

:::glance
- What it does: builds the pages in Russian and English into HTML, draws the diagrams and reference tables, and serves them from a localhost server
- Triggered by: the build by `npm run docs:build` or by the worker at publish time; proposals by a Hermes job on Mondays
- Runs where: `src/human-docs/`, a separate systemd service `kurami-human-docs` on localhost port 8799 behind Cloudflare Access
- State: `state/human-docs/` — the live `release/`, earlier `rollback-<sha>/` and the proposal database `proposals.db`
- What you see: the Docs app at the unified Kurami entry and proposal cards in `#updates`
:::

```diagram
kind: graph
title: How pages become the site
desc: Paired Markdown files go through parsing and checks. Reference tables are built from the database migrations, our own kit draws the diagrams at build time, styles come from the UI library, and the changelog sits in a JSON file. Everything meets in the build, and the result lands in a directory with build.json.
node pages "Pages" "pages/*.ru.md and .en.md" store at 0,0
node migrations "Migrations" "database schema" store at 1,0
node ledger "changelog.json" "ledger by SHA" store at 2,0
node parse "Parse and checks" "parity, links, paths" at 0,1
node gen "Reference tables" "from the schema" at 1,1
node kit "Diagram kit" "three engines" at 2,1
node render "Build" "HTML, SVG, CSS" at 1,2
node ui "UI library" "themes and fonts" at 2,2
node dist "dist/human-docs" "and build.json" store at 1,3
edge pages -> parse
edge migrations -> gen
edge parse -> render
edge gen -> render
edge kit -> render "SVG"
edge ui -> render "styles"
edge ledger -> render "changes" muted
edge render -> dist
```

## Pages and format

Every page is two files, `<slug>.ru.md` and `<slug>.en.md`, in the directory of its section. The file header holds `title`, `summary`, `section`, `group`, `order` and `next`; the site menu is built from these alone. The structural fields `section`, `group`, `order` and `next` must be identical in both languages, or the build does not start. A parser of our own in `markdown.ts` does the parsing: headings, lists, tables, code blocks and containers such as `:::glance`. It accepts no raw HTML and treats an unknown block as an error.

The main check is language parity. The build compares the "skeleton" of the Russian and English versions: the number of second-level headings, the diagrams by node identifiers, screenshots, generated tables and the glance, guarantees and code-map blocks. The build also checks links to other pages and repository paths in the code-map, and the test `tests/human-docs/verify.ts` scans the text for personal data: names, a time zone, Discord identifiers and home paths.

On phones and tablets, an article with at least two sections has a compact **On this page** disclosure below its introduction. The section menu names the current page and keeps long lists inside a bounded scroll area. Screenshot dimensions come from the PNG files at build time, so lazy loading reserves their space. A missing article returns a 404 page with a link to Docs home, in the requested language.

## Diagrams

The pictures are drawn by our own kit, `diagrams/kit.ts`, which has three engines: `graph` for architecture, flows and state machines, `sequence` for message exchange and `timeline` for a day. A ` ```diagram ` block in Markdown turns into SVG at build time, not in the browser. The kit places the nodes itself, and the author gives positions `at column,row` where automatic layout is not enough.

The kit rejects a diagram that cannot be read: wider than 980 pixels or without a `desc` description. That description becomes the text alternative and helps those who cannot see the picture. In the dark theme the diagram colours are replaced by theme roles through `inlineDiagram`, and each picture has its own SVG at `/assets/diagram-<id>.svg`. The same kit can export a scene for Excalidraw: `npm run docs:excalidraw` writes files to `dist/human-docs-excalidraw/`. The source of truth stays in the Markdown; edits made in Excalidraw do not flow back.

## Reference tables from code

The reference tables of states and databases are built from the migrations, so they cannot drift from the code. The generator `reference.ts` applies every migration to an in-memory SQLite database and reads the schema back. Lists from `CHECK (column IN (…))` become the allowed values. A page embeds a table with `::generated{name="orchestrator-states"}`; the available names are `orchestrator-tables`, `digest-tables`, `orchestrator-states` and `digest-states`.

The description of each table is written by hand in `reference-notes.ts`. A new table without a description breaks the build, and so does a description for a table the migrations do not create.

## Build modes

| Mode | Command | Requires | Records | Changes |
|---|---|---|---|---|
| Preview | `npm run docs:build` | nothing | `mode: preview`, empty changelog | only the local `dist/`; the server will not accept it |
| Docs release | `npm run docs:build-docs-release` | a clean tree | `mode: release`, `docsSha` = `HEAD`, `revision: null` | preserves confirmed history without new application changes |
| App-bound | `npm run docs:build-release -- <manifest>` | a manifest `{status, appSha}` from a trusted deployment controller | `revision` = `appSha`, the changelog | adds the changes since the last release to the changelog |

The docs server starts only with `mode: release` and a 40-character `docsSha`, so a preview cannot be published by mistake. The application release controller requires an explicit approved SHA and a clean checkout. It builds, restarts the web services and checks their responses before writing a private success manifest. An app-bound Docs build uses that manifest; a push or documentation version is not deployment proof. When application sources are newer than the verified deployment, publication remains docs-only with `revision: null`. It preserves the confirmed journal and records its cutoff separately in `changelogRevision`. An initial build without a previous journal recovers history from the private successful manifest. Without either source, the journal is empty.

## Changelog

The ledger `changelog.json` stores Russian and English explanations keyed by full commit SHA. New publication starts at a verified baseline; older entries remain stored without being presented as confirmed deployment history. Every later reader-visible commit must be described. Docs-only changes can be excluded after their paths are checked; internal changes need a specific reason. Empty merges are skipped. An undescribed commit stops the build. Dates are commit dates, not deployment dates. Confirmed entries are saved in the `changelog-history.json` artifact and carried through docs-only updates. The build and publication stop if a new version loses entries in either language or moves the confirmed cutoff backwards.

The unified Docs verifier checks anonymous Access redirects and mounted file bytes separately. Without a private owner session it checks the loopback origin, not authenticated edge access. With that session it compares the same files through the unified public entry. It does not send the old Docs service token to the owner-only route.

## The weekly proposal

A proposal of edits is a record in `proposals.db` and a working copy of the docs on its own branch. The Monday audit creates a `drafting` record, the agent edits the working copy, and every minute the worker moves the record through the state machine and updates the card. The worker edits only an allowlist of files, described in [How the docs are updated](@docs-process), drops everything else before committing and rechecks before merging. Button clicks are validated and recorded atomically: two simultaneous clicks cannot both run.

```diagram
kind: graph
title: Proposal states
desc: A draft becomes ready if the checks pass, empty if there are no edits and failed if the checks fail. From ready you publish, reject or ask to apply remarks. After the merge, a release failure leaves failed with a release retry.
node drafting "drafting" "the agent writes" start at 0,1
node empty "empty" "no edits" state at 0,0
node ready "ready" "waits for you" wait at 1,1
node revising "revising" "remarks from the thread" state at 1,0
node publishing "publishing" "merge and release" state at 2,1
node published "published" "site updated" end at 2,0
node rejected "rejected" "PR closed" state at 1,2
node failed "failed" "reason on the card" fail at 2,2
edge drafting -> ready "checks passed"
edge drafting -> empty "no edits"
edge drafting -> failed "checks failed" accent
edge ready -> revising "Apply remarks"
edge revising -> ready "edits applied" dashed
edge ready -> publishing "Publish"
edge ready -> rejected "Reject"
edge publishing -> published "release passed"
edge publishing -> failed "release failed" accent
edge publishing -> ready "merge refused" dashed
edge failed -> publishing "Retry release" dashed
```

The wait can be long: a record stays `drafting` for at least two minutes after the agent writes the description, and for four hours from creation at most. While `publishing` runs, all buttons are closed. In the other states an unexpected exception in a tick moves the record to `failed` with the reason.

## Release and rollback

Publishing builds a new release from `main` in a throwaway working copy and swaps the whole `release/` directory. So a reader sees either the entire old site or the entire new one.

```diagram
kind: sequence
desc: You click Publish. The worker merges the PR with a head check, builds the release in a throwaway copy, renames release to rollback and puts the new directory in its place. Then it restarts the service and requests two pages. On failure it restores the previous release.
actor you "You" owner
actor worker "Worker"
actor gh "GitHub" external
actor site "Docs service"
msg you -> worker "Publish"
msg worker -> gh "squash merge"
self worker "build --docs-release"
self worker "release → rollback-sha"
msg worker -> site "restart"
msg worker -> site "GET /en/ and /ru/…"
phase "Failure"
self worker "failed-sha, restore rollback" accent
```

Before merging, the worker compares the PR head with the card and runs `gh pr merge --squash --match-head-commit`. It confirms the merged commit belongs to `origin/main` and builds a release. An existing private controller manifest supplies `revision`; without one the value is `null`. A pending or invalid manifest blocks publication. The worker checks the build metadata, keeps the old directory as `rollback-<previous docsSha>` and restarts Docs. Two pages must return 200 within the bounded smoke check. On failure, the new directory becomes `failed-…`, the old release is restored, and the card offers "Retry release".

::::example Proposal dp_3f9a1c02b7e4 (invented data)
:::steps
- **Hermes** — on Monday at 06:00 local time starts the audit; `drafting`, branch `docs/weekly-2026-10-05-3f9a1c`.
- **The agent** — edits `platform/health.ru.md` and `.en.md` and writes the description. Two minutes later the worker sees it.
- **The worker** — keeps two files, runs the tests, commits, opens PR #318 and posts the card. The state is `ready`.
- **You** — read the PR and click Publish. The state is `publishing`.
- **The worker** — merges the PR with a head check, builds the release from `main`, moves `release/` to `rollback-<old sha>` and restarts the service.
- **The worker** — `/en/` and `/ru/what-is-kurami/` answer 200. The state is `published`, and the card shows the short build hash.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| RU and EN differ in structure | the build fails and shows the difference | align the files |
| A new table has no description in `reference-notes.ts` | the build fails | add the description |
| A proposal touched a file outside the allowlist | the file is dropped before committing; it is not in the PR | nothing |
| A new commit appeared in the PR after Publish | the merge refuses, the proposal returns to `ready` | check the PR and click Publish again |
| The release fails the smoke check | the previous release is restored, the new one is kept as `failed-…`, the proposal is `failed` | Retry release or Reject |
| The audit clone is off `main` or dirty | the job fails before a draft; the agent reports the error | repair the clone |
| Another proposal is open | no draft is created; the audit names the blocker | resolve it with a button |

:::guarantees
- A proposal changes only pages, the ledger, the copy test and the coverage record.
- Publishing happens only on your click on Publish, on a card with the same PR head.
- A preview cannot reach the site: the server accepts only a release build.
- A new release replaces the old one whole, and the old one stays for rollback.
- Publishing the docs does not deploy application code.
:::

:::code-map
- `src/human-docs/content/pages/` — the pages in two languages
- `src/human-docs/markdown.ts` — the Markdown dialect parser
- `src/human-docs/diagrams/kit.ts` — the three diagram engines and the Excalidraw export
- `src/human-docs/reference.ts` — reference tables from migrations
- `src/human-docs/build.ts` — the build modes
- `src/human-docs/changelog.ts` — the changelog and its checks
- `src/human-docs/approval/policy.ts` — the allowlist and the state machine
- `src/human-docs/approval/worker.ts` — the worker: merge, release, rollback
- `src/human-docs/tools/check-pages.ts` — the author's page check
:::
