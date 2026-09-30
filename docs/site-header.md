# Shared site header

`src/ui-library/patterns/site-header.ts` is the canonical header/navigation
pattern for every Kurami site; `patterns/page-shell.ts` builds the document
around it. Digest's `ui/components/site-header.ts` is a thin adapter that
supplies sections, the edition date and injectable navigation, and Digest's
`page-shell.ts` uses it for Daily, Cinema, Weekly, previews and empty states.
Docs use the same pattern with a collapsible menu below tablet width.
The transparent fox and wordmark replace the old boxed K. The edition date
stays next to the brand; the theme control remains a shared icon button.

Hub, Docs and Digest also show the shared **Sites** switcher in the header.
`src/ui-library/patterns/kurami-sites.ts` defines its destinations: Hub,
Digest, Docs, Hermes and Dokploy. Docs keeps the current language when the
switcher points back to Docs. Projects is listed as **soon** with its future
destination in code, but has no clickable link until the site is available.
The switcher becomes an icon button on phones; each
site keeps its own navigation separate from this cross-site menu.

`site-navigation.ts` reads publication state, not page content. Only current
complete/partial Daily and Cinema editions qualify; expired Daily, prepared
previews and empty Weekly snapshots do not. Weekly must also be enabled.
The server injects the small navigation fragment into each response, so an old
Daily automatically gains the Weekly link when the first review is promoted.
This does not change the stored edition payload, source data or content digest.

Labels are День, Кино and Неделя. Links target the latest snapshots at `/`,
`/cinema` and `/weekly`. The current section is indicated by both
`aria-current="location"` and a red underline. Mobile retains all available
links in a second row without a menu. A ResizeObserver measures actual sticky
header height for anchor offsets. Focus/hover states and light/dark tokens are
shared; the logo has a subtle dark-theme edge treatment without a background box.

## Brand assets

- Browser favicon: existing `kurami-favicon.svg`, unchanged.
- Header: `src/ui-library/assets/brand/kurami-fox-header.webp` (256 × 256, transparent).
- Server asset URL: `/assets/kurami-fox.webp` (GET/HEAD, cached).
- The 512 × 512 PNG remains at `/assets/kurami-fox.png` for older pages and the Hub app icon.

The original header PNG was produced with built-in ImageGen, editing the user-approved
fox artwork. Alpha was verified to range from 0 to 255; the outer corner is
fully transparent and the white cheeks remain filled. The image generation
was an implementation-time edit only, never part of the digest pipeline.

Final edit prompt:

> Use case: background-extraction. Image 1 is the exact edit target, an existing
> Kurami fox head logo. Produce a clean web header logo cutout on a genuinely
> transparent alpha background (not a checkerboard painted as pixels). Remove
> ONLY the warm off-white background outside the black fox silhouette. Keep
> the logo's exact geometry, thick black outline, orange ears and orange
> forehead/muzzle, and SOLID WHITE cheeks inside the silhouette. Keep its
> existing symmetry and proportions; do not redesign, add a square frame, add
> text, add shadows, or add new details. Tight square framing with about 4%
> transparent padding around the full fox head, no clipping of ears or chin.
> Output one transparent PNG asset.

## Tests

`npm run test:briefing-header` verifies availability, disabled/empty states,
safe markup, active section, data preservation and the asset route.
`HEADER_PREVIEW_PORT=8795 npm run test:briefing-header` serves a synthetic
showcase using the actual header, CSS and browser runtime.
