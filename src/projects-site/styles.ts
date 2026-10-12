import {THEME_CSS} from "../ui-library/themes/index.ts";
import {FOUNDATION_CSS} from "../ui-library/foundations/index.ts";
import {BUTTON_CSS} from "../ui-library/components/button.ts";
import {TABLE_CSS} from "../ui-library/components/table.ts";
import {FORM_CSS} from "../ui-library/components/form.ts";
import {DIALOG_CSS} from "../ui-library/components/dialog.ts";
import {CALLOUT_CSS} from "../ui-library/components/callout.ts";
import {PILL_CSS} from "../ui-library/components/pill.ts";
import {POPOVER_CSS} from "../ui-library/components/popover.ts";
import {THEME_SWITCH_CSS} from "../ui-library/components/theme-switch.ts";
import {SITE_HEADER_CSS} from "../ui-library/patterns/site-header.ts";
import {breakpoints} from "../ui-library/tokens/index.ts";
import {ICON_CSS} from "../ui-library/components/icon.ts";
import {TOAST_CSS} from "../ui-library/components/toast.ts";
import {DISCLOSURE_CSS} from "../ui-library/components/disclosure.ts";
import {PROJECT_COLOR_CSS} from "../ui-library/components/project-color.ts";
import {KURAMI_MOOD_CSS} from "../ui-library/components/kurami-mood.ts";

