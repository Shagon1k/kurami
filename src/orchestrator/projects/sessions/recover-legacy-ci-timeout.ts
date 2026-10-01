import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { transcriptHasCompletedTurn } from "../../runtime/codex-terminal.ts";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";

// Incident-specific evidence. No arbitrary attention reason or task can use this route.
export const pf33RecoveryEvidence = Object.freeze({
  runId: "r_367ac0dcb458a2f56692", project: "pickflick", repository: "Shagon1k/PickFlick", issueNumber: 33,
  attemptId: "cra_51fbd62d584245b6a7cf58862dacd015", requestId: "rq_51fbd62d584245b6a7cf58862dacd015",
  sourceSha: "b56b7ce2a7261677d5484e83f0f3eed33a1968f0", pullNumber: 156,
  threadId: "01a0f6de-c8f5-7121-a914-cd316951e17d", previousThreadId: "01a0ee63-8019-7803-bf18-d605d607491e",
  sessionName: "cx-pf-33-367ac0", branch: "PF-33_7-1-build-club-switching-post",
  transcriptSha256: "f9201478d3886897e758fbd0e780aa6c53c74708f56228aff1ae657b86c93741",
});
export const legacyCiBillingReason = "legacy_ci_repair_completed_billing_block";
type Evidence = { [K in keyof typeof pf33RecoveryEvidence]: typeof pf33RecoveryEvidence[K] extends string ? string : number };
type Project = { repository: string; workspace: { canonical_repository: string; worktree_root: string } };
const requireEvidence = (ok: unknown, reason: string): void => { if (!ok) throw new Error(`Legacy CI recovery refused: ${reason}`); };

function command(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  requireEvidence(result.status === 0, `${executable} evidence unavailable`);
  return result.stdout.trim();
}

export function assertNoLegacyWriter(worktree: string, session: string): void {
  const tmux = spawnSync("tmux", ["has-session", "-t", `=${session}`], { encoding: "utf8" });
  requireEvidence(tmux.status === 1, "original supervisor alive or tmux evidence unavailable");
  // Check any local Codex process, including a detached app-server, using this copy.
  for (const pid of readdirSync("/proc").filter((value) => /^\d+$/u.test(value))) {
    let argv: string;
    try { argv = readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ESRCH") continue;
      throw new Error("Legacy CI recovery refused: process evidence unavailable");
    }
    const words = argv.split("\0");
    if (!words.some((word) => /(?:^|\/)(?:codex|codex[^/]*|managed-worker\.ts)$/u.test(word))) continue;
    let cwd: string;
    try { cwd = realpathSync(`/proc/${pid}/cwd`); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ESRCH") continue;
      throw new Error("Legacy CI recovery refused: writer cwd unavailable");
    }
    requireEvidence(cwd !== worktree && !cwd.startsWith(worktree + "/") && !words.includes(worktree), "live writer uses preserved worktree");
  }
}

