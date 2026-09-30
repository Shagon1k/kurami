---
title: Kurami and Hermes
nav: Kurami and Hermes
summary: What Hermes gives Kurami, which kinds of jobs exist and how they stay silent or speak, how the plugin takes buttons, which skills and MCP servers agents have, and how code gets into Hermes.
section: platform
group: internals
order: 10
next: runtime-layout
---

Hermes is a ready-made agent environment on the server, and Kurami is the set of scripts, rules and state that it runs. Hermes holds what any such system needs: the schedule, the Discord connection, model runs, external tools. Kurami adds what only it needs: checks, databases, cards and authority limits.

:::glance
- What Hermes gives: the cron ticker, the single Discord connection, agent sessions, an MCP client
- What Kurami adds: job scripts, the Discord plugin, five skills, connector policies
- Where Hermes lives: `$HERMES_HOME`, the `hermes-gateway` service (cron runs inside it)
- Job kinds: script jobs (10 of 12) and agent jobs (Daily and the documentation audit)
- Job state: `cron/jobs.json` in Hermes; Kurami's state is in `$KURAMI_HOME/state`
- Boundary: Hermes does not know Kurami's rules, Kurami runs no scheduler of its own
:::

## Two halves

```diagram
kind: graph
title: Who holds what
desc: Hermes runs the gateway with the cron ticker, the Discord plugin, skills and MCP servers. The gateway runs jobs as scripts from Kurami. The scripts read and write state in $KURAMI_HOME and send Discord messages themselves through the API.
node discord "Discord" external at 0,0
node gateway "hermes-gateway" "cron ticker 60 s" at 1,0
node plugin "kurami plugin" "buttons, /kurami" at 2,0
node skills "Skills" "5 packages" at 2,1
node mcp "MCP servers" "Telegram, Composio" external at 0,1
node scripts "Job scripts" "integrations/hermes" at 1,2
node cli "Kurami CLI" "TypeScript" at 2,2
node state "$KURAMI_HOME" "databases, JSON, logs" store at 1,3
group hermes "Hermes" gateway plugin skills
group kurami "Kurami" scripts cli state
edge discord <-> gateway
edge gateway -> scripts "runs"
edge gateway -- plugin
edge plugin -> cli "subprocess"
edge gateway -> skills "to agents"
edge gateway -> mcp "tools"
edge scripts -> cli
edge cli -> state
edge scripts -> discord "REST" dashed
```

The split rule: if any Hermes-based system needs a function, Hermes provides it; if it knows about runs, editions or backups, it is Kurami. Hermes stays the only one that listens to Discord events: Kurami does not start a second bot. Kurami sends messages directly through the Discord REST API, takes the token from Hermes's `.env` and stores it nowhere.

## Kinds of jobs

A job is a `jobs.json` record with a cron schedule. Once a minute the ticker inside `hermes-gateway` takes the jobs that are due and runs them.

| Kind | What runs | Who decides what to report | Used for |
|---|---|---|---|
| Script (`no_agent`) | the script itself from `$HERMES_HOME/scripts/`, no model | the script: empty output is silence, non-empty is a message | polls, health, backup, maintenance, Projects Digest, network speed, Investment Review, the docs worker |
| Agent | a model session with a prompt and skills; a filter script may run first | the model: the reply `[SILENT]` suppresses delivery | Daily, the documentation audit |

The filter script of an agent job can print `{"wakeAgent": false}`, and then the model does not start at all. That is how the documentation audit skips its extra firing without spending tokens.

The `deliver` field decides where output goes:

| `deliver` | Meaning | Jobs |
|---|---|---|
| `local` (or empty) | output is only saved in Hermes's log, nothing is sent | polls, health, network speed, Projects Digest, Daily, docs worker |
| `discord:<channel>` | output goes to a channel | backup, maintenance, documentation audit |
| `origin` | output goes to the thread where the job was created | Investment Review |

If a script fails or times out, Hermes composes a "Cron watchdog … script failed" message, but with `local` it goes nowhere. That is why scripts that must speak on their own — health, Projects Digest, controller notifications — write to Discord over REST, and Hermes's "ok" status only means the script finished without an error.

## The Discord plugin

The `kurami-discord-controls` plugin extends the built-in Discord adapter by subclassing: Hermes connects as before, and the plugin adds a press listener and the `/kurami` command group. The listener accepts only component identifiers that match predefined patterns — for example `kurami:docs_publish:dp_<12 hex>` — and only from users on the allowed list. It ignores everything else.

The plugin decides and stores nothing. For every press it runs a short Kurami CLI command as a subprocess, with no stdin and a timeout, and shows its answer ephemerally, that is, only to you. The CLI does the checks, the state changes and the database writes. More about cards and buttons is in [Discord control](@discord-control-plane).

## Skills and MCP servers

