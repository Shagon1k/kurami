# Agent notes for Kurami

## UI: build pages from `src/ui-library/`

Every Kurami site (Digest, human docs, any new sub-site) renders through the shared UI library.
`docs/ui-library-inventory.md` explains what lives there and why.

- Compose pages with `renderDocument` + `renderSiteHeader`; use `renderThemeSwitch`,
  `renderButton` / `renderLinkButton`, `renderTable`, `renderCallout`, `renderDisclosure` and
  `inlineDiagram` instead of hand-written markup. Build the stylesheet from `THEME_CSS`,
  `FOUNDATION_CSS` and the `*_CSS` of the components you use, then add only your page layout.
- Style with theme roles only (`var(--text-muted)`, `var(--radius)`, `var(--shadow-card)`,
  `var(--space-4)` …). Never write a literal colour, radius or card shadow, and never restyle a
  library class from product CSS: tune it through its custom properties or change the library.
- Product components stay in their product (`src/briefing/ui`, `src/human-docs`). When a second
  product needs the same look or control, move it into `src/ui-library` with tests and use it from
  both; do not copy CSS or markup between products.
- A new page type needs a synthetic fixture in `src/ui-library/testing/fixtures.ts`.
- Run `npm run test:ui-library`, `npm run test:ui-guard` and `npm run test:ui-browser` for UI
  changes. The guard freezes existing exceptions; if you reduce them, record it with
  `node tests/ui-library/guard.ts --update`. Growing them needs `UI-Library: exception` and a
  `UI-Reason:` in the PR body.
- After changing the library, run `npm run ui:export` so the UI-language skill bundle stays current.
