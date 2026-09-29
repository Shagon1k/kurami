export const CHART_STYLES = `
.sparkline { width:140px; max-width:100%; height:44px; display:block; }
.sparkline-empty { display:block; font-size:.75rem; color:var(--text-muted); }
.chart { position: relative; margin: 16px 0; padding: 20px; background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm); }
.chart__header { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.chart h3 { margin: 4px 0 0; font-size: 1rem; font-weight: 600; line-height: 1.25; }
.chart__subtitle { margin: 0; color: var(--text-muted); font-size: .6875rem; }
.chart__legend { max-width: 65%; display: flex; flex-wrap: wrap; justify-content: end; gap: 4px 8px; }
.chart__key { --chart-color: var(--text-primary); display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 5px 8px; font: 500 .6875rem/1.3 var(--font-sans); text-align: left; }
.chart__key::before { content: ""; flex: 0 0 16px; height: 3px; background: var(--chart-color); }
.chart__key[aria-pressed="false"] { opacity: .6; text-decoration: line-through; }
.chart__series--0, .chart__key--0 { --chart-color: var(--chart-1); }
.chart__series--1, .chart__key--1 { --chart-color: var(--chart-2); }
.chart__series--2, .chart__key--2 { --chart-color: var(--chart-3); }
.chart__series--3, .chart__key--3 { --chart-color: var(--chart-4); }
.chart__series--4, .chart__key--4 { --chart-color: var(--chart-5); }
.chart__series--4 polyline { stroke-dasharray: 6 4; }
.chart__key--4::before { background: repeating-linear-gradient(to right,var(--chart-color) 0 5px,transparent 5px 8px); }
.chart__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; color: var(--text-muted); font-size: .6875rem; }
.chart__zoom { display: inline-flex; align-items: center; gap: 4px; }
.chart__zoom .button { width: 44px; min-height: 44px; padding: 0; }
.chart__zoom output { min-width: 48px; text-align: center; }
.chart__plot { overflow-x: auto; }
.chart svg { display: block; width: 100%; min-width: 590px; height: auto; margin-top: 8px; }
.chart__grid line { stroke: var(--border-subtle); stroke-width: 1; }
.chart__series polyline { fill: none; stroke: var(--chart-color); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.chart__plot:has(.chart__point:hover) .chart__series:not(:has(.chart__point:hover)),
.chart__plot:has(.chart__point:focus) .chart__series:not(:has(.chart__point:focus)) { opacity: .3; }
.chart__series circle { fill: var(--chart-color); stroke: var(--surface-raised); stroke-width: 1.25; transition: r 140ms ease; }
.chart__point:focus { outline: none; }
.chart__point { scroll-margin: 84px 8px 20px; }
.chart__point:hover circle, .chart__point:focus circle { r: 6; stroke: var(--text-primary); stroke-width: 2; }
.chart__series rect { fill: var(--chart-color); stroke: var(--surface-raised); stroke-width: 1; }
.chart__point:hover rect, .chart__point:focus rect { stroke: var(--accent-primary); stroke-width: 2; }
.chart__point--partial rect, .chart__point--partial circle { fill: color-mix(in srgb,var(--chart-color) 45%,var(--surface-raised)); stroke: var(--chart-color); stroke-width: 2; stroke-dasharray: 3 2; }
.chart__labels text { fill: var(--text-muted); font: 400 11px/1 var(--font-sans); }
.chart__bar-value { fill: var(--text-primary); font: 600 11px/1 var(--font-sans); pointer-events: none; }
.chart__tooltip { position: absolute; z-index: 5; max-width: min(320px,calc(100% - 16px)); padding: 8px 12px; border: 1px solid var(--border-default); background: var(--text-primary); color: var(--surface-page); border-radius: var(--radius); font-size: .75rem; pointer-events: none; overflow-wrap: anywhere; }
.chart__status, .chart__footnote { margin: 8px 0 0; color: var(--text-muted); font-size: .6875rem; }
.chart__status:empty { margin: 0; }
.chart__empty { margin: 16px 0; color: var(--text-muted); font-size: .8125rem; }
.chart__table { margin-top: 8px; font-size: .75rem; --table-font-size: .75rem; --table-cell-padding: 8px; }
.chart__table caption { margin: 0; padding: 8px 0; color: inherit; font-weight: 400; }
@media (max-width: 700px) {
  .chart { padding: 14px 8px; }
  .chart__header { flex-direction: column; padding-inline: 6px; }
  .chart__legend { max-width: none; justify-content: start; }
  .chart__toolbar { padding-inline: 6px; flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) { .chart__series circle { transition: none; } }
`;
