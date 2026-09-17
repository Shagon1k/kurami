export const CHART_STYLES = `
.chart { position: relative; margin: 16px 0; padding: 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 2px; }
.chart__header { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.chart h3 { margin: 4px 0 0; font-size: 1rem; font-weight: 600; line-height: 1.25; }
.chart__subtitle { margin: 0; color: var(--muted); font-size: .6875rem; }
.chart__legend { max-width: 65%; display: flex; flex-wrap: wrap; justify-content: end; gap: 4px 8px; }
.chart__key { --chart-color: var(--ink); display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 5px 8px; font: 500 .6875rem/1.3 var(--font-sans); text-align: left; }
.chart__key::before { content: ""; flex: 0 0 16px; height: 3px; background: var(--chart-color); }
.chart__key[aria-pressed="false"] { opacity: .6; text-decoration: line-through; }
.chart__series--0, .chart__key--0 { --chart-color: var(--ink); }
.chart__series--1, .chart__key--1 { --chart-color: var(--signal); }
.chart__series--2, .chart__key--2 { --chart-color: var(--positive); }
.chart__series--3, .chart__key--3 { --chart-color: var(--warning); }
.chart__series--4, .chart__key--4 { --chart-color: var(--muted); }
.chart__series--4 polyline { stroke-dasharray: 6 4; }
.chart__key--4::before { background: repeating-linear-gradient(to right,var(--chart-color) 0 5px,transparent 5px 8px); }
.chart__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; color: var(--muted); font-size: .6875rem; }
.chart__zoom { display: inline-flex; align-items: center; gap: 4px; }
.chart__zoom .button { width: 44px; min-height: 44px; padding: 0; }
.chart__zoom output { min-width: 48px; text-align: center; }
.chart__plot { overflow-x: auto; }
.chart svg { display: block; width: 100%; min-width: 590px; height: auto; margin-top: 8px; }
.chart__grid line { stroke: var(--grid); stroke-width: 1; }
.chart__series polyline { fill: none; stroke: var(--chart-color); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.chart__plot:has(.chart__point:hover) .chart__series:not(:has(.chart__point:hover)),
.chart__plot:has(.chart__point:focus) .chart__series:not(:has(.chart__point:focus)) { opacity: .3; }
.chart__series circle { fill: var(--chart-color); stroke: var(--surface); stroke-width: 1.25; transition: r 140ms ease; }
.chart__point:focus { outline: none; }
.chart__point { scroll-margin: 84px 8px 20px; }
.chart__point:hover circle, .chart__point:focus circle { r: 6; stroke: var(--ink); stroke-width: 2; }
.chart__series rect { fill: var(--chart-color); stroke: var(--surface); stroke-width: 1; }
.chart__point:hover rect, .chart__point:focus rect { stroke: var(--signal); stroke-width: 2; }
.chart__point--partial rect, .chart__point--partial circle { fill: color-mix(in srgb,var(--chart-color) 45%,var(--surface)); stroke: var(--chart-color); stroke-width: 2; stroke-dasharray: 3 2; }
.chart__labels text { fill: var(--muted); font: 400 11px/1 var(--font-sans); }
.chart__bar-value { fill: var(--ink); font: 600 11px/1 var(--font-sans); pointer-events: none; }
.chart__tooltip { position: absolute; z-index: 5; max-width: min(320px,calc(100% - 16px)); padding: 8px 12px; border: 1px solid var(--line); background: var(--ink); color: var(--paper); border-radius: 3px; font-size: .75rem; pointer-events: none; overflow-wrap: anywhere; }
.chart__status, .chart__footnote { margin: 8px 0 0; color: var(--muted); font-size: .6875rem; }
.chart__status:empty { margin: 0; }
.chart__empty { margin: 16px 0; color: var(--muted); font-size: .8125rem; }
.chart__table { margin-top: 8px; font-size: .75rem; }
.chart__table summary { min-height: 44px; align-content: center; cursor: pointer; font-weight: 600; }
.chart__table summary:focus-visible { outline: 2px solid var(--signal); outline-offset: 3px; }
.chart__table > div { overflow-x: auto; }
.chart__table table { width: 100%; border-collapse: collapse; font-size: .75rem; }
.chart__table caption { text-align: left; padding: 8px 0; }
.chart__table th, .chart__table td { padding: 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
.chart__table th:first-child { text-align: left; }
@media (max-width: 700px) {
  .chart { padding: 14px 8px; }
  .chart__header { flex-direction: column; padding-inline: 6px; }
  .chart__legend { max-width: none; justify-content: start; }
  .chart__toolbar { padding-inline: 6px; flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) { .chart__series circle { transition: none; } }
`;
