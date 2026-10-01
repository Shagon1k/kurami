import {breakpoints} from "../tokens/index.ts";
import {FONT_FACES} from "./fonts.ts";
import {SITE_FOOTER_CSS} from "../patterns/site-footer.ts";

export {fontFiles} from "./fonts.ts";

// Base every Kurami page starts from. Sites set --container-max; product layouts stay in the product.
export const FOUNDATION_CSS=`${FONT_FACES}${SITE_FOOTER_CSS}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-behavior: smooth; }
body { margin: 0; color: var(--text-primary); background: var(--surface-page); font: 400 16px/1.5 var(--font-sans); text-rendering: optimizeLegibility; }
a { color: inherit; }
.list-reset { list-style: none; margin: 0; padding: 0; }
button { font: inherit; }
button, a { -webkit-tap-highlight-color: transparent; }
:where(a, button, summary, input, select, textarea, [tabindex]:not([tabindex="-1"])):focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 3px; }
.container { width: min(var(--container-max, 1180px), calc(100% - 48px)); margin-inline: auto; }
.skip-link { position: fixed; left: 16px; top: -80px; z-index: 50; padding: 10px 14px; color: var(--text-on-accent); background: var(--accent-primary); }
.skip-link:focus { top: 16px; }
.sr-only { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
.page-title,h1.page-title { max-width: 24ch; margin: 0 0 var(--space-4); font: 600 clamp(2rem,5vw,3.6rem)/1.08 var(--font-sans); letter-spacing: -.045em; overflow-wrap: anywhere; }
.page-subtitle { max-width: 62ch; margin: 0; color: var(--text-muted); font: 400 clamp(1rem,1.8vw,1.25rem)/1.5 var(--font-sans); }
.page-eyebrow { margin: 0 0 var(--space-3); color: var(--text-muted); font: 400 .7rem/1.4 var(--font-mono); letter-spacing: .07em; text-transform: uppercase; }
@media (max-width: ${breakpoints.phone}px) { .container { width: min(100% - 28px, var(--container-max, 1180px)); } }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
`;
