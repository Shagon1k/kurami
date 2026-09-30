// Disclosure: native <details> with a 44 px summary target. `boxed` frames it as a panel.
import { escapeHtml } from "../foundations/html.ts";

/** `body` is trusted markup from a product renderer; the summary is escaped. */
export function renderDisclosure(input: { summary: string; body: string; boxed?: boolean; open?: boolean; className?: string; key?:string; variant?:"plain"|"inline" }): string {
  if (input.className && !/^[a-z0-9_-]+(?: [a-z0-9_-]+)*$/.test(input.className)) throw new Error("Unsafe disclosure class");
  const classes = ["disclosure", input.boxed && "disclosure--boxed", input.variant==="inline"&&"disclosure--inline", input.className].filter(Boolean).join(" ");
  return `<details class="${classes}"${input.key?` data-disclosure-key="${escapeHtml(input.key)}"`:""}${input.open ? " open" : ""}><summary>${escapeHtml(input.summary)}</summary>${input.body}</details>`;
}

export const DISCLOSURE_CSS = `
.disclosure > summary { width: fit-content; min-height: 44px; display: list-item; align-content: center; cursor: pointer; font-weight: 600; }
.disclosure--boxed { padding: var(--space-1) var(--space-4); border: 1px solid var(--border-default); background: var(--surface-panel); }
.disclosure--boxed > summary { width: auto; }
.disclosure--boxed[open] { padding-bottom: var(--space-4); }
.disclosure[open] > summary { margin-bottom: var(--space-2); }
.disclosure--inline > summary { display: flex; align-items: center; gap: var(--space-2); list-style: none; min-height: 44px; padding-inline: var(--space-2); color: var(--text-muted); font-size: .75rem; font-weight: 500; border-radius: var(--radius); position: var(--disclosure-position,static); top: var(--disclosure-top,auto); right: var(--disclosure-right,auto); margin: var(--disclosure-margin,0); }
.disclosure--inline > summary::-webkit-details-marker { display: none; }
.disclosure--inline > summary::before { content: "›"; font: 500 1.2rem/1 var(--font-sans); transform: rotate(0); transition: transform var(--duration-fast); }
.disclosure--inline[open] > summary::before { transform: rotate(90deg); }
.disclosure--inline > summary:hover { color: var(--text-primary); background: var(--surface-section); }
.disclosure--inline > summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
`;
