---
title: UI library
nav: UI library
summary: The shared set of themes, buttons, tables and page shells that Digest, the docs and Hub are built from, and the checks that keep the products from drifting apart in looks.
section: platform
group: internals
order: 80
next: platform-decisions
---

The UI library is the shared layer `src/ui-library/` through which every Kurami site is drawn, so that they look and behave the same.

:::glance
- What it does: supplies themes, base styles, components and the page shell, and checks that the products use them
- Who uses it: Digest (`src/briefing/ui`), the docs (`src/human-docs`), Hub (`src/hub`) and any new site
- How it is built: TypeScript strings with no build step and no client framework; one style for every site
- State: `tests/ui-library/guard-baseline.json` — a freeze of the existing departures from the rules
- What checks it: `npm run test:ui-library`, `test:ui-guard`, `test:ui-browser`
:::

```diagram
kind: graph
title: The library layers
desc: Layers from top to bottom: products, patterns, components, foundations, themes and tokens. Each layer uses only those below it. Products are assembled from patterns and components and take colours and sizes from theme roles.
node digest "Digest" "editions" at 0,0
node docs "Docs" "pages" at 1,0
node hub "Hub" "dashboard" at 2,0
node header "Site header" "navigation and language" at 0,1
node shell "Page shell" "renderDocument" at 1,1
node button "Buttons" "and the theme switch" at 0,2
node table "Table" "callout, disclosure" at 1,2
node found "Foundations" "reset, fonts, diagrams" at 0,3
node runtime "Theme runtime" "before first paint" at 1,3
node theme "Kurami theme" "light and dark" at 0,4
node roles "Roles" "colour, shape, spacing" at 1,4
group products "Products" digest docs hub band
group patterns "Patterns" header shell band
group components "Components" button table band
group foundations "Foundations" found runtime band
group themes "Themes and tokens" theme roles band
```

## Compact controls

Regular buttons, fields and header controls share a 36-pixel size. The language
switch has the same square shape as the theme switch. Badges identify task status
and Suggested next. In parameter/value rows, Projects shows colored text for
CI, review, preview and sync freshness, without a border or background. The value
still names the result independently of its color.
Published Digest editions receive current shared control styles when served,
so an older edition uses the same sizes as a new page.

## Layers

The layers run from values up to finished pages, and each one knows only about those below it. At the bottom sit *roles*: not "red #e21b16" but "the accent colour" (`--accent-primary`). There are 32 colour roles and 19 others — fonts, radii, shadows, spacing and durations. The Kurami theme sets the role values in a light and a dark form, and the breakpoints for phone and tablet — 620 and 900 pixels — live in constants because `@media` cannot read variables.

Foundations: the style reset, typography, the focus ring, accessibility utilities, the container, the Onest, Fragment Mono and Caveat fonts that sit in the repository together with their OFL licences, and the `inlineDiagram` function that paints diagrams with theme roles. Components are the button, the theme switch, the table, the callout and the disclosure block. Patterns are the site header and the page shell `renderDocument`, which assembles the `<head>`, the skip link, the header, the main content and the footer. A separate runtime reads the stored theme choice or the system setting and applies it before first paint, so the dark theme does not flash light.

## Rules

A product assembles a page from library parts and styles it with roles only. Four rules follow.

1. A page is assembled through `renderDocument` and `renderSiteHeader`; buttons, tables, callouts and disclosure blocks are drawn by library functions, not by hand-written markup.
2. Styles use roles: `var(--text-muted)`, `var(--radius)`, `var(--shadow-card)`, `var(--space-4)`. A literal colour, radius or card shadow must not appear in product CSS.
3. A library class is not overridden from a product. If you need a different look, tune it through custom properties or change the library.
4. A product component stays in the product while one product needs it. When a second one does, it is moved into the library together with its tests, not copied.

A new page type gets a synthetic fixture in `src/ui-library/testing/fixtures.ts`, so that the browser check sees it in both themes.

## The guard and the baseline

