import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { cleanupParkProcesses, descendantProcesses } from "./park-processes.ts";
import { worktreeWriters, assertNoWorktreeWriter } from "./recover-legacy-ci-timeout.ts";
import { runFile } from "./session-shared.ts";

const requireEvidence = (ok: unknown, reason: string): void => {
  if (!ok) throw new Error(`Orphan sandbox recovery refused: ${reason}`);
};

/** Explicit operator recovery only. Cwd or process name alone never authorizes a signal. */
export function inspectOrphanSandbox(database: DatabaseSync, runId: string, pid: number) {
  const run = database.prepare(`SELECT r.state,r.owner_state,r.stop_reason,r.execution_mode,
    rr.resource_state,rr.worktree_path,rr.branch_name,rr.codex_thread_id,rr.previous_codex_thread_id,rr.tmux_session_name
    FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id=?`).get(runId);
  requireEvidence(run && run.state === "parked_review" && run.owner_state === "none" &&
    run.resource_state === "provisioned" &&
    run.stop_reason === null && run.execution_mode === "live" && run.tmux_session_name === null &&
    run.previous_codex_thread_id === null && run.codex_thread_id, "run is not a released primary task");
  for (const [table, condition] of [
    ["run_control_requests", "request_state IN ('pending','processing')"],
    ["run_ai_reviews", "review_state='running'"],
    ["run_review_fix_rounds", "round_state IN ('running','waiting_ci','resolving')"],
    ["run_autonomous_successions", "succession_state IN ('starting','running')"],
    ["run_codex_tasks", "released_at IS NULL"],
  ]) requireEvidence(!database.prepare(`SELECT 1 FROM ${table} WHERE run_id=? AND ${condition}`).get(runId), "control or worker conflict");
  const worktree = String(run!.worktree_path);
  requireEvidence(realpathSync(worktree) === worktree, "worktree identity changed");
  requireEvidence(!database.prepare(`SELECT 1 FROM run_resources rr JOIN runs r USING(run_id)
    WHERE rr.worktree_path=? AND rr.run_id<>? AND (r.owner_state<>'none' OR rr.tmux_session_name IS NOT NULL)`)
    .get(worktree,runId), "another run owns this copy");
  const git = (...args: string[]) => runFile("git", ["-C",worktree,...args]);
  requireEvidence(git("branch","--show-current") === run!.branch_name && git("status","--porcelain","--untracked-files=all") === "", "branch or cleanliness changed");
  const head = git("rev-parse","HEAD");
  const source = database.prepare("SELECT head_sha FROM run_ci_snapshots WHERE run_id=?").get(runId);
  requireEvidence(source?.head_sha === head, "observed source changed");
  requireEvidence(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid, "invalid process identity");
  const processes = descendantProcesses([pid]);
  const root = processes.find(entry => entry.pid === pid);
  // systemd --user is a child subreaper on development hosts; it adopts
  // the same abandoned children as PID 1, without becoming a task owner.
  const adopted = root?.parent === 1 || (root &&
    realpathSync(`/proc/${root.parent}/exe`) === "/usr/lib/systemd/systemd" &&
    readFileSync(`/proc/${root.parent}/cmdline`,"utf8").split("\0").includes("--user"));
  requireEvidence(adopted && root && !["Z","X"].includes(root.state), "sandbox is not a live orphan");
  const argv = readFileSync(`/proc/${pid}/cmdline`,"utf8").split("\0").filter(Boolean);
  requireEvidence(/(?:^|\/)codex-linux-sandbox$/u.test(argv[0] ?? "") &&
    (argv.includes("--sandbox-policy") || argv.includes("--permission-profile")), "not an orphan Codex sandbox");
  requireEvidence(realpathSync(`/proc/${pid}/cwd`) === worktree, "sandbox copy changed");
  const env = Object.fromEntries(readFileSync(`/proc/${pid}/environ`,"utf8").split("\0")
    .filter(value => value.includes("=")).map(value => [value.slice(0,value.indexOf("=")),value.slice(value.indexOf("=")+1)]));
  requireEvidence(env.HERMES_RUN_ID === runId && env.HERMES_WORKTREE_PATH === worktree &&
    env.CODEX_THREAD_ID === run!.codex_thread_id, "exact inherited task provenance unavailable");
  requireEvidence(!env.HERMES_CODEX_TASK_ID, "protocol tasks require their own lifecycle");
  // The old supervisor name is inherited by the primary launcher on current installations.
  // Without one, an operator cannot establish that its original supervisor is gone.
  requireEvidence(typeof env.TMUX === "string" && env.TMUX.length > 0, "supervisor provenance unavailable");
  const tmux = spawnSync("tmux", ["-S",env.TMUX!.split(",")[0]!,"list-panes","-a","-F","#{pane_current_path}"],{encoding:"utf8"});
  requireEvidence(tmux.status === 0 || (tmux.status === 1 && /no server running on|No such file or directory/u.test(tmux.stderr)), "supervisor evidence unavailable");
  requireEvidence(!tmux.stdout.split("\n").some(cwd => cwd === worktree || cwd.startsWith(worktree + "/")), "a supervisor still uses this copy");
  const owned = new Set(processes.map(entry => entry.pid));
  requireEvidence(worktreeWriters(worktree).every(writer => owned.has(writer)), "another writer uses this copy");
  const boot = readFileSync("/proc/sys/kernel/random/boot_id","utf8");
  const identities = processes.map(({pid,parent,started}) => ({pid,parent,started}));
  const fingerprint = createHash("sha256").update(JSON.stringify({runId,run,head,boot,processes:identities,argv})).digest("hex");
  return { runId, pid, head, threadId:String(run!.codex_thread_id), processes, worktree, fingerprint };
}

