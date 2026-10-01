import {escapeHtml} from "../foundations/html.ts";
export function renderPopover(input:{id:string;label:string;body:string}):string {
  if(!/^[a-z][a-z0-9-]*$/.test(input.id))throw new Error("Invalid popover ID");
  return `<div class="ui-popover" id="${input.id}" role="group" popover="auto" aria-label="${escapeHtml(input.label)}">${input.body}</div>`;
}
export const POPOVER_CSS=`
.ui-popover { --popover-top: 80px; --popover-left: 8px; display: none; position: fixed; inset: auto; top: var(--popover-top); left: var(--popover-left); width: min(var(--popover-width,264px),calc(100vw - 16px)); max-height: calc(100dvh - 24px); overflow-y: auto; margin: 0; padding: var(--popover-padding,var(--space-2)); color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: var(--radius-md); box-shadow: var(--shadow-raised); }
.ui-popover:popover-open,.ui-popover.is-open { display: block; }
.ui-popover::backdrop { background: transparent; }
`;