The guard `tests/ui-library/guard.ts` reads the product code and counts violations against a set of rules: a hand-written `<button>`, a hand-written table, `<details>`, a custom header, a custom theme toggle, a literal colour, radius or shadow, an override of a library class, and a repeated CSS block in Digest and the docs. Every rule knows what to use instead and says so in its message.

Existing departures are frozen per file in `guard-baseline.json`, and a counter can only go down. The test rejects a new violation. When you remove an old one, the guard asks you to record the reduction with `node tests/ui-library/guard.ts --update`. If for a truly special element no library part fits, it is accepted with `--accept="<reason>"` (at least 25 characters), and the reason stays in the baseline file in full view of the reviewer. A PR states `UI-Library: used`, `extended` or `exception` (and `UI-Reason`).

```diagram
kind: graph
title: Where to go for a new part
desc: First look for a ready part in the library. If there is none, check whether a new variant or property is enough. If not, ask whether a second product needs the part. Only if that is also no, an exception with a reason remains.
node d1 "In the library?" decision at 0,0
node d2 "Is a variant enough?" decision at 0,1
node d3 "Does a second product need it?" decision at 0,2
node used "Use it" "UI-Library: used" at 1,0
node ext "Extend the library" "UI-Library: extended" at 1,2
node exc "Keep in the product" "UI-Library: exception" at 0,3
edge d1 -> used "yes"
edge d1 -> d2 "no"
edge d2 -> ext "yes"
edge d2 -> d3 "no"
edge d3 -> ext "yes"
edge d3 -> exc "no" accent
```

## Export for the skill

The Hermes skill "kurami-ui-preview-language" draws previews by the same rules, so it needs the same style. The command `npm run ui:export` builds the CSS and the theme script from the library into the skill's assets directory. The files are marked as generated, and a test checks that they have not fallen behind the library: after any library change the export is run again.

::::example A "Download" button in a new Digest block (an invented example)
:::steps
- **The author** — draws the button with `renderButton`, variant `secondary` and class `export-link`, and passes data through `data-*`.
- **The author** — writes the layout for the block: `gap: var(--space-3)`, background `var(--surface-panel)`.
- **The author** — out of habit adds `border-radius: 8px`.
- **The guard** — `npm run test:ui-guard` fails and suggests: "use var(--radius-sm), var(--radius) or var(--radius-md)".
- **The author** — replaces the radius with `var(--radius)` and the guard passes. The block looks right in the dark theme by itself, because the roles already know both sets of values.
- **The author** — writes `UI-Library: used` in the PR.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| A literal colour or radius appeared in product code | `test:ui-guard` fails and names the replacement | replace it with a role |
| You need a look that does not exist | the guard will not pass a hand-written button | add a variant or property to the library, state `extended` |
| The library changed, the export did not | a test finds the drift | run `npm run ui:export` |
| The number of violations went down | the guard asks you to record it | `node tests/ui-library/guard.ts --update` |
| A diagram uses a colour outside the palette | `inlineDiagram` rejects it at build time | take the colour from the diagram palette |

:::guarantees
- Every site takes colours only from theme roles, so the dark theme works the same everywhere.
- A product does not override a library class: a look changes in one place.
- A new hand-written part does not slip past the guard: it is either in the library or recorded as an exception with a reason.
- The theme choice is applied before first paint.
:::

:::code-map
- `src/ui-library/tokens/index.ts` — the list of roles, the scales and the breakpoints
- `src/ui-library/themes/kurami.ts` — role values for the light and dark theme
- `src/ui-library/foundations/` — reset, fonts, `inlineDiagram`
- `src/ui-library/components/` — button, theme switch, table, callout, disclosure
- `src/ui-library/patterns/` — the site header and the `renderDocument` shell
- `src/ui-library/runtime/theme.ts` — the theme choice script
- `src/ui-library/export.ts` — the export for the skill
- `tests/ui-library/guard.ts` — the guard and its baseline
- `docs/ui-library-inventory.md` — history and rationale for the library boundary
:::
