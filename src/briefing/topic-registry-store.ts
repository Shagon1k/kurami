import type {DatabaseSync} from "node:sqlite";

/** Preparation stays inside the caller's transaction; active topics and nonempty aliases survive. */
export function prepareTopicUpsert(database: DatabaseSync) {
  return database.prepare(`
    INSERT INTO topic_registry (id, label, aliases_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      aliases_json = CASE WHEN excluded.aliases_json = '[]' THEN topic_registry.aliases_json ELSE excluded.aliases_json END,
      status = CASE WHEN topic_registry.status = 'active' THEN 'active' ELSE excluded.status END,
      updated_at = excluded.updated_at
  `);
}
