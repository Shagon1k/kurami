import { execFileSync, spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { availableRunControls, runControlStatus } from "../src/orchestrator/controls/run.ts";
import { capturePrimaryStoppedResult, primaryStoppedDiagnostic, primaryStoppedSummary } from "../src/orchestrator/integrations/codex/primary-diagnostic.ts";
import { threadControlPayload, controlComponents } from "../src/orchestrator/controls/discord.ts";
import { inspectAiReview } from "../src/orchestrator/controls/ai-review.ts";

process.umask(0o077);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runController(
  controllerPath: string,
  env: NodeJS.ProcessEnv,
  apply = false,
): { plans?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>> } {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [controllerPath, ...(apply ? ["--apply"] : [])],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    ),
  ) as {
    plans?: Array<Record<string, unknown>>;
    results?: Array<Record<string, unknown>>;
  };
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-autonomous-completion-"));
  const fakeBin = resolve(home, "fake-bin");
  const paneProcess = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const completeAlive = resolve(home, "complete-alive");
  const activeAlive = resolve(home, "active-alive");
  const approvalAlive = resolve(home, "approval-alive");
  const stuckAlive = resolve(home, "stuck-alive");
  const ghCalls = resolve(home, "gh-calls.log");
  const tmuxCalls = resolve(home, "tmux-calls.log");
  try {
    await mkdir(resolve(home, "config"), { recursive: true, mode: 0o700 });
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(app, "deploy/config/orchestrator.yaml"),
      resolve(home, "config/orchestrator.yaml"),
    );
    await copyFile(
      resolve(app, "deploy/config/projects.yaml"),
      resolve(home, "config/projects.yaml"),
    );
    await writeFile(completeAlive, "alive\n", { mode: 0o600 });
    await writeFile(activeAlive, "alive\n", { mode: 0o600 });
    await writeFile(approvalAlive, "alive\n", { mode: 0o600 });
    await writeFile(stuckAlive, "alive\n", { mode: 0o600 });
    await writeFile(ghCalls, "", { mode: 0o600 });
    await writeFile(tmuxCalls, "", { mode: 0o600 });

    const fakeTmux = resolve(fakeBin, "tmux");
    await writeFile(
      fakeTmux,
      `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_TMUX_CALLS"
case "$1" in
  has-session)
    case "$*" in
      *cx-tt-201-complete*) test -f "$FAKE_COMPLETE_ALIVE" ;;
      *cx-tt-202-active*) test -f "$FAKE_ACTIVE_ALIVE" ;;
      *cx-tt-203-approval*) test -f "$FAKE_APPROVAL_ALIVE" ;;
      *cx-tt-204-stuck*) test -f "$FAKE_STUCK_ALIVE" ;;
      *) exit 1 ;;
    esac
    ;;
  list-panes)
    printf '%s\n' "$FAKE_PANE_PID"
    ;;
  capture-pane)
    case "$*" in
      *cx-tt-201-complete*)
        printf '%s\n' 'Implemented and verified the focused change.' \
          'Worked for 50s • 09:50' \
          '' \
          '' \
          '› Ask Codex to do anything'
        ;;
      *cx-tt-202-active*)
        printf '%s\n' 'Quoted terminal example:' \
          'Worked for 1m 00s · 18:24' \
          '' \
          '› Ask Codex to do anything' \
          'Working (12s • esc to interrupt)'
        ;;
      *cx-tt-203-approval*)
        printf '%s\n' 'Implemented and verified the focused change.' \
          'Worked for 1m 00s · 18:24' \
          '' \
          '› Ask Codex to do anything' \
          'Would you like to run this command?'
        ;;
      *cx-tt-204-stuck*)
        printf '%s\n' 'Implemented and verified the focused change.' \
          '─ Worked for 1m 20s ─' \
          '› Ask Codex to do anything'
        ;;
      *) exit 1 ;;
    esac
    ;;
  send-keys)
    case "$*" in
      *cx-tt-201-complete*C-d*) /bin/rm -f "$FAKE_COMPLETE_ALIVE" ;;
    esac
    ;;
  kill-session)
    case "$*" in
      *cx-tt-201-complete*) /bin/rm -f "$FAKE_COMPLETE_ALIVE" ;;
      *cx-tt-204-stuck*) : ;;
    esac
    ;;
  *) exit 64 ;;
esac
`,
      { mode: 0o700 },
    );
    await chmod(fakeTmux, 0o700);

    const fakeGh = resolve(fakeBin, "gh");
    await writeFile(
      fakeGh,
      `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_GH_CALLS"
case "$*" in
  *mutation*)
    printf '%s\n' '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"item-complete"}}}}'
    ;;
  *)
    printf '%s\n' '{"data":{"user":{"projectV2":{"id":"project-id","field":{"id":"status-field","options":[{"id":"review-option","name":"Human Review"}]}}}}}'
    ;;
esac
`,
      { mode: 0o700 },
    );
    await chmod(fakeGh, 0o700);

    const threadId = "01a1315b-43cb-7bf2-ae6a-78fcb875bacc";
    const codexHome = resolve(home, "codex");
    await mkdir(resolve(codexHome, "sessions"), { recursive: true });
    const rolloutPath = resolve(codexHome, "sessions/primary.jsonl");
    await writeFile(rolloutPath, [
      { type: "session_meta", payload: { id: threadId, cwd: "/tmp/worktrees/201/TailorTales" } },
      { type: "event_msg", payload: { type: "task_complete", turn_id: "exact-turn", last_agent_message: "Architecture checkpoint required. gh unknown owner type; pnpm SQLite store errors. No commit, push or PR. DATABASE_URL=postgres://fixture:synthetic-secret@host/db @everyone" } },
    ].map(row => JSON.stringify(row)).join("\n") + "\n");
    const codexDb = new DatabaseSync(resolve(codexHome, "state_5.sqlite"));
    codexDb.exec("CREATE TABLE threads(id TEXT, rollout_path TEXT)");
    codexDb.prepare("INSERT INTO threads VALUES(?,?)").run(threadId, rolloutPath);
    codexDb.close();
    const originalRollout = await readFile(rolloutPath, "utf8");
    const captured = capturePrimaryStoppedResult(threadId, "/tmp/worktrees/201/TailorTales", codexHome);
    const bounded = primaryStoppedSummary("Preparation complete. " + "filler ".repeat(200) + " DATABASE_URL=postgres://user:synthetic-secret@host/db @everyone Blocked: unknown owner type. No PR.")!;
    assert(bounded.length <= 800 && bounded.startsWith("Preparation complete.") && bounded.endsWith("Blocked: unknown owner type. No PR."), "Bounded summary lost the actual concluding blocker");
    assert(!bounded.includes("synthetic-secret") && !bounded.includes("@everyone"), "Primary tail leaked credential or mention");
    assert(captured?.turnId === "exact-turn" && captured.summary?.includes("No commit, push or PR"), "Native stopped result not captured");
    assert(capturePrimaryStoppedResult(threadId, "/wrong/worktree", codexHome) === null, "Mismatched worktree report accepted");
    for (const type of ["task_started", "turn_aborted"]) {
      await writeFile(rolloutPath, originalRollout + JSON.stringify({ type: "event_msg", payload: { type } }) + "\n");
      assert(capturePrimaryStoppedResult(threadId, "/tmp/worktrees/201/TailorTales", codexHome) === null, `Stale completion survived ${type}`);
    }
    await writeFile(rolloutPath, originalRollout.split("\n")[0] + "\n" + JSON.stringify({ type: "response_item", payload: { role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Success! PR delivered." }] } }) + "\n");
    assert(capturePrimaryStoppedResult(threadId, "/tmp/worktrees/201/TailorTales", codexHome) === null, "Arbitrary prose counted as a completion receipt");
    await writeFile(rolloutPath, originalRollout.replace(threadId, "mismatched-thread"));
    assert(capturePrimaryStoppedResult(threadId, "/tmp/worktrees/201/TailorTales", codexHome) === null, "Mismatched session report accepted");
    await writeFile(rolloutPath, originalRollout);

    const env = {
      ...process.env,
      KURAMI_HOME: home,
      CODEX_HOME: codexHome,
      FAKE_PANE_PID: String(paneProcess.pid),
      ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations"),
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_COMPLETE_ALIVE: completeAlive,
      FAKE_ACTIVE_ALIVE: activeAlive,
      FAKE_APPROVAL_ALIVE: approvalAlive,
      FAKE_STUCK_ALIVE: stuckAlive,
      FAKE_GH_CALLS: ghCalls,
      FAKE_TMUX_CALLS: tmuxCalls,
    };
    execFileSync(
      process.execPath,
      [resolve(app, "src/orchestrator/state/init-run-store.ts")],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );

    const databasePath = resolve(home, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    const addRun = (
      suffix: "complete" | "active" | "approval" | "stuck",
      issueNumber: number,
      sessionName: string,
    ): void => {
      database
        .prepare(
          `INSERT INTO project_events (
             event_id, observed_at, project, item_id, content_id, content_type,
             repository, issue_number, title, url, from_status, to_status,
             payload_json, processing_state
           ) VALUES (?, '2026-09-22T00:00:00.000Z', 'tailortales', ?, ?, 'Issue',
             'Shagon1k/TailorTales', ?, ?, ?, 'Backlog', 'In progress', '{}',
             'processed')`,
        )
        .run(
          `event-${suffix}`,
          `item-${suffix}`,
          `content-${suffix}`,
          issueNumber,
          `Autonomous ${suffix}`,
          `https://example.invalid/issues/${issueNumber}`,
        );
      database
        .prepare(
          `INSERT INTO project_items (
             project, item_id, content_id, content_type, repository,
             issue_number, title, url, status, first_seen_at, last_seen_at
           ) VALUES ('tailortales', ?, ?, 'Issue', 'Shagon1k/TailorTales', ?,
             ?, ?, 'In progress', '2026-09-22T00:00:00.000Z',
             '2026-09-22T00:00:00.000Z')`,
        )
        .run(
          `item-${suffix}`,
          `content-${suffix}`,
          issueNumber,
          `Autonomous ${suffix}`,
          `https://example.invalid/issues/${issueNumber}`,
        );
      database
        .prepare(
          `INSERT INTO runs (
             run_id, trigger_event_id, project, item_id, content_id, repository,
             issue_number, interaction_policy, state, owner_state, execution_mode
           ) VALUES (?, ?, 'tailortales', ?, ?, 'Shagon1k/TailorTales', ?,
             'autonomous', 'running', 'cli', 'live')`,
        )
        .run(
          `r_${suffix}`,
          `event-${suffix}`,
          `item-${suffix}`,
          `content-${suffix}`,
          issueNumber,
        );
      database
        .prepare(
          `INSERT INTO run_resources (
             run_id, resource_state, worktree_path, branch_name,
             codex_thread_id, tmux_session_name
           ) VALUES (?, 'provisioned', ?, ?, ?, ?)`,
        )
        .run(
          `r_${suffix}`,
          `/tmp/worktrees/${issueNumber}/TailorTales`,
          `TT-${issueNumber}_${suffix}`,
          suffix === "complete" ? threadId : `thread-${suffix}`,
          sessionName,
        );
    };
    addRun("complete", 201, "cx-tt-201-complete");
    addRun("active", 202, "cx-tt-202-active");
    addRun("approval", 203, "cx-tt-203-approval");
    addRun("stuck", 204, "cx-tt-204-stuck");
    database.exec(`
      UPDATE runs
      SET preview_required=1, preview_required_label='preview-required'
      WHERE run_id='r_complete'
    `);
    database.close();

    const controllerPath = resolve(app, "src/orchestrator/runtime/controller.ts");
    let prematureReviewFailure = "";
    try {
      execFileSync(
        process.execPath,
        [
          resolve(app, "src/orchestrator/projects/project-status.ts"),
          "review",
          "--run-id",
          "r_complete",
          "--apply",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      prematureReviewFailure =
        (error as { stderr?: string }).stderr ?? String(error);
    }
    assert(
      prematureReviewFailure.includes("not a released autonomous completion"),
      "Project status boundary accepted a CLI-owned completion",
    );
    assert(
      (await readFile(ghCalls, "utf8")) === "",
      "Rejected CLI-owned review writeback called GitHub",
    );

    const plan = runController(controllerPath, env);
    assert(
      plan.plans?.some(
        (entry) => entry.runId === "r_complete" && entry.action === "park",
      ),
      "New terminal UI completion was not scheduled to park",
    );
    assert(
      !plan.plans?.some((entry) => entry.runId === "r_active"),
      "An active completion-like transcript was scheduled to park",
    );
    assert(
      !plan.plans?.some((entry) => entry.runId === "r_approval"),
      "An approval-blocked completion-like transcript was scheduled to park",
    );

    const applied = runController(controllerPath, env, true);
    assert(
      applied.results?.some(
        (entry) =>
          entry.runId === "r_complete" &&
          entry.action === "park" &&
          entry.status === "applied",
      ),
      "Completed autonomous run was not parked",
    );
    assert(
      !applied.results?.some((entry) => entry.runId === "r_active"),
      "Active autonomous run was acted on",
    );
    assert(
      !applied.results?.some((entry) => entry.runId === "r_approval"),
      "Approval-blocked autonomous run was acted on",
    );
    assert(
      applied.results?.some(
        (entry) =>
          entry.runId === "r_stuck" &&
          entry.action === "park" &&
          entry.status === "deferred",
      ),
      "A tmux release failure was not surfaced",
    );

    const interim = new DatabaseSync(databasePath, { readOnly: true });
    const interimRows = interim
      .prepare(
        `SELECT r.run_id, r.state, r.owner_state, pi.status,
                rr.tmux_session_name
         FROM runs r
         JOIN run_resources rr USING (run_id)
         JOIN project_items pi ON pi.project=r.project AND pi.item_id=r.item_id
         ORDER BY r.run_id`,
      )
      .all() as Array<{
      run_id: string;
      state: string;
      owner_state: string;
      status: string;
      tmux_session_name: string | null;
    }>;
    interim.close();
    const interimComplete = interimRows.find((row) => row.run_id === "r_complete");
    const interimStuck = interimRows.find((row) => row.run_id === "r_stuck");
    assert(
      interimComplete?.state === "parked_review" &&
        interimComplete.owner_state === "none" &&
        interimComplete.tmux_session_name === null &&
        interimComplete.status === "In progress",
      "Project moved before the completed CLI session was durably released",
    );
    assert(
      interimStuck?.state === "running" &&
        interimStuck.owner_state === "cli" &&
        interimStuck.tmux_session_name === "cx-tt-204-stuck" &&
        interimStuck.status === "In progress",
      "A failed tmux release advanced the run or Project status",
    );
    assert(
      (await readFile(ghCalls, "utf8")) === "",
      "The release pass called the GitHub Project boundary",
    );

    const unsafeTmuxEffectsBefore = (await readFile(tmuxCalls, "utf8"))
      .split("\n")
      .filter((line) => /^(?:send-keys|kill-session)\b/u.test(line)).length;
    let activeParkFailure = "";
    try {
      execFileSync(
        process.execPath,
        [
          resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
          "park",
          "--run-id",
          "r_active",
          "--apply",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      activeParkFailure = (error as { stderr?: string }).stderr ?? String(error);
    }
    assert(
      activeParkFailure.includes("turn is still active"),
      "Session manager did not independently reject the active false positive",
    );
    let approvalParkFailure = "";
    try {
      execFileSync(
        process.execPath,
        [
          resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
          "park",
          "--run-id",
          "r_approval",
          "--apply",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      approvalParkFailure = (error as { stderr?: string }).stderr ?? String(error);
    }
    assert(
      approvalParkFailure.includes("waiting for approval"),
      "Session manager did not independently reject the approval-blocked tail",
    );
    const unsafeTmuxEffectsAfter = (await readFile(tmuxCalls, "utf8"))
      .split("\n")
      .filter((line) => /^(?:send-keys|kill-session)\b/u.test(line)).length;
    assert(
      unsafeTmuxEffectsAfter === unsafeTmuxEffectsBefore,
      "An unsafe completion-like tail caused tmux sends or kills",
    );
    assert(
      (await readFile(ghCalls, "utf8")) === "",
      "An unsafe completion-like tail caused a Project mutation",
    );

    const missingPrPlan = runController(controllerPath, env);
    assert(
      !missingPrPlan.plans?.some(
        (entry) => entry.runId === "r_complete" && entry.action === "project_review",
      ),
      "Released autonomous completion without an observed PR was scheduled for Project review writeback",
    );
    const missingPrApplied = runController(controllerPath, env, true);
    assert(
      !missingPrApplied.results?.some(
        (entry) => entry.runId === "r_complete" && entry.action === "project_review",
      ) &&
        (await readFile(ghCalls, "utf8")) === "",
      "Missing-PR completion mutated the GitHub Project",
    );

    const stopped = new DatabaseSync(databasePath);
    const stoppedCard = stopped.prepare("SELECT stage,detail,content_digest FROM run_progress_cards WHERE run_id='r_complete'").get()!;
    assert(stoppedCard.stage === "waiting_human", "No-PR completion advertised as review-ready");
    const report = primaryStoppedDiagnostic(stopped, "r_complete");
    assert(report?.includes("Architecture checkpoint required") && report.includes("gh unknown owner type"), "Exact primary final report missing");
    assert(!String(stoppedCard.detail).includes("https://") && !String(stoppedCard.detail).includes("Writer report"), "Progress prose mixed in diagnostics or navigation");
    assert(!String(report).includes("synthetic-secret") && !String(report).includes("@everyone"), "Stopped report leaked secret or mention");
    assert(!stopped.prepare("SELECT 1 FROM run_control_events WHERE run_id='r_complete' AND event_kind='review_ready'").get(), "No-PR review-ready event created");
    for (const profile of ["general", "clarity"] as const) {
      assert(!(availableRunControls(stopped, "r_complete", { home, profile }).available_actions as string[]).includes("ai_review"), `${profile} CLI offered review without PR`);
      assert(!inspectAiReview(stopped, "r_complete", profile)?.eligible, `${profile} request boundary offered review without PR`);
    }
    const card = { ...runControlStatus(stopped, "r_complete"), run_state: "parked_review", stage: stoppedCard.stage,
      detail: stoppedCard.detail, title: "Synthetic primary blocker", updated_at: "2026-01-01T00:00:00Z",
      review_active_count: 0, ai_review_request_active_count: 0, review_fix_request_active_count: 0,
      clarity: { eligible: false }, desired_surface_digest: "fixture" } as unknown as Parameters<typeof threadControlPayload>[0];
    const project = { workspace: { branch_prefix: "TT" } } as Parameters<typeof threadControlPayload>[1];
    const rendered = JSON.stringify(threadControlPayload(card, project, null, false));
    assert(rendered.includes("Architecture checkpoint required") && rendered.includes(`https://go.shagon1k.win/codex/threads/${threadId}`), "Discord omitted blocker/session link");
    assert(!JSON.stringify(controlComponents(card, project, null)).includes('"value":"ai_review"') && !JSON.stringify(controlComponents(card, project, null)).includes('"value":"clarity_review"'), "Discord offered review without PR/head");
    assert(primaryStoppedDiagnostic(stopped, "r_complete")?.includes("Architecture checkpoint required"), "Current primary receipt hidden");
    assert(runControlStatus(stopped, "r_complete").codex_session_url === `https://go.shagon1k.win/codex/threads/${threadId}`, "CLI omitted HTTPS session link");
    stopped.exec("UPDATE run_resources SET previous_codex_thread_id='technical-predecessor' WHERE run_id='r_complete'");
    assert(primaryStoppedDiagnostic(stopped, "r_complete") === null, "Technical worker reused primary diagnostic");
    stopped.exec("UPDATE run_resources SET previous_codex_thread_id=NULL WHERE run_id='r_complete'");
    stopped.exec("BEGIN; INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES('r_complete','parked_review','parked_review','unrelated_later_receipt','{}')");
    assert(primaryStoppedDiagnostic(stopped, "r_complete") === null, "Historical primary report explained an unrelated later receipt");
    stopped.exec("ROLLBACK");
    stopped.close();
    runController(controllerPath, env, true);
    const repeated = new DatabaseSync(databasePath, { readOnly: true });
    assert(repeated.prepare("SELECT content_digest FROM run_progress_cards WHERE run_id='r_complete'").get()?.content_digest === stoppedCard.content_digest, "Repeated stopped-result reconciliation changed its digest");
    repeated.close();

    const observed = new DatabaseSync(databasePath);
    observed
      .prepare(
        `INSERT INTO run_ci_snapshots (
           run_id, repository, pull_request_number, pull_request_url,
           pull_request_title, head_sha, aggregate_state, checks_json,
           content_digest, first_observed_at, last_observed_at
         ) VALUES (
           'r_complete', 'Shagon1k/TailorTales', 201,
           'https://example.invalid/pulls/201', 'Autonomous complete', NULL,
           'pending', '[]', 'digest-complete',
           '2026-09-22T00:01:00.000Z', '2026-09-22T00:01:00.000Z'
         )`,
      )
      .run();
    observed.close();

    const missingHeadPlan = runController(controllerPath, env);
    assert(
      !missingHeadPlan.plans?.some(
        (entry) => entry.runId === "r_complete" && entry.action === "project_review",
      ),
      "Observed PR without a current CI head SHA was scheduled for Project review writeback",
    );
    const missingHeadApplied = runController(controllerPath, env, true);
    assert(
      !missingHeadApplied.results?.some(
        (entry) => entry.runId === "r_complete" && entry.action === "project_review",
      ) &&
        (await readFile(ghCalls, "utf8")) === "",
      "PR observation without a current CI head SHA mutated the GitHub Project",
    );

    const headless = new DatabaseSync(databasePath);
    assert(headless.prepare("SELECT stage FROM run_progress_cards WHERE run_id='r_complete'").get()?.stage === "waiting_human", "Headless PR advertised as review-ready");
    assert(!(availableRunControls(headless, "r_complete", { home }).available_actions as string[]).includes("ai_review"), "CLI offered review without head");
    headless.close();

    const currentHead = new DatabaseSync(databasePath);
    currentHead
      .prepare(
        `UPDATE run_ci_snapshots
         SET head_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
         WHERE run_id='r_complete'`,
      )
      .run();
    currentHead.close();

    const reviewPlan = runController(controllerPath, env);
    assert(
      reviewPlan.plans?.some(
        (entry) => entry.runId === "r_complete" && entry.action === "project_review",
      ),
      "Released autonomous completion with an exact observed PR head was not scheduled for Project review writeback",
    );
    const reviewApplied = runController(controllerPath, env, true);
    assert(
      reviewApplied.results?.some(
        (entry) =>
          entry.runId === "r_complete" &&
          entry.action === "project_review" &&
          entry.status === "applied",
      ),
      "Released autonomous completion was not moved to Human Review",
    );

    const verify = new DatabaseSync(databasePath, { readOnly: true });
    assert(verify.prepare("SELECT stage FROM run_progress_cards WHERE run_id='r_complete'").get()?.stage === "review_ready", "Observed PR/head did not restore truthful review readiness");
    assert((availableRunControls(verify, "r_complete", { home }).available_actions as string[]).includes("ai_review"), "Delivered PR/head lost CLI review eligibility");
    const rows = verify
      .prepare(
        `SELECT r.run_id, r.state, r.owner_state, pi.status,
                rr.tmux_session_name
         FROM runs r
         JOIN run_resources rr USING (run_id)
         JOIN project_items pi ON pi.project=r.project AND pi.item_id=r.item_id
         ORDER BY r.run_id`,
      )
      .all() as Array<{
      run_id: string;
      state: string;
      owner_state: string;
      status: string;
      tmux_session_name: string | null;
    }>;
    const completionHistory = Number(
      (
        verify
          .prepare(
            `SELECT COUNT(*) AS count FROM run_state_history
             WHERE run_id='r_complete' AND reason IN (
               'autonomous_completion_moved_to_human_review',
               'codex_cli_park_completed'
             )`,
          )
          .get() as { count: number }
      ).count,
    );
    verify.close();
    const complete = rows.find((row) => row.run_id === "r_complete");
    const active = rows.find((row) => row.run_id === "r_active");
    const approval = rows.find((row) => row.run_id === "r_approval");
    assert(
      complete?.state === "parked_review" &&
        complete.owner_state === "none" &&
        complete.status === "Human Review" &&
        complete.tmux_session_name === null &&
        completionHistory === 2,
      "Completed run, Project status, and durable ownership did not converge",
    );
    assert(
      active?.state === "running" &&
        active.owner_state === "cli" &&
        active.status === "In progress" &&
        active.tmux_session_name === "cx-tt-202-active",
      "Active false-positive fixture was mutated",
    );
    assert(
      approval?.state === "running" &&
        approval.owner_state === "cli" &&
        approval.status === "In progress" &&
        approval.tmux_session_name === "cx-tt-203-approval",
      "Approval-blocked false-positive fixture was mutated",
    );
    const calls = await readFile(ghCalls, "utf8");
    assert(
      (calls.match(/updateProjectV2ItemFieldValue/gu) ?? []).length === 1,
      "GitHub Project was not mutated exactly once for the completed run",
    );

    process.stdout.write(
      `${JSON.stringify({ ok: true, newTerminalFormat: true, activeFalsePositiveRejected: true, approvalFalsePositiveRejected: true, releaseFailureSafe: true, twoStageOrdering: true, projectAndRunConverged: true, cliReleased: true })}\n`,
    );
  } finally {
    paneProcess.kill("SIGTERM");
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
