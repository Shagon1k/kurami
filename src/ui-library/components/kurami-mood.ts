// Kurami herself (not the fox logo): twelve illustrated states that tell how things are at a glance —
// calm, working, asleep, offline, done, peeking, celebrating, pointing at a problem, thinking, waiting for
// the owner, found a problem, welcome. One 320 px WebP each (sharp at 2× for the 88 px medallion and its rising head), served by every app
// under /assets/kurami-<mood>.webp from src/ui-library/assets/kurami. Loaded lazily; decorative unless a
// caller passes a label, since the text next to it always says the same thing. Lossless WebP at 320 px: lossy
// encoding turned the transparent background into a faint square.
import { readFileSync } from "node:fs";
import { escapeHtml } from "../foundations/html.ts";

export const KURAMI_MOODS = ["idle", "working", "asleep", "offline", "done", "peek", "celebrate", "alert", "thinking", "needs-decision", "found-problem", "welcome"] as const;
export type KuramiMood = typeof KURAMI_MOODS[number];

/** Flat names: the gateway serves an app's files only directly under /assets/. */
export const kuramiMoodPath = (mood: KuramiMood): string => `/assets/kurami-${mood}.webp`;

/** The files every app registers, so the mounted pages can load them from their own origin path. */
export function kuramiMoodAssets(): { path: string; body: Buffer }[] {
  return KURAMI_MOODS.map(mood => ({ path: kuramiMoodPath(mood), body: readFileSync(new URL(`../assets/kurami/${mood}.webp`, import.meta.url)) }));
}

/** Kurami in her medallion: a disc behind her, the figure cut only along the lower arc, everything above
 *  free to break out (ears, tails, a pointing hand). One size everywhere (--kurami-size), so she never
 *  seems to change height between screens. Paper draws the ring in ink; Neon lights it (KURAMI_MOOD_CSS). */
export function renderKuramiMood(input: { mood: KuramiMood; label?: string; className?: string; eager?: boolean }): string {
  if (!(KURAMI_MOODS as readonly string[]).includes(input.mood)) throw new Error("Unknown Kurami mood");
  const alt = input.label ? escapeHtml(input.label) : "";
  return `<span class="kurami-mood${input.className ? ` ${escapeHtml(input.className)}` : ""}" data-kurami-mood="${input.mood}"${alt ? ` role="img" aria-label="${alt}"` : ' aria-hidden="true"'}>`
    + `<svg class="kurami-mood__ring" viewBox="0 0 100 100" focusable="false"><circle class="kurami-mood__disc" cx="50" cy="50" r="48"/><circle class="kurami-mood__line" cx="50" cy="50" r="48" pathLength="100"/><circle class="kurami-mood__spark" cx="50" cy="50" r="48" pathLength="100"/></svg>`
    + `<img class="kurami-mood__figure" src="${kuramiMoodPath(input.mood)}" width="160" height="160" alt="" loading="${input.eager ? "eager" : "lazy"}" decoding="async"></span>`;
}

/** A whole-page or empty-section state: Kurami, a short heading and one line of what to do. */
export function renderKuramiState(input: { mood: KuramiMood; title: string; text?: string; action?: string; headingLevel?: 1 | 2 | 3 }): string {
  const level = input.headingLevel ?? 2;
  return `<div class="kurami-state" data-kurami-state="${input.mood}">${renderKuramiMood({ mood: input.mood, eager: true })}<div class="kurami-state__copy"><h${level}>${escapeHtml(input.title)}</h${level}>${input.text ? `<p>${escapeHtml(input.text)}</p>` : ""}${input.action ?? ""}</div></div>`;
}

/** Before first paint: Hub → Appearance can switch Kurami off for every app (the gateway's cookie). */
export const KURAMI_MASCOT_RUNTIME_JS = `document.documentElement.dataset.kuramiMascot=/(?:^|;\\s*)kurami-mascot=off(?:;|$)/.test(document.cookie)?"off":"on";`;

/** Pull-to-refresh for the installed app (a standalone window has no browser refresh gesture): at the top
 * of the page a pull brings Kurami peeking in from the top edge; releasing past the line refreshes —
 * in place where the app exposes window.kuramiRefresh (Hub, Projects), otherwise by reloading. */
