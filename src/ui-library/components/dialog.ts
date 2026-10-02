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
.dialog { width: min(620px,calc(100% - 28px)); max-height: calc(100dvh - 40px); padding: var(--space-5); color: var(--text-primary); background: var(--surface-page); border: 1px solid var(--border-default); border-radius: var(--radius); box-shadow: var(--shadow-raised); overscroll-behavior: contain; }
.dialog::backdrop { background: color-mix(in srgb,var(--text-primary) 40%,transparent); }
.dialog__heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-4); }
.dialog__heading h2 { min-width: 0; overflow-wrap: anywhere; margin: 0; font-size: 1.2rem; }
.dialog__heading [data-dialog-close] { flex: none; }
.dialog__body { min-width: 0; }
.dialog__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
`;
