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
.projects-page { padding-block: var(--space-8); }
.projects-hero { display: flex; justify-content: space-between; align-items: end; gap: var(--space-5); margin-bottom: var(--space-6); }
.projects-eyebrow { margin: 0 0 var(--space-2); color: var(--text-accent); font: 500 .75rem var(--font-mono); }
.projects-hero h1 { margin: 0; font-size: clamp(2rem,4vw,3.25rem); line-height: 1.1; letter-spacing: -.04em; }
.projects-hero p:last-child { margin-bottom: 0; color: var(--text-muted); }
.projects-filters { display: grid; grid-template-columns: minmax(180px,1.3fr) repeat(3,minmax(140px,1fr)) auto; align-items: end; gap: var(--space-3); margin-bottom: var(--space-5); }
.projects-summary { display: flex; flex-wrap: wrap; gap: var(--space-5); margin-bottom: var(--space-5); }
.projects-summary p { margin: 0; color: var(--text-muted); font-size: .8rem; }
.projects-summary strong { margin-right: var(--space-2); color: var(--text-primary); font: 600 1.5rem var(--font-mono); }
.projects-freshness { margin-bottom: var(--space-5); }
.projects-freshness ul { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); }
.projects-freshness li { display: grid; gap: var(--space-1); font-size: .8rem; }
.projects-grid { display: grid; grid-template-columns: minmax(0,1fr); gap: var(--space-5); align-items: start; }
.projects-grid--detail { grid-template-columns: minmax(0,1fr) 360px; }
.projects-table { --table-font-size: .8rem; --table-cell-padding: 14px 10px; min-width: 0; }
.projects-task { display: grid; gap: var(--space-2); max-width: 300px; min-width: 160px; }
.projects-task a { width: fit-content; }
.projects-task small { color: var(--text-muted); font: 400 .7rem var(--font-mono); }
.projects-stage { display: grid; gap: var(--space-1); min-width: 100px; }
.projects-stage small { color: var(--text-muted); }
.projects-signal { display: inline-block; font: 500 .72rem var(--font-mono); white-space: nowrap; }
.projects-signal--neutral { color: var(--text-muted); }
.projects-signal--success { color: var(--status-success); }
.projects-signal--warning { color: var(--status-warning); }
.projects-signal--failure { color: var(--status-failure); }
.projects-detail { min-width: 0; padding: var(--space-5); border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--surface-panel); }
.projects-detail-heading { display: flex; justify-content: space-between; align-items: start; gap: var(--space-3); }
.projects-detail h2 { margin: 0; font-size: 1.2rem; line-height: 1.3; overflow-wrap: anywhere; }
.projects-detail dl { display: grid; grid-template-columns: auto minmax(0,1fr); gap: var(--space-3); font-size: .85rem; }
.projects-detail dt { color: var(--text-muted); }
.projects-detail dd { margin: 0; overflow-wrap: anywhere; }
.projects-detail code { font: .72rem var(--font-mono); }
.projects-links { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-block: var(--space-4); }
.projects-update { color: var(--text-muted); font-size: .75rem; margin-top: var(--space-4); }
.projects-footer { padding-block: var(--space-5); border-top: 1px solid var(--border-default); color: var(--text-muted); font-size: .8rem; }
@media (max-width: 1100px) { .projects-grid--detail { grid-template-columns: minmax(0,1fr); } .projects-detail { grid-row: 1; } }
@media (max-width: ${breakpoints.tablet}px) { .projects-filters { grid-template-columns: repeat(2,minmax(0,1fr)); } .projects-filters > :first-child { grid-column: 1/-1; } }
@media (max-width: ${breakpoints.phone}px) { .projects-hero { align-items: start; flex-direction: column; } .projects-task { max-width: none; min-width: 0; } .projects-summary { gap: var(--space-3); } .projects-detail { padding: var(--space-4); } }
`].join("\n");
