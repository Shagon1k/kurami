import { escapeHtml } from "../html.ts";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "icon";

type AttributeValue = string | number | boolean | undefined;

export type ButtonInput = {
  label: string;
  variant: ButtonVariant;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  busyLabel?: string;
  icon?: string;
  ariaLabel?: string;
  attributes?: Record<string, AttributeValue>;
  labelAttributes?: Record<string, AttributeValue>;
};

const SAFE_ATTRIBUTE = /^(?:aria-[a-z][a-z0-9-]*|data-[a-z][a-z0-9-]*|id|name|value|title)$/;
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

export function renderButton(input: ButtonInput): string {
  if (input.className && !SAFE_CLASS_LIST.test(input.className)) {
    throw new Error("Unsafe button class list");
  }
  const classes = ["button", `button--${input.variant}`, input.className].filter(Boolean).join(" ");
  const type = input.type ?? "button";
  const ariaLabel = input.ariaLabel ? ` aria-label="${escapeHtml(input.ariaLabel)}"` : "";
  const busyLabel = input.busyLabel
    ? ` data-busy-label="${escapeHtml(input.busyLabel)}"`
    : "";
  const attributes = renderAttributes(input.attributes);
  const disabled = input.disabled ? " disabled" : "";
  const labelAttributes = renderAttributes(input.labelAttributes);
  const content = input.icon
    ? `<span class="button__icon" aria-hidden="true">${escapeHtml(input.icon)}</span><span class="sr-only"${labelAttributes}>${escapeHtml(input.label)}</span>`
    : input.labelAttributes
      ? `<span${labelAttributes}>${escapeHtml(input.label)}</span>`
      : escapeHtml(input.label);
  return `<button class="${classes}" type="${type}"${ariaLabel}${busyLabel}${attributes}${disabled}>${content}</button>`;
}
