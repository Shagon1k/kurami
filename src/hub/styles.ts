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
import {POPOVER_CSS} from "../ui-library/components/popover.ts";
import {TOAST_CSS} from "../ui-library/components/toast.ts";

import {CHART_STYLES} from "../ui-library/components/charts/styles.ts";

export const HUB_STYLES=`${TOAST_CSS}${THEME_CSS}${FOUNDATION_CSS}${BUTTON_CSS}${THEME_SWITCH_CSS}${SITE_HEADER_CSS}${TABLE_CSS}${DISCLOSURE_CSS}${FORM_CSS}${DIALOG_CSS}${PERIOD_SWITCH_CSS}${ICON_CSS}${STAT_CARD_CSS}${POPOVER_CSS}${CHART_STYLES}
body { min-height: 100vh; }
.hub { padding-block: var(--space-6) var(--space-10); }
.chronicle__days { display: grid; gap: var(--space-4); }
.chronicle__day h3 { margin: 0 0 var(--space-2); color: var(--text-muted); font-size: .75rem; letter-spacing: .04em; text-transform: uppercase; }
.chronicle__day ul { display: grid; gap: var(--space-2); }
.chronicle__day li { display: grid; grid-template-columns: 18px minmax(0,1fr); gap: var(--space-2); align-items: start; font-size: .85rem; }
.chronicle__day li small { display: block; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chronicle__day li[data-kind="done"] svg { color: var(--status-success); }
.chronicle__day li[data-kind="returned"] svg { color: var(--status-warning); }
.chronicle__days + * { margin-top: var(--space-3); }
.hub__topline { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin-bottom: var(--space-4); }
.hub__pulse { display: flex; flex-wrap: wrap; gap: 0 var(--space-2); color: var(--text-muted); font-size: .9rem; }
.hub__pulse span:first-child { color: var(--text-primary); font-weight: 600; }
.hub__pulse[data-state="attention"] span:first-child { color: var(--status-warning); }
.hub__pulse span + span::before { content: "·"; margin-inline-end: var(--space-2); color: var(--text-muted); }
.hub__live { margin-inline-start: auto; }
.hub__topline h1 { margin: 0; font-size: clamp(1.9rem,3vw,2.6rem); line-height: 1.1; letter-spacing: -.05em; }
.hub__topline p { margin: 0; }
.hub__live { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--status-success); font: 500 .75rem/1.4 var(--font-mono); }
.hub__live::before { content: ""; inline-size: 7px; block-size: 7px; border-radius: var(--radius); background: currentColor; }
.hub[data-disconnected="true"] .hub__live { color: var(--status-warning); }
.metric-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: var(--space-3); }
.overview-grid { display: grid; grid-template-columns: minmax(0,2fr) repeat(2,minmax(0,1fr)); gap: var(--space-3); }
.task-summary { box-shadow: var(--shadow-card-sm); }
.task-summary h2 { margin: 0 0 var(--space-3); font-size: .8rem; font-weight: 500; color: var(--text-muted); }
.task-summary__metrics { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-3); --stat-value-size: 2.2rem; --stat-plain-label-height: 2.8em; }
.task-summary__cell { min-width: 0; padding-inline: var(--space-2); }
.task-summary__cell:not(:first-child) { border-left: 1px solid var(--border-subtle); }
.period-cost,.period-cost > div { height: 100%; }
.overview-grid { --stat-shadow: var(--shadow-card-sm); }
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
.usage-coverage { display: flex; justify-content: flex-end; }
.usage-coverage { margin-block: var(--space-2) var(--space-3); color: var(--text-muted); font-size: .75rem; }
.usage-metrics { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-3); margin-bottom: var(--space-4); }
.usage-table,.model-detail-table { --table-cell-padding: 10px 8px; }
.tokens,.limits { display: flex; flex-direction: column; }
.tokens > [data-period-panel] { display: flex; flex-direction: column; gap: var(--space-6); padding-top: var(--space-4); }
.token-totals { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,8rem),1fr)); align-items: center; gap: var(--space-3); --stat-value-size: clamp(1.8rem,2.5vw,2.4rem); }
.token-cost { text-align: center; }
.token-cost > span { display: block; color: var(--text-muted); font-size: .75rem; margin-bottom: var(--space-3); }
.token-cost strong { display: block; font-size: 1.7rem; font-weight: 500; letter-spacing: -.035em; font-variant-numeric: tabular-nums; }
.token-breakdown { border-top: 1px solid var(--border-subtle); padding-top: var(--space-3); }
.model-breakdown { font-size: .75rem; }
.model-name { font: .75rem/1.4 var(--font-mono); overflow-wrap: anywhere; }
.model-share { display: block; height: 3px; margin-top: var(--space-2); background: var(--surface-panel); }
.model-share > span { display: block; width: var(--share); height: 100%; background: var(--accent-data); }
.api-rates { margin: var(--space-3) 0 0; color: var(--text-muted); font: .65rem/1.4 var(--font-mono); }
.stat-list { margin: 0; font-size: .8rem; line-height: 1.5; }
.stat-list > div { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2) var(--space-3); padding-block: var(--space-2); }
.stat-list dt { color: var(--text-muted); }
.stat-list dd { margin: 0; margin-inline-start: auto; text-align: end; font-variant-numeric: tabular-nums; }
.stat-list--wide { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-2) var(--space-5); }
.reset-control { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-top: var(--space-4); font-size: .75rem; color: var(--text-muted); }
.reset-control strong { color: var(--text-primary); }
.limit + .limit { margin-top: var(--space-5); }
.limit__head,.limit__meta { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
.limit__head { font-size: .82rem; }
.limit__head strong { font-size: 1rem; font-variant-numeric: tabular-nums; }
.limit__track { height: 6px; margin: var(--space-2) 0; border-radius: var(--radius-sm); overflow: hidden; background: var(--surface-panel); }
.limit__track span { display: block; width: var(--used); height: 100%; background: var(--accent-data); }
.limit[data-tone="warning"] { --limit-tone: var(--status-warning); }
.limit[data-tone="failure"] { --limit-tone: var(--status-failure); }
.limit[data-tone]:not([data-tone="neutral"]) .limit__head strong { color: var(--limit-tone); }
.limit[data-tone]:not([data-tone="neutral"]) .limit__track span { background: var(--limit-tone); }
.control-changes { --table-font-size: .78rem; --table-cell-padding: var(--space-2); margin-block: var(--space-3); overflow-wrap: anywhere; }
.limit__meta { color: var(--text-muted); font: .7rem/1.3 var(--font-mono); }
.limit__forecast { display: flex; align-items: center; gap: var(--space-1); margin: var(--space-1) 0 0; color: var(--status-warning); font-size: .75rem; }
.limit__forecast svg { inline-size: 14px; block-size: 14px; flex: none; }
.limit-history { padding-top: var(--space-5); }
.limit-history .panel-heading { margin-bottom: var(--space-2); color: var(--text-muted); font-size: .75rem; }
.limit-history__legend { display: flex; justify-content: center; gap: var(--space-4); margin-top: var(--space-2); color: var(--text-muted); font-size: .7rem; }
.limit-history__legend span::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-inline-end: var(--space-2); background: var(--chart-4); }
.limit-history__legend span[data-series="1"]::before { background: var(--chart-3); }
.empty-value { margin: 0; color: var(--text-muted); font-size: .8rem; line-height: 1.5; }
.hub-alerts { padding: var(--space-4); margin-bottom: var(--space-4); border: 1px solid color-mix(in srgb,var(--status-warning) 45%,var(--border-subtle)); border-radius: var(--radius-md); background: color-mix(in srgb,var(--status-warning) 3%,var(--surface-raised)); }
.hub-alerts .section-heading { margin-bottom: var(--space-2); }
.hub-alerts h2 { font-size: .95rem; }
.problem { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding-block: var(--space-3); }
.problem + .problem { border-top: 1px solid var(--border-subtle); }
.problem__main { min-width: 0; }
.problem__links { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); flex-shrink: 0; }
.problem__main > strong { font-size: .87rem; font-weight: 600; overflow-wrap: anywhere; }
.problem__reasons { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin-top: var(--space-2); color: var(--status-warning); font-size: .78rem; }
.problem__reasons > span { display: inline-flex; align-items: center; gap: var(--space-2); }
.problem__next { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: .78rem; }
.problem__next { display: flex; align-items: center; gap: var(--space-2); }
.problem[data-severity="critical"] { border-inline-start: 2px solid var(--status-failure); padding-inline-start: var(--space-3); }
.problem[data-severity="critical"] .problem__reasons { color: var(--status-failure); }
.health-cell { min-width: 0; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-raised); box-shadow: var(--shadow-card-sm); }
.health-detail { margin: 0; color: var(--text-muted); text-align: center; font: .7rem/1.5 var(--font-mono); overflow-wrap: anywhere; }
.network-state { text-align: center; color: var(--text-muted); font-size: .75rem; }
.orchestrator-state { margin-top: var(--space-3); box-shadow: var(--shadow-card-sm); }
.orchestrator-state h3 { justify-content: flex-start; }
.orchestrator-grid { display: grid; grid-template-columns: repeat(6,minmax(0,1fr)); gap: var(--space-3); margin: 0; }
.orchestrator-grid > div { min-width: 0; padding-inline: var(--space-3); border-left: 1px solid var(--border-subtle); }
.orchestrator-grid > div:first-child { border-left: 0; padding-left: 0; }
.orchestrator-grid dt { min-width: 0; overflow-wrap: anywhere; display: flex; align-items: center; gap: var(--space-2); color: var(--text-muted); font-size: .75rem; }
.orchestrator-grid dd { margin: var(--space-3) 0 0; display: grid; gap: var(--space-1); }
.orchestrator-grid dd strong { color: var(--accent-data); font-size: 1.4rem; font-weight: 500; font-variant-numeric: tabular-nums; }
.orchestrator-grid dd span { overflow-wrap: anywhere; color: var(--text-muted); font-size: .7rem; }
.orchestrator-grid [data-tone="success"] dd strong { color: var(--status-success); }
.orchestrator-grid [data-tone="warning"] dd strong { color: var(--status-warning); }
.orchestrator-grid [data-tone="failure"] dd strong { color: var(--status-failure); }
.orchestrator-grid [data-tone="neutral"] dd strong { color: var(--text-primary); }
.activity-filters { display: flex; align-items: end; gap: var(--space-3); }
.activity-filters label { min-width: 100px; }
.activity-log { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-raised); box-shadow: var(--shadow-card-sm); }
.activity-list,.activity-more-list { display: grid; }
.work-item { min-width: 0; display: grid; grid-template-columns: 24px minmax(0,1fr) minmax(120px,.3fr) var(--control-height) max-content; align-items: center; column-gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-subtle); }
.work-item[hidden] { display: none; }
.work-item__row { display: contents; }
.work-item__icon { grid-column: 1; grid-row: 1; display: grid; place-items: center; color: var(--accent-data); }
.work-item[data-tone="failure"] .work-item__icon { color: var(--status-failure); }
.work-item[data-tone="success"] .work-item__icon { color: var(--status-success); }
.work-item__body { min-width: 0; grid-column: 2; grid-row: 1; }
.work-item__body > strong { font-size: .9rem; font-weight: 600; overflow-wrap: anywhere; }
.work-item__meta { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin-top: var(--space-1); color: var(--text-muted); font-size: .75rem; }
.work-item__meta > span:first-child { color: var(--accent-data); }
.work-item__result { min-width: 0; grid-column: 3; grid-row: 1; display: grid; gap: var(--space-1); font-size: .75rem; color: var(--text-muted); overflow-wrap: anywhere; }
.work-item__result time { font-size: .7rem; }
.work-item__link { grid-column: 4; grid-row: 1; }
.work-event-list { margin-top: var(--space-3); padding-left: var(--space-8); }
.work-event-list li { display: grid; grid-template-columns: 130px 1fr; gap: var(--space-3); padding-block: var(--space-2); border-top: 1px solid var(--border-subtle); font-size: .78rem; }
.work-event-list time { color: var(--text-muted); font: .7rem/1.5 var(--font-mono); }
.work-event-detail { min-width: 0; padding-top: var(--space-3); }
.work-event-subject { margin: 0; font-size: .85rem; overflow-wrap: anywhere; }
.work-event-coverage { color: var(--text-muted); font-size: .75rem; }
.activity-more { --disclosure-margin: 0 auto; }
.activity-empty { padding: var(--space-4); color: var(--text-muted); font-size: .8rem; }
.controls-menu { display: grid; gap: var(--space-1); --button-justify: flex-start; }
.control-buttons { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--space-3); }
.control-form { display: grid; gap: var(--space-4); }
.control-fields { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--space-4); }
.control-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
.control-summary { font-size: .85rem; overflow-wrap: anywhere; white-space: pre-line; }
.control-about { display: flex; align-items: center; margin: 0; color: var(--text-muted); font-size: .85rem; }
.release-state { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: var(--space-2); margin: 0; }
.release-state div { display: grid; gap: 2px; }
.release-state dt { color: var(--text-muted); font-size: .75rem; }
.release-state dd { margin: 0; font: 500 .9rem/1.3 var(--font-mono); }
.release-state__tests { grid-column: 1 / -1; }
.release-state__tests dd { font: inherit; font-size: .875rem; }
.release-drift { display: grid; gap: var(--space-1); font-size: .85rem; color: var(--status-warning); }
.release-steps { display: grid; gap: 2px; font-size: .8rem; }
.release-steps small { color: var(--text-muted); }
.release .control-actions { gap: var(--space-2); }
.release-action { display: contents; }
.control-form + .control-form { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--border-subtle); }
.composio-contours { border: 1px solid var(--border-subtle); border-radius: var(--radius); }
.composio-contour { padding: var(--space-3); }
.composio-contour + .composio-contour { border-top: 1px solid var(--border-subtle); }
.composio-contour__heading { display: grid; grid-template-columns: 18px minmax(0,1fr) auto; align-items: center; gap: var(--space-2); font-size: .8rem; }
.composio-contour__heading > span,.composio-contour__state { color: var(--text-muted); font-size: .75rem; }
.composio-contour__state { margin: var(--space-1) 0 0 calc(18px + var(--space-2)); }
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
.hub-footer { padding-block: var(--space-6); border-top: 1px solid var(--border-subtle); color: var(--text-muted); font: .7rem/1.4 var(--font-mono); }
@media(max-width:1050px) { .codex-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.models { grid-column: 1/-1; }.stat-list--wide { grid-template-columns: repeat(2,minmax(0,1fr)); }.orchestrator-grid { grid-template-columns: repeat(3,minmax(0,1fr)); row-gap: var(--space-5); }.orchestrator-grid > div:nth-child(3n+1) { border-left: 0; padding-left: 0; } }
@media(max-width:750px) { .overview-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.task-summary { grid-column: 1/-1; }.work-item { grid-template-columns: 18px minmax(0,1fr) max-content; row-gap: var(--space-1); column-gap: var(--space-2); align-items: start; }.work-item__icon { padding-top: var(--space-1); }.work-item__body { grid-column: 2; }.work-item__body > strong { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }.work-item__result { grid-column: 2; grid-row: 2; align-self: center; }.work-item__link { grid-column: 3; grid-row: 1; justify-self: end; }.work-events { --disclosure-summary-row: 2; --disclosure-body-row: 3; --disclosure-row-span: 3; }.work-event-list { padding-left: 0; } }
@media(max-width:520px) { .orchestrator-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.orchestrator-grid > div:nth-child(n) { border-left: 1px solid var(--border-subtle); padding-inline: var(--space-3); }.orchestrator-grid > div:nth-child(2n+1) { border-left: 0; padding-left: 0; } }
@media(max-width:750px) { .metric-grid,.overview-grid { grid-template-columns: repeat(auto-fit,minmax(min(100%,8rem),1fr)); }.hub { padding-top: var(--space-4); } }
@media(max-width:620px) { .hub { padding-bottom: calc(var(--space-10) + 44px + env(safe-area-inset-bottom)); }.task-summary__metrics { --stat-label-direction: column; --stat-label-gap: var(--space-1); --stat-plain-label-height: 4em; gap: var(--space-1); } }
@media(max-width:520px) { .section { margin-top: var(--space-6); }.section-heading { align-items: flex-start; flex-direction: column; }.hub-panel,.health-cell,.work-item { padding: var(--space-3); }.codex-grid { grid-template-columns: 1fr; }.models { grid-column: auto; }.control-fields,.stat-list--wide { grid-template-columns: 1fr; }.problem { align-items: flex-start; flex-direction: column; gap: var(--space-3); }.work-event-list li { grid-template-columns: 1fr; gap: var(--space-1); }.activity-filters { width: 100%; }.activity-filters label { flex: 1; min-width: 0; } }
@media(max-width:520px) { .section-heading--period { flex-direction: row; align-items: center; }.heading-actions > span { display: none; }.usage-metrics { grid-template-columns: 1fr; } }
`;
