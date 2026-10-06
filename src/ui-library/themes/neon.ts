import type {ThemeVariant} from "../tokens/index.ts";

// Neon: the Kurami fox as a red neon sign. Red marks the sign (fox, lead frames, headings, the main
// action); a calm warm yellow marks data and selection. Statuses stay quiet, information stays neutral.
// Dark is Neon's identity; the light mode keeps the red sign on a cool daylight ground, with a deep amber
// in place of yellow (yellow is unreadable on light surfaces).
// `red` is the sign (outlines, frames, glow); `fill` is the same red deep enough for white text (4.87:1).
const red="#ff2e4d",fill="#e01238",yellow="#ffd84a",amber="#b87d00";
export const neonTheme:ThemeVariant={
  name:"neon",
  label:"Neon",
  scale:{
    "font-sans":'"Onest", system-ui, -apple-system, "Segoe UI", sans-serif',
    "font-mono":'"Fragment Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    "font-note":'"Caveat", "Segoe Print", cursive',
    "font-display":'"Tektur", "Onest", system-ui, sans-serif',
    "display-case":"uppercase","display-tracking":".01em",
    "display-glow":`0 0 2px #fff6, 0 0 18px ${red}99, 0 0 42px ${red}55`,
    "panel-cut":"14px",
    "panel-glow":`0 0 0 1px ${red}, 0 0 18px ${red}88, inset 0 0 22px -12px ${red}88`,
    "radius-sm":"4px","radius":"6px","radius-md":"8px","radius-pill":"999px",
    "shadow-card":"inset 0 0 0 1px var(--border-default)",
    "shadow-card-sm":"inset 0 0 0 1px var(--border-default)",
    "shadow-raised":"0 10px 30px #000a, 0 0 0 1px var(--border-default)",
    "duration-fast":"150ms","duration-base":"220ms",
    "control-height":"36px",
    "space-1":"4px","space-2":"8px","space-3":"12px","space-4":"16px","space-5":"20px","space-6":"24px","space-8":"32px","space-10":"40px",
  },
  modes:{dark:{colorScheme:"dark",colors:{
    "surface-page":"#07060b",
    "surface-panel":"#100e16",
    "surface-raised":"#16131e",
    "surface-section":"#1c1826",
    "text-primary":"#f6f1f4",
    "text-muted":"#a69dae",
    "text-accent":"#ff6b80",
    "text-on-accent":"#ffffff",
    "border-default":"#3b3247",
    "border-subtle":"#2a2433",
    "accent-primary":fill,
    "accent-soft":"#2b0c15",
    "accent-data":yellow,
    "status-success":"#6fdba6",
    "status-info":"#e4dee8",
    "status-warning":"#ffb054",
    "status-failure":"#ff7482",
    "shadow-offset":"#000000",
    "focus-ring":yellow,
    // chart-4 is the single-series default (Paper's data gold), so one-line charts and bars are yellow;
    // multi-series charts and sparklines start from neutral white.
    "chart-1":"#e4dee8","chart-2":"#ff6b80","chart-3":"#6fdba6","chart-4":yellow,"chart-5":"#a69dae",
    "diagram-surface":"#100e16","diagram-panel":"#16131e","diagram-ink":"#f6f1f4","diagram-muted":"#a69dae","diagram-accent":red,"diagram-accent-soft":"#2b0c15","diagram-success":"#6fdba6","diagram-warning":"#ffb054",
  }},
  light:{colorScheme:"light",colors:{
    "surface-page":"#f6f4fa",
    "surface-panel":"#ffffff",
    "surface-raised":"#ffffff",
    "surface-section":"#eeebf4",
    "text-primary":"#16121f",
    "text-muted":"#5d566b",
    "text-accent":"#c4102f",
    "text-on-accent":"#ffffff",
    "border-default":"#d6d0e0",
    "border-subtle":"#e6e2ee",
    "accent-primary":fill,
    "accent-soft":"#ffe8ec",
    "accent-data":"#855b00",
    "status-success":"#0f7343",
    "status-info":"#3f3a4d",
    "status-warning":"#9a5200",
    "status-failure":"#c4102f",
    "shadow-offset":"#d6d0e0",
    "focus-ring":fill,
    "chart-1":"#3f3a4d","chart-2":fill,"chart-3":"#0f7343","chart-4":amber,"chart-5":"#8b84a0",
    "diagram-surface":"#ffffff","diagram-panel":"#f6f4fa","diagram-ink":"#16121f","diagram-muted":"#5d566b","diagram-accent":fill,"diagram-accent-soft":"#ffe8ec","diagram-success":"#0f7343","diagram-warning":"#9a5200",
  },scale:{
    "display-glow":`0 0 14px ${red}40`,
    "panel-glow":`0 0 0 1px ${fill}, 0 6px 22px -8px ${red}66`,
    "shadow-raised":"0 10px 28px #2a1f3d26, 0 0 0 1px var(--border-default)",
  }}},
};

