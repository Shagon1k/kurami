---
title: Hub
nav: Hub
summary: A private web dashboard with the live state of the server, projects, Git and Codex usage, plus a few owner controls: what each area shows, how the period works and how the controls are protected.
section: platform
group: guide
order: 70
next: access
---

Hub is one "how is the whole system doing" page in a browser. Most of it only reads: it opens the Project Orchestrator database, the health cycle, local Git and Codex logs, and starts nothing. A few owner controls, opened from the header, change settings through the same commands Discord uses. Conversation and notifications with Kurami stay in Discord. The `kurami-hub` service listens only on `127.0.0.1:8800`, and Cloudflare Access guards the way in ([External access](@access)). The page installs as an app (PWA), but offline it shows only a "No connection" placeholder, never old data. It speaks English and Russian; English is the default.

## What is on the page

Top to bottom:

| Area | What it shows |
|---|---|
| **Pulse** | one line above everything: "All quiet" or how many objects need attention, then tasks in progress and tasks waiting for the owner (or in review); the snapshot time on the right |
| **Alerts** | the problem queue, shown only when something is wrong; one entry per PR or task with reasons, who acts and the next step |
| **Tasks** | tasks in progress, in Human Review and needing the owner; next to them commits and API-equivalent USD for the period |
| **System Health** | CPU, RAM, network and disk with meters, plus the Project Orchestrator panel: State DB, Docker, previews, worktrees, quarantine, backup. Under the disk: how many days until it reaches the threshold where new tasks stop being admitted (85%), shown when usage has grown for at least a week and the date is under 60 days away |
| **Projects** | a row per project: cards, commits for 7 and 30 days, poll freshness; a collapsed **Usage** block with completed tasks and tokens per task |
| **Commits** | a chart by rolling 24-hour buckets with repository checkboxes |
| **Codex** | **Tokens**, **Limits** with a reset button and a daily usage chart, **Models** with tokens and USD. When a limit would run out before its reset at the current window's pace, it shows when |
| **Live Activity** | recent work grouped by task or session, with Project and Agent filters |

Kurami in the project table is a repository, not an admitted project: it only has commits. The System Health numbers are the same measurements as the Discord card ([Server health](@health)).

## Period and freshness

On phones, **On page** uses text-only links to dashboard blocks; Hub has no section subpages.
**Settings** holds horizontal rows for language, theme and period, separate from **Controls** for operational actions.

One **7 / 30 days** switch drives all history: the task summary, the project table, the commit chart, tokens, models, limits history and Usage. It sits in the desktop header. On phones, open **Settings** in the bottom panel and choose 7 or 30 days in the **Period** row. The choice survives page refreshes and the language switch; a new visitor starts at 30 days. Current limits, System Health and current task states are live snapshots and ignore the period. Activity has its own filters.

The server caches a snapshot for 45 seconds, and the browser asks for a new one every minute while the tab is visible. Board numbers come from the last successful poll: a snapshot older than 15 minutes or after a failed poll is marked stale. The health snapshot is stale after twice the check interval plus five minutes, at least 15 minutes. If a source is missing, Hub writes "—" or a partial label instead of zero, because zero would say "no work" and "—" says "unknown".

## Problems and activity

The problem queue groups CI and review trouble of one PR into a single entry with reasons such as "CI needs repair" or "Review needs repair", an actor (you, an agent or waiting) and a next step such as "Reply in the task session". A task whose repair is already running says to wait, never to start a second one. Stale poll data, an unavailable database and a stale health snapshot are alerts too. Four entries show, the rest fold under "N more".

Live Activity merges existing journals: run transitions, CI and review states, Codex and Hermes session starts, Daily and Cinema publications. It reads the last seven days and shows five work items, "More" adds up to fifteen. A finished Codex turn means only "idle": a task is done by its board transition, not by a quiet session.

The activity link sits beside the title on phones; titles use at most two lines.
Events shows the full title and pairs a turn's start and finish when their session
and turn IDs match. That pair includes a duration, not an AI summary. Raw events
remain available. Partial retained history is labelled. Internal Guardian
review sessions are hidden by their metadata; project reviews remain visible.

When the task identity is available, **Open task** leads to its Projects card;
the PR remains a separate link. Opening either starts no repair.
Each event disclosure keeps its own open state across refreshes. A session without
a title uses its available name, or "Untitled session" with a short identifier.

## Usage and limits

Tokens, cache and output come from local Codex logs, never from transcripts. The **API-equivalent USD** estimates what the same tokens would cost at standard API rates. It is not a subscription bill, and unpriced or partial data is starred. Limits come from the Codex account itself and fall back to a labelled local snapshot. The daily limit chart shows observed consumption in percentage points; starred days have gaps or resets. Usage counts a task as completed only with verified release evidence and reports the median tokens per task and the share spent on rework; `Logs n/m` says how many tasks could be measured.

The commit and limit charts share their light and dark styling with Digest and Stocks. Hover over a bar or focus it with the keyboard to read its exact value. Limit history groups subscription windows side by side; dashed bars and an asterisk mark partial observations. Narrow screens hide labels above crowded bars, while tooltips retain the values.

## Owner controls

