import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { requestMergedDeliveryCompletion } from "./merged-delivery.ts";
import type { ProjectConfig as StatusProjectConfig } from "../project-status.ts";
import type { SourceProject } from "../worktrees/refresh-source.ts";
import { openOrchestratorDatabase } from "../../state/database.ts";

process.umask(0o077);

type CiState = "pending" | "passed" | "failed" | "missing" | "unknown";
type NormalizedCheck = {
  name: string;
  state: CiState;
  source: "check_run" | "commit_status" | "missing";
  detailsUrl: string | null;
};
type CiPolicy = {
  enabled: boolean;
  required_checks?: string[];
  missing_grace_minutes?: number;
};
type ValidatedCiPolicy =
  | { enabled: false }
  | {
      enabled: true;
      required_checks: string[];
      missing_grace_minutes: number;
    };
type ProjectConfig = SourceProject & StatusProjectConfig & {
  ci?: CiPolicy;
};
type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};
type OrchestratorConfig = { version: number; mode: "dry_run" | "live" };
type RunRow = {
  run_id: string;
  repository: string;
  branch_name: string;
};
type ExistingSnapshot = {
  head_sha: string | null;
  aggregate_state: CiState;
  first_observed_at: string;
  completed_at: string | null;
  pull_request_number: number | null;
  pull_request_url: string | null;
  pull_request_title: string | null;
};
type PullRequest = {
  number: number;
  html_url: string;
  title: string;
  state: string;
  created_at: string;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref?: string; repo: { full_name: string } | null };
};
type CheckRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
  started_at: string | null;
  completed_at: string | null;
};
type CommitStatus = {
  id: number;
  context: string;
  state: string;
  target_url: string | null;
  updated_at: string | null;
};
type Observation = {
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  pullRequestTitle: string | null;
  headSha: string | null;
  aggregateState: CiState;
  checks: NormalizedCheck[];
  error: string | null;
  merged: boolean;
  mergedAt?: string | null;
  mergeCommitSha?: string | null;
};

const orchestratorHome = resolveKuramiHome(
  resolve(import.meta.dirname, "../../../../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");
const orchestratorConfigPath = resolve(
  orchestratorHome,
  "config/orchestrator.yaml",
);

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): { project: string; apply: boolean } {
  const args = process.argv.slice(2);
  const projectIndex = args.indexOf("--project");
  const project =
    projectIndex >= 0 ? args[projectIndex + 1]?.trim() : undefined;
  const known = new Set(["--project", project, "--apply"]);
  if (!project || args.some((arg) => !known.has(arg)))
    fail("Usage: observe-ci.ts --project <project> [--apply]");
  return { project, apply: args.includes("--apply") };
}

function validatePolicy(
  project: string,
  policy: CiPolicy | undefined,
): ValidatedCiPolicy {
  if (!policy || typeof policy.enabled !== "boolean")
    fail(`Project ${project} requires ci.enabled`);
  if (!policy.enabled) return { enabled: false };
  const checks = policy.required_checks;
  const normalizedChecks = Array.isArray(checks)
    ? checks.map((name) => (typeof name === "string" ? name.trim() : name))
    : checks;
  if (
    !Array.isArray(normalizedChecks) ||
    normalizedChecks.length === 0 ||
    normalizedChecks.length > 50 ||
    normalizedChecks.some(
      (name) => typeof name !== "string" || !name,
    ) ||
    new Set(normalizedChecks).size !== normalizedChecks.length
  )
    fail(`Project ${project} has invalid ci.required_checks`);
  const grace = policy.missing_grace_minutes;
  if (
    typeof grace !== "number" ||
    !Number.isInteger(grace) ||
    grace < 0 ||
    grace > 60
  )
    fail(`Project ${project} has invalid ci.missing_grace_minutes`);
  return {
    enabled: true,
    required_checks: normalizedChecks as string[],
    missing_grace_minutes: grace,
  };
}

function githubApi<T>(endpoint: string, fields: Record<string, string> = {}): T {
  const args = ["api", "--method", "GET", endpoint];
  for (const [key, value] of Object.entries(fields))
    args.push("-f", `${key}=${value}`);
  try {
    return JSON.parse(
      execFileSync("gh", args, {
        encoding: "utf8",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      }),
    ) as T;
  } catch {
    throw new Error("GitHub API request failed");
  }
}

function checkRunState(check: CheckRun): CiState {
  if (check.status !== "completed") return "pending";
  if (["success", "neutral", "skipped"].includes(check.conclusion ?? ""))
    return "passed";
  if (
    [
      "failure",
      "cancelled",
      "timed_out",
      "action_required",
      "startup_failure",
      "stale",
    ].includes(check.conclusion ?? "")
  )
    return "failed";
  return "unknown";
}

