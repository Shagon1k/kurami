import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { BriefingPaths } from "./store.ts";

const EDITION_ID = /^daily:(\d{4}-\d{2}-\d{2})$/u;
const ATTEMPT_ID = /^daily-\d{4}-\d{2}-\d{2}--(?:scheduled|manual|recovery|dry-run)(?:-[A-Za-z0-9]{6,40})?$/u;

export type BriefingRunMode = "scheduled" | "manual" | "recovery" | "dry-run";
export type BriefingRunState =
  | "created"
  | "live-collected"
  | "telegram-captured"
  | "capture-validated"
  | "editorialized"
  | "prepared"
  | "media-ready"
  | "commit-planned"
  | "telegram-committed"
  | "published"
  | "notified"
  | "failed"
  | "skipped";

export type BriefingRunAttempt = {
  attemptId: string;
  editionId: string;
  mode: BriefingRunMode;
  state: BriefingRunState;
  runDirectory: string;
  inputDigest: string | null;
  outputDigest: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

const ORDER: BriefingRunState[] = [
  "created",
  "live-collected",
  "telegram-captured",
  "capture-validated",
  "editorialized",
  "prepared",
  "media-ready",
  "commit-planned",
  "telegram-committed",
  "published",
  "notified",
];

function row(value: Record<string, unknown>): BriefingRunAttempt {
  return {
    attemptId: String(value.attempt_id),
    editionId: String(value.edition_id),
    mode: value.mode as BriefingRunMode,
    state: value.state as BriefingRunState,
    runDirectory: String(value.run_directory),
    inputDigest: value.input_digest === null ? null : String(value.input_digest),
    outputDigest: value.output_digest === null ? null : String(value.output_digest),
    errorCode: value.error_code === null ? null : String(value.error_code),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    completedAt: value.completed_at === null ? null : String(value.completed_at),
  };
}

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

function attemptDirectory(paths: BriefingPaths, attemptId: string): string {
  if (!ATTEMPT_ID.test(attemptId)) throw new Error("Invalid briefing attempt ID");
  const directory = resolve(paths.runsDirectory, attemptId);
  if (!directory.startsWith(`${resolve(paths.runsDirectory)}/`)) {
    throw new Error("Briefing attempt directory escapes runs root");
  }
  return directory;
}

export function loadBriefingAttempt(
  database: DatabaseSync,
  attemptId: string,
): BriefingRunAttempt | null {
  if (!ATTEMPT_ID.test(attemptId)) throw new Error("Invalid briefing attempt ID");
  const value = database.prepare("SELECT * FROM briefing_run_attempts WHERE attempt_id = ?")
    .get(attemptId) as Record<string, unknown> | undefined;
  return value ? row(value) : null;
}

export async function startBriefingAttempt(
  database: DatabaseSync,
  paths: BriefingPaths,
  input: {
    editionId: string;
    mode: BriefingRunMode;
    timeZone: string;
    at?: Date;
  },
): Promise<{ attempt: BriefingRunAttempt; reused: boolean; shouldRun: boolean; reason?: string }> {
  const match = EDITION_ID.exec(input.editionId);
  if (!match) throw new Error("Run attempt requires a daily edition ID");
  const at = input.at ?? new Date();
  const timestamp = at.toISOString();
  const local = localParts(at, input.timeZone);
  if (match[1] !== local.date && input.mode !== "recovery") {
    throw new Error("Run attempt date must match the current local date");
  }
  if (input.mode === "scheduled") {
    const existing = database.prepare(
      "SELECT * FROM briefing_run_attempts WHERE edition_id = ? AND mode = 'scheduled'",
    ).get(input.editionId) as Record<string, unknown> | undefined;
    if (existing) {
      const attempt = row(existing);
      return {
        attempt,
        reused: true,
        shouldRun: false,
        reason: ["published", "notified"].includes(attempt.state)
          ? "scheduled_edition_already_handled"
          : "scheduled_attempt_already_exists",
      };
    }
    if (local.hour !== 9) {
      const attemptId = `daily-${match[1]}--scheduled`;
      const runDirectory = attemptDirectory(paths, attemptId);
      return {
        attempt: {
          attemptId,
          editionId: input.editionId,
          mode: "scheduled",
          state: "skipped",
          runDirectory,
          inputDigest: null,
          outputDigest: null,
          errorCode: "outside_local_09_window",
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: timestamp,
        },
        reused: false,
        shouldRun: false,
        reason: "outside_local_09_window",
      };
    }
  }
  const suffix = input.mode === "scheduled"
    ? ""
    : `-${createHash("sha256").update(`${timestamp}:${randomUUID()}`).digest("hex").slice(0, 10)}`;
  const attemptId = `daily-${match[1]}--${input.mode}${suffix}`;
  const runDirectory = attemptDirectory(paths, attemptId);
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  database.prepare(`
    INSERT INTO briefing_run_attempts (
      attempt_id, edition_id, mode, state, run_directory, created_at, updated_at
    ) VALUES (?, ?, ?, 'created', ?, ?, ?)
  `).run(attemptId, input.editionId, input.mode, runDirectory, timestamp, timestamp);
  return { attempt: loadBriefingAttempt(database, attemptId)!, reused: false, shouldRun: true };
}

export function recordBriefingRunStage(
  database: DatabaseSync,
  input: {
    attemptId: string;
    stage: BriefingRunState;
    inputDigest?: string;
    outputDigest?: string;
    metadata?: Record<string, unknown>;
    errorCode?: string;
  },
): BriefingRunAttempt {
  const attempt = loadBriefingAttempt(database, input.attemptId);
  if (!attempt) throw new Error(`Unknown briefing attempt ${input.attemptId}`);
  const terminal = input.stage === "failed" || input.stage === "skipped";
  if (!terminal) {
    const currentIndex = ORDER.indexOf(attempt.state);
    const nextIndex = ORDER.indexOf(input.stage);
    if (nextIndex < 0) throw new Error(`Unsupported briefing run stage ${input.stage}`);
    if (attempt.state === input.stage) return attempt;
    if (currentIndex < 0 || nextIndex !== currentIndex + 1) {
      throw new Error(`Invalid briefing run transition ${attempt.state} -> ${input.stage}`);
    }
  } else if (["notified", "failed", "skipped"].includes(attempt.state)) {
    throw new Error(`Briefing run ${attempt.attemptId} is already terminal`);
  }
  const timestamp = new Date().toISOString();
  const receiptState = input.stage === "failed" ? "failed" : input.stage === "skipped" ? "skipped" : "complete";
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO briefing_run_stage_receipts (
        attempt_id, stage, state, input_digest, output_digest, metadata_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(attempt_id, stage) DO UPDATE SET
        state = excluded.state,
        input_digest = excluded.input_digest,
        output_digest = excluded.output_digest,
        metadata_json = excluded.metadata_json,
        recorded_at = excluded.recorded_at
    `).run(
      input.attemptId,
      input.stage,
      receiptState,
      input.inputDigest ?? null,
      input.outputDigest ?? null,
      JSON.stringify(input.metadata ?? {}),
      timestamp,
    );
    database.prepare(`
      UPDATE briefing_run_attempts
      SET state = ?, input_digest = COALESCE(?, input_digest),
          output_digest = COALESCE(?, output_digest), error_code = ?,
          updated_at = ?, completed_at = ?
      WHERE attempt_id = ?
    `).run(
      input.stage,
      input.inputDigest ?? null,
      input.outputDigest ?? null,
      input.errorCode ?? null,
      timestamp,
      ["notified", "failed", "skipped"].includes(input.stage) ? timestamp : null,
      input.attemptId,
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return loadBriefingAttempt(database, input.attemptId)!;
}

export function latestBriefingAttempt(database: DatabaseSync): BriefingRunAttempt | null {
  const value = database.prepare(
    "SELECT * FROM briefing_run_attempts ORDER BY created_at DESC LIMIT 1",
  ).get() as Record<string, unknown> | undefined;
  return value ? row(value) : null;
}
