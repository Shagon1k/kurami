// Kurami herself (not the fox logo): twelve illustrated states that tell how things are at a glance —
// calm, working, asleep, offline, done, peeking, celebrating, pointing at a problem, thinking, waiting for
// the owner, found a problem, welcome. A 320 px WebP and the original 1024 px PNG for dense screens, served by every app
// under /assets/kurami-<mood>.webp from src/ui-library/assets/kurami. Loaded lazily; decorative unless a
// caller passes a label, since the text next to it always says the same thing. Lossless WebP at 320 px: lossy
// encoding turned the transparent background into a faint square.
import { readFileSync } from "node:fs";
import { escapeHtml } from "../foundations/html.ts";
import { breakpoints } from "../tokens/index.ts";

export const KURAMI_MOODS = ["idle", "working", "asleep", "offline", "done", "peek", "celebrate", "alert", "thinking", "needs-decision", "found-problem", "welcome"] as const;
export type KuramiMood = typeof KURAMI_MOODS[number];

/** Flat names: the gateway serves an app's files only directly under /assets/. */
export const kuramiMoodPath = (mood: KuramiMood): string => `/assets/kurami-${mood}.webp`;

/** The files every app registers, so the mounted pages can load them from their own origin path. The path climbs
 * to the repository root, so the same files are found from src and from the compiled dist (Digest). */
export function kuramiMoodAssets(): { path: string; body: Buffer; type: string }[] {
  return KURAMI_MOODS.flatMap(mood => [
    { path: kuramiMoodPath(mood), type: "image/webp", body: readFileSync(new URL(`../../../src/ui-library/assets/kurami/${mood}.webp`, import.meta.url)) },
    { path: `/assets/kurami-${mood}-hd.png`, type: "image/png", body: readFileSync(new URL(`../../../src/ui-library/assets/kurami/${mood}-hd.png`, import.meta.url)) },
  ]);
}

/** Kurami in her medallion: a disc behind her, the figure cut only along the lower arc, everything above
 *  free to break out (ears, tails, a pointing hand). One size everywhere (--kurami-size), so she never
 *  seems to change height between screens. Paper draws the ring in ink; Neon lights it (KURAMI_MOOD_CSS). */
export function renderKuramiMood(input: { mood: KuramiMood; label?: string; className?: string; eager?: boolean }): string {
  if (!(KURAMI_MOODS as readonly string[]).includes(input.mood)) throw new Error("Unknown Kurami mood");
  const alt = input.label ? escapeHtml(input.label) : "";
  return `<span class="kurami-mood${input.className ? ` ${escapeHtml(input.className)}` : ""}" data-kurami-mood="${input.mood}"${alt ? ` role="img" aria-label="${alt}"` : ' aria-hidden="true"'}>`
    + `<svg class="kurami-mood__ring" viewBox="0 0 100 100" focusable="false"><circle class="kurami-mood__disc" cx="50" cy="50" r="48"/><circle class="kurami-mood__line" cx="50" cy="50" r="48" pathLength="100"/><circle class="kurami-mood__spark" cx="50" cy="50" r="48" pathLength="100"/></svg>`
    + `<img class="kurami-mood__figure" src="${kuramiMoodPath(input.mood)}" srcset="${kuramiMoodPath(input.mood)} 320w, /assets/kurami-${input.mood}-hd.png 1024w" sizes="(max-width: ${breakpoints.phone}px) 104px, 188px" width="160" height="160" alt="" loading="${input.eager ? "eager" : "lazy"}" decoding="async"></span>`;
}

/** A whole-page or empty-section state: Kurami, a short heading and one line of what to do. */
/** Kurami says it: the medallion with a speech bubble. `side` (pulse lines) puts the bubble beside her and
 * below her on phones; `top` (banners, empty states) puts it above her like a comic line. `body` is trusted
 * markup from the product. Switched off, the bubble stays as a plain card without its tail. */
