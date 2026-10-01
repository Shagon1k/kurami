# UI library — inventory and proposed boundary (stage 9.1–9.2)

Status: inventory at `c31a505`; the owner approved the structure, self-hosted fonts, the system theme as first-visit default and a generated bundle for the UI skill. Implemented on branch `feat/ui-library`; see "Result" at the end. Stage 9 of `docs/human-docs-delivery-plan.md`.

## What exists today

Kurami renders HTML for three sites plus one private report. All of it is server-rendered TypeScript strings; there is no client framework.

| Surface | Renderer | Styles | Theme runtime | Fonts | Brand assets |
| --- | --- | --- | --- | --- | --- |
| Digest (Daily, Cinema, Weekly, Stocks) | `src/briefing/ui/*`, `src/briefing/{weekly,stocks}/*` | `briefing/ui/styles.ts` (44 KB) + `charts`, `weekly`, `stocks`, two component styles | inline in `briefing/server.ts`, loaded by `briefing.js` with `defer` | Google Fonts (Onest, Fragment Mono, Caveat) | from the UI skill's `assets/` |
| Human docs | `src/human-docs/render.ts` (58 KB) | `human-docs/styles.ts` (33 KB) | `assets/theme.js`, synchronous in `<head>` | self-hosted woff2 in `human-docs/assets/` | from the UI skill's `assets/` |
| Investment Review report | `briefing/investment-review/render.ts` | Digest styles + inline `.review-*` CSS | inline click handler, no persistence | via Digest shell | via Digest shell |
| UI skill reference | `integrations/hermes/skills/kurami-ui-preview-language/templates/reference/` | `globals.css` (900 lines) + React `component-library.tsx` | own | own | own |

The only code shared today is `src/shared-ui/tokens.ts`: fifteen colour variables and three font stacks, imported by Digest, Docs and the synthetic Daily fixture.

## Findings that shape the library

1. **Two competing token sets.** The skill's `globals.css` defines the same palette under different names and with drifted values: `--panel` is `#ffffff` there and `#faf8f2` in `shared-ui`, `--line` is ink-black there and `#c9c3b7` in code. An agent following the skill produces pages that do not match Digest or Docs.
2. **Three theme runtimes, three behaviours.** Digest follows the system preference but applies the theme after a deferred script, so a dark-mode reader sees a light flash. Docs applies the stored theme before first paint but ignores the system preference and defaults to light. Investment Review toggles without saving. All three hard-code `data-theme="light"` in the HTML.
3. **Two font pipelines.** Docs bundles fonts with their OFL licences; Digest fetches the same families from Google Fonts on every page view. Caveat (Kurami notes) exists only on Google Fonts.
4. **Two headers built separately.** Digest `utility-header` (brand + edition date, section nav, theme button) and Docs `site-header` (brand, top nav, mobile menu, language link, theme button) share the look but not a line of code; their heights, fox sizes and focus rings differ slightly.
5. **Duplicated foundations.** Reset, focus ring, skip link (`.skip-link` vs `.skip`), screen-reader utility, page container (`.page-shell` 1320 px vs `.frame` 1180 px), and data tables (Docs `.data-table`, Investment Review `.review-table`, Weekly `.weekly-table-scroll`).
6. **Hard-coded colours outside tokens.** Digest styles contain 19 literal hex values, Docs 6, and the four Excalidraw diagram builders embed the light palette directly, so the exported SVGs cannot follow dark mode.
7. **Tokens name colours, not purposes.** `--paper`, `--ink`, `--signal` work while there is one theme, but a new theme cannot tell which role a variable plays. `--docs-signal-text` exists because accent-as-text needed a darker value, which is a missing semantic role.

## Classification

**Foundation / token**: colour roles, typography roles, spacing, radii, borders, shadows, focus ring, motion and reduced motion, breakpoints, chart palette, diagram palette, `@font-face` and bundled fonts, brand assets (fox, favicon), reset, skip link, `sr-only`, page container.

**Universal primitive** (two or more real consumers today):

| Primitive | Consumers now |
| --- | --- |
| Button and icon button | Digest `renderButton`; Docs header actions (ad-hoc `.actions` CSS) |
| Theme switch + theme runtime | Digest, Docs, Investment Review |
| Link style | Digest, Docs |
| Surface / card | Digest `briefing-panel`, Stocks cards, Docs `sample-run-card`, route cards |
| Data table | Docs, Investment Review, Weekly |
| Disclosure (`details`) | Digest `story-disclosure`, Stocks method, Docs technical/details blocks |
| Callout / notice | Stocks `stocks-notice`, Docs `callout` |
| Empty / stale / failure message | Digest `section-empty`, `cinema-failure`, Stocks load status; Docs state examples |

**Shared composed pattern**: site header (brand, optional meta, nav, actions, mobile menu), page shell (skip link, header, main, footer), responsive container.

**Digest-specific** (stay in `src/briefing/ui`): news story, story media and lightbox, mail, agenda, metric strip, signal strip, feed order, reactions, pagination, topic chips, Kurami note and comment, company avatar, Cinema composition, Stocks rows and discovery cards, the chart engine and renderers (only Digest draws charts; the chart palette moves to tokens).

