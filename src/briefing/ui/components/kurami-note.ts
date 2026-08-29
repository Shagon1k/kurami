import type { KuramiNote } from "../../model.ts";
import { escapeHtml } from "../html.ts";

function noteMark(mark: KuramiNote["mark"]): string {
  if (mark === "arrow-down") return "↓";
  if (mark === "arrow-down-right") return "↘";
  if (mark === "arrow-right") return "→";
  return "";
}

export function renderKuramiNote(note: KuramiNote | undefined, placementClass: string): string {
  if (!note) return "";
  const mark = noteMark(note.mark);
  return `<span class="kurami-note ${placementClass} kurami-note--${escapeHtml(note.tone)} kurami-note--${escapeHtml(note.rotation)}" data-note-id="${escapeHtml(note.id)}">${escapeHtml(note.text)}${mark ? ` <span aria-hidden="true">${mark}</span>` : ""}</span>`;
}
