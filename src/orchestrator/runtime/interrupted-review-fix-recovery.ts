import { isDeepStrictEqual } from "node:util";
import { hasActivePrRequest } from "../controls/pr-boundary.ts";
import { reviewContextMatches } from "../controls/ai-review.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  SourceEffects,
  SourceProject,
} from "../projects/worktrees/refresh-source.ts";
import { loadManagedReviewFixRecoverySnapshot } from "./managed-task-recovery.ts";
import type { ProtocolTask } from "../integrations/codex/task-store.ts";
import type { ReviewFixContext } from "../projects/sessions/session-types.ts";

export const interruptedReviewFixAction = "recover_interrupted_review_fix";
function requireRecovery(ok: unknown, reason: string): asserts ok {
  if (!ok)
    throw new Error(`Interrupted review fix recovery refused: ${reason}`);
}
function git(path: string, ...args: string[]): string {
  return execFileSync("git", ["-C", path, ...args], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Preserve staged, unstaged and untracked bytes separately. Never stash/reset/add.
 * Unsupported special paths and oversized evidence refuse rather than lose work. */
export function dirtyReviewFixSnapshot(path: string): {
  json: string;
  digest: string;
} {
  const status = git(
    path,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  );
  requireRecovery(status.length > 0, "no preserved dirty work");
  const diffArgs = [
    "--binary",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
  ];
  const untracked = git(
    path,
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const files = untracked.map((name) => {
    const file = resolve(path, name),
      child = relative(path, file),
      stat = lstatSync(file);
    requireRecovery(
      child &&
        !child.startsWith("..") &&
        stat.isFile() &&
        realpathSync(file) === file,
      "unsupported untracked path",
    );
    requireRecovery(stat.size <= 16 * 1024 * 1024, "untracked file too large");
    return {
      path: name,
      mode: stat.mode,
      bytes: readFileSync(file).toString("base64"),
    };
  });
  requireRecovery(
    !git(path, "ls-files", "--stage")
      .split("\n")
      .some((line) => line.startsWith("160000 ")),
    "submodule worktree unsupported",
  );
  const changed = [
    ...new Set(
      [
        ...git(path, "diff", "--name-only", "-z").split("\0"),
        ...git(path, "diff", "--cached", "--name-only", "-z").split("\0"),
      ].filter(Boolean),
    ),
  ].sort();
  const tracked = changed.map((name) => {
    const file = resolve(path, name),
      child = relative(path, file);
    requireRecovery(
      child && !child.startsWith(".."),
      "unsupported tracked path",
    );
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return { path: name, type: "missing" };
    requireRecovery(
      stat.isFile() || stat.isSymbolicLink(),
      "unsupported tracked type",
    );
    requireRecovery(
      realpathSync(resolve(file, "..")) === resolve(file, ".."),
      "unsupported tracked parent",
    );
    requireRecovery(stat.size <= 16 * 1024 * 1024, "tracked file too large");
    return {
      path: name,
      type: stat.isSymbolicLink() ? "symlink" : "file",
      mode: stat.mode,
      bytes: (stat.isSymbolicLink()
        ? readlinkSync(file, { encoding: "buffer" })
        : readFileSync(file)
      ).toString("base64"),
    };
  });
  const index = git(path, "ls-files", "--stage", "-z");
  const json = JSON.stringify({
    status,
    index,
    tracked,
    staged: git(path, "diff", "--cached", ...diffArgs),
    unstaged: git(path, "diff", ...diffArgs),
    untracked: files,
  });
  requireRecovery(
    Buffer.byteLength(json) <= 32 * 1024 * 1024,
    "dirty snapshot too large",
  );
  return { json, digest: createHash("sha256").update(json).digest("hex") };
}

export type InterruptedReviewFix = {
  taskId: string;
  turnId: string;
  roundId: string;
  snapshotJson: string;
  digest: string;
  contextDigest: string;
  sourceHeadSha: string;
  worktreePath: string;
  branchName: string;
  context: ReviewFixContext;
};

/** Local inspection is also used to expose the owner control. Live PR/remote and
 * process evidence are additionally required by the launch claim and dispatch. */
export function inspectInterruptedReviewFix(
  database: DatabaseSync,
  runId: string,
  project: SourceProject | undefined,
  requestId: string | null = null,
  effects?: SourceEffects,
): InterruptedReviewFix {
  const run = loadManagedReviewFixRecoverySnapshot(database, runId, requestId);
  requireRecovery(
    run && project && run.repository === project.repository,
    "repository mismatch",
  );
  requireRecovery(
    run.runState === "needs_attention" &&
      run.ownerState === "none" &&
      run.executionMode === "live" &&
      run.resourceState === "provisioned" &&
      run.stopReason === null &&
      run.tmuxSessionName === null &&
      run.codexThreadId &&
      run.previousCodexThreadId,
    "run ownership or resource fence changed",
  );
  requireRecovery(
    run.latestAttentionReason === "review_fix_uncommitted_changes" &&
      run.roundState === "needs_attention" &&
      run.roundFailureReason === run.latestAttentionReason &&
      run.matchingRoundCount === 1 &&
      run.roundId &&
      run.roundCodexThreadId === run.codexThreadId &&
      run.roundRequestAction === "review_fix" &&
      run.roundRequestState === "applied",
    "preserved round identity changed",
  );
  const details = JSON.parse(run.latestAttentionDetailsJson ?? "null");
  requireRecovery(
    details?.roundId === run.roundId &&
      details.sourceHeadSha === run.roundSourceHeadSha &&
      details.localHeadSha === run.roundSourceHeadSha &&
      details.codexThreadId === run.codexThreadId &&
      details.previousCodexThreadId === run.previousCodexThreadId,
    "preserved task identity changed",
  );
  requireRecovery(
    run.otherPendingControlCount === 0 &&
      run.activeRepairCount === 0 &&
      run.activeReviewCount === 0 &&
      run.activeReviewFixCount === 0,
    "competing control or worker",
  );
  requireRecovery(!hasActivePrRequest(database, runId), "active PR control");
  const row = database
    .prepare(
      `SELECT r.*,rr.worktree_path,rr.branch_name FROM runs r
    JOIN run_resources rr USING(run_id) WHERE run_id=?`,
    )
    .get(runId)!;
  requireRecovery(
    row.completion_requested_at === null &&
      row.archived_at === null &&
      !database
        .prepare(
          `SELECT 1 FROM runs WHERE project=? AND item_id=? AND
      rowid>(SELECT rowid FROM runs WHERE run_id=?)`,
        )
        .get(row.project, row.item_id, runId),
    "superseded or completing run",
  );
  requireRecovery(
    !database
      .prepare(
        `SELECT 1 FROM project_events WHERE project=? AND item_id=?
    AND processing_state='pending' AND from_status IS NOT to_status`,
      )
      .get(row.project, row.item_id),
    "pending Project transition",
  );
  requireRecovery(
    !database
      .prepare(
        `SELECT 1 FROM run_autonomous_successions WHERE run_id=?
    AND succession_state IN ('starting','running')`,
      )
      .get(runId),
    "active successor",
  );
  const path = run.worktreePath,
    branch = run.branchName,
    head = run.roundSourceHeadSha;
  requireRecovery(
    path && branch && head && /^[0-9a-f]{40,64}$/u.test(head),
    "source mapping missing",
  );
  const child = relative(realpathSync(project.workspace.worktree_root), path);
  requireRecovery(
    child &&
      !child.startsWith("..") &&
      realpathSync(path) === path &&
      git(path, "rev-parse", "--show-toplevel").trim() === path,
    "worktree boundary mismatch",
  );
  const common = git(
    path,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ).trim();
  requireRecovery(
    common ===
      git(
        project.workspace.canonical_repository,
        "rev-parse",
        "--path-format=absolute",
        "--git-dir",
      ).trim() &&
      git(path, "rev-parse", "--path-format=absolute", "--git-dir")
        .trim()
        .startsWith(common + "/worktrees/"),
    "canonical repository mismatch",
  );
  requireRecovery(
    git(path, "branch", "--show-current").trim() === branch &&
      git(path, "rev-parse", "HEAD").trim() === head,
    "local branch/head changed",
  );
  requireRecovery(
    git(path, "remote", "get-url", "origin")
      .trim()
      .replace(/\.git$/u, "") === `https://github.com/${project.repository}`,
    "origin changed",
  );
  requireRecovery(
    run.roundRepository === project.repository &&
      run.ciRepository === project.repository &&
      run.ciHeadSha === head &&
      run.ciPullRequestNumber === run.roundPullRequestNumber &&
      run.roundPullRequestUrl ===
        `https://github.com/${project.repository}/pull/${run.roundPullRequestNumber}` &&
      run.ciPullRequestUrl === run.roundPullRequestUrl,
    "PR source changed",
  );
  requireRecovery(
    !database
      .prepare(
        `SELECT 1 FROM run_resources rr JOIN runs r USING(run_id)
    WHERE rr.worktree_path=? AND r.run_id<>? AND (r.owner_state<>'none' OR rr.tmux_session_name IS NOT NULL)`,
      )
      .get(path, runId),
    "competing worktree owner",
  );
  requireRecovery(
    !database
      .prepare(
        `SELECT 1 FROM preview_leases p JOIN run_resources rr USING(run_id)
    WHERE rr.worktree_path=? AND p.state<>'released'`,
      )
      .get(path),
    "preview lease present",
  );
  requireRecovery(
    !database
      .prepare(
        `SELECT 1 FROM run_codex_tasks WHERE (run_id=? OR worktree_path=?)
    AND released_at IS NULL`,
      )
      .get(runId, path),
    "active protocol worker",
  );
  const tasks = database
    .prepare(
      `SELECT * FROM run_codex_tasks WHERE run_id=? AND kind='review_fix'
    AND context_id=? ORDER BY rowid DESC`,
    )
    .all(runId, run.roundId) as ProtocolTask[];
  const task = tasks[0];
  requireRecovery(
    task &&
      task.thread_id === run.codexThreadId &&
      task.worktree_path === path &&
      task.branch_name === branch &&
      task.phase === "terminal" &&
      task.turn_id &&
      task.turn_status === "failed" &&
      task.failure_code === "protocol_serverOverloaded" &&
      (task.stop_requested === null || task.stop_requested === "release") &&
      task.stopped_at &&
      task.released_at &&
      database
        .prepare(
          `SELECT 1 FROM run_codex_task_events
      WHERE task_id=? AND event_key=? AND method='turn/completed' AND thread_id=?
        AND turn_id=? AND status='failed' AND failure_code='protocol_serverOverloaded'`,
        )
        .get(
          task.task_id,
          `terminal:${task.turn_id}`,
          task.thread_id,
          task.turn_id,
        ),
    "worker lacks exact released failed terminal receipt",
  );
  requireRecovery(
    !database
      .prepare(
        "SELECT 1 FROM run_interrupted_review_fix_recoveries WHERE predecessor_task_id=?",
      )
      .get(task.task_id),
    "recovery already claimed; inspect existing receipt, never redispatch",
  );
  if (requestId)
    requireRecovery(
      database
        .prepare(
          `SELECT 1 FROM run_control_requests WHERE request_id=?
    AND run_id=? AND action=? AND request_state IN ('pending','processing')`,
        )
        .get(requestId, runId, interruptedReviewFixAction),
      "owner request changed",
    );
  requireRecovery(
    !database
      .prepare("SELECT 1 FROM run_review_fix_operations WHERE round_id=?")
      .get(run.roundId),
    "round operation already exists",
  );
  const round = database
    .prepare("SELECT * FROM run_review_fix_rounds WHERE round_id=?")
    .get(run.roundId)!;
  if (requestId)
    requireRecovery(
      reviewContextMatches(database, requestId, head, run.roundPullRequestUrl!),
      "displayed PR source changed",
    );
  const threads = JSON.parse(String(round.snapshot_json));
  let summaries: unknown;
  if (round.summary_findings_json === null) {
    // Older rounds stored only threads. The applied ORIGINAL launch receipt is
    // the sole permissible source of the missing scope, never today's reviews.
    const originalRequest = database
      .prepare(
        `SELECT * FROM run_control_requests
      WHERE request_id=? AND run_id=? AND action='review_fix' AND request_state='applied'`,
      )
      .get(round.request_id, runId);
    const launch = JSON.parse(String(originalRequest?.result_json ?? "null"));
    const fix = launch?.reviewFix;
    requireRecovery(
      launch?.ok === true &&
        launch.apply === true &&
        launch.action === "review_fix_started" &&
        launch.runId === runId &&
        fix?.requestId === round.request_id &&
        fix.roundId === round.round_id &&
        fix.roundNumber === round.round_number &&
        fix.sourceHeadSha === head &&
        fix.pullRequestNumber === round.pull_request_number &&
        fix.pullRequestUrl === round.pull_request_url &&
        fix.profile === round.review_profile &&
        fix.allReviews === Boolean(round.review_fix_all) &&
        originalRequest?.review_profile === round.review_profile &&
        originalRequest.review_fix_all === round.review_fix_all &&
        isDeepStrictEqual(fix.threads, threads) &&
        Array.isArray(fix.summaryOnlyFindings),
      "legacy round lacks complete immutable review context or original launch receipt conflicts",
    );
    summaries = fix.summaryOnlyFindings;
  } else {
    summaries = JSON.parse(String(round.summary_findings_json));
  }
  requireRecovery(
    Array.isArray(threads) &&
      Array.isArray(summaries) &&
      (threads.length > 0 || summaries.length > 0),
    "original review snapshot unavailable",
  );
  const threadRows = database
    .prepare(
      `SELECT thread_id,root_comment_id,source_kind,path,line
    FROM run_review_fix_threads WHERE round_id=? ORDER BY thread_id`,
    )
    .all(run.roundId);
  requireRecovery(
    isDeepStrictEqual(
      threadRows.map((row) => ({ ...row })),
      threads
        .map((thread) => ({
          thread_id: thread.threadId,
          root_comment_id: thread.rootCommentId,
          source_kind: thread.sourceKind,
          path: thread.path,
          line: thread.line,
        }))
        .sort((a, b) => a.thread_id.localeCompare(b.thread_id)),
    ),
    "original review thread rows conflict with snapshot",
  );
  const snapshot = dirtyReviewFixSnapshot(path);
  const contextDigest = createHash("sha256")
    .update(
      JSON.stringify([
        round.snapshot_json,
        summaries,
        round.review_profile,
        round.review_fix_all,
      ]),
    )
    .digest("hex");
  if (requestId) {
    const request = database
      .prepare(
        "SELECT review_fix_recovery_json FROM run_control_requests WHERE request_id=?",
      )
      .get(requestId)!;
    const intent = JSON.parse(
      String(request.review_fix_recovery_json ?? "null"),
    );
    requireRecovery(
      intent?.taskId === task.task_id &&
        intent.turnId === task.turn_id &&
        intent.roundId === run.roundId &&
        intent.headSha === head &&
        intent.dirtyDigest === snapshot.digest &&
        intent.contextDigest === contextDigest,
      "queued recovery identity or dirty bytes changed",
    );
  }
  if (effects) {
    effects.noWriter(path);
    const pull = effects.pull(project.repository, run.roundPullRequestNumber!);
    requireRecovery(
      pull.number === run.roundPullRequestNumber &&
        pull.html_url === run.roundPullRequestUrl &&
        pull.state === "open" &&
        !pull.merged &&
        pull.head.sha === head &&
        pull.head.ref === branch &&
        pull.head.repo.full_name === project.repository &&
        pull.base.repo.full_name === project.repository &&
        pull.base.ref === project.workspace.base_branch,
      "live PR identity/head changed",
    );
    requireRecovery(
      effects.remoteHead(project.repository, branch) === head,
      "remote branch head changed",
    );
    requireRecovery(
      dirtyReviewFixSnapshot(path).digest === snapshot.digest,
      "dirty bytes changed during inspection",
    );
  }
  return {
    taskId: task.task_id,
    turnId: task.turn_id,
    roundId: run.roundId,
    snapshotJson: snapshot.json,
    digest: snapshot.digest,
    contextDigest,
    sourceHeadSha: head,
    worktreePath: path,
    branchName: branch,
    context: {
      requestId: requestId ?? "",
      roundId: run.roundId,
      roundNumber: Number(round.round_number),
      sourceHeadSha: head,
      pullRequestNumber: run.roundPullRequestNumber!,
      pullRequestUrl: run.roundPullRequestUrl!,
      threads,
      summaryOnlyFindings: summaries,
      profile: round.review_profile as "general" | "clarity",
      allReviews: Boolean(round.review_fix_all),
    },
  };
}