function commitStatusState(status: CommitStatus): CiState {
  if (status.state === "success") return "passed";
  if (["failure", "error"].includes(status.state)) return "failed";
  if (status.state === "pending") return "pending";
  return "unknown";
}

function latestTimestamp(value: string | null): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function normalizeRequiredChecks(
  requiredChecks: string[],
  checkRuns: CheckRun[],
  statuses: CommitStatus[],
  firstObservedAt: string,
  now: string,
  missingGraceMinutes: number,
): { aggregateState: CiState; checks: NormalizedCheck[] } {
  const available = new Map<
    string,
    NormalizedCheck & { observedAt: number; id: number }
  >();
  for (const status of statuses) {
    const candidate = {
      name: status.context,
      state: commitStatusState(status),
      source: "commit_status" as const,
      detailsUrl: status.target_url,
      observedAt: latestTimestamp(status.updated_at),
      id: status.id,
    };
    const current = available.get(status.context);
    if (
      !current ||
      candidate.observedAt > current.observedAt ||
      (candidate.observedAt === current.observedAt && candidate.id > current.id)
    )
      available.set(status.context, candidate);
  }
  for (const check of checkRuns) {
    const candidate = {
      name: check.name,
      state: checkRunState(check),
      source: "check_run" as const,
      detailsUrl: check.details_url,
      observedAt: latestTimestamp(check.completed_at ?? check.started_at),
      id: check.id,
    };
    const current = available.get(check.name);
    if (
      !current ||
      candidate.observedAt > current.observedAt ||
      (candidate.observedAt === current.observedAt && candidate.id > current.id)
    )
      available.set(check.name, candidate);
  }
  const checks = requiredChecks.map<NormalizedCheck>((name) => {
    const found = available.get(name);
    if (!found)
      return { name, state: "missing", source: "missing", detailsUrl: null };
    return {
      name: found.name,
      state: found.state,
      source: found.source,
      detailsUrl: found.detailsUrl,
    };
  });
  if (checks.some((check) => check.state === "failed"))
    return { aggregateState: "failed", checks };
  if (checks.some((check) => check.state === "unknown"))
    return { aggregateState: "unknown", checks };
  if (checks.some((check) => check.state === "pending"))
    return { aggregateState: "pending", checks };
  if (checks.some((check) => check.state === "missing")) {
    const graceElapsed =
      Date.parse(now) - Date.parse(firstObservedAt) >=
      missingGraceMinutes * 60 * 1_000;
    return { aggregateState: graceElapsed ? "missing" : "pending", checks };
  }
  return { aggregateState: "passed", checks };
}

function activeRuns(database: DatabaseSync, project: string): RunRow[] {
  return database
    .prepare(
      `
      SELECT r.run_id, r.repository, rr.branch_name
      FROM runs r
      JOIN run_resources rr USING (run_id)
      WHERE r.project = ?
        AND r.state IN (
          'starting', 'running', 'handoff_pending', 'waiting_human',
          'remote_owned', 'parked_review', 'needs_attention'
        )
        AND rr.branch_name IS NOT NULL
      ORDER BY r.created_at, r.run_id
    `,
    )
    .all(project) as RunRow[];
}

function pullRequests(
  repository: string,
  branch: string,
  state: "open" | "closed" = "open",
): PullRequest[] {
  const owner = repository.split("/")[0];
  if (!owner) throw new Error("Configured repository is invalid");
  return githubApi<PullRequest[]>(`repos/${repository}/pulls`, {
    state,
    head: `${owner}:${branch}`,
    per_page: "3",
  }).filter(
    (pull) =>
      pull.head.ref === branch &&
      pull.head.repo?.full_name === repository &&
      pull.base.repo?.full_name === repository,
  );
}

