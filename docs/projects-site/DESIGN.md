# Projects interface

The owner's questionnaire establishes an overview table as the first screen,
owner-only access, Discord notifications and visible source freshness. The
existing UI library defines typography, theme, header, controls and spacing.
The implemented table and task panel are the first design draft; owner review
and production acceptance remain pending.

## Screens and states

The overview shows every present configured Project item, including issues that
have no Kurami run. Project, status and attention filters narrow the table.
Text search narrows the loaded rows. Attention rows appear first without hiding
the other tasks. Rows retain their GitHub status and separate CI, AI Review and
preview states.

A task opens in a side panel on wide screens and above the table on narrower
screens. Its URL preserves project and view filters. The panel shows current
run evidence and navigation to GitHub, Discord and running previews when their
identities have been verified. This phase directs owner actions to the existing
interfaces.

Each project exposes its last successful observation and a textual freshness
state. An unavailable store has an explicit unavailable presentation. A failed
browser refresh retains the previous display and reports the failure. An empty
filter result is distinct from an unavailable source.

## Components and review

Use shared document, header, table, form, button, callout, disclosure and theme
components. Product styles live under `src/projects-site/`. The shared form
library gains a search field; no separate product theme is introduced.

Mobile tables stack cells with column labels. Every state uses text as well as
colour. The details panel gets keyboard focus when opened; routine refreshes
preserve search and avoid replacing a focused table. Browser verification covers
320, 390 and 1280 pixel widths in both themes, contrast, overflow, accessible
control names, filters, panel navigation and refresh failure.

Read [architecture](ARCHITECTURE.md) for sources and trust boundaries, and
[delivery](ROADMAP.md) for future actions and release readiness.
