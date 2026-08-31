import { escapeHtml } from "../html.ts";

type AttributeValue = string | number | boolean | undefined;

export type SelectionControlInput = {
  label: string;
  className?: string;
  visibleLabel?: boolean;
  disabled?: boolean;
  checked?: boolean;
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
  return `<label class="${classes}" data-selection-control><input class="selection-control__input" type="checkbox"${attributes}${checked}${disabled}><span class="selection-control__box" aria-hidden="true"></span><span class="${labelClass}">${escapeHtml(input.label)}</span></label>`;
}
