---
title: Glossary
summary: Every Kurami term in one place, by product.
section: reference
group: reference
order: 10
---

Words that mean something specific in these docs. Names from the code are in `monospace` and match the code. General conventions about words are on the [How to read these docs](@how-to-read) page.

## Digest

:::terms
- **`content_digest`** — the sha256 of an edition's `payload_json` and HTML; the optimistic write lock
- **`propagate` / `isolate`** — failure modes: an error either stops publication or removes only its own block
- **Weekly `SAVEPOINT`** — a rollback point inside the publication transaction: a Weekly failure rolls back only it
- **add-on** — an optional Digest module (Weekly, Cinema, Stocks…) with its own data, page and failure rule; its failure does not stop the edition
- **Discovery** — up to three checked US stocks outside the list with a notable move on higher volume; only on `/stocks`
- **upper boundary** — the id of a channel's newest message at capture; channels are marked read up to it
- **edition** — the Digest page for one date (`daily:2026-10-01`) with a row in `editions` and an HTML file; its news is frozen, the rest is live
- **live sections** — mail, calendar, weather, Signals and the quality strip, which the poller refreshes hourly
- **frozen teaser** — the add-on copy in an edition taken at publication; the poll does not change it
- **claimed date (claim)** — the row in `stocks_refresh_days` / `stocks_discovery_days` inserted before work: a retry within the same day is impossible
- **run card** — the single Discord message per date, edited at every stage until it becomes the release card
- **envelope** — the `addons.<id>` record in an edition: version, state, snapshot time and data
- **observation** — a compact Weekly record for a date: stories, calendar, mail balance, no texts
- **coverage** — how many of the week's seven days were observed for a Weekly series, for example 5/7
- **batch (ledger)** — the frozen list of unread Telegram posts at the moment of capture: a raw and a normalized file
- **coverage** — the rule "every post of the batch belongs to exactly one story or exclusion"
- **points band** — the permitted score range of a story (not below the boundary minus 12) from which the model chooses
- **channel marking (Telegram commit)** — the `mark_read_through_batch` call by the saved plan after validation; Kurami's only change in Telegram
- **attempt** — one morning build of an edition: a `briefing_run_attempts` row with eleven states and a folder of files; one scheduled attempt per date
- **accepted report** — a portfolio report that passed all checks and was written as a file named by sha256 with the `latest-weekly.json` pointer
- **interest profile** — weights of topics and sources from your 🔔/🔕 reactions; switches on after 10 reactions and reorders the feed in "For me"
- **add-on registry (`BRIEFING_ADDONS`)** — a static array of eight modules: block order, slots and failure mode
- **adjusted price** — the closing price adjusted for splits and dividends; changes and charts use it
- **snapshot (`addon_snapshots`)** — an add-on's last good snapshot: one row per id, the data JSON and its sha256
- **Cinema snapshot** — the Saturday Cinema envelope; accepted when two sections have data (or all are ready)
- **guard** — a systemd check with no model: resends the notification, records a failure at the 09:50 and 10:50 deadlines
- **story** — a news item of an edition: one or several merged posts with a headline, summary and id `story-<16 chars of sha256>`
- **draft** — `editorial-draft.json`: the agent's only output — stories, texts, topics, ratings, exclusions
:::

## Projects

