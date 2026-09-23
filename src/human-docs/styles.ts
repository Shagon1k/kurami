import {SITE_TOKENS} from "../shared-ui/tokens.ts";

export const DOCS_STYLES = `${SITE_TOKENS}
@font-face { font-family: Onest; font-style: normal; font-weight: 400 700; font-display: swap; src: url('/assets/onest-latin.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215; }
@font-face { font-family: Onest; font-style: normal; font-weight: 400 700; font-display: swap; src: url('/assets/onest-cyrillic.woff2') format('woff2'); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: 'Fragment Mono'; font-style: normal; font-weight: 400; font-display: swap; src: url('/assets/fragment-mono-latin.woff2') format('woff2'); }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; color: var(--ink); background: var(--paper); font: 400 16px/1.55 var(--font-sans); }
a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 4px; }
a:hover { color: var(--signal); }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 3px solid var(--signal); outline-offset: 3px; }
button { font: inherit; cursor: pointer; }
.skip { position: absolute; left: 12px; top: -90px; background: var(--signal); color: #fff; padding: 12px; z-index: 10; }
.skip:focus { top: 12px; }
.frame { width: min(1180px, calc(100% - 48px)); margin: auto; }
.site-header { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--paper) 94%, transparent); backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); }
.site-header__inner { display: flex; align-items: center; gap: 12px 28px; min-height: 76px; padding: 10px 0; position: relative; }
.brand { display: inline-flex; align-items: center; gap: 10px; white-space: nowrap; text-decoration: none; font-size: 1.22rem; font-weight: 700; letter-spacing: -.04em; }
.brand img { width: 40px; height: 40px; object-fit: contain; }
html[data-theme=dark] .brand img { filter: drop-shadow(0 0 1px #ffffff88); }
.brand span { color: var(--signal); }
.topnav { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.topnav a { display: inline-flex; align-items: center; white-space: nowrap; min-height: 44px; padding: 8px 10px; color: var(--muted); font-size: .82rem; font-weight: 600; text-decoration: none; }
.topnav a[aria-current], .topnav a:hover { color: var(--ink); box-shadow: inset 0 -2px var(--signal); }
.mobile-menu { display: none; }
.actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0; }
.actions a, .actions button { min-width: 44px; min-height: 44px; display: inline-grid; place-items: center; padding: 0 10px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 3px; font-size: .78rem; font-weight: 600; text-decoration: none; }
.actions a[aria-current] { border-color: var(--signal); }
.page { padding: clamp(38px, 6vw, 76px) 0 110px; }
.eyebrow, .folio { color: var(--signal); font: 500 .72rem/1.4 var(--font-mono); letter-spacing: .075em; text-transform: uppercase; }
h1,h2,h3,p { margin-top: 0; }
h1 { max-width: 840px; margin-bottom: 20px; font-size: clamp(2.45rem, 5.8vw, 5rem); line-height: 1.03; letter-spacing: -.055em; font-weight: 600; }
h2 { font-size: clamp(1.4rem, 2.6vw, 2rem); line-height: 1.18; letter-spacing: -.035em; }
h3 { font-size: 1rem; line-height: 1.25; }
.lede { max-width: 720px; color: var(--muted); font-size: clamp(1.08rem, 2vw, 1.35rem); line-height: 1.5; }
.intro { padding-bottom: 42px; border-bottom: 1px solid var(--line); }
.sections { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; margin-top: 36px; }
.route { display: grid; align-content: space-between; min-height: 175px; padding: 24px; border: 1px solid var(--line); background: var(--surface); text-decoration: none; box-shadow: 4px 4px 0 var(--section-shadow); }
.route:hover { border-color: var(--signal); }
.route h2 { margin-bottom: 8px; }
.route p { color: var(--muted); font-size: .89rem; }
.route .arrow { justify-self: end; color: var(--signal); font-size: 1.4rem; }
.layout { display: grid; grid-template-columns: minmax(190px, 230px) minmax(0, 1fr); gap: clamp(30px, 5vw, 70px); }
.side { align-self: start; position: sticky; top: 105px; max-height: calc(100vh - 130px); overflow: auto; }
.side h2 { margin: 0 0 10px; font: 500 .67rem/1.3 var(--font-mono); text-transform: uppercase; color: var(--muted); letter-spacing: .07em; }
.side ul { margin: 0 0 25px; padding: 0; list-style: none; }
.side a { display: block; padding: 6px 0; font-size: .84rem; text-decoration: none; }
.side a[aria-current] { color: var(--signal); font-weight: 700; }
.side-mobile { display: none; }
.article { max-width: 790px; min-width: 0; }
.article .intro { margin-bottom: 32px; }
.block { padding: 22px 0; border-bottom: 1px solid var(--line); }
.block > :last-child { margin-bottom: 0; }
.block p, .block li { max-width: 72ch; }
.block p, .block ul, .block ol { margin-bottom: 13px; }
.block li + li { margin-top: 7px; }
.block code { padding: .1em .3em; background: var(--section); font: .88em/1.3 var(--font-mono); overflow-wrap: anywhere; }
.block pre { overflow: auto; padding: 18px; background: var(--section); border: 1px solid var(--line); font-size: .8rem; }
.block pre code { padding: 0; }
.block details { margin-top: 16px; padding: 14px 16px; border: 1px solid var(--line); background: var(--panel); }
.block summary { cursor: pointer; font-weight: 600; }
.block details[open] > summary { margin-bottom: 12px; }
.block table { width: 100%; border-collapse: collapse; font-size: .84rem; }
.block td,.block th { padding: 12px 8px; border-bottom: 1px solid var(--line); text-align: left; }
.visual { display: grid; gap: 13px; padding: 20px; margin: 20px 0; border: 1px solid var(--line); background: var(--section); box-shadow: 4px 4px 0 var(--section-shadow); }
.visual__label { color: var(--muted); font: 500 .68rem/1.3 var(--font-mono); text-transform: uppercase; }
.flow { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,120px),1fr)); gap: 8px; }
.flow__step { display: grid; align-content: start; gap: 9px; min-width: 0; padding: 15px; background: var(--surface); border: 1px solid var(--line); }
.flow__step strong { font-size: .9rem; line-height: 1.25; }
.flow__step small { color: var(--muted); line-height: 1.35; }
.flow__step .folio { font-size: .63rem; }
.system-map { display: grid; gap: 14px; margin-top: 34px; padding: 20px; background: var(--section); border: 1px solid var(--line); box-shadow: 4px 4px 0 var(--section-shadow); }
.system-map__branches { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
.system-map__cell { min-width: 0; padding: 17px; background: var(--surface); border: 1px solid var(--line); }
.system-map__cell strong { display: block; margin-bottom: 5px; }
.system-map__cell p { margin: 0; color: var(--muted); font-size: .82rem; }
.system-map__result { border-left: 3px solid var(--signal); }
.changes { display: grid; gap: 20px; }
.change-day { padding: 20px; border: 1px solid var(--line); background: var(--surface); }
.change-day h2 { margin-bottom: 15px; }
.change { padding: 13px 0; border-top: 1px solid var(--line); }
.change__category { display: inline-block; margin-right: 8px; color: var(--signal); font: .67rem var(--font-mono); text-transform: uppercase; }
.change p { margin: 6px 0 0; font-size: .91rem; }
.change a { color: var(--muted); font-size: .75rem; }
.footer { padding: 32px 0; border-top: 1px solid var(--line); color: var(--muted); font-size: .75rem; }
@media (max-width: 900px) {
  .site-header__inner { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 8px; }
  .topnav { display: none; }
  .mobile-menu { display: block; grid-column: 2; grid-row: 1; }
  .mobile-menu summary { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid var(--line); border-radius: 3px; background: var(--panel); cursor: pointer; list-style: none; }
  .mobile-menu summary::-webkit-details-marker { display: none; }
  .menu-icon, .menu-icon::before, .menu-icon::after { display: block; width: 20px; height: 2px; background: var(--ink); }
  .menu-icon { position: relative; }
  .menu-icon::before, .menu-icon::after { content: ""; position: absolute; left: 0; }
  .menu-icon::before { top: -6px; } .menu-icon::after { top: 6px; }
  .mobile-menu[open] .menu-icon { background: transparent; }
  .mobile-menu[open] .menu-icon::before { top: 0; transform: rotate(45deg); }
  .mobile-menu[open] .menu-icon::after { top: 0; transform: rotate(-45deg); }
  .mobile-menu nav { position: absolute; top: calc(100% - 1px); left: 0; right: 0; display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 2px 12px; padding: 14px; border: 1px solid var(--line); background: var(--surface); box-shadow: 4px 4px 0 var(--section-shadow); }
  .mobile-menu nav a { display: flex; align-items: center; min-height: 44px; padding: 8px 12px; font-weight: 600; text-decoration: none; }
  .mobile-menu nav a[aria-current] { color: var(--signal); border-left: 2px solid var(--signal); }
  .actions { grid-column: 3; grid-row: 1; margin-left: 0; justify-self: end; }
}
@media (max-width: 800px) { .layout { grid-template-columns: 1fr; } .side { display: none; } .side-mobile { display: block; padding: 10px 14px; border: 1px solid var(--line); background: var(--panel); } .side-mobile summary { min-height: 44px; align-content: center; cursor: pointer; font-weight: 600; } .side-mobile nav { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; padding: 14px 0; } .side-mobile h2 { font: 500 .68rem var(--font-mono); color: var(--muted); text-transform: uppercase; } .side-mobile ul { margin: 0; padding: 0; list-style: none; } .side-mobile a { display: block; min-height: 38px; padding: 8px 0; text-decoration: none; } .side-mobile a[aria-current] { color: var(--signal); font-weight: 700; } }
@media (max-width: 580px) { .frame { width: min(100% - 28px, 1180px); } .site-header__inner { gap: 6px; } .brand { gap: 6px; font-size: 1rem; } .brand img { width: 34px; height: 34px; } .actions { gap: 4px; } .mobile-menu nav { grid-template-columns: 1fr; } .sections, .system-map__branches { grid-template-columns: 1fr; } .route { min-height: 135px; padding: 18px; } .side-mobile nav { grid-template-columns: 1fr; } .flow { grid-template-columns: 1fr 1fr; } .flow__step { min-height: 98px; } .page { padding-top: 32px; } .visual { padding: 14px; } }
@media (max-width: 360px) { .brand { font-size: .86rem; } .brand img { width: 30px; height: 30px; } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
`;
