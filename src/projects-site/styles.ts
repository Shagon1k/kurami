import { THEME_CSS } from "../ui-library/themes/index.ts";
import { FOUNDATION_CSS } from "../ui-library/foundations/index.ts";
import { BUTTON_CSS } from "../ui-library/components/button.ts";
import { TABLE_CSS } from "../ui-library/components/table.ts";
import { FORM_CSS } from "../ui-library/components/form.ts";
import { CALLOUT_CSS } from "../ui-library/components/callout.ts";
import { DISCLOSURE_CSS } from "../ui-library/components/disclosure.ts";
import { THEME_SWITCH_CSS } from "../ui-library/components/theme-switch.ts";
import { SITE_HEADER_CSS } from "../ui-library/patterns/site-header.ts";
import { breakpoints } from "../ui-library/tokens/index.ts";

export const PROJECTS_STYLES = [THEME_CSS, FOUNDATION_CSS, BUTTON_CSS, TABLE_CSS, FORM_CSS, CALLOUT_CSS, DISCLOSURE_CSS, THEME_SWITCH_CSS, SITE_HEADER_CSS, `
:root { --container-max: 1500px; }
.projects-page { padding-block: var(--space-5) var(--space-8); }
.projects-filters { display: grid; grid-template-columns: minmax(180px,1.4fr) repeat(3,minmax(130px,1fr)) auto; align-items: end; gap: var(--space-3); margin-bottom: var(--space-4); }
.projects-filter-actions { display: flex; justify-content: end; gap: var(--space-2); }
[data-refresh-status]:empty { display: none; }
.projects-overview { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: start; gap: var(--space-2) var(--space-5); margin-bottom: var(--space-4); padding-block: var(--space-1); }
.projects-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); min-height: 44px; }
.projects-summary p { display: flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--text-muted); font-size: .8rem; }
.projects-summary strong { color: var(--text-primary); font: 600 .85rem var(--font-mono); }
.projects-summary .projects-attention { color: var(--status-warning); }
.projects-freshness { font-size: .8rem; }
.projects-freshness ul { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5); padding-top: var(--space-2); }
.projects-freshness li { display: grid; gap: var(--space-1); }
.projects-grid { display: grid; grid-template-columns: minmax(0,1fr); gap: var(--space-4); align-items: start; }
.projects-grid--detail { grid-template-columns: minmax(0,1fr) 330px; }
.projects-table-frame { min-width: 0; border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--surface-raised); overflow: hidden; }
.projects-table { --table-font-size: .84rem; --table-cell-padding: var(--space-4); --table-head-background: var(--surface-section); }
.projects-row--attention { background: color-mix(in srgb, var(--status-warning) 3%, var(--surface-raised)); }
.projects-row--selected { background: var(--accent-soft); }
.projects-task { display: grid; gap: var(--space-2); min-width: 180px; max-width: 440px; font-weight: 500; line-height: 1.45; }
.projects-task-meta { display: flex; align-items: center; gap: var(--space-2); color: var(--text-muted); font-size: .72rem; font-weight: 400; }
.projects-task-meta .ui-icon { width: 15px; height: 15px; }
.projects-task-id { font-family: var(--font-mono); }
.projects-attention { display: inline-flex; color: var(--status-warning); }
.projects-status { display: inline-block; padding: var(--space-1) var(--space-2); background: var(--surface-section); border-radius: var(--radius-sm); font-size: .73rem; white-space: nowrap; }
.projects-status-pending { display: flex; align-items: center; gap: var(--space-1); margin-top: var(--space-2); color: var(--text-muted); font-size: .7rem; }
.projects-status-pending .ui-icon { width: 14px; height: 14px; }
.projects-status-form { padding-bottom: var(--space-4); margin-bottom: var(--space-4); border-bottom: 1px solid var(--border-subtle); }
.projects-status-controls { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: end; gap: var(--space-2); }
.projects-status-note { color: var(--text-muted); font-size: .75rem; line-height: 1.5; margin: var(--space-2) 0 0; }
.projects-stage { display: grid; gap: var(--space-2); min-width: 100px; max-width: 170px; line-height: 1.4; }
.projects-stage small { display: flex; align-items: center; gap: var(--space-1); color: var(--text-muted); font-size: .72rem; }
.projects-stage .ui-icon { width: 14px; height: 14px; }
.projects-checks { display: grid; gap: var(--space-2); min-width: 168px; }
.projects-check { display: grid; grid-template-columns: 16px 46px 1fr; align-items: center; gap: var(--space-2); }
.projects-check .ui-icon { width: 16px; height: 16px; color: var(--text-muted); }
.projects-check-name { color: var(--text-muted); font-size: .7rem; }
.projects-signal { display: inline-block; font-size: .72rem; white-space: nowrap; }
.projects-signal--neutral { color: var(--text-muted); }
.projects-signal--success { color: var(--status-success); }
.projects-signal--warning { color: var(--status-warning); }
.projects-signal--failure { color: var(--status-failure); }
.projects-detail { min-width: 0; padding: var(--space-5); border: 1px solid var(--border-default); border-top: 3px solid var(--accent-primary); border-radius: var(--radius); background: var(--surface-raised); }
.projects-detail-meta { display: flex; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-3); color: var(--text-muted); font-size: .75rem; }
.projects-detail-heading { display: flex; justify-content: space-between; align-items: start; gap: var(--space-3); }
.projects-detail h2 { margin: 0; font-size: 1.1rem; line-height: 1.4; overflow-wrap: anywhere; }
.projects-detail dl { display: grid; grid-template-columns: auto minmax(0,1fr); gap: var(--space-3); margin-block: var(--space-5); padding-block: var(--space-4); border-block: 1px solid var(--border-subtle); font-size: .8rem; }
.projects-detail dt { display: flex; align-items: center; gap: var(--space-2); color: var(--text-muted); }
.projects-detail dt .ui-icon { width: 15px; height: 15px; }
.projects-detail dd { margin: 0; overflow-wrap: anywhere; }
.projects-detail > p { font-size: .85rem; line-height: 1.5; }
.projects-detail code { font: .72rem var(--font-mono); }
.projects-links { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-block: var(--space-4); }
.projects-review-action { margin-block: var(--space-4); }
.projects-review-action p { color: var(--text-muted); font-size: .75rem; margin: var(--space-2) 0 0; }
.projects-update { color: var(--text-muted); font-size: .72rem; margin-top: var(--space-3); }
@media (max-width: 1100px) { .projects-grid--detail { grid-template-columns: minmax(0,1fr); } .projects-detail { grid-row: 1; } }
@media (max-width: ${breakpoints.tablet}px) { .projects-filters { grid-template-columns: repeat(2,minmax(0,1fr)); } .projects-filters > :first-child { grid-column: 1/-1; } .projects-filters > :last-child { justify-self: end; } }
@media (max-width: ${breakpoints.phone}px) {
  .projects-summary { gap: var(--space-2) var(--space-4); }
  .projects-overview { margin-bottom: var(--space-3); }
  .projects-table { --table-cell-padding: var(--space-3); padding-inline: var(--space-4); }
  .projects-task { max-width: none; min-width: 0; }
  .projects-checks { gap: var(--space-2); padding-block: var(--space-1); }
  .projects-detail { padding: var(--space-4); }
}

`].join("\n");