:::terms
- **`deterministic-v2`** — the formula for picking the next issue: priority tier plus estimate smallness plus age up to 30 days
- **`stop_reason`** — the intent behind stopping a run: `completed` (Done) or `cancelled` (Backlog, Deferred, Cancel run)
- **AI review** — an independent read-only Codex pass over the PR diff, published by the bot `kurami-ai[bot]` as one native `COMMENT` review
- **Mark reviewed** — your note that you looked at the preview of exactly this commit; it neither approves the merge nor extends the lifetime
- **park** — the step that closes Codex after a completed turn and moves the run to `parked_review` with owner `none`
- **Run Store** — the single SQLite database of the Project Orchestrator: events, runs, resources, history and the command queue
- **tmux session `cx-…`** — the terminal session that holds a run's Codex CLI; its name is built from the project prefix, the issue number and six characters of the run id
- **WIP** — the number of runs occupying a slot; a run paused for review (`parked_review`) is not counted
- **preview adapter** — code that turns a working copy into a working address: Compose (a Docker stack) or Static (a built folder)
- **preview lease** — a `preview_leases` row tying a slot, a run and a state (`leased`, `provisioning`, `running`, `releasing`, `released`, `failed`)
- **copy owner (`owner_state`)** — who is writing to the copy right now: `none` — nobody, `cli` — a managed Kurami session, `remote` — the Codex app
- **session owner (`owner_state`)** — who holds the Codex task: `none`, `cli` (managed session) or `remote` (you in the Codex app)
- **merge proof** — the condition for deletion after Done: the copy's HEAD is an ancestor of `origin/main`, or a merged PR of the branch with the same `headRefOid` is found
- **admission** — the check that decides whether a card move to In progress becomes a run; it only records a decision in the database
- **live run** — a run not in `rejected`, `cancelled` or `archived`; a card never has two live runs
- **control request** — a `run_control_requests` row queued by a button press; the controller performs it
- **resource guard** — the inspection of directories, tmux sessions and disk before admission; on a discrepancy it blocks admission and opens a quarantine, but deletes nothing
- **guarded sync** — writing accepted values to the GitHub Project that rereads the field and does not overwrite your value
- **baseline** — a project's first poll: cards are recorded, no events, so issues already on the board start nothing
- **resource quarantine** — a record of an unaccounted directory or session: `observed`, after 30 minutes `quarantined`, `resolved` when it disappears
- **run card** — the lowest bot message in a run thread; edited in place, it shows the stage, checks and the valid buttons
- **controller** — the script that once a minute picks one next step for each run and owner command
- **stop intent (`stop_reason`)** — `cancelled` or `completed`; cancellation beats everything and prevents reviving the run
- **required checks** — the GitHub check names from `projects.yaml` that Kurami counts when judging CI; others are ignored
- **card digest** — a string of dozens of facts; if it changed, Kurami redraws the card
- **proposal batch** — a frozen list of Backlog issues with empty Priority or Effort and the AI's proposals for them, waiting for your decision
- **preview required (`preview-required`)** — an issue label that keeps a run from completing without a reviewed preview of the current commit
- **successor** — the new managed thread that "Continue autonomously" starts in place of the old thread that went to a human
- **working copy (worktree)** — a separate directory with its own branch in which Codex works for one run; the repository's main clone is not used as a workspace
- **review-fix round** — one press of Fix Review: a snapshot of unresolved threads, a Codex task, waiting for CI and resolving the threads
- **settings revision** — an immutable record of a set of limits with an author and a checksum; created by `/kurami settings`
- **preview slot** — one of six pre-declared addresses `preview-N.shagon1k.win` with a set of ports that Kurami leases to a run
- **thread swap** — during a technical task the main thread is set aside in `previous_codex_thread_id` and restored afterwards
- **CI snapshot (`run_ci_snapshots`)** — the single row per run: the PR, its commit SHA and the outcome of the required checks (`pending`, `passed`, `failed`, `missing`, `unknown`)
- **fresh board snapshot** — the last poll succeeded and is no older than two minutes; only then do new working copies and Codex sessions start
- **thread event** — a short one-off message about a transition: Ready for review, Preview is ready, CI failed
- **preserved work** — the `needs_attention` state after a cancellation: the copy and branch are kept until you confirm deletion in two steps
- **technical task** — a fresh Codex in the same copy that fixes CI or review comments; confined to an evidence snapshot
:::

## Platform

:::terms
- **`$KURAMI_HOME`** — Kurami's root directory on the server: code, state, secrets, backups and logs
- **`composio-read`** — the read-only session with seven tools; fit for background work
- **Cloudflare Access** — the identity check in front of the local services; Kurami's sites have no authorization of their own
- **Hermes** — the ready-made agent environment on the server: schedule, Discord, model runs, MCP
- **Hub** — a private web dashboard with server, project, Git and Codex state and a few confirmed owner controls; listens on `127.0.0.1` behind Cloudflare Access
- **MCP server** — an external toolset Hermes connects to; it has an allowed-tools list and a trust level
- **nonce** — a one-off tag on a Discord message; a message with an already used tag is dropped, so a retry after a failure creates no duplicate
- **agent job** — a Hermes job that runs a model session with a prompt and skills (Daily, the documentation audit)
- **allowlist** — the list of paths a proposal may change: pages, the changelog ledger, the copy test and the coverage record
- **lock (`*.lock`)** — an empty file a script takes with `flock`; a taken lock means a quiet exit
- **docs release** — a build of the site from `main` with `revision: null` that replaces the `release/` directory; the previous release stays as `rollback-<sha>`
- **delivery (`deliver`)** — where Hermes sends a job's output: `local` (nowhere), `discord:<channel>` or `origin`
- **pinned Node** — the one fixed Node 24 version in `runtime/node` that runs all Kurami code
- **recovery bundle** — an archive with the snapshot, secrets and the cron registry, encrypted to an `age` public key; only the holder of the private key can decrypt it
- **health card** — the one message in the health channel that the script edits in place and that shows the server's current state
- **fingerprint** — the sorted list of "key:severity" pairs of active problems; a change in it triggers a new alert or a recovery
- **UI guard** — a test that finds hand-written buttons, literal colours and library overrides in product code and compares them with a frozen baseline
- **docs proposal** — the weekly set of page edits on a separate branch and PR that is published only by your click on the card
- **verification drill** — a manual decryption of the bundle on a clean machine with a manifest comparison and a database `quick_check`
- **theme role** — a name for a value's purpose, not the value itself: `--text-muted`, `--radius`; products are styled with roles only
- **streak** — the number of consecutive checks in which a problem persists with the same severity; an alert needs a confirmed streak
- **skill** — a folder of instructions that Hermes attaches to an agent session
- **script job (`no_agent`)** — a Hermes job that runs only a script with no model; empty output means silence
- **snapshot** — a consistent copy of the Run Store database and three configuration files with a manifest; it holds no secrets
- **guard** — a systemd timer that checks the morning edition completed and edits the Daily card
- **Composio contour** — one of the three access sessions: `composio-read`, `composio-automation`, `composio`
:::
