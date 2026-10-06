import {escapeHtml} from "../foundations/html.ts";
import {renderButton} from "./button.ts";
import {iconPath} from "./icon.ts";

export function renderDialog(input:{id:string;title:string;body:string;closeLabel:string}):string {
  if(!/^[a-z][a-z0-9-]*$/.test(input.id))throw new Error("Invalid dialog ID");
  return `<dialog id="${input.id}" class="dialog" aria-labelledby="${input.id}-title"><div class="dialog__heading"><h2 id="${input.id}-title">${escapeHtml(input.title)}</h2>${renderButton({label:input.closeLabel,variant:"icon",iconPath:iconPath("close"),attributes:{"data-dialog-close":true,title:input.closeLabel}})}</div><div class="dialog__body">${input.body}</div></dialog>`;
}
/** Trusted, component-rendered buttons in DOM/tab order: secondary, then primary. */
export function renderDialogActions(body:string):string {
  return `<div class="dialog__actions">${body}</div>`;
}
export const DIALOG_CSS=`
.dialog { inset: env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px); margin: auto; width: min(620px,calc(100% - 28px - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px))); max-height: calc(100dvh - 40px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)); padding: var(--space-5); color: var(--text-primary); background: var(--surface-page); border: 1px solid var(--border-default); border-radius: var(--radius); box-shadow: var(--shadow-raised); overscroll-behavior: contain; }
.dialog::backdrop { background: color-mix(in srgb,var(--text-primary) 40%,transparent); }
/* The title and close button stay put while a long dialog scrolls. */
.dialog__heading { position: sticky; top: calc(-1 * var(--space-5)); z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin: calc(-1 * var(--space-5)) 0 var(--space-4); padding: var(--space-5) 0 var(--space-2); background: inherit; }
.dialog__heading h2 { min-width: 0; overflow-wrap: anywhere; margin: 0; font-size: 1.2rem; }
.dialog__heading [data-dialog-close] { flex: none; }
.dialog__body { min-width: 0; }
.dialog__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
`;
