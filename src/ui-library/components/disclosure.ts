// Disclosure: native <details> with a 44 px summary target. `boxed` frames it as a panel.
import { escapeHtml } from "../foundations/html.ts";
import {renderIcon} from "./icon.ts";

/** `body` is trusted markup from a product renderer; the summary is escaped. */
export function renderDisclosure(input: { summary: string; body: string; boxed?: boolean; open?: boolean; className?: string; key?:string; id?:string; variant?:"plain"|"inline"|"row" }): string {
  if (input.className && !/^[a-z0-9_-]+(?: [a-z0-9_-]+)*$/.test(input.className)) throw new Error("Unsafe disclosure class");
  if(input.id && !/^[A-Za-z][A-Za-z0-9_:.-]*$/.test(input.id))throw new Error("Invalid disclosure ID");
  const classes = ["disclosure", input.boxed && "disclosure--boxed", (input.variant==="inline"||input.variant==="row")&&"disclosure--inline", input.variant==="row"&&"disclosure--row", input.className].filter(Boolean).join(" ");
  return `<details class="${classes}"${input.id?` id="${escapeHtml(input.id)}"`:""}${input.key?` data-disclosure-key="${escapeHtml(input.key)}"`:""}${input.open ? " open" : ""}><summary>${input.variant==="inline"||input.variant==="row"?`<span class="disclosure__chevron" aria-hidden="true">${renderIcon("chevronDown")}</span>`:""}${escapeHtml(input.summary)}</summary>${input.body}</details>`;
}

export const DISCLOSURE_CSS = `
.disclosure { --disclosure-summary-font-size: .75rem; --disclosure-summary-font-weight: 500; --disclosure-summary-color: var(--text-muted); --disclosure-summary-padding-inline: var(--space-2); --disclosure-summary-min-height: var(--control-height); }
.disclosure > summary { width: var(--disclosure-summary-width,fit-content); min-height: var(--control-height); display: list-item; align-content: center; cursor: pointer; font-weight: 600; }
.disclosure--boxed { padding: var(--space-1) var(--space-4); border: 1px solid var(--border-default); background: var(--surface-panel); }
.disclosure--boxed > summary { width: auto; }
.disclosure--boxed[open] { padding-bottom: var(--space-4); }
.disclosure[open] > summary { margin-bottom: var(--space-2); }
.disclosure--inline > summary { display: flex; align-items: center; gap: var(--space-2); list-style: none; min-height: var(--disclosure-summary-min-height); padding-inline: var(--disclosure-summary-padding-inline); color: var(--disclosure-summary-color); font-size: var(--disclosure-summary-font-size); font-weight: var(--disclosure-summary-font-weight); border-radius: var(--radius); margin: var(--disclosure-margin,0); }
.disclosure--inline > summary::-webkit-details-marker { display: none; }
.disclosure__chevron { display: inline-flex; flex: none; width: 14px; height: 14px; transform: rotate(-90deg); transition: transform var(--duration-fast); }
.disclosure__chevron svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.disclosure--inline[open] > summary .disclosure__chevron { transform: rotate(0); }
.disclosure--inline[open] > summary { color: var(--text-primary); background: var(--surface-section); }
.disclosure--inline > summary:hover { color: var(--text-primary); background: var(--surface-section); }
.disclosure--inline > summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.disclosure--row { --disclosure-summary-row: 1; --disclosure-body-row: 2; --disclosure-row-span: 2; display: grid; min-width: 0; grid-template-columns: subgrid; grid-template-rows: subgrid; grid-column: 1 / -1; grid-row: 1 / span var(--disclosure-row-span); pointer-events: none; }
.disclosure--row > summary { grid-column: -2 / -1; grid-row: var(--disclosure-summary-row); align-self: center; pointer-events: auto; }
.disclosure--row[open] > summary { margin-bottom: 0; }
.disclosure--row::details-content { display: contents; }
.disclosure--row > :not(summary) { grid-column: 1 / -1; grid-row: var(--disclosure-body-row); pointer-events: auto; }
.disclosure--row:not([open]) > :not(summary) { display: none; }
`;
