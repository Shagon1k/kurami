import {breakpoints,type ThemeVariant} from "../tokens/index.ts";

// Neon: the Kurami fox as a red neon sign, with three colours by rank. Red is the sign: the fox, lead
// frames, headings, the main action and links. Yellow is second: data, selection, secondary actions and
// press feedback. Blue is third: information and quiet controls. Statuses keep their meaning.
// Dark is Neon's identity; the light mode keeps the roles in deep tones on a cool daylight ground (amber
// for yellow, which is unreadable on light surfaces).
// `red` is the sign (outlines, frames, glow); `fill` is the same red deep enough for white text (4.82:1).
const red="#ff2233",fill="#e3101f",yellow="#ffd23f",amber="#855b00",blue="#4da3ff",deepBlue="#1d5fbf";
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
    "text-accent":"#ff5c5c",
    "text-on-accent":"#ffffff",
    "border-default":"#352c40",
    "border-subtle":"#241e2d",
    "accent-primary":fill,
    "accent-soft":"#2a0a0e",
    "accent-data":yellow,
    "status-success":"#6fdba6",
    "status-info":blue,
    "status-warning":"#ffb054",
    "status-failure":"#ff5c5c",
    "shadow-offset":"#000000",
    "focus-ring":yellow,
    // chart-4 is the single-series default (Paper's data gold), so one-line charts and bars are yellow;
    // multi-series charts start from blue, then red.
    "chart-1":blue,"chart-2":"#ff5c5c","chart-3":"#6fdba6","chart-4":yellow,"chart-5":"#a69dae",
    "project-blue":blue,"project-teal":"#2ee6d6","project-green":"#5cff8a","project-violet":"#b47cff","project-pink":"#ff5cc8","project-gold":yellow,
    "diagram-surface":"#100e16","diagram-panel":"#16131e","diagram-ink":"#f6f1f4","diagram-muted":"#a69dae","diagram-accent":red,"diagram-accent-soft":"#2a0a0e","diagram-success":"#6fdba6","diagram-warning":"#ffb054",
  }},
  light:{colorScheme:"light",colors:{
    "surface-page":"#f6f4fa",
    "surface-panel":"#ffffff",
    "surface-raised":"#ffffff",
    "surface-section":"#eeebf4",
    "text-primary":"#16121f",
    "text-muted":"#5d566b",
    "text-accent":"#c0141c",
    "text-on-accent":"#ffffff",
    "border-default":"#d6d0e0",
    "border-subtle":"#e6e2ee",
    "accent-primary":fill,
    "accent-soft":"#ffe8e8",
    "accent-data":amber,
    "status-success":"#0f7343",
    "status-info":deepBlue,
    "status-warning":"#9a5200",
    "status-failure":"#c0141c",
    "shadow-offset":"#d6d0e0",
    "focus-ring":fill,
    "chart-1":deepBlue,"chart-2":fill,"chart-3":"#0f7343","chart-4":"#b87d00","chart-5":"#8b84a0",
    "project-blue":deepBlue,"project-teal":"#0b7c78","project-green":"#1f7a2e","project-violet":"#6b3fc7","project-pink":"#b8237f","project-gold":amber,
    "diagram-surface":"#ffffff","diagram-panel":"#f6f4fa","diagram-ink":"#16121f","diagram-muted":"#5d566b","diagram-accent":fill,"diagram-accent-soft":"#ffe8e8","diagram-success":"#0f7343","diagram-warning":"#9a5200",
  },scale:{
    "display-glow":`0 0 14px ${red}40`,
    "panel-glow":`0 0 0 1px ${fill}, 0 6px 22px -8px ${red}66`,
    "shadow-raised":"0 10px 28px #2a1f3d26, 0 0 0 1px var(--border-default)",
  }}},
};

const N='html[data-kurami-theme="neon"]';
/**
 * Neon dressing for library parts that a token cannot express: the page ground, the header sign, the
 * fox, display type, buttons, panel marks and motion. Every rule is scoped to Neon, so Paper is untouched.
 * `--neon-sign`, `--neon-volt` and `--neon-blue` are the three ranks in the current mode.
 */
