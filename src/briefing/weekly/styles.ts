export const WEEKLY_STYLES=`
.weekly-caveat { margin-bottom:24px; padding:16px 20px; border-left:3px solid var(--warning); background:var(--panel); color:var(--muted); line-height:1.6; }
.weekly-observations { padding:32px 0; border-bottom:1px solid var(--line); }
.weekly-observations h2,.weekly-topics h2,.weekly-teaser h2 { margin:8px 0 16px; font-size:clamp(1.5rem,2.5vw,2.25rem); font-weight:600; }
.weekly-observations ol { padding-left:24px; max-width:85ch; }
.weekly-observations li { padding:8px 0 8px 8px; line-height:1.65; }
.weekly-charts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:24px; margin:24px 0; }
.weekly-charts .chart { min-width:0; margin:0; }
.weekly-topics { padding:28px; background:var(--section); border:1px solid var(--line); box-shadow:4px 4px 0 var(--section-shadow); }
.weekly-table-scroll { overflow-x:auto; }
.weekly-topics p,.weekly-method p,.weekly-teaser p { color:var(--muted); line-height:1.6; }
.weekly-topics table { width:100%; border-collapse:collapse; }
.weekly-topics th,.weekly-topics td { padding:14px 12px; border-bottom:1px solid var(--line); text-align:right; }
.weekly-topics th:first-child { text-align:left; }
.weekly-method { margin:28px 0; }
.weekly-method summary { min-height:44px; align-content:center; cursor:pointer; font-weight:600; }
.weekly-teaser { display:flex; justify-content:space-between; gap:24px; align-items:center; padding:28px; margin:32px 0; border:1px solid var(--line); background:var(--panel); }
.weekly-teaser .button { flex-shrink:0; }
@media(max-width:1000px) { .weekly-charts {grid-template-columns:1fr;} }
@media(max-width:640px) { .weekly-teaser {display:block;padding:20px;} .weekly-topics {padding:20px;} }
`;
