# Reusable charts

`src/briefing/ui/charts` provides deterministic server-rendered SVG enhanced by
the shared briefing client. No charting dependency, provider requests or AI
layout generation is involved.

## Boundary

- Add-ons supply a `ChartInput`: stable ID, title, axis labels, one unit,
  ordered categories and series with aligned values.
- `renderTrendChart(input)` supports up to five series; `renderBarChart(input)`
  supports one series in v1. Grouped/stacked bars are deliberately out of scope.
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

Trend nodes are filled circles (3px rest, 6px hover/focus). Series use a fixed
semantic-token palette, including a dashed fifth series. Bars show values;
incomplete periods have a muted fill, dashed stroke and asterisk.

Legend buttons hide/show series and rescale the visible range. Hiding every
series produces a recoverable empty state. Zoom buttons select the last N
categories, down to three (or fewer if that is all the data); no data is
interpolated or discarded. `initialWindow` optionally chooses the starting N.
Each chart keeps its own local interaction state.

Both axes are present; long category sets use deterministic tick thinning.
Mobile retains controls and horizontally scrolls only the plot. Light/dark
themes and reduced motion use the shared design tokens.

Arrow Left/Right move between points, Home/End to the ends; Up/Down switch
series at the nearest period. Focus scrolls into view and exposes the exact
value. Escape dismisses the tooltip. There is one tab entry for the plot.
The expandable semantic table always exposes all exact values, including
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

There is no production BarChart placement yet. A future Weekly Review or
Portfolio add-on must first define its source, aggregation and snapshot rules.
