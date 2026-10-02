// Data table: caption, optional row headers, right-aligned numeric columns, horizontal scroll, and an
// optional stacked layout on phones where each cell carries its column name.
import { escapeHtml } from "../foundations/html.ts";
import { breakpoints } from "../tokens/index.ts";

/** Plain text is escaped; `{html}` is trusted markup from a product renderer. */
export type TableCell = string | { html: string };
export type TableInput = {
  caption?: string;
  /** Keeps the caption for assistive technology only, when a visible heading already names the table. */
  captionHidden?: boolean;
  columns: readonly string[];
  rows: readonly (readonly TableCell[])[];
  headers?: readonly TableCell[];
  sortDirections?: readonly ("ascending" | "descending" | "none")[];
  rowHeaders?: boolean;
  numeric?: boolean;
  stack?: boolean;
  className?: string;
  rowClassNames?: readonly string[];
};

const cell = (value: TableCell) => typeof value === "string" ? escapeHtml(value) : value.html;

export function renderTable(input: TableInput): string {
  if (input.className && !/^[a-z0-9_-]+(?: [a-z0-9_-]+)*$/.test(input.className)) throw new Error("Unsafe table class");
  if (input.rows.some(row => row.length !== input.columns.length)) throw new Error("Table row does not match its columns");
  if (input.rowClassNames && (input.rowClassNames.length !== input.rows.length || input.rowClassNames.some(value => !/^[a-z0-9_-]+(?: [a-z0-9_-]+)*$/.test(value)))) throw new Error("Invalid table row classes");
  if(input.headers && input.headers.length!==input.columns.length)throw new Error("Table header count mismatch");
  if(input.sortDirections && (input.sortDirections.length!==input.columns.length || input.sortDirections.some(value=>!["ascending","descending","none"].includes(value))))throw new Error("Invalid table sort directions");
  const classes = ["table", input.numeric && "table--numeric", input.stack && "table--stack", input.className].filter(Boolean).join(" ");
  const caption = input.caption ? `<caption${input.captionHidden ? ' class="sr-only"' : ""}>${escapeHtml(input.caption)}</caption>` : "";
  const head = `<thead><tr>${input.columns.map((column,index) => `<th scope="col"${input.sortDirections?` aria-sort="${input.sortDirections[index]}"`:""}>${input.headers?cell(input.headers[index]!):escapeHtml(column)}</th>`).join("")}</tr></thead>`;
  const body = input.rows.map((row,rowIndex) => `<tr${input.rowClassNames ? ` class="${input.rowClassNames[rowIndex]}"` : ""}>${row.map((value, index) => index === 0 && input.rowHeaders
    ? `<th scope="row">${cell(value)}</th>`
    : `<td>${input.stack ? `<span class="table__label" aria-hidden="true">${escapeHtml(input.columns[index])}</span>` : ""}${cell(value)}</td>`).join("")}</tr>`).join("");
  return `<div class="${classes}"><table>${caption}${head}<tbody>${body}</tbody></table></div>`;
}

// Products tune density with --table-font-size and --table-cell-padding on the wrapper.
export const TABLE_CSS = `
.table { --table-stack-row-display: block; --table-stack-row-columns: none; --table-stack-header-column: auto; --table-stack-cell-width: 100%; max-width: 100%; max-height: var(--table-max-height,none); overflow: auto; overscroll-behavior: var(--table-overscroll,auto); }
.table table { width: 100%; border-collapse: collapse; font-size: var(--table-font-size, .84rem); }
.table caption { margin-bottom: var(--space-3); color: var(--text-accent); font-weight: 600; text-align: left; }
.table th, .table td { padding: var(--table-cell-padding, 12px 8px); border-bottom: 1px solid var(--border-default); text-align: left; vertical-align: top; }
.table thead th { vertical-align: middle; padding: var(--table-head-padding,var(--table-cell-padding,12px 8px)); }
.table thead { position: var(--table-head-position,static); top: 0; z-index: 1; background: var(--table-head-background, transparent); }
.table th[scope="row"] { font-weight: 600; }
.table--numeric th:not(:first-child), .table--numeric td:not(:first-child) { text-align: right; white-space: nowrap; }
.table__label { display: none; }
@media (max-width: ${breakpoints.phone}px) {
  .table--stack { overflow: visible; }
  .table--stack table, .table--stack tbody, .table--stack tr, .table--stack caption { display: block; width: 100%; }
  .table--stack thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .table--stack tr { display: var(--table-stack-row-display); grid-template-columns: var(--table-stack-row-columns); padding: var(--table-stack-row-padding,var(--space-3) 0); border-bottom: 1px solid var(--border-default); }
  .table--stack th[scope="row"], .table--stack td, .table--stack.table--numeric td:not(:first-child) { display: block; width: var(--table-stack-cell-width); min-width: 0; padding: var(--space-1) 0; border: 0; text-align: left; white-space: normal; }
  .table--stack th[scope="row"] { grid-column: var(--table-stack-header-column); }
  .table--stack .table__label { display: var(--table-stack-label-display,block); margin-top: var(--space-1); color: var(--text-muted); font: 500 .67rem var(--font-mono); text-transform: uppercase; }
}
`;
