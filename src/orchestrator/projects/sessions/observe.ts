import { transcriptBusy } from "../../runtime/codex-terminal.ts";
import { primaryAgent } from "../../integrations/primary-agent.ts";
import { observePrimaryAttempt } from "./retry-primary.ts";
import { taskForSession } from "../../integrations/codex/task-store.ts";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { DatabaseSync } from "node:sqlite";
import { openOrchestratorDatabase } from "../../state/database.ts";

process.umask(0o077);

type ActiveRun = {
  run_id: string;
  project: string;
  issue_number: number;
  issue_title: string | null;
  issue_url: string | null;
  run_state: string;
  owner_state: string;
  tmux_session_name: string | null;
  primary_agent_provider: string;
};

type AttentionRow = {
  attention_kind: string | null;
  consecutive_observations: number;
  notified_kind: string | null;
};

const orchestratorHome = resolveKuramiHome(
  resolve(import.meta.dirname, "../../../../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");

function fail(message: string): never {
  throw new Error(message);
}

function parseProject(): string {
  const args = process.argv.slice(2);
  const index = args.indexOf("--project");
  const project = index >= 0 ? args[index + 1]?.trim() : undefined;
  const unknown = args.filter(
    (arg, position) => arg !== "--project" && position !== index + 1,
  );
  if (!project || unknown.length > 0) {
    fail("Usage: observe-sessions.ts --project <project>");
  }
  return project;
}

function tmuxCapture(sessionName: string): {
  alive: boolean;
  transcript: string;
} {
  const result = spawnSync(
    "tmux",
    ["capture-pane", "-p", "-J", "-t", `${sessionName}:0.0`, "-S", "-120"],
    { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status === 0) return { alive: true, transcript: result.stdout };
  if (result.status === 1) return { alive: false, transcript: "" };
  fail(
    result.stderr.trim() || `Failed to inspect tmux session: ${sessionName}`,
  );
}

export function classifyTranscript(transcript: string): string | null {
  const tail = transcript.slice(-1_800);
  if (
    /Approaching rate limits[\s\S]{0,800}Switch to .+? for lower credit usage\?[\s\S]{0,800}›\s*1\.\s*Switch to[\s\S]{0,1000}Press enter to confirm/iu.test(
      tail,
    )
  ) {
    return "rate_limit_model_switch";
  }
  if (
    /(?:Would you like to run (?:the following|this) command\?|Requested permission|Allow .+\?)[\s\S]{0,600}Press enter to confirm/iu.test(
      tail,
    )
  ) {
    return "waiting_on_approval";
  }
  if (/Conversation interrupted|Run stopped as requested/iu.test(tail)) {
    return "turn_interrupted";
  }
  const blockerPatterns = [
    /Publishing is blocked/iu,
    /stopped before (?:staging|committing|pushing|creating)/iu,
    /Re-authenticate with/iu,
    /credentials? (?:are|is) invalid/iu,
    /cannot (?:commit|push|create (?:a )?(?:draft )?PR)/iu,
  ];
  const blockerIndex = Math.max(
    ...blockerPatterns.map((pattern) => {
      const match = [
        ...tail.matchAll(new RegExp(pattern.source, `${pattern.flags}g`)),
      ].at(-1);
      return match?.index ?? -1;
    }),
  );
  // Codex renders a fresh `›` input prompt only after the turn has stopped.
  // Requiring it after the blocker avoids alerting on transient narration.
  if (blockerIndex >= 0 && tail.lastIndexOf("\n› ") > blockerIndex) {
    return "idle_textual_blocker";
  }
  return null;
}

function classify(run: ActiveRun, database: DatabaseSync): string | null {
  const task = taskForSession(database,run.tmux_session_name);
  if (task) return task.failure_code;

  if (run.owner_state !== "cli" || run.primary_agent_provider !== "codex") return null;
  if (!run.tmux_session_name) return "managed_session_missing";
  const capture = tmuxCapture(run.tmux_session_name);
  if (!capture.alive) return "managed_session_missing";
  return classifyTranscript(capture.transcript);
}

function description(kind: string): string {
  switch (kind) {
    case "rate_limit_model_switch":
      return "Codex is waiting for an owner decision about its model. No model switch was applied.";
    case "waiting_on_approval":
      return "Codex is still waiting for a human approval after two checks.";
    case "turn_interrupted":
      return "The Codex turn was interrupted and needs a decision.";
    case "managed_session_missing":
      return "The CLI-owned Codex task lost its managed tmux session.";
    case "idle_textual_blocker":
      return "Codex stopped at a textual blocker and is idle; the run needs a decision or a safe retry.";
    default:
      return `Codex needs attention: ${kind}.`;
  }
}

function markApprovalBlockedRun(database: DatabaseSync, run: ActiveRun, kind="waiting_on_approval"): boolean {
  const current = database
    .prepare(`SELECT state, owner_state, stop_reason FROM runs WHERE run_id = ?`)
    .get(run.run_id) as
    | { state: string; owner_state: string; stop_reason: string | null }
    | undefined;
  if (
    !current ||
    current.owner_state !== "cli" ||
    current.stop_reason !== null ||
    !["starting", "running", "handoff_pending", "parked_review"].includes(
      current.state,
    )
  )
    return false;
  const changed = database
    .prepare(
      `UPDATE runs
       SET state='needs_attention', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE run_id=? AND state=? AND owner_state='cli' AND stop_reason IS NULL`,
    )
    .run(run.run_id, current.state);
  if (changed.changes !== 1) return false;
  const resource=kind === "rate_limit_model_switch" ? database.prepare("SELECT primary_agent_provider,codex_thread_id,worktree_path FROM run_resources WHERE run_id=?").get(run.run_id) : null;
  const attempt=resource && typeof resource.codex_thread_id === "string" && typeof resource.worktree_path === "string"
    ? primaryAgent(String(resource.primary_agent_provider))?.readAttempt(resource.codex_thread_id,resource.worktree_path) : null;
  const reason = kind === "rate_limit_model_switch" ? "primary_model_decision_required" : "codex_waiting_on_approval";
  database
    .prepare(
      `INSERT INTO run_state_history (
         run_id, from_state, to_state, reason, details_json
       ) VALUES (?, ?, 'needs_attention', ?, ?)`,
    )
    .run(
      run.run_id,
      current.state,
      reason,
      JSON.stringify({
        attentionKind: kind,
        ...(attempt ? {threadId:attempt.threadId,sourceTurnId:attempt.turnId} : {}),
        detail: kind === "rate_limit_model_switch" ? "Model choice requires an owner decision. No input was sent." : "Managed Codex requested an unexpected interactive approval.",
      }),
    );
  database
    .prepare(
      `UPDATE run_control_requests
       SET request_state='rejected',
           result_json=json_object('reason', ?),
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE run_id=? AND action='take_control'
         AND request_state IN ('pending','processing')`,
    )
    .run(reason, run.run_id);
  database
    .prepare(
      `INSERT OR IGNORE INTO run_control_events (
         event_id, run_id, event_kind, payload_json
       ) VALUES (?, ?, 'attention_required', json_object(
         'source', 'codex',
         'kind', ?,
         'detail', ?
       ))`,
    )
    .run(`ce_${run.run_id}_codex_${kind === "waiting_on_approval" ? "approval" : "model_decision"}`, run.run_id, kind,
      kind === "waiting_on_approval" ? "Managed Codex requested an unexpected interactive approval. No approval was applied." : "Model choice requires an owner decision. No input was sent.");
  return true;
}

function recoverClearedApprovalBlock(
  database: DatabaseSync,
  run: ActiveRun,
  kind: string | null,
): boolean {
  if (run.run_state !== "needs_attention" || ["waiting_on_approval","rate_limit_model_switch"].includes(kind ?? ""))
    return false;
  const latest = database
    .prepare(
      `SELECT reason FROM run_state_history
       WHERE run_id=? AND to_state='needs_attention'
       ORDER BY sequence DESC LIMIT 1`,
    )
    .get(run.run_id) as { reason: string } | undefined;
  if (latest?.reason === "primary_model_decision_required") {
    const resource=database.prepare("SELECT codex_thread_id,worktree_path FROM run_resources WHERE run_id=?").get(run.run_id);
    const attempt=resource && typeof resource.codex_thread_id === "string" && typeof resource.worktree_path === "string"
      ? primaryAgent("codex")?.readAttempt(resource.codex_thread_id,resource.worktree_path) : null;
    if(attempt?.state !== "running" || !run.tmux_session_name || !transcriptBusy(tmuxCapture(run.tmux_session_name).transcript))return false;
  } else if (latest?.reason !== "codex_waiting_on_approval") return false;
  const changed = database
    .prepare(
      `UPDATE runs
       SET state='running', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE run_id=? AND state='needs_attention' AND owner_state='cli'
         AND stop_reason IS NULL`,
    )
    .run(run.run_id);
  if (changed.changes !== 1) return false;
  database
    .prepare(
      `INSERT INTO run_state_history (
         run_id, from_state, to_state, reason, details_json
       ) VALUES (?, 'needs_attention', 'running', ?, ?)`,
    )
    .run(
      run.run_id,
      "codex_approval_blocker_cleared",
      JSON.stringify({
        detail:
          "The observed Codex transcript no longer contains an interactive approval prompt.",
      }),
    );
  return true;
}

export function runSessionObserverCli(): void {
  const project = parseProject();
  const database = openOrchestratorDatabase(databasePath);
  const notifications: string[] = [];
  try {
    const runs = database
      .prepare(
        `
        SELECT r.run_id, r.project, r.issue_number,
               pe.title AS issue_title, pe.url AS issue_url,
               r.state AS run_state, r.owner_state, rr.tmux_session_name, rr.primary_agent_provider
        FROM runs r
        JOIN run_resources rr USING (run_id)
        JOIN project_events pe ON pe.event_id = r.trigger_event_id
        WHERE r.project = ?
          AND r.owner_state = 'cli'
          AND r.state IN ('starting', 'running', 'parked_review', 'stopping', 'needs_attention')
        ORDER BY r.created_at
      `,
      )
      .all(project) as ActiveRun[];

    database.exec("BEGIN IMMEDIATE");
    try {
      for (const run of runs) {
        observePrimaryAttempt(database,run.run_id);
        const kind = classify(run,database);
        if (run.primary_agent_provider === "codex" && !taskForSession(database,run.tmux_session_name)) recoverClearedApprovalBlock(database, run, kind);
        const previous = database
          .prepare(
            `
            SELECT attention_kind, consecutive_observations, notified_kind
            FROM run_attention WHERE run_id = ?
          `,
          )
          .get(run.run_id) as AttentionRow | undefined;
        const count = kind
          ? previous?.attention_kind === kind
            ? previous.consecutive_observations + 1
            : 1
          : 0;
        database
          .prepare(
            `
            INSERT INTO run_attention (
              run_id, attention_kind, consecutive_observations, notified_kind,
              first_observed_at, last_observed_at, notified_at
            ) VALUES (
              ?, ?, ?, NULL,
              CASE WHEN ? IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END,
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
            )
            ON CONFLICT(run_id) DO UPDATE SET
              attention_kind = excluded.attention_kind,
              consecutive_observations = excluded.consecutive_observations,
              notified_kind = CASE
                WHEN excluded.attention_kind IS NULL THEN NULL
                WHEN run_attention.attention_kind = excluded.attention_kind
                  THEN run_attention.notified_kind
                ELSE NULL
              END,
              first_observed_at = CASE
                WHEN excluded.attention_kind IS NULL THEN NULL
                WHEN run_attention.attention_kind = excluded.attention_kind
                  THEN run_attention.first_observed_at
                ELSE excluded.first_observed_at
              END,
              last_observed_at = excluded.last_observed_at,
              notified_at = CASE
                WHEN excluded.attention_kind IS NULL OR run_attention.attention_kind != excluded.attention_kind
                  THEN NULL
                ELSE run_attention.notified_at
              END
          `,
          )
          .run(run.run_id, kind, count, kind);

        if (kind && count >= 2 && previous?.notified_kind !== kind) {
          database
            .prepare(
              `
              UPDATE run_attention
              SET notified_kind = ?,
                  notified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              WHERE run_id = ?
            `,
            )
            .run(kind, run.run_id);
          notifications.push(
            [
              `${project} #${run.issue_number}: ${description(kind)}`,
              run.issue_title ?? "",
              run.issue_url ?? "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }
        if (["waiting_on_approval","rate_limit_model_switch"].includes(kind ?? "") && count >= 2)
          markApprovalBlockedRun(database, run, kind!);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
  if (notifications.length > 0) {
    process.stdout.write(`${notifications.join("\n\n")}\n`);
  }
}

if (import.meta.main) {
  try {
    runSessionObserverCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  }
}