export function inspectLegacyCiTimeout(database: DatabaseSync, home: string, project: Project,
  evidence: Evidence = pf33RecoveryEvidence, noWriter = assertNoLegacyWriter): { worktree: string; historySequence: number; transcriptSha256: string } {
  const row = database.prepare(`SELECT r.*, rr.resource_state,rr.worktree_path,rr.branch_name,
    rr.tmux_session_name,rr.codex_thread_id,rr.previous_codex_thread_id
    FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id=?`).get(evidence.runId)!;
  requireEvidence(row && row.project === evidence.project && row.repository === evidence.repository && row.issue_number === evidence.issueNumber,
    "run is not allowlisted");
  requireEvidence(row.state === "needs_attention" && row.owner_state === "none" && row.stop_reason === null &&
    row.execution_mode === "live" && row.resource_state === "provisioned" && row.tmux_session_name === null, "run/stop/owner fence changed");
  requireEvidence(row.codex_thread_id === evidence.threadId && row.previous_codex_thread_id === evidence.previousThreadId &&
    row.branch_name === evidence.branch, "original task identity changed");
  requireEvidence(!database.prepare(`SELECT 1 FROM run_resources rr JOIN runs r USING(run_id)
    WHERE rr.worktree_path=? AND r.run_id<>? AND (r.owner_state<>'none' OR rr.tmux_session_name IS NOT NULL)`)
    .get(row.worktree_path,evidence.runId), "another run owns the preserved worktree");
  const attempts = database.prepare("SELECT * FROM run_ci_repair_attempts WHERE run_id=? ORDER BY attempt_number").all(evidence.runId);
  const attempt = attempts[0];
  requireEvidence(attempts.length === 1 && attempt?.attempt_id === evidence.attemptId && attempt.request_id === evidence.requestId &&
    attempt.attempt_number === 1 && attempt.attempt_state === "needs_attention" && attempt.failure_reason === "runtime_budget_exceeded" &&
    attempt.source_head_sha === evidence.sourceSha && attempt.result_head_sha === null && attempt.codex_thread_id === evidence.threadId,
    "original repair attempt changed");
  const request = database.prepare("SELECT action,request_state FROM run_control_requests WHERE request_id=? AND run_id=?").get(evidence.requestId,evidence.runId);
  requireEvidence(request?.action === "ci_repair" && request.request_state === "applied", "original request changed");
  for (const [table, condition] of [
    ["run_control_requests", "request_state IN ('pending','processing')"],
    ["run_ai_reviews", "review_state='running'"],
    ["run_review_fix_rounds", "round_state IN ('running','waiting_ci','resolving')"],
    ["run_autonomous_successions", "succession_state IN ('starting','running')"],
  ]) requireEvidence(database.prepare(`SELECT COUNT(*) n FROM ${table} WHERE run_id=? AND ${condition}`).get(evidence.runId)?.n === 0, "control or worker conflict");
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE name='run_codex_tasks'").get())
    requireEvidence(!database.prepare("SELECT 1 FROM run_codex_tasks WHERE run_id=?").get(evidence.runId), "protocol task cannot use legacy recovery");
  const history = database.prepare("SELECT sequence,reason,details_json FROM run_state_history WHERE run_id=? AND to_state='needs_attention' ORDER BY sequence DESC LIMIT 1").get(evidence.runId)!;
  requireEvidence(history?.reason === "ci_repair_runtime_budget_exceeded", "attention reason is not allowlisted");
  const detail = JSON.parse(String(history.details_json));
  const tailPath = resolve(home, `logs/runtime-timeouts/ci_repair-${evidence.attemptId}.txt`);
  requireEvidence(detail.runtimeKind === "ci_repair" && detail.runtimeId === evidence.attemptId &&
    detail.tmuxSessionName === evidence.sessionName && detail.terminalTailPath === tailPath && detail.startedAt === attempt.created_at &&
    detail.tmuxAliveAtStart === true && detail.forced === true && detail.timeoutMinutes === 90, "timeout evidence changed");
  requireEvidence(realpathSync(tailPath) === tailPath && statSync(tailPath).isFile(), "transcript path changed");
  const transcript = readFileSync(tailPath);
  const transcriptSha256 = createHash("sha256").update(transcript).digest("hex");
  requireEvidence(transcriptSha256 === evidence.transcriptSha256 && transcriptHasCompletedTurn(transcript.toString()) &&
    transcript.toString().includes("Worked for 50s • 09:50"), "preserved completed transcript changed");
  requireEvidence(project.repository === evidence.repository, "registry repository changed");
  const worktree = String(row.worktree_path);
  const root = realpathSync(project.workspace.worktree_root);
  const child = relative(root, worktree);
  requireEvidence(child && !child.startsWith("..") && realpathSync(worktree) === worktree, "worktree boundary changed");
  const git = (...args: string[]) => command("git", ["-C",worktree,...args]);
  requireEvidence(git("rev-parse","--show-toplevel") === worktree && git("branch","--show-current") === evidence.branch &&
    git("status","--porcelain","--untracked-files=all") === "", "worktree identity or cleanliness changed");
  const common = git("rev-parse","--path-format=absolute","--git-common-dir");
  requireEvidence(common === command("git", ["-C",project.workspace.canonical_repository,"rev-parse","--path-format=absolute","--git-dir"]) &&
    git("rev-parse","--path-format=absolute","--git-dir").startsWith(common + "/worktrees/"), "linked repository changed");
  requireEvidence(git("remote","get-url","origin").replace(/\.git$/u, "") === `https://github.com/${evidence.repository}`,
    "origin changed");
  requireEvidence(git("rev-parse","HEAD") === evidence.sourceSha && git("rev-parse",`refs/remotes/origin/${evidence.branch}`) === evidence.sourceSha,
    "source or remote SHA changed");
  const ci = database.prepare("SELECT * FROM run_ci_snapshots WHERE run_id=?").get(evidence.runId)!;
  requireEvidence(ci?.repository === evidence.repository && ci.pull_request_number === evidence.pullNumber &&
    ci.pull_request_url === `https://github.com/${evidence.repository}/pull/${evidence.pullNumber}` && ci.head_sha === evidence.sourceSha &&
    ci.aggregate_state === "failed" && ci.last_error === null && Date.now() - Date.parse(String(ci.last_observed_at)) >= 0 &&
    Date.now() - Date.parse(String(ci.last_observed_at)) <= 120_000, "fresh exact PR/SHA evidence missing");
  noWriter(worktree,evidence.sessionName);
  return { worktree, historySequence: Number(history.sequence), transcriptSha256 };
}