Changed model, numeric and interval fields have a light blue accent. Confirmations
show the field, previous value and proposed value in a compact table. Returning a
field to its original value removes the accent; locked fields remain neutral.
In Codex limits, a remaining quota of 20% or less is amber; an exhausted quota is
red. The low/exhausted label remains visible without relying on colour.

The **Controls** icon opens six actions from the desktop header or the phone's bottom panel; **Reset** sits beside the limits.

Apply buttons and their confirmations use a light blue accent. Reset credits, Restart and restoring Defaults
use amber; Undo stays neutral. The confirmation changes its accent to match the operation, not the menu you opened.

| Action | What it does |
|---|---|
| **Models** | sets the default model for new Codex sessions and for Hermes (provider `openai-codex`) |
| **Settings** | the same Kurami settings as `/kurami settings` ([Settings](@settings)) |
| **Server** | release (below), the health check interval and [development resources](@settings) |
| **Appearance** | the default theme for every app ([Settings](@settings)) |
| **Composio check** | compares three connector configurations and applies a changed one after you confirm the shown diff ([Connector authority](@connector-authority)) |
| **Restart** | asks the Hermes gateway to restart after the current turn; the host and Codex sessions stay up |
| **Reset** | spends one earned credit to reset the Codex limits |

Opening a view changes nothing. An action runs only when all of this holds: a valid Cloudflare Access identity, the exact Hub origin, a matching CSRF cookie and token, explicit confirmation, and no other action in progress. Settings keep their idle gate and revision check. Every completed action adds a short record to `state/hub/control-audit.jsonl`, with no outputs or secrets. If saving that record fails after the action, Hub still reports success and shows an audit warning; do not repeat the action.

### Notifications on the phone

**Appearance** has a "Notifications on this device" section. **Turn on** asks for the browser's permission and subscribes this device; **Turn off** unsubscribes it. Kurami sends a notification when a task waits for you or something breaks (the same as Alerts) and when the morning Digest is out. A tap opens the task card, the Hub problem list or the edition. Each situation arrives once; situations that already existed when you turned notifications on do not.

The push message itself is empty: Google's or Apple's service only wakes the app, which then fetches the text from Hub through your Access sign-in, so task text never passes through their servers. Hub looks for new situations every two minutes. Subscriptions and the signing key live in `state/web-push/`. On iPhone only an app added to the Home Screen can receive notifications.

Each control opens its own named dialog, without an extra Back button. The menu
closes on a second trigger click, outside click or Escape. Composio check is
read-only and does not test provider availability. Check again repeats the read;
Sync appears only when there is a difference to confirm.

### Release

The **Release** section in **Server** shows which commit the server runs and which commit `main` holds, what lags (the same as the Release alert), and the last release with its steps.

**Release main** moves the live version to `main` and does only what is needed, in order: orchestrator database migrations when `migrations/` changed; the Digest build; the docs release, keeping the previous one for rollback; syncing the Hermes copies; restarting services whose code changed. It ends with a check that nothing lags. If a step fails, the release returns to the previous version and brings the services back to it. The button is disabled when there is nothing to release.

**Roll back** returns to the commit before the last successful release with the same steps. Both buttons ask you to confirm the exact version change, and a release refuses uncommitted changes in the live version or a commit that is not on `main`. A release runs as its own systemd job, so restarting Hub does not interrupt it; history goes to `state/deploy/history.jsonl`. After a sync, the Discord plugin takes effect only once the Hermes gateway restarts (**Restart**).

## When it looks wrong

| What you see | What it means |
|---|---|
| "stale" next to System Health | no fresh health cycle; check the Hermes job ([How monitoring works](@health-internals)) |
| a Project "Stale snapshot" alert | the last board poll failed or is older than 15 minutes |
| a Kurami "Release" alert | the server does not run what `main` holds: the live version is behind or has uncommitted changes, a service was not restarted after its code changed, the Digest build or the docs are not updated, or the Hermes copies are out of sync. Hub checks this in the background every 10 minutes |
| "Local snapshot" in Limits, Reset disabled | the account request failed; bars come from local logs |
| a partial label or `*` | some logs are unavailable, tokens or USD may be higher |
| "Offline · last available data" | the browser got no update; the values are old |
| Controls disabled or an action refused | controls are off, Access identity is missing or the confirmation expired |
| the page does not open | the `kurami-hub` service is not running or Access does not let you in |

Hub never serves prompts, transcripts or local paths: it receives only numbers, names and links. It has no login of its own; the loopback port and the Access policy are the protection ([Directories, processes and deploys](@runtime-layout)).

:::code-map
- `src/hub/server.ts` — the HTTP server: routes, headers, the snapshot cache, the controls API
- `src/hub/snapshot.ts` — data collection: database, Git, freshness
- `src/hub/operations.ts` — health, alerts and activity from existing journals
- `src/hub/codex.ts` — reading local Codex logs
- `src/hub/controls.ts` — owner actions and the audit record
- `src/hub/access.ts` — Cloudflare Access token check
- `src/hub/render.ts` — page markup from the UI library
- `deploy/systemd/kurami-hub.service` — the service and its write paths
- `docs/hub.md` — how to read the numbers
:::
