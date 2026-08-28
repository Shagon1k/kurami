# Kurami UI implementation recipes

Use this reference when implementing or refining HTML, CSS, React, or another web UI. The recipes are framework-neutral baselines; preserve their semantic roles when translating them into components or utility classes.

## Font loading

Load all three approved families from Google Fonts:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Fragment+Mono:ital@0;1&family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Use these stacks:

```css
:root {
  --font-sans: "Onest", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Fragment Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-note: "Caveat", "Segoe Print", cursive;
}

body { font-family: var(--font-sans); }
.technical-label { font-family: var(--font-mono); }
.kurami-note { font-family: var(--font-note); font-weight: 600; }
.page-title { font-size: clamp(2.5rem, 5.5vw, 4.75rem); font-weight: 600; line-height: 1.02; }
.section-title { font-size: clamp(1.65rem, 3vw, 3rem); font-weight: 600; line-height: 1.08; }
```

Do not request weights that are not loaded. Do not render mixed Cyrillic phrases with `--font-mono`.

## Canvas and section recipe

```css
.page {
  min-height: 100dvh;
  color: var(--ink);
  background: var(--paper);
}

.page-shell {
  width: min(100% - 32px, 1280px);
  margin-inline: auto;
}

.section-block--framed {
  padding: clamp(24px, 4vw, 48px);
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--section);
  box-shadow: 4px 4px 0 var(--section-shadow);
}

.section-block--open {
  padding-block: clamp(24px, 4vw, 52px);
  border-block: 1px solid var(--line);
}

.section-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  border: 1px solid var(--line);
  background: var(--surface);
}
```

The framed block is one archetype, not the default wrapper. Use the offset shadow on at most two or three important blocks. Select other structures from `references/layout-archetypes.md` to create rhythm.

## Button and link recipe

```css
.button {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1px solid var(--ink);
  border-radius: 3px;
  font: 600 0.875rem/1 var(--font-sans);
  text-decoration: none;
  transition: color 160ms, background 160ms, border-color 160ms, transform 160ms;
}

.button--primary { color: #fff; background: var(--signal); border-color: var(--signal); }
.button--secondary { color: var(--ink); background: var(--surface); }
.button:active { transform: translateY(1px); }
.button:focus-visible { outline: 2px solid var(--signal); outline-offset: 3px; }
```

Text links use Onest 600 and a persistent underline, arrow, or other non-color affordance. Never use font-weight above 600 for controls.

## Icon button recipe

```css
.icon-button {
  inline-size: 44px;
  block-size: 44px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--ink);
  background: var(--surface);
}

.icon-button > svg { inline-size: 20px; block-size: 20px; stroke-width: 1.75; }
```

Use one icon family per page. Normalize icons through one wrapper rather than correcting each glyph with arbitrary margins.

For familiar feedback actions, emoji are allowed:

```html
<button class="icon-button reaction" type="button" aria-label="Нравится" aria-pressed="false">👍</button>
<button class="icon-button reaction" type="button" aria-label="Не нравится" aria-pressed="false">👎</button>
```

```css
.reaction { font-size: 18px; line-height: 1; }
.reaction[aria-pressed="true"] { color: #fff; background: var(--signal); border-color: var(--signal); }
```

## Badge and alert recipe

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 3px 8px;
  border: 1px solid currentColor;
  border-radius: 5px;
  font: 600 0.75rem/1 var(--font-sans);
}

.alert {
  min-height: 56px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 16px;
  border: 1px solid currentColor;
  border-left-width: 4px;
  border-radius: 3px;
}
```

Use `!` for warning. Keep the dismiss action in the final grid column and give it an accessible label. Pair semantic color with an icon and explicit text.

## Metric and story recipe

```css
.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 12px;
}

.metric-card {
  min-height: 176px;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  align-content: start;
  gap: 8px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--panel);
}

.metric-label { color: var(--muted); font-size: 0.8125rem; }
.metric-value { font-size: clamp(1.75rem, 3vw, 2.5rem); font-weight: 600; line-height: 1.05; }
.metric-context { align-self: end; color: var(--muted); font-size: 0.75rem; }
.metric-delta { width: max-content; padding: 5px 9px; border: 1px solid; border-radius: 6px; font-size: 0.75rem; font-weight: 600; line-height: 1; }

.story-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 44px;
  gap: 16px;
  padding: 24px 0;
  border-bottom: 1px solid var(--line);
}
```

Keep label, value, delta, and context/period legible. Use the empty third row as breathing room, not most of the card. Render a mixed-language metadata phrase entirely in Onest. Match the richer metric structure in `templates/reference/component-library.tsx` when possible.

## Paginated Digest Feed recipe

Keep provider names in data attributes or rendered values, not in component or class names.

```html
<section class="digest-feed" aria-labelledby="digest-title">
  <header class="digest-feed__header">
    <div><h2 id="digest-title">Prepared title</h2><p>Prepared total and cutoff</p></div>
    <span class="source-facet">Prepared source · 126</span>
  </header>

  <article class="digest-item">
    <span class="digest-item__index">01</span>
    <div class="digest-item__copy">
      <p class="digest-item__meta">Prepared source · Prepared sub-source · Prepared time</p>
      <h3>Prepared headline</h3>
      <p>Prepared summary</p>
      <div class="topic-set" aria-label="Prepared topics">
        <span>Prepared topic</span><span>Another topic</span>
      </div>
      <div class="digest-item__expanded">Prepared extended digest</div>
    </div>
    <div class="digest-item__actions">…</div>
  </article>

  <nav class="pagination" aria-label="Prepared pagination label">…</nav>
