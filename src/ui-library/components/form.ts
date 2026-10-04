import {escapeHtml} from "../foundations/html.ts";
import {renderIcon,ICON_CSS} from "./icon.ts";
import {renderSelectionControl,SELECTION_CONTROL_CSS} from "./selection-control.ts";

export function renderSearchField(input:{name:string;label:string;value?:string;placeholder?:string;labelHidden?:boolean;icon?:boolean}):string {
  return `<label class="form-field"><span${input.labelHidden?' class="sr-only"':""}>${escapeHtml(input.label)}</span><span class="form-search">${input.icon?renderIcon("search"):""}<input name="${escapeHtml(input.name)}" type="search" value="${escapeHtml(input.value??"")}"${input.placeholder?` placeholder="${escapeHtml(input.placeholder)}"`:""}></span></label>`;
}

export function renderSelectField(input:{name:string;label:string;value:string;options:{value:string;label:string}[];disabled?:boolean;attributes?:Record<string,string|true>}):string {
  const attributes=Object.entries(input.attributes??{}).map(([name,value])=>{
    if(!/^(?:data-[a-z][a-z0-9-]*|aria-[a-z][a-z0-9-]*|id)$/.test(name))throw new Error("Unsafe select attribute: "+name);
    return value===true?` ${name}`:` ${name}="${escapeHtml(value)}"`;
  }).join("");
  return `<label class="form-field"><span>${escapeHtml(input.label)}</span><span class="form-select"><select name="${escapeHtml(input.name)}"${attributes}${input.disabled?" disabled":""}>${input.options.map(option=>`<option value="${escapeHtml(option.value)}"${option.value===input.value?" selected":""}>${escapeHtml(option.label)}</option>`).join("")}</select>${renderIcon("chevronDown")}</span></label>`;
}
export function renderNumberField(input:{name:string;label:string;value:number;min:number;max:number;disabled?:boolean}):string {
  for(const number of [input.value,input.min,input.max])if(!Number.isFinite(number))throw new Error("Invalid numeric field");
  return `<label class="form-field"><span>${escapeHtml(input.label)}</span><input name="${escapeHtml(input.name)}" type="number" value="${input.value}" min="${input.min}" max="${input.max}" step="1" required${input.disabled?" disabled":""}></label>`;
}
export const FORM_CSS=`
${ICON_CSS}
${SELECTION_CONTROL_CSS}
.form-check { --selection-size: 20px; --selection-min-height: var(--control-height); --selection-font-size: .8rem; padding-inline: var(--space-2); }
.form-field { display: grid; grid-template-columns: var(--form-field-columns,minmax(0,1fr)); align-items: var(--form-field-align,start); align-content: start; gap: var(--space-2); min-width: 0; font-size: .8rem; }
.form-field > span { color: var(--text-muted); }
.form-field :is(input,select) { width: 100%; min-width: 0; min-height: var(--control-height); padding: var(--space-2) var(--space-3); border: 1px solid var(--border-default); border-radius: var(--radius); color: var(--text-primary); background: var(--surface-raised); font: inherit; transition: border-color var(--duration-fast), background var(--duration-fast); }
.form-field :is(input,select):hover:not(:disabled) { border-color: var(--text-muted); }
.form-search { position: relative; display: block; }
.form-search > .ui-icon { position: absolute; inset-inline-start: var(--space-3); top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-muted); }
.form-search:has(> .ui-icon) input { padding-inline-start: calc(var(--space-3) + 26px); }
.form-select { position: relative; display: block; }
.form-select select { appearance: none; padding-inline-end: calc(var(--space-3) * 2 + 18px); cursor: pointer; }
.form-select .ui-icon { position: absolute; inset-inline-end: var(--space-3); top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-muted); }
.form-field :disabled { color: var(--text-muted); background: var(--surface-panel); cursor: not-allowed; }
.form-field[data-dirty="true"] :is(input,select):not(:disabled) { border-color: color-mix(in srgb,var(--status-info) 45%,var(--border-default)); background: color-mix(in srgb,var(--status-info) 5%,var(--surface-raised)); }
.form-field[data-dirty="true"] > span:first-child { color: var(--status-info); }
.form-select:has(:disabled) .ui-icon { opacity: .5; }
@media (forced-colors: active) { .form-select select { appearance: auto; padding-inline-end: var(--space-3); } .form-select .ui-icon { display: none; } }
`;

export function renderCheckbox(input:{name:string;label:string;value:string;checked?:boolean}):string {
  return renderSelectionControl({label:input.label,className:"form-check",visibleLabel:true,variant:"data",checked:input.checked,attributes:{name:input.name,value:input.value}});
}
