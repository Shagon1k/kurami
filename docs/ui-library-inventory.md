# UI library — inventory and proposed boundary (stage 9.1–9.2)

Status: inventory at `c31a505`, proposal awaiting owner approval. Nothing has moved yet. Stage 9 of `docs/human-docs-delivery-plan.md`.

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
