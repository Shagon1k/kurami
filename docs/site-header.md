# Shared site header

`src/ui-library/patterns/site-header.ts` is the canonical header/navigation
pattern for every Kurami site; `patterns/page-shell.ts` builds the document
around it. Digest's `ui/components/site-header.ts` is a thin adapter that
supplies sections, the edition date and injectable navigation, and Digest's
`page-shell.ts` uses it for Daily, Cinema, Weekly, previews and empty states.
Docs use the same pattern with a collapsible menu below tablet width.
The transparent fox and wordmark replace the old boxed K. The edition date
stays next to the brand; the theme control remains a shared icon button.

Hub, Docs, Projects and Digest show the shared **Apps / Приложения** switcher in the header.
`src/ui-library/patterns/kurami-sites.ts` defines its destinations: Hub,
Digest, Projects, Docs, Hermes and Dokploy. The product apps preserve `ru` or `en`
when switching sites. Digest localizes Daily, Cinema, Weekly and Stocks;
source names and original titles remain in their original language. Older
Daily and Cinema editions without English editorial copy show an explicit
original-language notice.
Hermes and Dokploy are separated external links opening in a new tab.
At widths up to 620px, all four apps use the shared full-width bottom panel
from `patterns/mobile-navigation.ts`. It has 32px icons above compact labels;
the top header scrolls with the page. Apps and contextual menus open above the
panel and close on repeat click, outside click or Escape. Language and theme move
to Settings with a gear icon; existing controls are moved, not cloned, and return on desktop resize.
Selected links share a warm fill and short bottom marker. Menus fade and slide;
icons respond to open state. Reduced motion disables these transitions.
Projects moves its search form into Search at the top of the visual viewport;
visual viewport resize/scroll events keep it above the keyboard. Docs includes its section tree and
article contents. Digest derives edition contents from rendered section headings.
Hub has Apps, On page, Controls and Settings; its period stays outside the panel.
Sections switches between pages in Digest and Docs; On page jumps to current-page headings.
Hub serves `/ru/` and `/en/` with localized dashboard labels and PWA offline
pages. Hub, Docs and Digest redirect their root URL to `/en/`; the language
control links between explicit `/en/` and `/ru/` routes. Digest upgrades
retained Daily and legacy Cinema headers when serving
them, so their Apps control does not depend on republishing old editions.

The shared wordmark includes the app suffix: Hub, Digest, Projects or Docs.
At the unified entry, product-owned URL projection maps these links to
`/en/`, `/en/digest/`, `/en/projects/` and `/en/docs/`, with matching RU paths.
Apps links from native hostnames also target this entry; the old hostnames
themselves remain available without redirects until cutover is approved.
The canonical origin and entry URLs live in `kurami-sites.ts`; the gateway and
shared footer reuse them. See [unified web operations](kurami-web-operations.md).
Hub's global period switch stays inline on desktop and uses the library's
floating period-button variant above the phone panel. One click cycles 7/30 days;
it does not open a popover. The selection remains stored across reloads.

`site-navigation.ts` reads publication state, not page content. Only current
complete/partial Daily and Cinema editions qualify; expired Daily, prepared
previews and empty Weekly snapshots do not. Weekly must also be enabled.
The server injects the small navigation fragment into each response, so an old
Daily automatically gains the Weekly link when the first review is promoted.
This does not change the stored edition payload, source data or content digest.

Labels are Daily, Cinema, Weekly and Stocks in English, and День, Кино,
Неделя and Акции in Russian. Links target the latest snapshots under the
selected locale prefix. Legacy unprefixed URLs redirect to English. The
current section is indicated by both
`aria-current="location"` and a red underline. Mobile retains all available
links in a second row without a menu. A ResizeObserver measures actual sticky
header height for anchor offsets. Focus/hover states and light/dark tokens are
shared; the logo has a subtle dark-theme edge treatment without a background box.
Edition metadata uses the library's compact calendar date formatter. Long dates
clip within the brand column, never beneath action buttons. Snapshot times retain
their own source timestamp; Docs does not invent a current date.
The wordmark is also bounded by its brand column. Collapsible headers tighten
the logo and wordmark below 360 px without adding a header row or shrinking controls.
Section navigation stays within its grid column when labels or text grow.
When the links no longer fit, the navigation scrolls horizontally inside the
header; the whole page does not become wider. Links remain keyboard-accessible.

## Shared page framing

`patterns/site-footer.ts` supplies the same layout to Hub, Digest, Projects and
Docs: product identity, optional real update metadata, documentation and required
credits. Digest refreshes the footer of retained editions at serve time without
changing their stored payloads. Weekly and Stocks supply their captured timestamp;
Daily and Cinema supply edition metadata. All use `formatSiteDate` for the footer.
Empty states omit an unavailable update time. Foundation CSS supplies the title, eyebrow and
subtitle hierarchy where those roles apply; dense dashboards keep their compact
section headings. Font preloads are generated by `foundations/fonts.ts`.

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
