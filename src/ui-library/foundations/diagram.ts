// Diagrams are authored as static SVG in the light palette. Inlined into a page, their fixed colours map
// to diagram-* roles (keeping the original as fallback), so they follow the active theme and page fonts.
import { escapeHtml } from "./html.ts";

const palette: Record<string, string> = {
  "#ffffff": "diagram-surface", "#fff": "diagram-surface",
  "#faf8f2": "diagram-panel", "#fff0ed": "diagram-accent-soft",
  "#0b0b0b": "diagram-ink", "#5e5e59": "diagram-muted", "#e21b16": "diagram-accent",
};

function paint(tag: string): string {
  const declarations: string[] = [];
  const stripped = tag.replace(/\s(fill|stroke)="(#[0-9a-fA-F]{3,6})"/g, (_match, property: string, hex: string) => {
    const role = palette[hex.toLowerCase()];
    if (!role) throw new Error(`Diagram colour ${hex} is outside the diagram palette`);
    declarations.push(`${property}:var(--${role},${hex.toLowerCase()})`);
    return "";
  });
  if (!declarations.length) return tag;
  if (/\sstyle=/.test(stripped)) throw new Error("Diagram element already has an inline style");
  return stripped.replace(/^<([a-zA-Z]+)/, `<$1 style="${declarations.join(";")}"`);
}

/** Returns inline SVG markup: themed colours, ids namespaced by `id`, and one accessible name. */
export function inlineDiagram(svg: string, input: { id: string; label: string }): string {
  if (!/^[a-z][a-z0-9-]*$/.test(input.id)) throw new Error("Invalid diagram id");
  if (/<script\b|\son[a-z]+=|javascript:/i.test(svg)) throw new Error("Unsafe diagram markup");
  const prefix = `${input.id}-`;
  return svg.trim()
    .replace(/\sid="([^"]+)"/g, (_match, id: string) => ` id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_match, id: string) => `url(#${prefix}${id})`)
    .replace(/\saria-labelledby="[^"]*"/, "")
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>|<desc\b[^>]*>[\s\S]*?<\/desc>/g, "")
    .replace(/^<svg\b/, `<svg class="diagram" aria-label="${escapeHtml(input.label)}"`)
    .replace(/<[a-zA-Z]+\b[^>]*>/g, paint);
}

export const DIAGRAM_CSS = `.diagram { display: block; width: 100%; height: auto; max-width: 100%; }`;
