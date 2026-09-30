import {escapeHtml} from "../foundations/html.ts";
import {renderSelectionControl,SELECTION_CONTROL_CSS} from "./selection-control.ts";

export function renderSelectField(input:{name:string;label:string;value:string;options:{value:string;label:string}[];disabled?:boolean}):string {
  return `<label class="form-field"><span>${escapeHtml(input.label)}</span><select name="${escapeHtml(input.name)}"${input.disabled?" disabled":""}>${input.options.map(option=>`<option value="${escapeHtml(option.value)}"${option.value===input.value?" selected":""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>`;
}
export function renderNumberField(input:{name:string;label:string;value:number;min:number;max:number;disabled?:boolean}):string {
  for(const number of [input.value,input.min,input.max])if(!Number.isFinite(number))throw new Error("Invalid numeric field");
  return `<label class="form-field"><span>${escapeHtml(input.label)}</span><input name="${escapeHtml(input.name)}" type="number" value="${input.value}" min="${input.min}" max="${input.max}" step="1" required${input.disabled?" disabled":""}></label>`;
}
export const FORM_CSS=`
${SELECTION_CONTROL_CSS}
.form-check { --selection-size: 20px; --selection-min-height: 44px; --selection-font-size: .8rem; padding-inline: var(--space-2); }
.form-field { display: grid; align-content: start; gap: var(--space-2); min-width: 0; font-size: .8rem; }
.form-field > span { color: var(--text-muted); }
.form-field > :is(input,select) { width: 100%; min-width: 0; min-height: 44px; padding: var(--space-2) var(--space-3); border: 1px solid var(--border-default); border-radius: var(--radius); color: var(--text-primary); background: var(--surface-page); font: inherit; }
.form-field > :disabled { color: var(--text-muted); cursor: not-allowed; }
`;

export function renderCheckbox(input:{name:string;label:string;value:string;checked?:boolean}):string {
  return renderSelectionControl({label:input.label,className:"form-check",visibleLabel:true,variant:"data",checked:input.checked,attributes:{name:input.name,value:input.value}});
}
