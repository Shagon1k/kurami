/** Canonical GitHub Project status writeback boundary. */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { openOrchestratorDatabase } from "../state/database.ts";

process.umask(0o077);

type ProjectConfig = {
  owner: string;
  project_number: number;
  status_field: string;
  statuses: { backlog: string; active: string; review: string };
};

type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type RunRow = {
  run_id: string;
  project: string;
  item_id: string;
  interaction_policy: "autonomous" | "human_control";
  state: string;
  stop_reason: string | null;
  owner_state: string;
  execution_mode: string;
  resource_state: string;
  tmux_session_name: string | null;
  item_status: string | null;
  has_newer_run: number;
  backlog_satisfied: number;
  completion_parked: number;
  autonomous_successor_parked: number;
  ci_pull_request_number: number | null;
  ci_pull_request_url: string | null;
  ci_head_sha: string | null;
};

const orchestratorHome = resolveKuramiHome(
  resolve(import.meta.dirname, "../../../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): {
  action: "backlog" | "review";
  runId: string;
  apply: boolean;
} {
  const args = process.argv.slice(2);
  const action = args[0];
  const index = args.indexOf("--run-id");
  const runId = index >= 0 ? args[index + 1]?.trim() : undefined;
  const known = new Set([action, "--run-id", runId, "--apply"]);
  if (
    (action !== "backlog" && action !== "review") ||
    !runId ||
    !/^r_[A-Za-z0-9_]+$/u.test(runId) ||
    args.some((arg) => !known.has(arg))
  ) {
    fail("Usage: project-status.ts <backlog|review> --run-id <run_id> [--apply]");
  }
  return { action, runId, apply: args.includes("--apply") };
}

function ghGraphql(query: string, variables: Record<string, string | number>): unknown {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables))
    args.push("-F", `${key}=${value}`);
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function loadRun(database: DatabaseSync, runId: string): RunRow {
  const run = database
    .prepare(
      `
      SELECT r.run_id, r.project, r.item_id, r.interaction_policy,
             r.state, r.stop_reason, r.owner_state, r.execution_mode,
             rr.resource_state, rr.tmux_session_name, pi.status AS item_status,
             EXISTS (
               SELECT 1 FROM runs newer
               WHERE newer.project = r.project
                 AND newer.item_id = r.item_id
                 AND newer.rowid > r.rowid
             ) AS has_newer_run,
             EXISTS (
               SELECT 1 FROM run_state_history backlog_history
               WHERE backlog_history.run_id = r.run_id
                 AND backlog_history.reason IN (
                   'cancelled_item_returned_to_backlog',
                   'cancelled_item_already_backlog'
                 )
             ) AS backlog_satisfied,
             EXISTS (
               SELECT 1 FROM run_state_history completion_history
               WHERE completion_history.run_id = r.run_id
                 AND completion_history.reason IN ('codex_cli_park_completed','codex_protocol_park_completed')
             ) AS completion_parked,
             EXISTS (
               SELECT 1 FROM run_autonomous_successions successor
               WHERE successor.run_id = r.run_id
                 AND successor.succession_state = 'parked'
             ) AS autonomous_successor_parked
             ,ci.pull_request_number AS ci_pull_request_number
             ,ci.pull_request_url AS ci_pull_request_url
             ,ci.head_sha AS ci_head_sha
      FROM runs r
      JOIN run_resources rr USING (run_id)
      LEFT JOIN run_ci_snapshots ci USING (run_id)
      LEFT JOIN project_items pi
        ON pi.project = r.project AND pi.item_id = r.item_id
      WHERE r.run_id = ?
    `,
    )
    .get(runId) as RunRow | undefined;
  if (!run) fail(`Run not found: ${runId}`);
  return run;
}

function resolveProject(config: ProjectConfig, status: string): {
  projectId: string;
  fieldId: string;
  optionId: string;
} {
  const query = `
    query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) {
          id
          field(name: ${JSON.stringify(config.status_field)}) {
            ... on ProjectV2SingleSelectField {
              id
              options { id name }
            }
          }
        }
      }
    }
  `;
  const response = ghGraphql(query, {
    owner: config.owner,
    number: config.project_number,
  }) as {
    data?: {
      user?: {
        projectV2?: {
          id?: string;
          field?: { id?: string; options?: Array<{ id: string; name: string }> };
        };
      };
    };
  };
  const project = response.data?.user?.projectV2;
  const field = project?.field;
  const option = field?.options?.find(
    (candidate) => candidate.name === status,
  );
  if (!project?.id || !field?.id || !option?.id)
    fail(`Configured GitHub Project or ${status} option could not be resolved`);
  return { projectId: project.id, fieldId: field.id, optionId: option.id };
}

function recordReviewWriteback(
  database: DatabaseSync,
  run: RunRow,
  fromStatus: string | null,
  review: string,
): void {
  const itemChanged = database
    .prepare(
      `UPDATE project_items
       SET status=?, last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE project=? AND item_id=?`,
    )
    .run(review, run.project, run.item_id);
  if (itemChanged.changes !== 1)
    fail("Project item changed before Human Review status was recorded");
  database
    .prepare(
      `INSERT INTO run_state_history (
         run_id, from_state, to_state, reason, details_json
       ) VALUES (?, 'parked_review', 'parked_review', ?, ?)`,
    )
    .run(
      run.run_id,
      "autonomous_completion_moved_to_human_review",
      JSON.stringify({ fromStatus, toStatus: review }),
    );
}

