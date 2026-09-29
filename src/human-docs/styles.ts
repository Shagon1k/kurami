import {THEME_CSS} from "../ui-library/themes/index.ts";

export const DOCS_STYLES = `${THEME_CSS}
@font-face { font-family: Onest; font-style: normal; font-weight: 400 700; font-display: swap; src: url('/assets/onest-latin.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215; }
@font-face { font-family: Onest; font-style: normal; font-weight: 400 700; font-display: swap; src: url('/assets/onest-cyrillic.woff2') format('woff2'); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: 'Fragment Mono'; font-style: normal; font-weight: 400; font-display: swap; src: url('/assets/fragment-mono-latin.woff2') format('woff2'); }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; color: var(--text-primary); background: var(--surface-page); font: 400 16px/1.55 var(--font-sans); }
a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 4px; }
a:hover { color: var(--accent-primary); }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 3px solid var(--accent-primary); outline-offset: 3px; }
button { font: inherit; cursor: pointer; }
.skip { position: absolute; left: 12px; top: -90px; background: var(--accent-primary); color: var(--surface-page); padding: 12px; z-index: 10; }
.skip:focus { top: 12px; }
.frame { width: min(1180px, calc(100% - 48px)); margin: auto; }
.site-header { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--surface-page) 94%, transparent); backdrop-filter: blur(14px); border-bottom: 1px solid var(--border-default); }
.site-header__inner { display: flex; align-items: center; gap: 12px 28px; min-height: 76px; padding: 10px 0; position: relative; }
.brand { display: inline-flex; align-items: center; gap: 10px; white-space: nowrap; text-decoration: none; font-size: 1.22rem; font-weight: 700; letter-spacing: -.04em; }
.brand img { width: 40px; height: 40px; object-fit: contain; }
html[data-theme=dark] .brand img { filter: drop-shadow(0 0 1px #ffffff88); }
.brand span { color: var(--accent-primary); }
.topnav { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.topnav a { display: inline-flex; align-items: center; white-space: nowrap; min-height: 44px; padding: 8px 10px; color: var(--text-muted); font-size: .82rem; font-weight: 600; text-decoration: none; }
.topnav a[aria-current], .topnav a:hover { color: var(--text-primary); box-shadow: inset 0 -2px var(--accent-primary); }
.mobile-menu { display: none; }
.actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0; }
.actions a, .actions button { min-width: 44px; min-height: 44px; display: inline-grid; place-items: center; padding: 0 10px; background: var(--surface-panel); color: var(--text-primary); border: 1px solid var(--border-default); border-radius: 3px; font-size: .78rem; font-weight: 600; text-decoration: none; }
.actions a[aria-current] { border-color: var(--accent-primary); }
.page { padding: clamp(38px, 6vw, 76px) 0 110px; scroll-margin-top: 76px; }
.eyebrow, .folio { color: var(--text-accent); font: 500 .72rem/1.4 var(--font-mono); letter-spacing: .075em; text-transform: uppercase; }
h1,h2,h3,p { margin-top: 0; }
h1 { max-width: 840px; margin-bottom: 20px; font-size: clamp(2.45rem, 5.8vw, 5rem); line-height: 1.03; letter-spacing: -.055em; font-weight: 600; }
h2 { font-size: clamp(1.4rem, 2.6vw, 2rem); line-height: 1.18; letter-spacing: -.035em; }
h3 { font-size: 1rem; line-height: 1.25; }
.lede { max-width: 720px; color: var(--text-muted); font-size: clamp(1.08rem, 2vw, 1.35rem); line-height: 1.5; }
.intro { padding-bottom: 42px; border-bottom: 1px solid var(--border-default); }
.sections { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; margin-top: 36px; }
.route { display: grid; align-content: space-between; min-height: 175px; padding: 24px; border: 1px solid var(--border-default); background: var(--surface-raised); text-decoration: none; box-shadow: 4px 4px 0 var(--shadow-offset); }
.route:hover { border-color: var(--accent-primary); }
.route h2 { margin-bottom: 8px; }
.route p { color: var(--text-muted); font-size: .89rem; }
.route .arrow { justify-self: end; color: var(--accent-primary); font-size: 1.4rem; }
.layout { display: grid; grid-template-columns: minmax(190px, 230px) minmax(0, 1fr); gap: clamp(30px, 5vw, 70px); }
.side { align-self: start; position: sticky; top: 105px; max-height: calc(100vh - 130px); overflow: auto; }
.side h2 { margin: 0 0 10px; font: 500 .67rem/1.3 var(--font-mono); text-transform: uppercase; color: var(--text-muted); letter-spacing: .07em; }
.side ul { margin: 0 0 25px; padding: 0; list-style: none; }
.side a { display: block; padding: 6px 0; font-size: .84rem; text-decoration: none; }
.side a[aria-current] { color: var(--accent-primary); font-weight: 700; }
.side-groups { margin-bottom: 25px; }
.side-group + .side-group { margin-top: 14px; }
.side-group h3 { margin: 0 0 3px; color: var(--text-primary); font: 600 .72rem/1.3 var(--font-sans); text-transform: uppercase; letter-spacing: .04em; }
.side .side-group ul { margin: 0; }
.side-group a { padding-left: 10px; border-left: 1px solid var(--border-default); }
.side-group a[aria-current] { border-left-color: var(--accent-primary); }
.side-group--solo a { padding-left: 0; border-left: 0; font-weight: 600; }
.side-mobile { display: none; }
.article { max-width: 790px; min-width: 0; }
.article .intro { margin-bottom: 32px; }
.block { padding: 22px 0; border-bottom: 1px solid var(--border-default); }
.block > :last-child { margin-bottom: 0; }
.block p, .block li { max-width: 72ch; }
.block p, .block ul, .block ol { margin-bottom: 13px; }
.block li + li { margin-top: 7px; }
.block code { padding: .1em .3em; background: var(--surface-section); font: .88em/1.3 var(--font-mono); overflow-wrap: anywhere; }
.block pre { overflow: auto; padding: 18px; background: var(--surface-section); border: 1px solid var(--border-default); font-size: .8rem; }
.block pre code { padding: 0; }
.block details { margin-top: 16px; padding: 14px 16px; border: 1px solid var(--border-default); background: var(--surface-panel); }
.block summary { cursor: pointer; font-weight: 600; }
.block details[open] > summary { margin-bottom: 12px; }
.block table { width: 100%; border-collapse: collapse; font-size: .84rem; }
.block table caption { margin-bottom: 12px; color: var(--text-accent); font-weight: 600; text-align: left; }
.block td,.block th { padding: 12px 8px; border-bottom: 1px solid var(--border-default); text-align: left; }
.data-table { max-width: 100%; overflow-x: auto; }
.data-table caption { margin-bottom: 12px; color: var(--text-accent); font-weight: 600; text-align: left; }
.data-table th[scope="row"] { font-weight: 600; }
.data-table__label { display: none; }
.diagram-block__explanation { color: var(--text-muted); }
.callout, .example { padding: 16px 20px; margin: 22px 0; border: 1px solid var(--border-default); background: var(--surface-panel); }
.callout { border-left: 3px solid var(--text-muted); }
.callout--warning, .callout--limit { border-left-color: var(--accent-primary); }
.callout p, .example p { margin: 8px 0 0; }
.example__label { color: var(--text-accent); font: 500 .72rem/1.4 var(--font-mono); text-transform: uppercase; }
.example h2 { margin: 8px 0 0; font-size: 1.1rem; }
.scene-map { max-width: 560px; margin: 20px auto 24px; padding: 14px; border: 1px solid var(--border-default); background: #fff; color: #0b0b0b; box-shadow: 4px 4px 0 var(--shadow-offset); }
.scene-map figcaption { margin-bottom: 12px; color: #a51612; font-size: .76rem; font-weight: 700; }
.scene-map img { display: block; width: 100%; height: auto; }
.scene-map p { margin: 10px 0 0; color: #454540; font-size: .8rem; }
.digest-map { margin: 20px 0 24px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-section); box-shadow: 4px 4px 0 var(--shadow-offset); }
.digest-map figcaption { margin-bottom: 15px; color: var(--text-accent); font-size: .76rem; font-weight: 600; letter-spacing: .04em; }
.digest-map__matrix { margin: 0; }
.digest-map__matrix > div { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(0, 2fr); gap: 16px; padding: 12px 0; border-top: 1px solid var(--border-default); }
.digest-map__matrix dt { font-weight: 700; }
.digest-map__matrix dd { margin: 0; color: var(--text-muted); }
.digest-map__steps { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
.digest-map__steps li { min-width: 0; padding: 14px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.digest-map__steps strong { display: block; margin: 6px 0; line-height: 1.3; }
.digest-map__steps p { margin: 0; color: var(--text-muted); font-size: .81rem; }
.source-notes { margin-top: 34px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-section); }
.source-notes h2 { margin-bottom: 7px; font-size: 1.15rem; }
.source-notes p { margin-bottom: 10px; color: var(--text-muted); font-size: .8rem; }
.source-notes ul { margin: 0; padding-left: 20px; font-size: .8rem; overflow-wrap: anywhere; }
.source-notes li + li { margin-top: 4px; }
.visual { display: grid; gap: 13px; padding: 20px; margin: 20px 0; border: 1px solid var(--border-default); background: var(--surface-section); box-shadow: 4px 4px 0 var(--shadow-offset); }
.visual__label { color: var(--text-muted); font: 500 .68rem/1.3 var(--font-mono); text-transform: uppercase; }
.flow { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
.flow__step { display: grid; align-content: start; gap: 9px; min-width: 0; padding: 15px; background: var(--surface-raised); border: 1px solid var(--border-default); }
.flow__step strong { font-size: .9rem; line-height: 1.25; }
.flow__step small { color: var(--text-muted); line-height: 1.35; }
.flow__step .folio { font-size: .63rem; }
.architecture-map { margin: 20px 0 24px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-section); }
.architecture-map figcaption { margin-bottom: 16px; color: var(--text-accent); font-size: .76rem; font-weight: 600; letter-spacing: .04em; }
.architecture-map__path { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 24px; margin: 0; padding: 0; list-style: none; }
.architecture-map__path li { position: relative; display: grid; align-content: start; gap: 8px; min-width: 0; padding: 14px; background: var(--surface-raised); border: 1px solid var(--border-default); }
.architecture-map__path li:not(:last-child)::after { content: '→'; position: absolute; right: -25px; top: 50%; transform: translateY(-50%); width: 24px; color: var(--accent-primary); text-align: center; font-weight: 700; line-height: 1; }
.architecture-map__path strong, .architecture-map__outcomes strong { display: block; font-size: .9rem; line-height: 1.3; }
.architecture-map__path p, .architecture-map__outcomes p { margin: 0; color: var(--text-muted); font-size: .81rem; line-height: 1.45; }
.architecture-map__outcomes { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin-top: 16px; }
.architecture-map__outcomes > div { min-width: 0; padding: 8px 0 8px 14px; border-left: 3px solid var(--accent-primary); }
.architecture-map__outcomes > div + div { border-color: var(--text-muted); }
.architecture-map__outcomes strong { margin-bottom: 5px; }
.architecture-map__source { margin: 18px 0 0; color: var(--text-muted); font-size: .75rem; overflow-wrap: anywhere; }
.architecture-map__source code { color: var(--text-primary); }
.system-map { display: grid; gap: 14px; margin: 34px 0 0; padding: 20px; background: var(--surface-section); border: 1px solid var(--border-default); box-shadow: 4px 4px 0 var(--shadow-offset); }
.block .system-map { margin-bottom: 24px; }
.system-map figcaption, .roles-map figcaption, .state-legend figcaption, .comparison-map figcaption, .order-map figcaption, .admission-map figcaption, .project-digest-map figcaption, .project-cards figcaption, .sample-run-card figcaption, .health-map figcaption, .recovery-matrix figcaption, .boundary-map figcaption { color: var(--text-accent); font-size: .76rem; font-weight: 600; letter-spacing: .04em; }
.system-map__paths, .system-map__products { display: grid; gap: 12px; }
.system-map__paths { grid-template-columns: repeat(2,minmax(0,1fr)); }
.system-map__products { grid-template-columns: repeat(3,minmax(0,1fr)); }
.system-map__path, .system-map__products > div { min-width: 0; padding: 16px; background: var(--surface-raised); border: 1px solid var(--border-default); }
.system-map__path { display: grid; align-content: start; gap: 8px; }
.system-map__path strong, .system-map__products strong, .system-map__junction strong, .system-map__evidence strong, .system-map__owner strong { display: block; font-size: .9rem; line-height: 1.3; }
.system-map__path p, .system-map__products p, .system-map__junction p, .system-map__evidence p, .system-map__owner p { margin: 5px 0 0; color: var(--text-muted); font-size: .81rem; line-height: 1.45; }
.system-map__junction { position: relative; padding: 16px; border: 1px solid var(--accent-primary); background: var(--surface-panel); text-align: center; }
.system-map__junction::before, .system-map__junction::after { content: '↓'; position: absolute; top: -19px; color: var(--accent-primary); font-weight: 700; }
.system-map__junction::before { left: 25%; }
.system-map__junction::after { right: 25%; }
.system-map__evidence, .system-map__owner { padding: 12px 16px; border-left: 3px solid var(--text-muted); background: var(--surface-panel); }
.system-map__owner { border-color: var(--accent-primary); }
.roles-map, .state-legend { margin: 20px 0 24px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-section); box-shadow: 4px 4px 0 var(--shadow-offset); }
.roles-map__grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; margin-top: 16px; }
.roles-map__card { min-width: 0; padding: 16px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.roles-map__card strong { display: block; margin-bottom: 7px; font-size: .96rem; }
.roles-map__card p { margin-bottom: 12px; color: var(--text-primary); font-size: .84rem; }
.roles-map__card small { display: block; padding-top: 10px; border-top: 1px solid var(--border-default); color: var(--text-muted); line-height: 1.45; }
.roles-map__owner { margin: 14px 0 0; padding: 12px 14px; border-left: 3px solid var(--accent-primary); background: var(--surface-panel); font-size: .84rem; }
.state-legend dl { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; margin: 16px 0 0; }
.state-legend dl > div { min-width: 0; padding: 14px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.state-legend dt { display: flex; gap: 10px; align-items: baseline; font-weight: 700; }
.state-legend dd { margin: 7px 0 0; color: var(--text-muted); font-size: .82rem; line-height: 1.45; }
.comparison-map, .order-map { margin: 20px 0 24px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-section); box-shadow: 4px 4px 0 var(--shadow-offset); }
.comparison-map__grid, .order-map__grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin-top: 16px; }
.comparison-map__grid > div, .order-map__grid > div { min-width: 0; padding: 16px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.comparison-map__grid strong, .order-map__grid strong { display: block; margin-bottom: 7px; font-size: .92rem; }
.comparison-map__grid p { margin: 0; color: var(--text-muted); font-size: .82rem; line-height: 1.45; }
.comparison-map__note, .order-map > p { margin: 14px 0 0; padding: 11px 14px; border-left: 3px solid var(--accent-primary); background: var(--surface-panel); color: var(--text-muted); font-size: .82rem; }
.order-map ol { margin: 0; padding-left: 22px; color: var(--text-muted); font-size: .82rem; }
.order-map li { padding: 5px 0; }
.admission-map, .project-cards { margin: 20px 0 24px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-section); box-shadow: 4px 4px 0 var(--shadow-offset); }
.admission-map__status { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 10px; margin-top: 16px; }
.admission-map__status > div { min-width: 0; padding: 13px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.admission-map__status strong { color: var(--text-accent); font: 600 .72rem/1.2 var(--font-mono); }
.admission-map__status p, .admission-map__gates p { margin: 7px 0 0; color: var(--text-muted); font-size: .8rem; line-height: 1.4; }
.admission-map__gates { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 10px; margin: 16px 0 0; padding: 0; list-style: none; }
.admission-map__gates li { display: grid; align-content: start; gap: 5px; min-width: 0; padding: 14px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.admission-map__gates strong { font-size: .88rem; line-height: 1.3; }
.admission-map__note, .project-cards__note { margin: 14px 0 0; padding: 11px 14px; border-left: 3px solid var(--accent-primary); background: var(--surface-panel); color: var(--text-muted); font-size: .82rem; }
.project-digest-map { margin: 20px 0 24px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-section); box-shadow: 4px 4px 0 var(--shadow-offset); }
.project-digest-map__paths { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin-top: 16px; }
.project-digest-map__paths > div { min-width: 0; padding: 16px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.project-digest-map__paths > div + div { border-top: 3px solid var(--accent-primary); }
.project-digest-map__paths strong { display: block; margin-bottom: 8px; font-size: .92rem; }
.project-digest-map__paths p { margin: 0 0 12px; font-size: .82rem; line-height: 1.45; }
.project-digest-map__paths small { display: block; padding-top: 10px; border-top: 1px solid var(--border-default); color: var(--text-muted); line-height: 1.45; }
.project-cards__grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,160px),1fr)); gap: 12px; margin-top: 16px; }
.project-cards__card { min-width: 0; padding: 16px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.project-cards__card > strong { display: block; margin-bottom: 9px; font-size: .92rem; }
.project-cards__card p { margin: 0; color: var(--text-muted); font-size: .82rem; line-height: 1.45; }
.project-cards__card dl { margin: 0; }
.project-cards__card dt { margin-top: 9px; color: var(--text-muted); font: 500 .64rem/1.3 var(--font-mono); text-transform: uppercase; }
.project-cards__card dd { margin: 3px 0 0; font-size: .8rem; line-height: 1.4; }
.project-cards__card small { display: block; margin-top: 13px; padding-top: 10px; border-top: 1px solid var(--border-default); color: var(--text-accent); line-height: 1.4; }
.sample-run-card { margin: 20px 0 24px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-section); box-shadow: 4px 4px 0 var(--shadow-offset); }
.sample-run-card__window { margin-top: 15px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.sample-run-card__header { display: grid; gap: 3px; padding-bottom: 14px; border-bottom: 1px solid var(--border-default); }
.sample-run-card__header strong { font-size: 1rem; }
.sample-run-card__header small { color: var(--text-muted); }
.sample-run-card dl { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin: 15px 0; }
.sample-run-card dl > div { min-width: 0; padding: 10px 12px; border: 1px solid var(--border-default); background: var(--surface-panel); }
.sample-run-card dt { color: var(--text-muted); font: 500 .68rem/1.3 var(--font-mono); text-transform: uppercase; }
.sample-run-card dd { margin: 5px 0 0; font-size: .86rem; }
.sample-run-card__links { margin: 0 0 14px; font-size: .82rem; }
.sample-run-card__action { padding: 12px 14px; border-left: 3px solid var(--accent-primary); background: var(--surface-panel); }
.sample-run-card__action strong { display: block; font-size: .86rem; }
.sample-run-card__action p, .sample-run-card__note { margin: 5px 0 0; color: var(--text-muted); font-size: .8rem; line-height: 1.45; }
.sample-run-card__note { margin-top: 14px; }
.health-map, .recovery-matrix, .boundary-map { margin: 20px 0 24px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-section); box-shadow: 4px 4px 0 var(--shadow-offset); }
.health-map__path { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 24px; margin: 16px 0 0; padding: 0; list-style: none; }
.health-map__path li { position: relative; display: grid; align-content: start; gap: 7px; min-width: 0; padding: 15px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.health-map__path li:not(:last-child)::after { content: '→'; position: absolute; right: -25px; top: 50%; transform: translateY(-50%); width: 24px; color: var(--accent-primary); text-align: center; font-weight: 700; }
.health-map__path strong, .health-map__outcomes strong { font-size: .9rem; }
.health-map__path p, .health-map__outcomes p { margin: 0; color: var(--text-muted); font-size: .8rem; line-height: 1.42; }
.health-map__outcomes { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin-top: 16px; }
.health-map__outcomes > div { min-width: 0; padding: 12px 14px; border-left: 3px solid var(--text-muted); background: var(--surface-panel); }
.health-map__outcomes > div + div { border-color: var(--accent-primary); }
.health-map__outcomes strong { display: block; margin-bottom: 5px; }
.health-map__note, .boundary-map > p { margin: 14px 0 0; padding: 11px 14px; border-left: 3px solid var(--accent-primary); background: var(--surface-panel); color: var(--text-muted); font-size: .82rem; }
.recovery-matrix__rows { display: grid; gap: 10px; margin-top: 16px; }
.recovery-matrix__row { display: grid; grid-template-columns: minmax(120px,.7fr) minmax(0,2.3fr); gap: 16px; min-width: 0; padding: 15px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.recovery-matrix__row > strong { font-size: .9rem; }
.recovery-matrix__row dl { display: grid; grid-template-columns: .65fr 1.2fr 1.4fr; gap: 14px; margin: 0; }
.recovery-matrix__row dt, .boundary-map dt { color: var(--text-muted); font: 500 .63rem/1.3 var(--font-mono); text-transform: uppercase; }
.recovery-matrix__row dd, .boundary-map dd { margin: 4px 0 0; font-size: .78rem; line-height: 1.4; }
.boundary-map__grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; margin-top: 16px; }
.boundary-map__card { min-width: 0; padding: 16px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.boundary-map__card > strong { display: block; margin-bottom: 12px; font-size: .92rem; }
.boundary-map__card dl { margin: 0; }
.boundary-map__card dt:not(:first-child) { margin-top: 13px; padding-top: 10px; border-top: 1px solid var(--border-default); color: var(--text-accent); }
.health-map__card { margin-top: 16px; padding: 18px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.health-map__heading { display: grid; gap: 4px; padding-bottom: 14px; border-bottom: 1px solid var(--border-default); }
.health-map__heading strong { font-size: 1.1rem; }
.health-map__heading span { color: var(--text-accent); font-weight: 600; }
.health-map__groups { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 20px; padding: 14px 0; }
.health-map__groups h3 { margin-bottom: 8px; }
.health-map__groups dl { margin: 0; }
.health-map__groups dl > div { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-top: 1px solid var(--border-default); font-size: .81rem; }
.health-map__groups dt { color: var(--text-muted); }
.health-map__groups dd { margin: 0; text-align: right; font-weight: 600; }
.health-map__recent { margin: 0; padding-top: 10px; border-top: 1px solid var(--border-default); color: var(--text-muted); font-size: .78rem; }
.schedule-evidence, .maintenance-scope, .connector-contours { margin: 20px 0 24px; padding: 20px; border: 1px solid var(--border-default); background: var(--surface-section); box-shadow: 4px 4px 0 var(--shadow-offset); }
.schedule-evidence figcaption, .maintenance-scope figcaption, .connector-contours figcaption { color: var(--text-accent); font-size: .76rem; font-weight: 600; letter-spacing: .04em; }
.schedule-evidence ol { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; margin: 16px 0 0; padding: 0; list-style: none; }
.schedule-evidence li { min-width: 0; padding: 14px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.schedule-evidence strong { display: block; margin: 6px 0; }
.schedule-evidence p, .maintenance-scope p { margin: 0; color: var(--text-muted); font-size: .82rem; }
.maintenance-scope__grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin: 16px 0; }
.maintenance-scope__column { min-width: 0; padding: 16px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.maintenance-scope__column--remove { border-top: 3px solid var(--accent-primary); }
.maintenance-scope__column > strong { display: block; margin-bottom: 10px; }
.maintenance-scope__column ul { margin: 0; padding-left: 18px; font-size: .84rem; }
.connector-contours dl { margin: 16px 0 0; }
.connector-contours dl > div { display: grid; grid-template-columns: minmax(140px,.85fr) minmax(0,1.8fr); gap: 12px; padding: 13px 0; border-top: 1px solid var(--border-default); }
.connector-contours dt, .connector-contours dd { margin: 0; }
.connector-contours code { overflow-wrap: anywhere; font: .8rem var(--font-mono); }
.connector-contours dd strong, .connector-contours dd span { display: block; }
.connector-contours dd span { margin-top: 3px; color: var(--text-muted); font-size: .82rem; }
.changes { display: grid; gap: 20px; }
.change-day { padding: 20px; border: 1px solid var(--border-default); background: var(--surface-raised); }
.change-day h2 { margin-bottom: 15px; }
.change { padding: 13px 0; border-top: 1px solid var(--border-default); }
.change__category { display: inline-block; margin-right: 8px; color: var(--accent-primary); font: .67rem var(--font-mono); text-transform: uppercase; }
.change p { margin: 6px 0 0; font-size: .91rem; }
.change a { color: var(--text-muted); font-size: .75rem; }
.footer { padding: 32px 0; border-top: 1px solid var(--border-default); color: var(--text-muted); font-size: .75rem; }
@media (max-width: 1100px) {
  .architecture-map__path { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .architecture-map__path li::after { display: none; }
  .admission-map__gates { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .recovery-matrix__row { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
  .site-header__inner { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 8px; }
  .topnav { display: none; }
  .mobile-menu { display: block; grid-column: 2; grid-row: 1; }
  .mobile-menu summary { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid var(--border-default); border-radius: 3px; background: var(--surface-panel); cursor: pointer; list-style: none; }
  .mobile-menu summary::-webkit-details-marker { display: none; }
  .menu-icon, .menu-icon::before, .menu-icon::after { display: block; width: 20px; height: 2px; background: var(--text-primary); }
  .menu-icon { position: relative; }
  .menu-icon::before, .menu-icon::after { content: ""; position: absolute; left: 0; }
  .menu-icon::before { top: -6px; } .menu-icon::after { top: 6px; }
  .mobile-menu[open] .menu-icon { background: transparent; }
  .mobile-menu[open] .menu-icon::before { top: 0; transform: rotate(45deg); }
  .mobile-menu[open] .menu-icon::after { top: 0; transform: rotate(-45deg); }
  .mobile-menu nav { position: absolute; top: calc(100% - 1px); left: 0; right: 0; display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 2px 12px; padding: 14px; border: 1px solid var(--border-default); background: var(--surface-raised); box-shadow: 4px 4px 0 var(--shadow-offset); }
  .mobile-menu nav a { display: flex; align-items: center; min-height: 44px; padding: 8px 12px; font-weight: 600; text-decoration: none; }
  .mobile-menu nav a[aria-current] { color: var(--accent-primary); border-left: 2px solid var(--accent-primary); }
  .actions { grid-column: 3; grid-row: 1; margin-left: 0; justify-self: end; }
}
@media (max-width: 800px) { .layout { grid-template-columns: 1fr; } .side { display: none; } .side-mobile { display: block; padding: 10px 14px; border: 1px solid var(--border-default); background: var(--surface-panel); } .side-mobile summary { min-height: 44px; align-content: center; cursor: pointer; font-weight: 600; } .side-mobile nav { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; padding: 14px 0; } .side-mobile h2 { font: 500 .68rem var(--font-mono); color: var(--text-muted); text-transform: uppercase; } .side-mobile ul { margin: 0; padding: 0; list-style: none; } .side-mobile a { display: block; min-height: 38px; padding: 8px 0; text-decoration: none; } .side-mobile a[aria-current] { color: var(--accent-primary); font-weight: 700; } .side-mobile .side-groups { margin-bottom: 0; } .side-mobile .side-group a { padding-left: 10px; border-left: 1px solid var(--border-default); } .side-mobile .side-group a[aria-current] { border-left-color: var(--accent-primary); } .side-mobile .side-group--solo a { padding-left: 0; border-left: 0; } }
@media (max-width: 580px) {
  .data-table { overflow: visible; }
  .article .data-table table, .article .data-table tbody, .article .data-table tr { display: block; width: 100%; }
  .article .data-table caption { display: block; width: 100%; text-align: left; }
  .article .data-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .article .data-table tr { padding: 12px 0; border-bottom: 1px solid var(--border-default); }
  .article .data-table th[scope="row"], .article .data-table td { display: block; width: 100%; padding: 4px 0; border: 0; }
  .article .data-table td { font-weight: 400; }
  .article .data-table__label { display: block; margin-top: 4px; color: var(--text-muted); font: 500 .67rem var(--font-mono); text-transform: uppercase; }
  .digest-map { padding: 14px; }
  .digest-map__matrix > div, .digest-map__steps { grid-template-columns: 1fr; }
  .digest-map__matrix > div { gap: 3px; }
  .article[data-page="reading-state"] table, .article[data-page="reading-state"] table tbody,
  .article[data-page="reading-state"] table tr { display: block; }
  .article[data-page="reading-state"] table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .article[data-page="reading-state"] table tr { padding: 12px 0; border-bottom: 1px solid var(--border-default); }
  .article[data-page="reading-state"] table td { display: block; padding: 4px 0; border: 0; }
  .article[data-page="reading-state"] table td:first-child { font-weight: 700; }
  .article[data-page="reading-state"] table td:nth-child(2)::before,
  .article[data-page="reading-state"] table td:nth-child(3)::before { display: block; margin-top: 4px; color: var(--text-muted); font: 500 .67rem var(--font-mono); text-transform: uppercase; }
  html[lang="en"] .article[data-page="reading-state"] table td:nth-child(2)::before { content: 'Meaning'; }
  html[lang="ru"] .article[data-page="reading-state"] table td:nth-child(2)::before { content: 'Значение'; }
  html[lang="en"] .article[data-page="reading-state"] table td:nth-child(3)::before { content: 'Safe next step'; }
  html[lang="ru"] .article[data-page="reading-state"] table td:nth-child(3)::before { content: 'Безопасный шаг'; }
  .architecture-map { padding: 14px; }
  .architecture-map__path, .architecture-map__outcomes { grid-template-columns: minmax(0,1fr); }
  .architecture-map__path { gap: 18px; }
  .architecture-map__path li:not(:last-child)::after { display: block; content: '↓'; top: auto; bottom: -17px; right: calc(50% - 11px); }
  .health-map__path, .health-map__outcomes, .boundary-map__grid { grid-template-columns: 1fr; }
  .health-map__groups, .schedule-evidence ol, .maintenance-scope__grid, .connector-contours dl > div { grid-template-columns: 1fr; }
  .connector-contours dl > div { gap: 5px; }
  .health-map__path { gap: 18px; }
  .health-map__path li:not(:last-child)::after { content: '↓'; top: auto; bottom: -17px; right: calc(50% - 11px); }
  .recovery-matrix__row dl { grid-template-columns: 1fr; gap: 10px; }
  .frame { width: min(100% - 28px, 1180px); } .site-header__inner { gap: 6px; } .brand { gap: 6px; font-size: 1rem; } .brand img { width: 34px; height: 34px; } .actions { gap: 4px; } .mobile-menu nav { grid-template-columns: 1fr; } .sections, .system-map__paths, .system-map__products, .roles-map__grid, .state-legend dl, .comparison-map__grid, .order-map__grid, .admission-map__status, .admission-map__gates, .project-digest-map__paths, .project-cards__grid, .sample-run-card dl { grid-template-columns: 1fr; } .system-map__junction::before { left: calc(50% - 5px); } .system-map__junction::after { display: none; } .route { min-height: 135px; padding: 18px; } .side-mobile nav { grid-template-columns: 1fr; } .flow { grid-template-columns: 1fr 1fr; } .flow__step { min-height: 98px; } .page { padding-top: 32px; } .visual, .system-map, .roles-map, .state-legend, .comparison-map, .order-map, .admission-map, .project-digest-map, .project-cards, .sample-run-card, .health-map, .recovery-matrix, .boundary-map { padding: 14px; } .sample-run-card__window { padding: 14px; } }
@media (max-width: 360px) { .brand { font-size: .86rem; } .brand img { width: 30px; height: 30px; } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
`;