export const PROJECTS_STYLES=[KURAMI_MOOD_CSS,THEME_CSS,FOUNDATION_CSS,BUTTON_CSS,TABLE_CSS,FORM_CSS,DIALOG_CSS,CALLOUT_CSS,PILL_CSS,POPOVER_CSS,THEME_SWITCH_CSS,SITE_HEADER_CSS,ICON_CSS,TOAST_CSS,DISCLOSURE_CSS,PROJECT_COLOR_CSS,`
[data-projects-app] { --projects-table-height: calc(100dvh - 230px); }
.projects-page { padding-block: var(--space-5) var(--space-6); }
.projects-your-move { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-subtle); }
.projects-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3) var(--space-5); }
.projects-capture { display: grid; gap: var(--space-3); }
.projects-capture__hint { margin: 0; color: var(--text-muted); font-size: .8rem; }
.projects-capture__context { display: grid; gap: var(--space-1); margin: 0; padding: var(--space-2) var(--space-3); border-inline-start: 2px solid var(--border-default); color: var(--text-muted); font-size: .8rem; overflow-wrap: anywhere; white-space: pre-line; }
.projects-capture__context span { color: var(--text-primary); font-weight: 600; }
.projects-ideas { display: grid; gap: var(--space-3); margin-top: var(--space-6); padding: var(--space-4) var(--space-5); border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-raised); box-shadow: var(--shadow-card-sm); }
.projects-ideas__heading { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.projects-ideas__heading h2 { margin: 0; font-size: 1.05rem; }
.projects-ideas__count { color: var(--text-muted); font-size: .75rem; font-variant-numeric: tabular-nums; }
.projects-ideas__note { margin: 0 0 0 auto; color: var(--text-accent); font: 600 1.3rem/1 var(--font-note); rotate: -3deg; text-shadow: var(--display-glow); }
.projects-ideas__empty { margin: 0; color: var(--text-muted); font-size: .82rem; }
.projects-ideas__list { display: grid; }
.projects-ideas__item { --disclosure-summary-width: 100%; position: relative; padding: var(--space-1) 0 var(--space-1) var(--space-4); border-top: 1px dashed var(--border-subtle); }
.projects-ideas__item::before { content: ""; position: absolute; inset: var(--space-3) auto var(--space-3) 0; width: 2px; border-radius: var(--radius-sm); color: var(--accent-data); background: currentColor; opacity: .35; box-shadow: var(--mark-glow); transition: opacity var(--duration-fast); }
.projects-ideas__item[open]::before, .projects-ideas__item:hover::before { opacity: 1; }
.projects-ideas__item > summary { list-style: none; }
.projects-ideas__item > summary::-webkit-details-marker { display: none; }
.projects-idea__head { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: baseline; gap: var(--space-1) var(--space-3); padding-block: var(--space-2); }
.projects-idea__number { color: var(--accent-data); font: 600 .78rem var(--font-mono); font-variant-numeric: tabular-nums; }
.projects-idea__gist { font-weight: 600; overflow-wrap: anywhere; }
.projects-idea__tags { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: var(--space-1) var(--space-3); color: var(--text-muted); font-size: .72rem; font-weight: 400; }
.projects-idea { display: grid; gap: var(--space-3); padding-block: 0 var(--space-4); }
.projects-idea__fields { display: grid; gap: var(--space-2); margin: 0; }
.projects-idea__field dt { color: var(--text-muted); font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; }
.projects-idea__field dd { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.projects-idea__journal { display: grid; gap: var(--space-1); padding-inline-start: var(--space-3); border-inline-start: 1px solid var(--border-subtle); font-size: .78rem; }
.projects-idea__journal li { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.projects-idea__journal time { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.projects-idea__actions { display: grid; gap: var(--space-3); max-width: 52rem; }
.projects-idea__form { --form-textarea-font-size: 1rem; --form-textarea-min-height: 6rem; display: grid; gap: var(--space-2); }
.projects-idea__submit { display: flex; justify-content: flex-end; }
.projects-search { width: min(480px,100%); }
.projects-overview { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-2) var(--space-5); margin-block: var(--space-3); }
.projects-summary { --button-icon-size: 14px; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-height: var(--control-height); }
.projects-summary p { display: flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--text-muted); font-size: .78rem; }
.projects-summary p { margin-inline-end: var(--space-2); }
.projects-filters { display: grid; grid-template-columns: repeat(2,max-content); gap: var(--space-2); }
.projects-summary p strong { color: var(--text-primary); font: 600 .82rem var(--font-mono); }
.projects-sync { display: flex; align-items: center; gap: var(--space-1); margin-inline-start: auto; --popover-width: 380px; --popover-padding: var(--space-4); }
.projects-sync-indicator { display: none; inline-size: var(--space-2); block-size: var(--space-2); border-radius: var(--radius-pill); flex: none; }
.projects-sync-indicator--fresh { background: var(--status-success); }
.projects-sync-indicator--delayed { background: var(--status-warning); }
.projects-sync-list li { padding-block: var(--space-2); border-bottom: 1px solid var(--border-subtle); }
.projects-sync-list li > div { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.projects-sync-list time { display: block; color: var(--text-muted); font: .72rem var(--font-mono); padding-block: var(--space-1); }
.projects-mobile-sort { display: none; }
.projects-grid { display: grid; grid-template-columns: minmax(0,1fr); gap: var(--space-4); align-items: start; }
.projects-grid--detail { grid-template-columns: minmax(0,1fr) 360px; }
.projects-table-frame { min-width: 0; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-raised); box-shadow: var(--shadow-card-sm); overflow: hidden; }
.projects-table { --pill-white-space: nowrap; --table-font-size: .82rem; --table-cell-padding: var(--space-3); --table-head-padding: var(--space-2) var(--space-3); --table-head-background: var(--surface-panel); }
.projects-sort { --button-icon-size: 14px; }
.projects-checks-heading { display: flex; align-items: center; justify-content: center; min-height: var(--control-height); }
.projects-row--attention { background: color-mix(in srgb,var(--status-warning) 3%,var(--surface-panel)); }
.projects-row--selected { background: color-mix(in srgb,var(--status-info) 7%,var(--surface-panel)); }
.projects-table th[scope="row"] { width: 48%; }
.projects-table td:nth-child(2) { min-width: 120px; }
.projects-more { display: none; justify-content: center; padding: var(--space-3); border-top: 1px solid var(--border-subtle); }
.projects-task { display: grid; gap: var(--space-2); min-width: 140px; max-width: 480px; font-weight: 600; line-height: 1.45; }
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
.projects-signal--failure { color: color-mix(in srgb,var(--status-failure) 92%,var(--text-primary)); }
.projects-detail { min-width: 0; padding: var(--space-5); border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-raised); scrollbar-width: thin; }
.projects-detail:focus { outline: none; }
.projects-detail-top { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
.projects-detail-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin: 0; color: var(--text-muted); font-size: .72rem; }
.projects-detail h2 { margin: 0; font-size: 1.08rem; line-height: 1.45; overflow-wrap: anywhere; }
.projects-detail-badges { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin-block: var(--space-4) var(--space-3); }
.projects-links { --button-justify: space-between; display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--space-1) var(--space-2); padding-block: var(--space-2); margin-bottom: var(--space-2); border-block: 1px solid var(--border-subtle); }
.projects-status-editor { margin-block: var(--space-2); }
.projects-recommendation { display: flex; gap: var(--space-2); color: var(--status-info); background: var(--surface-panel); padding: var(--space-3); border-radius: var(--radius); font-size: .78rem; line-height: 1.5; }
.projects-recommendation p { margin: 0; }
.projects-detail-section { border-top: 1px solid var(--border-subtle); padding-block: var(--space-4); }
.projects-detail-section h3 { display: flex; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-3); font-size: .78rem; font-weight: 600; }
.projects-detail-section h3 { --icon-size: 15px; --icon-color: var(--text-muted); }
.projects-status-controls { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: end; gap: var(--space-2); }
.projects-evidence-availability { margin: 0; padding: var(--space-3); color: var(--text-muted); font-size: .74rem; line-height: 1.5; }
.projects-writer-stop { font-size: .78rem; line-height: 1.5; --control-height: 44px; --button-width: 100%; --disclosure-summary-width: 100%; --disclosure-summary-padding-inline: 0; margin-top: var(--space-3); }
.projects-writer-summary { margin-bottom: 0; }
.projects-writer-stop-actions { display: grid; gap: var(--space-2); margin-top: var(--space-2); }
.projects-writer-report { color: var(--text-muted); overflow-wrap: anywhere; }
.projects-context { padding: var(--space-3); background: var(--surface-panel); border-radius: var(--radius); color: var(--text-muted); font-size: .78rem; line-height: 1.55; margin: var(--space-3) 0 0; overflow-wrap: anywhere; }
.projects-evidence { display: grid; margin-top: var(--space-2); border: 1px solid var(--border-subtle); border-radius: var(--radius); overflow: hidden; }
.projects-evidence-row { display: grid; gap: var(--space-2); padding: var(--space-3); }
.projects-evidence-row + .projects-evidence-row { border-top: 1px solid var(--border-subtle); }
.projects-evidence-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.projects-evidence-heading > .projects-signal { min-width: 0; flex: 0 1 auto; white-space: normal; overflow-wrap: anywhere; text-align: right; }
.projects-evidence-label { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.projects-evidence-label { flex: none; }
.projects-evidence-label { --icon-color: var(--text-muted); }
.projects-evidence-label strong { font-size: .78rem; font-weight: 500; }
.projects-ci-details { --disclosure-summary-width: 100%; --disclosure-summary-padding-inline: 0; --disclosure-summary-font-size: .7rem; }
.projects-ci-checks { list-style: none; padding: 0; margin: 0; display: grid; }
.projects-ci-check { display: grid; grid-template-columns: minmax(0,1fr) 16px; align-items: stretch; gap: var(--space-2); min-height: var(--control-height); }
.projects-ci-check + .projects-ci-check { border-top: 1px solid var(--border-subtle); }
.projects-ci-mark { display: inline-flex; align-items: center; --icon-size: 16px; }
.projects-ci-mark--success { --icon-color: var(--status-success); }
.projects-ci-mark--failure { --icon-color: var(--status-failure); }
.projects-ci-mark--warning { --icon-color: var(--status-warning); }
.projects-ci-mark--neutral { --icon-color: var(--text-muted); }
.projects-ci-check-content { display: grid; min-width: 0; font-size: .75rem; line-height: 1.45; --button-width: 100%; }
.projects-ci-check-name { align-self: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.projects-detail code { font: .66rem var(--font-mono); color: var(--text-muted); }
.projects-findings { color: var(--text-muted); font: .7rem/1.5 var(--font-mono); margin: 0; display: flex; flex-wrap: wrap; gap: var(--space-1); }
.projects-findings > span { white-space: nowrap; }
.projects-fix-round { white-space: nowrap; color: var(--text-muted); }
.projects-detail [data-note-tone="neutral"] { color: var(--text-muted); }
.projects-detail [data-note-tone="info"] { color: var(--status-info); }
.projects-detail [data-note-tone="warning"] { color: var(--status-warning); }
.projects-detail [data-note-tone="failure"] { color: var(--status-failure); }
.projects-action-grid { display: grid; gap: var(--space-2); }
.projects-run-actions { display: grid; gap: var(--space-2); }
.projects-preview-review { margin: var(--space-2) 0; }
.projects-task-start { display: grid; grid-template-columns: minmax(0,1fr); --button-width: 100%; }
.projects-action-pair { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); column-gap: var(--space-2); }
.projects-action-pair:has(> :only-child) { grid-template-columns: minmax(0,1fr); }
.projects-run-action { --button-width: 100%; min-width: 0; display: contents; }
.projects-run-action-meta { min-width: 0; }
.projects-action-pair > .projects-run-action > :first-child { grid-row: 1; }
.projects-action-pair > .projects-run-action > .projects-run-action-meta { grid-column: 1 / -1; }
.projects-action-pair > .projects-run-action > .projects-run-action-meta:empty { display: none; }
.projects-action-menu { min-width: 0; --popover-width: 300px; --popover-padding: var(--space-3); --button-width: 100%; }
.projects-action-options { display: grid; gap: var(--space-2); --button-width: 100%; --button-justify: flex-start; }
.projects-action-note,.projects-status-note,.projects-info { color: var(--status-info); font-size: .74rem; line-height: 1.5; margin: var(--space-2) 0 0; }
.projects-confirm-buttons { --button-width: auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }
.projects-update { color: var(--text-muted); font-size: .7rem; line-height: 1.6; margin: var(--space-2) 0 0; }
[data-search-empty] { padding: var(--space-4); }
@media (min-width: 901px) {
  .projects-table { --table-cell-padding: var(--space-4); --table-max-height: var(--projects-table-height,calc(100dvh - 230px)); --table-head-position: sticky; --table-overscroll: contain; }
  .projects-detail { max-height: var(--projects-table-height,calc(100dvh - 230px)); overflow-y: auto; overscroll-behavior: contain; }
}
@media (min-width: 1280px) {
  .projects-grid--detail { grid-template-columns: minmax(0,1fr) clamp(380px,28vw,420px); }
}
@media (max-width: 900px) {
  .projects-grid--detail { grid-template-columns: minmax(0,1fr); }
  .projects-detail { --projects-detail-padding: var(--space-5); --projects-detail-bottom-padding: var(--space-6); position: fixed; inset: 0; z-index: 60; width: 100%; height: 100dvh; overflow-y: auto; overscroll-behavior: contain; border: 0; border-radius: var(--radius-sm); padding: calc(var(--projects-detail-padding) + env(safe-area-inset-top,0px)) calc(var(--projects-detail-padding) + env(safe-area-inset-right,0px)) calc(var(--projects-detail-bottom-padding) + max(env(safe-area-max-inset-bottom,0px),env(safe-area-inset-bottom,0px))) calc(var(--projects-detail-padding) + env(safe-area-inset-left,0px)); background: var(--surface-page); touch-action: pan-y; }
  body.projects-mobile-detail-open { overflow: hidden; }
  .projects-detail[data-dragging] { box-shadow: var(--shadow-raised); will-change: transform; }
  .projects-table-frame { touch-action: pan-y; }
}
@media (max-width: ${breakpoints.phone}px) {
  .projects-page { padding-top: var(--space-4); }
  .projects-summary { display: contents; }
  .projects-summary p { display: none; }
  .projects-overview { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: var(--space-2); margin-block: var(--space-2); }
  .projects-sync-indicator { display: block; }
  .projects-mobile-sort { display: block; margin-bottom: var(--space-2); }
  .projects-idea__submit { --button-width: 100%; }
  .projects-table { --table-stack-row-padding: var(--space-3) var(--space-4); --table-stack-label-display: none; }
  .projects-more:not([hidden]) { display: flex; }
  .projects-table th[scope="row"] { width: auto; }
  .projects-task { max-width: none; min-width: 0; }
  .projects-ideas { padding: var(--space-3) var(--space-4); }
  .projects-ideas__note { margin-left: 0; flex-basis: 100%; }
  .projects-idea__head { grid-template-columns: auto minmax(0,1fr); }
  .projects-idea__tags { grid-column: 2; justify-content: flex-start; }
  .projects-checks { padding-block: var(--space-1); }
  .projects-detail { --projects-detail-padding: var(--space-4); --projects-detail-bottom-padding: var(--space-4); }
}

.projects-review-controls { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-2); margin-block:var(--space-2); }
.projects-review-controls:has(> :only-child) { grid-template-columns:minmax(0,1fr); }
.projects-review-controls:empty { display:none; }
.projects-review-profile { display:grid; gap:var(--space-2); padding-block:var(--space-2); }
.projects-review-profile + .projects-review-profile { border-top:1px solid var(--border-default); }

`].join("\n");