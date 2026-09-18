export const STOCKS_STYLES=`
.stock-row__identity,.stock-discovery-card__identity { display:flex; align-items:center; gap:12px; min-width:0; }
.stock-row__identity>span:last-child,.stock-discovery-card__identity>div { min-width:0; }
.stock-discovery-card__identity>div>span { font-size:.75rem; color:var(--muted); }
.stocks-discovery { margin-top:40px; border-top:1px solid var(--line); padding-top:28px; }
.stocks-discovery h2 { margin:0; font-size:clamp(1.5rem,2.5vw,2rem); font-weight:600; }
.stocks-discovery>header>p:not(.hero__eyebrow) { color:var(--muted); font-size:.875rem; line-height:1.6; }
.stocks-discovery__grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr)); gap:20px; margin-top:24px; }
.stock-discovery-card { display:flex; flex-direction:column; align-items:start; gap:16px; padding:24px; border:1px solid var(--line); border-radius:3px; background:var(--panel); min-width:0; }
.stock-discovery-card h3 { margin:8px 0 0; font-size:1.125rem; line-height:1.35; font-weight:600; overflow-wrap:anywhere; }
.stock-discovery-card header>span,.stock-discovery-card small { font-size:.75rem; color:var(--muted); }
.stock-discovery-card__price { display:flex; align-items:baseline; flex-wrap:wrap; gap:8px 16px; }
.stock-discovery-card__price>strong { font-size:1.5rem; font-weight:600; }
.stock-discovery-card__price>small { flex-basis:100%; }
.stock-discovery-card p { margin:0; font-size:.875rem; line-height:1.6; }
.stock-discovery-card__trend { width:100%; }
.stock-discovery-card dl { display:flex; flex-wrap:wrap; gap:24px; margin:0; }
.stock-discovery-card dt { color:var(--muted); font-size:.75rem; }
.stock-discovery-card dd { margin:6px 0 0; font-size:1rem; }
.stock-discovery-card>a { display:inline-flex; min-height:44px; align-items:center; margin-top:auto; color:var(--ink); font-size:.875rem; text-underline-offset:4px; }
.stocks-discovery__method { margin-top:20px; color:var(--muted); font-size:.8125rem; line-height:1.6; }
.stocks-discovery__method summary { cursor:pointer; min-height:44px; align-content:center; color:var(--ink); }
.stocks-hero { min-height:0; padding:40px 0 24px; grid-template-columns:1fr; }
.stocks-status { display:flex; flex-wrap:wrap; gap:8px 24px; margin:0 0 28px; color:var(--muted); font-size:.8125rem; }
.stocks-notice { padding:16px 20px; margin-bottom:24px; background:var(--panel); border-left:3px solid var(--warning); line-height:1.6; }
.stocks-watchlist { border:1px solid var(--line); background:var(--section); box-shadow:4px 4px 0 var(--section-shadow); padding:24px; border-radius:3px; }
.stocks-section-heading,.stocks-teaser header { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:20px; }
.stocks-section-heading h2,.stocks-teaser h2,.stocks-observations h2 { margin:0; font-size:clamp(1.5rem,2.5vw,2rem); font-weight:600; }
.stocks-section-heading p { margin:8px 0 0; color:var(--muted); font-size:.8125rem; }
.stocks-sort { display:grid; gap:6px; font-size:.75rem; color:var(--muted); }
.stocks-sort select { min-height:44px; max-width:100%; padding:8px 30px 8px 12px; border:1px solid var(--line); border-radius:3px; color:var(--ink); background:var(--surface); font:600 .8125rem var(--font-sans); }
.stocks-sort select:focus-visible,.stock-row__summary:focus-visible { outline:2px solid var(--signal); outline-offset:3px; }
.stock-row { border-top:1px solid var(--line); background:var(--surface); scroll-margin-top:calc(var(--header-offset,90px) + 16px); }
.stock-row:last-child { border-bottom:1px solid var(--line); }
.stock-row__summary { display:grid; grid-template-columns:minmax(140px,1fr) 140px minmax(100px,.45fr) 100px 28px; gap:24px; align-items:center; padding:20px 16px; cursor:pointer; list-style:none; min-height:88px; }
.stock-row__summary::-webkit-details-marker { display:none; }
.stock-row__summary:hover,.stock-row[open]>.stock-row__summary { background:var(--panel); }
.stock-row__summary strong { display:block; font-size:1rem; font-weight:600; line-height:1.4; overflow-wrap:anywhere; }
.stock-row__summary small { display:block; color:var(--muted); font-size:.75rem; line-height:1.5; margin-top:4px; }
.stock-row__quote,.stock-row__change { text-align:right; font-variant-numeric:tabular-nums; }
.stock-row__change { font-weight:600; font-size:1rem; }
.stock-row__chevron { text-align:center; font-size:24px; transition:transform 120ms; }
.stock-row[open] .stock-row__chevron { transform:rotate(180deg); }
.stock-row__trend { display:block; color:var(--ink); }
.stock-details { padding:20px; border-top:1px solid var(--line); background:var(--panel); min-width:0; }
.stock-details[aria-busy=true] { opacity:.65; }
.stock-details .chart { margin:20px 0; }
.stock-details__toolbar { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:16px; }
.stocks-periods { display:flex; flex-wrap:wrap; gap:8px; }
.stock-period-change { display:grid; gap:4px; text-align:right; font-size:1.25rem; }
.stock-period-change>span:first-child { font-size:.75rem; color:var(--muted); }
.stock-stats { display:flex; flex-wrap:wrap; gap:24px 40px; padding:16px 0; margin:0; }
.stock-stats dt { font-size:.75rem; color:var(--muted); margin-bottom:6px; }
.stock-stats dd { margin:0; font-size:1rem; }
.stock-details__footer { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px 24px; }
.stock-details__footer p { max-width:75ch; color:var(--muted); font-size:.75rem; line-height:1.6; margin:0; }
.stock-details__footer a { display:inline-flex; align-items:center; min-height:44px; font-size:.8125rem; color:var(--ink); text-underline-offset:3px; }
.stock-load-status { margin:0; padding:0 20px; color:var(--muted); font-size:.875rem; }
.stock-load-status:not(:empty) { padding:16px 20px; }
.stock-change { white-space:nowrap; font-variant-numeric:tabular-nums; }
.stock-change.is-up { color:var(--positive); }
.stock-change.is-down { color:var(--signal); }
.stocks-warning { color:var(--warning); }
.stocks-footnote { margin:16px 0 0; color:var(--muted); font-size:.75rem; line-height:1.6; }
.stocks-observations { padding:0 0 28px; }
.stocks-observations ul { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr)); gap:16px; list-style:none; padding:16px 0 0; margin:0; }
.stocks-observations li { border-left:2px solid var(--line); padding:0 16px; }
.stocks-observations a { color:var(--ink); display:block; min-height:44px; line-height:1.5; font-size:.875rem; text-decoration:none; }
.stocks-observations a:hover { text-decoration:underline; }
.stocks-observations strong { display:block; font-size:1rem; }
.stocks-observations small { color:var(--muted); font-size:.75rem; }
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

@media(max-width:760px) {
  .stocks-watchlist { padding:20px 12px; }
  .stocks-section-heading,.stocks-teaser header { align-items:start; flex-direction:column; gap:16px; }
  .stock-row__summary { grid-template-columns:minmax(0,1fr) auto 24px; gap:12px; padding:16px 12px; }
  .stock-row__identity { grid-column:1; grid-row:1; }
  .stock-row__quote { grid-column:2; grid-row:1; }
  .stock-row__chevron { grid-column:3; grid-row:1/3; }
  .stock-row__trend { grid-column:1; grid-row:2; }
  .stock-row__change { grid-column:2; grid-row:2; }
  .stock-row__summary strong { font-size:.9375rem; }
  .stock-details { padding:16px 10px; }
  .stock-details__toolbar { align-items:start; flex-direction:column; }
  .stock-period-change { text-align:left; }
  .stocks-teaser { padding:20px; }
  .stocks-teaser__body { grid-template-columns:1fr; gap:16px; }
  .stocks-benchmark { grid-template-columns:1fr auto; align-items:center; }
  .stocks-benchmark>span,.stocks-benchmark>small { grid-column:1/-1; }
}
@media(prefers-reduced-motion:reduce) { .stock-row__chevron { transition:none; } }
`;
