export const STOCKS_STYLES=`
.stocks-hero { min-height:0; padding:44px 0 28px; grid-template-columns:1fr; }
.stocks-status { display:flex; flex-wrap:wrap; gap:8px 24px; margin:0 0 24px; color:var(--muted); font-size:.75rem; }
.stocks-notice { padding:16px 20px; margin-bottom:24px; background:var(--panel); border-left:3px solid var(--warning); line-height:1.6; }
.stocks-watchlist { border:1px solid var(--line); background:var(--section); box-shadow:4px 4px 0 var(--section-shadow); padding:24px; border-radius:3px; }
.stocks-section-heading,.stocks-teaser header { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:18px; }
.stocks-section-heading h2,.stocks-teaser h2 { margin:0; font-size:clamp(1.5rem,2.5vw,2rem); font-weight:600; }
.stocks-section-heading>span { color:var(--muted); font-size:.75rem; }
.stocks-table-scroll { overflow-x:auto; }
.stocks-table { width:100%; border-collapse:collapse; font-size:.875rem; }
.stocks-table th,.stocks-table td { padding:14px 12px; border-bottom:1px solid var(--line); text-align:right; }
.stocks-table th:nth-child(2) { text-align:left; min-width:190px; }
.stocks-table th { font-weight:600; }
.stocks-table thead { color:var(--muted); font-size:.6875rem; }
.stocks-table small,.stock-name { display:block; margin-top:4px; color:var(--muted); font-size:.6875rem; line-height:1.4; font-weight:400; }
.stocks-table tbody tr { background:var(--surface); }
.stocks-table tbody tr.is-selected { background:var(--panel); }
.stocks-table .stocks-select { width:44px; padding:0 6px; }
.stocks-select [data-selection-control] { min-width:44px; min-height:44px; justify-content:center; }
.stocks-select .selection-control__input { left:10px; }
.stock-symbol { display:inline-flex; min-height:44px; align-items:center; font-size:.9375rem; font-weight:600; color:var(--ink); text-underline-offset:4px; }
.stock-change { white-space:nowrap; font-variant-numeric:tabular-nums; }
.stock-change.is-up { color:var(--positive); }
.stock-change.is-down { color:var(--signal); }
.stocks-warning { display:block; color:var(--warning); font-size:.6875rem; line-height:1.5; }
.stocks-compare-actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; margin-top:18px; font-size:.75rem; color:var(--muted); }
.stocks-chart-section { padding:36px 0; scroll-margin-top:var(--header-offset); }
.stocks-periods { display:flex; flex-wrap:wrap; gap:8px; }
.stocks-footnote { margin:12px 0 0; color:var(--muted); font-size:.6875rem; line-height:1.6; }
.stocks-teaser { margin-top:36px; padding:24px; border:1px solid var(--line); background:var(--panel); border-radius:3px; }
.stocks-teaser__body { display:grid; grid-template-columns:minmax(180px,1fr) 2fr; gap:28px; }
.stocks-benchmark { display:grid; align-content:start; gap:6px; }
.stocks-benchmark>span,.stocks-benchmark>small { color:var(--muted); font-size:.6875rem; }
.stocks-benchmark>strong { font-size:1.875rem; font-weight:600; }
.stocks-benchmark .stock-change { font-size:1.125rem; }
.stocks-movers ul { list-style:none; margin:0; padding:0; }
.stocks-movers li { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:10px 0; border-bottom:1px solid var(--line); font-size:.875rem; }
.stocks-movers li:last-child { border-bottom:0; }
.stocks-movers a { display:inline-block; min-height:44px; align-content:center; color:var(--ink); font-weight:600; text-decoration:none; }
.stocks-movers a:hover { text-decoration:underline; }
.stocks-movers a span { display:block; font-size:.6875rem; color:var(--muted); font-weight:400; }
.stocks-movers p { color:var(--muted); font-size:.8125rem; line-height:1.6; }
@media(max-width:620px) {
  .stocks-watchlist { padding:16px 10px; }
  .stocks-table th,.stocks-table td { padding:12px 8px; }
  .stocks-section-heading,.stocks-teaser header { align-items:start; flex-direction:column; gap:12px; }
  .stocks-teaser { padding:20px; }
  .stocks-teaser__body { grid-template-columns:1fr; gap:16px; }
  .stocks-benchmark { grid-template-columns:1fr auto; align-items:center; }
  .stocks-benchmark>span,.stocks-benchmark>small { grid-column:1/-1; }
}
`;
