import {renderButton} from "./button.ts";
import {renderIcon,iconPath} from "./icon.ts";
import {renderKuramiMood} from "./kurami-mood.ts";

/** One notice at a time. The runtime sets untrusted messages with textContent. With `kurami`, a celebrated
 * notice (finished work) also brings Kurami herself, in her celebrate mood, beside its message. */
export function renderToastRegion(closeLabel:string,options:{kurami?:boolean}={}):string {
  return `<aside class="toast" data-toast-region data-tone="info" hidden>${options.kurami?`<span class="toast__kurami" aria-hidden="true">${renderKuramiMood({mood:"celebrate"})}</span>`:""}<span class="toast__icon" aria-hidden="true">${(["info","success","warning","failure"] as const).map(tone=>`<span data-toast-icon="${tone}" hidden>${renderIcon(tone==="success"?"check":tone==="info"?"bell":"alert")}</span>`).join("")}</span><p class="toast__message" data-toast-message role="status" aria-live="polite" aria-atomic="true"></p>${renderButton({label:closeLabel,ariaLabel:closeLabel,variant:"icon",size:"compact",iconPath:iconPath("close"),attributes:{"data-toast-dismiss":true}})}</aside>`;
}

export const TOAST_CSS=`
.toast { --toast-tone: var(--status-info); position: fixed; inset-inline-end: max(var(--space-4),env(safe-area-inset-right)); bottom: max(var(--space-4),env(safe-area-inset-bottom)); z-index: 80; display: grid; grid-template-columns: 18px minmax(0,1fr) auto; align-items: start; gap: var(--space-3); width: min(380px,calc(100% - var(--space-4) * 2 - env(safe-area-inset-left) - env(safe-area-inset-right))); padding: var(--space-3); border: 1px solid var(--border-default); border-inline-start: 3px solid var(--toast-tone); border-radius: var(--radius); background: var(--surface-raised); color: var(--text-primary); box-shadow: var(--shadow-raised); }
.toast[data-tone="success"] { --toast-tone: var(--status-success); }
.toast[data-tone="warning"] { --toast-tone: var(--status-warning); }
.toast[data-tone="failure"] { --toast-tone: var(--status-failure); }
.toast__icon { position: relative; display: grid; padding-block: var(--space-2); color: var(--toast-tone); }
.toast[data-celebrate] .toast__icon { animation: toast-celebrate .9s cubic-bezier(.2,.8,.2,1); }
.toast[data-celebrate] .toast__icon::after { content: ""; position: absolute; inset: 50% auto auto 50%; width: 4px; height: 4px; border-radius: 50%; translate: -50% -50%; pointer-events: none;
  box-shadow: 0 -14px var(--toast-tone), 12px -8px var(--status-warning), 13px 7px var(--toast-tone), 0 14px var(--status-info), -12px 8px var(--toast-tone), -13px -7px var(--status-warning);
  opacity: 0; animation: toast-sparks .9s ease-out; }
@keyframes toast-celebrate { 0% { transform: scale(.6) rotate(-20deg); } 45% { transform: scale(1.35) rotate(8deg); } 100% { transform: none; } }
@keyframes toast-sparks { 0% { opacity: 1; scale: .3; } 70% { opacity: 1; } 100% { opacity: 0; scale: 1.6; } }
.toast__kurami { display: none; }
.toast[data-celebrate]:has(> .toast__kurami) { grid-template-columns: 80px minmax(0,1fr) auto; align-items: center; }
.toast[data-celebrate] > .toast__kurami { display: grid; justify-items: center; padding-block: var(--space-2); rotate: -8deg; animation: toast-kurami .55s cubic-bezier(.2,.9,.3,1.3) both; }
.toast[data-celebrate] > .toast__kurami .kurami-mood { --kurami-size: 64px; margin: 0; }
.toast[data-celebrate]:has(> .toast__kurami) > .toast__icon { display: none; }
html[data-kurami-mascot="off"] .toast[data-celebrate] > .toast__kurami { display: none; }
html[data-kurami-mascot="off"] .toast[data-celebrate]:has(> .toast__kurami) { grid-template-columns: 18px minmax(0,1fr) auto; padding-inline-start: var(--space-3); }
html[data-kurami-mascot="off"] .toast[data-celebrate]:has(> .toast__kurami) > .toast__icon { display: grid; }
@keyframes toast-kurami { from { opacity: 0; scale: .5; rotate: -30deg; } to { opacity: 1; scale: 1; rotate: -8deg; } }
@media (prefers-reduced-motion: reduce) { .toast[data-celebrate] .toast__icon, .toast[data-celebrate] .toast__icon::after, .toast[data-celebrate] .toast__kurami { animation: none; } }
.toast__message { margin: 0; padding-block: var(--space-2); font-size: .8rem; line-height: 1.5; overflow-wrap: anywhere; }
`;