**Docs-specific** (stay in `src/human-docs`): article layout, side navigation, changelog, route cards, the flow/steps visual, diagram figures, and about twenty one-off “map” visuals (`health-map`, `admission-map`, `digest-map` …). Consolidating those maps into a few docs patterns belongs to the docs rework, not to the library.

**Obsolete or duplicate** (removed as their replacement lands): `src/shared-ui/`, the skill's `templates/reference/globals.css` and `component-library.tsx`, three theme scripts, the Google Fonts link, Docs `.actions` button CSS, `.skip`/`.skip-link`, `.frame`/`.page-shell`, inline `.review-table` CSS.

Status badges have no shared primitive yet: each product styles its own status text. After the docs rework, Docs state legends and Digest stale markers become the two consumers that justify one.

Hub adds `components/period-switch.ts`: a compact 7/30-day button group composed
from shared buttons, with `aria-pressed`, theme roles and the shared control height.
Tokens, Models, commits and Usage reuse it. Products own period persistence and
data selection; the component supplies escaped markup and CSS. Its CSS is also
included in the generated UI-preview bundle. UI-Library: extended.

Projects reuses the small line-icon API introduced alongside Hub. Forms keep
native select behavior with a decorative, pointer-transparent chevron and
consistent padding; forced-colour mode restores the native arrow. The button
library adds a `text` variant for task navigation, and tables accept validated
row classes plus `--table-head-background`. UI-Library: extended.
The Hub refresh adds `components/icon.ts` (decorative line icons) and
`components/stat-card.ts` (centered/start-aligned metrics and accessible load meters).
They use a new semantic `status-info` role, with values in the light/dark theme.
Forms now include `renderCheckbox`; disclosures accept a stable optional key for
preserving the correct disclosure across fragment refreshes. A library-only
fixture covers these primitives. Hub-specific history adapters, problem grouping,
work-feed filters and persistence remain in Hub. UI-Library: extended.

The next Hub pass moves Digest's mail checkbox into
`components/selection-control.ts`, including checked, indeterminate, disabled
and focus states. Digest keeps a compatibility re-export and the original
signal variant; Hub's `renderCheckbox` uses the data variant. The semantic
`accent-data` role supplies muted ochre in light mode and wheat in dark mode,
without changing success, warning or failure colours. Stat cards and meters
accept the same data accent. Disclosures add an inline variant; the shared
popover primitive supplies an anchored surface for product-owned positioning
and focus handling. Buttons can display an SVG icon beside a visible label;
`--button-justify` controls alignment without product overrides. The site header
accepts an optional utility slot: Hub uses it for one persistent 7/30-day selector.
Hub owns the log and summary layouts. UI-Library: extended.

The Projects revision adds `components/pill.ts` with named tones, dot/icon
support and a theme-owned `radius-pill` shape. Tables accept trusted header
content and sort directions, with opt-in height and sticky-heading properties.
Search fields support an icon and a visually hidden label. Header navigation
can scroll in a dedicated row on narrow screens. Popovers accept width/padding
properties; buttons add danger and underlined-link variants. The shared Sites
menu enables Projects for every product and preserves Russian language choice.
Library fixtures cover pills and button variants. UI-Library: extended.

The shared `control-height` token is 36px. Regular buttons, icon buttons, forms,
header links, menus and disclosure triggers use it; compact buttons remain 32px
and use the shared height on touch devices. Button SVGs are 18px with a 1.6 stroke;
products can tune `--button-icon-size`, `--button-width` and icon order. Pills use
11px text and 2px vertical padding. Table headers align vertically in the middle
and accept `--table-head-padding`. Projects uses 14px trailing sort icons,
centered Checks headings and full-width action groups. UI-Library: extended.
Projects reserves pills for Project status and Suggested next. Check results,
Kurami stages and sync freshness use plain text values. Its language link uses
the same icon-button variant as Hub and Docs.

## Proposed structure

```
src/ui-library/
  tokens/        semantic role names and the contract every theme must fill
  themes/        kurami/light.ts, kurami/dark.ts — values only
  foundations/   reset, typography roles, focus, a11y utilities, @font-face, container
  components/    button, theme-switch, link, surface, table, disclosure, callout, state-message
  patterns/      site-header, page-shell
  assets/        fonts + OFL licences, fox, favicon (moved from the skill and from Docs)
  runtime/       theme.js — one script for all sites
  testing/       shared browser regression over Digest and Docs
```

Each component is a render function plus its CSS string, like the existing Digest components. A site imports the CSS it uses; there is no npm package and no build step beyond what exists.

### Theme contract

Components read only semantic custom properties:

```
--surface-page  --surface-panel  --surface-raised  --surface-section
--text-primary  --text-muted     --text-accent     --text-inverse
--border-default --border-subtle
--accent-primary --accent-soft
--status-success --status-warning --status-failure
--shadow-offset  --focus-ring
--chart-1 … --chart-n  --diagram-*
```