export const KURAMI_PULL_REFRESH_JS = String.raw`(()=>{
  if(!matchMedia('(display-mode: standalone)').matches||!matchMedia('(pointer: coarse)').matches)return;
  const ru=document.documentElement.lang==='ru',trigger=80,limit=120;
  const src=typeof kuramiAppUrl==='function'?kuramiAppUrl('/assets/kurami-peek.webp'):'/assets/kurami-peek.webp';
  let startY=null,pull=0,panel=null,busy=false;
  const show=()=>{panel=document.createElement('div');panel.className='kurami-pull';panel.setAttribute('aria-hidden','true');
    panel.innerHTML='<img src="'+src+'" width="96" height="96" alt=""><span></span>';document.body.append(panel);};
  const text=()=>panel.querySelector('span').textContent=pull>=trigger?(ru?'Отпусти, чтобы обновить':'Release to refresh'):(ru?'Потяни ещё':'Keep pulling');
  const reset=()=>{panel?.remove();panel=null;pull=0;startY=null;};
  addEventListener('touchstart',event=>{
    if(busy||scrollY>0||event.touches.length!==1||event.target.closest('dialog[open],[popover],input,textarea,select,[data-no-pull]'))return;
    startY=event.touches[0].clientY;
  },{passive:true});
  addEventListener('touchmove',event=>{
    if(startY===null)return;
    const distance=event.touches[0].clientY-startY;
    if(distance<=0||scrollY>0){if(panel)reset();return;}
    pull=Math.min(limit,distance*.5);if(!panel)show();
    panel.style.setProperty('--pull',pull+'px');panel.classList.toggle('is-ready',pull>=trigger);text();
  },{passive:true});
  addEventListener('touchend',async()=>{
    if(!panel||pull<trigger){reset();return;}
    busy=true;panel.classList.add('is-refreshing');panel.querySelector('span').textContent=ru?'Обновляю…':'Refreshing…';
    try{if(typeof window.kuramiRefresh==='function')await window.kuramiRefresh();else{location.reload();return;}}finally{busy=false;reset();}
  });
})();`;

/* Geometry (all relative to --kurami-size, the disc's diameter): the figure is 1.25× the disc, its top
 * 0.1× above the disc, so the head and ears rise over the rim. The mask keeps everything above a line a
 * little below the disc's centre (fading over a few pixels, so tails crossing it leave no step) plus the
 * disc itself — the figure is cut only along the lower arc. */