export function renderKuramiSays(input: { mood: KuramiMood; body: string; placement?: "side" | "top" | "inline"; className?: string; eager?: boolean }): string {
  if (input.className && !/^[a-z0-9_-]+(?: [a-z0-9_-]+)*$/.test(input.className)) throw new Error("Unsafe Kurami bubble class");
  return `<div class="kurami-says kurami-says--${input.placement ?? "side"}${input.className ? ` ${input.className}` : ""}">${renderKuramiMood({ mood: input.mood, eager: input.eager })}<div class="kurami-says__bubble">${input.body}</div></div>`;
}

/** A personal line with factual metadata and actions kept outside the speech bubble. */
export function renderKuramiPresence(input: { mood: KuramiMood; speech: string; key: string; lines?: string[]; meta?: string; action?: string; className?: string; voiceContext?: "docs-home" }): string {
  if (input.className && !/^[a-z0-9_-]+(?: [a-z0-9_-]+)*$/.test(input.className)) throw new Error("Unsafe Kurami presence class");
  return `<div class="kurami-presence${input.className ? ` ${input.className}` : ""}" data-kurami-presence="${escapeHtml(input.key)}" data-kurami-voice-lines="${escapeHtml(JSON.stringify(input.lines??[input.speech]))}"${input.voiceContext ? ` data-kurami-voice-context="${escapeHtml(input.voiceContext)}"` : ""}>`
    + renderKuramiMood({ mood: input.mood, eager: true })
    + `<div class="kurami-says__bubble kurami-presence__bubble"><p data-kurami-speech>${escapeHtml(input.speech)}</p></div>`
    + `<div class="kurami-presence__footer">${input.meta ? `<div class="kurami-presence__meta">${input.meta}</div>` : ""}${input.action ? `<div class="kurami-presence__action">${input.action}</div>` : ""}</div></div>`;
}

export function renderKuramiState(input: { mood: KuramiMood; title: string; text?: string; action?: string; headingLevel?: 1 | 2 | 3 }): string {
  const level = input.headingLevel ?? 2;
  return `<div class="kurami-state" data-kurami-state="${input.mood}">${renderKuramiSays({ mood: input.mood, placement: "inline", eager: true, body: `<div class="kurami-state__copy"><h${level}>${escapeHtml(input.title)}</h${level}>${input.text ? `<p>${escapeHtml(input.text)}</p>` : ""}${input.action ?? ""}</div>` })}</div>`;
}

/** Before first paint: Hub → Appearance can switch Kurami off for every app (the gateway's cookie). */
export const KURAMI_MASCOT_RUNTIME_JS = `document.documentElement.dataset.kuramiMascot=/(?:^|;\\s*)kurami-mascot=off(?:;|$)/.test(document.cookie)?"off":"on";`;

