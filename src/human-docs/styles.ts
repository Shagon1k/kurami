import {THEME_CSS} from "../ui-library/themes/index.ts";
import {FOUNDATION_CSS} from "../ui-library/foundations/index.ts";
import {BUTTON_CSS} from "../ui-library/components/button.ts";
import {THEME_SWITCH_CSS} from "../ui-library/components/theme-switch.ts";
import {ICON_CSS} from "../ui-library/components/icon.ts";
import {SITE_HEADER_CSS} from "../ui-library/patterns/site-header.ts";
import {TABLE_CSS} from "../ui-library/components/table.ts";
import {CALLOUT_CSS} from "../ui-library/components/callout.ts";
import {DISCLOSURE_CSS} from "../ui-library/components/disclosure.ts";
import {DIAGRAM_CSS} from "../ui-library/foundations/diagram.ts";
import {KURAMI_MOOD_CSS} from "../ui-library/components/kurami-mood.ts";

// Docs layout only: side menu by depth, article column, right-hand contents, and the docs blocks
// (glance, steps, compare, cards, terms, guarantees, code map, figures, screenshots). Roles only.
export const DOCS_STYLES = `${KURAMI_MOOD_CSS}
.intro--kurami { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); }
${THEME_CSS}${FOUNDATION_CSS}${BUTTON_CSS}
${THEME_SWITCH_CSS}
${ICON_CSS}
${SITE_HEADER_CSS}
${TABLE_CSS}
${CALLOUT_CSS}
${DISCLOSURE_CSS}
${DIAGRAM_CSS}
:root { --measure: 72ch; }
body { line-height: 1.6; }
a { text-decoration-thickness: 1px; text-underline-offset: 4px; }
a:hover { color: var(--text-accent); }
.page { padding: clamp(32px, 5vw, 64px) 0 96px; }
.eyebrow { margin: 0 0 var(--space-3); color: var(--text-accent); font: 500 .72rem/1.4 var(--font-mono); letter-spacing: .07em; text-transform: uppercase; }
h1, h2, h3, h4, p { margin-top: 0; }
h1 { max-width: 20ch; margin-bottom: var(--space-4); font-size: clamp(2.2rem, 5vw, 3.6rem); line-height: 1.05; letter-spacing: -.045em; font-weight: 600; }
.lede { max-width: 62ch; margin-bottom: 0; color: var(--text-muted); font-size: clamp(1.05rem, 1.8vw, 1.25rem); line-height: 1.5; }
.intro { padding-bottom: var(--space-8); margin-bottom: var(--space-8); border-bottom: 1px solid var(--border-default); }
.muted { color: var(--text-muted); }

/* Layout: side menu · article · contents */
.prose { min-width: 0; }
.layout { display: grid; grid-template-columns: minmax(180px, 220px) minmax(0, 1fr); gap: clamp(28px, 4vw, 56px); }
.layout--toc { grid-template-columns: minmax(180px, 220px) minmax(0, 1fr) 190px; }
.side { align-self: start; position: sticky; top: 96px; max-height: calc(100vh - 120px); overflow: auto; padding-bottom: var(--space-6); }
.side__section { margin: 0 0 var(--space-4); font-size: 1rem; font-weight: 700; letter-spacing: -.01em; }
.side-group + .side-group { margin-top: var(--space-5); }
.side-group h3 { margin: 0 0 var(--space-1); color: var(--text-muted); font: 500 .66rem/1.3 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; }
.side-group--internals h3, .side-group--decisions h3 { color: var(--text-accent); }
.side-group ul { margin: 0; padding: 0; list-style: none; }
.side-group a { display: block; padding: 5px 0 5px 12px; border-left: 1px solid var(--border-default); font-size: .86rem; line-height: 1.35; text-decoration: none; }
.side-group a[aria-current] { color: var(--text-accent); border-left: 2px solid var(--accent-primary); padding-left: 11px; font-weight: 600; }
.side-mobile { display: none; }
.toc { align-self: start; position: sticky; top: 96px; font-size: .8rem; }
.toc p { margin: 0 0 var(--space-2); color: var(--text-muted); font: 500 .66rem/1.3 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; }
.toc ol { margin: 0; padding: 0; list-style: none; border-left: 1px solid var(--border-subtle); }
.toc li a { display: block; padding: 4px 0 4px 12px; color: var(--text-muted); line-height: 1.35; text-decoration: none; }
.toc li a:hover { color: var(--text-accent); }
.toc li a[aria-current="location"] { color:var(--text-primary); background:var(--surface-section); border-inline-start:2px solid var(--accent-data); padding-inline-start:10px; font-weight:600; }
.toc-mobile { display: none; }
.side-mobile, .toc-mobile { --disclosure-summary-font-size: .86rem; --disclosure-summary-font-weight: 600; --disclosure-summary-color: var(--text-primary); --disclosure-summary-padding-inline: 0; --disclosure-summary-min-height: 44px; }
.side-mobile__list, .toc-mobile__list { max-height: min(60vh, 520px); overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.toc-mobile__list ol { margin: 0; padding: 0; list-style: none; }
.toc-mobile__list a { display: block; padding: var(--space-2) 0; font-size: .86rem; text-decoration: none; }
.changelog-version { color: var(--text-muted); font-size: .86rem; margin-bottom: var(--space-3); }
.changelog-version code { font-family: var(--font-mono); }
.article { min-width: 0; max-width: 780px; }

/* Prose */
.prose > * + * { margin-top: var(--space-4); }
.prose p, .prose li { max-width: var(--measure); }
.prose p { margin-bottom: 0; }
.prose h2 { margin: var(--space-10) 0 var(--space-3); padding-top: var(--space-2); font-size: clamp(1.35rem, 2.4vw, 1.75rem); line-height: 1.2; letter-spacing: -.03em; scroll-margin-top: 90px; }
.prose h3 { margin: var(--space-8) 0 var(--space-2); font-size: 1.08rem; line-height: 1.3; scroll-margin-top: 90px; }
.prose h4 { margin: var(--space-6) 0 var(--space-2); font-size: .95rem; }
.prose h2 + *, .prose h3 + *, .prose h4 + * { margin-top: 0; }
.prose > :first-child { margin-top: 0; }
.prose ul, .prose ol { margin-bottom: 0; padding-left: 1.3em; }
.prose li + li { margin-top: var(--space-1); }
.prose li > ul, .prose li > ol { margin-top: var(--space-1); }
.prose code { padding: .08em .3em; background: var(--surface-section); border-radius: var(--radius-sm); font: .87em/1.3 var(--font-mono); overflow-wrap: anywhere; }
.prose strong { font-weight: 650; }
.block { margin-top: var(--space-6); }
.prose > .block + .block { margin-top: var(--space-4); }
.codeblock { margin: var(--space-6) 0 0; border: 1px solid var(--border-default); background: var(--surface-section); border-radius: var(--radius); }
.codeblock figcaption { padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--border-default); color: var(--text-muted); font-size: .76rem; }
.codeblock figcaption code { background: none; padding: 0; }
.codeblock pre { margin: 0; padding: var(--space-4); overflow: auto; font: .8rem/1.55 var(--font-mono); }
.codeblock pre code { padding: 0; background: none; font: inherit; }

/* At a glance */
.glance { margin-top: 0; padding: var(--space-5); border: 1px solid var(--border-default); border-top: 3px solid var(--accent-primary); background: var(--surface-raised); box-shadow: var(--shadow-card-sm); }
.glance__label, .terms__label, .example__label, .guarantees__title, .code-map__title, .compare__title, .steps__actor, .card__eyebrow { margin: 0; font: 500 .68rem/1.4 var(--font-mono); letter-spacing: .07em; text-transform: uppercase; }
.glance__label { color: var(--text-accent); }
.glance dl { display: grid; gap: 0; margin: var(--space-3) 0 0; }
.glance dl > div { display: grid; grid-template-columns: minmax(120px, 170px) minmax(0, 1fr); gap: var(--space-4); padding: var(--space-2) 0; border-top: 1px solid var(--border-subtle); }
.glance dt { color: var(--text-muted); font-size: .86rem; }
.glance dd { margin: 0; font-size: .93rem; }

/* Key terms */
.terms { padding: var(--space-4) var(--space-5); border: 1px solid var(--border-default); background: var(--surface-panel); }
.terms__label { color: var(--text-muted); }
.terms dl { margin: var(--space-2) 0 0; }
.terms dl > div { display: grid; grid-template-columns: minmax(110px, 160px) minmax(0, 1fr); gap: var(--space-4); padding: var(--space-2) 0; }
.terms dl > div + div { border-top: 1px solid var(--border-subtle); }
.terms dt { font-weight: 650; font-size: .9rem; }
.terms dd { margin: 0; font-size: .9rem; color: var(--text-muted); }

/* Steps: a numbered path with an actor per step */
.steps { --step-marker-shape: 50%; counter-reset: step; margin-top: var(--space-6); padding: 0 !important; list-style: none; }
.steps > li { counter-increment: step; position: relative; max-width: none; padding: 0 0 var(--space-4) 44px; }
.steps > li + li { margin-top: 0; }
.steps > li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 28px; height: 28px; display: grid; place-items: center; border: 1.5px solid var(--text-primary); border-radius: var(--step-marker-shape); background: var(--surface-raised); font: 600 .78rem/1 var(--font-mono); }
.steps > li:not(:last-child)::after { content: ""; position: absolute; left: 14px; top: 30px; bottom: 2px; border-left: 1px dashed var(--border-default); }
.steps__actor { display: block; margin-bottom: 2px; color: var(--text-accent); }
.steps p { margin: 0; }

/* Compare: two or three columns side by side */
.compare { display: grid; gap: var(--space-3); margin-top: var(--space-6); }
.compare--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.compare--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.compare__column { min-width: 0; padding: var(--space-4) var(--space-5); border: 1px solid var(--border-default); background: var(--surface-raised); }
.compare__column > * + * { margin-top: var(--space-2); }
.compare__column p, .compare__column li { font-size: .9rem; }
.compare__title { margin-bottom: var(--space-2); color: var(--text-accent); }

/* Worked example */
.example { padding: var(--space-5); border: 1px dashed var(--border-default); background: var(--surface-panel); }
.example > * + * { margin-top: var(--space-3); }
.example__label { color: var(--text-muted); }
.example__title { margin-top: var(--space-1); font-weight: 650; font-size: 1.02rem; }
.example .steps { margin-top: var(--space-3); }

/* Guarantees */
.guarantees { padding: var(--space-5); border: 1px solid var(--border-default); border-left: 3px solid var(--status-success); background: var(--surface-raised); }
.guarantees__title { color: var(--status-success); }
.guarantees ul { margin: var(--space-3) 0 0; padding: 0; list-style: none; }
.guarantees li { position: relative; padding-left: 22px; font-size: .94rem; }
.guarantees li + li { margin-top: var(--space-2); }
.guarantees li::before { content: "✓"; position: absolute; left: 0; color: var(--status-success); font-weight: 700; }

/* Cards: links one layer deeper */
.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); margin-top: var(--space-6); padding: 0 !important; list-style: none; }
.cards > li { max-width: none; margin: 0 !important; }
.card { height: 100%; display: grid; align-content: start; gap: var(--space-1); padding: var(--space-4) var(--space-5); border: 1px solid var(--border-default); background: var(--surface-raised); text-decoration: none; box-shadow: var(--shadow-card-sm); }
.card:hover { border-color: var(--accent-primary); }
.card:hover strong { color: var(--text-accent); }
.card__eyebrow { color: var(--text-muted); }
.card strong { font-size: 1.02rem; line-height: 1.3; }
.card__text { color: var(--text-muted); font-size: .88rem; line-height: 1.45; }

/* Code map */
.code-map { margin-top: var(--space-10); padding: var(--space-5); border: 1px solid var(--border-default); background: var(--surface-section); }
.code-map__title { color: var(--text-muted); }
.code-map__note { margin: var(--space-1) 0 0; color: var(--text-muted); font-size: .76rem; }
.code-map ul { margin: var(--space-3) 0 0; padding: 0; list-style: none; }
.code-map li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: var(--space-4); padding: var(--space-2) 0; border-top: 1px solid var(--border-subtle); font-size: .84rem; }
.code-map li a { text-decoration: none; overflow-wrap: anywhere; }
.code-map li code { background: none; padding: 0; font-size: .8rem; }
.code-map li span { color: var(--text-muted); }

/* Figures: diagrams scale to the column and scroll inside themselves on phones */
.figure { margin: var(--space-8) 0 0; }
.prose .figure + * { margin-top: var(--space-6); }
.figure__title { margin-bottom: var(--space-2); color: var(--text-accent); font: 500 .7rem/1.4 var(--font-mono); letter-spacing: .07em; text-transform: uppercase; }
.figure__scroll { overflow-x: auto; border: 1px solid var(--border-default); background: var(--diagram-surface); border-radius: var(--radius); }
.figure__canvas { width: min(100%, calc(var(--figure-width) * 1px)); min-width: min(calc(var(--figure-width) * .72px), calc(var(--figure-width) * 1px)); margin-inline: auto; padding: var(--space-2); box-sizing: content-box; }
.figure__desc { margin-top: var(--space-2) !important; color: var(--text-muted); font-size: .82rem; line-height: 1.5; }
.figure__desc a { white-space: nowrap; }

/* Screenshots: two fixed sizes in one frame style */
.shot { margin: var(--space-8) 0 0; }
.shot__frame { display: block; padding: var(--space-3); border: 1px solid var(--border-default); background: var(--surface-section); border-radius: var(--radius); }
.shot img { display: block; width: 100%; height: auto; margin-inline: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-raised); }
.shot--card .shot__frame { max-width: 480px; }
.shot--card img { max-height: 520px; object-fit: contain; object-position: top; }
.shot figcaption { margin-top: var(--space-2); color: var(--text-muted); font-size: .82rem; }

/* Generated reference tables: keep code names whole */
.generated th code { white-space: nowrap; }
.generated td, .generated th { font-size: .84rem; }

/* Next page */
.next-page { display: grid; gap: var(--space-2); margin: var(--space-10) 0 0; padding-top: var(--space-5); border-top: 1px solid var(--border-default); }
.next-page > span { color: var(--text-accent); font: 500 .7rem/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: .07em; }
.next-page a { display: grid; gap: var(--space-1); padding: var(--space-4) var(--space-5); border: 1px solid var(--border-default); background: var(--surface-panel); text-decoration: none; }
.next-page a:hover strong { color: var(--text-accent); }
.next-page small { color: var(--text-muted); font-size: .88rem; }

/* Home */
.home { width: 100%; }
.home .intro h1 { max-width: 16ch; }
.prose--home .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.prose--home > p, .prose--home > ul { max-width: 68ch; }

/* Changelog */
.changes { display: grid; gap: 20px; }
.change-day { padding: 20px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.change-day h2 { margin-bottom: 15px; font-size: 1.2rem; }
.change { padding: 13px 0; border-top: 1px solid var(--border-default); }
.change__category { display: inline-block; margin-right: 8px; color: var(--text-accent); font: .67rem var(--font-mono); text-transform: uppercase; }
.change p { margin: 6px 0 0; font-size: .91rem; }
.change a { color: var(--text-muted); font-size: .75rem; }
.footer { padding: 32px 0; border-top: 1px solid var(--border-default); color: var(--text-muted); font-size: .75rem; }

@media (max-width: 1180px) {
  .layout--toc { grid-template-columns: minmax(180px, 220px) minmax(0, 1fr); }
  .toc { display: none; }
  .toc-mobile { display: block; margin-bottom: var(--space-6); }
}
@media (max-width: 800px) {
  .layout, .layout--toc { grid-template-columns: minmax(0,1fr); gap: var(--space-6); }
  .side { display: none; }
  .side-mobile { display: block; }
  .side-mobile__list { display: grid; gap: var(--space-4); padding: var(--space-3) 0; }
  .side-mobile .side-group a { min-height: 40px; display: flex; align-items: center; }
  .side-mobile .side__section { display: none; }
  .prose--home .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 620px) {
  .generated th code { white-space: normal; }
  .page { padding-top: 28px; }
  .intro { padding-bottom: var(--space-6); margin-bottom: var(--space-6); }
  .compare--2, .compare--3, .cards, .prose--home .cards { grid-template-columns: 1fr; }
  .glance dl > div, .terms dl > div, .code-map li { grid-template-columns: 1fr; gap: 2px; }
  .glance, .guarantees, .example, .code-map { padding: var(--space-4); }
}
`;
