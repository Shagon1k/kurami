// Disclosure: native <details> with a 44 px summary target. `boxed` frames it as a panel.
import { escapeHtml } from "../foundations/html.ts";

/** `body` is trusted markup from a product renderer; the summary is escaped. */
export function renderDisclosure(input: { summary: string; body: string; boxed?: boolean; open?: boolean; className?: string }): string {
  if (input.className && !/^[a-z0-9_-]+(?: [a-z0-9_-]+)*$/.test(input.className)) throw new Error("Unsafe disclosure class");
  const classes = ["disclosure", input.boxed && "disclosure--boxed", input.className].filter(Boolean).join(" ");
  return `<details class="${classes}"${input.open ? " open" : ""}><summary>${escapeHtml(input.summary)}</summary>${input.body}</details>`;
}

export const DISCLOSURE_CSS = `
.disclosure > summary { width: fit-content; min-height: 44px; display: list-item; align-content: center; cursor: pointer; font-weight: 600; }
.disclosure--boxed { padding: var(--space-1) var(--space-4); border: 1px solid var(--border-default); background: var(--surface-panel); }
.disclosure--boxed > summary { width: auto; }
.disclosure--boxed[open] { padding-bottom: var(--space-4); }
.disclosure[open] > summary { margin-bottom: var(--space-2); }
`;