function validateReviewRun(run: RunRow, active: string): void {
  if (
    run.state !== "parked_review" ||
    run.stop_reason !== null ||
    run.owner_state !== "none" ||
    run.execution_mode !== "live" ||
    run.resource_state !== "provisioned" ||
    run.tmux_session_name !== null ||
    run.item_status !== active ||
    run.has_newer_run !== 0 ||
    run.completion_parked === 0 ||
    run.ci_pull_request_number === null ||
    run.ci_pull_request_url === null ||
    run.ci_head_sha === null ||
    (run.interaction_policy !== "autonomous" &&
      run.autonomous_successor_parked === 0)
  ) {
    fail("Run is not a released autonomous completion awaiting Human Review");
  }
}

function moveItem(
  itemId: string,
  target: { projectId: string; fieldId: string; optionId: string },
): void {
  const mutation = `
    mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $project,
        itemId: $item,
        fieldId: $field,
        value: { singleSelectOptionId: $option }
      }) { projectV2Item { id } }
    }
  `;
  ghGraphql(mutation, {
    project: target.projectId,
    item: itemId,
    field: target.fieldId,
    option: target.optionId,
  });
}

function recordBacklogSatisfaction(
  database: DatabaseSync,
  run: RunRow,
  reason:
    | "cancelled_item_returned_to_backlog"
    | "cancelled_item_already_backlog",
  fromStatus: string | null,
  backlog: string,
): void {
  database
    .prepare(
      `
        INSERT INTO run_state_history (
          run_id, from_state, to_state, reason, details_json
        )
        SELECT ?, 'cancelled', 'cancelled', ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM run_state_history
          WHERE run_id = ?
            AND reason IN (
              'cancelled_item_returned_to_backlog',
              'cancelled_item_already_backlog'
            )
        )
      `,
    )
    .run(
      run.run_id,
      reason,
      JSON.stringify({ fromStatus, toStatus: backlog }),
      run.run_id,
    );
}

export async function runProjectStatusCli(): Promise<void> {
  const { action, runId, apply } = parseArguments();
  const registry = parse(await readFile(projectsPath, "utf8")) as ProjectsRegistry;
  if (registry.version !== 1) fail("Unsupported projects registry version");
  const database = openOrchestratorDatabase(databasePath);
  try {
    const run = loadRun(database, runId);
    const config = registry.projects[run.project];
    if (!config) fail(`Unknown project: ${run.project}`);
    if (action === "review") {
      const active = config.statuses.active;
      const review = config.statuses.review;
      if (!active) fail(`Project has no configured active status: ${run.project}`);
      if (!review) fail(`Project has no configured Human Review status: ${run.project}`);
      validateReviewRun(run, active);
      if (!apply) {
        process.stdout.write(
          `${JSON.stringify({ ok: true, apply: false, action: "move_to_human_review", runId, fromStatus: run.item_status, toStatus: review })}\n`,
        );
        return;
      }
      const target = resolveProject(config, review);
      validateReviewRun(loadRun(database, runId), active);
      moveItem(run.item_id, target);
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = loadRun(database, runId);
        validateReviewRun(current, active);
        recordReviewWriteback(
          database,
          current,
          run.item_status,
          review,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, action: "moved_to_human_review", runId, toStatus: review })}\n`,
      );
      return;
    }
    const backlog = config.statuses.backlog;
    if (
      run.state !== "cancelled" ||
      run.stop_reason !== "cancelled" ||
      run.owner_state !== "none" ||
      run.resource_state !== "released"
    ) {
      fail("Run is not fully cancelled and released");
    }
    if (run.has_newer_run !== 0) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply, action: "superseded_by_newer_run", runId })}\n`,
      );
      return;
    }
    if (run.backlog_satisfied !== 0) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply, action: "backlog_already_satisfied", runId })}\n`,
      );
      return;
    }
    if (run.item_status === backlog) {
      if (!apply) {
        process.stdout.write(
          `${JSON.stringify({ ok: true, apply: false, action: "record_backlog_satisfied", runId, toStatus: backlog })}\n`,
        );
        return;
      }
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = loadRun(database, runId);
        if (current.has_newer_run !== 0) {
          database.exec("ROLLBACK");
          process.stdout.write(
            `${JSON.stringify({ ok: true, apply: true, action: "superseded_before_record", runId })}\n`,
          );
          return;
        }
        if (current.item_status !== backlog) {
          database.exec("ROLLBACK");
          process.stdout.write(
            `${JSON.stringify({ ok: true, apply: true, action: "backlog_status_changed", runId, currentStatus: current.item_status })}\n`,
          );
          return;
        }
        recordBacklogSatisfaction(
          database,
          current,
          "cancelled_item_already_backlog",
          current.item_status,
          backlog,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, action: "backlog_satisfied", runId, toStatus: backlog })}\n`,
      );
      return;
    }
    if (!apply) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: false, action: "move_to_backlog", runId, fromStatus: run.item_status, toStatus: backlog })}\n`,
      );
      return;
    }

    const target = resolveProject(config, backlog);
    if (loadRun(database, runId).has_newer_run !== 0) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, action: "superseded_before_apply", runId })}\n`,
      );
      return;
    }
    moveItem(run.item_id, target);

    database.exec("BEGIN IMMEDIATE");
    try {
      const current = loadRun(database, runId);
      if (
        current.state !== "cancelled" ||
        current.stop_reason !== "cancelled" ||
        current.resource_state !== "released"
      ) {
        fail("Run changed before Backlog status was recorded");
      }
      database
        .prepare(
          `
          UPDATE project_items
          SET status = ?, last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE project = ? AND item_id = ?
        `,
        )
        .run(backlog, run.project, run.item_id);
      recordBacklogSatisfaction(
        database,
        current,
        "cancelled_item_returned_to_backlog",
        run.item_status,
        backlog,
      );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: true, action: "moved_to_backlog", runId, toStatus: backlog })}\n`,
    );
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  runProjectStatusCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
