import {escapeHtml} from "../foundations/html.ts";
import {renderButton} from "./button.ts";
import {breakpoints} from "../tokens/index.ts";

export function renderPeriodSwitch(input:{key:string;lang:"en"|"ru";selected?:7|30;label:string;floating?:boolean;cycle?:boolean}):string {
  if(!/^[a-z][a-z0-9-]*$/.test(input.key))throw new Error("Invalid period key");
  const choices=`<div class="period-switch" role="group" aria-label="${escapeHtml(input.label)}">${([7,30] as const).map(days=>renderButton({
    label:`${days}${input.lang==="ru"?"д":"d"}`,ariaLabel:`${days} ${input.lang==="ru"?"дней":"days"}`,
    variant:"quiet",size:"compact",className:"period-switch__option",
    attributes:{"data-period-key":input.key,"data-period-days":days,"aria-pressed":String(days===(input.selected??30))},
  })).join("")}</div>`;
  if(!input.floating)return choices;
  const id=`period-${input.key}-choices`;
  return `<div class="period-control" data-floating-period="${input.key}">${renderButton({label:`${input.selected??30}${input.lang==="ru"?"д":"d"}`,variant:"subtle",className:"period-control__trigger",ariaLabel:input.label,attributes:{"data-period-trigger":input.key,"data-period-cycle":input.cycle||undefined,...(input.cycle?{}:{"aria-expanded":"false","aria-controls":id})}})}<div class="period-control__choices" id="${id}">${choices}</div></div>`;
}

export const PERIOD_CLIENT_SCRIPT=`(()=>{
  const media=matchMedia('(max-width: ${breakpoints.phone}px)');
  for(const control of document.querySelectorAll('[data-floating-period]')){
    const anchor=document.createComment('period control');control.before(anchor);
    const trigger=control.querySelector('[data-period-trigger]'),choices=control.querySelector('.period-control__choices');
    const isOpen=()=>choices.hasAttribute('popover')?choices.matches(':popover-open'):choices.classList.contains('is-open');
    const close=()=>{if(choices.hasAttribute('popover')&&isOpen())choices.hidePopover();choices.classList.remove('is-open');if(!trigger.hasAttribute('data-period-cycle'))trigger.setAttribute('aria-expanded','false');};
    const position=()=>{const rect=trigger.getBoundingClientRect();choices.style.setProperty('--period-left',Math.max(8,Math.min(innerWidth-136,rect.right-128))+'px');choices.style.setProperty('--period-top',Math.max(8,rect.top-60)+'px');};
    const adapt=()=>{close();if(media.matches){document.body.append(control);if(typeof choices.showPopover==='function')choices.setAttribute('popover','auto');}else{anchor.after(control);choices.removeAttribute('popover');}};
    trigger.addEventListener('click',()=>{if(trigger.hasAttribute('data-period-cycle')){choices.querySelector('[aria-pressed="false"]')?.click();return;}if(isOpen()){close();return;}position();if(choices.hasAttribute('popover'))choices.showPopover();else choices.classList.add('is-open');trigger.setAttribute('aria-expanded','true');choices.querySelector('[aria-pressed="true"]')?.focus();});
    choices.addEventListener('toggle',event=>trigger.setAttribute('aria-expanded',String(event.newState==='open')));
    choices.addEventListener('click',event=>{if(event.target.closest('[data-period-days]')){close();if(media.matches)trigger.focus();}});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&isOpen()){close();trigger.focus();}});
    document.addEventListener('click',event=>{if(!control.contains(event.target))close();});
    addEventListener('resize',()=>{if(isOpen())position();});media.addEventListener('change',adapt);adapt();
  }
})();`;

export const PERIOD_SWITCH_CSS=`
.period-switch { display: inline-flex; flex-shrink: 0; align-items: center; gap: var(--space-1); padding: var(--space-1); border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--surface-panel); }
.period-switch__option { min-inline-size: var(--control-height); color: var(--text-muted); font-family: var(--font-mono); }
.period-switch__option[aria-pressed="true"] { color: var(--text-primary); background: var(--surface-raised); border-color: var(--border-default); }
.period-switch__option:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: var(--surface-raised); border-color: var(--text-muted); }
.period-control__trigger { display: none; }
@media(max-width:${breakpoints.phone}px) {
  .period-control { position: fixed; right: max(var(--space-4),env(safe-area-inset-right)); bottom: calc(var(--mobile-navigation-height,0px) + var(--space-4) + env(safe-area-inset-bottom)); z-index: 35; }
  .period-control__trigger { display: inline-flex; min-width: 54px; min-height: 44px; border-radius: var(--radius-pill); box-shadow: var(--shadow-raised); font-family: var(--font-mono); }
  .period-control__choices { --period-top: 0px; --period-left: 0px; display: none; position: fixed; inset: auto; top: var(--period-top); left: var(--period-left); width: max-content; margin: 0; padding: 0; border: 0; background: transparent; box-shadow: var(--shadow-raised); }
  .period-control__choices:popover-open,.period-control__choices.is-open { display: block; }
  .period-control__choices::backdrop { background: transparent; }
  .period-control .period-switch__option { min-height: 44px; }
  body:has(dialog[open]) .period-control { visibility: hidden; }
}
`;
