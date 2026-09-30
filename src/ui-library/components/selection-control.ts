import { escapeHtml } from "../foundations/html.ts";

type AttributeValue = string | number | boolean | undefined;

export type SelectionControlInput = {
  label: string;
  className?: string;
  visibleLabel?: boolean;
  disabled?: boolean;
  checked?: boolean;
  variant?: "signal"|"data";
  attributes?: Record<string, AttributeValue>;
};

const SAFE_ATTRIBUTE = /^(?:aria-[a-z][a-z0-9-]*|data-[a-z][a-z0-9-]*|id|name|value)$/;
const SAFE_CLASS_LIST = /^[A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*$/;

function renderAttributes(attributes: Record<string, AttributeValue> | undefined): string {
  if (!attributes) return "";
  return Object.entries(attributes).map(([name, value]) => {
    if (!SAFE_ATTRIBUTE.test(name)) throw new Error(`Unsafe selection attribute: ${name}`);
    if (value === false || value === undefined) return "";
    if (value === true) return ` ${name}`;
    return ` ${name}="${escapeHtml(String(value))}"`;
  }).join("");
}

export function renderSelectionControl(input: SelectionControlInput): string {
  const className = input.className ?? "selection-control";
  if (!SAFE_CLASS_LIST.test(className)) throw new Error("Unsafe selection class list");
  const classes = [className, input.disabled ? "is-disabled" : ""].filter(Boolean).join(" ");
  const attributes = renderAttributes(input.attributes);
  const checked = input.checked ? " checked" : "";
  const disabled = input.disabled ? " disabled" : "";
  const labelClass = input.visibleLabel ? "selection-control__label" : "sr-only";
  return `<label class="${classes}" data-selection-control${input.variant==="data"?' data-selection-variant="data"':""}><input class="selection-control__input" type="checkbox"${attributes}${checked}${disabled}><span class="selection-control__box" aria-hidden="true"></span><span class="${labelClass}">${escapeHtml(input.label)}</span></label>`;
}

export const SELECTION_CONTROL_CSS=`
[data-selection-control] { --selection-color: var(--accent-primary); --selection-size: 24px; min-height: var(--selection-min-height,24px); position: relative; display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-muted); cursor: pointer; font-size: var(--selection-font-size,.6875rem); line-height: 1.25; }
[data-selection-variant="data"] { --selection-color: var(--accent-data); }
.selection-control__input { position: absolute; inset-inline-start: 0; top: 50%; z-index: 2; width: var(--selection-size); height: var(--selection-size); margin: 0; appearance: none; opacity: 0; cursor: pointer; transform: translateY(-50%); }
.selection-control__box { inline-size: var(--selection-size); block-size: var(--selection-size); position: relative; flex: 0 0 var(--selection-size); display: inline-grid; place-items: center; background: var(--surface-panel); border: 1px solid var(--border-default); border-radius: var(--radius); transition: color var(--duration-fast) ease, background var(--duration-fast) ease, border-color var(--duration-fast) ease, transform var(--duration-fast) ease; }
.selection-control__box::after { content: ""; color: var(--selection-color); pointer-events: none; }
.selection-control__input:checked + .selection-control__box { background: color-mix(in srgb, var(--selection-color) 10%, var(--surface-panel)); border-color: var(--selection-color); }
.selection-control__input:checked + .selection-control__box::after { content: "✓"; font: 600 1.15rem/1 var(--font-note); transform: rotate(-7deg); }
.selection-control__input:indeterminate + .selection-control__box { background: color-mix(in srgb, var(--selection-color) 10%, var(--surface-panel)); border-color: var(--selection-color); }
.selection-control__input:indeterminate + .selection-control__box::after { content: "−"; font: 600 .875rem/1 var(--font-sans); }
[data-selection-control]:hover .selection-control__input:not(:disabled) + .selection-control__box { border-color: var(--selection-color); transform: translateY(-1px); }
.selection-control__input:focus-visible + .selection-control__box { outline: 3px solid var(--selection-color); outline-offset: 3px; }
[data-selection-control].is-disabled, [data-selection-control]:has(.selection-control__input:disabled) { cursor: not-allowed; opacity: .55; }
.selection-control__input:disabled { cursor: not-allowed; }
.selection-control__label { color: var(--text-muted); }
`;
