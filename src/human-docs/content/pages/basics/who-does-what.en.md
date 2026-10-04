---
title: Who does what
summary: Six participants — you, Hermes, Kurami's code, agents, GitHub and Discord — and the limit of each one's authority.
section: basics
group: internals
order: 20
next: architecture
---

In Kurami every participant has its own role and authority. The automatic controller does not merge PRs. In Projects you confirm merging separately, and the server checks owner access, the current commit and GitHub rules. Run controls in Discord and Projects share one queue. The few controls in Hub call the same canonical tools.

:::glance
- Decides: you — through the GitHub board, Discord and Projects buttons, publishing edits
- Starts things: Hermes — on schedule and on your commands
- Checks and records: Kurami's code — deterministically, recording in SQLite
- Writes text and code: agents — the Hermes agent for the Daily edition, Codex for project issues
- Holds the work: GitHub — boards, branches, PRs, CI
- Shows: Discord — cards, threads, alerts, the only channel for conversation and notifications; Hub — a private web dashboard with state and a few owner controls
:::

## Roles

| Participant | What it does | What it does not do |
|---|---|---|
| **You** | set intent by moving cards, confirm merging in Projects or GitHub, press Discord buttons, change settings | you do not drive processes directly: runs use the queue, GitHub writes use checked owner actions |
| **Hermes** | holds the Discord connection, checks the schedule every minute, runs scripts and agent sessions, gives agents MCP tools | knows none of Kurami's rules and keeps none of its state |
| **Kurami's code** | polls sources, admits work, tracks states, publishes, notifies, makes backups | takes none of the decisions reserved for you: merging, deploying, deleting preserved work |
| **The Hermes agent** | writes the editorial draft of the morning edition; once a week prepares docs edits | never publishes by itself: code checks its output, and you publish docs edits |
| **Codex** | writes the issue's code in its own branch and working copy, opens a PR, fixes CI or review comments on request | stays inside its working copy, never merges a PR and never touches the board |
| **GitHub** | holds boards, code, PRs and CI results; reviews come from a separate `kurami-ai` bot | — |
| **Discord** | shows run, edition and health cards and takes button presses; the only channel where you talk to Kurami and get notifications | acts on nothing by itself: a button only creates a request |

## One issue through everyone's eyes

```diagram
kind: sequence
title: An issue passing between participants
desc: You move an issue on the board. Kurami notices the transition, admits the issue and starts Codex. Codex pushes code and opens a PR; Kurami reads CI for the exact commit and tells Discord it is ready. You do the merge.
actor you "You" owner
actor gh "GitHub" external
actor kurami "Kurami"
actor codex "Codex"
actor discord "Discord" external
msg you -> gh "issue → In progress"
msg kurami -> gh "board poll"
self kurami "admission: limits, disk, description"
msg kurami -> codex "branch, working copy, prompt"
msg kurami -> discord "card “Codex working”"
phase "work"
msg codex -> gh "commits and PR"
msg kurami -> gh "CI of the exact commit"
msg kurami -> gh "card → Human Review"
msg kurami -> discord "“Ready for review”" accent
phase "decision"
msg you -> gh "review and merge"
msg you -> gh "issue → Done"
self kurami "merge check, branch removal"
```

Notice that Kurami and Codex hardly talk to each other directly. Kurami gives Codex a working copy and a prompt, and then reads the result where it lives: commits and PRs on GitHub, the session text in tmux. That is how Kurami can check each claim an agent makes instead of taking its word.

## Who can change what

| What changes | Who can | How it is protected |
|---|---|---|
| An issue's board column | you in GitHub or Projects; configured GitHub automation; the controller to Human Review and Backlog | Projects rechecks the field and current status; automatic transitions remain in the controller module |
| Project code | Codex in its own branch | a separate working copy per run; merging is manual only |
| A Digest edition | Digest code, from the result of one agent step | text and coverage checks before publishing; published news never changes |
| Settings | you, with a button in `/kurami settings` | Project Orchestrator limits only while it is idle, each change a revision you can roll back; the health check interval at any time |
| Documentation | the weekly agent drafts, you publish | a file allowlist, tests, the Publish button |
| Mail | only removing the "inbox" and "unread" labels | a separate connector contour with one allowed tool |

:::guarantees
- No agent merges a PR, deploys code or deletes preserved work.
- A Discord button works only for you and passes the same checks as automation.
- Code always checks an agent's output before it becomes visible.
- Hermes keeps no Kurami state: if Hermes is lost, the state stays in Kurami's databases.
:::

:::code-map
- `integrations/hermes/plugins/kurami-discord-controls/` — buttons and commands: who may press them
- `src/orchestrator/controls/run.ts` — queuing your requests
- `src/orchestrator/projects/project-status.ts` — automatic board column transitions
- `src/projects-site/status.ts` — owner-confirmed GitHub status changes
- `src/projects-site/pr-actions.ts` — draft promotion and merge confirmations, checking request retries
- `src/briefing/editorial-validation.ts` — checking the agent's text before publishing
- `deploy/config/connectors/` — connector authority contours
:::
