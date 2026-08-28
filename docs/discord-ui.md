# Discord UI contract

Kurami uses Discord Components V2 for persistent owner-facing surfaces. This
document records layout and interaction ownership; lifecycle truth remains in
SQLite and GitHub.

## Source map

| Surface | Renderer | Durable identity |
| --- | --- | --- |
| Run starter and dashboard | `src/orchestrator/controls/discord.ts` | `run_discord_surfaces` |
| Run timeline event | `src/orchestrator/controls/discord.ts` | `run_discord_event_deliveries` |
| Project digest | `src/orchestrator/projects/digest/discord.ts` | `project_discord_digest_surfaces` |
| Components V2 primitives | `src/discord/ui.ts` | None |
| Owner interactions | `integrations/hermes/plugins/kurami-discord-controls/` | Control request tables |

The database stores Discord message/thread IDs and reconciliation state. It
does not store presentation templates.

Internal and external code imports the canonical `src/discord/ui.ts` module directly.

## Run thread

The project-channel starter is intentionally compact:

```text
TT-119 · Issue title
Session history is kept in this thread. The current dashboard is the latest
bot message.
```

The thread is chronological. Durable lifecycle events are short, non-actionable
timeline messages. The latest bot message is the only complete dashboard:

```text
TT-119 · Issue title
Current stage
Stage detail

CI          Passed
AI review   Outdated
Preview     Reviewed

Control · AI Agent (only when ownership is meaningful)

Evidence details
Links · Issue · PR · Preview · Codex

[primary action] [secondary action] [context action] [fourth action]
[More actions…]

Short run identity · fixed owner-local update time
```

Normal state changes edit the dashboard in place. A new timeline event or
`/kurami status` posts a replacement dashboard after the event, stores its ID,
and then deletes the superseded dashboard. A failed replacement never deletes
the current dashboard. The dashboard is not pinned.

## Links and actions

Issue, pull request, preview, and Codex destinations are Markdown links in one
line. They are navigation, not actions, and do not consume button slots.

At most four currently valid owner actions are visible as buttons. Further
actions use one `More actions…` select. Select values are mapped back into the
same strict action allowlist as buttons; arbitrary values are rejected.
Destructive actions retain the existing ephemeral confirmation step.

The top-level `/status` name belongs to Hermes. Kurami therefore registers
`/kurami status`. It is owner-only and resolves the exact current channel
through `run_discord_surfaces`; outside an active Kurami thread it fails without
changing state.

## Project digest

Each configured project keeps one persistent digest message. It uses the same
container, compact table, link line, action hierarchy, and freshness footer as
the run dashboard. Ranking and metadata semantics are unchanged. Same-state
reconciliation remains a no-op, while the daily job is the recovery baseline.

The health block is a stable two-column matrix: Open/Ready, Backlog/Active,
Review/Blocked, and Deferred/Done. `Open` is the count of non-deferred,
non-done open issues; `Backlog` remains the configured Project status.

## Composio Session

`/kurami composio-check` is an owner-only ephemeral panel. It is read-only by
default; a button appears only when the version-controlled Session policy has
drifted. The button applies only the exact diff that was displayed and asks for
a second review if the Session revision changes before confirmation.

## Runtime settings

`/kurami orchestrator settings` is an ephemeral Components V2 container. It
groups capacity and preview limits into fixed-width tables. One `Edit settings…`
select opens the existing bounded modals; Apply, Undo, and Reset remain visible
and retain idle, revision, and owner authorization guards.

## Presentation rules

- Use text as well as color or emoji for every state.
- Keep code-block tables to short fixed labels and values that remain readable
  on a narrow Discord client.
- Do not show released ownership as a normal status. Show `Control · AI Agent`
  for managed autonomous execution, `Control · You` for remote owner control,
  or `Control · Handoff pending` only while it adds meaning.
- Keep detailed CI, review, preview, policy, and handoff evidence below the
  compact table; do not discard evidence merely to shorten a card.
- Do not attach controls to timeline events or starter cards.
- Do not add a link button when a Markdown link is sufficient.
- Keep every persistent Components V2 message free of legacy `content` and
  `embeds` payloads.

## Verification fixtures

`tests/verify-discord-controls.ts` exercises initial creation, state edits,
timeline-driven dashboard rotation, `/kurami status` thread lookup, CI and AI
review combinations, preview lifecycle, cancellation, overflow actions, and
idempotency against a fake Discord API.

`tests/verify-triage-digest.ts` exercises Components V2 digest creation and
updates, metadata states, link presentation, and same-state no-op behavior.

`tests/verify-discord-plugin.py` exercises the button and select allowlists plus
owner-only `/kurami status` registration.

The pre-migration implementation remains recoverable from Git history. Rollback
uses the exact baseline commit followed by deletion/regeneration of bot-owned
Discord surfaces; a permanent runtime renderer toggle is intentionally absent.