function observeRun(
  run: RunRow,
  policy: ValidatedCiPolicy,
  baseBranch: string,
  existing: ExistingSnapshot | undefined,
  now: string,
): Observation {
  let discoveredPull: PullRequest | undefined;
  try {
    const pulls = pullRequests(run.repository, run.branch_name);
    if (pulls.length === 0) {
      const closed = pullRequests(run.repository, run.branch_name, "closed")
        .filter((pull) => Boolean(pull.merged_at))
        .sort((left, right) => Date.parse(right.merged_at ?? "") - Date.parse(left.merged_at ?? ""));
      if (closed.length > 1) throw new Error("Multiple merged PRs match the managed branch");
      const merged = closed[0];
      if (merged) {
        if (merged.state !== "closed" || merged.base.ref !== baseBranch ||
          merged.number !== existing?.pull_request_number ||
          merged.html_url !== existing.pull_request_url || merged.head.sha !== existing.head_sha)
          throw new Error("Merged PR does not match the tracked managed delivery");
        discoveredPull = merged;
      }
      if (!discoveredPull) return {
        pullRequestNumber: null,
        pullRequestUrl: null,
        pullRequestTitle: null,
        headSha: null,
        aggregateState: "pending",
        checks: [],
        error: null,
        merged: false,
      };
    }
    if (pulls.length !== 1 && !discoveredPull)
      return {
        pullRequestNumber: null,
        pullRequestUrl: null,
        pullRequestTitle: null,
        headSha: null,
        aggregateState: "unknown",
        checks: [],
        error: "Multiple pull requests match the managed branch",
        merged: false,
      };
    const pull = discoveredPull ?? pulls[0]!;
    discoveredPull = pull;
    if (!policy.enabled) {
      return {
        pullRequestNumber: pull.number,
        pullRequestUrl: pull.html_url,
        pullRequestTitle: pull.title,
        headSha: pull.head.sha,
        aggregateState: "passed",
        checks: [],
        error: null,
        merged: Boolean(pull.merged_at),
        mergedAt: pull.merged_at,
        mergeCommitSha: pull.merge_commit_sha,
      };
    }
    const firstObservedAt =
      existing?.head_sha === pull.head.sha ? existing.first_observed_at : now;
    const checkRuns = githubApi<{ check_runs: CheckRun[] }>(
      `repos/${run.repository}/commits/${pull.head.sha}/check-runs`,
      { filter: "latest", per_page: "100" },
    ).check_runs;
    const statuses = githubApi<{ statuses: CommitStatus[] }>(
      `repos/${run.repository}/commits/${pull.head.sha}/status`,
    ).statuses;
    const normalized = normalizeRequiredChecks(
      policy.required_checks,
      checkRuns,
      statuses,
      firstObservedAt,
      now,
      policy.missing_grace_minutes,
    );
    return {
      pullRequestNumber: pull.number,
      pullRequestUrl: pull.html_url,
      pullRequestTitle: pull.title,
      headSha: pull.head.sha,
      aggregateState: normalized.aggregateState,
      checks: normalized.checks,
      error: null,
      merged: Boolean(pull.merged_at),
      mergedAt: pull.merged_at,
      mergeCommitSha: pull.merge_commit_sha,
    };
  } catch (error) {
    return {
      pullRequestNumber:
        discoveredPull?.number ?? existing?.pull_request_number ?? null,
      pullRequestUrl:
        discoveredPull?.html_url ?? existing?.pull_request_url ?? null,
      pullRequestTitle:
        discoveredPull?.title ?? existing?.pull_request_title ?? null,
      headSha: discoveredPull?.head.sha ?? existing?.head_sha ?? null,
      aggregateState: "unknown",
      checks: [],
      error: error instanceof Error ? error.message : "CI observation failed",
      merged: false,
    };
  }
}

