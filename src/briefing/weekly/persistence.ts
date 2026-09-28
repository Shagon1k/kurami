import type { DatabaseSync } from "node:sqlite";
import type { BriefingPayload } from "../model.ts";
import { promoteWeeklyReview } from "./lifecycle.ts";
import { observeDaily } from "./observations.ts";

function diagnosticCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code)) return code;
  }
  return "WEEKLY_PERSISTENCE_ERROR";
}

export function persistOptionalWeekly(
  database: DatabaseSync,
  payload: BriefingPayload,
  at: string,
  operation: "publish" | "refresh",
): void {
  if (payload.edition.type !== "daily" || !payload.addons.weekly) return;
  database.exec("SAVEPOINT optional_weekly_persistence");
  try {
    observeDaily(database, payload, at);
    if (operation === "publish") promoteWeeklyReview(database, payload);
    database.exec("RELEASE optional_weekly_persistence");
    database.prepare("DELETE FROM weekly_persistence_failures WHERE edition_id = ?")
      .run(payload.edition.id);
  } catch (error) {
    database.exec("ROLLBACK TO optional_weekly_persistence");
    database.exec("RELEASE optional_weekly_persistence");
    const errorCode = diagnosticCode(error);
    database.prepare(`
      INSERT INTO weekly_persistence_failures (edition_id, operation, error_code, failed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(edition_id) DO UPDATE SET
        operation = excluded.operation,
        error_code = excluded.error_code,
        failed_at = excluded.failed_at
    `).run(payload.edition.id, operation, errorCode, at);
    console.warn(JSON.stringify({ event: "weekly_persistence_failed", editionId: payload.edition.id, operation, errorCode }));
  }
}
