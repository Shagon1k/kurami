import {THEME_CSS} from "../ui-library/themes/index.ts";
import {FOUNDATION_CSS} from "../ui-library/foundations/index.ts";
import {BUTTON_CSS} from "../ui-library/components/button.ts";
import {TABLE_CSS} from "../ui-library/components/table.ts";
import {FORM_CSS} from "../ui-library/components/form.ts";
import {CALLOUT_CSS} from "../ui-library/components/callout.ts";
import {PILL_CSS} from "../ui-library/components/pill.ts";
import {POPOVER_CSS} from "../ui-library/components/popover.ts";
import {THEME_SWITCH_CSS} from "../ui-library/components/theme-switch.ts";
import {SITE_HEADER_CSS} from "../ui-library/patterns/site-header.ts";
import {breakpoints} from "../ui-library/tokens/index.ts";
import {ICON_CSS} from "../ui-library/components/icon.ts";

export const PROJECTS_STYLES=[THEME_CSS,FOUNDATION_CSS,BUTTON_CSS,TABLE_CSS,FORM_CSS,CALLOUT_CSS,PILL_CSS,POPOVER_CSS,THEME_SWITCH_CSS,SITE_HEADER_CSS,ICON_CSS,`
:root { --container-max: 1500px; }
[data-projects-app] { --projects-table-height: calc(100dvh - 230px); }
.projects-page { padding-block: var(--space-5) var(--space-6); }
.projects-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3) var(--space-5); }
.projects-search { width: min(480px,100%); }
[data-refresh-status] { flex: 1; min-width: 220px; font-size: .8rem; color: var(--text-muted); }
[data-refresh-status]:empty { display: none; }
.projects-overview { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-2) var(--space-5); margin-block: var(--space-3); }
.projects-summary { --button-icon-size: 14px; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-height: var(--control-height); }
.projects-summary p { display: flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--text-muted); font-size: .78rem; }
.projects-summary p { margin-inline-end: var(--space-2); }
.projects-filters { display: grid; grid-template-columns: repeat(2,max-content); gap: var(--space-2); }
.projects-summary p strong { color: var(--text-primary); font: 600 .82rem var(--font-mono); }
.projects-sync { margin-inline-start: auto; --popover-width: 380px; --popover-padding: var(--space-4); }
.projects-sync-list li { padding-block: var(--space-2); border-bottom: 1px solid var(--border-subtle); }
.projects-sync-list li > div { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.projects-sync-list time { display: block; color: var(--text-muted); font: .72rem var(--font-mono); padding-block: var(--space-1); }
.projects-mobile-sort { display: none; }
.projects-grid { display: grid; grid-template-columns: minmax(0,1fr); gap: var(--space-4); align-items: start; }
.projects-grid--detail { grid-template-columns: minmax(0,1fr) 360px; }
.projects-table-frame { min-width: 0; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-raised); box-shadow: var(--shadow-card-sm); overflow: hidden; }
.projects-table { --table-font-size: .82rem; --table-cell-padding: var(--space-3); --table-head-padding: var(--space-2) var(--space-3); --table-head-background: var(--surface-section); }
.projects-sort { --button-icon-size: 14px; }
.projects-checks-heading { display: flex; align-items: center; justify-content: center; min-height: var(--control-height); }
.projects-row--attention { background: color-mix(in srgb,var(--status-warning) 3%,var(--surface-raised)); }
.projects-row--selected { background: var(--accent-soft); }
.projects-task { display: grid; gap: var(--space-2); min-width: 140px; max-width: 480px; font-weight: 500; line-height: 1.45; }
.projects-task-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); color: var(--text-muted); font-size: .7rem; font-weight: 400; }
.projects-task-meta { --icon-size: 14px; }
.projects-task-id { font-family: var(--font-mono); }
.projects-attention { display: inline-flex; color: var(--status-warning); }
.projects-status-pending { display: flex; align-items: center; gap: var(--space-1); margin-top: var(--space-2); color: var(--text-muted); font-size: .7rem; }
.projects-stage { display: grid; justify-items: start; gap: var(--space-2); min-width: 100px; max-width: 160px; }
.projects-stage small { display: flex; align-items: center; gap: var(--space-1); color: var(--text-muted); font-size: .7rem; }
.projects-stage { --icon-size: 14px; }
.projects-checks { display: grid; gap: var(--space-2); min-width: 140px; }
.projects-check { display: grid; grid-template-columns: 14px minmax(60px,1fr) auto; align-items: center; gap: var(--space-1); }
.projects-check { --icon-size: 14px; --icon-color: var(--text-muted); }
.projects-check-name { color: var(--text-muted); font-size: .68rem; white-space: nowrap; }
.projects-signal { color: var(--text-muted); font: 500 .72rem/1.4 var(--font-sans); white-space: nowrap; }
.projects-signal--info { color: var(--status-info); }
.projects-signal--success { color: var(--status-success); }
.projects-signal--warning { color: var(--status-warning); }
.projects-signal--failure { color: var(--status-failure); }
.projects-detail { min-width: 0; padding: var(--space-5); border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-raised); scrollbar-width: thin; }
.projects-detail:focus { outline: none; }
.projects-detail-top { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
.projects-detail-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin: 0; color: var(--text-muted); font-size: .72rem; }
.projects-detail h2 { margin: 0; font-size: 1.08rem; line-height: 1.45; overflow-wrap: anywhere; }
.projects-detail-badges { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin-block: var(--space-4) var(--space-3); }
.projects-links { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--space-4); margin-block: var(--space-2) var(--space-3); }
.projects-recommendation { display: flex; gap: var(--space-2); color: var(--status-info); background: var(--surface-panel); padding: var(--space-3); border-radius: var(--radius); font-size: .78rem; line-height: 1.5; }
.projects-recommendation p { margin: 0; }
.projects-detail-section { border-top: 1px solid var(--border-subtle); padding-block: var(--space-4); }
.projects-detail-section h3 { display: flex; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-3); font-size: .78rem; font-weight: 600; }
.projects-detail-section h3 { --icon-size: 15px; --icon-color: var(--text-muted); }
.projects-status-controls { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: end; gap: var(--space-2); }
.projects-context { padding: var(--space-3); background: var(--surface-panel); border-radius: var(--radius); color: var(--text-muted); font-size: .78rem; line-height: 1.55; margin: var(--space-3) 0 0; overflow-wrap: anywhere; }
.projects-evidence { display: grid; gap: var(--space-3); }
.projects-evidence-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.projects-evidence-label { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.projects-evidence-label { --icon-color: var(--text-muted); }
.projects-evidence-label > div { display: grid; gap: var(--space-1); }
.projects-evidence-label strong { font-size: .78rem; font-weight: 500; }
.projects-detail code { font: .66rem var(--font-mono); color: var(--text-muted); }
.projects-findings { color: var(--text-muted); font-size: .72rem; margin: 0; }
.projects-action-grid { display: grid; gap: var(--space-3); }
.projects-action-grid,.projects-review-action { --button-width: 100%; }
.projects-action-note,.projects-status-note { color: var(--text-muted); font-size: .74rem; line-height: 1.5; margin: var(--space-2) 0 0; }
.projects-confirm-buttons { --button-width: auto; display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.projects-update { color: var(--text-muted); font-size: .7rem; line-height: 1.6; margin: var(--space-2) 0 0; }
[data-search-empty] { padding: var(--space-4); }
@media (min-width: 901px) {
  .projects-table { --table-cell-padding: var(--space-4); --table-max-height: var(--projects-table-height,calc(100dvh - 230px)); --table-head-position: sticky; --table-overscroll: contain; }
  .projects-detail { max-height: var(--projects-table-height,calc(100dvh - 230px)); overflow-y: auto; overscroll-behavior: contain; }
}
@media (max-width: 900px) {
  .projects-grid--detail { grid-template-columns: minmax(0,1fr); }
  .projects-detail { position: fixed; inset: 0; z-index: 60; width: 100%; height: 100dvh; overflow-y: auto; overscroll-behavior: contain; border: 0; border-radius: var(--radius-sm); padding: var(--space-5); padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom)); background: var(--surface-page); touch-action: pan-y; }
  .projects-detail[data-enter] { animation: projects-detail-enter var(--duration-base) ease-out; }
  body.projects-mobile-detail-open { overflow: hidden; }
  .projects-detail [data-refresh-status] { position: sticky; top: 0; z-index: 2; min-width: 0; padding: var(--space-3); background: var(--surface-panel); border: 1px solid var(--border-default); border-radius: var(--radius); }
  body.projects-mobile-detail-open .projects-table-frame { visibility: hidden; }
  .projects-table-frame { touch-action: pan-y; }
  @keyframes projects-detail-enter { from { transform: translateX(8%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
}
@media (max-width: ${breakpoints.phone}px) {
  .projects-page { padding-top: var(--space-4); }
  .projects-summary { display: contents; }
  .projects-summary p { display: none; }
  .projects-overview { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: var(--space-2); margin-block: var(--space-2); }
  .projects-mobile-sort { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-bottom: var(--space-2); }
  .projects-table { --table-stack-row-padding: var(--space-3) var(--space-4); }
  .projects-task { max-width: none; min-width: 0; }
  .projects-checks { padding-block: var(--space-1); }
  .projects-detail { padding: var(--space-4); }
}
@media (prefers-reduced-motion: reduce) { .projects-detail[data-enter] { animation: none; } }
`].join("\n");
