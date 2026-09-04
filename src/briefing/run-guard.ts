import type { FetchLike } from "./providers/common.ts";
import {
  notifyBriefingRelease,
  syncBriefingRunCard,
} from "./release-notifier.ts";
import {
  loadBriefingAttempt,
  recordBriefingRunStage,
  startBriefingAttempt,
  type BriefingRunAttempt,
} from "./run-attempt.ts";
import {
  briefingPaths,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
} from "./store.ts";
import { loadBriefingRuntimeConfig } from "./runtime-config.ts";

type GuardPhase = "primary" | "recovery";

export type BriefingGuardResult = {
  editionId: string | null;
  attemptId: string | null;
  phase: GuardPhase | "outside-window";
  status: "healthy" | "incomplete" | "failed" | "notified" | "skipped";
  state: string | null;
};

function localParts(at: Date, timeZone: string): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function phaseAt(local: { hour: number; minute: number }): GuardPhase | null {
  if (local.hour < 9 || (local.hour === 9 && local.minute < 45)) return null;
  if (local.hour === 9 || (local.hour === 10 && local.minute < 45)) return "primary";
  if (local.hour >= 10) return "recovery";
  return null;
}

async function syncCardFailSoft(
  attemptId: string,
  environment: NodeJS.ProcessEnv,
  options: { fetchImpl?: FetchLike; failureCode?: string },
): Promise<void> {
  await syncBriefingRunCard(attemptId, environment, options).catch(() => undefined);
}

export async function guardBriefingRun(
  environment: NodeJS.ProcessEnv = process.env,
  options: { at?: Date; fetchImpl?: FetchLike } = {},
): Promise<BriefingGuardResult> {
  const at = options.at ?? new Date();
  const paths = briefingPaths(environment);
  await initializeBriefingStore(paths);
  const config = await loadBriefingRuntimeConfig(paths, environment);
  const local = localParts(at, config.timeZone);
  const phase = phaseAt(local);
  if (!phase) {
    return { editionId: null, attemptId: null, phase: "outside-window", status: "skipped", state: null };
  }
  const editionId = `daily:${local.date}`;
  const database = openBriefingDatabase(paths);
  let attempt: BriefingRunAttempt;
  try {
    const cardAttempt = database.prepare(`
      SELECT attempts.attempt_id
      FROM briefing_run_cards AS cards
      JOIN briefing_run_attempts AS attempts
        ON attempts.attempt_id = cards.attempt_id
      WHERE cards.edition_id = ?
    `).get(editionId) as { attempt_id: string } | undefined;
    const preferred = cardAttempt ?? database.prepare(`
      SELECT attempt_id FROM briefing_run_attempts
      WHERE edition_id = ?
      ORDER BY
        CASE state WHEN 'notified' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
        CASE mode WHEN 'scheduled' THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 1
    `).get(editionId) as { attempt_id: string } | undefined;
    if (preferred) {
      attempt = loadBriefingAttempt(database, preferred.attempt_id)!;
    } else {
      const started = await startBriefingAttempt(database, paths, {
        editionId,
        mode: "scheduled",
        timeZone: config.timeZone,
        at,
      });
      attempt = started.attempt;
    }
  } finally {
    database.close();
  }

  const stateDatabase = openBriefingDatabase(paths);
  let editionState: string | null = null;
  try {
    const edition = loadEdition(stateDatabase, { id: editionId });
    editionState = edition?.state ?? null;
    attempt = loadBriefingAttempt(stateDatabase, attempt.attemptId)!;
  } finally {
    stateDatabase.close();
  }

  if (attempt.state === "notified" && (editionState === "complete" || editionState === "partial")) {
    await syncCardFailSoft(attempt.attemptId, environment, {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    return {
      editionId,
      attemptId: attempt.attemptId,
      phase,
      status: "healthy",
      state: attempt.state,
    };
  }

  if (attempt.state === "published" && (editionState === "complete" || editionState === "partial")) {
    try {
      await notifyBriefingRelease(editionId, environment, {
        attemptId: attempt.attemptId,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      const notifiedDatabase = openBriefingDatabase(paths);
      try {
        attempt = recordBriefingRunStage(notifiedDatabase, {
          attemptId: attempt.attemptId,
          stage: "notified",
          metadata: { guard: phase },
        });
      } finally {
        notifiedDatabase.close();
      }
      await syncCardFailSoft(attempt.attemptId, environment, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      return { editionId, attemptId: attempt.attemptId, phase, status: "notified", state: attempt.state };
    } catch {
      await syncBriefingRunCard(attempt.attemptId, environment, {
        failureCode: "release_notification_failed",
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      }).catch(() => undefined);
      return { editionId, attemptId: attempt.attemptId, phase, status: "incomplete", state: attempt.state };
    }
  }

  if (phase === "primary") {
    await syncBriefingRunCard(attempt.attemptId, environment, {
      failureCode: "primary_window_incomplete",
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    }).catch(() => undefined);
    return { editionId, attemptId: attempt.attemptId, phase, status: "incomplete", state: attempt.state };
  }

  if (!["failed", "skipped", "notified"].includes(attempt.state)) {
    const failedDatabase = openBriefingDatabase(paths);
    try {
      attempt = recordBriefingRunStage(failedDatabase, {
        attemptId: attempt.attemptId,
        stage: "failed",
        errorCode: "recovery_window_incomplete",
        metadata: { guard: phase },
      });
    } finally {
      failedDatabase.close();
    }
  }
  await syncCardFailSoft(attempt.attemptId, environment, {
    failureCode: "recovery_window_incomplete",
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return { editionId, attemptId: attempt.attemptId, phase, status: "failed", state: attempt.state };
}
