import { generateKeyPairSync, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const scenario = process.env.RECOVERY_SCENARIO ?? "positive";
if (scenario === "positive")
  for (const child of [
    "dirty-rejection",
    "dirty-rejection-processing",
    "request-rejection",
    "failed-successor",
    "managed-timeout",
  ]) {
    execFileSync(process.execPath, [import.meta.filename], {
      env: { ...process.env, RECOVERY_SCENARIO: child },
      stdio: "inherit",
    });
  }
const home = mkdtempSync(resolve(tmpdir(), "kurami-interrupted-fix-"));
process.env.KURAMI_HOME = home;
process.env.KURAMI_TEST_STATUS = "0";
const app = resolve(import.meta.dirname, "..");
const bin = resolve(home, "bin"),
  canonical = resolve(home, "canonical"),
  root = resolve(home, "worktrees"),
  worktree = resolve(root, "fix");
mkdirSync(bin);
mkdirSync(root);
mkdirSync(resolve(home, "state"));
mkdirSync(resolve(home, "config"));
const alive = resolve(home, "alive"),
  launches = resolve(home, "launches");
writeFileSync(resolve(bin, "codex"), "#!/bin/sh\nexit 91\n", { mode: 0o700 });
writeFileSync(
  resolve(bin, "tmux"),
  `#!/bin/sh
set -eu
case "$1" in
 list-sessions) exit 1;;
 has-session) test -f '${alive}';;
 new-session) printf '%s\\n' "$@" >> '${launches}'; touch '${alive}';;
 *) exit 92;;
esac
`,
  { mode: 0o700 },
);
process.env.PATH = `${bin}:${process.env.PATH}`;
process.env.CODEX_BIN = resolve(bin, "codex");
function git(path: string, ...args: string[]) {
  return execFileSync("git", ["-C", path, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
const { inspectInterruptedReviewFix, dirtyReviewFixSnapshot } =
  await import("../src/orchestrator/runtime/interrupted-review-fix-recovery.ts");
const { recoverInterruptedReviewFix } =
  await import("../src/orchestrator/projects/sessions/recover-interrupted-review-fix.ts");
const { loadRun } =
  await import("../src/orchestrator/projects/sessions/session-shared.ts");
const { requestRunControl, availableRunControls } =
  await import("../src/orchestrator/controls/run.ts");
const { externalCommand } =
  await import("../src/orchestrator/runtime/controller-execution.ts");
const {
  inspectManagedReviewFixRecovery,
  loadManagedReviewFixRecoverySnapshot,
} = await import("../src/orchestrator/runtime/managed-task-recovery.ts");
const database = new DatabaseSync(resolve(home, "state/orchestrator.db"));
try {
  database.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(resolve(app, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    database.exec(readFileSync(resolve(app, "migrations", name), "utf8"));
  execFileSync("git", ["init", "--initial-branch", "main", canonical], {
    stdio: "ignore",
  });
  git(canonical, "config", "user.email", "fixture@example.invalid");
  git(canonical, "config", "user.name", "Fixture");
  writeFileSync(resolve(canonical, "fix.txt"), "original\n");
  git(canonical, "add", "fix.txt");
  git(canonical, "commit", "-m", "fixture");
  git(
    canonical,
    "remote",
    "add",
    "origin",
    "https://github.com/example/project.git",
  );
  git(canonical, "worktree", "add", "-b", "fix-review", worktree);
  const head = git(worktree, "rev-parse", "HEAD");
  writeFileSync(resolve(worktree, "fix.txt"), "staged\n");
  git(worktree, "add", "fix.txt");
  writeFileSync(resolve(worktree, "fix.txt"), "unstaged\n");
  writeFileSync(
    resolve(worktree, "untracked\nbytes"),
    Buffer.from([0, 255, 7]),
  );
  const project = {
    owner: "example",
    project_number: 1,
    repository: "example/project",
    statuses: {
      backlog: "Todo",
      active: "Doing",
      review: "Human Review",
      done: "Done",
      deferred: "Later",
    },
    workspace: {
      canonical_repository: canonical,
      worktree_root: root,
      base_branch: "main",
      branch_prefix: "test",
    },
  };
  const registry = { version: 1, projects: { fixture: project } };
  const config = {
    version: 1,
    mode: "live" as const,
    limits: {
      max_tmux_sessions_global: 8,
      technical_worker_timeout_minutes: 7,
    },
  };
  writeFileSync(
    resolve(home, "config/projects.yaml"),
    JSON.stringify(registry),
  );
  writeFileSync(
    resolve(home, "config/orchestrator.yaml"),
    JSON.stringify({ ...config, limits: { ...config.limits,
      max_llm_running_global: 2, ai_triage_daily: 1,
      max_active_global: 3, max_active_per_project: 1,
      max_managed_worktrees_global: 8, max_managed_worktrees_per_project: 3,
      max_previews_global: 1, max_preview_builds_global: 1,
      preview_ttl_hours: 24, preview_expiry_warning_hours: 1,
      main_writer_timeout_minutes: 240, technical_worker_timeout_minutes: 90,
    } }),
  );
  database.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,title,url,payload_json,processing_state)
    VALUES ('ev','2026-01-01','fixture','item','content','Issue','example/project',1,'Fixture','https://github.com/example/project/issues/1','{}','processed');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
    VALUES ('r_fixture','ev','fixture','item','content','example/project',1,'autonomous','needs_attention','none','live');
    INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,base_sha,codex_thread_id,previous_codex_thread_id)
    VALUES ('r_fixture','provisioned','placeholder','fix-review','${head}','failed-thread','primary-thread');
    INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
    VALUES ('rq_original','r_fixture','review_fix','applied','cli','original');
    INSERT INTO run_review_fix_rounds(round_id,run_id,request_id,round_number,round_state,repository,pull_request_number,pull_request_url,source_head_sha,snapshot_json,codex_thread_id,failure_reason,summary_findings_json)
    VALUES ('rfr_feed1234','r_fixture','rq_original',1,'needs_attention','example/project',2,'https://github.com/example/project/pull/2','${head}','[]','failed-thread','review_fix_uncommitted_changes','[]');
    INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name,thread_id,turn_id,phase,turn_status,failure_code,stopped_at,released_at)
    VALUES ('task','r_fixture','review_fix','rfr_feed1234','cx-old','placeholder','fix-review','failed-thread','turn','terminal','failed','protocol_serverOverloaded','2026-01-01','2026-01-01');
    INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,pull_request_title,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
    VALUES ('r_fixture','example/project',2,'https://github.com/example/project/pull/2','Fixture','${head}','passed','[]','fixture','2026-01-01','2026-01-01','2026-01-01');
    INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
    VALUES ('r_fixture','parked_review','needs_attention','review_fix_uncommitted_changes',json_object('roundId','rfr_feed1234','sourceHeadSha','${head}','localHeadSha','${head}','codexThreadId','failed-thread','previousCodexThreadId','primary-thread'));`);
  database.prepare("UPDATE run_resources SET worktree_path=?").run(worktree);
  database.prepare("UPDATE run_codex_tasks SET worktree_path=?").run(worktree);
  const thread = {
    threadId: "original-thread",
    rootCommentId: 1,
    sourceKind: "owner",
    path: "fix.txt",
    line: 1,
    rootBody: "Original immutable finding",
    ownerReplies: [],
  };
  database
    .prepare("UPDATE run_review_fix_rounds SET snapshot_json=?")
    .run(JSON.stringify([thread]));
  database.exec(`INSERT INTO run_codex_task_events(task_id,event_key,method,thread_id,turn_id,status,failure_code)
    VALUES ('task','terminal:turn','turn/completed','failed-thread','turn','failed','protocol_serverOverloaded');
    INSERT INTO run_review_fix_threads(round_id,thread_id,root_comment_id,source_kind,path,line)
    VALUES ('rfr_feed1234','original-thread',1,'owner','fix.txt',1);`);
  database.exec("UPDATE run_review_fix_rounds SET created_at='2026-01-01T00:00:00.000Z'");
  const originalLaunch = {
    ok: true,
    apply: true,
    action: "review_fix_started",
    runId: "r_fixture",
    reviewFix: {
      requestId: "rq_original",
      roundId: "rfr_feed1234",
      roundNumber: 1,
      sourceHeadSha: head,
      pullRequestNumber: 2,
      pullRequestUrl: "https://github.com/example/project/pull/2",
      threads: [thread],
      profile: "general",
      allReviews: false,
      summaryOnlyFindings: [],
    },
  };
  const pull = {
    number: 2,
    html_url: "https://github.com/example/project/pull/2",
    state: "open",
    merged: false,
    head: {
      sha: head,
      ref: "fix-review",
      repo: { full_name: "example/project" },
    },
    base: { ref: "main", repo: { full_name: "example/project" } },
  };
  const effects = {
    pull: () => structuredClone(pull),
    remoteHead: () => head,
    noWriter: () => {},
    fetch: () => {
      throw Error("fetch forbidden");
    },
  };
  // Upgrade an actual populated pre-change schema, preserving all FK-linked evidence.
  const legacy = new DatabaseSync(":memory:");
  legacy.exec("PRAGMA foreign_keys=ON");
  const migrationNames = readdirSync(resolve(app, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrationNames.filter((name) => !name.startsWith("045_")))
    legacy.exec(readFileSync(resolve(app, "migrations", name), "utf8"));
  for (const table of [
    "project_events",
    "runs",
    "run_resources",
    "run_control_requests",
    "run_review_fix_rounds",
    "run_codex_tasks",
    "run_ci_snapshots",
    "run_state_history",
  ]) {
    const columns = legacy
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String(row.name));
    const insert = legacy.prepare(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    );
    for (const row of database.prepare(`SELECT * FROM ${table}`).all())
      insert.run(...columns.map((column) => row[column]!));
  }
  legacy.exec(
    readFileSync(
      resolve(app, "migrations/045_interrupted_review_fix_recovery.sql"),
      "utf8",
    ),
  );
  assert.equal(
    legacy.prepare("SELECT snapshot_json FROM run_review_fix_rounds").get()!
      .snapshot_json,
    JSON.stringify([thread]),
  );
  assert.equal(
    legacy
      .prepare("SELECT summary_findings_json FROM run_review_fix_rounds")
      .get()!.summary_findings_json,
    null,
  );
  assert.deepEqual(legacy.prepare("PRAGMA foreign_key_check").all(), []);
  legacy.close();
  const inspect = () =>
    inspectInterruptedReviewFix(database, "r_fixture", project, null, effects);
  const original = inspect();
  const dirty = dirtyReviewFixSnapshot(worktree);
  git(worktree, "config", "core.autocrlf", "true");
  const lf = dirtyReviewFixSnapshot(worktree);
  writeFileSync(resolve(worktree, "fix.txt"), "unstaged\r\n");
  assert.notEqual(
    dirtyReviewFixSnapshot(worktree).digest,
    lf.digest,
    "raw CRLF bytes are fenced despite Git normalization",
  );
  writeFileSync(resolve(worktree, "fix.txt"), "unstaged\n");
  git(worktree, "config", "core.filemode", "false");
  const originalMode = lstatSync(resolve(worktree, "fix.txt")).mode;
  const mode = dirtyReviewFixSnapshot(worktree);
  chmodSync(resolve(worktree, "fix.txt"), 0o755);
  assert.notEqual(
    dirtyReviewFixSnapshot(worktree).digest,
    mode.digest,
    "tracked mode is fenced with core.filemode=false",
  );
  chmodSync(resolve(worktree, "fix.txt"), originalMode);
  const indexed = JSON.parse(dirtyReviewFixSnapshot(worktree).json);
  assert.match(indexed.index, /100644 [a-f0-9]+ 0\tfix.txt/);
  git(worktree, "config", "core.autocrlf", "false");
  git(worktree, "config", "core.filemode", "true");
  assert.equal(original.context.threads[0]!.rootBody, thread.rootBody);
  assert.match(dirty.json, /untracked/);
  assert.match(dirty.json, /AP8H/);
  assert.equal(
    inspectManagedReviewFixRecovery(
      loadManagedReviewFixRecoverySnapshot(database, "r_fixture")!,
      project,
    ).eligible,
    false,
    "delivered recovery remains unavailable for interrupted dirty worker",
  );
  function refuse(sql: string, pattern: RegExp) {
    database.exec("SAVEPOINT negative");
    try {
      database.exec(sql);
      assert.throws(inspect, pattern);
    } finally {
      database.exec("ROLLBACK TO negative; RELEASE negative");
    }
  }
  refuse("UPDATE runs SET owner_state='cli'", /ownership/);
  refuse("UPDATE runs SET stop_reason='cancelled'", /ownership/);
  refuse("UPDATE run_codex_tasks SET released_at=NULL", /active protocol/);
  refuse(
    "UPDATE run_codex_tasks SET phase='running',turn_status=NULL",
    /terminal receipt/,
  );
  for (const code of [
    "permission_request_denied",
    "protocol_sandboxError",
    "protocol_turn_failed",
    "external_rate_limit",
    "unknown",
  ]) {
    refuse(
      `UPDATE run_codex_tasks SET failure_code='${code}'`,
      /terminal receipt/,
    );
  }
  for (const status of ["interrupted", "completed"])
    refuse(
      `UPDATE run_codex_tasks SET turn_status='${status}'`,
      /terminal receipt/,
    );
  for (const intent of ["cancel", "timeout"])
    refuse(
      `UPDATE run_codex_tasks SET stop_requested='${intent}'`,
      /terminal receipt/,
    );
  function markManagedTimeout() {
    database.exec(`UPDATE run_review_fix_rounds SET failure_reason='runtime_budget_exceeded';
      UPDATE run_codex_tasks SET turn_status='interrupted',failure_code='runtime_budget_exceeded',stop_requested='timeout';
      UPDATE run_codex_task_events SET status='interrupted',failure_code='protocol_turn_interrupted';
      INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES ('r_fixture','parked_review','needs_attention','review_fix_runtime_budget_exceeded',
        json_object('taskId','task','threadId','failed-thread','turnId','turn','turnStatus','interrupted',
          'failureCode','runtime_budget_exceeded','restoredThreadId',NULL));`);
  }
  database.exec("SAVEPOINT managed_timeout");
  try {
    markManagedTimeout();
    const recovered=inspect();
    assert.equal(recovered.taskId,original.taskId);
    assert.equal(recovered.digest,original.digest,"timeout recovery preserves the dirty work");
    assert.deepEqual(recovered.context,original.context,"timeout recovery keeps the original review scope");
    refuse("UPDATE run_codex_tasks SET stop_requested='cancel'",/terminal receipt/);
    refuse("DELETE FROM run_codex_task_events",/terminal receipt/);
    refuse("UPDATE run_state_history SET details_json=json_set(details_json,'$.taskId','other') WHERE reason='review_fix_runtime_budget_exceeded'",/timeout task identity/);
  } finally { database.exec("ROLLBACK TO managed_timeout; RELEASE managed_timeout"); }
  refuse("UPDATE run_codex_tasks SET stopped_at=NULL", /terminal receipt/);
  refuse(
    "UPDATE run_codex_tasks SET turn_id='another-turn'",
    /terminal receipt/,
  );
  refuse("DELETE FROM run_codex_task_events", /terminal receipt/);
  for (const field of [
    "thread_id",
    "turn_id",
    "failure_code",
    "status",
    "method",
    "event_key",
  ]) {
    refuse(
      `UPDATE run_codex_task_events SET ${field}='wrong'`,
      /terminal receipt/,
    );
  }
  refuse("UPDATE run_codex_tasks SET context_id='wrong'", /terminal receipt/);
  refuse("UPDATE run_codex_tasks SET thread_id='wrong'", /terminal receipt/);
  refuse(
    "UPDATE run_review_fix_rounds SET codex_thread_id='wrong'",
    /round identity/,
  );
  refuse(
    "UPDATE run_review_fix_rounds SET summary_findings_json=NULL",
    /complete immutable/,
  );
  database
    .prepare(
      "UPDATE run_control_requests SET result_json=? WHERE request_id='rq_original'",
    )
    .run(JSON.stringify(originalLaunch));
  database.exec("UPDATE run_review_fix_rounds SET summary_findings_json=NULL");
  assert.deepEqual(
    inspect().context.summaryOnlyFindings,
    [],
    "legacy empty scope comes from the original applied receipt, not a default",
  );
  assert.equal(inspect().contextDigest, original.contextDigest);
  const summary = {
    reviewId: "air_original",
    body: "Original summary finding",
  };
  const withSummary = structuredClone(originalLaunch) as Record<string, any>;
  withSummary.reviewFix.summaryOnlyFindings = [summary];
  database
    .prepare(
      "UPDATE run_control_requests SET result_json=? WHERE request_id='rq_original'",
    )
    .run(JSON.stringify(withSummary));
  assert.deepEqual(inspect().context.summaryOnlyFindings, [summary]);
  for (const field of [
    "requestId",
    "roundId",
    "roundNumber",
    "sourceHeadSha",
    "pullRequestNumber",
    "pullRequestUrl",
    "profile",
    "allReviews",
    "threads",
    "summaryOnlyFindings",
  ]) {
    const changed = structuredClone(originalLaunch) as Record<string, any>;
    changed.reviewFix[field] = null;
    database
      .prepare(
        "UPDATE run_control_requests SET result_json=? WHERE request_id='rq_original'",
      )
      .run(JSON.stringify(changed));
    assert.throws(
      inspect,
      /complete immutable/,
      `legacy mismatched ${field} refuses`,
    );
  }
  for (const field of ["ok", "apply", "action", "runId"]) {
    const changed = { ...originalLaunch, [field]: null };
    database
      .prepare(
        "UPDATE run_control_requests SET result_json=? WHERE request_id='rq_original'",
      )
      .run(JSON.stringify(changed));
    assert.throws(inspect, /complete immutable/);
  }
  database
    .prepare(
      "UPDATE run_control_requests SET result_json=? WHERE request_id='rq_original'",
    )
    .run(JSON.stringify(originalLaunch));
  refuse(
    "UPDATE run_control_requests SET result_json=NULL WHERE request_id='rq_original'",
    /complete immutable/,
  );
  refuse(
    "UPDATE run_control_requests SET review_profile='clarity' WHERE request_id='rq_original'",
    /complete immutable/,
  );
  refuse("UPDATE run_review_fix_threads SET root_comment_id=2", /thread rows/);
  // Exercise the actual recovery below from a pre-migration round with a NULL summary column.
  assert.equal(
    database
      .prepare("SELECT summary_findings_json FROM run_review_fix_rounds")
      .get()!.summary_findings_json,
    null,
  );
  refuse(
    "UPDATE run_ci_snapshots SET head_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
    /PR source/,
  );
  refuse("UPDATE run_resources SET branch_name='wrong'", /local branch/);
  refuse(
    "INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key) VALUES ('rq_conflict','r_fixture','take_control','cli','conflict')",
    /competing control/,
  );
  refuse(
    "INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name) VALUES ('preview','r_fixture',1,'leased','fixture')",
    /preview lease/,
  );
  assert.throws(
    () =>
      inspectInterruptedReviewFix(database, "r_fixture", project, null, {
        ...effects,
        remoteHead: () => "changed",
      }),
    /remote branch/,
  );
  assert.throws(
    () =>
      inspectInterruptedReviewFix(database, "r_fixture", project, null, {
        ...effects,
        pull: () => ({ ...pull, head: { ...pull.head, sha: "changed" } }),
      }),
    /live PR/,
  );
  assert.throws(
    () =>
      inspectInterruptedReviewFix(database, "r_fixture", project, null, {
        ...effects,
        noWriter: () => {
          throw Error("active writer");
        },
      }),
    /active writer/,
  );
  const moved = git(
    canonical,
    "commit-tree",
    git(canonical, "rev-parse", "HEAD^{tree}"),
    "-p",
    head,
    "-m",
    "moved",
  );
  git(canonical, "update-ref", "refs/heads/fix-review", moved);
  assert.throws(inspect, /local branch\/head/);
  git(canonical, "update-ref", "refs/heads/fix-review", head);
  git(canonical, "update-ref", "refs/heads/other", head);
  git(worktree, "symbolic-ref", "HEAD", "refs/heads/other");
  assert.throws(inspect, /branch\/head/);
  git(worktree, "symbolic-ref", "HEAD", "refs/heads/fix-review");
  if (scenario === "managed-timeout") markManagedTimeout();
  assert.ok(
    (
      availableRunControls(database, "r_fixture", { home })
        .available_actions as string[]
    ).includes("recover_interrupted_review_fix"),
  );
  const { projectRunActions, requestProjectRunAction } =
    await import("../src/projects-site/run-actions.ts");
  const now = new Date();
  database
    .prepare(
      `INSERT INTO project_items(project,item_id,content_type,repository,issue_number,title,status,present,first_seen_at,last_seen_at)
    VALUES('fixture','item','Issue','example/project',1,'Fixture','Human Review',1,?,?)`,
    )
    .run(now.toISOString(), now.toISOString());
  database
    .prepare(
      `INSERT INTO project_poll_state(project,initialized_at,last_captured_at,item_count,last_attempt_state)
    VALUES('fixture',?,?,1,'succeeded')`,
    )
    .run(now.toISOString(), now.toISOString());
  const displayed = projectRunActions(database, "r_fixture", home, now, true);
  const input = {
    runId: "r_fixture",
    project: "fixture",
    itemId: "item",
    action: "recover_interrupted_review_fix",
    fingerprint: displayed.fingerprint,
    key: randomUUID(),
    confirmed: true,
  };
  writeFileSync(resolve(worktree, "fix.txt"), "changed after display\n");
  assert.throws(
    () => requestProjectRunAction(input, "owner", { home, now }),
    /изменилось/,
  );
  writeFileSync(resolve(worktree, "fix.txt"), "unstaged\n");
  const request = requestProjectRunAction(input, "owner", { home, now });
  const {baseRunSelect}=await import("../src/orchestrator/runtime/run-read-model.ts");
  const {planForRequest}=await import("../src/orchestrator/runtime/request-plan.ts");
  const queued=database.prepare(`SELECT base.*,q.request_id,q.action AS requested_action
    FROM (${baseRunSelect()}) base JOIN run_control_requests q ON q.run_id=base.run_id
    WHERE q.request_id=?`).get(request.requestId) as Parameters<typeof planForRequest>[0];
  assert.equal(planForRequest(queued,{limits:{preview_expiry_warning_hours:1}}).action,
    "recover_interrupted_review_fix","the controller accepts the guarded recovery request");
  const source = database
    .prepare("SELECT * FROM run_control_project_context WHERE request_id=?")
    .get(request.requestId)!;
  assert.equal(source.expected_head_sha, head);
  assert.equal(source.expected_pull_request_url, pull.html_url);
  inspectInterruptedReviewFix(
    database,
    "r_fixture",
    project,
    request.requestId,
    effects,
  );
  const duplicate = requestRunControl(
    database,
    "r_fixture",
    "recover_interrupted_review_fix",
    "cli",
    true,
  ) as { request_id: string };
  assert.equal(
    request.requestId,
    duplicate.request_id,
    "duplicate owner request shares queue row",
  );
  assert.match(
    JSON.stringify(
      externalCommand(
        "recover_interrupted_review_fix",
        "r_fixture",
        request.requestId,
      ),
    ),
    /recover-interrupted-review-fix/,
  );
  // Changed dirty bytes between admission and claim refuse without a launch.
  let noWriterCalls = 0;
  await assert.rejects(
    recoverInterruptedReviewFix(
      database,
      loadRun(database, "r_fixture"),
      registry,
      config,
      request.requestId,
      true,
      {
        ...effects,
        noWriter: () => {
          if (++noWriterCalls === 2)
            writeFileSync(
              resolve(worktree, "fix.txt"),
              "changed during claim\n",
            );
        },
      },
    ),
    /dirty bytes|changed before claim/,
  );
  writeFileSync(resolve(worktree, "fix.txt"), "unstaged\n");
  assert.equal(
    database
      .prepare("SELECT count(*) n FROM run_interrupted_review_fix_recoveries")
      .get()!.n,
    0,
  );
  if (scenario.startsWith("dirty-rejection") || scenario === "request-rejection") {
    const predecessor = database.prepare("SELECT * FROM run_codex_tasks WHERE task_id='task'").get();
    let abortedDirty: ReturnType<typeof dirtyReviewFixSnapshot> | undefined;
    let calls = 0;
    await assert.rejects(
      recoverInterruptedReviewFix(
        database,
        loadRun(database, "r_fixture"),
        registry,
        config,
        request.requestId,
        true,
        {
          ...effects,
          noWriter: () => {
            calls++;
            if (scenario.startsWith("dirty-rejection") && calls === 3) {
              writeFileSync(
                resolve(worktree, "fix.txt"),
                "changed before dispatch\n",
              );
              abortedDirty = dirtyReviewFixSnapshot(worktree);
              if (scenario === "dirty-rejection-processing")
                database.prepare("UPDATE run_control_requests SET request_state='processing' WHERE request_id=?").run(request.requestId);
            }
            if (scenario === "request-rejection" && calls === 2)
              database
                .prepare(
                  "UPDATE run_control_requests SET request_state='failed' WHERE request_id=?",
                )
                .run(request.requestId);
          },
        },
      ),
      /changed before dispatch/,
    );
    const mapping = database.prepare("SELECT * FROM run_resources").get()!;
    assert.equal(mapping.codex_thread_id, "primary-thread");
    assert.equal(mapping.previous_codex_thread_id, null);
    assert.equal(mapping.tmux_session_name, null);
    assert.equal(existsSync(launches), false);
    assert.ok(
      database
        .prepare(
          "SELECT released_at FROM run_codex_tasks ORDER BY rowid DESC LIMIT 1",
        )
        .get()!.released_at,
    );
    assert.equal(
      database
        .prepare(
          "SELECT dispatch_started_at FROM run_interrupted_review_fix_recoveries",
        )
        .get()!.dispatch_started_at,
      null,
    );
    const failedRequest = database.prepare("SELECT * FROM run_control_requests WHERE request_id=?").get(request.requestId)!;
    assert.equal(failedRequest.request_state, "failed");
    if (scenario.startsWith("dirty-rejection")) {
      assert.ok(failedRequest.completed_at);
      assert.match(String(failedRequest.result_json), /managed_task_recovery_failed/);
    }
    assert.equal(database.prepare("SELECT round_state FROM run_review_fix_rounds").get()!.round_state, "needs_attention");
    assert.equal(database.prepare("SELECT count(*) n FROM run_control_requests WHERE request_state IN ('pending','processing')").get()!.n, 0,
      "no queued request can block later controls");
    const tasksAfterAbort = database.prepare("SELECT * FROM run_codex_tasks ORDER BY rowid").all();
    assert.equal(tasksAfterAbort.length, 2);
    assert.deepEqual(tasksAfterAbort[0], predecessor, "predecessor evidence is unchanged");
    assert.equal(tasksAfterAbort[1]!.thread_id, null);
    assert.equal(tasksAfterAbort[1]!.turn_id, null);
    assert.equal(tasksAfterAbort[1]!.failure_code, "protocol_launch_failed");
    const abortReceipt = database.prepare("SELECT * FROM run_interrupted_review_fix_recoveries").get()!;
    for (let cycle = 0; cycle < 2; cycle++) {
      const result = JSON.parse(execFileSync(process.execPath,
        [resolve(app, "src/orchestrator/runtime/controller.ts"), "--apply"],
        { env: process.env, encoding: "utf8" }));
      assert.deepEqual(result.results, [], "a repeated controller cycle cannot redispatch or reject the aborted request");
      assert.deepEqual(database.prepare("SELECT * FROM run_control_requests WHERE request_id=?").get(request.requestId), failedRequest);
      assert.deepEqual(database.prepare("SELECT * FROM run_resources").get(), mapping);
      assert.deepEqual(database.prepare("SELECT * FROM run_codex_tasks ORDER BY rowid").all(), tasksAfterAbort);
      assert.deepEqual(database.prepare("SELECT * FROM run_interrupted_review_fix_recoveries").get(), abortReceipt);
      assert.deepEqual(dirtyReviewFixSnapshot(worktree), abortedDirty ?? dirty);
      assert.equal(existsSync(launches), false);
    }
    console.log(
      `Interrupted recovery ${scenario}: own request failed, primary restored, evidence preserved across repeated controller cycles`,
    );
  } else {
    const { hasReconcilableReviewFixOperation, completeRequest } =
      await import("../src/orchestrator/runtime/controller-execution.ts");
    let duplicateAttempt: Promise<void> | undefined;
    let dispatchChecks = 0;
    await recoverInterruptedReviewFix(
      database,
      loadRun(database, "r_fixture"),
      registry,
      config,
      request.requestId,
      true,
      {
        ...effects,
        noWriter: () => {
          if (++dispatchChecks !== 3) return;
          duplicateAttempt = assert.rejects(
            recoverInterruptedReviewFix(
              database,
              loadRun(database, "r_fixture"),
              registry,
              config,
              request.requestId,
              true,
              effects,
            ),
            /already claimed/,
          );
          assert.equal(
            hasReconcilableReviewFixOperation(database, {
              action: "recover_interrupted_review_fix",
              runId: "r_fixture",
              requestId: request.requestId,
            } as Parameters<typeof hasReconcilableReviewFixOperation>[1]),
            true,
          );
          completeRequest(database, request.requestId, "failed", {
            action: "duplicate",
          });
          completeRequest(database, request.requestId, "rejected", {
            action: "stale_plan",
          });
          assert.equal(
            database
              .prepare(
                "SELECT request_state FROM run_control_requests WHERE request_id=?",
              )
              .get(request.requestId)!.request_state,
            "pending",
          );
        },
      },
    );
    await duplicateAttempt;
    assert.deepEqual(
      JSON.parse(dirtyReviewFixSnapshot(worktree).json),
      JSON.parse(dirty.json),
    );
    assert.equal(
      dirtyReviewFixSnapshot(worktree).digest,
      dirty.digest,
      "all dirty bytes remain unchanged after launch",
    );
    const receipt = database
      .prepare("SELECT * FROM run_interrupted_review_fix_recoveries")
      .get()!;
    assert.equal(receipt.dirty_digest, dirty.digest);
    assert.equal(receipt.dirty_snapshot_json, dirty.json);
    assert.ok(receipt.dispatch_started_at);
    const tasks = database
      .prepare("SELECT * FROM run_codex_tasks ORDER BY rowid")
      .all();
    assert.equal(tasks.length, 2);
    assert.equal(tasks[1]!.context_id, "rfr_feed1234");
    assert.equal(tasks[1]!.thread_id, null);
    assert.equal(tasks[0]!.thread_id, "failed-thread");
    assert.ok(tasks[0]!.released_at);
    const {inspectRuntimeBudgets}=await import("../src/orchestrator/projects/sessions/runtime-budget.ts");
    const budget={version:1,mode:"live" as const,limits:{main_writer_timeout_minutes:240,technical_worker_timeout_minutes:90}};
    const taskStart=Date.parse(String(tasks[1]!.created_at));
    assert.equal(inspectRuntimeBudgets(database,budget,taskStart+60_000).plans.length,0,
      "an old review round cannot expire the fresh recovery worker");
    assert.equal(inspectRuntimeBudgets(database,budget,taskStart+90*60_000).plans[0]?.startedAt,tasks[1]!.created_at,
      "the recovered worker still has a bounded runtime from its own start");
    const launch = readFileSync(launches, "utf8");
    assert.match(launch, /HERMES_CODEX_TASK_ID=ct_/);
    assert.match(launch, /420000/);
    assert.doesNotMatch(launch, /resume/);
    assert.equal(
      database
        .prepare("SELECT previous_codex_thread_id FROM run_resources")
        .get()!.previous_codex_thread_id,
      "primary-thread",
    );
    await assert.rejects(
      recoverInterruptedReviewFix(
        database,
        loadRun(database, "r_fixture"),
        registry,
        config,
        request.requestId,
        true,
        effects,
      ),
      /already claimed/,
    );
    assert.equal(
      readFileSync(launches, "utf8"),
      launch,
      "retry after dispatch does not launch again",
    );
    // Crash after durable claim but before dispatch: retained fence refuses retries.
    database.exec(
      "UPDATE run_interrupted_review_fix_recoveries SET dispatch_started_at=NULL",
    );
    await assert.rejects(
      recoverInterruptedReviewFix(
        database,
        loadRun(database, "r_fixture"),
        registry,
        config,
        request.requestId,
        true,
        effects,
      ),
      /already claimed/,
    );
    assert.equal(readFileSync(launches, "utf8"), launch);
    // Compose the successor's exact protocol receipt with the existing release,
    // CI, GitHub-resolution and archival paths. Only external transports are fake.
    const { recordTurnCompleted } =
      await import("../src/orchestrator/integrations/codex/task-store.ts");
    const { reconcileProtocolTasks } =
      await import("../src/orchestrator/projects/sessions/protocol-session.ts");
    const { leaveCliSession } =
      await import("../src/orchestrator/projects/sessions/session-stop.ts");
    const { reconcileReviewFixRounds } =
      await import("../src/orchestrator/runtime/reconcile-review-fix.ts");
    const successorId = String(tasks[1]!.task_id);
    function bindSuccessor() {
      database
        .prepare(
          "UPDATE run_codex_tasks SET thread_id='successor-thread',turn_id='successor-turn',phase='running' WHERE task_id=?",
        )
        .run(successorId);
      database.exec(
        "UPDATE run_resources SET codex_thread_id='successor-thread'; UPDATE run_review_fix_rounds SET codex_thread_id='successor-thread'",
      );
    }
    // A second overload stops at attention. Restarting reconciliation never launches again.
    if (scenario === "failed-successor") {
      bindSuccessor();
      assert.equal(
        recordTurnCompleted(database, successorId, {
          method: "turn/completed",
          params: {
            threadId: "successor-thread",
            turn: {
              id: "successor-turn",
              status: "failed",
              error: { codexErrorInfo: "serverOverloaded" },
            },
          },
        }),
        true,
      );
      database
        .prepare(
          "UPDATE run_codex_tasks SET stopped_at='2026-01-02' WHERE task_id=?",
        )
        .run(successorId);
      rmSync(alive);
      await reconcileProtocolTasks(database);
      const restarted = new DatabaseSync(
        resolve(home, "state/orchestrator.db"),
      );
      try {
        await reconcileProtocolTasks(restarted);
      } finally {
        restarted.close();
      }
      assert.equal(
        database.prepare("SELECT state FROM runs").get()!.state,
        "needs_attention",
      );
      assert.equal(
        database.prepare("SELECT round_state FROM run_review_fix_rounds").get()!
          .round_state,
        "needs_attention",
      );
      assert.ok(
        !(
          availableRunControls(database, "r_fixture", { home })
            .available_actions as string[]
        ).includes("recover_interrupted_review_fix"),
      );
      assert.equal(
        readFileSync(launches, "utf8"),
        launch,
        "failed successor cannot trigger another launch",
      );
      console.log(
        "Failed successor: repeated restart reconciliation preserves attention and never launches again",
      );
    } else {
      bindSuccessor();
      assert.equal(
        recordTurnCompleted(database, successorId, {
          method: "turn/completed",
          params: {
            threadId: "successor-thread",
            turn: { id: "successor-turn", status: "completed" },
          },
        }),
        true,
      );
      database
        .prepare(
          "UPDATE run_codex_tasks SET stopped_at='2026-01-02' WHERE task_id=?",
        )
        .run(successorId);
      rmSync(alive);
      git(worktree, "add", "--all");
      git(worktree, "commit", "-m", "Complete original review scope");
      const resultHead = git(worktree, "rev-parse", "HEAD");
      await leaveCliSession(
        database,
        loadRun(database, "r_fixture"),
        registry,
        true,
        "none",
      );
      reconcileReviewFixRounds(database);
      assert.equal(
        database.prepare("SELECT round_state FROM run_review_fix_rounds").get()!
          .round_state,
        "waiting_ci",
      );
      reconcileReviewFixRounds(database);
      assert.equal(
        database.prepare("SELECT round_state FROM run_review_fix_rounds").get()!
          .round_state,
        "waiting_ci",
        "old passed source CI is not delivery",
      );
      database
        .prepare(
          "UPDATE run_ci_snapshots SET head_sha=?,aggregate_state='pending',completed_at=NULL",
        )
        .run(resultHead);
      reconcileReviewFixRounds(database);
      assert.equal(
        database.prepare("SELECT round_state FROM run_review_fix_rounds").get()!
          .round_state,
        "waiting_ci",
        "new pending CI cannot resolve threads",
      );
      database.exec(
        "UPDATE run_ci_snapshots SET aggregate_state='passed',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      );
      reconcileReviewFixRounds(database);
      assert.equal(
        database
          .prepare("SELECT result_head_sha FROM run_review_fix_rounds")
          .get()!.result_head_sha,
        resultHead,
      );
      assert.equal(
        database.prepare("SELECT round_state FROM run_review_fix_rounds").get()!
          .round_state,
        "resolving",
      );

      mkdirSync(resolve(home, "secrets"));
      const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      const keyFile = resolve(home, "secrets/fixture.pem");
      writeFileSync(keyFile, privateKey, { mode: 0o600 });
      writeFileSync(
        resolve(home, "secrets/github-reviewer-app.env"),
        `KURAMI_GITHUB_REVIEWER_APP_ID=1\nKURAMI_GITHUB_REVIEWER_INSTALLATION_ID=2\nKURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE=${keyFile}\n`,
        { mode: 0o600 },
      );
      writeFileSync(
        resolve(home, "secrets/github.env"),
        "GH_TOKEN=fixture_owner_token_not_a_real_credential\n",
        { mode: 0o600 },
      );
      const savedFetch = globalThis.fetch,
        savedArgv = process.argv;
      const resolvedThreads: string[] = [],
        replyBodies: string[] = [];
      globalThis.fetch = async (input, init) => {
        const url = String(input),
          payload = JSON.parse(String(init?.body ?? "{}"));
        let response: unknown;
        if (url === "https://api.github.com/app/installations/2/access_tokens")
          response = {
            token: "fixture-app-token",
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          };
        else if (url === "https://api.github.com/graphql") {
          assert.equal(
            payload.variables.threadId,
            "original-thread",
            "only original threads may be queried/resolved",
          );
          if (payload.query.startsWith("query"))
            response = {
              data: { node: { isResolved: false, comments: { nodes: [] } } },
            };
          else {
            resolvedThreads.push(payload.variables.threadId);
            response = {
              data: {
                resolveReviewThread: {
                  thread: { id: "original-thread", isResolved: true },
                },
              },
            };
          }
        } else if (
          url ===
          "https://api.github.com/repos/example/project/pulls/2/comments/1/replies"
        ) {
          replyBodies.push(payload.body);
          response = { id: 123 };
        } else throw Error(`Unexpected fixture network request: ${url}`);
        return new Response(JSON.stringify(response), { status: 200 });
      };
      try {
        const { runReviewFixManagerCli } =
          await import("../src/orchestrator/projects/reviews/fix-manager.ts");
        process.argv = [
          process.execPath,
          "fix-manager.ts",
          "resolve",
          "--round-id",
          "rfr_feed1234",
          "--apply",
        ];
        await runReviewFixManagerCli();
        assert.deepEqual(resolvedThreads, ["original-thread"]);
        assert.ok(replyBodies[0]!.includes(resultHead.slice(0, 12)));
        assert.equal(
          database
            .prepare("SELECT thread_state FROM run_review_fix_threads")
            .get()!.thread_state,
          "resolved",
        );
        assert.equal(
          database
            .prepare("SELECT round_state FROM run_review_fix_rounds")
            .get()!.round_state,
          "succeeded",
        );
        const archiveLog = resolve(home, "archive.log");
        writeFileSync(
          resolve(bin, "codex"),
          `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nimport {createInterface} from 'node:readline';\nfor await (const line of createInterface({input:process.stdin})) {const m=JSON.parse(line);if(m.method==='thread/archive') appendFileSync(${JSON.stringify(archiveLog)},m.params.threadId+'\\n');if(m.id!==undefined)console.log(JSON.stringify({id:m.id,result:{}}));}\n`,
          { mode: 0o700 },
        );
        const { runSessionManagerCli } =
          await import("../src/orchestrator/projects/sessions/manager.ts");
        process.argv = [
          process.execPath,
          "manager.ts",
          "cleanup-review-fix",
          "--run-id",
          "r_fixture",
          "--apply",
        ];
        await runSessionManagerCli();
        assert.equal(readFileSync(archiveLog, "utf8"), "successor-thread\n");
        const mapping = database
          .prepare(
            "SELECT codex_thread_id,previous_codex_thread_id FROM run_resources",
          )
          .get()!;
        assert.equal(mapping.codex_thread_id, "primary-thread");
        assert.equal(mapping.previous_codex_thread_id, null);
        assert.equal(
          database
            .prepare("SELECT snapshot_json FROM run_review_fix_rounds")
            .get()!.snapshot_json,
          JSON.stringify([thread]),
        );
        assert.deepEqual(
          database
            .prepare("SELECT * FROM run_codex_tasks WHERE task_id='task'")
            .get(),
          tasks[0],
          "original failed receipt is immutable",
        );
        assert.equal(readFileSync(launches, "utf8"), launch);
      } finally {
        globalThis.fetch = savedFetch;
        process.argv = savedArgv;
      }
    }
  }
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  console.log(
    `Interrupted review fix recovery ${scenario}: all scenario assertions passed`,
  );
} finally {
  database.close();
  rmSync(home, { recursive: true, force: true });
}
