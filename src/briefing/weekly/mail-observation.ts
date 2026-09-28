import type { DatabaseSync } from "node:sqlite";
import { loadEdition } from "../edition-store.ts";
import { parseBriefingPayload } from "../model.ts";
import { localDate } from "./model.ts";

export type CompletedMailObservation = {
  actionId: string;
  editionId: string;
  itemIdsJson: string;
  completedAt: string;
  timezone?: string;
};

function diagnosticCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code)) return code;
  }
  return "WEEKLY_MAIL_OBSERVATION_ERROR";
}

export function observeCompletedMailAction(
  database: DatabaseSync,
  action: CompletedMailObservation,
  options: { includeWithoutWeekly?: boolean } = {},
): void {
  database.exec("SAVEPOINT optional_weekly_mail_observation");
  try {
    let timezone: string;
    if (options.includeWithoutWeekly) {
      if (!action.timezone) throw new Error("Missing historical mail action timezone");
      timezone = action.timezone;
    } else {
      const edition = loadEdition(database, { id: action.editionId });
      if (!edition) throw new Error("Unknown briefing edition");
      if (!parseBriefingPayload(JSON.parse(edition.payload_json)).addons.weekly) {
        database.exec("RELEASE optional_weekly_mail_observation");
        return;
      }
      timezone = edition.timezone;
    }
    const itemIds = JSON.parse(action.itemIdsJson) as unknown;
    if (!Array.isArray(itemIds) || !itemIds.every((item) => typeof item === "string")) {
      throw new Error("Invalid mail action item IDs");
    }
    database.prepare("INSERT OR IGNORE INTO weekly_mail_actions(action_id,local_date,item_count) VALUES(?,?,?)")
      .run(action.actionId, localDate(action.completedAt, timezone), itemIds.length);
    database.prepare("DELETE FROM weekly_mail_observation_failures WHERE action_id = ?")
      .run(action.actionId);
    database.exec("RELEASE optional_weekly_mail_observation");
  } catch (error) {
    database.exec("ROLLBACK TO optional_weekly_mail_observation");
    database.exec("RELEASE optional_weekly_mail_observation");
    const errorCode = diagnosticCode(error);
    try {
      database.prepare(`
        INSERT INTO weekly_mail_observation_failures (action_id, edition_id, error_code, failed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(action_id) DO UPDATE SET
          error_code = excluded.error_code,
          failed_at = excluded.failed_at
      `).run(action.actionId, action.editionId, errorCode, new Date().toISOString());
    } catch {
      console.warn(JSON.stringify({
        event: "weekly_mail_observation_failure_receipt_unavailable",
        actionId: action.actionId,
        editionId: action.editionId,
        errorCode,
      }));
    }
    console.warn(JSON.stringify({
      event: "weekly_mail_observation_failed",
      actionId: action.actionId,
      editionId: action.editionId,
      errorCode,
    }));
  }
}
