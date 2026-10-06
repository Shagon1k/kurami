import type {ThemeVariant} from "../tokens/index.ts";

// Neon: the Kurami fox as a red neon sign. Red marks the sign (fox, lead frames, headings, the main
// action); a calm warm yellow marks data and selection. Statuses stay quiet, information stays neutral.
// Dark only for now; the light mode can be added under `modes.light` later.
// `red` is the sign (outlines, frames, glow); `fill` is the same red deep enough for white text (4.87:1).
const red="#ff2e4d",fill="#e01238",yellow="#ffd84a";
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
    "panel-cut":"polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px))",
    "panel-glow":`drop-shadow(0 0 1px ${red}) drop-shadow(0 0 14px ${red}88)`,
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
    "chart-1":yellow,"chart-2":red,"chart-3":"#6fdba6","chart-4":"#e4dee8","chart-5":"#a69dae",
    "diagram-surface":"#100e16","diagram-panel":"#16131e","diagram-ink":"#f6f1f4","diagram-muted":"#a69dae","diagram-accent":red,"diagram-accent-soft":"#2b0c15","diagram-success":"#6fdba6","diagram-warning":"#ffb054",
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
@media (prefers-reduced-motion: no-preference) {
  ${N} .site-brand__fox { animation: kurami-neon-ignite 1.4s steps(1, end); }
}
@keyframes kurami-neon-ignite {
  0%, 8%, 16%, 30% { filter: none; opacity: .65; }
  4%, 12%, 24%, 100% { filter: drop-shadow(1px 0 0 ${red}) drop-shadow(-1px 0 0 ${red}) drop-shadow(0 1px 0 ${red}) drop-shadow(0 -1px 0 ${red}) drop-shadow(0 0 9px ${red}); opacity: 1; }
}
`;
