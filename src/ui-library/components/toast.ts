import {renderButton} from "./button.ts";
import {renderIcon,iconPath} from "./icon.ts";

/** One notice at a time. The runtime sets untrusted messages with textContent. */
export function renderToastRegion(closeLabel:string):string {
  return `<aside class="toast" data-toast-region data-tone="info" hidden><span class="toast__icon" aria-hidden="true">${(["info","success","warning","failure"] as const).map(tone=>`<span data-toast-icon="${tone}" hidden>${renderIcon(tone==="success"?"check":tone==="info"?"bell":"alert")}</span>`).join("")}</span><p class="toast__message" data-toast-message role="status" aria-live="polite" aria-atomic="true"></p>${renderButton({label:closeLabel,ariaLabel:closeLabel,variant:"icon",size:"compact",iconPath:iconPath("close"),attributes:{"data-toast-dismiss":true}})}</aside>`;
}

export const TOAST_CSS=`
.toast { --toast-tone: var(--status-info); position: fixed; inset-inline-end: max(var(--space-4),env(safe-area-inset-right)); bottom: max(var(--space-4),env(safe-area-inset-bottom)); z-index: 80; display: grid; grid-template-columns: 18px minmax(0,1fr) auto; align-items: start; gap: var(--space-3); width: min(380px,calc(100% - var(--space-4) * 2 - env(safe-area-inset-left) - env(safe-area-inset-right))); padding: var(--space-3); border: 1px solid var(--border-default); border-inline-start: 3px solid var(--toast-tone); border-radius: var(--radius); background: var(--surface-raised); color: var(--text-primary); box-shadow: var(--shadow-raised); }
.toast[data-tone="success"] { --toast-tone: var(--status-success); }
.toast[data-tone="warning"] { --toast-tone: var(--status-warning); }
.toast[data-tone="failure"] { --toast-tone: var(--status-failure); }
.toast__icon { display: grid; padding-block: var(--space-2); color: var(--toast-tone); }
.toast__message { margin: 0; padding-block: var(--space-2); font-size: .8rem; line-height: 1.5; overflow-wrap: anywhere; }
`;
