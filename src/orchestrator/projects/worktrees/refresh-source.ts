import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { loadOwnerGitHubTokenFromFile } from "../../integrations/github/app-auth.ts";
import { reviewContextMatches } from "../../controls/ai-review.ts";
import { assertNoLegacyWriter } from "../sessions/recover-legacy-ci-timeout.ts";

export type SourceAction = "review_fix_start" | "repair_start" | "preview_allocate" | "preview_up" | "review_fix_retry_prepare";
export type SourceProject = { repository: string; workspace: {
  canonical_repository: string; worktree_root: string; base_branch: string;
} };
type Pull = { number: number; html_url: string; state: string; merged: boolean;
  head: { sha: string; ref: string; repo: { full_name: string } };
  base: { ref: string; repo: { full_name: string } } };
export type SourceEffects = {
  pull: (repository: string, number: number) => Pull;
  remoteHead: (repository: string, branch: string) => string;
  fetch: (worktree: string, repository: string, branch: string) => void;
  noWriter: (worktree: string) => void;
};
function requireSource(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`Managed source refresh refused: ${message}`);
}
function command(executable: string, args: string[], env = process.env): string {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 60_000,
    env: { ...env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  // Authenticated subprocess diagnostics must not reach requests/logs.
  requireSource(result.status === 0, `${executable} evidence or operation unavailable`);
  return result.stdout.trim();
}
function git(worktree: string, ...args: string[]): string {
  return command("git", ["-C", worktree, "-c", "core.hooksPath=/dev/null", ...args]);
}

/** A bounded admission preflight, shared by preview and technical writers. Never
 * resets/rebases: an unpublished/divergent tip is retained and needs owner action.
 * BEGIN IMMEDIATE fences managed ownership; independent external writers must be
 * quiescent. Remote movement refuses admission, never rolls back a safe FF. */
export function refreshManagedSource(database: DatabaseSync, project: SourceProject,
  runId: string, action: SourceAction, requestId: string | undefined, apply: boolean,
  effects: SourceEffects): object {
  requireSource(["review_fix_start", "repair_start", "preview_allocate", "preview_up", "review_fix_retry_prepare"].includes(action), "unsupported admission action");
  const retry = action === "review_fix_retry_prepare";
  requireSource(!retry || !apply, "retry preparation source validation is read-only");
  database.exec(apply ? "BEGIN IMMEDIATE" : "BEGIN");
  try {
    const run = database.prepare(`SELECT r.*,rr.resource_state,rr.worktree_path,rr.branch_name,
      rr.tmux_session_name,rr.previous_codex_thread_id FROM runs r JOIN run_resources rr USING(run_id)
      WHERE run_id=?`).get(runId);
    // Existing preview admission supports Remote-owned/active runs. Do not add
    // ownership restrictions when no synchronization is needed; the runtime
    // still enforces its original exact-HEAD and clean-source checks.
    if (action === "preview_allocate" || action === "preview_up") {
      const snapshot = database.prepare("SELECT head_sha FROM run_ci_snapshots WHERE run_id=?").get(runId);
      if (run?.worktree_path && snapshot?.head_sha && git(String(run.worktree_path),"rev-parse","HEAD") === snapshot.head_sha) {
        database.exec("COMMIT");
        return { ok:true,apply,runId,action:"managed_source_already_exact",headSha:snapshot.head_sha };
      }
    }
    requireSource(run && run.repository === project.repository && run.state === (retry ? "needs_attention" : "parked_review") &&
      run.owner_state === "none" && run.stop_reason === null && run.execution_mode === "live" &&
      run.completion_requested_at === null && run.archived_at === null && run.resource_state === "provisioned" &&
      run.tmux_session_name === null && (retry || run.previous_codex_thread_id === null), "run/owner/resource fence changed");
    requireSource(!database.prepare(`SELECT 1 FROM runs WHERE project=? AND item_id=?
      AND rowid>(SELECT rowid FROM runs WHERE run_id=?)`).get(run.project,run.item_id,runId), "run superseded");
    requireSource(!database.prepare(`SELECT 1 FROM project_events WHERE project=? AND item_id=?
      AND processing_state='pending' AND event_id<>? AND from_status IS NOT to_status`)
      .get(run.project,run.item_id,run.trigger_event_id), "pending Project transition");
    const worktree = String(run.worktree_path), branch = String(run.branch_name);
    const requestAction = (action === "review_fix_start" || retry) ? "review_fix" : action === "repair_start" ? "ci_repair" : "preview_start";
    requireSource(requestId || requestAction === "preview_start", "writer request missing");
    if (requestId) {
      const request = database.prepare("SELECT * FROM run_control_requests WHERE request_id=? AND run_id=?").get(requestId, runId);
      requireSource(request?.action === requestAction && (retry ? request.request_state === "applied" : ["pending", "processing"].includes(String(request.request_state))), "request changed");
    }
    requireSource(!database.prepare(`SELECT 1 FROM run_control_requests WHERE run_id=? AND request_id<>?
      AND request_state IN ('pending','processing')`).get(runId,requestId ?? ""), "conflicting control request");
    for (const [table, condition] of [
      ["run_ci_repair_attempts", "attempt_state IN ('running','waiting_ci')"],
      ["run_review_fix_rounds", "round_state IN ('running','waiting_ci','resolving')"],
      ["run_ai_reviews", "review_state='running'"],
      ["run_autonomous_successions", "succession_state IN ('starting','running')"],
    ]) requireSource(!database.prepare(`SELECT 1 FROM ${table} WHERE run_id=? AND ${condition}`).get(runId), "active worker");
    requireSource(!database.prepare(`SELECT 1 FROM run_resources rr JOIN runs r USING(run_id)
      WHERE rr.worktree_path=? AND r.run_id<>? AND (r.owner_state<>'none' OR rr.tmux_session_name IS NOT NULL)`)
      .get(worktree,runId), "another run owns worktree");
    requireSource(!database.prepare("SELECT 1 FROM run_codex_tasks WHERE worktree_path=? AND released_at IS NULL").get(worktree), "active protocol task");
    const leases = database.prepare(`SELECT pl.* FROM preview_leases pl JOIN run_resources rr USING(run_id)
      WHERE rr.worktree_path=? AND pl.state<>'released'`).all(worktree);
    const child = relative(realpathSync(project.workspace.worktree_root),worktree);
    requireSource(child && !child.startsWith("..") && realpathSync(worktree) === worktree &&
      git(worktree,"rev-parse","--show-toplevel") === worktree, "worktree boundary changed");
    const common = git(worktree,"rev-parse","--path-format=absolute","--git-common-dir");
    requireSource(common === git(project.workspace.canonical_repository,"rev-parse","--path-format=absolute","--git-dir") &&
      git(worktree,"rev-parse","--path-format=absolute","--git-dir").startsWith(common + "/worktrees/"), "wrong canonical repository");
    requireSource(git(worktree,"remote","get-url","origin").replace(/\.git$/u, "") === `https://github.com/${project.repository}`, "wrong origin repository");
    const clean = () => {
      requireSource(git(worktree,"branch","--show-current") === branch, "wrong branch");
      requireSource(!git(worktree,"status","--porcelain","--untracked-files=all"), "dirty worktree preserved");
      effects.noWriter(worktree);
    };
    clean();
    const ci = database.prepare("SELECT * FROM run_ci_snapshots WHERE run_id=?").get(runId);
    requireSource(ci?.repository === project.repository && typeof ci.head_sha === "string" &&
      /^[0-9a-f]{40,64}$/u.test(ci.head_sha) && ci.pull_request_number &&
      ci.pull_request_url === `https://github.com/${project.repository}/pull/${ci.pull_request_number}`, "exact PR snapshot missing");
    const head = ci.head_sha;
    if (requestId && requestAction !== "preview_start") requireSource(reviewContextMatches(database,requestId,head,String(ci.pull_request_url)), "displayed source changed");
    const live = () => {
      const pull = effects.pull(project.repository,Number(ci.pull_request_number));
      requireSource(pull.number === ci.pull_request_number && pull.html_url === ci.pull_request_url &&
        pull.state === "open" && pull.merged === false && pull.head.sha === head && pull.head.ref === branch &&
        pull.head.repo.full_name === project.repository && pull.base.ref === project.workspace.base_branch &&
        pull.base.repo.full_name === project.repository, "live PR identity/head changed");
      requireSource(effects.remoteHead(project.repository,branch) === head, "remote branch head changed");
    };
    live();
    const previousHead = git(worktree,"rev-parse","HEAD");
    if (previousHead !== head) {
      requireSource(!retry, "no-edit retry source changed; no refresh allowed");
      // Preview blocks changing its source, not validating an already exact writer source.
      requireSource(leases.every(lease => action === "preview_up" && lease.run_id === runId && lease.state === "leased"), "active preview runtime or lease");
      if (apply) effects.fetch(worktree,project.repository,branch);
      // Dry-run does not fetch/write refs. Missing objects are an explicit refusal.
      requireSource(git(worktree,"cat-file","-t",head) === "commit", "source commit unavailable");
      const ancestor = spawnSync("git",["-C",worktree,"merge-base","--is-ancestor",previousHead,head]);
      requireSource(ancestor.status === 0, `divergent or unpublished local commits preserved at ${previousHead}; no reset permitted`);
      live(); clean();
      requireSource(git(worktree,"rev-parse","HEAD") === previousHead, "local head changed before fast-forward");
      if (apply) git(worktree,"merge","--ff-only","--no-edit",head);
    }
    live(); clean();
    requireSource(git(worktree,"rev-parse","HEAD") === (apply ? head : previousHead), "local head changed after refresh");
    const result = { ok:true, apply, runId, action:"managed_source_refreshed", admission:action,
      previousHeadSha:previousHead, headSha:head, fastForward:previousHead !== head, worktreePath:worktree };
    if (apply && previousHead !== head) database.prepare(`INSERT INTO run_state_history
      (run_id,from_state,to_state,reason,details_json) VALUES (?,'parked_review','parked_review','managed_source_fast_forward',?)`)
      .run(runId,JSON.stringify(result));
    database.exec("COMMIT");
    return result;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function ownerSourceEffects(token: string): SourceEffects {
  const remote = (repository: string) => `https://github.com/${repository}.git`;
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT:"0", GIT_CONFIG_COUNT:"2",
    GIT_CONFIG_KEY_0:"http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0:`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    GIT_CONFIG_KEY_1:"credential.helper", GIT_CONFIG_VALUE_1:"" };
  return {
    pull: (repository,number) => JSON.parse(command(process.env.GH_BIN?.trim() || "gh",
      ["api","--method","GET",`repos/${repository}/pulls/${number}`],{ ...process.env,GH_TOKEN:token })),
    remoteHead: (repository,branch) => {
      const value = command("git",["ls-remote","--exit-code","--",remote(repository),`refs/heads/${branch}`],gitEnv);
      const parts = value.split("\t");
      requireSource(parts.length === 2 && parts[1] === `refs/heads/${branch}`, "ambiguous remote head");
      return parts[0]!;
    },
    fetch: (worktree,repository,branch) => { command("git",["-C",worktree,"-c","core.hooksPath=/dev/null",
      "fetch","--no-tags","--no-write-fetch-head","--",remote(repository),`refs/heads/${branch}`],gitEnv); },
    noWriter: (worktree) => {
      assertNoLegacyWriter(worktree,"kurami-source-refresh-unused");
      const panes = spawnSync("tmux",["list-panes","-a","-F","#{pane_current_path}"],{encoding:"utf8"});
      requireSource(panes.status === 1 || (panes.status === 0 && !panes.stdout.split("\n")
        .some(path => path === worktree || path.startsWith(worktree + "/"))), "live worktree session or unavailable evidence");
    },
  };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const value = (flag: string) => args[args.indexOf(flag)+1];
    const runId = value("--run-id"), action = value("--action") as SourceAction;
    requireSource(args.includes("--run-id") && /^r_[A-Za-z0-9_]+$/u.test(runId ?? "") && args.includes("--action"), "valid run and action required");
    const home = resolveKuramiHome(resolve(import.meta.dirname,"../../../../.."));
    const apply = args.includes("--apply");
    const config = parse(readFileSync(resolve(home,"config/orchestrator.yaml"),"utf8"));
    requireSource(config.mode === "live", "not live mode");
    const registry = parse(readFileSync(resolve(home,"config/projects.yaml"),"utf8"));
    const database = new DatabaseSync(resolve(home,"state/orchestrator.db"),{readOnly:!apply,timeout:5_000});
    try {
      const run = database.prepare("SELECT project FROM runs WHERE run_id=?").get(runId!);
      requireSource(run && registry.projects[String(run.project)], "unknown project");
      // Same protected owner credential as the writer launcher, not reviewer/App permissions.
      const source = database.prepare(`SELECT rr.worktree_path,ci.head_sha FROM run_resources rr
        JOIN run_ci_snapshots ci USING(run_id) WHERE run_id=?`).get(runId!);
      const exactPreview = ["preview_allocate","preview_up"].includes(action) && source?.worktree_path &&
        source.head_sha === git(String(source.worktree_path),"rev-parse","HEAD");
      const token = exactPreview ? "" : await loadOwnerGitHubTokenFromFile(home);
      const result = refreshManagedSource(database,registry.projects[String(run.project)],runId!,action,
        args.includes("--request-id") ? value("--request-id") : undefined,apply,ownerSourceEffects(token));
      process.stdout.write(JSON.stringify(result) + "\n");
    } finally { database.close(); }
  } catch (error) {
    process.stderr.write(JSON.stringify({ok:false,error:error instanceof Error ? error.message : String(error)}) + "\n");
    process.exitCode = 1;
  }
}