</section>
```

```css
.digest-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 16px;
  padding: 24px 0;
  border-bottom: 1px solid var(--line);
}

.digest-item__expanded {
  margin-top: 20px;
  padding: 18px 20px;
  background: var(--surface);
  border-left: 4px solid var(--signal);
}

.topic-set {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 12px;
}

.topic-set > span {
  padding: 3px 7px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  font: 500 0.625rem/1.2 var(--font-sans);
}

.pagination {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
```

Use 10–12 items per page for long primary feeds. Do not add `Show all`, infinite document growth, or an independently scrolling feed window. Expand content inline and keep only one item open by default. Render one to four caller-supplied topics without changing their strings or order. On small screens, reduce numeric controls to newer/current/older while preserving the current range.

## Bulk Source Action recipe

```html
<section class="bulk-source-action">
  <div>
    <span>Prepared scope</span>
    <h3>Prepared action context</h3>
    <p>Prepared batch size, boundary, and consequence.</p>
  </div>
  <button class="button button--primary">Prepared action label</button>
  <small>Prepared exclusion or safety note.</small>
</section>
```

```css
.bulk-source-action {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px 28px;
  align-items: center;
  padding: 24px;
  border: 1px solid var(--line);
  border-top: 4px solid var(--ink);
  background: var(--surface);
}

.bulk-source-action > small { grid-column: 1 / -1; color: var(--muted); }
```

Render `idle`, `confirming`, `loading`, `success`, and `error` from caller-owned state. Do not embed provider APIs, provider names, cursor mutation, or persistence logic in the visual primitive.

## Media card recipe

```css
.media-card {
  min-width: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  background: var(--surface);
}

.media-visual { position: relative; aspect-ratio: 16 / 9; background: var(--ink); }
.media-duration { position: absolute; right: 10px; bottom: 10px; padding: 4px 6px; color: #fff; background: #000c; border-radius: 3px; }
.media-body { display: grid; gap: 6px; padding: 16px; }
.media-meta { color: var(--muted); font-size: 0.75rem; }
```

Use a 2:3 visual area for poster-led premieres and 16:9 for video. If the payload has no image, create a deliberate typographic/geometric placeholder with title or category context; do not leave a large anonymous gradient.

## Chart interaction recipe

```css
.chart-node {
  r: 3;
  transition: r 140ms ease;
}

.chart-node:hover,
.chart-node:focus {
  r: 6;
}
```

Make SVG nodes keyboard-focusable when they expose tooltips. The tooltip must include the exact value and useful time/category context.

## Responsive matrix

| Width | Layout behavior |
|---|---|
| `≥ 1200px` | Full editorial grid; 3–4 metrics; multi-column media; compact briefing rhythm of 28–56px or standard rhythm of 48–80px |
| `900–1199px` | Reduce to 2–3 columns; preserve side-by-side sections only when both remain readable |
| `640–899px` | Two-column compact grids; story and source actions remain visible; media may become a horizontal rail |
| `< 640px` | Single reading column; 16px gutters; sections use 20–24px padding; tables become labeled rows or scroll safely |
| `< 400px` | Tighten gaps, never type; retain 44px targets and all content/actions |

Collapsing rules:

- Preserve semantic reading order rather than the visual desktop column order.
- Scale page titles fluidly; do not force desktop line breaks on mobile.
- Keep variable media collections repeatable; horizontal scrolling is acceptable when card proportions matter.
- Reduce decorative offsets and rotations when space is tight.
- Keep the number and length limit of Kurami Notes identical on all viewports.
- Never hide status, freshness, feedback, or primary actions merely to simplify mobile.

## Ordered iteration guide

Refine every page in this order:

1. **Canvas:** apply paper, ink, surface, section, and line tokens; confirm light and dark theme roots.
2. **Typography:** load fonts, apply role-based families, then tune size, line-height, and wrapping using real Cyrillic content.
3. **Sections:** choose density and archetypes, establish reading width and responsive stacking, then verify that no universal wrapper dominates the page.
4. **Components:** normalize controls, icons, alerts, metrics, rows, charts, tables, and collections.
5. **Personality:** add only useful Kurami Notes and targeted doodle marks.
6. **Interaction:** implement hover, focus-visible, active, selected, disabled, tooltip, and dismiss behavior.
7. **Themes:** verify semantic alert colors, borders, muted text, and media surfaces in dark mode.
8. **Stress cases:** test long headings, zero/one/many items, partial data, mixed metadata, and narrow screens.
9. **Visual QA:** compare the result with `templates/reference/`, run the build, and correct drift before handoff.

Do not polish isolated card shadows or doodles before the canvas, hierarchy, and typography are stable.
