import type { DatabaseSync } from "node:sqlite";

export type EditionRow = {
  id: string;
  edition_type: "daily" | "cinema";
  local_date: string;
  timezone: string;
  state: "prepared" | "complete" | "partial" | "aborted";
  payload_json: string;
  html_path: string;
  content_digest: string;
  preview_enabled: 0 | 1;
  is_current: 0 | 1;
  prepared_at: string;
  published_at: string | null;
  retention_until: string;
  updated_at: string;
};

export function loadEdition(
  database: DatabaseSync,
  selector: { id?: string; type?: "daily" | "cinema"; date?: string; current?: boolean },
): EditionRow | null {
  if (selector.id) {
    return (database.prepare("SELECT * FROM editions WHERE id = ?").get(selector.id) as
      | EditionRow
      | undefined) ?? null;
  }
  if (selector.current && selector.type) {
    return (database
      .prepare("SELECT * FROM editions WHERE edition_type = ? AND is_current = 1")
      .get(selector.type) as EditionRow | undefined) ?? null;
  }
  if (selector.type && selector.date) {
    return (database
      .prepare("SELECT * FROM editions WHERE edition_type = ? AND local_date = ?")
      .get(selector.type, selector.date) as EditionRow | undefined) ?? null;
  }
  throw new Error("Incomplete edition selector");
}
