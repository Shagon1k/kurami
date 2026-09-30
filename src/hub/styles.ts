import {THEME_CSS} from "../ui-library/themes/index.ts";
import {FOUNDATION_CSS} from "../ui-library/foundations/index.ts";
import {BUTTON_CSS} from "../ui-library/components/button.ts";
import {THEME_SWITCH_CSS} from "../ui-library/components/theme-switch.ts";
import {SITE_HEADER_CSS} from "../ui-library/patterns/site-header.ts";
import {TABLE_CSS} from "../ui-library/components/table.ts";

export const HUB_STYLES=`${THEME_CSS}${FOUNDATION_CSS}${BUTTON_CSS}${THEME_SWITCH_CSS}${SITE_HEADER_CSS}${TABLE_CSS}
:root { --container-max: 1320px; }
body { min-height: 100vh; }
.hub { padding-block: var(--space-6) var(--space-10); }
.hub__topline { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-5); }
.hub__topline h1 { margin: 0; font-size: clamp(1.9rem,3vw,2.6rem); line-height: 1.1; letter-spacing: -.05em; }
.hub__topline p { margin: 0; }
.hub__live { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--status-success); font: 500 .75rem/1.4 var(--font-mono); }
.hub__live::before { content: ""; inline-size: 7px; block-size: 7px; border-radius: var(--radius); background: currentColor; }
.hub[data-disconnected="true"] .hub__live { color: var(--status-warning); }
.metric-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: var(--space-3); }
.metric { min-width: 0; padding: var(--space-4); border: 1px solid var(--border-default); background: var(--surface-raised); }
.metric__label { margin: 0 0 var(--space-3); color: var(--text-muted); font: 500 .69rem/1.4 var(--font-mono); letter-spacing: .04em; text-transform: uppercase; }
.metric__value { display: block; margin: 0; font-size: clamp(1.7rem,3vw,2.5rem); line-height: 1; font-weight: 600; letter-spacing: -.05em; }
.metric--attention .metric__value { color: var(--text-accent); }
.section { margin-top: var(--space-8); }
.section-heading { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-4); }
.section-heading h2 { margin: 0; font-size: 1.35rem; line-height: 1.2; letter-spacing: -.035em; }
.section-heading span { color: var(--text-muted); font: .71rem/1.4 var(--font-mono); }
.codex-grid { display: grid; grid-template-columns: minmax(0,2fr) minmax(230px,1fr); gap: var(--space-3); }
.codex-main { min-width: 0; }
.codex-metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: var(--space-3); }
.codex-metrics .metric__value { font-size: clamp(1.35rem,2.4vw,2rem); }
.limits,.models { border: 1px solid var(--border-default); background: var(--surface-raised); padding: var(--space-4); }
.limits { margin-top: var(--space-3); }
.limits h3,.models h3 { margin: 0 0 var(--space-4); font-size: .83rem; font-weight: 600; }
.limit + .limit { margin-top: var(--space-5); }
.limit__head,.limit__meta { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
.limit__head { font-size: .82rem; }
.limit__head strong { font: 600 1rem/1.2 var(--font-sans); }
.limit__track { height: 8px; margin: var(--space-2) 0; background: var(--surface-panel); border: 1px solid var(--border-default); }
.limit__track span { display: block; width: var(--used); height: 100%; background: var(--chart-3); }
.limit__meta { color: var(--text-muted); font: .7rem/1.3 var(--font-mono); }
.empty-value { margin: 0; color: var(--text-muted); font: .8rem/1.5 var(--font-mono); }
.model-table { --table-cell-padding: 10px 5px; }
.model-table table { font-family: var(--font-mono); }
.model-table th[scope="row"] { overflow-wrap: anywhere; }
.project-table { --table-cell-padding: 13px 10px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.project-table table { min-width: 780px; }
.project-table th[scope="row"] a { color: var(--text-primary); text-decoration: none; }
.project-table th[scope="row"] a:hover { color: var(--text-accent); text-decoration: underline; }
.project-table td:last-child { color: var(--text-muted); font-size: .75rem; white-space: nowrap; }
.trend { padding: var(--space-4); border: 1px solid var(--border-default); background: var(--surface-raised); }
.trend__chart { display: grid; grid-template-columns: repeat(12,minmax(0,1fr)); align-items: end; gap: var(--space-2); min-height: 180px; margin: var(--space-3) 0 var(--space-5); padding: 0; list-style: none; border-bottom: 1px solid var(--border-default); }
.trend__chart li { position: relative; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; min-width: 0; height: 170px; }
.trend__bar { display: block; width: min(100%,56px); height: var(--bar-height); min-height: 2px; background: var(--chart-3); }
.trend__chart li:last-child .trend__bar { background: var(--accent-primary); }
.trend__count { margin-bottom: 4px; font: 500 .7rem/1.2 var(--font-mono); }
.trend__date { position: absolute; top: calc(100% + 8px); left: 50%; transform: translateX(-50%); color: var(--text-muted); font: .63rem/1.2 var(--font-mono); white-space: nowrap; }
.trend__chart li:not(:first-child):not(:nth-child(3n)):not(:last-child) .trend__date { display: none; }
.hub-footer { padding-block: var(--space-6); border-top: 1px solid var(--border-default); color: var(--text-muted); font: .7rem/1.4 var(--font-mono); }
@media(max-width:1050px) { .codex-grid { grid-template-columns: 1fr; }.models { min-height: 0; } }
@media(max-width:750px) { .metric-grid,.codex-metrics { grid-template-columns: repeat(2,minmax(0,1fr)); }.hub { padding-top: var(--space-4); } }
@media(max-width:520px) { .section { margin-top: var(--space-6); }.section-heading { align-items: flex-start; flex-direction: column; }.metric,.limits,.models { padding: var(--space-3); }.metric__value { font-size: 1.8rem; }.codex-metrics .metric__value { font-size: 1.4rem; }.trend__chart { gap: 3px; }.trend__count { font-size: .58rem; }.trend__date { font-size: .55rem; } }
`;
