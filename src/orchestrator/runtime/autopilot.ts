// Autopilot: brings a task that reached Human Review with a pull request to the point where only the owner's
// decision is left. Per project and off by default (Hub → Controls → Settings). For each such task it asks,
// once per head commit, for the next missing step:
//   CI failed            → one CI repair (never a second one for the task),
//   CI passed, no review → AI Review of this commit,
//   review found critical or important issues → one round of review fixes (never a second round).
// Merging stays with the owner. Requests go through the same guarded paths as the owner's buttons on
// Projects (`requestProjectsReview`, `requestProjectRunAction`): they check sync freshness, eligibility and the
// commit, so the autopilot can only ask for what the owner could ask for at that moment.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { projectRunStatus, readProjectStatus, type CurrentProjectRun, type ProjectStatuses } from "../projects/status-read-model.ts";
import { requestProjectsReview } from "../../projects-site/actions.ts";
import { projectRunActions, requestProjectRunAction } from "../../projects-site/run-actions.ts";

export type AutopilotSettings = { version: 1; revision: number; projects: Record<string, boolean>; actorId?: string; appliedAt?: string };
export type AutopilotStep = { runId: string; project: string; itemId: string; head: string; action: "ci_repair" | "ai_review" | "review_fix" };
type Ledger = Record<string, { at: string; outcome: "requested" | "refused"; tries: number }>;
export type AutopilotDeps = {
  review: (input: unknown, actor: string) => unknown;
  action: (input: unknown, actor: string) => unknown;
  fingerprint: (runId: string) => { fingerprint: string; enabled: Set<string> };
};

const ACTOR = "autopilot";
/** A refused request (stale sync, busy run) is retried a few times, at most every 15 minutes. */
const RETRY_MINUTES = 15, MAX_TRIES = 4;
const fail = (message: string): never => { throw new Error(message); };

export const autopilotPaths = (home: string) => ({ settings: resolve(home, "state/autopilot-settings.json"), ledger: resolve(home, "state/autopilot-ledger.json") });

async function writeAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function readAutopilotSettings(home: string): AutopilotSettings {
  try {
    const value = JSON.parse(readFileSync(autopilotPaths(home).settings, "utf8")) as AutopilotSettings;
    if (value.version === 1 && Number.isInteger(value.revision) && value.projects && typeof value.projects === "object") return value;
  } catch {}
  return { version: 1, revision: 0, projects: {} };
}

/** The next step this task is missing, or null. Pure: decided from the same facts Projects shows. */
export function nextAutopilotStep(run: CurrentProjectRun, review: string): AutopilotStep | null {
  const head = run.ci_head_sha;
  if (run.item_status !== review || !run.pull_request_url || !head) return null;
  if (!["parked_review", "waiting_human"].includes(run.run_state)) return null;
  const status = projectRunStatus(run, head);
  if (status.ciRepairBusy || status.reviewFixBusy) return null;
  const base = { runId: run.run_id, project: run.project, itemId: "", head };
  const repairs = Number((run as { ci_repair_attempt_count?: number }).ci_repair_attempt_count ?? 0);
  if (["failed", "missing"].includes(run.ci_aggregate_state ?? "")) return repairs === 0 ? { ...base, action: "ci_repair" } : null;
  if (run.ci_aggregate_state !== "passed") return null;
  if (!status.reviewCurrent && run.ai_review_state !== "running") return { ...base, action: "ai_review" };
  if (status.majorFindings > 0 && !run.review_fix_state) return { ...base, action: "review_fix" };
  return null;
}

