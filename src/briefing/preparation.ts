import type { DatabaseSync } from "node:sqlite";
import { loadBriefingAttempt } from "./run-attempt.ts";
import { RUN_PROGRESS, runActivity } from "./run-progress.ts";
import { loadEdition } from "./store.ts";
import { localDate } from "./weekly/model.ts";
import type { DigestLanguage } from "./i18n.ts";

export type DigestPreparation = {
  editionId: string;
  date: string;
  status: "preparing" | "ready";
  activity: string;
  step: number;
  updatedAt: string;
  timeZone: string;
};

/** The current production attempt, excluding simulations and previous local days. */
export function digestPreparation(database: DatabaseSync, language: DigestLanguage, timeZone: string, now = new Date()): DigestPreparation | null {
  const date = localDate(now.toISOString(), timeZone);
  const latest = database.prepare(`SELECT attempt_id FROM briefing_run_attempts
    WHERE edition_id = ? AND mode <> 'dry-run' ORDER BY created_at DESC, updated_at DESC LIMIT 1`)
    .get(`daily:${date}`) as { attempt_id: string } | undefined;
  if (!latest) return null;
  const attempt = loadBriefingAttempt(database, latest.attempt_id)!;
  if (attempt.state === "failed" || attempt.state === "skipped") return null;
  const ready = attempt.state === "published" || attempt.state === "notified";
  if (ready) {
    const edition = loadEdition(database, { id: attempt.editionId });
    if (!edition || !["complete", "partial"].includes(edition.state) || !edition.published_at) return null;
  }
  return { editionId: attempt.editionId, date, status: ready ? "ready" : "preparing",
    activity: runActivity(attempt.state, language), step: RUN_PROGRESS[attempt.state].step,
    updatedAt: attempt.updatedAt, timeZone };
}