/** Keep the current line during polling; fetch prepared variants for a later visit. */
export const KURAMI_PRESENCE_RUNTIME_JS = String.raw`(()=>{
  document.documentElement.dataset.kuramiVoice='on';
  const active=new Map(),requested=new Set(),slots=new Map(),bound=new WeakSet(),prefix='kurami-voice:',ttl=43200000;
  function apply(){
    for(const scene of document.querySelectorAll('[data-kurami-presence]')){
      if(bound.has(scene))continue;
      bound.add(scene);
      const key=scene.dataset.kuramiPresence,lang=document.documentElement.lang==='ru'?'ru':'en',target=scene.querySelector('[data-kurami-speech]');if(!target)continue;
      let bank;try{bank=JSON.parse(scene.dataset.kuramiVoiceLines);}catch{bank=[target.textContent];}
      if(!active.has(key)){
        try{const saved=JSON.parse(localStorage.getItem(prefix+key)||'null'),age=Date.now()-saved?.at;if(saved?.lang===lang&&age>=0&&age<ttl&&Array.isArray(saved.lines)&&saved.lines.length>=2&&saved.lines.length<=4&&saved.lines.every(line=>typeof line==='string'&&line.length>=12&&line.length<=220&&!/[<>]/.test(line)))bank=saved.lines;}catch{}
        const index=Math.floor(Math.random()*bank.length);active.set(key,bank[index]||target.textContent);
      }
      target.textContent=active.get(key);
      scene.dataset.kuramiVoiceReady='true';
      const mood=scene.querySelector('[data-kurami-mood]')?.dataset.kuramiMood,slot=scene.parentElement?.id||scene.className;
      if(slots.has(slot)&&slots.get(slot)!==mood)scene.dataset.kuramiReact='true';slots.set(slot,mood);
      if(!/^[a-f0-9]{64}$/.test(key)||requested.has(key))continue;requested.add(key);
      const live=scene.dataset.kuramiVoiceContext==='docs-home';
      fetch('/_apps/hub/api/portal-voice?key='+key+'&lang='+lang+(live?'&context=docs-home':''),{cache:'no-store',signal:AbortSignal.timeout(5000)}).then(response=>response.ok?response.json():null).then(value=>{
        if(!/^[a-f0-9]{64}$/.test(value?.key)||(!live&&value.key!==key)||value.lang!==lang||!Array.isArray(value.lines)||value.lines.length<2||value.lines.length>4||!value.lines.every(line=>typeof line==='string'&&line.length>=12&&line.length<=220&&!/[<>]/.test(line)))return;
        if(live&&value.key!==key){
          if(!active.has(value.key))active.set(value.key,value.lines[Math.floor(Math.random()*value.lines.length)]);
          scene.dataset.kuramiPresence=value.key;scene.dataset.kuramiVoiceLines=JSON.stringify(value.lines);requested.add(value.key);target.textContent=active.get(value.key);
        }
        try{localStorage.setItem(prefix+value.key,JSON.stringify({lang,at:Date.now(),lines:value.lines}));const keys=Object.keys(localStorage).filter(item=>item.startsWith(prefix));if(keys.length>40)keys.slice(0,keys.length-40).forEach(item=>localStorage.removeItem(item));}catch{}
      }).catch(()=>{});
    }
  }
  const start=()=>{apply();if(typeof MutationObserver!=='undefined'&&document.body)new MutationObserver(apply).observe(document.body,{childList:true,subtree:true});};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();`;

/** Pull-to-refresh for the installed app (a standalone window has no browser refresh gesture): at the top
 * of the page a pull brings a compact portrait and label into view; releasing past the line refreshes —
 * in place where the app exposes window.kuramiRefresh (Hub, Projects), otherwise by reloading. */
export const KURAMI_PULL_REFRESH_JS = String.raw`(()=>{
  if(!matchMedia('(display-mode: standalone)').matches||!matchMedia('(pointer: coarse)').matches)return;
  const ru=document.documentElement.lang==='ru',trigger=80,limit=120;
  const portrait=${JSON.stringify(renderKuramiMood({mood:"thinking",eager:true}))};
  const asset=path=>typeof kuramiAppUrl==='function'?kuramiAppUrl(path):path;
  let startY=null,pull=0,panel=null,busy=false;
  const mood=value=>{const figure=panel.querySelector('img');panel.querySelector('[data-kurami-mood]').dataset.kuramiMood=value;figure.src=asset('/assets/kurami-'+value+'.webp');figure.srcset=asset('/assets/kurami-'+value+'.webp')+' 320w, '+asset('/assets/kurami-'+value+'-hd.png')+' 1024w';figure.sizes='50px';};
  const show=()=>{panel=document.createElement('div');panel.className='kurami-pull';panel.setAttribute('aria-hidden','true');
    panel.innerHTML='<span class="kurami-pull__portrait">'+portrait+'</span><span class="kurami-pull__label"></span>';mood('thinking');document.body.append(panel);};
  const text=()=>panel.querySelector('.kurami-pull__label').textContent=pull>=trigger?(ru?'Отпусти, чтобы обновить':'Release to refresh'):(ru?'Потяни ещё':'Keep pulling');
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
    busy=true;panel.classList.add('is-refreshing');mood('working');panel.querySelector('.kurami-pull__label').textContent=ru?'Обновляю…':'Refreshing…';
    try{if(typeof window.kuramiRefresh==='function')await window.kuramiRefresh();else{location.reload();return;}}finally{busy=false;reset();}
  });
  addEventListener('touchcancel',()=>{if(!busy)reset();});
})();`;

