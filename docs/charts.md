# Reusable charts

`src/ui-library/components/charts` provides deterministic server-rendered SVG
with one browser runtime for Digest, Stocks and Hub. `src/briefing/ui/charts`
keeps compatibility adapters that select the Digest language. No charting dependency, provider requests or AI
layout generation is involved.

## Boundary

- Add-ons supply a `ChartInput`: stable ID, title, axis labels, one unit,
  ordered categories and series with aligned values.
- `renderTrendChart(input, language)` and `renderBarChart(input, language)`
  support up to five series. Bars group series side by side and keep a zero
  baseline. Stacked bars are outside this contract. Shared renderers default to
  Russian; Digest adapters use the current request language.
- `createChartEngine()` validates the versioned contract and calculates layout.
  The exact same self-contained function runs on the server and in the browser;
  there is no parallel client-side scale implementation.
- `render.ts`, `client.ts` and `styles.ts` own semantic markup, interactions,
  token-based styling, empty states and accessibility.
- Cinema's `chart-adapter.ts` aligns provider dates to the shared model. It
  neither collects new data nor changes the persisted Cinema snapshot.

## Example

```ts
import { renderBarChart } from "../ui/charts/index.ts";

const html = renderBarChart({
  id: "weekly-mail-volume",
  title: "Mail volume",
  xLabel: "Week",
  yLabel: "Messages",
  unit: { kind: "number" },
  categories: [
    { key: "2026-09-07", label: "7–13 September", shortLabel: "7 Sep" },
    { key: "2026-09-14", label: "14–20 September", shortLabel: "14 Sep", partial: true },
  ],
  series: [{ id: "mail", label: "Messages", values: [23, 0] }],
});
```

Labels are caller-supplied; production UI uses Russian. This is illustrative
input, not permission to add synthetic metrics to a published digest.

## Data invariants

- 0 means a measured zero. Null means unavailable and creates a line gap.
  Never fill missing weeks, pre-release periods or absent market quotes with 0.
- Categories are explicitly ordered; every series has exactly one value per
  category. IDs/keys are unique and safe; labels are escaped.
- At most 120 categories and five series. Values must be finite and within
  ±1e15. Invalid input is rejected before rendering.
- Units are number (optional suffix), percent, or one three-letter currency.
  Percent values are already percentage points: 12 means 12%, not 1200%.
- Bar baseline is always zero. Trend defaults to zero and can explicitly use
  `baseline: "auto"` for meaningful ranges such as prices.
- Mark an unfinished period with `partial: true`; the marker and textual note
  are not a prediction. No normalization of unfinished totals is implicit.
- States are ready, partial and unavailable, with an optional explanatory
  message. Empty/missing data is distinct from an all-zero series.

## Shared behavior

Trend nodes are filled circles (3.5px rest, 6px hover/focus). The theme supplies
muted blue, terracotta, sage, ochre and grey in separate light/dark palettes.
Lines stay straight; the fifth palette colour uses a dashed line. Bars show
values by default and use the theme radius. Incomplete measurements have a
muted fill, dashed stroke and asterisk.

Legend buttons hide/show series and rescale the visible range. Hiding every
series produces a recoverable empty state. Zoom buttons select the last N
categories, down to three (or fewer if that is all the data); no data is
interpolated or discarded. `initialWindow` optionally chooses the starting N.
Each chart keeps its own local interaction state.

Both axes are present; long category sets use deterministic tick thinning.
Cards retain controls on mobile and horizontally scroll only the plot.
Embedded plots recalculate their width to fit the parent, including compact
Hub panels. Automatic value labels hide when bar slots become too narrow. Light/dark
themes and reduced motion use the shared design tokens.

Arrow Left/Right move between points, Home/End to the ends; Up/Down switch
series at the nearest period. Focus scrolls into view and exposes the exact
value. Escape dismisses the tooltip. There is one tab entry for the plot.
The semantic table always exposes all exact values, including
hidden/out-of-window series. Server-rendered SVG and table work without JS.

## Verification

`npm run test:briefing-charts` covers the shared server/browser engine,
validation, null gaps, zeros, negatives, flat and tiny ranges, incomplete
periods, legend/zoom domains, escaping and Cinema mapping. It belongs to the
full regression runner.

For local visual QA, run
`CHARTS_PREVIEW_PORT=8792 npm run test:briefing-charts`. The temporary synthetic
showcase contains a multi-series trend and a 13-bucket bar chart, using the
real shared styles and browser script. It never reads production state.

Weekly Review uses BarChart; Stocks and Cinema use TrendChart. The shared
`renderSparkline(values, label)` supplies a bounded non-interactive miniature
for Stocks rows: finite values, explicit null gaps, flat-range handling and
an accessible caller-supplied label. It does not replace the detailed chart.
Dynamic disclosures dispatch `kurami:charts-mount` after inserting canonical
markup; already-mounted charts are skipped and closed details stay unmounted.

## Display settings

Set `display` on the input to adapt the shared component:

| Setting | Default | Alternative |
| --- | --- | --- |
| `variant` | `"card"` | `"embedded"` removes the component frame and padding. |
| `density` | `"regular"` | `"compact"` uses a smaller canvas and fewer date labels. |
| `header` | `true` | `false` keeps the title available to screen readers. |
| `legend` | `"interactive"` | `"static"` or `"hidden"`. Single-series legends are static. |
| `zoom` | `true` | `false` lets the host own period selection. |
| `values` | Visible on cards; automatic on embedded plots | `true` or `false` overrides labels above bars; exact values remain in tooltips and the table. |
| `table` | `"disclosure"` | `"screen-reader"` keeps the table in the accessibility tree without a visible disclosure. |

`series.color` selects a palette slot from 1 to 5, independently of series
order. `series.partial` is an optional boolean array aligned with its values;
it marks incomplete measurements in one series without marking other series
in the same category. Category-level `partial` still applies to every series.
`minimumMaximum` sets a positive floor for the upper scale bound. Hub's limit
history uses 100 and expands above it when observed daily usage exceeds 100.

Hub commits use embedded bars with repository filters and the existing global
7/30-day selector. Limit history uses compact grouped bars with per-window
partial flags. Missing observations remain null. Stocks sparklines use the
same first palette colour; their detailed charts keep their own price scales.

After replacing a fragment, dispatch `kurami:charts-mount` on `document`.
To update values without replacing a chart, dispatch `kurami:chart-update` on
its `[data-chart]` element:

```ts
chart.dispatchEvent(new CustomEvent("kurami:chart-update", {
  detail: { values: [[4, null, 0]], state: "ready" },
}));
```

`values` contains one aligned array per existing series. Optional `state` and
`message` update the availability notice. The engine validates updates before
changing the plot or exact-value table. Series identities, categories and
presentation stay fixed; replace the fragment to change them.

Frozen Digest editions receive current chart CSS and theme roles at serve
time. Their stored markup and measurements remain intact.

Run `npm run test:ui-charts-browser` for keyboard, legend, zoom, updates,
no-JavaScript rendering, light/dark themes and 320/390/1280px checks. Screenshots
are written to `dist/charts-browser`. `npm run test:ui-browser` also audits the
shared chart showcase in Russian and English.
