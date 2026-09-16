# Kurami UI components and layout grammar

## Page skeleton

Use this order as a grammar, not a mandatory template:

1. Compact utility header: date, issue, theme, and essential navigation.
2. Page introduction: human greeting or title, short orientation, optional Kurami Note.
3. At-a-glance layer: metrics, agenda, freshness, or key state.
4. Primary reading sections: stories, schedule, analysis, media, or recommendations.
5. Sources and system state when relevant.
6. Quiet footer with generation time and provenance.

Sections share one token system but not one container. Alternate open editorial sections, compact strips, split panels, structured lists, selective warm blocks, and visual media collections. Read `references/layout-archetypes.md` before composing the page.

The document head is also shared UI. It must link to
`assets/kurami-favicon.svg`; this is a global brand primitive, not content owned
by an edition or add-on.

## Actions and navigation

- Primary button: red fill, high-contrast label, Onest 600.
- Secondary button: transparent or surface fill with ink border.
- Text link: ink or signal color with a deliberate underline or arrow cue.
- Icon button: 44×44px minimum, 18–20px centered icon.
- Preference calibration uses the canonical `🔔` and `🔕` glyphs with explicit
  `Больше такого` and `Меньше такого` accessible labels; keep the same geometry
  and selected-state treatment.
- Button group: one object with equal heights and a clearly selected segment.
- Tabs: low-noise navigation; red may mark the current tab but should not fill every tab.

## Alerts, badges, and states

- Alerts support information, success, warning, and error.
- Warning uses a simple exclamation mark, not a visually ambiguous triangle.
- Place the message in its own flexible column and the dismiss button at the edge.
- Badge radius may be 5px. Use border, dot, icon, and text together when status matters.
- Dark-mode semantic text uses the bright semantic colors from the token reference.
- Provide loading, empty, stale, partial, offline, and error patterns; do not show a normal state for incomplete data.

## Metric cards

A metric card contains:

- a concise label;
- one dominant value;
- an optional delta or qualitative status;
- useful context such as period, source, target, or comparison.

The label and value must feel like one phrase. Keep related digits and Cyrillic in Onest. Deltas should be legible chips rather than tiny decorative pills. Use a deliberate metric variant: number, duration, weather/state, or progress. A grid may use two to four cards depending on width; preserve equal card height without leaving most of the card empty.

## Story rows

A story row may include:

- index;
- category badge;
- headline;
- short summary;
- source and time;
- open action;
- preference action such as like/dislike.

Keep the headline in sentence case. Source and time belong to one coherent metadata line; use Onest for mixed Cyrillic text. Provide a strong but quiet hover/focus state for the whole row without turning it into a rounded floating card.

When the payload includes priority, support three variants:

- `featured`: one larger headline or visual lead, used sparingly;
- `standard`: normal story row with summary and actions;
- `compact`: secondary item with shorter metadata and reduced vertical space.

Use `🔔` and `🔕` for future-feed preference: the metaphor is “show me more like this” versus “mute this kind of story”. Do not use `👍` and `👎` here: they read as approval of the current story. Do not use `↑` and `↓` unless the action genuinely means move or rank.

## Paginated Digest Feed

Use a Digest Feed for a variable-length collection of news, messages, updates, notifications, or saved items. This is a provider-agnostic content pattern; names such as Telegram, Gmail, RSS, or DTF belong to the payload, never to the primitive.

A feed may include:

- generic section title and total item count;
- optional source facets supplied by the caller;
- source label and source detail on every item;
- headline, compact summary, timestamp, and provenance;
- inline extended digest when supplied;
- external destination when supplied;
- optional accessible reaction controls;
- pagination and current range.

When a feed item supplies cached media, use the shared media primitives:

- `StoryCover` uses the first image as a compact visual anchor and shows a
  quiet `+N` count when more assets exist;
- `StoryMediaGallery` lives inside the expanded detail panel and renders all
  supplied images and videos in stable compact tiles. A wide gallery uses four
  equal tracks: one or two assets do not stretch, and five or more wrap into a
  second row. Reduce the track count at narrower breakpoints;
- `MediaLightbox` enlarges images without navigating away; the original media
  URL remains a new-tab fallback;
- videos use native controls and `preload="metadata"`, so the page does not
  eagerly download every video.

On wide feed layouts, reserve the same cover track for every news row so the
metadata and headline columns stay vertically aligned. When media is absent,
leave that track visually empty rather than fabricating a placeholder; remove
the unused track when the layout collapses for mobile. Never infer media from
an authenticated provider URL. Media must already be in the edition-owned
cache and represented in the payload.

Paginate long feeds with 10–12 items per page. Do not use `Show all`, infinite document growth, or a nested scroll container for the primary reading feed. For a live dataset, the caller may use cursor pagination internally. For a frozen report, use numbered desktop pages. On mobile, replace the numbered strip with the canonical 42px numeric page input between previous and next arrows; it must share the same page state and URL parameter as desktop.

Open extended content inline beneath the selected item. Keep only one item expanded by default, preserve reactions across page changes, and never turn expanding an item into an implicit external side effect unless the payload explicitly defines that behavior.

