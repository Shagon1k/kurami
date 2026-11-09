import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { appendHistory } from "./session-shared.ts";
import { assertNoLegacyWriter } from "./recover-legacy-ci-timeout.ts";

export const pf64RecoveryReason = "operator_pf64_unauthorized_successor_recovery";
// This is an incident receipt, not a general undo/approval API. All historical rows stay immutable.
export const pf64RecoveryEvidence = Object.freeze({
  runId: "r_ad1cb06b98e1bdd2f0cc", project: "pickflick", repository: "Shagon1k/PickFlick", issueNumber: 64,
  itemId: "PVTI_lAHOAKqXQ84Bfsnszg3wsRM",
  canonical: "/home/shagon1k/_projects/PickFlick",
  worktree: "/home/shagon1k/_projects/.worktrees/pickflick/PF-64_19-1-approve-retention-deletion-export/PickFlick",
  branch: "PF-64_19-1-approve-retention-deletion-export",
  sourceSha: "db768009273baaf698b1d9045b7ebe229d349e17",
  unauthorizedSha: "543df57d358460b445ecaae25a0a5184710a664c",
  predecessorThreadId: "01a1b378-3511-7681-9ee0-c4624de8203a",
  successorThreadId: "01a1b55f-3ceb-7793-9ff2-963ff27f70c1",
  successionId: "ras_26df42bb870048bc8ed2da765a0d9440",
  requestId: "rq_ca850b3a09ae45e48c6061a1f92ebd60",
  claimRequestId: "rq_bea9361c3d414ff0ae485d0396f0b850", sessionName: "cx-pf-64-ad1cb0-a1",
  successionHash: "bd0ee9984e2d38fad16774f24c857f765c8e70bdb0dffaf216ffe536d6d4bfd2",
  requestsHash: "7508ffd33f69ba158d35507e023d385c2cd5688a60071cf1cb73199901d8c94a",
  projectRequestsHash: "5bec32b5d2172bb1604bc087a8290a12c6aa32d820ac5ea0f6a2db870c1a48bc",
  historyHash: "e64457d154331e39c189328df1ff032ae230054547be9634b797d40da7fb86e5",
  predecessorRollout: "/home/shagon1k/.codex/sessions/2026/11/07/rollout-2026-11-07T00-46-02-01a1b378-3511-7681-9ee0-c4624de8203a.jsonl",
  predecessorRolloutHash: "db3f37cf45f7ca974b10e319bdf4205e3adf3a14aac4a70524e8104c6945a274",
  predecessorTurnId: "01a1b378-3634-7ad3-8619-54eaad9e8f92",
  successorRollout: "/home/shagon1k/.codex/sessions/2026/11/07/rollout-2026-11-07T09-38-00-01a1b55f-3ceb-7793-9ff2-963ff27f70c1.jsonl",
  successorRolloutHash: "34280b3885d7708664d8c004855e73d6111b0573ff6686a35d1526548c9e7577",
  successorTurnId: "01a1b55f-3e45-7d12-bdd4-80d9306a6ced",
});
type Evidence = { [K in keyof typeof pf64RecoveryEvidence]: typeof pf64RecoveryEvidence[K] extends string ? string : number };
type Project = { repository: string; workspace: { canonical_repository: string; worktree_root: string; base_branch: string } };
type Confirmation = { remoteIdle: boolean; launchersQuiescent: boolean };
function requireEvidence(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(`PF-64 recovery refused: ${reason}`);
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function command(executable: string, args: string[]): string {
  const result = spawnSync(executable,args,{encoding:"utf8",timeout:30_000,
    env:{...process.env,GIT_OPTIONAL_LOCKS:"0"},stdio:["ignore","pipe","pipe"]});
  requireEvidence(result.status === 0, `${executable} evidence unavailable`);
  return result.stdout.trim();
}

export function inspectPf64Rollout(path: string, expectedHash: string, threadId: string, turnId: string, worktree: string): string {
  requireEvidence(realpathSync(path) === path && statSync(path).size <= 2_000_000, "rollout path/size changed");
  const bytes = readFileSync(path);
  requireEvidence(hash(bytes) === expectedHash, "exact local rollout changed; Remote idle must be re-established");
  const records = bytes.toString("utf8").trimEnd().split("\n").map(line => JSON.parse(line));
  requireEvidence(records[0]?.type === "session_meta" && records[0].payload.id === threadId &&
    records[0].payload.cwd === worktree, "rollout thread/worktree mismatch");
  // Exact byte pin includes all records, including activity/settings after completion.
  const terminal = records.filter(record => record.type === "event_msg" &&
    ["task_started","task_complete","turn_aborted"].includes(record.payload?.type)).at(-1);
  requireEvidence(terminal?.payload.type === "task_complete" && terminal.payload.turn_id === turnId,
    "local rollout does not prove the exact completed turn");
  return expectedHash;
}

export function assertPf64NoLocalProcesses(e: Evidence, procRoot = "/proc"): void {
  assertNoLegacyWriter(e.worktree,e.sessionName);
  const ownerUid = statSync(e.worktree).uid;
  const panes = spawnSync("tmux",["list-panes","-a","-F","#{pane_current_path}"],{encoding:"utf8"});
  requireEvidence(panes.status === 1 || (panes.status === 0 && !panes.stdout.split("\n")
    .some(path => path === e.worktree || path.startsWith(e.worktree + "/"))), "tmux owns worktree or evidence unavailable");
  for (const pid of readdirSync(procRoot).filter(value => /^\d+$/u.test(value))) {
    try {
      // Other users' processes are not managed launchers; the native Codex guard above is global.
      if (statSync(`${procRoot}/${pid}`).uid !== ownerUid) continue;
      const words = readFileSync(`${procRoot}/${pid}/cmdline`,"utf8").split("\0");
      requireEvidence(!words.some(word => word === e.worktree || word.startsWith(e.worktree + "/") ||
          word.endsWith("=" + e.worktree) || word.includes("=" + e.worktree + "/")),
        "active local process uses worktree");
      // The systemd-supervised credential agent is not a project writer. Its
      // non-dumpable cwd is unreadable even to its owner; verify the exact unit
      // identity and configured home directory instead of weakening unknown-process checks.
      if (words[0] === "/usr/bin/gpg-agent" && words.filter(Boolean).length === 2 && words[1] === "--supervised") {
        const service = command("systemctl",["--user","show","gpg-agent.service",
          "--property=MainPID","--property=WorkingDirectory","--property=ActiveState"]);
        if (service.split("\n").includes(`MainPID=${pid}`) &&
            service.split("\n").includes("WorkingDirectory=!/home/shagon1k") &&
            service.split("\n").includes("ActiveState=active")) continue;
      }
      // Incident-pinned, pre-existing credential/PAM agents cannot execute project
      // work, and Linux deliberately hides their cwd. Reject replacement PIDs.
      const knownDaemon: Record<string, readonly [string,string]> = {
        "3395255": ["ssh-agent\0-s\0","745863421"],
        "972": ["(sd-pam)\0","982"],
      };
      const daemon = knownDaemon[pid];
      if (daemon && words.join("\0") === daemon[0] &&
          readFileSync(`${procRoot}/${pid}/stat`,"utf8").split(") ")[1]?.trim().split(/\s+/u)[19] === daemon[1]) continue;
      const cwd = realpathSync(`${procRoot}/${pid}/cwd`);
      requireEvidence(cwd !== e.worktree && !cwd.startsWith(e.worktree + "/"), "active local process uses worktree");
    } catch (error) {
      if (["ENOENT","ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
      if (["EACCES","EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw new Error(`PF-64 recovery refused: local process evidence unavailable (permission denied, pid=${pid})`);
      throw error;
    }
  }
}

export function inspectPf64ExternalEvidence(project: Project, e: Evidence,
  noProcesses: (evidence: Evidence) => void = assertPf64NoLocalProcesses): void {
  requireEvidence(project.repository === e.repository && project.workspace.canonical_repository === e.canonical &&
    project.workspace.base_branch === "main", "configured repository changed");
  const child = relative(realpathSync(project.workspace.worktree_root),e.worktree);
  requireEvidence(child && !child.startsWith("..") && realpathSync(e.worktree) === e.worktree, "worktree containment changed");
  const git = (...args: string[]) => command("git",["-C",e.worktree,...args]);
  requireEvidence(git("rev-parse","--show-toplevel") === e.worktree && git("branch","--show-current") === e.branch &&
    git("status","--porcelain","--untracked-files=all") === "", "source identity or cleanliness changed");
  const common = git("rev-parse","--path-format=absolute","--git-common-dir");
  requireEvidence(common === command("git",["-C",e.canonical,"rev-parse","--path-format=absolute","--git-dir"]) &&
    git("rev-parse","--path-format=absolute","--git-dir").startsWith(common + "/worktrees/"), "linked repository changed");
  requireEvidence(git("remote","get-url","origin").replace(/\.git$/u,"") === `https://github.com/${e.repository}` &&
    git("rev-parse","HEAD") === e.sourceSha && git("rev-parse",`refs/remotes/origin/${e.branch}`) === e.sourceSha,
    "local/tracking source SHA not restored");
  requireEvidence(command("git",["ls-remote","--exit-code",`https://github.com/${e.repository}.git`,`refs/heads/${e.branch}`]) ===
    `${e.sourceSha}\trefs/heads/${e.branch}`, "live remote branch source SHA not restored");
  // All states: any match on the first page refuses. An empty first page proves absence.
  const pulls = JSON.parse(command(process.env.GH_BIN?.trim() || "gh",["api","--method","GET",
    `repos/${e.repository}/pulls?state=all&head=Shagon1k:${encodeURIComponent(e.branch)}&per_page=1`]));
  requireEvidence(Array.isArray(pulls) && pulls.length === 0,
    "branch has a PR or PR absence is ambiguous");
  inspectPf64Rollout(e.predecessorRollout,e.predecessorRolloutHash,e.predecessorThreadId,e.predecessorTurnId,e.worktree);
  inspectPf64Rollout(e.successorRollout,e.successorRolloutHash,e.successorThreadId,e.successorTurnId,e.worktree);
  noProcesses(e);
}

export function recoverPf64UnauthorizedSuccessor(database: DatabaseSync, project: Project, apply: boolean,
  confirmations: Confirmation = {remoteIdle:false,launchersQuiescent:false}, e: Evidence = pf64RecoveryEvidence,
  inspectExternal: (project: Project, evidence: Evidence) => void = inspectPf64ExternalEvidence): object {
  // BEGIN IMMEDIATE fences native controller claims. It cannot lock the Remote app or independent launchers.
  database.exec(apply ? "BEGIN IMMEDIATE" : "BEGIN");
  try {
    const run = database.prepare(`SELECT r.*,rr.resource_state,rr.base_sha,rr.worktree_path,rr.branch_name,
      rr.codex_thread_id,rr.previous_codex_thread_id,rr.tmux_session_name,rr.preview_id
      FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id=?`).get(e.runId);
    requireEvidence(run && run.project === e.project && run.repository === e.repository && run.issue_number === e.issueNumber &&
      run.item_id === e.itemId && run.interaction_policy === "human_control" && run.execution_mode === "live", "run identity changed");
    const receipts = database.prepare("SELECT * FROM run_state_history WHERE run_id=? AND reason=? ORDER BY sequence")
      .all(e.runId,pf64RecoveryReason);
    requireEvidence(receipts.length <= 1, "ambiguous recovery receipts");
    const recovered = receipts.length === 1;
    requireEvidence(run.state === "remote_owned" && run.owner_state === "remote" && run.resource_state === "provisioned" &&
      run.stop_reason === null && run.completion_requested_at === null && run.completion_source_event_id === null &&
      run.archived_at === null && run.tmux_session_name === null && run.previous_codex_thread_id === null && run.preview_id === null &&
      run.base_sha === e.sourceSha && run.worktree_path === e.worktree && run.branch_name === e.branch &&
      run.codex_thread_id === (recovered ? e.predecessorThreadId : e.successorThreadId), "ownership/source/thread fence changed");
    for (const [table, expected] of [["run_autonomous_successions",e.successionHash],["run_control_requests",e.requestsHash],
      ["project_action_requests",e.projectRequestsHash],
      ["run_state_history",e.historyHash]]) {
      const rows = database.prepare(`SELECT * FROM ${table} WHERE run_id=? ORDER BY rowid`).all(e.runId)
        .filter(row => table !== "run_state_history" || row.reason !== pf64RecoveryReason);
      requireEvidence(hash(JSON.stringify(rows)) === expected, `${table} immutable receipt fence changed`);
    }
    const succession = database.prepare("SELECT * FROM run_autonomous_successions WHERE run_id=?").get(e.runId);
    requireEvidence(succession?.succession_id === e.successionId && succession.succession_number === 1 &&
      succession.succession_state === "parked" && succession.request_id === e.requestId &&
      succession.predecessor_thread_id === e.predecessorThreadId && succession.successor_thread_id === e.successorThreadId &&
      succession.source_head_sha === e.sourceSha && succession.worktree_path === e.worktree && succession.branch_name === e.branch &&
      succession.tmux_session_name === e.sessionName, "parked succession identity changed");
    for (const [table, condition] of [
      ["run_control_requests","request_state IN ('pending','queued','processing')"],
      ["run_codex_tasks","1=1"], ["run_ai_reviews","1=1"], ["run_ci_repair_attempts","1=1"],
      ["run_review_fix_rounds","1=1"],
      ["preview_leases","state<>'released'"],
    ]) requireEvidence(!database.prepare(`SELECT 1 FROM ${table} WHERE run_id=? AND ${condition}`).get(e.runId), "control or worker conflict");
    requireEvidence(!database.prepare(`SELECT 1 FROM project_events WHERE project=? AND item_id=?
      AND processing_state='pending' AND event_id<>? AND from_status IS NOT to_status`).get(e.project,e.itemId,run.trigger_event_id),
      "pending Project mutation");
    requireEvidence(!database.prepare("SELECT 1 FROM runs WHERE project=? AND item_id=? AND rowid>(SELECT rowid FROM runs WHERE run_id=?)")
      .get(e.project,e.itemId,e.runId), "run superseded");
    requireEvidence(!database.prepare(`SELECT 1 FROM run_resources WHERE worktree_path=? AND run_id<>?`).get(e.worktree,e.runId) &&
      !database.prepare("SELECT 1 FROM run_codex_tasks WHERE worktree_path=? AND released_at IS NULL").get(e.worktree), "other worktree owner");
    const details = { runId:e.runId, successionId:e.successionId, requestId:e.requestId, claimRequestId:e.claimRequestId,
      predecessorThreadId:e.predecessorThreadId, successorThreadId:e.successorThreadId, sourceHeadSha:e.sourceSha,
      unauthorizedHeadSha:e.unauthorizedSha, worktree:e.worktree, branch:e.branch,
      successionHash:e.successionHash, requestsHash:e.requestsHash, historyHash:e.historyHash,
      projectRequestsHash:e.projectRequestsHash,
      predecessorRolloutHash:e.predecessorRolloutHash, successorRolloutHash:e.successorRolloutHash,
      approvalGranted:false, predecessorResumed:false, successorResumed:false, countersReset:false,
      remoteIdleProven:false, operatorConfirmedRemoteIdle:true, operatorConfirmedLaunchersQuiescent:true };
    if (recovered) {
      requireEvidence(receipts[0]!.from_state === "remote_owned" && receipts[0]!.to_state === "remote_owned" &&
        receipts[0]!.details_json === JSON.stringify(details) && database.prepare(
          "SELECT sequence FROM run_state_history WHERE run_id=? ORDER BY sequence DESC LIMIT 1").get(e.runId)?.sequence === receipts[0]!.sequence,
        "recovery receipt changed or newer history exists");
    }
    inspectExternal(project,e);
    // Re-read all external observations immediately before mutation, not only at preflight.
    inspectExternal(project,e);
    if (apply && !recovered) {
      requireEvidence(confirmations.remoteIdle && confirmations.launchersQuiescent,
        "operator must confirm both Remote tasks idle and independent launchers quiescent; local rollout is not a Remote lock");
      const changed = database.prepare(`UPDATE run_resources SET codex_thread_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE run_id=? AND codex_thread_id=? AND tmux_session_name IS NULL AND previous_codex_thread_id IS NULL`)
        .run(e.predecessorThreadId,e.runId,e.successorThreadId);
      requireEvidence(changed.changes === 1, "thread mapping changed before recovery");
      appendHistory(database,e.runId,"remote_owned","remote_owned",pf64RecoveryReason,details);
    }
    database.exec("COMMIT");
    return {ok:true,apply,alreadyRecovered:recovered,action:pf64RecoveryReason,runId:e.runId,
      restoredThreadId:e.predecessorThreadId,remoteIdleProven:false,
      requiresOperatorRemoteIdleConfirmation:!recovered,requiresQuiescentLaunchers:!recovered};
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

if (import.meta.main) {
  process.umask(0o077);
  const args = process.argv.slice(2);
  const flags = args.slice(2);
  requireEvidence(args[0] === "--run-id" && args[1] === pf64RecoveryEvidence.runId && new Set(flags).size === flags.length &&
    flags.every(flag => ["--apply","--confirm-remote-idle","--confirm-launchers-quiescent"].includes(flag)),
    "use --run-id <allowlisted run> [--apply --confirm-remote-idle --confirm-launchers-quiescent]");
  const home = resolveKuramiHome(resolve(import.meta.dirname,"../../../../.."));
  requireEvidence(parse(readFileSync(resolve(home,"config/orchestrator.yaml"),"utf8")).mode === "live", "controller is not live");
  const registry = parse(readFileSync(resolve(home,"config/projects.yaml"),"utf8"));
  const apply = flags.includes("--apply");
  const database = new DatabaseSync(resolve(home,"state/orchestrator.db"),{readOnly:!apply,timeout:5_000});
  try { process.stdout.write(JSON.stringify(recoverPf64UnauthorizedSuccessor(database,registry.projects.pickflick,apply,
    {remoteIdle:flags.includes("--confirm-remote-idle"),launchersQuiescent:flags.includes("--confirm-launchers-quiescent")})) + "\n"); }
  finally { database.close(); }
}
