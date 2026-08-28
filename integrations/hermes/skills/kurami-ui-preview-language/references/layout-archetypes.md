# Kurami UI density and layout archetypes

Choose a density profile and section archetypes before styling individual components. A shared visual language comes from tokens, typography, and component behavior—not from repeating one container everywhere.

## Density profiles

### Compact briefing

Use for daily briefings and scan-first digests.

- Expose useful information in the first viewport.
- Use 28–56px between major sections and 16–28px inside dense groups.
- Prefer strips, rows, timelines, and split panels over tall cards.
- Keep short events and metrics compact; do not add height merely to equalize sparse content.
- Let a visually rich media section breathe, but keep operational sections efficient.

### Standard report

Use for analytical reports and dashboards.

- Use 40–72px between sections and 24–40px inside structural blocks.
- Allow larger charts, comparison cards, annotations, and supporting context.
- Maintain clear distinction between analysis, actions, and diagnostics.

### Visual media

Use for cinema, trailers, galleries, and image-led recommendations.

- Give posters, thumbnails, and video stable aspect ratios.
- Use 32–64px section rhythm and compact metadata below visuals.
- Prefer repeatable rails or grids; feature an item only when the payload marks it featured.
- Do not let empty metadata boxes consume more space than the visual content.

## Section archetypes

### 1. Open editorial

Best for the page introduction, a major story lead, or a narrative transition.

- No outer card.
- Use whitespace, type, and one restrained rule.
- Optional semantic Kurami Note may occupy the margin or attach to a specific phrase.

### 2. Compact strip

Best for metrics, schedule summaries, freshness, weather, or quick state.

- One shared outer border or background.
- Internal items divided by one-pixel rules.
- Avoid separate shadowed cards inside another shadowed section.
- Collapse to two columns or a labeled vertical list on narrow screens.

### 3. Framed paper block

Best for one or two high-value groups needing visual emphasis.

- Warm surface, one-pixel border, tiny radius, optional offset shadow.
- Do not use for every section.
- Limit a normal briefing to two or three shadowed framed blocks.

### 4. Structured list

Best for news, tasks, messages, sources, or releases.

- No individual floating cards by default.
- Use rows, indices, metadata, and quiet separators.
- Support featured, standard, and compact row variants when priority is supplied.
- Keep row actions visually attached to the row's primary content.
- For more than 12 primary reading items, use feed pagination rather than a nested scrollbar or an unbounded `Show all` state.
- Allow one row to expand inline for an extended digest while keeping the surrounding list stable.

### 5. Split panel

Best for chart + interpretation, schedule + recommendation, or content + supporting action.

- Use unequal columns when one side is primary.
- Give each side a distinct role, not two unrelated sections forced together.
- Collapse in semantic reading order.

### 6. Media rail or grid

Best for trailers, premieres, posters, and visual recommendations.

- Use repeatable cards and stable visual ratios.
- Allow horizontal scrolling on mobile when visual proportions matter.
- Avoid large text-only cards when poster or thumbnail data is available.

### 7. Feature block

Best for a single explicitly featured item.

- Use only when the payload marks priority or `featured: true`.
- May use asymmetry, larger type, or a strong visual.
- Never infer that the first item is featured merely because it is first.

### 8. Quiet diagnostics

Best for data quality, source health, sync status, and freshness.

- Keep out of the default reader flow when systems are healthy.
- In a briefing, show a compact disclosure such as `Качество данных: частично` with a details action.
- Show a full source table only when explicitly requested or opened as diagnostics.
- Do not give diagnostics equal visual weight to primary reading content.

### 9. State block

Best for alerts, empty, loading, partial, stale, offline, and errors.

- Match emphasis to severity.
- Keep warning and partial states compact unless they block the page.
- Provide a direct action or explanation when one exists.

## Composition rules

- Do not use the same archetype more than twice in sequence.
- Do not give every section the same heading scale, background, border, and shadow.
- Alternate dense and calm regions based on reading priority, not decoration.
- Keep at least one open or strip-based region in a typical briefing.
- Use one clear dominant archetype per section; nested cards should have quieter treatment than their parent.
- Preserve semantic reading order on mobile.
- Choose component variants from content roles and state, not merely item position.

## Briefing example grammar

This is a composition example, not a fixed page template:

1. Open editorial introduction.
2. Compact metric or schedule strip.
3. Structured story list.
4. Split panel for chart plus interpretation or action.
5. Optional state disclosure.
6. Media grid when relevant.
7. Quiet footer.

Change or omit sections to match the payload. Never add source diagnostics, charts, cinema, or schedules only to make the page look complete.

## Visual density verification

Before handoff, verify:

- the first viewport contains useful information, not mostly ceremony;
- short content does not sit in unnecessarily tall boxes;
- the page does not resemble a stack of identical warm cards;
- at least three archetypes are present on a multi-section page when the content supports them;
- shadow, red fill, and large type remain scarce enough to signal hierarchy;
- full-page scroll length is proportionate to the amount of information.
