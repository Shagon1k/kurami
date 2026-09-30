# Run Kurami Hub

Hub is a private, read-only dashboard. It uses the shared UI library and runs as a separate HTTP origin. It shows Project Orchestrator state, local Git activity, Codex usage, links to Digest and Docs, and an installable PWA shell.

## Start a local preview

From `app/`, run:

```bash
npm run hub:serve
```

Open `http://127.0.0.1:8800/`. Set `HUB_PORT` to another local port if needed. The process binds only to `127.0.0.1`.

Hub reads `${KURAMI_HOME}/config/projects.yaml` and `${KURAMI_HOME}/state/orchestrator.db`. If `KURAMI_HOME` is unset, it uses the parent of `app/`. It reads each configured project's local base branch and the Kurami `main` branch. These reads do not fetch from GitHub, update the database, or start runs.

Hub also reads `${CODEX_HOME}/state_5.sqlite` and the session rollouts referenced by that database. Set `HUB_CODEX_HOME` to override the Codex directory. If neither variable is set, Hub uses `~/.codex`. Hub scans rollouts once, then reads only appended bytes while the process stays running. It never serves the logs or their prompts.

## Read the numbers

- Project board counts come from the last successful Project Orchestrator poll. Hub marks the snapshot stale after 15 minutes or a failed poll.
- Working and attention counts come from durable run states. Human Review counts come from Project snapshots.
- Commit counts cover the configured local base branch. They can lag behind GitHub. The chart groups commit dates into 12 UTC weeks.
- Kurami is a repository card, not an admitted Project Orchestrator project.
- Codex token counts cover the preceding 7 and 30 rolling days. Hub derives them from per-session cumulative token events, with per-response records as a fallback. Cached input is included in total input; output includes reasoning tokens. A partial-log label means some referenced rollouts were unavailable.
- The model table counts sessions started within 30 days by their last recorded model. It does not attribute tokens to individual models when a session changes model.
- Limit bars use the most recent local Codex snapshot and disappear after their reset time. For the authoritative current limit, use the [Codex usage dashboard](https://chatgpt.com/codex/settings/usage) or `/status` in Codex CLI, as described in [OpenAI Docs](https://learn.chatgpt.com/docs/pricing).
- Hub does not calculate financial cost or closed-PR counts yet.

The browser requests a new server-rendered fragment every minute while the page is visible. The server caches a snapshot for up to 45 seconds. If refresh fails, the browser keeps the last displayed values and marks the connection lost.

## Keep the origin private

The Hub origin has no account authentication. Before routing a public hostname to it, put that hostname behind an owner-only access policy and verify that anonymous requests cannot reach the page, fragment, or static assets. Do not expose the loopback port directly. The service worker caches only the generic offline page and static assets; it does not cache dashboard values.

Run `npm run test:hub`, `npm run test:ui-library`, `npm run test:ui-guard`, and `npm run test:ui-browser` after changing Hub UI. The browser suite includes a synthetic Hub page; it does not read private project state.
