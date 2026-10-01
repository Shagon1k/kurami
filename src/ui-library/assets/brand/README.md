# Kurami PWA artwork

The native header WebP and favicon SVG are unchanged. The PWA exports are
separate assets, registered in `src/web/icons.ts`. Manifest ID `/`, start URL
`/en/` and scope `/` stay unchanged.

## Master and export

`kurami-fox-pwa-master-v2.png` is a 1254×1254 transparent PNG generated with
the built-in imagegen tool. Its reference was `kurami-fox-transparent.png`.
The reconstruction keeps the black/orange/white fox design; it is not a new
brand direction. The master stays in Git so technical exports are reproducible
without another generative request. The old files remain available.

Run from the repository root:

```sh
node src/web/tools/build-icons.ts
```

Pass an absolute Chromium path as the final argument if the local browser is
not found. The exporter uses Chromium canvas for PNG sizing and placement,
without new packages, generative editing or upscaling the master. It writes
four registered assets and an ignored preview at `dist/pwa-icons/preview.png`.

Transparent `any` exports at 512 and 1024 px leave a small outer margin.
Separate `maskable` exports at the same sizes fill the square with the theme's
light `surface-page` colour. All fox pixels fit inside the guaranteed circular
safe zone, with a small allowance for antialiasing. The safe zone is a circle,
not a square. See [Google's adaptive icon guidance](https://web.dev/articles/maskable-icon).

The browser regression verifies actual PNG dimensions, transparency, opaque
adaptive backgrounds, foreground coverage and circular safe-zone containment.
Gateway tests verify GET/HEAD, denied writes and Access scope. Android launcher
shape, splash rendering and installed app updates still require phone checks.
Versioned URLs prevent new installations from selecting the previous image URL;
they do not force an existing Android WebAPK to update immediately.

## Generation prompt

The built-in call referenced only the existing transparent fox and requested
`transparent_background: true`. The exact prompt was:

> Use case: precise-object-edit / logo-brand. Input image 1 is the existing Kurami fox logo to preserve, not a style suggestion. Create a high-resolution production master for an Android PWA splash screen and launcher icon. Reconstruct this EXACT fox mark with clean, sharp vector-like anti-aliased edges at 2048x2048 if available, otherwise the highest square resolution. Keep the original symmetric silhouette, proportions, thick pure-black outline, two upright triangular ears with orange inside, orange forehead/muzzle and white cheek cutouts unchanged. Keep the original bright orange color, no palette change, and smooth minimal original gradient only. Center the mark, upright, with roughly 5 percent transparent outer margin. Actual transparent alpha background, no square or circle behind the mark, no shadow, no glow, no lettering, no framing, no added features or decorative detail. This is a fidelity-preserving high-quality reconstruction, NOT a redesign. The output must stay crisp when displayed at 600px wide.
