import {escapeHtml} from "../foundations/html.ts";
import {renderButton} from "./button.ts";

export function renderPeriodSwitch(input:{key:string;lang:"en"|"ru";selected?:7|30;label:string}):string {
  if(!/^[a-z][a-z0-9-]*$/.test(input.key))throw new Error("Invalid period key");
  return `<div class="period-switch" role="group" aria-label="${escapeHtml(input.label)}">${([7,30] as const).map(days=>renderButton({
    label:`${days}${input.lang==="ru"?"д":"d"}`,ariaLabel:`${days} ${input.lang==="ru"?"дней":"days"}`,
    variant:"quiet",size:"compact",className:"period-switch__option",
    attributes:{"data-period-key":input.key,"data-period-days":days,"aria-pressed":String(days===(input.selected??30))},
  })).join("")}</div>`;
}

export const PERIOD_SWITCH_CSS=`
.period-switch { display: inline-flex; flex-shrink: 0; align-items: center; gap: var(--space-1); padding: var(--space-1); border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--surface-panel); }
.period-switch__option { min-inline-size: 40px; color: var(--text-muted); font-family: var(--font-mono); }
.period-switch__option[aria-pressed="true"] { color: var(--text-primary); background: var(--surface-raised); border-color: var(--border-default); }
.period-switch__option:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: var(--surface-raised); border-color: var(--text-muted); }
@media (pointer: coarse) { .period-switch__option { min-inline-size: 44px; } }
`;