At narrow widths, replace the full numbered page strip with `Newer`, `page x of y`, and `Older`. After changing page, return the reader to the feed heading rather than the top of the entire page.

## Feed order control

The canonical `FeedOrderControl` sits between the Digest Feed header and items.
It reuses secondary buttons with an explicit pressed state for Обзор / Для меня,
a live status line, and a quiet explanation disclosure. The runtime supplies
the complete item permutation, profile readiness, weights and brief reasons.
Keep every item, existing reaction state, disclosure and media attached to its
stable identity when reordering. Use the same component at every breakpoint.

## Topic Set


Use a Topic Set to display one to four canonical topics supplied for a story or feed item.

- Preserve the supplied strings and order exactly.
- Keep source provenance separate: a provider or channel is not automatically a topic.
- Treat topic extraction, synonym merging, canonical naming, and taxonomy maintenance as caller responsibilities.
- Render topics as quiet outlined labels with muted text, 4–5px radius, and no strong red fill.
- Use non-interactive `span` elements unless the product implements a real filter action.
- Keep all supplied topics visible across breakpoints. If the caller supplies more than four, require a smaller display set instead of silently hiding or inventing a `+N` interaction.

## Bulk Source Action

Use a Bulk Source Action after a feed when the caller provides one consequential operation over the current batch. The primitive contains:

- source or scope label;
- exact batch description and cutoff when relevant;
- explicit action label;
- short consequence or exclusion note;
- confirmation state;
- loading, success, and error states.

Keep the primitive service-agnostic. The calling workflow owns copy, IDs, cutoff semantics, authorization, handler, persistence, reversibility, and error recovery. The visual skill must not claim that the action succeeded before the caller supplies a success state.

Telegram may appear in the reference component library as demo content only. The same primitive must accept another provider without structural changes.

## Signal strip

`SignalStrip` belongs immediately below Daily metrics. It contains zero to
three `SignalItem` components and an evaluation timestamp. Items use shared
panel/border/type tokens, a fixed amber exclamation mark for attention and an
ink/muted arrow for information. Use a responsive compact grid; stack on
mobile without changing content. There is no outer offset shadow.

The runtime supplies the selected notices, fixed section links and expiry.
An empty/expired strip is absent. Do not use AI-selected icons, colors, layout
or fallback text. Keep these components separate from the calendar/news rows.

## Charts

- Use a restrained grid and direct labeling where possible.
- Trend lines use signal red for the primary series and muted or soft red for comparison.
- Nodes are 3px by default and 6px on hover/focus.
- Tooltip shows the exact value and useful axis context.
- Do not add a chart when a compact value or table communicates the relationship better.
- Gauges need a visible value and label; never rely only on arc length.

## Structured source list

Use a table or compact list for explicit source management, channel freshness, status, rating, and preference controls. This is a diagnostics/settings component, not a mandatory Daily Briefing section.

- Search input icon is 18–20px and vertically centered.
- Preference buttons share geometry and express selected positive/negative state clearly.
- Make row actions keyboard accessible.
- At narrow widths, convert rows into labeled blocks or retain a horizontally scrollable semantic table.
- Status and freshness remain readable in dark mode.
- In a normal briefing, represent partial or stale ingestion with a compact `Качество данных` disclosure and link to details instead of exposing the full table.

## Media collections

Trailers, upcoming premieres, and currently playing films are independent repeatable collections.

- Never make the layout depend on exactly one trailer or one premiere.
- Feature an item only when the supplied payload explicitly marks it featured.
- Otherwise use a repeatable card grid, horizontal rail, or ranked list.
- Preserve title, publisher, release date, genre, duration, rating, and playback action when provided.
- Use available poster, thumbnail, publisher, duration, date, genre, and rating fields to give each card enough information and visual weight.
- For video, reserve a stable aspect-ratio area and provide a clear play action.
- Render zero, one, and many items gracefully.
- Do not invent photographic artwork. If no image is supplied, use a deliberate typographic or geometric placeholder that still contains title or category context.

## Kurami Note component

Use the roles and placement matrix from `references/kurami-notes.md`. A note
must be supplied by the caller with a semantic target and cannot be added or
replaced merely to fill empty space.

In the canonical paginated news feed, a story-targeted note is a defined
variant: render it above that story's headline, toward the right side of the
copy column, with a down-left arrow pointing back to the title. Do not append
it below the topic chips, where the arrow appears to point at the next row.
All Kurami Notes use signal red; placement, rotation, and marks provide visual
variation without switching handwritten notes to normal ink.

## Responsive rules

- Desktop and mobile have the same information and the same Kurami Note limits.
- Reflow grids into a single reading column in semantic order.
- Keep primary actions reachable; avoid moving essential controls below long content without a second affordance.
- Do not shrink typography below readable sizes to preserve a desktop composition.
- Test long Russian words and mixed metadata at narrow widths.

## Component selection test

Before adding a component, ask:

1. Does it express a real content role or state?
2. Is a simpler text or list representation clearer?
3. Does it scale from zero to many items when the data is a collection?
4. Does it remain usable in dark mode, on mobile, and with a keyboard?
5. Is it already represented in the reference component library?