export const KURAMI_MOOD_CSS = `
.kurami-mood { --kurami-size: 88px; --kurami-ring: color-mix(in srgb, var(--accent-primary) 45%, transparent); --kurami-disc: color-mix(in srgb, var(--accent-primary) 9%, var(--surface-panel));
  position: relative; display: block; flex: none; width: var(--kurami-size); height: var(--kurami-size); margin-top: calc(var(--kurami-size) * .14); user-select: none; }
.kurami-mood__ring { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.kurami-mood__disc { fill: var(--kurami-disc); }
.kurami-mood__line { fill: none; stroke: var(--kurami-ring); stroke-width: 1.6; }
.kurami-mood__spark { fill: none; stroke: none; }
.kurami-mood__figure { position: absolute; left: 50%; top: calc(var(--kurami-size) * -.1); width: calc(var(--kurami-size) * 1.25); height: calc(var(--kurami-size) * 1.25); max-width: none; translate: -50% 0; -webkit-user-drag: none;
  -webkit-mask-image: linear-gradient(#000 0 57%, transparent 63%), radial-gradient(40% 40% at 50% 48%, #000 99%, transparent 100%);
  mask-image: linear-gradient(#000 0 57%, transparent 63%), radial-gradient(40% 40% at 50% 48%, #000 99%, transparent 100%); }
html[data-kurami-theme="neon"] .kurami-mood { --kurami-ring: var(--neon-sign, var(--accent-primary)); --kurami-disc: color-mix(in srgb, var(--neon-sign, var(--accent-primary)) 7%, var(--surface-page)); }
html[data-kurami-theme="neon"] .kurami-mood__line { stroke-width: 1.8; filter: drop-shadow(0 0 2px var(--kurami-ring)) drop-shadow(0 0 6px var(--kurami-ring)); }
html[data-kurami-theme="neon"] .kurami-mood[data-kurami-mood="asleep"] { --kurami-ring: color-mix(in srgb, var(--neon-sign, var(--accent-primary)) 45%, transparent); }
.kurami-mood[data-kurami-mood="alert"] { --kurami-ring: var(--status-warning); }
html[data-kurami-theme="neon"] .kurami-mood[data-kurami-mood="alert"] { --kurami-ring: var(--neon-sign, var(--status-failure)); }

@media (prefers-reduced-motion: no-preference) {
  /* Paper: the ink ring draws itself, Kurami breathes; working, a pencil dash circles; alert, a short nudge. */
  .kurami-mood__line { stroke-dasharray: 100; animation: kurami-ink .9s ease-out both; }
  .kurami-mood__figure { animation: kurami-breathe 6s ease-in-out 1s infinite; }
  .kurami-mood[data-kurami-mood="working"] .kurami-mood__spark { stroke: var(--kurami-ring); stroke-width: 2.4; stroke-linecap: round; stroke-dasharray: 9 91; transform-origin: 50% 50%; animation: kurami-orbit 3.2s linear infinite; }
  .kurami-mood[data-kurami-mood="alert"] .kurami-mood__figure { animation: kurami-nudge 2.8s ease-in-out .6s infinite; }
  /* Neon: the ring flickers on, then breathes; faster and brighter on alert, slow and dim asleep. */
  html[data-kurami-theme="neon"] .kurami-mood__line { stroke-dasharray: none; animation: kurami-ignite 1.3s steps(1, end) both, kurami-glow 5s ease-in-out 1.3s infinite; }
  html[data-kurami-theme="neon"] .kurami-mood[data-kurami-mood="alert"] .kurami-mood__line { animation: kurami-ignite 1.3s steps(1, end) both, kurami-glow 1.4s ease-in-out 1.3s infinite; }
  html[data-kurami-theme="neon"] .kurami-mood[data-kurami-mood="asleep"] .kurami-mood__line { animation: kurami-glow 9s ease-in-out infinite; }
  html[data-kurami-theme="neon"] .kurami-mood[data-kurami-mood="working"] .kurami-mood__spark { stroke: #fff; filter: drop-shadow(0 0 3px var(--kurami-ring)) drop-shadow(0 0 8px var(--kurami-ring)); }
}
@keyframes kurami-ink { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes kurami-breathe { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1.5%); } }
@keyframes kurami-orbit { to { transform: rotate(360deg); } }
@keyframes kurami-nudge { 0%, 86%, 100% { transform: none; } 90% { transform: translateX(-2%); } 94% { transform: translateX(1.5%); } }
@keyframes kurami-ignite { 0% { opacity: .15; } 12% { opacity: 1; } 18% { opacity: .3; } 30% { opacity: 1; } 36% { opacity: .55; } 48%, 100% { opacity: 1; } }
@keyframes kurami-glow { 0%, 100% { filter: drop-shadow(0 0 2px var(--kurami-ring)) drop-shadow(0 0 5px var(--kurami-ring)); } 50% { filter: drop-shadow(0 0 3px var(--kurami-ring)) drop-shadow(0 0 12px var(--kurami-ring)); } }
html[data-kurami-mascot="off"] .kurami-mood { display: none; }
html[data-kurami-mascot="off"] .kurami-state { padding-block: var(--space-4); }
.kurami-state { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-4) var(--space-6); padding-block: var(--space-6); text-align: start; }
.kurami-state__copy { display: grid; gap: var(--space-2); max-width: 36ch; }
.kurami-state__copy :is(h1, h2, h3) { margin: 0; }
.kurami-state__copy p { margin: 0; color: var(--text-muted); }
.kurami-pull { position: fixed; inset: 0 0 auto; z-index: 90; display: grid; justify-items: center; gap: 4px; pointer-events: none;
  transform: translateY(calc(var(--pull, 0px) - 100%)); transition: transform .12s ease-out; padding-top: env(safe-area-inset-top, 0px); }
.kurami-pull img { width: 96px; height: 96px; }
.kurami-pull span { padding: 2px 10px; border-radius: 999px; background: var(--surface-raised); color: var(--text-muted); font-size: .75rem; box-shadow: var(--shadow-card-sm, none); }
.kurami-pull.is-ready span { color: var(--text-primary); }
.kurami-pull.is-refreshing { transform: translateY(calc(80px - 100%)); }
.kurami-pull.is-refreshing img { animation: kurami-pull-bob .9s ease-in-out infinite; }
html[data-kurami-mascot="off"] .kurami-pull img { display: none; }
@keyframes kurami-pull-bob { 50% { translate: 0 6px; } }
@media (prefers-reduced-motion: reduce) { .kurami-pull, .kurami-pull.is-refreshing img { transition: none; animation: none; } }
`;
