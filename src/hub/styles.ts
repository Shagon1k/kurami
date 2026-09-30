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
import {ICON_CSS} from "../ui-library/components/icon.ts";
import {STAT_CARD_CSS} from "../ui-library/components/stat-card.ts";

export const HUB_STYLES=`${THEME_CSS}${FOUNDATION_CSS}${BUTTON_CSS}${THEME_SWITCH_CSS}${SITE_HEADER_CSS}${TABLE_CSS}${DISCLOSURE_CSS}${FORM_CSS}${DIALOG_CSS}${PERIOD_SWITCH_CSS}${ICON_CSS}${STAT_CARD_CSS}
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
.period-metric,.period-metric > div { height: 100%; }
[data-period-panel][hidden] { display: none !important; }
.section { margin-top: var(--space-8); }
.section-heading { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
.section-heading h2 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 1.25rem; line-height: 1.2; letter-spacing: -.025em; }
.section-heading > span,.heading-actions > span { color: var(--text-muted); font-size: .75rem; }
.codex-grid { display: grid; grid-template-columns: 1fr 1.1fr 1.3fr; align-items: stretch; gap: var(--space-3); }
.hub-panel { min-width: 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-raised); padding: var(--space-4); }
.hub-panel h3 { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin: 0 0 var(--space-4); font-size: .9rem; font-weight: 600; }
.panel-heading h3 { margin: 0; justify-content: flex-start; }
.panel-status { color: var(--text-muted); font-size: .7rem; font-weight: 400; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-4); }
.heading-actions { display: flex; align-items: center; gap: var(--space-3); }
.usage-block { margin-top: var(--space-3); }
.usage-heading,.usage-coverage { display: flex; justify-content: flex-end; }
.usage-coverage { margin-block: var(--space-2) var(--space-3); color: var(--text-muted); font-size: .75rem; }
.usage-metrics { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-3); margin-bottom: var(--space-4); }
.usage-table,.model-detail-table { --table-cell-padding: 10px 8px; }
.tokens,.limits { display: flex; flex-direction: column; }
.tokens > [data-period-panel] { display: flex; flex-direction: column; justify-content: center; flex: 1; gap: var(--space-6); }
.token-totals { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); align-items: center; gap: var(--space-3); --stat-value-size: clamp(1.8rem,2.5vw,2.4rem); }
.token-cost { text-align: center; }
.token-cost > span { display: block; color: var(--text-muted); font-size: .75rem; margin-bottom: var(--space-3); }
.token-cost strong { display: block; font-size: 1.7rem; font-weight: 500; letter-spacing: -.035em; font-variant-numeric: tabular-nums; }
.token-breakdown { border-top: 1px solid var(--border-subtle); padding-top: var(--space-3); }
.model-breakdown { font-size: .75rem; }
.model-name { font: .75rem/1.4 var(--font-mono); overflow-wrap: anywhere; }
.model-share { display: block; height: 3px; margin-top: var(--space-2); background: var(--surface-panel); }
.model-share > span { display: block; width: var(--share); height: 100%; background: var(--status-info); }
.api-rates { margin: var(--space-3) 0 0; color: var(--text-muted); font: .65rem/1.4 var(--font-mono); }
.stat-list { margin: 0; font-size: .8rem; line-height: 1.5; }
.stat-list > div { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); padding-block: var(--space-2); }
.stat-list dt { color: var(--text-muted); }
.stat-list dd { margin: 0; text-align: end; font-variant-numeric: tabular-nums; }
.stat-list--wide { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-2) var(--space-5); }
.reset-control { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-top: var(--space-4); font-size: .75rem; color: var(--text-muted); }
.reset-control strong { color: var(--text-primary); }
.limit + .limit { margin-top: var(--space-5); }
.limit__head,.limit__meta { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
.limit__head { font-size: .82rem; }
.limit__head strong { font-size: 1rem; font-variant-numeric: tabular-nums; }
.limit__track { height: 6px; margin: var(--space-2) 0; border-radius: var(--radius-sm); overflow: hidden; background: var(--surface-panel); }
.limit__track span { display: block; width: var(--used); height: 100%; background: var(--status-info); }
.limit__meta { color: var(--text-muted); font: .7rem/1.3 var(--font-mono); }
.limit-history { margin-top: auto; padding-top: var(--space-5); }
.limit-history .panel-heading { margin-bottom: var(--space-2); color: var(--text-muted); font-size: .75rem; }
.limit-history__chart { display: block; width: 100%; height: 85px; overflow: visible; }
.limit-history__grid { fill: none; stroke: var(--border-subtle); stroke-width: .5; }
.limit-history__series[data-series="0"] { fill: var(--status-info); }
.limit-history__series[data-series="1"] { fill: var(--status-success); }
.chart-dates { display: flex; justify-content: space-between; color: var(--text-muted); font: .65rem/1.4 var(--font-mono); }
.limit-history__legend { display: flex; justify-content: center; gap: var(--space-4); margin-top: var(--space-2); color: var(--text-muted); font-size: .7rem; }
.limit-history__legend span::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-inline-end: var(--space-2); background: var(--status-info); }
.limit-history__legend span[data-series="1"]::before { background: var(--status-success); }
.empty-value { margin: 0; color: var(--text-muted); font-size: .8rem; line-height: 1.5; }
.hub-alerts { padding: var(--space-4); margin-bottom: var(--space-4); border: 1px solid color-mix(in srgb,var(--status-warning) 45%,var(--border-subtle)); border-radius: var(--radius-md); background: color-mix(in srgb,var(--status-warning) 3%,var(--surface-raised)); }
.hub-alerts .section-heading { margin-bottom: var(--space-2); }
.hub-alerts h2 { font-size: .95rem; }
.problem { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding-block: var(--space-3); }
.problem + .problem { border-top: 1px solid var(--border-subtle); }
.problem__main { min-width: 0; }
.problem__main > strong { font-size: .87rem; font-weight: 600; overflow-wrap: anywhere; }
.problem__reasons { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin-top: var(--space-2); color: var(--status-warning); font-size: .78rem; }
.problem__next { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: .78rem; }
.problem[data-severity="critical"] { border-inline-start: 2px solid var(--status-failure); padding-inline-start: var(--space-3); }
.problem[data-severity="critical"] .problem__reasons { color: var(--status-failure); }
.health-cell { min-width: 0; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-raised); }
.health-detail { margin: 0; color: var(--text-muted); text-align: center; font: .7rem/1.5 var(--font-mono); overflow-wrap: anywhere; }
.network-state { text-align: center; color: var(--text-muted); font-size: .75rem; }
.orchestrator-state { margin-top: var(--space-3); }
.activity-filters { display: flex; align-items: end; gap: var(--space-3); }
.activity-filters label { min-width: 100px; }
.activity-list,.activity-more-list { display: grid; gap: var(--space-3); }
.work-item { min-width: 0; padding: var(--space-4); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-raised); }
.work-item__body > strong { font-size: .9rem; font-weight: 600; overflow-wrap: anywhere; }
.work-item__meta { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); margin-top: var(--space-2); color: var(--text-muted); font-size: .78rem; }
.work-item__meta > span:first-child { color: var(--status-info); }
.work-item__actions { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: start; margin-top: var(--space-3); }
.work-events { flex: 1; min-width: 150px; }
.work-event-list li { display: grid; grid-template-columns: 130px 1fr; gap: var(--space-3); padding-block: var(--space-2); border-top: 1px solid var(--border-subtle); font-size: .78rem; }
.work-event-list time { color: var(--text-muted); font: .7rem/1.5 var(--font-mono); }
.activity-more { margin-top: var(--space-3); }
.control-buttons { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--space-3); }
.control-form { display: grid; gap: var(--space-4); }
.control-fields { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--space-4); }
.control-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
.control-summary { font-size: .85rem; overflow-wrap: anywhere; white-space: pre-line; }
.control-form + .control-form { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--border-subtle); }
#hub-control-result { margin-bottom: 0; font-size: .8rem; overflow-wrap: anywhere; }
.model-table { --table-cell-padding: 10px 5px; }
.project-table { --table-cell-padding: 13px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-raised); }
.project-table table { min-width: 680px; }
.project-table th[scope="row"] a { color: var(--text-primary); text-decoration: none; }
.project-table th[scope="row"] a:hover { color: var(--text-accent); text-decoration: underline; }
.project-table td:last-child { color: var(--text-muted); font-size: .75rem; white-space: nowrap; }
.repository-filters { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin-bottom: var(--space-3); }
.trend { padding: var(--space-4); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-raised); }
.trend-total { color: var(--text-muted); font-size: .85rem; font-weight: 400; }
.trend-total > span { color: var(--text-primary); font-size: 1.2rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.trend__chart { display: grid; grid-template-columns: repeat(var(--trend-columns,30),minmax(0,1fr)); align-items: end; gap: var(--space-2); height: 160px; margin: var(--space-3) 0 var(--space-5); padding: 0; list-style: none; border-bottom: 1px solid var(--border-subtle); }
.trend__chart[style="--trend-columns:30"] { gap: var(--space-1); }
.trend__chart[style="--trend-columns:30"] .trend__date { display: none; }
.trend__chart[style="--trend-columns:30"] li:is(:first-child,:nth-child(7n),:last-child) .trend__date { display: block; }
.trend__chart li { position: relative; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; min-width: 0; height: 140px; }
.trend__bar { display: block; width: min(100%,56px); height: var(--bar-height); min-height: 2px; background: var(--status-info); opacity: .72; }
.trend__chart li:last-child .trend__bar { opacity: 1; }
.trend__count { margin-bottom: 4px; font: 500 .7rem/1.2 var(--font-mono); }
.trend__date { position: absolute; top: calc(100% + 8px); left: 50%; transform: translateX(-50%); color: var(--text-muted); font: .63rem/1.2 var(--font-mono); white-space: nowrap; }
.trend__chart li:not(:first-child):not(:nth-child(3n)):not(:last-child) .trend__date { display: none; }
.hub-footer { padding-block: var(--space-6); border-top: 1px solid var(--border-subtle); color: var(--text-muted); font: .7rem/1.4 var(--font-mono); }
@media(max-width:1050px) { .codex-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.models { grid-column: 1/-1; }.stat-list--wide { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media(max-width:750px) { .metric-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.hub { padding-top: var(--space-4); } }
@media(max-width:520px) { .section { margin-top: var(--space-6); }.section-heading { align-items: flex-start; flex-direction: column; }.hub-panel,.health-cell,.work-item { padding: var(--space-3); }.codex-grid { grid-template-columns: 1fr; }.models { grid-column: auto; }.control-fields,.stat-list--wide { grid-template-columns: 1fr; }.problem { align-items: flex-start; flex-direction: column; gap: var(--space-3); }.trend__chart { gap: 3px; }.trend__count { font-size: .58rem; }.trend__date { font-size: .55rem; }.work-event-list li { grid-template-columns: 1fr; gap: var(--space-1); }.activity-filters { width: 100%; }.activity-filters label { flex: 1; min-width: 0; } }
@media(max-width:520px) { .section-heading--period { flex-direction: row; align-items: center; }.heading-actions > span { display: none; }.usage-metrics { grid-template-columns: 1fr; }.trend__chart[style="--trend-columns:30"] .trend__count { display: none; } }
`;
