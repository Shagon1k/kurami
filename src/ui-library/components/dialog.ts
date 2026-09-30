import {escapeHtml} from "../foundations/html.ts";
import {renderButton} from "./button.ts";

export function renderDialog(input:{id:string;title:string;body:string;closeLabel:string}):string {
  if(!/^[a-z][a-z0-9-]*$/.test(input.id))throw new Error("Invalid dialog ID");
  return `<dialog id="${input.id}" class="dialog" aria-labelledby="${input.id}-title"><div class="dialog__heading"><h2 id="${input.id}-title">${escapeHtml(input.title)}</h2>${renderButton({label:input.closeLabel,variant:"secondary",attributes:{"data-dialog-close":true}})}</div><div class="dialog__body">${input.body}</div></dialog>`;
}
export const DIALOG_CSS=`
.dialog { width: min(620px,calc(100% - 28px)); max-height: calc(100dvh - 40px); padding: var(--space-5); color: var(--text-primary); background: var(--surface-page); border: 1px solid var(--border-default); border-radius: var(--radius); box-shadow: var(--shadow-raised); }
.dialog::backdrop { background: color-mix(in srgb,var(--text-primary) 40%,transparent); }
.dialog__heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-4); }
.dialog__heading h2 { margin: 0; font-size: 1.2rem; }
.dialog__body { min-width: 0; }
`;
