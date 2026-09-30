// Callout: a short note set apart from running text. Tone colours the leading edge only.
import { escapeHtml } from "../foundations/html.ts";

export type CalloutTone = "note" | "limit" | "warning";

/** Plain `body` is escaped into one paragraph; `{html}` is trusted block markup from a product renderer. */
export function renderCallout(input: { tone: CalloutTone; title?: string; body: string | { html: string }; className?: string }): string {
  if (!["note", "limit", "warning"].includes(input.tone)) throw new Error("Invalid callout tone");
  if (input.className && !/^[a-z0-9_-]+(?: [a-z0-9_-]+)*$/.test(input.className)) throw new Error("Unsafe callout class");
  const title = input.title ? `<strong>${escapeHtml(input.title)}</strong>` : "";
  const body = typeof input.body === "string" ? `<p>${escapeHtml(input.body)}</p>` : input.body.html;
  return `<aside class="callout callout--${input.tone}${input.className ? ` ${input.className}` : ""}">${title}${body}</aside>`;
}

export const CALLOUT_CSS = `
.callout { padding: var(--space-4) var(--space-5); border: 1px solid var(--border-default); border-left: 3px solid var(--text-muted); background: var(--surface-panel); line-height: 1.6; }
.callout--limit { border-left-color: var(--accent-primary); }
.callout--warning { border-left-color: var(--status-warning); }
.callout > strong + * { margin-top: var(--space-2); }
.callout > :last-child { margin-bottom: 0; }
.callout > p:only-child { margin: 0; }
`;
