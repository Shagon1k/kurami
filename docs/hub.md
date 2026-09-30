# Run Kurami Hub

Hub is a private dashboard with owner controls. It uses the shared UI library and runs as a separate HTTP origin. It shows System Health, Project Orchestrator state, local Git activity, Codex usage, a problem queue, and recent work. The site header links to the other Kurami apps and opens the Controls dialog; the PWA shell supports installation.

## Start a local preview

From `app/`, run:

```bash
npm run hub:serve
```

Open `http://127.0.0.1:8800/`. Set `HUB_PORT` to another local port if needed. The process binds only to `127.0.0.1`.

Hub reads `${KURAMI_HOME}/config/projects.yaml` and `${KURAMI_HOME}/state/orchestrator.db`. If `KURAMI_HOME` is unset, it uses the parent of `app/`. It reads each configured project's local base branch and the Kurami `main` branch. These reads do not fetch from GitHub, update the database, or start runs.

Hub also reads `${CODEX_HOME}/state_5.sqlite` and the session rollouts referenced by that database. Set `HUB_CODEX_HOME` to override the Codex directory. If neither variable is set, Hub uses `~/.codex`. Hub scans rollouts once, then reads only appended bytes while the process stays running. It serves token counts, typed turn events and session titles, never transcripts or prompts. `HERMES_HOME` selects the Hermes session database and config; the default is `/home/shagon1k/_hermes/_core`.

## Read the numbers

