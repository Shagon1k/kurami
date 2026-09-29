// Callout: a short note set apart from running text. Tone colours the leading edge only.
import { escapeHtml } from "../foundations/html.ts";

export type CalloutTone = "note" | "limit" | "warning";

export function renderCallout(input: { tone: CalloutTone; title?: string; body: string; className?: string }): string {
  if (!["note", "limit", "warning"].includes(input.tone)) throw new Error("Invalid callout tone");
  if (input.className && !/^[a-z0-9_-]+(?: [a-z0-9_-]+)*$/.test(input.className)) throw new Error("Unsafe callout class");
  const title = input.title ? `<strong>${escapeHtml(input.title)}</strong>` : "";
  return `<aside class="callout callout--${input.tone}${input.className ? ` ${input.className}` : ""}">${title}<p>${escapeHtml(input.body)}</p></aside>`;
}

export const CALLOUT_CSS = `
.callout { padding: var(--space-4) var(--space-5); border: 1px solid var(--border-default); border-left: 3px solid var(--text-muted); background: var(--surface-panel); line-height: 1.6; }
.callout--limit { border-left-color: var(--accent-primary); }
.callout--warning { border-left-color: var(--status-warning); }
.callout > strong + p { margin: var(--space-2) 0 0; }
.callout > p:only-child { margin: 0; }
`;
