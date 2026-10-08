// Kurami button: shared variants, regular/compact sizes, busy state and a link form.
import { escapeHtml } from "../foundations/html.ts";
import { breakpoints } from "../tokens/index.ts";

export type ButtonVariant = "primary" | "secondary" | "subtle" | "quiet" | "icon" | "text" | "danger" | "success" | "info" | "warning" | "link" | "toggle" | "navigation" | "switch" | "sort";
export type ButtonSize = "regular" | "compact";

type AttributeValue = string | number | boolean | undefined;

export type ButtonInput = {
  label: string;
  /** Phone label; an empty string keeps only the icon/count. The accessible name stays complete. */
  compactLabel?: string;
  count?: number;
  variant: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  busyLabel?: string;
  icon?: string;
  iconPath?: string;
  iconPosition?: "start" | "end";
  visibleLabel?: boolean;
  ariaLabel?: string;
  attributes?: Record<string, AttributeValue>;
  labelAttributes?: Record<string, AttributeValue>;
};

const SAFE_ATTRIBUTE = /^(?:aria-[a-z][a-z0-9-]*|data-[a-z][a-z0-9-]*|id|name|value|title|hreflang|popovertarget|popovertargetaction)$/;
const SAFE_CLASS_LIST = /^[A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*$/;

function renderAttributes(attributes: Record<string, AttributeValue> | undefined): string {
  if (!attributes) return "";
  return Object.entries(attributes).map(([name, value]) => {
    if (!SAFE_ATTRIBUTE.test(name)) throw new Error(`Unsafe button attribute: ${name}`);
    if (value === false || value === undefined) return "";
    if (value === true) return ` ${name}`;
    return ` ${name}="${escapeHtml(String(value))}"`;
  }).join("");
}

export const BUTTON_CSS = `
.button { --button-busy-color: var(--text-primary); min-height: var(--control-height); inline-size: var(--button-width,auto); position: relative; display: inline-flex; align-items: center; justify-content: var(--button-justify,center); gap: var(--space-2); padding: var(--space-2) var(--space-3); color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--text-primary); border-radius: var(--radius); cursor: pointer; font: 600 .75rem/1.2 var(--font-sans); text-decoration: none; transition: color 160ms ease, background 160ms ease, border-color 160ms ease, transform 160ms ease, opacity 160ms ease; }
.button:hover:not(:disabled):not([aria-busy="true"]) { color: var(--surface-page); background: var(--text-primary); border-color: var(--text-primary); }
.button:active:not(:disabled):not([aria-busy="true"]) { transform: translateY(1px); }
.button:focus-visible { outline: 3px solid var(--accent-primary); outline-offset: 3px; }
.button:disabled { color: var(--text-muted); background: var(--surface-panel); border-color: var(--border-default); cursor: not-allowed; opacity: .68; }
.button[aria-busy="true"] { color: transparent; cursor: wait; opacity: 1; pointer-events: none; }
.button[aria-busy="true"]::after { content: attr(data-busy-label); position: absolute; inset: 0; display: inline-flex; align-items: center; justify-content: center; padding: inherit; color: var(--button-busy-color); white-space: nowrap; }
.button--primary { --button-busy-color: var(--text-on-accent); color: var(--text-on-accent); background: var(--accent-primary); border-color: var(--accent-primary); }
.button--primary:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-on-accent); background: color-mix(in srgb, var(--accent-primary) 82%, var(--text-primary)); border-color: color-mix(in srgb, var(--accent-primary) 82%, var(--text-primary)); }
.button--primary[aria-busy="true"] { background: var(--accent-primary); border-color: var(--accent-primary); }
.button--danger { --button-busy-color: var(--status-failure); color: var(--status-failure); border-color: color-mix(in srgb,var(--status-failure) 35%,var(--border-default)); background: color-mix(in srgb,var(--status-failure) 6%,var(--surface-raised)); }
.button--danger:hover:not(:disabled):not([aria-busy="true"]) { color: var(--surface-page); background: var(--status-failure); border-color: var(--status-failure); }
.button--success { --button-busy-color: color-mix(in srgb,var(--status-success) 65%,var(--text-primary)); color: var(--button-busy-color); border-color: color-mix(in srgb,var(--status-success) 40%,var(--border-default)); background: color-mix(in srgb,var(--status-success) 6%,var(--surface-raised)); }
.button--success:hover:not(:disabled):not([aria-busy="true"]) { color: var(--button-busy-color); background: color-mix(in srgb,var(--status-success) 12%,var(--surface-raised)); border-color: var(--status-success); }
.button--info { --button-busy-color: color-mix(in srgb,var(--status-info) 65%,var(--text-primary)); color: var(--button-busy-color); border-color: color-mix(in srgb,var(--status-info) 40%,var(--border-default)); background: color-mix(in srgb,var(--status-info) 6%,var(--surface-raised)); }
.button--info:hover:not(:disabled):not([aria-busy="true"]) { color: var(--button-busy-color); background: color-mix(in srgb,var(--status-info) 12%,var(--surface-raised)); border-color: var(--status-info); }
.button--warning { --button-busy-color: color-mix(in srgb,var(--status-warning) 65%,var(--text-primary)); color: var(--button-busy-color); border-color: color-mix(in srgb,var(--status-warning) 40%,var(--border-default)); background: color-mix(in srgb,var(--status-warning) 6%,var(--surface-raised)); }
.button--warning:hover:not(:disabled):not([aria-busy="true"]) { color: var(--button-busy-color); background: color-mix(in srgb,var(--status-warning) 12%,var(--surface-raised)); border-color: var(--status-warning); }
.button--secondary { color: var(--text-primary); background: var(--surface-raised); border-color: var(--text-primary); }
.button--subtle { color: var(--text-primary); background: var(--surface-panel); border-color: var(--border-default); }
.button--subtle:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: var(--surface-section); border-color: var(--text-muted); }
.button--toggle { color: var(--text-muted); background: var(--surface-raised); border-color: var(--border-default); font-weight: 500; }
.button--toggle:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: var(--surface-panel); border-color: var(--text-muted); }
.button--toggle[aria-pressed="true"],.button--toggle[aria-pressed="true"]:hover:not(:disabled):not([aria-busy="true"]),.button--toggle[aria-current="true"],.button--toggle[aria-current="true"]:hover:not(:disabled):not([aria-busy="true"]) { color: var(--button-selected-color,var(--text-accent)); background: var(--button-selected-background,var(--accent-soft)); border-color: var(--button-selected-border,color-mix(in srgb,var(--accent-primary) 40%,var(--border-default))); }
.button__label--compact { display: none; }
@media (max-width: ${breakpoints.phone}px) {
  .button__label--full { display: none; }
  .button__label--compact { display: inline; }
}
.button__count { font: 600 .78rem/1.2 var(--font-mono); }
.button--quiet { padding-inline: var(--space-2); background: transparent; border-color: transparent; }
.button--quiet:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: var(--surface-panel); border-color: var(--border-default); }
.button--sort { --button-icon-size: 14px; padding-inline: 0; border: 0; background: transparent; color: var(--text-muted); font: inherit; font-weight: 500; }
.button--sort:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: transparent; }
.button--sort[aria-pressed="true"] { color: var(--text-primary); font-weight: 600; text-decoration: underline; text-decoration-color: var(--accent-data); text-decoration-thickness: 2px; text-underline-offset: .45em; }
.button--link { padding: 0; border: 0; color: var(--text-accent); background: transparent; font-weight: 500; text-decoration: underline; text-underline-offset: .2em; }
.button--link:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: transparent; border-color: transparent; }
.button--link .button__svg { inline-size: 14px; block-size: 14px; }
.button--text { min-height: 0; padding: 0; border: 0; background: transparent; font: inherit; line-height: inherit; text-align: start; justify-content: start; }
.button--text:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: transparent; text-decoration: underline; text-underline-offset: .2em; }
.button--truncate { min-width: 0; max-width: 100%; }
.button__label--truncate { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.button--text:focus-visible .button__label--truncate { text-decoration: underline; text-underline-offset: .2em; }
.button--icon { inline-size: var(--button-width,var(--control-height)); block-size: var(--control-height); padding: 0; background: var(--surface-panel); border-color: var(--border-default); }
.button--icon:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: var(--accent-soft); border-color: var(--accent-primary); }
.button--icon[aria-pressed="true"],.button--icon[aria-pressed="true"]:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-on-accent); background: var(--accent-primary); border-color: var(--accent-primary); }
.button--switch,.button--switch:hover:not(:disabled):not([aria-busy="true"]),.button--switch[aria-pressed="true"],.button--switch[aria-pressed="true"]:hover:not(:disabled):not([aria-busy="true"]) { inline-size: 52px; block-size: 44px; min-height: 44px; padding: 0; border: 0; color: var(--text-primary); background: transparent; }
.button--switch .button__icon { display: none; }
.button--switch::before { content: ""; position: absolute; inset: 8px 0; border: 1px solid var(--border-default); border-radius: var(--radius-pill); background: var(--surface-section); transition: background 160ms ease; }
.button--switch::after { content: ""; position: absolute; width: 20px; height: 20px; left: 4px; top: 12px; border-radius: var(--radius-pill); background: var(--text-muted); transition: transform 180ms ease, background 160ms ease; }
.button--switch[aria-pressed="true"]::before { background: var(--accent-data); border-color: var(--accent-data); }
.button--switch[aria-pressed="true"]::after { transform: translateX(24px); background: var(--surface-raised); }
.button__icon { display: inline-grid; place-items: center; font-size: 1rem; line-height: 1; }
.button__svg { inline-size: var(--button-icon-size,18px); block-size: var(--button-icon-size,18px); flex: none; display: block; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.button--icon-end .button__svg { order: 1; }
.button--compact { min-height: 32px; padding-inline: 10px; font-size: .7rem; font-weight: 500; }
.button--navigation { --button-icon-size: var(--navigation-icon-size,32px); min-height: var(--navigation-button-height,82px); min-width: 0; flex-direction: column; justify-content: flex-start; gap: var(--navigation-button-gap,6px); padding: var(--navigation-button-padding,12px 0 14px); border: 0; border-radius: var(--navigation-button-radius,0); background: transparent; font: 400 .875rem/18px var(--font-sans); white-space: nowrap; }
.button--navigation .button__svg { stroke-width: var(--navigation-icon-stroke,1.8); transition: transform 220ms cubic-bezier(.2,.8,.2,1), color 160ms ease; }
.button--navigation:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: transparent; }
.button--navigation[aria-expanded="true"],.button--navigation[aria-expanded="true"]:hover:not(:disabled):not([aria-busy="true"]) { color: var(--navigation-active-label,var(--text-primary)); background: var(--navigation-active-background,color-mix(in srgb,var(--accent-data) 10%,var(--surface-raised))); }
.button--navigation[aria-expanded="true"] .button__svg { color: var(--navigation-active-icon,var(--accent-data)); transform: var(--navigation-icon-open-transform,translateY(-2px) scale(1.06)); }
.button--navigation[aria-expanded="true"]::after { content: ""; display: var(--navigation-indicator-display,block); position: absolute; bottom: 8px; width: 18px; height: 2px; background: var(--accent-data); }
@media(max-width:360px) { .button--navigation { font-size: .8125rem; } }
@media(prefers-reduced-motion:reduce) { .button--navigation,.button--navigation .button__svg { transition: none; transform: none; } .button--navigation[aria-expanded="true"] .button__svg { transform: none; } }
@media (pointer: coarse) { .button--compact { min-height: var(--control-height); } }
`;

export function renderButton(input: ButtonInput): string {
  if(input.count!==undefined&&(!Number.isSafeInteger(input.count)||input.count<0))throw new Error("Invalid button count");
  if (input.className && !SAFE_CLASS_LIST.test(input.className)) {
    throw new Error("Unsafe button class list");
  }
  if (input.icon && input.iconPath) throw new Error("Button cannot have both text and SVG icons");
  const classes = ["button", `button--${input.variant}`, input.size === "compact" ? "button--compact" : undefined, input.iconPosition === "end" ? "button--icon-end" : undefined, input.className].filter(Boolean).join(" ");
  const type = input.type ?? "button";
  const count=input.count===undefined?"":`<strong class="button__count">${input.count}</strong> `;
  const accessibleLabel = input.ariaLabel ?? (input.iconPath||count||input.compactLabel!==undefined ? `${input.count===undefined?"":`${input.count} `}${input.label}` : undefined);
  const ariaLabel = accessibleLabel ? ` aria-label="${escapeHtml(accessibleLabel)}"` : "";
  const busyLabel = input.busyLabel
    ? ` data-busy-label="${escapeHtml(input.busyLabel)}"`
    : "";
  const attributes = renderAttributes(input.attributes);
  const disabled = input.disabled ? " disabled" : "";
  const labelAttributes = renderAttributes(input.labelAttributes);
  const label = input.compactLabel===undefined
    ? `<span${labelAttributes}>${escapeHtml(input.label)}</span>`
    : `<span class="button__label--full"${labelAttributes}>${escapeHtml(input.label)}</span>${input.compactLabel ? `<span class="button__label--compact" aria-hidden="true">${escapeHtml(input.compactLabel)}</span>` : ""}`;
  const content = input.iconPath
    ? `<svg class="button__svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${escapeHtml(input.iconPath)}"/></svg>${count}${input.visibleLabel?label:""}`
    : input.icon
    ? `<span class="button__icon" aria-hidden="true">${escapeHtml(input.icon)}</span>${count}<span class="sr-only"${labelAttributes}>${escapeHtml(input.label)}</span>`
    : input.labelAttributes||input.compactLabel!==undefined
      ? `${count}${label}`
      : `${count}${escapeHtml(input.label)}`;
  return `<button class="${classes}" type="${type}"${ariaLabel}${busyLabel}${attributes}${disabled}>${input.variant==="switch"?`<span class="sr-only">${escapeHtml(input.label)}</span>`:content}</button>`;
}

/** Navigation that looks like a button; `href` must be a site-relative or https URL. */
export function renderLinkButton(input: { label: string; href: string; variant: ButtonVariant; size?: ButtonSize; ariaLabel?: string; iconPath?: string; visibleLabel?: boolean; truncate?: boolean; className?: string; target?: "_blank"; attributes?: Record<string, AttributeValue> }): string {
  if (!/^(?:\/(?!\/)|https:\/\/)/.test(input.href)) throw new Error("Unsafe link button href");
  if(input.className&&!SAFE_CLASS_LIST.test(input.className))throw new Error("Unsafe link button class list");
  if(input.visibleLabel===false&&!input.iconPath)throw new Error("Hidden link label requires an icon");
  const name=input.ariaLabel??(input.visibleLabel===false?input.label:undefined);
  const ariaLabel = name ? ` aria-label="${escapeHtml(name)}"` : "";
  const label=input.visibleLabel===false?"":input.truncate?`<span class="button__label--truncate">${escapeHtml(input.label)}</span>`:escapeHtml(input.label);
  return `<a class="button button--${input.variant}${input.size === "compact" ? " button--compact" : ""}${input.truncate?" button--truncate":""}${input.className?` ${input.className}`:""}" href="${escapeHtml(input.href)}"${input.target?' target="_blank" rel="noopener noreferrer"':""}${ariaLabel}${renderAttributes(input.attributes)}>${label}${input.iconPath?`<svg class="button__svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${escapeHtml(input.iconPath)}"/></svg>`:""}</a>`;
}