export const NEON_CSS=`
${N} [class*="project-color--"] { --project-edge: inset 3px 0 0 var(--project-color), inset 14px 0 16px -14px var(--project-color); }
${N} { --neon-sign: ${red}; --neon-volt: var(--accent-data); --neon-blue: var(--status-info); }
${N}[data-theme="light"] { --neon-sign: ${fill}; }
${N} body { isolation: isolate; background: var(--surface-page); }
/* The ground: fine scan lines with a red glow from the top right and a blue one from the bottom left. */
${N} body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; background:
  repeating-linear-gradient(0deg, #ffffff07 0 1px, transparent 1px 4px),
  radial-gradient(48rem 28rem at 105% -5%, ${red}26, transparent 62%),
  radial-gradient(44rem 26rem at -5% 105%, ${blue}1c, transparent 62%); }
${N}[data-theme="light"] body::before { background:
  repeating-linear-gradient(0deg, #2a1f3d06 0 1px, transparent 1px 4px),
  radial-gradient(48rem 28rem at 105% -5%, ${red}14, transparent 62%),
  radial-gradient(44rem 26rem at -5% 105%, ${deepBlue}12, transparent 62%); }

/* Header: the sign. The fox is drawn as neon tubes; Paper keeps the original mark. */
${N} .site-header { background: color-mix(in srgb, var(--surface-page) 88%, transparent); border-bottom-color: transparent; }
${N} .site-header::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: linear-gradient(90deg, transparent, ${red}, transparent); opacity: .75; pointer-events: none; }
@media (max-width: ${breakpoints.phone}px) { ${N} .site-header:has([data-mobile-navigation]) { background: transparent; } }
${N} img.site-brand__fox { display: none; }
${N} .site-brand__fox--neon { display: block; filter: none; }
${N} .site-brand__name { font-family: var(--font-display); font-weight: 800; text-transform: var(--display-case); letter-spacing: var(--display-tracking); }
${N} .site-brand__dot { color: var(--neon-sign); text-shadow: 0 0 8px ${red}; }
${N} .site-brand:hover .site-brand__name { color: var(--text-primary); text-shadow: 0 0 14px ${red}aa; }
${N} .page-title { font-family: var(--font-display); font-weight: 800; text-transform: var(--display-case); letter-spacing: var(--display-tracking); text-shadow: var(--display-glow); }
${N} .page-eyebrow { color: var(--accent-data); letter-spacing: .14em; }
${N} .site-nav__link[aria-current]::after { box-shadow: 0 0 10px ${red}; }
${N}[data-theme="light"] .site-header::after { opacity: .55; }
${N}[data-theme="light"] .site-brand__dot, ${N}[data-theme="light"] .site-nav__link[aria-current]::after { text-shadow: none; box-shadow: 0 0 8px ${red}66; }
${N}[data-theme="light"] .page-title { color: var(--text-primary); }

/* Buttons by rank: the main action is the red sign, secondary actions are yellow, quiet controls light up
   blue, a chosen toggle is yellow. */
${N} .button--primary { filter: drop-shadow(0 0 10px ${red}88); }
${N} .button--primary:hover:not(:disabled):not([aria-busy="true"]) { color: #fff; background: #c80d1a; border-color: #c80d1a; filter: drop-shadow(0 0 16px ${red}cc); }
${N} .button--secondary { color: var(--neon-volt); background: color-mix(in srgb, var(--neon-volt) 6%, transparent); border-color: color-mix(in srgb, var(--neon-volt) 60%, transparent); box-shadow: 0 0 12px -5px var(--neon-volt); }
${N} .button--secondary:hover:not(:disabled):not([aria-busy="true"]) { color: var(--neon-volt); background: color-mix(in srgb, var(--neon-volt) 14%, transparent); border-color: var(--neon-volt); box-shadow: 0 0 16px -4px var(--neon-volt); }
${N} :is(.button--subtle, .button--icon, .button--quiet):not([aria-pressed="true"]) { border-color: color-mix(in srgb, var(--neon-blue) 32%, var(--border-default)); }
${N} :is(.button--subtle, .button--icon, .button--quiet, .button--toggle):hover:not(:disabled):not([aria-busy="true"]):not([aria-pressed="true"]):not([aria-current="true"]) { color: var(--text-primary); background: color-mix(in srgb, var(--neon-blue) 10%, var(--surface-raised)); border-color: var(--neon-blue); box-shadow: 0 0 12px -4px var(--neon-blue); }
${N} :is(.button--toggle[aria-pressed="true"], .button--toggle[aria-current="true"], .period-switch__option[aria-pressed="true"]), ${N} :is(.button--toggle[aria-pressed="true"], .button--toggle[aria-current="true"], .period-switch__option[aria-pressed="true"]):hover:not(:disabled):not([aria-busy="true"]) { color: var(--neon-volt); background: color-mix(in srgb, var(--neon-volt) 10%, var(--surface-raised)); border-color: var(--neon-volt); box-shadow: 0 0 12px -5px var(--neon-volt); }
${N} .button:active:not(:disabled):not([aria-busy="true"]) { filter: brightness(1.25); }
/* Press: a ring spreads from the finger inside the pressed control (the runtime adds .ui-ripple). */
${N} .ui-ripple { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; pointer-events: none; }
${N} .ui-ripple > span { --ripple-scale: 14; position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border: 2px solid var(--neon-volt); border-radius: 50%; box-shadow: 0 0 12px var(--neon-volt); animation: kurami-neon-ripple .5s ease-out forwards; }
@keyframes kurami-neon-ripple { to { transform: scale(var(--ripple-scale)); opacity: 0; } }
/* Loading: a yellow charge runs along the bottom edge while a button is busy. */
${N} .button[aria-busy="true"]::before { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: linear-gradient(90deg, transparent, var(--neon-volt), transparent) no-repeat; background-size: 40% 100%; box-shadow: 0 2px 10px -2px var(--neon-volt); animation: kurami-neon-charge 1.1s linear infinite; pointer-events: none; }
@keyframes kurami-neon-charge { from { background-position: -60% 0; } to { background-position: 160% 0; } }

${N} .ui-popover { box-shadow: 0 18px 40px #000c, 0 0 0 1px ${red}55, 0 0 22px -6px ${red}88; }
${N}[data-theme="light"] .ui-popover { box-shadow: 0 18px 40px #2a1f3d33, 0 0 0 1px ${fill}55; }
/* A menu shown inline (the theme menu in the phone settings sheet) is part of the sheet, not a second frame. */
${N} [data-mobile-slot] .ui-popover { box-shadow: none; }
${N} .mobile-navigation__bar { box-shadow: 0 0 0 1px ${red}40, 0 0 24px -10px ${red}aa, 0 18px 40px #000c; }
${N}[data-theme="light"] .mobile-navigation__bar { box-shadow: 0 0 0 1px ${fill}33, 0 12px 30px #2a1f3d33; }
${N}[data-theme="light"] .button--primary { filter: drop-shadow(0 4px 10px ${red}55); }
${N}[data-theme="light"] [data-ui-surface="lead"] { background: var(--surface-panel); }
${N}[data-theme="light"] .chart__series polyline, ${N}[data-theme="light"] .sparkline polyline { filter: none; }

/* Surfaces: two bevelled corners where the browser supports corner-shape, rounded corners elsewhere. */
${N} :is([data-ui-surface], .stat-card:not(.stat-card--plain), .callout, .dialog, .theme-menu__panel) { border-radius: var(--radius-md); }
@supports (corner-shape: bevel) {
  ${N} :is([data-ui-surface], .stat-card:not(.stat-card--plain), .callout, .dialog) { border-radius: 0 var(--panel-cut) 0 var(--panel-cut); corner-shape: bevel; }
}
${N} [data-ui-surface="panel"], ${N} .stat-card:not(.stat-card--plain) { position: relative; border-color: var(--border-default); background: var(--surface-panel); box-shadow: 0 10px 30px -20px ${red}66; }
${N}[data-theme="light"] [data-ui-surface="panel"], ${N}[data-theme="light"] .stat-card:not(.stat-card--plain) { box-shadow: 0 8px 24px -18px #2a1f3d55; }
/* A lit segment on the top edge: red on panels, yellow on figure cards. */
${N} :is([data-ui-surface="panel"], .stat-card:not(.stat-card--plain))::after { content: ""; position: absolute; left: 18px; top: -1px; width: 56px; height: 2px; background: var(--neon-sign); box-shadow: 0 0 10px var(--neon-sign); pointer-events: none; }
${N} .stat-card:not(.stat-card--plain)::after { width: 32px; background: var(--neon-volt); box-shadow: 0 0 10px var(--neon-volt); }
${N} .ui-gauge > .stat-card::after { content: none; }
${N} [data-ui-surface="lead"] { border-color: var(--neon-sign); background: linear-gradient(135deg, color-mix(in srgb, ${red} 9%, var(--surface-panel)), var(--surface-panel) 45%); box-shadow: var(--panel-glow); }
/* Display type for section and panel titles only; content headings (news, tasks) keep the text face.
   Section titles carry a red "//"; a title that starts with its own icon lights the icon instead. */
${N} :is(.section-heading, [data-ui-surface]) h2, ${N} [data-ui-surface="panel"] > h3, ${N} [data-ui-surface="panel"] > .panel-heading h3 { font-family: var(--font-display); text-transform: var(--display-case); letter-spacing: .03em; }
${N} :is(.section-heading, [data-ui-surface]) h2:not(:has(> svg:first-child, > .ui-icon:first-child))::before { content: "// "; font-size: .78em; color: var(--neon-sign); text-shadow: 0 0 10px ${red}; }
${N} :is(.section-heading, [data-ui-surface]) h2 > :is(svg, .ui-icon):first-child { color: var(--neon-sign); filter: drop-shadow(0 0 6px ${red}); }
${N}[data-theme="light"] :is(.section-heading, [data-ui-surface]) h2::before { text-shadow: none; }
${N}[data-theme="light"] :is(.section-heading, [data-ui-surface]) h2 > :is(svg, .ui-icon):first-child { filter: none; }

/* Figures: display face; plain figures are white, statuses keep their colour. */
${N} .stat-card[data-tone="accent"], ${N} .stat-card[data-tone="info"], ${N} .stat-card[data-tone="neutral"] { --stat-tone: var(--text-primary); }
${N} :is(.stat-card__value, [data-ui-figure]) { font-family: var(--font-display); font-weight: 700; letter-spacing: 0; }

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
${N} .pill { font-weight: 600; box-shadow: 0 0 10px -4px currentColor; }
${N} .chart__series polyline { stroke-width: 2.5; filter: drop-shadow(0 0 5px var(--chart-color)); }
${N} .chart__area { display: inline; fill: var(--chart-color); fill-opacity: .16; }
${N} .chart__series:not(.chart__series--1) .chart__area { fill-opacity: .06; }
${N} .sparkline polyline { filter: drop-shadow(0 0 3px currentColor); }

/* Motion, never with reduced motion: the fox ignites, lead blocks that need the owner pulse, a figure
   that changed on refresh flashes yellow, the app name glitches when arriving from another app. */
@media (prefers-reduced-motion: no-preference) {
  /* The fox lights up on load, then every few seconds its glow swells and fades like a sign. */
  ${N} .site-brand__fox { animation: kurami-neon-ignite 1.4s steps(1, end), kurami-neon-breathe 7s ease-in-out 2s infinite; }
  ${N} [data-ui-surface="lead"][data-ui-attention] { animation: kurami-neon-pulse 3.2s ease-in-out infinite; }
  ${N} .ui-figure-blip { animation: kurami-neon-blip .9s ease-out; }
  ${N} .site-brand__name.ui-glitch { animation: kurami-neon-glitch .55s steps(2, end); }
}
@media (prefers-reduced-motion: reduce) { ${N} .ui-ripple { display: none; } ${N} .button[aria-busy="true"]::before { animation: none; background-size: 100% 100%; } }
@keyframes kurami-neon-ignite { 0%, 8%, 16%, 30% { opacity: .35; filter: saturate(.3); } 4%, 12%, 24%, 100% { opacity: 1; filter: none; } }
@keyframes kurami-neon-breathe { 0%, 62%, 100% { filter: none; } 80% { filter: drop-shadow(0 0 2px ${red}cc) drop-shadow(0 0 9px ${red}99); } }
@keyframes kurami-neon-pulse { 0%, 100% { box-shadow: var(--panel-glow); } 50% { box-shadow: 0 0 0 1px ${red}, 0 0 30px ${red}cc, inset 0 0 26px -10px ${red}aa; } }
@keyframes kurami-neon-blip { 0% { color: var(--neon-volt); text-shadow: 0 0 18px var(--neon-volt); transform: translateX(2px); } 12% { transform: translateX(-2px); } 24% { transform: none; } 100% { text-shadow: none; } }
@keyframes kurami-neon-glitch {
  0% { text-shadow: 3px 0 ${red}, -3px 0 ${yellow}; transform: translateX(2px); clip-path: inset(10% 0 55% 0); }
  25% { text-shadow: -4px 0 ${red}, 4px 0 ${yellow}; transform: translateX(-3px); clip-path: inset(50% 0 10% 0); }
  50% { text-shadow: 2px 0 ${yellow}, -2px 0 ${red}; transform: translateX(1px); clip-path: inset(25% 0 35% 0); }
  100% { text-shadow: none; transform: none; clip-path: none; }
}
`;
