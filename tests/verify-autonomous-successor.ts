import { execFileSync, spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promptFor } from "../src/orchestrator/projects/sessions/autonomous-successor.ts";
import { conversationRecords, lateChoices, writeConversation, verifyPredecessorConversation } from "./predecessor-conversation-fixture.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function git(directory: string, args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runFails(command: string, args: string[], env: NodeJS.ProcessEnv): string {
  try {
    execFileSync(command, args, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return (error as { stderr?: string }).stderr ?? String(error);
  }
  throw new Error("Expected command to fail");
}

async function main(): Promise<void> {
  const successorPrompt = promptFor({ issue: "untrusted" });
  assert(
    successorPrompt.includes("Do not ask for or wait for a separate interactive commit confirmation"),
    "Autonomous successor prompt lacks explicit commit authorization",
  );
  const app = resolve(import.meta.dirname, "..");
  const home = await realpath(
    await mkdtemp(resolve(tmpdir(), "kurami-autonomous-successor-")),
  );
  const fakeBin = resolve(home, "fake-bin");
  const paneProcess = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const fakeTmuxState = resolve(home, "tmux-alive");
  const fakeTmuxFailState = resolve(home, "tmux-fail-next-start");
  const fakeTmuxLog = resolve(home, "tmux-calls.log");
  const worktreeRoot = resolve(home, "worktrees/tailortales");
  const worktree = resolve(worktreeRoot, "124/TailorTales");
  const ambiguousWorktree = resolve(worktreeRoot, "125/TailorTales");
  const recoveryWorktree = resolve(worktreeRoot, "126/TailorTales");
  const fenceWorktree = resolve(worktreeRoot, "127/TailorTales");
  const canonical = resolve(home, "repositories/TailorTales");
  const successorPath = resolve(app, "src/orchestrator/projects/sessions/autonomous-successor.ts");
  const controlsPath = resolve(app, "src/orchestrator/controls/run.ts");
  const controllerPath = resolve(app, "src/orchestrator/runtime/controller.ts");
  const injectedCredential = `github_pat_${"Y".repeat(32)}`;

  try {
    await mkdir(resolve(home, "config"), { recursive: true, mode: 0o700 });
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await mkdir(worktree, { recursive: true, mode: 0o700 });
    await mkdir(ambiguousWorktree, { recursive: true, mode: 0o700 });
    await mkdir(recoveryWorktree, { recursive: true, mode: 0o700 });
    await mkdir(fenceWorktree, { recursive: true, mode: 0o700 });
    await mkdir(canonical, { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(app, "deploy/config/orchestrator.yaml"),
      resolve(home, "config/orchestrator.yaml"),
    );
    let projects = await readFile(
      resolve(app, "deploy/config/projects.yaml"),
      "utf8",
    );
    projects = projects
      .replace("/home/shagon1k/_projects/TailorTales", canonical)
      .replace(
        "/home/shagon1k/_projects/.worktrees/tailortales",
        worktreeRoot,
      );
    await writeFile(resolve(home, "config/projects.yaml"), projects, {
      mode: 0o600,
    });

    for (const directory of [worktree, ambiguousWorktree, fenceWorktree]) {
      git(directory, ["init", "-b", "TT-124_successor"]);
      git(directory, ["config", "user.email", "successor-test@example.invalid"]);
      git(directory, ["config", "user.name", "Successor Test"]);
      await writeFile(resolve(directory, "README.md"), "base\n");
      git(directory, ["add", "README.md"]);
      git(directory, ["commit", "-m", "fixture"]);
    }
    git(fenceWorktree, ["branch", "-m", "TT-127_fence"]);
    git(recoveryWorktree, ["init", "-b", "TT-126_recovery"]);
    git(recoveryWorktree, ["config", "user.email", "successor-test@example.invalid"]);
    git(recoveryWorktree, ["config", "user.name", "Successor Test"]);
    await writeFile(resolve(recoveryWorktree, "README.md"), "base\n");
    git(recoveryWorktree, ["add", "README.md"]);
    git(recoveryWorktree, ["commit", "-m", "fixture"]);
    await writeFile(
      resolve(worktree, "README.md"),
      `base\nowner edit\nGH_TOKEN=${injectedCredential}\n`,
    );
    await writeFile(resolve(worktree, "notes.txt"), "staged owner note\n");
    git(worktree, ["add", "notes.txt"]);

    const fakeTmux = resolve(fakeBin, "tmux");
    await writeFile(
      fakeTmux,
      `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_TMUX_LOG"
case "$1" in
  list-sessions)
    if test -n "\${FAKE_TMUX_APPEND_SOURCE:-}"; then
      printf '%s\n' '{"type":"event_msg","payload":{"type":"token_count"}}' >> "$FAKE_TMUX_APPEND_SOURCE"
    fi
    test -f "$FAKE_TMUX_STATE" || exit 1
    printf '%s\n' 'cx-tt-124-test-a1'
    ;;
  has-session)
    test -f "$FAKE_TMUX_STATE"
    ;;
  list-panes)
    printf '%s\n' "$FAKE_PANE_PID"
    ;;
  capture-pane)
    printf '%s\n' 'No further work is needed.' \
      '─ Worked for 1m 00s ─' \
      '› Ask Codex to do anything'
    ;;
  send-keys)
    case "$*" in
      *C-d*) /bin/rm -f "$FAKE_TMUX_STATE" ;;
    esac
    ;;
  new-session)
    if test -f "$FAKE_TMUX_FAIL_STATE"; then
      /bin/rm -f "$FAKE_TMUX_FAIL_STATE"
      exit 1
    fi
    : > "$FAKE_TMUX_STATE"
    ;;
  kill-session)
    /bin/rm -f "$FAKE_TMUX_STATE"
    ;;
  *)
    exit 64
    ;;
esac
`,
      { mode: 0o700 },
    );
    await chmod(fakeTmux, 0o700);

    verifyPredecessorConversation(home, worktree);
    const codexHome = resolve(home, "codex");
    await mkdir(resolve(codexHome, "sessions"), { recursive: true });
    const native = new DatabaseSync(resolve(codexHome, "state_5.sqlite"));
    native.exec("CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT, cwd TEXT, source TEXT)");
    for (const [suffix, cwd] of [["successor",worktree],["recovery",recoveryWorktree],["fence",fenceWorktree]]) {
      const id = `thread-${suffix}-predecessor`;
      const path = resolve(codexHome,"sessions",`${suffix}.jsonl`);
      writeConversation(path,conversationRecords(id,cwd!));
      native.prepare("INSERT INTO threads VALUES(?,?,?,'cli')").run(id,path,cwd!);
    }
    native.close();
    const env = {
      ...process.env,
      KURAMI_HOME: home,
      FAKE_PANE_PID: String(paneProcess.pid),
      ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations"),
      CODEX_BIN: process.execPath,
      CODEX_HOME: codexHome,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_TMUX_STATE: fakeTmuxState,
      FAKE_TMUX_FAIL_STATE: fakeTmuxFailState,
      FAKE_TMUX_LOG: fakeTmuxLog,
    };
    execFileSync(process.execPath, [resolve(app, "src/orchestrator/state/init-run-store.ts")], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const databasePath = resolve(home, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    const insertFixture = (
      suffix: string,
      issue: number,
      fixtureWorktree: string,
      branchName: string,
      requestId?: string,
      interactionPolicy: "autonomous" | "human_control" = "autonomous",
    ): void => {
      database
        .prepare(
          `INSERT INTO project_events (
             event_id, observed_at, project, item_id, content_id, content_type,
             repository, issue_number, title, url, from_status, to_status,
             payload_json, processing_state
           ) VALUES (?, '2026-08-21T00:00:00.000Z', 'tailortales', ?, ?, 'Issue',
             'Shagon1k/TailorTales', ?, ?, ?, 'In progress', 'Human Review',
             '{"issueState":"OPEN","labels":[],"hasDescription":true}', 'processed')`,
        )
        .run(
          `event-${suffix}`,
          `item-${suffix}`,
          `content-${suffix}`,
          issue,
          `[Test]: Successor ${issue}`,
          `https://example.invalid/issues/${issue}`,
        );
      database
        .prepare(
          `INSERT INTO project_items (
             project, item_id, content_id, content_type, repository,
             issue_number, title, url, status, first_seen_at, last_seen_at
           ) VALUES ('tailortales', ?, ?, 'Issue', 'Shagon1k/TailorTales',
             ?, ?, ?, 'Human Review', '2026-08-21T00:00:00.000Z',
             '2026-08-21T00:00:00.000Z')`,
        )
        .run(
          `item-${suffix}`,
          `content-${suffix}`,
          issue,
          `[Test]: Successor ${issue}`,
          `https://example.invalid/issues/${issue}`,
        );
      database
        .prepare(
          `INSERT INTO runs (
             run_id, trigger_event_id, project, item_id, content_id, repository,
             issue_number, interaction_policy, state, owner_state, execution_mode
           ) VALUES (?, ?, 'tailortales', ?, ?, 'Shagon1k/TailorTales', ?,
             ?, 'remote_owned', 'remote', 'live')`,
        )
        .run(
          `r_${suffix}`,
          `event-${suffix}`,
          `item-${suffix}`,
          `content-${suffix}`,
          issue,
          interactionPolicy,
        );
      database
        .prepare(
          `INSERT INTO run_resources (
             run_id, resource_state, worktree_path, branch_name, base_sha,
             codex_thread_id, previous_codex_thread_id, tmux_session_name
           ) VALUES (?, 'provisioned', ?, ?, ?, ?, NULL, NULL)`,
        )
        .run(
          `r_${suffix}`,
          fixtureWorktree,
          branchName,
          git(fixtureWorktree, ["rev-parse", "HEAD"]),
          `thread-${suffix}-predecessor`,
        );
      if (requestId) {
        database
          .prepare(
            `INSERT INTO run_control_requests (
               request_id, run_id, action, requested_via, idempotency_key,
               request_state
             ) VALUES (?, ?, 'take_control', 'discord', ?, 'pending')`,
          )
          .run(requestId, `r_${suffix}`, `successor:${suffix}`);
      }
    };
    insertFixture(
      "successor",
      124,
      worktree,
      "TT-124_successor",
      undefined,
      "human_control",
    );
    insertFixture("ambiguous", 125, ambiguousWorktree, "TT-125_wrong");
    insertFixture("recovery", 126, recoveryWorktree, "TT-126_recovery");
    // Admission failures cannot claim ownership, consume requests, create workers or rewrite work.
    const sourcePath = resolve(codexHome,"sessions/successor.jsonl");
    const completeSource = await readFile(sourcePath,"utf8");
    const snapshot = () => JSON.stringify([
      database.prepare("SELECT * FROM runs").all(),
      database.prepare("SELECT * FROM run_resources").all(),
      database.prepare("SELECT * FROM run_state_history").all(),
      database.prepare("SELECT * FROM run_control_requests").all(),
      database.prepare("SELECT * FROM run_autonomous_successions").all(),
    ]);
    for (const bad of ["", "not-json\n", completeSource.replace("thread-successor-predecessor","unrelated-thread"), completeSource.slice(0,-2), completeSource.replace(lateChoices,"x".repeat(70*1024))]) {
      await writeFile(sourcePath,bad);
      const before=snapshot();
      const error=runFails(process.execPath,[successorPath,"start","--run-id","r_successor","--request-id","not-claimed","--apply"],env);
      assert(error.includes("Predecessor conversation unavailable"),"Missing/malformed/unrelated/oversized conversation was not refused");
      assert(snapshot()===before,"Conversation refusal changed orchestration state");
    }
    await rm(sourcePath);
    assert(runFails(process.execPath,[successorPath,"start","--run-id","r_successor","--request-id","not-claimed","--apply"],env).includes("Predecessor conversation unavailable"),"Missing rollout admitted");
    await writeFile(sourcePath,completeSource);
    assert(!(await readFile(fakeTmuxLog,"utf8").catch(()=>"")).includes("new-session"),"Conversation failure dispatched a worker");
    // Change the source after the DB claim, during prompt I/O: no new-session may run.
    insertFixture("fence",127,fenceWorktree,"TT-127_fence","rq_fence");
    database.close();
    const importHook=resolve(home,"change-source-after-claim.mjs");
    await writeFile(importHook,`import fsp from "node:fs/promises";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const original=fsp.writeFile;
fsp.writeFile=async function(path,...args){
  const result=await original.call(this,path,...args);
  if(String(path).includes("r_fence-") && String(path).endsWith(".b64")) fs.appendFileSync(${JSON.stringify(resolve(codexHome,"sessions/fence.jsonl"))},${JSON.stringify('{"type":"event_msg","payload":{"type":"token_count"}}\n')});
  return result;
};
syncBuiltinESMExports();`);
    const fenceController=execFileSync(process.execPath,[controllerPath,"--apply"],{encoding:"utf8",env:{...env,NODE_OPTIONS:`--import=${importHook}`},stdio:["ignore","pipe","pipe"]});
    assert(fenceController.includes("source changed after capture"),"Post-claim transcript change was not refused");
    const afterFence=new DatabaseSync(databasePath,{readOnly:true});
    const fenced=afterFence.prepare("SELECT r.state,rr.codex_thread_id,rr.tmux_session_name,s.succession_state FROM runs r JOIN run_resources rr USING(run_id) JOIN run_autonomous_successions s USING(run_id) WHERE r.run_id='r_fence'").get()!;
    assert(fenced.state==="needs_attention" && fenced.codex_thread_id==="thread-fence-predecessor" && fenced.tmux_session_name===null && fenced.succession_state==="failed","Post-claim refusal did not preserve predecessor and existing failure recovery");
    afterFence.close();
    assert(!(await readFile(fakeTmuxLog,"utf8")).includes("new-session"),"Post-claim transcript change dispatched a worker");

    const queuedOutput = execFileSync(
      process.execPath,
      [
        controlsPath,
        "request",
        "--run-id",
        "r_successor",
        "--action",
        "take_control",
        "--via",
        "discord",
        "--apply",
      ],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const queued = JSON.parse(queuedOutput) as {
      action: string;
      intent: string;
      requestId: string;
    };
    assert(
      queued.action === "created" &&
        queued.intent === "autonomous_successor" &&
        Boolean(queued.requestId),
      "Remote continuation control did not record explicit successor intent",
    );
    const claimState=new DatabaseSync(databasePath,{readOnly:true});
    const beforeClaim=JSON.stringify([claimState.prepare("SELECT * FROM runs WHERE run_id='r_successor'").get(),claimState.prepare("SELECT * FROM run_control_requests WHERE request_id=?").get(queued.requestId)]);
    const changedClaim=runFails(process.execPath,[successorPath,"start","--run-id","r_successor","--request-id",queued.requestId,"--apply"],{...env,FAKE_TMUX_APPEND_SOURCE:sourcePath});
    assert(changedClaim.includes("source changed after capture"),"Capture-to-claim change was not rejected");
    assert(beforeClaim===JSON.stringify([claimState.prepare("SELECT * FROM runs WHERE run_id='r_successor'").get(),claimState.prepare("SELECT * FROM run_control_requests WHERE request_id=?").get(queued.requestId)]),"Capture-to-claim refusal consumed request or ownership");
    assert(claimState.prepare("SELECT 1 FROM run_autonomous_successions WHERE run_id='r_successor'").get()===undefined,"Capture-to-claim refusal admitted a succession");
    claimState.close();
    await writeFile(sourcePath,completeSource);
    const controllerOutput = execFileSync(
      process.execPath,
      [controllerPath, "--apply"],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const controller = JSON.parse(controllerOutput) as {
      results: Array<{ action: string; status: string; result?: unknown }>;
    };
    const successorEntry = controller.results.find(
      (entry) =>
        entry.action === "successor_start" &&
        (entry as { runId?: string }).runId === "r_successor",
    );
    assert(
      successorEntry,
      `Controller did not plan an autonomous successor: ${controllerOutput}`,
    );
    assert(
      successorEntry.status === "applied" && successorEntry.result,
      `Controller did not apply the autonomous successor: ${controllerOutput}`,
    );
    const result = successorEntry.result as {
      ok: boolean;
      action: string;
      predecessorThreadId: string;
    };
    assert(
      result.ok &&
        result.action === "autonomous_successor_started" &&
        result.predecessorThreadId === "thread-successor-predecessor",
      "Fresh autonomous successor did not start",
    );

    const verify = new DatabaseSync(databasePath, { readOnly: true });
    const row = verify
      .prepare(
        `SELECT r.state, r.owner_state, r.interaction_policy,
                rr.tmux_session_name,
                rr.codex_thread_id, s.succession_state,
                s.predecessor_thread_id, s.handoff_context_json,
                q.request_state
         FROM runs r JOIN run_resources rr USING (run_id)
         JOIN run_autonomous_successions s USING (run_id)
         JOIN run_control_requests q ON q.request_id=s.request_id
         WHERE r.run_id='r_successor'`,
      )
      .get() as {
      state: string;
      owner_state: string;
      interaction_policy: string;
      tmux_session_name: string;
      codex_thread_id: string | null;
      succession_state: string;
      predecessor_thread_id: string;
      handoff_context_json: string;
      request_state: string;
    };
    const context = JSON.parse(row.handoff_context_json) as {
      previous_thread_id: string;
      git: { status: string; unstagedDiff: string; stagedDiff: string };
      explicitOwnerConfirmation: string;
      predecessorConversation: { conversations: {threadId:string; messages: {role:string; text:string}[]}[] };
      instructions: string[];
    };
    verify.close();
    assert(context.predecessorConversation.conversations[0]?.messages[2]?.text === lateChoices, "Late owner choices absent from dispatched handoff");
    const encodedPrompt=await readFile(resolve(home,"state/session-prompts",`r_successor-${queued.requestId}.b64`),"utf8");
    assert(Buffer.from(encodedPrompt,"base64").toString("utf8").includes(lateChoices),"Actual launch prompt omitted late owner choices");
    assert(
      row.state === "running" &&
        row.owner_state === "cli" &&
        row.interaction_policy === "human_control" &&
        row.tmux_session_name.endsWith("-a1") &&
        row.codex_thread_id === null &&
        row.succession_state === "running" &&
        row.request_state === "applied" &&
        row.predecessor_thread_id === "thread-successor-predecessor",
      "Successor claim did not establish one managed writer",
    );

    const synchronized = new DatabaseSync(databasePath);
    synchronized
      .prepare(
        `UPDATE run_resources
         SET codex_thread_id='thread-successor-managed'
         WHERE run_id='r_successor'`,
      )
      .run();
    synchronized.close();
    const postSyncOutput = execFileSync(process.execPath, [controllerPath], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const postSync = JSON.parse(postSyncOutput) as {
      plans: Array<{ runId: string; action: string }>;
    };
    assert(
      !postSync.plans.some(
        (plan) =>
          plan.runId === "r_successor" && plan.action === "handoff",
      ),
      "Explicitly approved human-control successor was handed back immediately",
    );
    assert(
      postSync.plans.some(
        (plan) => plan.runId === "r_successor" && plan.action === "park",
      ),
      "Idle successor on an existing Human Review item was not scheduled to park",
    );
    const parkedOutput = execFileSync(
      process.execPath,
      [controllerPath, "--apply"],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const parkedController = JSON.parse(parkedOutput) as {
      results: Array<{ runId: string; action: string; status: string }>;
    };
    assert(
      parkedController.results.some(
        (entry) =>
          entry.runId === "r_successor" &&
          entry.action === "park" &&
          entry.status === "applied",
      ),
      `Controller did not park the completed successor: ${parkedOutput}`,
    );
    const parkedDatabase = new DatabaseSync(databasePath, { readOnly: true });
    const parkedRun = parkedDatabase
      .prepare(
        `SELECT r.state, r.owner_state, rr.tmux_session_name,
                s.succession_state
         FROM runs r JOIN run_resources rr USING (run_id)
         JOIN run_autonomous_successions s USING (run_id)
         WHERE r.run_id='r_successor'`,
      )
      .get() as {
      state: string;
      owner_state: string;
      tmux_session_name: string | null;
      succession_state: string;
    };
    parkedDatabase.close();
    assert(
      parkedRun.state === "parked_review" &&
        parkedRun.owner_state === "none" &&
        parkedRun.tmux_session_name === null &&
        parkedRun.succession_state === "parked",
      "Completed no-op successor did not release its managed writer",
    );
    assert(
      context.previous_thread_id === "thread-successor-predecessor" &&
        context.git.status.includes("README.md") &&
        context.git.unstagedDiff.includes("owner edit") &&
        context.git.unstagedDiff.includes("[REDACTED_CREDENTIAL]") &&
        !JSON.stringify(context).includes(injectedCredential) &&
        context.git.stagedDiff.includes("staged owner note") &&
        context.explicitOwnerConfirmation.includes("will not be continued") &&
        context.instructions.some(
          (value) =>
            value.includes("do not invent changes") &&
            value.includes("finish the turn immediately"),
        ),
      "Bounded handoff omitted predecessor or dirty-worktree evidence",
    );
    assert(
      (await readFile(resolve(worktree, "README.md"), "utf8")).includes(
        "owner edit",
      ) &&
        (await readFile(resolve(worktree, "notes.txt"), "utf8")) ===
          "staged owner note\n",
      "Successor startup changed owner work",
    );

    await writeFile(fakeTmuxFailState, "fail\n", { mode: 0o600 });
    const failedStartRequest = JSON.parse(
      execFileSync(
        process.execPath,
        [
          controlsPath,
          "request",
          "--run-id",
          "r_recovery",
          "--action",
          "take_control",
          "--via",
          "discord",
          "--apply",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      ),
    ) as { requestId: string; intent: string };
    assert(
      failedStartRequest.intent === "autonomous_successor",
      "Initial autonomous continuation did not retain successor intent",
    );
    const failedControllerOutput = execFileSync(
      process.execPath,
      [controllerPath, "--apply"],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const failedController = JSON.parse(failedControllerOutput) as {
      results: Array<{ runId: string; action: string; status: string }>;
    };
    assert(
      failedController.results.some(
        (entry) =>
          entry.runId === "r_recovery" &&
          entry.action === "successor_start" &&
          entry.status === "deferred",
      ),
      "Synthetic autonomous successor failure was not surfaced",
    );
    const failedState = new DatabaseSync(databasePath, { readOnly: true });
    const failedRecovery = failedState
      .prepare(
        `SELECT r.state, r.owner_state, rr.tmux_session_name,
                rr.codex_thread_id, s.succession_state,
                q.request_state,
                (SELECT reason FROM run_state_history h
                 WHERE h.run_id=r.run_id AND h.to_state='needs_attention'
                 ORDER BY h.sequence DESC LIMIT 1) AS attention_reason
         FROM runs r JOIN run_resources rr USING (run_id)
         JOIN run_autonomous_successions s USING (run_id)
         JOIN run_control_requests q ON q.request_id=s.request_id
         WHERE r.run_id='r_recovery'`,
      )
      .get() as {
      state: string;
      owner_state: string;
      tmux_session_name: string | null;
      codex_thread_id: string | null;
      succession_state: string;
      request_state: string;
      attention_reason: string | null;
    };
    failedState.close();
    assert(
      failedRecovery.state === "needs_attention" &&
        failedRecovery.owner_state === "none" &&
        failedRecovery.tmux_session_name === null &&
        failedRecovery.codex_thread_id === "thread-recovery-predecessor" &&
        failedRecovery.succession_state === "failed" &&
        failedRecovery.request_state === "failed" &&
        failedRecovery.attention_reason ===
          "autonomous_successor_start_failed",
      "Failed successor did not restore and classify the safe recovery boundary",
    );

    const retryRequest = JSON.parse(
      execFileSync(
        process.execPath,
        [
          controlsPath,
          "request",
          "--run-id",
          "r_recovery",
          "--action",
          "take_control",
          "--via",
          "discord",
          "--apply",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      ),
    ) as { requestId: string; intent: string };
    assert(
      retryRequest.intent === "autonomous_successor" &&
        retryRequest.requestId !== failedStartRequest.requestId,
      "Guarded recovery did not create a fresh successor request",
    );
    const retryPlan = JSON.parse(
      execFileSync(process.execPath, [controllerPath], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as { plans: Array<{ runId: string; action: string }> };
    assert(
      retryPlan.plans.some(
        (plan) =>
          plan.runId === "r_recovery" && plan.action === "successor_start",
      ),
      "Controller did not recognize the exact failed-successor recovery state",
    );
    execFileSync(process.execPath, [controllerPath, "--apply"], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const retriedState = new DatabaseSync(databasePath, { readOnly: true });
    const retriedRecovery = retriedState
      .prepare(
        `SELECT r.state, r.owner_state, rr.tmux_session_name,
                COUNT(*) AS succession_count,
                SUM(CASE WHEN s.succession_state='running' THEN 1 ELSE 0 END)
                  AS running_count
         FROM runs r JOIN run_resources rr USING (run_id)
         JOIN run_autonomous_successions s USING (run_id)
         WHERE r.run_id='r_recovery'`,
      )
      .get() as {
      state: string;
      owner_state: string;
      tmux_session_name: string | null;
      succession_count: number;
      running_count: number;
    };
    retriedState.close();
    assert(
      retriedRecovery.state === "running" &&
        retriedRecovery.owner_state === "cli" &&
        Boolean(retriedRecovery.tmux_session_name) &&
        retriedRecovery.succession_count === 2 &&
        retriedRecovery.running_count === 1,
      "Guarded retry did not establish exactly one managed writer",
    );

    const repeated = runFails(
      process.execPath,
      [
        successorPath,
        "start",
        "--run-id",
        "r_successor",
        "--request-id",
        "rq_successor",
        "--apply",
      ],
      env,
    );
    assert(
      repeated.includes("safe Remote or successor-recovery boundary"),
      "Repeated successor start did not fail closed",
    );

    const ambiguousRequest = new DatabaseSync(databasePath);
    ambiguousRequest
      .prepare(
        `INSERT INTO run_control_requests (
           request_id, run_id, action, requested_via, idempotency_key,
           request_state
         ) VALUES ('rq_ambiguous', 'r_ambiguous', 'take_control', 'discord',
                   'successor:ambiguous', 'pending')`,
      )
      .run();
    ambiguousRequest.close();

    const ambiguous = runFails(
      process.execPath,
      [
        successorPath,
        "start",
        "--run-id",
        "r_ambiguous",
        "--request-id",
        "rq_ambiguous",
        "--apply",
      ],
      env,
    );
    assert(
      ambiguous.includes("Branch mismatch"),
      "Ambiguous worktree/branch mapping was not rejected",
    );
    const final = new DatabaseSync(databasePath, { readOnly: true });
    const ambiguousState = final
      .prepare(
        `SELECT state, owner_state FROM runs WHERE run_id='r_ambiguous'`,
      )
      .get() as { state: string; owner_state: string };
    const successorCount = final
      .prepare(
        `SELECT COUNT(*) AS count FROM run_autonomous_successions
         WHERE run_id='r_successor'`,
      )
      .get() as { count: number };
    final.close();
    assert(
      ambiguousState.state === "needs_attention" &&
        ambiguousState.owner_state === "none",
      "Ambiguous successor boundary did not surface needs_attention",
    );
    assert(successorCount.count === 1, "Repeated request created a second writer");

    const tmuxCalls = await readFile(fakeTmuxLog, "utf8");
    assert(!tmuxCalls.includes("HERMES_CODEX_TASK_ID="), "Successor must retain TUI execution");
    assert(
      tmuxCalls.includes("HERMES_INITIAL_PROMPT_FILE=") &&
        tmuxCalls.includes(`HERMES_WORKTREE_PATH=${worktree}`),
      "Managed successor launcher missed the exact worktree handoff",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        freshManagedTask: true,
        predecessorFrozen: true,
        explicitOwnerBoundary: true,
        humanControlOneShotOverride: true,
        exactWorktreeAndBranch: true,
        dirtyDiffPreserved: true,
        boundedHandoff: true,
        noOpSuccessorParks: true,
        singleWriter: true,
        failedStartRecoverable: true,
        guardedRetry: true,
        repeatedRequestFailClosed: true,
        ambiguityNeedsAttention: true,
      })}\n`,
    );
  } finally {
    paneProcess.kill("SIGTERM");
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
