# Kurami UI implementation guide

Use this reference when implementing or refining a Kurami page. The code in
`/home/shagon1k/_hermes/_kurami/app/src/ui-library/` is the implementation;
this file only says how to use it and which rules no code can enforce. For the
Daily Briefing runtime, the production components in `src/briefing/ui/` render
every repeated element; do not hand-author their markup.

## Starting point

- In this repository, compose pages from library parts: `renderDocument`,
  `renderSiteHeader`, `renderThemeSwitch`, `renderButton` / `renderLinkButton`,
  `renderTable`, `renderCallout`, `renderDisclosure` and `inlineDiagram`. Add
  the matching `*_CSS` strings after `THEME_CSS` and `FOUNDATION_CSS`, then only
  your page's own layout.
- Outside this repository, link the generated `../assets/kurami-ui.css`, load
  `../assets/kurami-theme.js` synchronously in `<head>`, and copy
  `src/ui-library/assets/fonts/` beside the stylesheet as `fonts/`. Render the
  same class names and attributes the library functions produce.
- Style only through theme roles: `var(--surface-page)`, `var(--text-muted)`,
  `var(--border-default)`, `var(--radius)`, `var(--shadow-card)`,
  `var(--space-4)` and so on. A literal colour, radius or card shadow is a bug.

## Typography

Fonts are self-hosted OFL files; never add a Google Fonts link. The library
stacks are `--font-sans` (Onest), `--font-mono` (Fragment Mono) and
`--font-note` (Caveat 600, Kurami Notes only). Do not render a phrase that
contains Cyrillic with `--font-mono`, and do not request weights the fonts do
not provide (Onest 400–700, Fragment Mono 400, Caveat 600).

## Surfaces

The framed paper block (`--surface-section`, `--border-default`,
`--shadow-card`) is one archetype, not the default wrapper. Use the card shadow
on at most two or three important blocks. Select other structures from
`references/layout-archetypes.md` to create rhythm.

## Controls

- Buttons and link buttons come from the library. Controls use Onest 600,
  never heavier, and keep 44×44px targets.
- Text links use a persistent underline, arrow or other non-colour affordance.
- Use one icon family per page and normalize icons through one wrapper instead
  of per-glyph margins. Familiar emoji are allowed for feedback actions, with an
  explicit accessible name.
- Alerts use `!` for warning, pair semantic colour with an icon and explicit
  text, and keep the dismiss action at the edge with an accessible label. For a
  short note beside running text, use the library callout.

## Metrics and stories

Keep label, value, delta and context/period legible; the empty third row is
breathing room, not most of the card. Render a mixed-language metadata phrase
entirely in Onest.

## Paginated feeds

Keep provider names in data attributes or rendered values, never in component
or class names. Use 10–12 items per page for long primary feeds; no
`Show all`, infinite document growth or independently scrolling feed window.
Expand content inline with one item open by default. Render one to four
caller-supplied topics without changing their strings or order.

The runtime owns pagination, theme persistence, reactions and read state. The
generated HTML stays inert but must expose the Digest hooks listed in
`SKILL.md` (`data-feed-item`, `data-item-id`, `data-story-toggle`,
`data-story-details`, `data-paginated-feed`, `data-feed-pagination`,
`data-page-prev`, `data-page-next`, `data-page-status`, `data-page-input`) and
include every feed item in document order; the runtime hides pages outside the
current range. On small screens hide the numbered strip and show the 42px
numeric page input between previous and next.

## Bulk source actions

Render `idle`, `confirming`, `loading`, `success` and `error` from caller-owned
state. Do not embed provider APIs, provider names, cursor mutation or
persistence logic in the visual primitive.

## Media

Use a 2:3 visual area for poster-led premieres and 16:9 for video. If the
payload has no image, create a deliberate typographic placeholder with title or
category context rather than a large anonymous gradient.

## Charts and diagrams

Chart series read `--chart-1` … `--chart-5`. Make SVG nodes keyboard-focusable
when they expose tooltips, and include the exact value with useful time or
category context. Author explanatory diagrams in the light diagram palette and
inline them with `inlineDiagram` so they follow the theme; keep an adjacent
prose equivalent.

## Responsive matrix

The library breakpoints are `phone` (620px) and `tablet` (900px) in
`tokens/index.ts`.

| Width | Layout behavior |
|---|---|
| `≥ 1200px` | Full editorial grid; 3–4 metrics; multi-column media; compact briefing rhythm of 28–56px or standard rhythm of 48–80px |
| `900–1199px` | Reduce to 2–3 columns; preserve side-by-side sections only when both remain readable |
| `620–899px` | Two-column compact grids; story and source actions remain visible; media may become a horizontal rail |
| `< 620px` | Single reading column; 14px gutters; sections use 20–24px padding; tables stack into labelled rows or scroll safely |
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

1. **Canvas:** apply the library theme and foundations; confirm light, dark and the system default.
2. **Typography:** apply role-based families, then tune size, line-height, and wrapping using real Cyrillic content.
3. **Sections:** choose density and archetypes, establish reading width and responsive stacking, then verify that no universal wrapper dominates the page.
4. **Components:** use library components first; normalize remaining controls, icons, alerts, metrics, rows, charts, tables, and collections.
5. **Personality:** add only useful Kurami Notes and targeted doodle marks.
6. **Interaction:** implement hover, focus-visible, active, selected, disabled, tooltip, and dismiss behavior.
7. **Themes:** verify semantic alert colours, borders, muted text, diagrams and media surfaces in dark mode.
8. **Stress cases:** test long headings, zero/one/many items, partial data, mixed metadata, and narrow screens.
9. **Visual QA:** in this repository run `npm run test:ui-browser` (and the product's own browser checks); elsewhere inspect phone and desktop widths in both themes, run the build, and correct drift before handoff.

Do not polish isolated card shadows or doodles before the canvas, hierarchy, and typography are stable.
