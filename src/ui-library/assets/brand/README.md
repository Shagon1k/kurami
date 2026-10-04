# Kurami PWA artwork

The native header WebP and favicon SVG are unchanged. The PWA exports are
separate assets, registered in `src/web/icons.ts`. Manifest ID `/`, start URL
`/en/` and scope `/` stay unchanged.

## Master and export

`kurami-fox-pwa-master-v3.svg` follows the existing header fox's silhouette,
forehead, muzzle and cheeks as flat black/orange/white vector paths. It preserves the mark without the previous
raster texture and soft contours. Its 1000-unit coordinate system is not a
pixel-resolution limit. The old v2 master and exports remain available for
previous installations; the current manifest advertises only v3 PNGs.

Run from the repository root:

```sh
node src/web/tools/build-icons.ts
```

Pass an absolute Chromium path as the final argument if the local browser is
not found. The exporter measures the vector's bounds, then rasterizes its paths
at each final size with Chromium. It does not resize an intermediate bitmap,
add packages or generate a new logo. It writes
four registered assets and an ignored preview at `dist/pwa-icons/preview.png`.

Both `any` and `maskable` exports at 512 and 1024 px fill the square with the
theme's light `surface-section` colour, shared through `PWA_BACKGROUND` with
the manifest's splash background and theme colour. Regular exports leave a
small outer margin; adaptive exports keep all fox pixels inside the circular
safe zone, with a small allowance for antialiasing. The safe zone is a circle,
not a square. See [Google's adaptive icon guidance](https://web.dev/articles/maskable-icon).

The browser regression compares the vector's silhouette and colour regions with
the original header artwork. It also verifies actual PNG dimensions, opaque theme-matched
backgrounds, solid orange, narrow outer-edge antialiasing, foreground coverage
and circular safe-zone containment.
Gateway tests verify GET/HEAD, denied writes and Access scope. Android launcher
shape, splash rendering and installed app updates still require phone checks.
Versioned URLs prevent new installations from selecting the previous image URL;
they do not force an existing Android WebAPK to update immediately.
Chrome can require confirmation before applying a changed app icon; see
[Chrome's manifest update behaviour](https://developer.chrome.com/blog/improvements-to-web-app-updates).

## Historical v2 generation

The previous built-in call referenced only the existing transparent fox and requested
`transparent_background: true`. The exact prompt was:

> Use case: precise-object-edit / logo-brand. Input image 1 is the existing Kurami fox logo to preserve, not a style suggestion. Create a high-resolution production master for an Android PWA splash screen and launcher icon. Reconstruct this EXACT fox mark with clean, sharp vector-like anti-aliased edges at 2048x2048 if available, otherwise the highest square resolution. Keep the original symmetric silhouette, proportions, thick pure-black outline, two upright triangular ears with orange inside, orange forehead/muzzle and white cheek cutouts unchanged. Keep the original bright orange color, no palette change, and smooth minimal original gradient only. Center the mark, upright, with roughly 5 percent transparent outer margin. Actual transparent alpha background, no square or circle behind the mark, no shadow, no glow, no lettering, no framing, no added features or decorative detail. This is a fidelity-preserving high-quality reconstruction, NOT a redesign. The output must stay crisp when displayed at 600px wide.
