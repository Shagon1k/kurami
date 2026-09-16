import type { DatabaseSync } from "node:sqlite";
import { parseBriefingPayload } from "./model.ts";
import { section } from "./addons/envelopes.ts";
import { reactionSourceKeys } from "./interest-profile.ts";
import { briefingPaths, initializeBriefingStore, openBriefingDatabase } from "./store.ts";

/** Enrich only verifiable historical events. Never infer lost source context. */
export function backfillInterestContext(database: DatabaseSync): number {
  const sources = new Map<string, Set<string>>();
  for (const row of database.prepare("SELECT payload_json FROM editions ORDER BY local_date").all() as Array<{ payload_json: string }>) {
    const payload = parseBriefingPayload(JSON.parse(row.payload_json));
    for (const story of section(payload, "news").items) {
      const keys = sources.get(story.fingerprint) ?? new Set<string>();
      reactionSourceKeys(story).forEach(key => keys.add(key));
      sources.set(story.fingerprint, keys);
    }
  }
  let updated = 0;
  database.exec("BEGIN IMMEDIATE");
  try {
    const update = database.prepare("UPDATE reaction_events SET context_json=? WHERE story_fingerprint=? AND context_json IS NULL");
    for (const [fingerprint, keys] of sources) {
      updated += Number(update.run(JSON.stringify({ version: 1, sources: [...keys].sort().slice(0,16) }), fingerprint).changes);
    }
    database.exec("COMMIT");
  } catch(error) { database.exec("ROLLBACK"); throw error; }
  return updated;
}

if (import.meta.main) {
  try {
    if (process.argv.slice(2).join(" ") !== "--apply") throw new Error("Context backfill requires --apply");
    const paths = briefingPaths();
    await initializeBriefingStore(paths);
    const db = openBriefingDatabase(paths);
    try { process.stdout.write(JSON.stringify({ ok: true, updated: backfillInterestContext(db) }) + "\n"); }
    finally { db.close(); }
  } catch(error) {
    process.stderr.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) + "\n");
    process.exitCode = 1;
  }
}
