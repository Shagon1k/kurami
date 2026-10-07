// Repeated controller failures. The controller plans an automatic action (park, handoff, preview…) every
// minute; when the same action keeps failing for the same run, retrying every minute only fills the log and
// the database. This file remembers consecutive failures per run and action: after five, the controller
// waits longer between attempts (2, 4, 8 … 30 minutes); after three hours of failures, Hub shows the run as
// stuck so the owner can step in. A success forgets the run. "Waiting" failures (the Codex turn is still
// running) are expected and logged as waits, not errors.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ControllerFailure = {
  runId: string; project: string; issueNumber: number; action: string;
  reason: string; kind: "wait" | "error"; count: number; firstAt: string; lastAt: string; nextAt: string;
};
type FailureState = { version: 1; failures: Record<string, ControllerFailure> };
type Plan = { runId: string; project: string; issueNumber: number; action: string };

/** Retries at once up to this many consecutive failures, then backs off. */
export const FREE_RETRIES = 5;
export const MAX_BACKOFF_MINUTES = 30;
/** Failing this long (from the first failure) puts the run in Hub's attention list. */
export const STUCK_AFTER_HOURS = 3;
/** A failure record that no plan touched for this long is forgotten (the run moved on). */
const FORGET_AFTER_HOURS = 6;

const waiting = [/still active/i, /has not reached a completed terminal prompt/i, /has not completed successfully with a process stop receipt/i];

export function failureKind(reason: string): "wait" | "error" {
  return waiting.some(pattern => pattern.test(reason)) ? "wait" : "error";
}

export function backoffMinutes(count: number): number {
  return count <= FREE_RETRIES ? 0 : Math.min(MAX_BACKOFF_MINUTES, 2 ** (count - FREE_RETRIES));
}

export const failureKey = (plan: Pick<Plan, "runId" | "action">): string => `${plan.runId}:${plan.action}`;

export function controllerFailuresPath(home: string): string {
  return resolve(home, "state/controller-failures.json");
}

export function readControllerFailures(path: string): Record<string, ControllerFailure> {
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as FailureState;
    return state.version === 1 && state.failures && typeof state.failures === "object" ? state.failures : {};
  } catch { return {}; }
}

export function isStuck(failure: ControllerFailure, now: Date): boolean {
  return now.getTime() - Date.parse(failure.firstAt) >= STUCK_AFTER_HOURS * 3_600_000;
}

/** In-memory ledger for one controller cycle; `save` writes it back atomically. */
export class ControllerFailureLedger {
  readonly failures: Record<string, ControllerFailure>;
  readonly path: string;
  private readonly now: Date;
  constructor(path: string, now = new Date()) {
    this.path = path;
    this.now = now;
    this.failures = existsSync(path) ? readControllerFailures(path) : {};
  }

  /** True while the run's action is backing off; the controller skips it this cycle. */
  backingOff(plan: Plan): ControllerFailure | null {
    const failure = this.failures[failureKey(plan)];
    return failure && Date.parse(failure.nextAt) > this.now.getTime() ? failure : null;
  }

  recordFailure(plan: Plan, reason: string): ControllerFailure {
    const key = failureKey(plan), previous = this.failures[key], at = this.now.toISOString();
    const count = (previous?.count ?? 0) + 1;
    const failure: ControllerFailure = {
      runId: plan.runId, project: plan.project, issueNumber: plan.issueNumber, action: plan.action,
      reason: reason.slice(0, 400), kind: failureKind(reason), count,
      firstAt: previous?.firstAt ?? at, lastAt: at,
      nextAt: new Date(this.now.getTime() + backoffMinutes(count) * 60_000).toISOString(),
    };
    this.failures[key] = failure;
    return failure;
  }

  recordSuccess(plan: Plan): void {
    delete this.failures[failureKey(plan)];
  }

  /** Forgets runs whose action no plan touched for a while: the run moved on or was handled by hand. */
  forgetStale(): void {
    for (const [key, failure] of Object.entries(this.failures))
      if (this.now.getTime() - Date.parse(failure.lastAt) > FORGET_AFTER_HOURS * 3_600_000 && Date.parse(failure.nextAt) <= this.now.getTime()) delete this.failures[key];
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, failures: this.failures } satisfies FailureState)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
