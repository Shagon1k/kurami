import {escapeHtml} from "../foundations/html.ts";

export function renderSearchField(input:{name:string;label:string;value?:string;placeholder?:string}):string {
  return `<label class="form-field"><span>${escapeHtml(input.label)}</span><input name="${escapeHtml(input.name)}" type="search" value="${escapeHtml(input.value??"")}"${input.placeholder?` placeholder="${escapeHtml(input.placeholder)}"`:""}></label>`;
}

export function renderSelectField(input:{name:string;label:string;value:string;options:{value:string;label:string}[];disabled?:boolean}):string {
  return `<label class="form-field"><span>${escapeHtml(input.label)}</span><select name="${escapeHtml(input.name)}"${input.disabled?" disabled":""}>${input.options.map(option=>`<option value="${escapeHtml(option.value)}"${option.value===input.value?" selected":""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>`;
}
export function renderNumberField(input:{name:string;label:string;value:number;min:number;max:number;disabled?:boolean}):string {
  for(const number of [input.value,input.min,input.max])if(!Number.isFinite(number))throw new Error("Invalid numeric field");
  return `<label class="form-field"><span>${escapeHtml(input.label)}</span><input name="${escapeHtml(input.name)}" type="number" value="${input.value}" min="${input.min}" max="${input.max}" step="1" required${input.disabled?" disabled":""}></label>`;
}
export const FORM_CSS=`
.form-field { display: grid; align-content: start; gap: var(--space-2); min-width: 0; font-size: .8rem; }
.form-field > span { color: var(--text-muted); }
.form-field > :is(input,select) { width: 100%; min-width: 0; min-height: 44px; padding: var(--space-2) var(--space-3); border: 1px solid var(--border-default); border-radius: var(--radius); color: var(--text-primary); background: var(--surface-page); font: inherit; }
.form-field > :disabled { color: var(--text-muted); cursor: not-allowed; }
`;
