// When today's Daily was read to the end (Digest's edition_reads, set by the "Всё. Ты в курсе." block).
// Read-only; no store or no table yet means no mark.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function todaysDigestRead(home: string, now: Date, timeZone = "Europe/Vilnius"): string | null {
  const path = resolve(home, "state/briefing/briefing.db");
  if (!existsSync(path)) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true, timeout: 500 });
    const row = database.prepare("SELECT r.read_at FROM edition_reads r JOIN editions e ON e.id=r.edition_id WHERE e.edition_type='daily' AND e.local_date=?").get(today) as { read_at: string } | undefined;
    return row?.read_at ?? null;
  } catch { return null; } finally { database?.close(); }
}