export async function recoverOrphanSandbox(database: DatabaseSync, runId: string, pid: number, fingerprint?: string) {
  // Hold the existing SQLite writer fence while checking controls and signalling.
  database.exec("BEGIN IMMEDIATE");
  try {
    const plan = inspectOrphanSandbox(database,runId,pid);
    if (!fingerprint) return { ok:true,apply:false,...plan };
    requireEvidence(fingerprint === plan.fingerprint, "process/task identity changed since dry-run");
    const cleaned = await cleanupParkProcesses(plan.processes);
    assertNoWorktreeWriter(plan.worktree);
    database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES(?,'parked_review','parked_review','orphan_sandbox_recovered',?)`).run(runId,JSON.stringify({pid,head:plan.head,threadId:plan.threadId,fingerprint,cleaned}));
    database.exec("COMMIT");
    return { ok:true,apply:true,runId,pid,cleaned,fingerprint };
  } finally { if (database.isTransaction) database.exec("ROLLBACK"); }
}

if (import.meta.main) {
  process.umask(0o077);
  const [runFlag,runId,pidFlag,pid,applyFlag,fingerprint] = process.argv.slice(2);
  requireEvidence(runFlag === "--run-id" && /^r_[A-Za-z0-9_]+$/u.test(runId ?? "") && pidFlag === "--pid" &&
    /^\d+$/u.test(pid ?? "") && (process.argv.length === 6 || (process.argv.length === 8 && applyFlag === "--apply" && /^[a-f0-9]{64}$/u.test(fingerprint ?? ""))),
    "use --run-id <run> --pid <orphan sandbox pid> [--apply <dry-run fingerprint>]");
  const home = resolveKuramiHome(resolve(import.meta.dirname,"../../../../.."));
  const database = new DatabaseSync(resolve(home,"state/orchestrator.db"),{timeout:5_000});
  try { process.stdout.write(JSON.stringify(await recoverOrphanSandbox(database,runId!,Number(pid),fingerprint)) + "\n"); }
  finally { database.close(); }
}
