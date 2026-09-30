import {THEME_CSS} from "../ui-library/themes/index.ts";
import {FOUNDATION_CSS} from "../ui-library/foundations/index.ts";
import {BUTTON_CSS} from "../ui-library/components/button.ts";
import {THEME_SWITCH_CSS} from "../ui-library/components/theme-switch.ts";
import {SITE_HEADER_CSS} from "../ui-library/patterns/site-header.ts";
import {TABLE_CSS} from "../ui-library/components/table.ts";
import {DISCLOSURE_CSS} from "../ui-library/components/disclosure.ts";
import {FORM_CSS} from "../ui-library/components/form.ts";
import {DIALOG_CSS} from "../ui-library/components/dialog.ts";
import {PERIOD_SWITCH_CSS} from "../ui-library/components/period-switch.ts";

export const HUB_STYLES=`${THEME_CSS}${FOUNDATION_CSS}${BUTTON_CSS}${THEME_SWITCH_CSS}${SITE_HEADER_CSS}${TABLE_CSS}${DISCLOSURE_CSS}${FORM_CSS}${DIALOG_CSS}${PERIOD_SWITCH_CSS}
:root { --container-max: 1320px; }
body { min-height: 100vh; }
.hub { padding-block: var(--space-6) var(--space-10); }
.hub__topline { display: flex; align-items: baseline; justify-content: flex-end; gap: var(--space-4); margin-bottom: var(--space-4); }
.hub__topline h1 { margin: 0; font-size: clamp(1.9rem,3vw,2.6rem); line-height: 1.1; letter-spacing: -.05em; }
.hub__topline p { margin: 0; }
.hub__live { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--status-success); font: 500 .75rem/1.4 var(--font-mono); }
.hub__live::before { content: ""; inline-size: 7px; block-size: 7px; border-radius: var(--radius); background: currentColor; }
.hub[data-disconnected="true"] .hub__live { color: var(--status-warning); }
.metric-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: var(--space-3); }
.metric { min-width: 0; padding: var(--space-4); border: 1px solid var(--border-default); background: var(--surface-raised); }
.metric__label { min-height: 2.8em; margin: 0 0 var(--space-3); color: var(--text-muted); font: 500 .69rem/1.4 var(--font-mono); letter-spacing: .04em; text-transform: uppercase; }
.metric__value { display: block; margin: 0; font-size: clamp(1.7rem,3vw,2.5rem); line-height: 1; font-weight: 600; letter-spacing: -.05em; }
.period-metric,.period-metric > div,.period-metric .metric { height: 100%; }
[data-period-panel][hidden] { display: none !important; }
.metric--attention .metric__value { color: var(--text-accent); }
.section { margin-top: var(--space-8); }
.section-heading { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-4); }
.section-heading h2 { margin: 0; font-size: 1.35rem; line-height: 1.2; letter-spacing: -.035em; }
.section-heading span { color: var(--text-muted); font: .71rem/1.4 var(--font-mono); }
.codex-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); align-items: stretch; gap: var(--space-3); }
.hub-panel { min-width: 0; border: 1px solid var(--border-default); background: var(--surface-raised); padding: var(--space-4); }
.hub-panel h3 { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin: 0 0 var(--space-4); font-size: .83rem; font-weight: 600; }
.panel-status { color: var(--text-muted); font: .65rem/1.4 var(--font-mono); }
.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-4); }
.panel-heading h3 { margin: 0; }
.heading-actions { display: flex; align-items: center; gap: var(--space-3); }
.usage-block { margin-top: var(--space-3); }
.usage-heading { display: flex; justify-content: flex-end; }
.usage-coverage { display: flex; justify-content: flex-end; margin-block: var(--space-2) var(--space-3); color: var(--text-muted); font: .7rem/1.4 var(--font-mono); }
.usage-metrics { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-3); margin-bottom: var(--space-4); }
.usage-table { --table-cell-padding: 10px 8px; }
.token-totals { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--space-3); margin-block: var(--space-5); }
.token-totals .metric { padding: 0; border: 0; }
.token-totals .metric__value { font-size: clamp(1.7rem,2.5vw,2.4rem); cursor: help; }
.token-breakdown { font-size: .75rem; }
.model-breakdown { font-size: .75rem; }
.api-equivalent { margin-bottom: var(--space-2); }
.api-rates { margin: var(--space-3) 0 0; color: var(--text-muted); font: .65rem/1.4 var(--font-mono); }
.model-detail-table { --table-cell-padding: 10px 8px; }
.stat-list { margin: 0; font: .8rem/1.5 var(--font-mono); }
.stat-list > div { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); padding-block: var(--space-2); }
.stat-list dt { color: var(--text-muted); }
.stat-list dd { margin: 0; text-align: end; }
.stat-list--wide { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-2) var(--space-5); }
.reset-control { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-top: var(--space-4); font-size: .72rem; color: var(--text-muted); }
.reset-control strong { color: var(--text-primary); }
.limit + .limit { margin-top: var(--space-5); }
.limit__head,.limit__meta { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
.limit__head { font-size: .82rem; }
.limit__head strong { font: 600 1rem/1.2 var(--font-sans); }
.limit__track { height: 8px; margin: var(--space-2) 0; background: var(--surface-panel); border: 1px solid var(--border-default); }
.limit__track span { display: block; width: var(--used); height: 100%; background: var(--chart-3); }
.limit__meta { color: var(--text-muted); font: .7rem/1.3 var(--font-mono); }
.empty-value { margin: 0; color: var(--text-muted); font: .8rem/1.5 var(--font-mono); }
.hub-alerts { padding: var(--space-4); margin-bottom: var(--space-4); border: 1px solid var(--status-warning); background: var(--surface-raised); }
.hub-alerts .section-heading { margin-bottom: var(--space-2); }
.hub-alerts h2 { font-size: .9rem; }
.alert-item { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); padding-block: var(--space-2); font-size: .8rem; }
.alert-item span { color: var(--text-muted); }
.alert-item strong,.alert-item a { overflow-wrap: anywhere; text-align: end; font-weight: 500; }
.alert-item[data-severity="critical"] { border-inline-start: 2px solid var(--status-failure); padding-inline-start: var(--space-3); }
.health-cell { min-width: 0; padding: var(--space-4); border: 1px solid var(--border-default); background: var(--surface-raised); }
.health-cell .metric { padding: 0; border: 0; }
.health-detail { margin: var(--space-3) 0 0; color: var(--text-muted); font: .7rem/1.5 var(--font-mono); }
.orchestrator-state { margin-top: var(--space-3); }
.activity-list li { display: grid; grid-template-columns: 125px 90px minmax(110px,1fr) minmax(0,2fr); gap: var(--space-3); padding-block: var(--space-3); border-top: 1px solid var(--border-default); font-size: .8rem; }
.activity-list time,.activity-source { color: var(--text-muted); font: .7rem/1.5 var(--font-mono); }
.activity-subject { overflow-wrap: anywhere; }
.controls { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3); padding-top: var(--space-4); border-top: 1px solid var(--border-default); }
.controls > span { color: var(--text-muted); font: .75rem/1.4 var(--font-mono); }
.control-buttons { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.control-form { display: grid; gap: var(--space-4); }
.control-fields { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--space-4); }
.control-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
.control-summary { font-size: .85rem; overflow-wrap: anywhere; white-space: pre-line; }
.control-form + .control-form { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--border-default); }
#hub-control-result { margin-bottom: 0; font-size: .8rem; overflow-wrap: anywhere; }
.model-table { --table-cell-padding: 10px 5px; }
.model-table table { font-family: var(--font-mono); }
.model-table th[scope="row"] { overflow-wrap: anywhere; }
.project-table { --table-cell-padding: 13px 10px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.project-table table { min-width: 680px; }
.project-table th[scope="row"] a { color: var(--text-primary); text-decoration: none; }
.project-table th[scope="row"] a:hover { color: var(--text-accent); text-decoration: underline; }
.project-table td:last-child { color: var(--text-muted); font-size: .75rem; white-space: nowrap; }
.trend { padding: var(--space-4); border: 1px solid var(--border-default); background: var(--surface-raised); }
.trend__chart { display: grid; grid-template-columns: repeat(var(--trend-columns,30),minmax(0,1fr)); align-items: end; gap: var(--space-2); min-height: 180px; margin: var(--space-3) 0 var(--space-5); padding: 0; list-style: none; border-bottom: 1px solid var(--border-default); }
.trend__chart[style="--trend-columns:30"] { gap: var(--space-1); }
.trend__chart[style="--trend-columns:30"] .trend__date { display: none; }
.trend__chart[style="--trend-columns:30"] li:is(:first-child,:nth-child(7n),:last-child) .trend__date { display: block; }
.trend__chart li { position: relative; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; min-width: 0; height: 170px; }
.trend__bar { display: block; width: min(100%,56px); height: var(--bar-height); min-height: 2px; background: var(--chart-3); }
.trend__chart li:last-child .trend__bar { background: var(--accent-primary); }
.trend__count { margin-bottom: 4px; font: 500 .7rem/1.2 var(--font-mono); }
.trend__date { position: absolute; top: calc(100% + 8px); left: 50%; transform: translateX(-50%); color: var(--text-muted); font: .63rem/1.2 var(--font-mono); white-space: nowrap; }
.trend__chart li:not(:first-child):not(:nth-child(3n)):not(:last-child) .trend__date { display: none; }
.hub-footer { padding-block: var(--space-6); border-top: 1px solid var(--border-default); color: var(--text-muted); font: .7rem/1.4 var(--font-mono); }
@media(max-width:1050px) { .codex-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.models { grid-column: 1/-1; }.stat-list--wide { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media(max-width:750px) { .metric-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.hub { padding-top: var(--space-4); }.activity-list li { grid-template-columns: 1fr 1fr; gap: var(--space-2); } }
@media(max-width:520px) { .section { margin-top: var(--space-6); }.section-heading { align-items: flex-start; flex-direction: column; }.metric,.hub-panel,.health-cell { padding: var(--space-3); }.metric__value { font-size: 1.8rem; }.codex-grid { grid-template-columns: 1fr; }.models { grid-column: auto; }.control-fields,.stat-list--wide { grid-template-columns: 1fr; }.alert-item { align-items: flex-start; flex-direction: column; gap: var(--space-1); }.alert-item strong,.alert-item a { text-align: start; }.trend__chart { gap: 3px; }.trend__count { font-size: .58rem; }.trend__date { font-size: .55rem; } }
@media(max-width:520px) { .section-heading--period { flex-direction: row; align-items: center; }.heading-actions > span { display: none; }.usage-metrics { grid-template-columns: 1fr; }.trend__chart[style="--trend-columns:30"] .trend__count { display: none; } }
`;