- Project board counts come from the last successful Project Orchestrator poll. Hub marks the snapshot stale after 15 minutes or a failed poll.
- Working and attention counts use the current run of each present Project item, excluding the project's configured Done/Deferred columns. Replaced runs do not inflate the counts. CI failure counts include current failed/missing checks even while repair is active. Human Review counts come from Project snapshots.
- Commit counts cover the configured local base branch. They can lag behind GitHub. The chart uses 7 or 30 rolling 24-hour buckets ending at the snapshot time, not calendar-day totals. Its accessible labels include bucket start times. Repository checkboxes start with all repositories selected and filter the chart and top commit card together. The project table retains each repository's own counts. Missing selected repositories produce a partial label; selecting only unavailable repositories shows no count, not zero.
- Kurami is a repository card, not an admitted Project Orchestrator project.
- Codex token counts cover the preceding 7 and 30 rolling days. Hub derives them from per-session cumulative token events, with per-response records as a fallback. Cached input is included in total input; output includes reasoning tokens. A partial-log label means some referenced rollouts were unavailable.
- The model table attributes tokens to the model recorded in each turn, including sessions that switch model. It shows tokens and API-equivalent USD for the selected 7 or 30 days. Its disclosure contains input, cache read/write, output and distinct sessions with usage in that period; one session can appear under several models. Four models are visible initially; additional models are folded. The list hides `codex-auto-review`, without subtracting its tokens from overall usage. Share bars compare visible models' token counts. Missing model context is shown as Unknown, never inferred from a thread's last model.
- Numbers use K/M/B notation. The token totals expose the exact count on hover and in their accessible name; Cached and Output remain visible beneath the totals.
- Limits and available resets come from `account/rateLimits/read` in a separate Codex App Server, using the existing integration client. If that request fails, bars fall back to local logs and are labelled as a local snapshot; reset stays disabled. See [Codex App Server](https://learn.chatgpt.com/docs/app-server).
- The Limits history shows the daily maximum observed used percentage from local rollout rate-limit events. Series and labels follow the windows returned by the live account; if that request fails, they follow the local snapshot's windows. A historical or unsupported window is not added to the graph just because older logs contain it. It covers 7 or 30 calendar days in Europe/Vilnius, including today. Missing observations remain gaps; an observed zero is zero. It does not add percentages across resets or estimate tokens spent. SVG titles and an accessible table expose the exact daily values.
- System Health and Orchestrator metrics use the latest committed cycle in `state/system-health.db`. Until the first cycle, Hub reads the legacy JSON snapshot. Discord renders the same inspection result. CPU is a 5-second sample; average/peak use the configured rolling window. Network speed is the last scheduled speed measurement, not a new speed test on every page refresh. The health snapshot becomes stale after twice the configured interval plus five minutes, with a minimum of 15 minutes.
- Alerts use the collector's health hysteresis state and the shared Project status rules. They include stale Project snapshots, current tasks needing owner input, and CI/major-review findings without queued or active repair. CI repair attribution checks both source and result SHA; an unrelated older attempt cannot hide a current failure. Historical archived runs and old rebased Git branches are not alerts. Unavailable Project data is shown as unavailable, not as an empty healthy state. CI and review problems on one PR/task share a queue entry with reasons, an actor and a next step. The header counts objects/tasks and problems separately. A stale busy repair directs the owner to inspect the task, not to start a second concurrent repair.
- Live Activity combines durable run transitions, CI/review states, Codex session starts and typed turn events, Hermes session starts, Daily/Cinema publication and addon snapshots. Cinema CLI stages also write start/completion/failure events to `state/activity/YYYY-MM-DD.jsonl`. Hub reads the last seven days, bounded to 1,000 candidate events and 128 KiB per daily log; those logs are not automatically deleted.
- Activity groups work by project/task or by session ID, never by matching session titles. Unambiguous orchestrator resource links connect main, review, repair and continuation sessions to their task. Project transitions determine task status; a completed Codex turn alone means idle, not a finished task. Five work items remain visible; More adds up to fifteen. Project/agent filters apply before that limit. Each item exposes up to fifty technical events and any observed CI/review result. Links open the known PR, issue or valid Codex session launcher, without inventing a completion result.
- API-equivalent USD estimates comparable API usage, not subscription spending or a historical invoice. TPS and closed-PR metrics are not included.

### API-equivalent estimates

`src/core/api-equivalent.ts` stores Standard USD rates verified on 2026-09-30 against [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) and the linked model pages, including [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol). Both periods use this rate snapshot, not the price on the date of each request. Fast, Batch/Flex discounts, regional uplifts and tool charges are excluded. Updating the rates changes both windows' estimates.

The input charge partitions observed input into ordinary input (`input − cache read − cache write`), cache read and cache write. Cache write is not added a second time to ordinary input. Output already includes reasoning tokens. For models with long-context pricing, requests above 272,000 input tokens use twice the input/cache rates and 1.5 times the output rate.

Older logs can omit cache-write counts or individual request sizes. The estimate assumes zero cache writes and short context for the missing fields; the tooltip reports affected tokens. Missing cache-write counts remain `—` in the model breakdown. Unknown models have no inferred rate and display `—`; `codex-auto-review` is hidden from the list. Dollar totals exclude unpriced tokens and carry a partial label; token totals still include those tokens. Missing rollouts also make totals partial. Dollar values have no `~` prefix; the API-equivalent label and tooltip describe the estimate.

Tokens, Models, Limits history, commits and the collapsed Usage block have compact 7/30-day controls. The commit card, project table and chart share one selection. Other blocks can use different periods. Choices, repository selection and Activity filters persist across fragment refreshes and language changes; new visitors start at 30 days. Current limits, System Health and current task states have no period control.

Usage selects tasks whose first verified release occurred in the chosen period. Verification requires an archived run and release history with `completionVerified: true` plus Git ancestry or GitHub merge evidence. Board labels, archived cancellations and Human Review do not establish completion. The timestamp is when Kurami verified the release, not necessarily when GitHub merged the PR.

The median covers each measured task's observed lifetime tokens through that release: earlier attempts, main sessions, autonomous continuations, AI review, CI repair and review fixes. Sessions are deduplicated within each project/item. Rework is CI-repair and review-fix tokens divided by all tokens of the same measured cohort; initial AI review is not rework. Technical phases take precedence over temporary main-session aliases. Missing logs, unknown main sessions or sessions mapped to different tasks exclude the task from measured statistics, but not the completed count. `Logs n/m` reports measured/completed tasks; an empty or unmeasurable cohort displays `—`, not zero usage. These are local-log measurements, not a quality score, subscription cost estimate or tokens-per-second measurement.

The browser requests a new server-rendered fragment every minute while the page is visible. The server caches a snapshot for up to 45 seconds. If refresh fails, the browser keeps the last displayed values and marks the connection lost.

## Keep the origin private

Put the hostname behind an owner-only Cloudflare Access policy. The read surfaces rely on that edge policy. Controls additionally validate the signed Access JWT against `HUB_ACCESS_TEAM` and `HUB_ACCESS_AUDIENCE`; configure these for the Hub application. The supplied service contains the current Hub team and audience. Missing configuration fails closed. Do not expose the loopback port directly. The service worker caches only the generic offline page and static assets; it does not cache dashboard values.

## Owner controls

Open Controls from the icon button in the site header. Models, Settings, Composio and Restart remain in one dialog, with a Back button to return to its menu. Reset stays beside the current limits. Opening these views does not apply an action.

Set `HUB_CONTROLS_ENABLED=true` and `HUB_CONTROL_ORIGIN=https://hub.shagon1k.win` to enable the API. Mutations require an authenticated Access identity, an exact Origin match, an HttpOnly `__Host-` CSRF cookie with the matching request token, and explicit confirmation. Concurrent mutations are rejected. Successful actions append bounded metadata to `state/hub/control-audit.jsonl`; no command outputs or secrets enter that audit.

Hub checks that the audit file is writable before a mutation. If saving the record fails after the action completes, the response still reports the completed action and displays an audit warning. Do not repeat a completed action to repair its audit record.

- Codex reset consumes one earned credit with a persistent browser-generated idempotency key, then rereads limits. The service decides eligibility; `nothingToReset` and `noCredit` do not count as success.
- Model selection uses the live Codex catalog. Codex updates its user config through the App Server with the config version check. Hermes changes `model.default` through its existing CLI, preserving the provider; the Hub picker currently supports Hermes with `openai-codex`. Defaults apply to new sessions. If a Codex model cannot use the current reasoning effort, confirmation shows the change to that model's default effort.
- Restart sends SIGUSR1 to the Hermes gateway service, using its existing after-turn restart handler. It does not reboot the host or restart Codex sessions.
- Kurami Settings and the health interval use the same canonical CLIs as Discord. `src/orchestrator/settings/settings-schema.json` defines field labels, ranges, CLI flags, relationships and health intervals for the engine, Hub and Python plugin. Settings retain the idle gate, config-capacity checks and optimistic revision check. `HUB_CONTROL_ACTOR_ID` selects the numeric CLI audit actor (default `0`); the separate Hub audit records the verified Access subject.
- Composio checks broad/read/automation contours. Sync requires confirmation of the displayed diff and rejects a changed diff. It uses the existing Composio CLI.

## Shared backend boundaries

`src/orchestrator/projects/status-read-model.ts` owns the current-run read model, common CI/review SQL facts and status classification. Hub composes its project counters and alerts from that model. Discord task cards use the same facts and busy/current-review rules; action-specific ownership and retry gates remain in the controls and canonical engine. A stale running repair can require attention without authorizing a second concurrent repair.

`src/system/health/health-cycle.ts` collects measurements, applies hysteresis, records ten history entries and commits notification intents before any Discord configuration or credentials are read. Collection has no Discord dependency. The existing tracked runtime-health wrapper invokes collection and delivery as separate processes; do not add a second sampling schedule.

From `app/`, you can run these separately:

```bash
npm run health:collect
npm run health:deliver
```

Collection writes the private `state/system-health.db` and compatibility JSON files. Hub reads the committed cycle even if a compatibility projection is missing. Delivery reads the stored cycle without taking another CPU sample or advancing alert streaks. Failed alert deliveries stay pending with their original result and nonce; alert and recovery transitions retain their order. A delivery lease excludes concurrent senders but does not block collection. Each delivery drains at most 20 notifications. Duplicate pending reminders are suppressed; transition notifications remain until delivered. Discord nonce deduplication is bounded by Discord's own retention, so this is not an exactly-once delivery guarantee.

The legacy `--run`, `--heartbeat` and `--alerts` CLI modes still collect before delivery. `--deliver` only renders/delivers stored data. `--cleanup-health-channel` remains explicit maintenance and does not collect. State backups include `system-health.db` when present, using a verified SQLite snapshot rather than copying a live WAL database. Recovery bundles verify this database too; older bundles without it remain valid.

`src/core/codex-usage.ts` owns the rollout parser and incremental cache shared by rolling token totals and task attribution. `src/orchestrator/projects/usage-read-model.ts` owns completion evidence, session mapping and cohort calculations. The renderer does not query the databases or calculate task attribution.

The activity feed remains an aggregation of existing journals. This change does not introduce a new global event bus or translate agent transcripts into events.

The service retains a read-only home mount except for Kurami state, connector runtime directories, Codex state/config and the Hermes home needed by its config/cron CLI. Applying the service definition and restarting Hub are release steps; editing it alone does not activate controls on the running process.

Run `npm run test:hub`, `npm run test:hub-browser`, `npm run test:ui-library`, `npm run test:ui-guard`, and `npm run test:ui-browser` after changing Hub UI. Browser checks use synthetic state and mocked actions, without consuming reset credits, changing live defaults or restarting services.