A skill is a folder of instructions that Hermes attaches to an agent session. Kurami ships five.

| Skill | What for |
|---|---|
| `kurami-daily-briefing` | building the morning edition: the agent's editorial work, the runtime does the rest |
| `kurami-investment-review` | preparing a portfolio review on explicit request |
| `kurami-project-readiness` | a read-only "is the project ready" check |
| `kurami-run-control` | text commands for controlling a run when there is no button |
| `kurami-ui-preview-language` | a single visual language for pages |

An MCP server is an external set of tools that Hermes connects to itself. Each has an allowed-tools list (`include`) and a trust level.

| Server | Tools | Trust | What for |
|---|---|---|---|
| `telegram` | 15 read and batch tools | full | the news source for Daily |
| `composio` | three service tools: search, schemas, multi-execute | untrusted | interactive work at your request |
| `composio-read` | 7 read tools | untrusted | automatic reading of Gmail, Calendar, YouTube |
| `composio-automation` | one tool, `GMAIL_BATCH_MODIFY_MESSAGES` | full | automatic "mark read and archive" |

"Untrusted" means a call with side effects needs confirmation; "full" means it does not, because a list of one or two exact tools is the decision. More in [Connector authority](@connector-authority).

## How code gets into Hermes

Hermes reads scripts, the plugin and skills from its own directory, not from the repository, so every deploy path is a copy.

| What | How delivered | Afterwards |
|---|---|---|
| Plugin | `bin/sync-hermes-plugin.sh --check`, then `--apply`: rsync with checksums | restart `hermes-gateway` |
| Skills | `bin/sync-hermes-skills.sh --check` / `--apply` for the five skills | a new run is enough |
| Daily prompt and its skills | `bin/sync-briefing-cron.py --apply --expect-job-id <id>` | schedule, delivery and enabled state do not change |
| Documentation audit prompt | `bin/sync-docs-audit-cron.py --apply --expect-job-id <id>` | schedule and delivery do not change |
| Job scripts | copied by hand into `$HERMES_HOME/scripts/` | the job's next run |

Both sync scripts refuse to work if the source contains `.env`, `*.db`, `*.pem` or `*.key`. The prompt scripts neither create a job nor change a schedule; this is deliberate, so that a prompt cannot be "updated" together with the clock.

::::example The health check at 10:30 (invented data)
:::steps
- **Hermes ticker** — at 10:30 finds the job `kurami-system-health` (id `a1b2c3d4e5f6`, expression `*/10 * * * *`, script job, `deliver: local`).
- **Hermes** — runs `$HERMES_HOME/scripts/kurami-runtime-health.sh` with the pinned Node.
- **The script** — calls `system-health-discord.ts --run`, which collects metrics, evaluates alerts and edits one card.
- **Kurami code** — calls Discord REST itself: updates the card and, if needed, sends an alert to the alerts channel.
- **The script** — prints nothing but a JSON result, and `deliver: local` keeps it in the log.
- **Hermes** — records `last_status: ok` and increments the run counter.
:::
::::

If the script fails while collecting metrics, `last_status` becomes an error and the error message stays in the log: nothing arrives in Discord. You would notice only from the stale "Updated" time on the card.

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| `hermes-gateway` is down | systemd restarts it; all cron jobs stand still until it returns; anything missed within the grace (half the period) runs | `systemctl --user status hermes-gateway`; systemd timers keep working meanwhile |
| A `local` script failed | `last_status` is an error, nothing in Discord | look at `logs/*-errors.log` and the Hermes log |
| A `discord:` job failed | "⚠ Cron watchdog '<name>' script failed" arrives in the channel | act on the text |
| The plugin did not load after `--apply` | the old buttons keep working, new ones do not | restart `hermes-gateway` |
| Someone other than you pressed | the listener answers "not authorized for your account" | nothing |

:::guarantees
- There is one event listener in Discord — the Hermes gateway; Kurami only sends messages over REST.
- The plugin accepts only predefined component identifiers and only from allowed users.
- The sync scripts copy no secrets and change no schedule, delivery or enabled state of jobs.
- The kind of a job is visible in advance: only Daily and the documentation audit start a model.
:::

:::code-map
- `integrations/hermes/plugins/kurami-discord-controls/__init__.py` — the Discord adapter subclass, listener registration
- `integrations/hermes/plugins/kurami-discord-controls/control_handler.py` — identifier patterns and CLI calls
- `integrations/hermes/plugins/kurami-discord-controls/settings_handler.py` — the `/kurami` commands
- `integrations/hermes/scripts/` — job scripts
- `integrations/hermes/skills/` — the five skills
- `bin/sync-hermes-plugin.sh` — plugin sync
- `bin/sync-hermes-skills.sh` — skills sync
- `bin/sync-briefing-cron.py` — check and update of the Daily prompt
:::