A theme is a complete set of values for these properties. Light and dark are modes of the Kurami theme; a second theme would ship its own light and dark sets and components would not change. During migration the old names (`--paper`, `--ink`, `--signal` …) stay as aliases of the new ones, so unmigrated Digest and Docs CSS keeps working, and each alias is deleted once nothing reads it.

Theme runtime behaviour (one script, inlined synchronously in `<head>`): stored choice first, otherwise system preference; applied before first paint; the switch updates `aria-pressed` and its label; storage failures fall back silently. Digest and Docs live on different hostnames, so a stored choice does not carry between them; sharing it would need a cookie on the parent domain and is left out.

## Migration order

Each step is its own commit with Digest and Docs adapters, tests and a light/dark browser check. Digest needs `npm run briefing:build` and a service restart; Docs needs a docs release.

1. Create `ui-library` with tokens, the Kurami light/dark theme and legacy aliases; delete `shared-ui`.
2. Foundations and assets: shared reset, focus, skip link, container; self-host fonts for Digest too and drop Google Fonts.
3. Theme runtime and theme switch for Digest, Docs and Investment Review.
4. Site header and page shell patterns.
5. Button, link, surface, table, disclosure, callout, state message.
6. Chart and diagram palettes as tokens; diagram SVGs follow the theme.
7. Joint browser regression; rewrite the UI skill to reference `src/ui-library` and delete its CSS copy.

## Open decisions for the owner

- Approve the name `src/ui-library/` and the structure above.
- Self-host fonts in Digest (removes the Google Fonts request; bundles Caveat under OFL).
- Default to the system theme on first visit in Docs as well as Digest.
- The UI skill's React reference templates: delete them, or keep a generated token CSS file for previews built outside this repository.

## Result

Implemented in seven commits, one per migration step. Each step kept Digest pixel-stable (≤0.1% changed pixels in the joint screenshots) except for deliberate fixes, and passed `npm test` and the docs browser QA.

| Stage 9.6 criterion | Evidence |
| --- | --- |
| Digest and Docs share one library for confirmed shared parts | Both import tokens, foundations, button, theme switch, header, document shell, table, callout and disclosure from `src/ui-library/`; `tests/ui-library/verify.ts` asserts each CSS block is included exactly once per site. |
| Product components did not move for formal reuse | Story, mail, agenda, Cinema, Stocks, Kurami notes and state messages stay in `src/briefing/ui`; Docs maps and article layout stay in `src/human-docs`. |
| No competing `shared-ui` location | `src/shared-ui` is deleted; brand assets and fonts live only in `src/ui-library/assets`; the skill holds generated copies checked for freshness. |
| Light/dark did not regress | `npm run test:ui-browser` checks theme behaviour and audits overflow, names and AA contrast on Digest, Docs and a library-only page in both themes; Docs browser QA passes 360 combinations. |
| A new theme is a token-set swap | `Theme` requires 28 colour roles per mode and 19 scale roles; the contract test builds a different theme without touching components and rejects incomplete ones. |
| A sub-site needs no Digest/Docs CSS | The `library-subsite` fixture renders header, table, callout, disclosure and buttons from the library plus six lines of layout and passes the same audit. |
| The skill references real components | The skill names library and Digest functions and `src/ui-library` paths; the test fails if any name or path does not exist, or if the skill restates colours, Google Fonts or templates. |
| Joint browser regression | `npm run test:ui-browser -- --compare=<baseline dir>` compares screenshots of both products and reports the share of changed pixels. |

Fixes found along the way: the Digest pagination input had no focus ring (undefined `--focus`); white on the dark accent was 3.3:1, so dark primary buttons now use near-black text; small red text on warm sections was 4.1:1 and now uses `text-accent`; dark-mode Digest flashed light before its deferred theme script; diagrams were white slabs in dark mode; Lithuanian and arrow glyphs fell back to system fonts.

Deploying needs `npm run briefing:build`, a `kurami-briefing` restart, a docs release and `bin/sync-hermes-skills.sh --apply` for the rewritten skill. The stale `dist/shared-ui/` directory can be removed after the build.

## Hub controls additions

Hub owner controls add two shared primitives: `components/form.ts` exports labelled select and numeric fields; `components/dialog.ts` exports a labelled native dialog with the shared close button. Their CSS uses theme roles. `foundations/index.ts` supplies `.list-reset` for lists without markers. `npm run ui:export` includes these additions in the generated UI bundle.

`npm run test:hub-browser` exercises the controls with synthetic data and mocked actions in EN/RU at 320–1280 px. It checks confirmation, cancellation, contrast, overflow and shared-component use. The joint browser audit excludes the hidden contents of closed disclosures; the Hub check also opens the Sites menu after a theme change.

## Shared charts

`components/charts/` owns the SVG engine, trend and grouped-bar renderers,
styles, browser interactions and sparklines. Digest keeps language adapters
at `src/briefing/ui/charts/`; Hub supplies its commit and limit-history data to
the same component. Display settings control framing, density, legends, zoom,
value labels and the table. The chart palette changes with the theme and does
not change status or action colours. See `docs/charts.md` for the contract.
The generated UI stylesheet includes chart styles. UI-Library: extended.