const N='html[data-kurami-theme="neon"]';
/**
 * Neon dressing for library parts that a token cannot express: the page ground, the header sign, the
 * fox outline, display type and the main action. Every rule is scoped to Neon, so Paper is untouched.
 */
export const NEON_CSS=`
${N} body { isolation: isolate; background: var(--surface-page); }
${N} body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; background:
  radial-gradient(circle at 1px 1px, #ffffff10 1px, transparent 0) 0 0/22px 22px,
  radial-gradient(48rem 28rem at 105% -5%, ${red}22, transparent 62%),
  radial-gradient(44rem 26rem at -5% 105%, ${yellow}14, transparent 62%); }
${N} .site-header { background: color-mix(in srgb, var(--surface-page) 88%, transparent); border-bottom-color: transparent; }
${N} .site-header::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: linear-gradient(90deg, transparent, ${red}, transparent); opacity: .75; pointer-events: none; }
${N} .site-brand__fox { filter: drop-shadow(1px 0 0 ${red}) drop-shadow(-1px 0 0 ${red}) drop-shadow(0 1px 0 ${red}) drop-shadow(0 -1px 0 ${red}) drop-shadow(0 0 9px ${red}); }
${N} .site-brand__name { font-family: var(--font-display); font-weight: 800; text-transform: var(--display-case); letter-spacing: var(--display-tracking); }
${N} .site-brand__dot { text-shadow: 0 0 8px ${red}; }
${N} .site-brand:hover .site-brand__name { color: var(--text-primary); text-shadow: 0 0 14px ${red}aa; }
${N} .page-title { font-family: var(--font-display); font-weight: 800; text-transform: var(--display-case); letter-spacing: var(--display-tracking); text-shadow: var(--display-glow); }
${N} .page-eyebrow { color: var(--accent-data); letter-spacing: .14em; }
${N} .site-nav__link[aria-current]::after { box-shadow: 0 0 10px ${red}; }
${N} .button--primary { filter: drop-shadow(0 0 10px ${red}88); }
${N} .button--primary:hover:not(:disabled):not([aria-busy="true"]) { color: #fff; background: #c80f31; border-color: #c80f31; filter: drop-shadow(0 0 16px ${red}cc); }
${N} .button:active:not(:disabled):not([aria-busy="true"]) { filter: brightness(1.3); }
${N} .ui-popover { box-shadow: 0 18px 40px #000c, 0 0 0 1px ${red}55, 0 0 22px -6px ${red}88; }
/* Light mode: dark dots on daylight, softer glows, the sign red stays. */
${N}[data-theme="light"] body::before { background:
  radial-gradient(circle at 1px 1px, #2a1f3d14 1px, transparent 0) 0 0/22px 22px,
  radial-gradient(48rem 28rem at 105% -5%, ${red}14, transparent 62%),
  radial-gradient(44rem 26rem at -5% 105%, ${amber}12, transparent 62%); }
${N}[data-theme="light"] .site-header::after { opacity: .55; }
${N}[data-theme="light"] .site-brand__dot, ${N}[data-theme="light"] .site-nav__link[aria-current]::after { text-shadow: none; box-shadow: 0 0 8px ${red}66; }
${N}[data-theme="light"] .page-title { color: var(--text-primary); }
${N}[data-theme="light"] .button--primary { filter: drop-shadow(0 4px 10px ${red}55); }
${N}[data-theme="light"] .ui-popover { box-shadow: 0 18px 40px #2a1f3d33, 0 0 0 1px ${fill}55; }
${N}[data-theme="light"] [data-ui-surface="lead"] { background: var(--surface-panel); }
${N}[data-theme="light"] .chart__series polyline, ${N}[data-theme="light"] .sparkline polyline { filter: none; }

/* Surfaces: two bevelled corners where the browser supports corner-shape, rounded corners elsewhere. */
${N} :is([data-ui-surface], .stat-card:not(.stat-card--plain), .callout, .dialog, .theme-menu__panel) { border-radius: var(--radius-md); }
@supports (corner-shape: bevel) {
  ${N} :is([data-ui-surface], .stat-card:not(.stat-card--plain), .callout, .dialog) { border-radius: 0 var(--panel-cut) 0 var(--panel-cut); corner-shape: bevel; }
}
${N} [data-ui-surface="panel"], ${N} .stat-card:not(.stat-card--plain) { border-color: var(--border-default); background: var(--surface-panel); box-shadow: none; }
${N} [data-ui-surface="lead"] { border-color: ${red}; background: linear-gradient(135deg, color-mix(in srgb, ${red} 9%, var(--surface-panel)), var(--surface-panel) 45%); box-shadow: var(--panel-glow); }
/* Display type for section and panel titles only; content headings (news, tasks) keep the text face. */
${N} :is(.section-heading, [data-ui-surface]) h2, ${N} [data-ui-surface="panel"] > h3, ${N} [data-ui-surface="panel"] > .panel-heading h3 { font-family: var(--font-display); text-transform: var(--display-case); letter-spacing: .03em; }

/* Figures: display face; plain figures are white, statuses keep their colour. */
${N} .stat-card[data-tone="accent"], ${N} .stat-card[data-tone="info"], ${N} .stat-card[data-tone="neutral"] { --stat-tone: var(--text-primary); }
${N} .stat-card__value { font-family: var(--font-display); font-weight: 700; letter-spacing: 0; }

/* Gauge: the meter becomes a ring around the value. */
${N} .ui-gauge { display: grid; grid-template-areas: "label" "ring"; justify-items: center; align-items: center; row-gap: var(--space-3); }
${N} .ui-gauge > .stat-card { display: contents; }
${N} .ui-gauge .stat-card__label { grid-area: label; margin: 0; }
${N} .ui-gauge .stat-card__value { grid-area: ring; position: relative; z-index: 1; font-size: 1.45rem; }
${N} .ui-gauge > .ui-meter { grid-area: ring; width: 112px; height: 112px; border-radius: 50%; overflow: visible; background: conic-gradient(var(--gauge-color, var(--text-primary)) var(--meter-fill), var(--border-default) 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 9px), #000 calc(100% - 8px)); mask: radial-gradient(farthest-side, transparent calc(100% - 9px), #000 calc(100% - 8px)); }
${N} .ui-gauge > .ui-meter > span { display: none; }
${N} .ui-gauge > .ui-meter:is([data-tone="warning"], [data-tone="failure"]) { --gauge-color: var(--stat-tone); }

/* Icons on plates, where a product marks them. */
${N} .ui-icon--tile { box-sizing: content-box; padding: 7px; border-radius: var(--radius); color: var(--icon-color, currentColor); background: color-mix(in srgb, currentColor 12%, var(--surface-raised)); box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 45%, transparent); }

/* Badges and charts. */
${N} .pill { font-weight: 600; }
${N} .chart__series polyline { stroke-width: 2.5; filter: drop-shadow(0 0 5px var(--chart-color)); }
${N} .chart__area { display: inline; fill: var(--chart-color); fill-opacity: .16; }
${N} .chart__series:not(.chart__series--1) .chart__area { fill-opacity: .06; }
${N} .sparkline polyline { filter: drop-shadow(0 0 3px currentColor); }

/* Attention: a slow pulse on lead blocks that need the owner. */
@media (prefers-reduced-motion: no-preference) {
  ${N} [data-ui-surface="lead"][data-ui-attention] { animation: kurami-neon-pulse 3.2s ease-in-out infinite; }
  ${N} .ui-live-scan { position: relative; }
  ${N} .ui-live-scan::after { content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit; mix-blend-mode: screen;
    background: linear-gradient(180deg, transparent 0, color-mix(in srgb, ${yellow} 16%, transparent) 70%, ${yellow} 99%, transparent 100%) no-repeat 0 -60%/100% 36%;
    animation: kurami-neon-scan 1.1s ease-in-out forwards; }
  ${N} .site-brand__name.ui-glitch { animation: kurami-neon-glitch .55s steps(2, end); }
}
@keyframes kurami-neon-pulse { 0%, 100% { box-shadow: var(--panel-glow); } 50% { box-shadow: 0 0 0 1px ${red}, 0 0 30px ${red}cc, inset 0 0 26px -10px ${red}aa; } }
@keyframes kurami-neon-scan { to { background-position: 0 160%; } }
@keyframes kurami-neon-glitch {
  0% { text-shadow: 3px 0 ${red}, -3px 0 ${yellow}; transform: translateX(2px); clip-path: inset(10% 0 55% 0); }
  25% { text-shadow: -4px 0 ${red}, 4px 0 ${yellow}; transform: translateX(-3px); clip-path: inset(50% 0 10% 0); }
  50% { text-shadow: 2px 0 ${yellow}, -2px 0 ${red}; transform: translateX(1px); clip-path: inset(25% 0 35% 0); }
  100% { text-shadow: none; transform: none; clip-path: none; }
}
@media (prefers-reduced-motion: no-preference) {
  ${N} .site-brand__fox { animation: kurami-neon-ignite 1.4s steps(1, end); }
}
@keyframes kurami-neon-ignite {
  0%, 8%, 16%, 30% { filter: none; opacity: .65; }
  4%, 12%, 24%, 100% { filter: drop-shadow(1px 0 0 ${red}) drop-shadow(-1px 0 0 ${red}) drop-shadow(0 1px 0 ${red}) drop-shadow(0 -1px 0 ${red}) drop-shadow(0 0 9px ${red}); opacity: 1; }
}
`;
