import {escapeHtml} from "../foundations/html.ts";
import {renderIcon,type IconName} from "./icon.ts";

export type PillTone="neutral"|"info"|"success"|"warning"|"failure";
export function renderPill(input:{label:string;tone?:PillTone;icon?:IconName;title?:string}):string {
  const tone=input.tone??"neutral";
  if(!["neutral","info","success","warning","failure"].includes(tone))throw new Error("Invalid pill tone");
  return `<span class="pill pill--${tone}"${input.title?` title="${escapeHtml(input.title)}"`:""}>${input.icon?renderIcon(input.icon):'<span class="pill__dot" aria-hidden="true"></span>'}<span>${escapeHtml(input.label)}</span></span>`;
}
export const PILL_CSS=`
.pill { --pill-color: var(--text-muted); display: inline-flex; align-items: center; align-self: center; justify-self: start; gap: var(--space-1); min-width: min-content; max-width: 100%; padding: calc(var(--space-1) / 2) var(--space-2); border: 1px solid color-mix(in srgb,var(--pill-color) 22%,var(--border-subtle)); border-radius: var(--radius-pill); background: color-mix(in srgb,var(--pill-color) 7%,var(--surface-raised)); color: var(--pill-color); font: 500 .6875rem/1.35 var(--font-sans); overflow-wrap: normal; }
.pill--info { --pill-color: var(--status-info); }
.pill--success { --pill-color: var(--status-success); }
.pill--warning { --pill-color: var(--status-warning); }
.pill--failure { --pill-color: var(--status-failure); }
.pill__dot { width: 4px; height: 4px; border-radius: var(--radius-pill); background: currentColor; flex: none; }
.pill { white-space: var(--pill-white-space,normal); }
.pill .ui-icon { width: 12px; height: 12px; }
`;
