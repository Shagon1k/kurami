# Projects interface

Projects opens directly on a table. The existing Zero Trust policy protects the
Cloudflare route; Discord remains the notification channel. The interface uses
the shared Kurami typography, header, theme and controls.

## Navigation and language

English is the default. The header language link switches to Russian with
`?lang=ru`, preserving the project, task, search and sort selection. Task titles,
project names and source notes retain their original text. Interface labels,
control hints, confirmation text and request errors are localized. The language
link uses the same square icon-button variant as Hub and Docs.

Projects are header tabs on desktop, including All projects. At up to 620px,
the shared bottom panel opens Apps, Projects, Search and More. Search contains
the original form; More contains language and theme. Long desktop tab sets scroll on narrow
screens. The toolbar contains a search field with a visible search icon and an
accessible label. Search updates immediately and survives refreshes. There are
no view/status filters, Apply button or manual refresh button.

Task, Status and Kurami headings toggle ascending/descending sorting. The active
heading exposes `aria-sort`; phones have the same controls above the stacked
rows. Explicit sorting is stable. Without a sort selection, the snapshot keeps
its default attention-first order.

## Table and task details

Four columns separate Task, Status, Kurami and Checks. Status means the GitHub
Project field; its authority and write behavior are unchanged. Shared pills
mark the Project status and Suggested next recommendation. Kurami stages, check
results and source freshness use plain colored text, with no badge container.
Small icons identify CI, review, preview, projects and owner attention.
Without an observed run or stage, Kurami shows No agent run rather than Not started.
This does not change the task's GitHub status; known run states stay visible.

On desktop, the table scrolls within the remaining viewport height and keeps
its headings visible. The details panel has a separate scroll area. Automatic
updates retain each scroll position. On phones, the table keeps the normal page
scroll instead of gaining a nested scroll area.
At viewport widths of 1280px and above, the panel grows from 380px to at most
420px. Smaller desktop viewports retain the 360px panel.

A task opens in a side panel on wide screens and a full-screen dialog below
900 pixels. The mobile dialog locks background scrolling, makes background
controls inert and keeps keyboard focus inside it. Back to tasks and Escape
close it. Swiping right returns to the table; swiping left on the table reopens
the last task. Both directions follow the finger and settle after a distance or
velocity threshold; short drags return to the starting view. Browser Back/Forward
restores the corresponding view. Memory-only cached views make the transition
independent of network latency, but cached action controls stay disabled until
a fresh server response arrives. Failed refreshes keep that read-only snapshot.
Polling never replaces the panel during a drag or its settling animation.
Swipes do not start on buttons, links, form fields, disclosures or charts; vertical
scroll, text selection and horizontally scrollable regions retain their gestures.
Multi-touch, pointer cancellation and resizing cancel the drag. Swipes are disabled
during writes or destructive confirmation. Reduced motion removes settling
animation, while direct finger tracking remains.

The detail header contains project, issue number, title, a Project status pill
and the Kurami stage as colored text.
Resources form a bordered two-column button grid: Issue, PR, Review and Discord. Missing
resources leave no empty slots. Preview navigation lives beside Preview evidence.
The status editor is always visible. Evidence groups
CI, review and preview in one panel with their contextual repair/review/preview
actions. A shared known commit is shown once; differing or unknown heads remain
explicit. Review Ready does not mean the findings passed. An already-reviewed
commit has its explanation without a redundant disabled review button.
Continuation, recovery, stopping and deletion share a bottom action grid without
Work/Cleanup headings. One action fills a row; two share equal columns, including
Open preview and Remove preview. Notes use the information color; finding counts
use the monospaced font. Scroll restoration happens after layout but before paint;
an exiting panel stays offscreen until replaced.
Only deletion uses the danger variant. All server eligibility and confirmations
are unchanged.

Regular controls use the shared 36px height; contextual actions use the compact
variant, retaining coarse-pointer targets. Actions fill their grid cells.
Multiline labels can grow vertically. Status pills
use 11px text with 2px vertical padding. Sort headings put a thin 14px icon after
the label. Checks is centered horizontally and shares the headings' vertical
alignment. Header padding is denser than body-row padding.
Actions in each pair share a button row through CSS subgrid, so wrapped labels
give both buttons the same height. Their state and hint text occupy a separate row.

Unavailable controls retain their reason. Pending status writes show the
requested destination while the table retains its observed status until the
normal poller confirms it. Failed requests and retries preserve the original
nonce. Action feedback appears inside the mobile dialog, where it remains
visible while the card scrolls.

Deletion requires explicit Confirm/Cancel. Escape cancels the confirmation and
returns focus to its action. Opening or reading the confirmation does not write.
The confirmation occupies the full action grid, with its controls aligned right.
Automatic replacement pauses during confirmation or text selection. Shared
run/SHA/preview checks still validate each action on the server.

## Synchronization and digest recommendations

The Sync button opens an anchored popover with per-project freshness and
observation times. It uses native popover dismissal and stays inside the
viewport. It does not change the page layout. Times use Europe/Vilnius; the
browser refreshes every 30 seconds against the existing minute poller.
A small mobile indicator distinguishes fresh data from delayed synchronization;
the button's full accessible name and tooltip retain the explicit state.

Suggested next comes from the persisted ranking used by the Discord digest.
Its pill appears on the matching present backlog issue. The detail card shows
the ranking explanation. Stale projects, changed ranking facts and tasks that
have moved on no longer receive this mark. Projects does not rerank tasks or
read Discord messages to derive recommendations.

## Components and verification

Use shared document, header, table, form, button, callout, popover, pill and theme
components. The library supplies pill tones and shape, sortable trusted header
content, optional table height/sticky headings, icon search fields, scrollable
header navigation, and danger/link button variants. Product styles own the
page, details, gesture layout and responsive arrangement. UI-Library: extended.

Browser checks cover both themes, English/Russian, 320/390/1280 pixel widths,
large lists, sorting, project selection, search, touch gestures, history,
refresh failure, status drafts, request retries and destructive confirmation.
Read [architecture](ARCHITECTURE.md) for sources and trust boundaries, and
[delivery](ROADMAP.md) for the rollout boundary.
