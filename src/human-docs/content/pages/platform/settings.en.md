---
title: Settings
nav: Settings
summary: The /kurami settings command: which limits you can change from Discord, within what ranges, why changes are blocked while Kurami is busy and how to go back.
section: platform
group: guide
order: 20
next: health
---

The `/kurami settings` command opens a Discord panel with the limits Kurami applies while it works. Only you see the panel: the command accepts the single owner and only inside a project server. Pick a section, change a value in its form and press **Apply**. The same settings, with the same ranges, are in [Hub](@hub): Controls → Settings. Hub runs the same command-line tools and the same schema, so the idle gate, the checks and the revisions below apply to both. Hub also records the verified identity in its own audit log.

::shot{file="shot-kurami-settings.png" size="card" alt="Kurami settings panel, revision 4: check interval, capacity, AI triage and previews; changes locked because of active runs" caption="Current values and the lock line: it lists everything that is still running."}

## What you can change

| Section | Setting | Range | What it is |
|---|---|---|---|
| System Health | Check interval | 5, 10, 12, 15, 20, 30 or 60 minutes | How often the [server health check](@health) runs. Works even while runs are active |
| Capacity & WIP | Concurrent LLM | 1–3 | How many Codex tasks and AI reviews run at once |
| Capacity & WIP | Global WIP | 1–6 | How many runs may be in progress across all projects |
| Capacity & WIP | Project WIP | 1–3 per project | A project's ceiling inside the global WIP |
| AI triage | AI triage/day | 0–40 | How many issues per day the AI assesses for priority and effort |
| Previews | Active previews | 1–6 | How many previews live at once |
| Previews | Concurrent preview builds | 1–2 | How many previews build at once |
| Previews | Preview lifetime | 6–72 hours | After how many hours a preview is removed |

Checks tie the values together. Codex tasks cannot exceed tmux sessions (three). Global WIP cannot exceed the number of working copies (six). Project WIP cannot exceed the global WIP or the per-project working-copy limit (four). Builds cannot exceed previews. Preview lifetime must exceed the expiry warning window (two hours). Project WIP is a ceiling, not a reservation: projects share one pool.

Disks, channels, paths, secrets and physical limits are not in the panel: they live in the deployment configuration.

## Why changes are blocked

Limits change only while Kurami is idle. If a new limit took effect mid-run, part of the work would follow the old rules and part the new ones. The panel shows a lock line with everything still running:

- unfinished runs and managed resources;
- active previews;
- pending commands and unprocessed board events;
- AI reviews, CI and review fixes, continuations and metadata assessments;
- managed tmux sessions.

Wait until the list is empty and press **Apply** again.

## Appearance (Hub only)

Hub's Controls → Settings also has an **Appearance** section: the default theme for every device.

| Setting | Options | What it is |
|---|---|---|
| Theme | Paper or Neon | Paper is warm paper with one red accent. Neon draws the fox as a red neon sign and marks data in yellow (amber in light) |
| Mode | Light or Dark | Both themes have both modes; dark is Neon's main look |

This theme applies always and everywhere. Every app's header has a theme button. It opens a menu: two cards, Paper and Neon, with a light and dark switch in the row above them. A choice in the menu is temporary: it lasts while the app or tab is open, and the next visit opens with the Hub theme again. Until a theme is chosen in Hub, Paper follows the system mode.

The installed app follows this theme too: with Neon it gets the neon fox icon and a dark splash. Android picks up the new icon by itself, usually within a day. iPhone keeps the icon it was added with, so it shows the new one only after the app is removed from the Home Screen and added again.

Applying it creates a revision with its author, like the other settings. Hub refuses a stale panel. This section does not wait for Kurami to be idle, because appearance does not change runs.

## Development resources (Hub only)

The **Development resources** section limits how much of the server development may take: Codex workers of every project, their tests and builds, and Kurami's own tests. All of it runs in a separate systemd slice, `kurami-dev.slice`. Everything started there inherits the limits, whatever the project or test framework.

| Setting | Options | Default | What it is |
|---|---|---|---|
| Cores | 1 to the server's core count | 4 | CPU ceiling for all development together |
| Test jobs | 1 to the core count | 2 | How many Kurami test suites run at once |
| Memory | no limit, 8, 12 or 16 GiB | no limit | Memory ceiling for development |

Development also yields CPU to Kurami's services and runs at low disk priority. A new limit applies at once, including to running processes. Applying creates a revision with its author. Kurami does not need to be idle.

## Revisions, Undo and Reset

Every apply creates a new revision: the number grows, and the values, the previous values and the author's id (Discord, or a fixed id for Hub) are stored in the database with a checksum. The panel remembers the revision it opened with. If someone changed the settings meanwhile, the panel refuses and asks you to reopen it.

| Button | What it does |
|---|---|
| **Apply** | Validates the values and creates a new revision |
| **Undo last** | Restores the values of the previous revision, as another new revision |
| **Reset defaults** | Restores the values from `orchestrator.yaml` |

If the values did not change, no revision is created. The values are read by [Admission](@project-admission) (WIP), the [Controller](@controller) (the Codex limit), [previews](@previews) and [Projects Digest](@project-digest) (AI assessment).

:::guarantees
- Limits change only while Kurami is idle.
- Every change is a separate revision with an author and a checksum; any change can be rolled back.
- Physical limits, disks, channels, paths and secrets cannot be changed from Discord or from Hub.
:::

:::code-map
- `src/orchestrator/settings/settings-schema.json` — field labels, ranges and flags shared by Discord and Hub
- `src/hub/controls.ts` — the Hub Settings action
- `src/orchestrator/settings/runtime-settings.ts` — ranges, consistency checks and the idle check
- `src/orchestrator/settings/orchestrator-settings.ts` — applying, resetting and rolling back revisions
- `integrations/hermes/plugins/kurami-discord-controls/settings_handler.py` — the panel and forms in Discord
- `migrations/030_runtime_settings.sql` — the revisions table
- `deploy/config/orchestrator.yaml` — default values
:::
