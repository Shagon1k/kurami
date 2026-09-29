import {breakpoints} from "../tokens/index.ts";
import {FONT_FACES} from "./fonts.ts";

export {fontFiles} from "./fonts.ts";

// Base every Kurami page starts from. Sites set --container-max; product layouts stay in the product.
export const FOUNDATION_CSS=`${FONT_FACES}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-behavior: smooth; }
body { margin: 0; color: var(--text-primary); background: var(--surface-page); font: 400 16px/1.5 var(--font-sans); text-rendering: optimizeLegibility; }
a { color: inherit; }
button { font: inherit; }
button, a { -webkit-tap-highlight-color: transparent; }
:where(a, button, summary, input, select, textarea, [tabindex]:not([tabindex="-1"])):focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 3px; }
.container { width: min(var(--container-max, 1180px), calc(100% - 48px)); margin-inline: auto; }
.skip-link { position: fixed; left: 16px; top: -80px; z-index: 50; padding: 10px 14px; color: var(--text-on-accent); background: var(--accent-primary); }
.skip-link:focus { top: 16px; }
.sr-only { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
@media (max-width: ${breakpoints.phone}px) { .container { width: min(100% - 28px, var(--container-max, 1180px)); } }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
`;
