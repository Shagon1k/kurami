// Kurami button: shared variants, regular/compact sizes, busy state and a link form.
import { escapeHtml } from "../foundations/html.ts";

export type ButtonVariant = "primary" | "secondary" | "subtle" | "quiet" | "icon" | "text";
export type ButtonSize = "regular" | "compact";

type AttributeValue = string | number | boolean | undefined;

export type ButtonInput = {
  label: string;
  variant: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  busyLabel?: string;
  icon?: string;
  iconPath?: string;
  visibleLabel?: boolean;
  ariaLabel?: string;
  attributes?: Record<string, AttributeValue>;
  labelAttributes?: Record<string, AttributeValue>;
};

const SAFE_ATTRIBUTE = /^(?:aria-[a-z][a-z0-9-]*|data-[a-z][a-z0-9-]*|id|name|value|title|hreflang)$/;
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
.button { --button-busy-color: var(--text-primary); min-height: 44px; position: relative; display: inline-flex; align-items: center; justify-content: var(--button-justify,center); gap: 8px; padding: 0 16px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--text-primary); border-radius: var(--radius); cursor: pointer; font: 600 .75rem/1 var(--font-sans); text-decoration: none; transition: color 160ms ease, background 160ms ease, border-color 160ms ease, transform 160ms ease, opacity 160ms ease; }
.button:hover:not(:disabled):not([aria-busy="true"]) { color: var(--surface-page); background: var(--text-primary); border-color: var(--text-primary); }
.button:active:not(:disabled):not([aria-busy="true"]) { transform: translateY(1px); }
.button:focus-visible { outline: 3px solid var(--accent-primary); outline-offset: 3px; }
.button:disabled { color: var(--text-muted); background: var(--surface-panel); border-color: var(--border-default); cursor: not-allowed; opacity: .68; }
.button[aria-busy="true"] { color: transparent; cursor: wait; opacity: 1; pointer-events: none; }
.button[aria-busy="true"]::after { content: attr(data-busy-label); position: absolute; inset: 0; display: inline-flex; align-items: center; justify-content: center; padding: inherit; color: var(--button-busy-color); white-space: nowrap; }
.button--primary { --button-busy-color: var(--text-on-accent); color: var(--text-on-accent); background: var(--accent-primary); border-color: var(--accent-primary); }
.button--primary:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-on-accent); background: color-mix(in srgb, var(--accent-primary) 82%, var(--text-primary)); border-color: color-mix(in srgb, var(--accent-primary) 82%, var(--text-primary)); }
.button--primary[aria-busy="true"] { background: var(--accent-primary); border-color: var(--accent-primary); }
.button--secondary { color: var(--text-primary); background: var(--surface-raised); border-color: var(--text-primary); }
.button--subtle { color: var(--text-primary); background: var(--surface-panel); border-color: var(--border-default); }
.button--subtle:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: var(--surface-section); border-color: var(--text-muted); }
.button--quiet { min-height: 40px; padding-inline: 11px; background: transparent; border-color: transparent; }
.button--quiet:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: var(--surface-panel); border-color: var(--border-default); }
.button--text { min-height: 0; padding: 0; border: 0; background: transparent; font: inherit; line-height: inherit; text-align: start; justify-content: start; }
.button--text:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: transparent; text-decoration: underline; text-underline-offset: .2em; }
.button--icon { inline-size: 44px; block-size: 44px; padding: 0; background: var(--surface-panel); border-color: var(--border-default); }
.button--icon:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-primary); background: var(--accent-soft); border-color: var(--accent-primary); }
.button__icon { display: inline-grid; place-items: center; font-size: 1.125rem; line-height: 1; }
.button__svg { inline-size: 22px; block-size: 22px; display: block; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: square; stroke-linejoin: miter; pointer-events: none; }
.button--compact { min-height: 32px; padding-inline: 10px; font-size: .7rem; font-weight: 500; }
@media (pointer: coarse) { .button--compact { min-height: 44px; } }
`;

export function renderButton(input: ButtonInput): string {
  if (input.className && !SAFE_CLASS_LIST.test(input.className)) {
    throw new Error("Unsafe button class list");
  }
  if (input.icon && input.iconPath) throw new Error("Button cannot have both text and SVG icons");
  const classes = ["button", `button--${input.variant}`, input.size === "compact" ? "button--compact" : undefined, input.className].filter(Boolean).join(" ");
  const type = input.type ?? "button";
  const accessibleLabel = input.ariaLabel ?? (input.iconPath ? input.label : undefined);
  const ariaLabel = accessibleLabel ? ` aria-label="${escapeHtml(accessibleLabel)}"` : "";
  const busyLabel = input.busyLabel
    ? ` data-busy-label="${escapeHtml(input.busyLabel)}"`
    : "";
  const attributes = renderAttributes(input.attributes);
  const disabled = input.disabled ? " disabled" : "";
  const labelAttributes = renderAttributes(input.labelAttributes);
  const content = input.iconPath
    ? `<svg class="button__svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${escapeHtml(input.iconPath)}"/></svg>${input.visibleLabel?`<span${labelAttributes}>${escapeHtml(input.label)}</span>`:""}`
    : input.icon
    ? `<span class="button__icon" aria-hidden="true">${escapeHtml(input.icon)}</span><span class="sr-only"${labelAttributes}>${escapeHtml(input.label)}</span>`
    : input.labelAttributes
      ? `<span${labelAttributes}>${escapeHtml(input.label)}</span>`
      : escapeHtml(input.label);
  return `<button class="${classes}" type="${type}"${ariaLabel}${busyLabel}${attributes}${disabled}>${content}</button>`;
}

/** Navigation that looks like a button; `href` must be a site-relative or https URL. */
export function renderLinkButton(input: { label: string; href: string; variant: ButtonVariant; size?: ButtonSize; ariaLabel?: string; attributes?: Record<string, AttributeValue> }): string {
  if (!/^(?:\/(?!\/)|https:\/\/)/.test(input.href)) throw new Error("Unsafe link button href");
  const ariaLabel = input.ariaLabel ? ` aria-label="${escapeHtml(input.ariaLabel)}"` : "";
  return `<a class="button button--${input.variant}${input.size === "compact" ? " button--compact" : ""}" href="${escapeHtml(input.href)}"${ariaLabel}${renderAttributes(input.attributes)}>${escapeHtml(input.label)}</a>`;
}