/* The figure breaks out only above the upper quarter of the portal. Inside the portal, the mask stops
 * before the ring so the lower rim and working spark remain visible. */
export const KURAMI_MOOD_CSS = `
.kurami-mood { --kurami-size: 120px; --kurami-glow: 12px; --kurami-ring: color-mix(in srgb, var(--accent-primary) 45%, transparent); --kurami-disc: color-mix(in srgb, var(--accent-primary) 9%, var(--surface-panel));
  position: relative; display: block; flex: none; width: var(--kurami-size); height: var(--kurami-size); margin-top: calc(var(--kurami-size) * .14); user-select: none; }
.kurami-mood__ring { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.kurami-mood__disc { fill: var(--kurami-disc); filter: drop-shadow(0 0 var(--kurami-glow) color-mix(in srgb,var(--kurami-ring) 45%,transparent)); }
.kurami-mood__line { fill: none; stroke: var(--kurami-ring); stroke-width: 1.6; }
.kurami-mood__spark { fill: none; stroke: none; }
.kurami-mood__figure { position: absolute; left: 50%; top: calc(var(--kurami-size) * -.1); width: calc(var(--kurami-size) * 1.25); height: calc(var(--kurami-size) * 1.25); max-width: none; translate: -50% 0; -webkit-user-drag: none;
  -webkit-mask-image: linear-gradient(#000 0 24%, transparent 30%), radial-gradient(37% 37% at 50% 48%, #000 99%, transparent 100%);
  mask-image: linear-gradient(#000 0 24%, transparent 30%), radial-gradient(37% 37% at 50% 48%, #000 99%, transparent 100%); }
html[data-kurami-theme="neon"] .kurami-mood { --kurami-ring: var(--neon-sign, var(--accent-primary)); --kurami-disc: color-mix(in srgb, var(--neon-sign, var(--accent-primary)) 7%, var(--surface-page)); }
html[data-kurami-theme="neon"] .kurami-mood__line { stroke-width: 1.8; filter: drop-shadow(0 0 2px var(--kurami-ring)) drop-shadow(0 0 6px var(--kurami-ring)); }
html[data-kurami-theme="neon"] .kurami-mood[data-kurami-mood="asleep"] { --kurami-ring: color-mix(in srgb, var(--neon-sign, var(--accent-primary)) 45%, transparent); }
.kurami-mood[data-kurami-mood="alert"] { --kurami-ring: var(--status-warning); }
html[data-kurami-theme="neon"] .kurami-mood[data-kurami-mood="alert"] { --kurami-ring: var(--neon-sign, var(--status-failure)); }

@media (prefers-reduced-motion: no-preference) {
  /* State changes get a brief reaction; working has a circling dash. */
  .kurami-mood__line { stroke-dasharray: 100; animation: kurami-ink .9s ease-out both; }
  .kurami-mood__figure { transition: opacity var(--duration-fast); }
  .kurami-mood[data-kurami-mood="working"] .kurami-mood__spark { stroke: var(--kurami-ring); stroke-width: 2.4; stroke-linecap: round; stroke-dasharray: 9 91; transform-origin: 50% 50%; animation: kurami-orbit 3.2s linear infinite; }
  .kurami-presence[data-kurami-react] .kurami-mood__figure { animation: kurami-arrive .45s ease-out both; }
  .kurami-presence[data-kurami-react] .kurami-mood__ring { animation: kurami-reaction .7s ease-out both; }
  /* Neon: the ring flickers on, then breathes; faster and brighter on alert, slow and dim asleep. */
  html[data-kurami-theme="neon"] .kurami-mood__line { stroke-dasharray: none; animation: kurami-ignite 1.3s steps(1, end) both, kurami-glow 5s ease-in-out 1.3s infinite; }
  html[data-kurami-theme="neon"] .kurami-mood[data-kurami-mood="alert"] .kurami-mood__line { animation: kurami-ignite 1.3s steps(1, end) both, kurami-glow 1.4s ease-in-out 1.3s infinite; }
  html[data-kurami-theme="neon"] .kurami-mood[data-kurami-mood="asleep"] .kurami-mood__line { animation: kurami-glow 9s ease-in-out infinite; }
  html[data-kurami-theme="neon"] .kurami-mood[data-kurami-mood="working"] .kurami-mood__spark { stroke: #fff; filter: drop-shadow(0 0 3px var(--kurami-ring)) drop-shadow(0 0 8px var(--kurami-ring)); }
}
@keyframes kurami-ink { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes kurami-arrive { from { opacity: .35; transform: translateY(2%); } to { opacity: 1; transform: none; } }
@keyframes kurami-reaction { 40% { opacity: .65; } }
@keyframes kurami-orbit { to { transform: rotate(360deg); } }
@keyframes kurami-ignite { 0% { opacity: .15; } 12% { opacity: 1; } 18% { opacity: .3; } 30% { opacity: 1; } 36% { opacity: .55; } 48%, 100% { opacity: 1; } }
@keyframes kurami-glow { 0%, 100% { filter: drop-shadow(0 0 2px var(--kurami-ring)) drop-shadow(0 0 5px var(--kurami-ring)); } 50% { filter: drop-shadow(0 0 3px var(--kurami-ring)) drop-shadow(0 0 12px var(--kurami-ring)); } }
html[data-kurami-mascot="off"] .kurami-mood { display: none; }
html[data-kurami-mascot="off"] .kurami-state { padding-block: var(--space-4); }
.kurami-state { display: flex; justify-content: center; padding-block: var(--space-6); text-align: start; }
/* Speech bubble (renderKuramiSays). The tail is a turned square sharing the bubble's fill and border. */
.kurami-says { display: flex; align-items: center; gap: var(--space-4); min-width: 0; }
.kurami-says--top { flex-direction: column-reverse; align-items: flex-start; gap: var(--space-3); }
.kurami-says--inline { display: grid; grid-template-columns: auto minmax(0,1fr); }
.kurami-says__bubble { position: relative; min-width: 0; max-width: 60ch; padding: var(--space-3) var(--space-4); border: 1px solid var(--border-default); border-radius: 16px; background: var(--surface-raised); box-shadow: var(--shadow-card-sm); }
.kurami-says__bubble::before { content: ""; position: absolute; width: 14px; height: 14px; background: inherit; border: solid var(--border-default); border-width: 0 0 1px 1px; }
.kurami-says--side .kurami-says__bubble::before { left: -8px; top: 50%; translate: 0 -50%; rotate: 45deg; }
.kurami-says--inline .kurami-says__bubble::before { left: -8px; top: 50%; translate: 0 -50%; rotate: 45deg; }
.kurami-says--top .kurami-says__bubble::before { left: 53px; bottom: -8px; rotate: -45deg; }
html[data-kurami-mascot="off"] .kurami-says__bubble::before { display: none; }
@media (max-width: ${breakpoints.phone}px) {
  .kurami-says--inline .kurami-mood { --kurami-size: 72px; }
  .kurami-says--inline .kurami-says__bubble { padding: var(--space-3); }
  .kurami-state__copy :is(h1,h2,h3) { font-size: 1.1rem; }
  .kurami-says--side { flex-direction: column; align-items: flex-start; gap: var(--space-3); }
  .kurami-says--side .kurami-says__bubble::before { left: 53px; top: -8px; translate: none; rotate: 135deg; }
}
.kurami-state__copy { display: grid; gap: var(--space-2); max-width: 36ch; }
.kurami-state__copy :is(h1, h2, h3) { margin: 0; }
.kurami-state__copy p { margin: 0; color: var(--text-muted); }
.kurami-presence { --kurami-presence-size: 150px; display: grid; grid-template-columns: var(--kurami-presence-size) minmax(0,1fr); gap: var(--space-3) var(--space-4); align-items: start; width: 100%; max-width: var(--kurami-presence-max-width,68rem); }
.kurami-presence .kurami-mood { --kurami-size: var(--kurami-presence-size); grid-column: 1; grid-row: 1 / span 2; }
.kurami-presence__bubble { grid-column: 2; grid-row: 1; width: 100%; max-width: none; align-self: center; }
.kurami-presence__bubble::before { left: -8px; top: min(50%, calc(var(--kurami-presence-size) / 2)); translate: 0 -50%; rotate: 45deg; }
.kurami-presence__bubble p { margin: 0; max-width: 56ch; font-size: 1.05rem; line-height: 1.5; color: var(--text-primary); }
html[data-kurami-voice="on"] .kurami-presence:not([data-kurami-voice-ready]) [data-kurami-speech] { opacity: 0; }
html[data-kurami-voice="on"] [data-kurami-speech] { transition: opacity var(--duration-fast); min-height: 3em; }
@media (prefers-reduced-motion: reduce) { html[data-kurami-voice="on"] [data-kurami-speech] { transition: none; } }
.kurami-presence__footer { grid-column: 2; grid-row: 2; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); min-width: 0; }
.kurami-presence__meta { flex: 1 1 16rem; min-width: 0; color: var(--text-muted); font-size: .8rem; }
.kurami-presence__meta p { margin: 0; }
.kurami-presence__action { flex: 0 1 auto; }
html[data-kurami-theme="neon"] .kurami-presence .kurami-mood[data-kurami-mood] .kurami-mood__line { animation: none; }
html[data-kurami-mascot="off"] .kurami-presence { grid-template-columns: minmax(0,1fr); }
html[data-kurami-mascot="off"] .kurami-presence__bubble, html[data-kurami-mascot="off"] .kurami-presence__footer { grid-column: 1; }
@media (max-width: ${breakpoints.phone}px) {
  .kurami-presence { --kurami-presence-size: 82px; gap: var(--space-3); }
  .kurami-presence .kurami-mood { grid-row: 1; }
  .kurami-presence__bubble { padding: var(--space-3); }
  .kurami-presence__bubble p { font-size: .95rem; }
  .kurami-presence__footer { grid-column: 1 / -1; }
  .kurami-presence__action { flex: 1 1 9rem; --button-width: 100%; }
}
.kurami-pull { --pull: 0px; position: fixed; inset-inline: max(var(--space-3),env(safe-area-inset-left)) max(var(--space-3),env(safe-area-inset-right)); top: calc(var(--space-2) + env(safe-area-inset-top,0px)); z-index: 90;
  display: grid; grid-template-columns: 52px minmax(0,1fr); align-items: center; gap: var(--space-2); width: max-content; max-width: calc(100% - var(--space-3) * 2 - env(safe-area-inset-left) - env(safe-area-inset-right)); margin-inline: auto; padding: var(--space-2) var(--space-3); pointer-events: none;
  border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--surface-raised); box-shadow: var(--shadow-raised); transform: translateY(calc(min(var(--pull),80px) - 80px)); transition: transform .12s ease-out; }
.kurami-pull__portrait { display: grid; justify-items: center; padding-block: var(--space-1); }
.kurami-pull .kurami-mood { --kurami-size: 40px; margin: 0; }
.kurami-pull__label { color: var(--text-muted); font-size: .75rem; }
.kurami-pull.is-ready .kurami-pull__label { color: var(--text-primary); }
.kurami-pull.is-refreshing { transform: translateY(0); }
html[data-kurami-mascot="off"] .kurami-pull { grid-template-columns: minmax(0,1fr); }
html[data-kurami-mascot="off"] .kurami-pull__portrait { display: none; }
@media (prefers-reduced-motion: reduce) { .kurami-pull { transition: none; } }
`;
