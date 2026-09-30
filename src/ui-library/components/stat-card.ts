import {escapeHtml} from "../foundations/html.ts";
import {renderIcon,type IconName} from "./icon.ts";
export type StatTone="neutral"|"info"|"success"|"warning"|"failure";
export function renderStatCard(input:{label:string;value:string;full?:string;tone?:StatTone;icon?:IconName;plain?:boolean;align?:"center"|"start"}):string {
  const {full}=input;
  return `<article class="stat-card metric${input.plain?" stat-card--plain":""}" data-tone="${input.tone??"neutral"}" data-align="${input.align??"center"}"><p class="stat-card__label metric__label">${input.icon?renderIcon(input.icon):""}${escapeHtml(input.label)}</p><strong class="stat-card__value metric__value"${full?` tabindex="0" title="${escapeHtml(full)}" aria-label="${escapeHtml(full)}"`:""}>${escapeHtml(input.value)}</strong></article>`;
}
export function renderMeter(input:{value:number;label:string;tone?:StatTone}):string {
  if(!Number.isFinite(input.value)||input.value<0||input.value>100)throw new Error("Invalid meter value");
  return `<div class="ui-meter" data-tone="${input.tone??"info"}" role="meter" aria-label="${escapeHtml(input.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${input.value}"><span style="--meter-fill:${input.value}%"></span></div>`;
}
export const STAT_CARD_CSS=`
.stat-card,.ui-meter { --stat-tone: var(--text-primary); }
:is(.stat-card,.ui-meter)[data-tone="info"] { --stat-tone: var(--status-info); }
:is(.stat-card,.ui-meter)[data-tone="success"] { --stat-tone: var(--status-success); }
:is(.stat-card,.ui-meter)[data-tone="warning"] { --stat-tone: var(--status-warning); }
:is(.stat-card,.ui-meter)[data-tone="failure"] { --stat-tone: var(--status-failure); }
.stat-card { min-width: 0; height: 100%; padding: var(--space-5) var(--space-4); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-raised); text-align: center; }
.stat-card[data-tone]:not([data-tone="neutral"]):not(.stat-card--plain) { background: color-mix(in srgb, var(--stat-tone) 4%, var(--surface-raised)); }
.stat-card[data-align="start"] { text-align: start; }
.stat-card__label { display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--stat-label-height,2.8em); margin: 0 0 var(--space-3); color: var(--text-muted); font: 500 .8rem/1.4 var(--font-sans); }
.stat-card[data-align="start"] .stat-card__label { justify-content: flex-start; }
.stat-card__label .ui-icon { color: var(--stat-tone); }
.stat-card__value { display: block; color: var(--stat-tone); font: 600 var(--stat-value-size,clamp(1.8rem,3vw,2.5rem))/1.1 var(--font-sans); font-variant-numeric: tabular-nums; letter-spacing: -.04em; }
.stat-card--plain,.stat-card--plain[data-tone] { --stat-label-height: 1.5em; height: auto; padding: 0; border: 0; background: transparent; }
.ui-meter { height: 5px; overflow: hidden; border-radius: var(--radius); background: var(--surface-section); }
.ui-meter > span { display: block; width: var(--meter-fill); height: 100%; background: var(--stat-tone); }
`;