function storeObservation(
  database: DatabaseSync,
  run: RunRow,
  observation: Observation,
  now: string,
): void {
  const existing = database
    .prepare(
      `SELECT head_sha, aggregate_state, first_observed_at, completed_at,
              pull_request_number, pull_request_url, pull_request_title
       FROM run_ci_snapshots WHERE run_id = ?`,
    )
    .get(run.run_id) as ExistingSnapshot | undefined;
  const sameHead = existing?.head_sha === observation.headSha;
  const firstObservedAt = sameHead ? existing.first_observed_at : now;
  const terminal = ["passed", "failed", "missing"].includes(
    observation.aggregateState,
  );
  const completedAt = terminal
    ? sameHead && existing?.aggregate_state === observation.aggregateState
      ? existing.completed_at ?? now
      : now
    : null;
  const checksJson = JSON.stringify(observation.checks);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        repository: run.repository,
        pullRequestNumber: observation.pullRequestNumber,
        pullRequestUrl: observation.pullRequestUrl,
        pullRequestTitle: observation.pullRequestTitle,
        headSha: observation.headSha,
        aggregateState: observation.aggregateState,
        checks: observation.checks,
        error: observation.error,
      }),
    )
    .digest("hex");
  database
    .prepare(
      `
      INSERT INTO run_ci_snapshots (
        run_id, repository, pull_request_number, pull_request_url,
        pull_request_title, head_sha, aggregate_state, checks_json,
        content_digest, first_observed_at, last_observed_at, completed_at,
        last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        repository = excluded.repository,
        pull_request_number = excluded.pull_request_number,
        pull_request_url = excluded.pull_request_url,
        pull_request_title = excluded.pull_request_title,
        head_sha = excluded.head_sha,
        aggregate_state = excluded.aggregate_state,
        checks_json = excluded.checks_json,
        content_digest = excluded.content_digest,
        first_observed_at = excluded.first_observed_at,
        last_observed_at = excluded.last_observed_at,
        completed_at = excluded.completed_at,
        last_error = excluded.last_error
    `,
    )
    .run(
      run.run_id,
      run.repository,
      observation.pullRequestNumber,
      observation.pullRequestUrl,
      observation.pullRequestTitle,
      observation.headSha,
      observation.aggregateState,
      checksJson,
      digest,
      firstObservedAt,
      now,
      completedAt,
      observation.error,
    );
  database
    .prepare(`
      UPDATE runs
      SET preview_requirement_satisfied_at = NULL,
          preview_requirement_lease_id = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id = ? AND preview_requirement_satisfied_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM preview_leases evidence
          WHERE evidence.lease_id = runs.preview_requirement_lease_id
            AND evidence.reviewed_at IS NOT NULL
            AND evidence.verified_head_sha = ?
        )
    `)
    .run(run.run_id, observation.headSha);
  database
    .prepare(`
      UPDATE runs
      SET preview_requirement_satisfied_at = (
            SELECT evidence.reviewed_at
            FROM preview_leases evidence
            WHERE evidence.run_id = runs.run_id
              AND evidence.reviewed_at IS NOT NULL
              AND evidence.verified_head_sha = ?
            ORDER BY evidence.reviewed_at DESC, evidence.lease_id DESC
            LIMIT 1
          ),
          preview_requirement_lease_id = (
            SELECT evidence.lease_id
            FROM preview_leases evidence
            WHERE evidence.run_id = runs.run_id
              AND evidence.reviewed_at IS NOT NULL
              AND evidence.verified_head_sha = ?
            ORDER BY evidence.reviewed_at DESC, evidence.lease_id DESC
            LIMIT 1
          ),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id = ? AND preview_required = 1
        AND preview_requirement_satisfied_at IS NULL
        AND EXISTS (
          SELECT 1 FROM preview_leases evidence
          WHERE evidence.run_id = runs.run_id
            AND evidence.reviewed_at IS NOT NULL
            AND evidence.verified_head_sha = ?
        )
    `)
    .run(observation.headSha, observation.headSha, run.run_id, observation.headSha);
}

export async function runCiObserverCli(): Promise<void> {
  const { project, apply } = parseArguments();
  const [registry, orchestrator] = (await Promise.all([
    readFile(projectsPath, "utf8"),
    readFile(orchestratorConfigPath, "utf8"),
  ])).map((content) => parse(content)) as [ProjectsRegistry, OrchestratorConfig];
  if (registry.version !== 1) fail("Unsupported projects config version");
  if (orchestrator.version !== 1)
    fail("Unsupported orchestrator config version");
  if (apply && orchestrator.mode !== "live")
    fail(`Refusing CI snapshot mutation in mode=${orchestrator.mode}`);
  const projectConfig = registry.projects[project];
  if (!projectConfig) fail(`Unknown project: ${project}`);
  const policy = validatePolicy(project, projectConfig.ci);
  const database = openOrchestratorDatabase(databasePath);
  try {
    const runs = activeRuns(database, project);
    const results: Array<Record<string, unknown>> = [];
    for (const run of runs) {
      const existing = database
        .prepare(
          `SELECT head_sha, aggregate_state, first_observed_at, completed_at,
                  pull_request_number, pull_request_url, pull_request_title
           FROM run_ci_snapshots WHERE run_id = ?`,
        )
        .get(run.run_id) as ExistingSnapshot | undefined;
      const now = new Date().toISOString();
      const observation =
        run.repository === projectConfig.repository
          ? observeRun(run, policy, projectConfig.workspace.base_branch, existing, now)
          : {
              pullRequestNumber: null,
              pullRequestUrl: null,
              pullRequestTitle: null,
              headSha: null,
              aggregateState: "unknown" as const,
              checks: [],
              error: "Run repository does not match project configuration",
              merged: false,
            };
      if (apply) storeObservation(database, run, observation, now);
      const delivery = apply && observation.merged && observation.pullRequestNumber &&
        observation.pullRequestUrl && observation.headSha
        ? await requestMergedDeliveryCompletion(database, projectConfig, run.run_id, {
            number: observation.pullRequestNumber, url: observation.pullRequestUrl, headSha: observation.headSha,
            mergedAt: observation.mergedAt!, mergeCommitSha: observation.mergeCommitSha ?? null,
          }) : null;
      results.push({
        delivery,
        runId: run.run_id,
        state: observation.aggregateState,
        headSha: observation.headSha,
        pullRequestNumber: observation.pullRequestNumber,
      });
    }
    if (process.env.CI_OBSERVER_QUIET !== "1")
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          apply,
          project,
          enabled: policy.enabled,
          runs: results.length,
          results,
        })}\n`,
      );
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  runCiObserverCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
