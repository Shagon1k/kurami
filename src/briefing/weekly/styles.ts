export const WEEKLY_STYLES=`
.weekly-caveat { margin-bottom:24px; padding:16px 20px; border-left:3px solid var(--status-warning); background:var(--surface-panel); color:var(--text-muted); line-height:1.6; }
.weekly-observations { padding:32px 0; border-bottom:1px solid var(--border-default); }
.weekly-observations h2,.weekly-topics h2,.weekly-teaser h2 { margin:8px 0 16px; font-size:clamp(1.5rem,2.5vw,2.25rem); font-weight:600; }
.weekly-observations ol { padding-left:24px; max-width:85ch; }
.weekly-observations li { padding:8px 0 8px 8px; line-height:1.65; }
.weekly-charts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:24px; margin:24px 0; }
.weekly-charts .chart { min-width:0; margin:0; }
.weekly-topics { padding:28px; background:var(--surface-section); border:1px solid var(--border-default); box-shadow:var(--shadow-card); }
.weekly-topics p,.weekly-method p,.weekly-teaser p { color:var(--text-muted); line-height:1.6; }
.weekly-table { --table-font-size:inherit; --table-cell-padding:14px 12px; }
.weekly-table th,.weekly-table td { white-space:normal; }
.weekly-method { margin:28px 0; }
.weekly-teaser { display:flex; justify-content:space-between; gap:24px; align-items:center; padding:28px; margin:32px 0; border:1px solid var(--border-default); background:var(--surface-panel); }
.weekly-teaser .button { flex-shrink:0; }
@media(max-width:1000px) { .weekly-charts {grid-template-columns:1fr;} }
@media(max-width:640px) {
  .weekly-teaser {display:block;padding:20px;}
  .weekly-topics {padding:20px;}
  /* Weekly cards carry long labels and explanations; a two-column mobile grid
     turns them into a dense poster rather than an at-a-glance review. */
  .weekly-metrics .metric-strip {grid-template-columns:1fr;}
  .weekly-metrics .metric-card {min-height:0; padding:18px; border-right:0;}
  .weekly-metrics .metric-card + .metric-card {border-top:1px solid var(--border-default);}
  .weekly-metrics .metric-card__value {font-size:clamp(2rem,11vw,2.75rem);}
  .weekly-metrics .metric-card__context {font-size:.8125rem;}
}
`;