/** A stable UUID-shaped request key per task, step and commit, so a repeat is recognised as the same request. */
function stepKey(step: AutopilotStep): string {
  const hex = createHash("sha256").update(`${step.runId}:${step.action}:${step.head}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function defaultDeps(home: string): AutopilotDeps {
  return {
    review: (input, actor) => requestProjectsReview(input, actor, { home }),
    action: (input, actor) => requestProjectRunAction(input, actor, { home }),
    fingerprint: runId => {
      const database = new DatabaseSync(resolve(home, "state/orchestrator.db"), { readOnly: true, timeout: 1_000 });
      try {
        const view = projectRunActions(database, runId, home, new Date(), true);
        return { fingerprint: view.fingerprint, enabled: new Set(view.actions.filter(entry => entry.enabled).map(entry => entry.action)) };
      } finally { database.close(); }
    },
  };
}

/** One pass for every project with the autopilot on. Returns what it asked for. */
export async function runAutopilot(home: string, now = new Date(), deps: AutopilotDeps = defaultDeps(home)): Promise<AutopilotStep[]> {
  const settings = readAutopilotSettings(home);
  const enabled = Object.entries(settings.projects).filter(([, on]) => on).map(([key]) => key);
  if (!enabled.length) return [];
  const registry = (parse(readFileSync(resolve(home, "config/projects.yaml"), "utf8")) as { projects?: Record<string, { statuses: ProjectStatuses }> }).projects ?? {};
  const status = readProjectStatus(resolve(home, "state/orchestrator.db"), registry, now);
  if (!status.available) return [];
  let ledger: Ledger = {};
  try { ledger = JSON.parse(await readFile(autopilotPaths(home).ledger, "utf8")) as Ledger; } catch {}
  const asked: AutopilotStep[] = [];
  for (const run of status.runs.filter(run => enabled.includes(run.project))) {
    const step = nextAutopilotStep(run, registry[run.project]!.statuses.review);
    if (!step) continue;
    const itemId = itemOf(home, run.run_id);
    if (!itemId) continue;
    step.itemId = itemId;
    const key = `${step.runId}:${step.action}:${step.head}`, previous = ledger[key];
    if (previous?.outcome === "requested" || (previous && (previous.tries >= MAX_TRIES || now.getTime() - Date.parse(previous.at) < RETRY_MINUTES * 60_000))) continue;
    let outcome: "requested" | "refused" = "refused";
    try {
      if (step.action === "ai_review") deps.review({ project: step.project, itemId, runId: step.runId, head: step.head, key: stepKey(step) }, ACTOR);
      else {
        const view = deps.fingerprint(step.runId);
        if (view.enabled.has(step.action)) deps.action({ runId: step.runId, project: step.project, itemId, action: step.action, fingerprint: view.fingerprint, confirmed: false, key: stepKey(step) }, ACTOR);
        else throw new Error("not available");
      }
      outcome = "requested"; asked.push(step);
    } catch {}
    ledger[key] = { at: now.toISOString(), outcome, tries: (previous?.tries ?? 0) + 1 };
  }
  // Forget steps older than two weeks: their commits are long gone.
  for (const [key, entry] of Object.entries(ledger)) if (now.getTime() - Date.parse(entry.at) > 14 * 86_400_000) delete ledger[key];
  await writeAtomically(autopilotPaths(home).ledger, ledger);
  return asked;
}

function itemOf(home: string, runId: string): string | null {
  const database = new DatabaseSync(resolve(home, "state/orchestrator.db"), { readOnly: true, timeout: 1_000 });
  try { return (database.prepare("SELECT item_id FROM runs WHERE run_id=?").get(runId) as { item_id: string } | undefined)?.item_id ?? null; }
  finally { database.close(); }
}

export async function runAutopilotCli(argv = process.argv.slice(2)): Promise<Record<string, unknown>> {
  const home = resolveKuramiHome("/home/shagon1k/_hermes/_kurami"), [command, ...args] = argv, current = readAutopilotSettings(home);
  const registry = (parse(readFileSync(resolve(home, "config/projects.yaml"), "utf8")) as { projects?: Record<string, { repository?: string }> }).projects ?? {};
  const projects = Object.keys(registry).sort();
  const view = (action: string, state: AutopilotSettings) => ({ ok: true, action, revision: state.revision,
    projects: Object.fromEntries(projects.map(key => [key, state.projects[key] === true])), names: Object.fromEntries(projects.map(key => [key, registry[key]?.repository?.split("/")[1] ?? key])) });
  if (command === "status") return view("status", current);
  if (command === "run") return { ok: true, asked: await runAutopilot(home) };
  if (command !== "apply") fail("Usage: autopilot.ts status | run | apply --projects key,key --expected-revision N --actor-id ID");
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!["--projects", "--expected-revision", "--actor-id"].includes(flag ?? "") || value === undefined) fail(`Unknown autopilot argument: ${flag ?? "missing"}`);
    options[flag!.slice(2)] = value;
  }
  const on = (options.projects ?? "").split(",").filter(Boolean);
  if (on.some(key => !projects.includes(key))) fail("Unknown project");
  if (!/^\d+$/.test(options["expected-revision"] ?? "") || !/^\d{1,40}$/.test(options["actor-id"] ?? "")) fail("Invalid revision or actor ID");
  if (Number(options["expected-revision"]) !== current.revision) fail(`Autopilot settings changed since this panel opened: expected revision ${options["expected-revision"]}, current revision ${current.revision}`);
  const next: AutopilotSettings = { version: 1, revision: current.revision + 1, projects: Object.fromEntries(projects.map(key => [key, on.includes(key)])), actorId: options["actor-id"], appliedAt: new Date().toISOString() };
  if (projects.every(key => (current.projects[key] === true) === next.projects[key])) return view("unchanged", current);
  await writeAtomically(autopilotPaths(home).settings, next);
  return view("applied", next);
}

if (import.meta.main) {
  runAutopilotCli().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  });
}