export function recoverLegacyCiTimeout(database: DatabaseSync, home: string, project: Project, apply: boolean,
  evidence: Evidence = pf33RecoveryEvidence, noWriter = assertNoLegacyWriter): object {
  if (apply) database.exec("BEGIN IMMEDIATE");
  try {
    const inspected = inspectLegacyCiTimeout(database,home,project,evidence,noWriter);
    if (apply) {
      database.prepare("UPDATE run_ci_repair_attempts SET failure_reason=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE attempt_id=?")
        .run(legacyCiBillingReason,evidence.attemptId);
      database.prepare("UPDATE runs SET state='parked_review',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=?").run(evidence.runId);
      database.prepare("INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES (?,'needs_attention','parked_review',?,?)")
        .run(evidence.runId,legacyCiBillingReason,JSON.stringify({ ...inspected, attemptId:evidence.attemptId, sourceHeadSha:evidence.sourceSha,
          pullRequestNumber:evidence.pullNumber, codexThreadId:evidence.threadId, previousCodexThreadId:evidence.previousThreadId,
          externalBlock:"github_billing_or_spending_limit", repairRetry:false }));
      database.exec("COMMIT");
    }
    return { ok:true,apply,runId:evidence.runId,action:legacyCiBillingReason,...inspected,repairRetry:false };
  } catch (error) { if (apply) database.exec("ROLLBACK"); throw error; }
}

if (import.meta.main) {
  process.umask(0o077);
  const args = process.argv.slice(2);
  requireEvidence(args.length === 2 || args.length === 3, "use --run-id <allowlisted run> [--apply]");
  requireEvidence(args[0] === "--run-id" && args[1] === pf33RecoveryEvidence.runId &&
    (args.length === 2 || args[2] === "--apply"), "run/arguments are not allowlisted");
  const home = resolveKuramiHome(resolve(import.meta.dirname,"../../../../.."));
  const apply = args.includes("--apply");
  const config = parse(readFileSync(resolve(home,"config/orchestrator.yaml"),"utf8"));
  requireEvidence(config.mode === "live", "controller is not in live mode");
  const registry = parse(readFileSync(resolve(home,"config/projects.yaml"),"utf8"));
  const database = new DatabaseSync(resolve(home,"state/orchestrator.db"), { readOnly:!apply,timeout:5_000 });
  try { process.stdout.write(JSON.stringify(recoverLegacyCiTimeout(database,home,registry.projects.pickflick,apply)) + "\n"); }
  finally { database.close(); }
}
