import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runNode(
  script: string,
  args: string[],
  home: string,
  env: NodeJS.ProcessEnv,
): JsonObject {
  const output = execFileSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env, KURAMI_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output.trim().split(/\r?\n/u).filter(Boolean).at(-1)!) as JsonObject;
}

function runNodeFailure(
  script: string,
  args: string[],
  home: string,
  env: NodeJS.ProcessEnv,
): string {
  try {
    runNode(script, args, home, env);
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
  throw new Error("Expected command to fail");
}

function git(directory: string, args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-managed-recovery-"));
  try {
    const worktreeRoot = resolve(home, "worktrees/tailortales");
    const worktree = resolve(worktreeRoot, "501/TailorTales");
    const canonical = resolve(home, "repositories/TailorTales");
    const branch = "TT-501_recovery";
    await mkdir(resolve(home, "config"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(
      resolve(home, "config/orchestrator.yaml"),
      await readFile(resolve(app, "deploy/config/orchestrator.yaml"), "utf8"),
    );
    const projects = (await readFile(
      resolve(app, "deploy/config/projects.yaml"),
      "utf8",
    ))
      .replace("/home/shagon1k/_projects/TailorTales", canonical)
      .replace(
        "/home/shagon1k/_projects/.worktrees/tailortales",
        worktreeRoot,
      );
    await writeFile(resolve(home, "config/projects.yaml"), projects);
    execFileSync("git", ["init", "--initial-branch", branch, worktree], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    git(worktree, ["config", "user.name", "Kurami Test"]);
    git(worktree, ["config", "user.email", "kurami@example.invalid"]);
    git(worktree, [
      "remote",
      "add",
      "origin",
      "https://github.com/Shagon1k/TailorTales.git",
    ]);
    await writeFile(resolve(worktree, "fix.txt"), "source\n");
    git(worktree, ["add", "fix.txt"]);
    git(worktree, ["commit", "-m", "source"]);
    const sourceHead = git(worktree, ["rev-parse", "HEAD"]);
    await writeFile(resolve(worktree, "fix.txt"), "delivered\n");
    git(worktree, ["add", "fix.txt"]);
    git(worktree, ["commit", "-m", "deliver review fix"]);
    const resultHead = git(worktree, ["rev-parse", "HEAD"]);
    git(worktree, ["update-ref", `refs/remotes/origin/${branch}`, resultHead]);

    runNode(
      resolve(app, "src/orchestrator/state/init-run-store.ts"),
      [],
      home,
      {},
    );
    const database = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    database.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, payload_json, processing_state
      ) VALUES ('event-managed-recovery','2026-09-06T10:00:00.000Z',
        'tailortales','item-managed-recovery','content-managed-recovery','Issue',
        'Shagon1k/TailorTales',501,'Recover delivered review fix',
        'https://github.com/Shagon1k/TailorTales/issues/501','{}','processed');
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES ('r_managed_recovery','event-managed-recovery','tailortales',
        'item-managed-recovery','content-managed-recovery','Shagon1k/TailorTales',
        501,'autonomous','needs_attention','cli','live');
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name, base_sha,
        codex_thread_id, previous_codex_thread_id, tmux_session_name
      ) VALUES ('r_managed_recovery','provisioned','placeholder', '${branch}',
        '${sourceHead}','01a-review-fix-recovery','01a-primary-recovery',
        'cx-tt-501-recovery');
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via, idempotency_key,
        completed_at
      ) VALUES ('rq_original_review_fix','r_managed_recovery','review_fix','applied',
        'discord','managed-recovery:original',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      INSERT INTO run_review_fix_rounds (
        round_id, run_id, request_id, round_number, round_state, repository,
        pull_request_number, pull_request_url, source_head_sha, snapshot_json,
        codex_thread_id, failure_reason, completed_at
      ) VALUES ('rfr_managed501','r_managed_recovery','rq_original_review_fix',1,
        'needs_attention','Shagon1k/TailorTales',601,
        'https://github.com/Shagon1k/TailorTales/pull/601','${sourceHead}',
        '[{"threadId":"preserved-thread"}]','01a-review-fix-recovery',
        'review_fix_uncommitted_changes',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      INSERT INTO run_ci_snapshots (
        run_id, repository, pull_request_number, pull_request_url,
        pull_request_title, head_sha, aggregate_state, checks_json,
        content_digest, first_observed_at, last_observed_at, completed_at
      ) VALUES ('r_managed_recovery','Shagon1k/TailorTales',601,
        'https://github.com/Shagon1k/TailorTales/pull/601','Recovery PR',
        '${resultHead}','passed','[]','managed-recovery-ci',
        strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      INSERT INTO run_state_history (
        run_id, from_state, to_state, reason, details_json
      ) VALUES ('r_managed_recovery','parked_review','needs_attention',
        'review_fix_uncommitted_changes',json_object(
          'roundId','rfr_managed501',
          'sourceHeadSha','${sourceHead}',
          'localHeadSha','${sourceHead}',
          'codexThreadId','01a-review-fix-recovery',
          'previousCodexThreadId','01a-primary-recovery'
        ));
    `);
    database
      .prepare(
        `UPDATE run_resources SET worktree_path=? WHERE run_id='r_managed_recovery'`,
      )
      .run(worktree);
    database.close();

    const fakeBin = resolve(home, "fake-bin");
    const tmuxState = resolve(home, "tmux-alive");
    await mkdir(fakeBin, { recursive: true });
    await writeFile(tmuxState, "alive\n");
    await writeFile(
      resolve(fakeBin, "tmux"),
      `#!/bin/sh
set -eu
case "$1" in
  has-session) test -f "$FAKE_TMUX_STATE" ;;
  show-environment)
    case "$4" in
      HERMES_RUN_ID) printf 'HERMES_RUN_ID=%s\\n' "\${FAKE_SESSION_RUN_ID:-r_managed_recovery}" ;;
      HERMES_WORKTREE_PATH) printf 'HERMES_WORKTREE_PATH=%s\\n' "$FAKE_WORKTREE" ;;
      *) exit 1 ;;
    esac
    ;;
  display-message) printf '%s\\n' "$FAKE_WORKTREE" ;;
  capture-pane)
    if [ "\${FAKE_TMUX_MODE:-complete}" = approval ]; then
      printf '%s\\n' 'Requested permission' 'Allow command?'
    else
      printf '%s\\n' 'Review fix committed and pushed.' \\
        '─ Worked for 2m 10s ─' \\
        'Token usage: total=100 input=80 output=20' \\
        'To continue this session, run codex resume 01a07546-c4c9-7ac3-a74e-1e5ca49f39a8'
    fi
    ;;
  kill-session) /bin/rm -f "$FAKE_TMUX_STATE" ;;
  *) exit 64 ;;
esac
`,
      { mode: 0o700 },
    );
    const baseEnv = {
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_TMUX_STATE: tmuxState,
      FAKE_WORKTREE: worktree,
      FAKE_TMUX_MODE: "complete",
      CONTROLLER_QUIET: "0",
    };
    const controlsPath = resolve(app, "src/orchestrator/controls/run.ts");
    const controllerPath = resolve(app, "src/orchestrator/runtime/controller.ts");
    const controls = () =>
      runNode(
        controlsPath,
        ["controls", "--project", "tailortales", "--issue", "501"],
        home,
        baseEnv,
      );
    const assertRefused = (
      label: string,
      env: NodeJS.ProcessEnv = baseEnv,
    ): void => {
      const shown = runNode(
        controlsPath,
        ["controls", "--project", "tailortales", "--issue", "501"],
        home,
        env,
      );
      assert(
        !(shown.available_actions as string[]).includes("recover_managed_task"),
        `${label} exposed managed recovery`,
      );
      const failure = runNodeFailure(
        controlsPath,
        [
          "request",
          "--run-id",
          "r_managed_recovery",
          "--action",
          "recover_managed_task",
          "--via",
          "cli",
          "--apply",
        ],
        home,
        env,
      );
      assert(failure.includes("not eligible"), `${label} request was not refused`);
    };

    const refusalDb = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    refusalDb.exec(
      `UPDATE runs SET stop_reason='cancelled' WHERE run_id='r_managed_recovery'`,
    );
    refusalDb.close();
    assertRefused("Cancellation");
    const resetCancellation = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    resetCancellation.exec(
      `UPDATE runs SET stop_reason=NULL WHERE run_id='r_managed_recovery'`,
    );
    resetCancellation.close();

    const staleDb = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    staleDb
      .prepare(
        `UPDATE run_ci_snapshots SET head_sha=? WHERE run_id='r_managed_recovery'`,
      )
      .run(sourceHead);
    staleDb.close();
    assertRefused("Mismatched PR head");
    const resetHead = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    resetHead
      .prepare(
        `UPDATE run_ci_snapshots SET head_sha=? WHERE run_id='r_managed_recovery'`,
      )
      .run(resultHead);
    resetHead.close();

    const staleObservation = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    staleObservation.exec(
      `UPDATE run_ci_snapshots
       SET last_observed_at='2026-09-06T00:00:00.000Z'
       WHERE run_id='r_managed_recovery'`,
    );
    staleObservation.close();
    assertRefused("Stale CI observation");
    const resetObservation = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    resetObservation.exec(
      `UPDATE run_ci_snapshots
       SET last_observed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE run_id='r_managed_recovery'`,
    );
    resetObservation.close();

    const unknownCi = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    unknownCi.exec(
      `UPDATE run_ci_snapshots SET aggregate_state='unknown', completed_at=NULL
       WHERE run_id='r_managed_recovery'`,
    );
    unknownCi.close();
    assertRefused("Unknown CI blocker");
    const resetCi = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    resetCi.exec(
      `UPDATE run_ci_snapshots
       SET aggregate_state='passed',
           completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE run_id='r_managed_recovery'`,
    );
    resetCi.close();

    await writeFile(resolve(worktree, "dirty.txt"), "post-commit dirt\n");
    assertRefused("Dirty post-commit worktree");
    await rm(resolve(worktree, "dirty.txt"));
    assertRefused("Approval-blocked session", {
      ...baseEnv,
      FAKE_TMUX_MODE: "approval",
    });
    await rm(tmuxState);
    assertRefused("Dead session");
    await writeFile(tmuxState, "alive\n");
    assertRefused("Ambiguous session identity", {
      ...baseEnv,
      FAKE_SESSION_RUN_ID: "r_other_run",
    });

    const ambiguousDb = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    ambiguousDb.exec(`
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via, idempotency_key,
        completed_at
      ) VALUES ('rq_ambiguous_review_fix','r_managed_recovery','review_fix','applied',
        'discord','managed-recovery:ambiguous',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      INSERT INTO run_review_fix_rounds (
        round_id, run_id, request_id, round_number, round_state, repository,
        pull_request_number, pull_request_url, source_head_sha, snapshot_json,
        codex_thread_id, failure_reason, completed_at
      ) VALUES ('rfr_ambiguous501','r_managed_recovery','rq_ambiguous_review_fix',2,
        'needs_attention','Shagon1k/TailorTales',601,
        'https://github.com/Shagon1k/TailorTales/pull/601','${sourceHead}','[]',
        '01a-review-fix-recovery','review_fix_uncommitted_changes',
        strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
    ambiguousDb.close();
    assertRefused("Ambiguous preserved task");
    const resetAmbiguous = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    resetAmbiguous.exec(`
      DELETE FROM run_review_fix_rounds WHERE round_id='rfr_ambiguous501';
      DELETE FROM run_control_requests WHERE request_id='rq_ambiguous_review_fix';
    `);
    resetAmbiguous.close();

    assert(
      (controls().available_actions as string[]).includes(
        "recover_managed_task",
      ),
      "Proven managed recovery was not exposed in run controls",
    );
    Object.assign(process.env, baseEnv, { KURAMI_HOME: home });
    const { controlComponents } = await import(
      "../src/orchestrator/controls/discord.ts"
    );
    const discordControls = controlComponents(
      {
        run_id: "r_managed_recovery",
        stage: "needs_attention",
        run_state: "needs_attention",
        owner_state: "cli",
        execution_mode: "live",
        resource_state: "provisioned",
        latest_attention_reason: "review_fix_uncommitted_changes",
        review_fix_state: "needs_attention",
        review_fix_request_active_count: 0,
        codex_thread_id: "01a-review-fix-recovery",
        previous_codex_thread_id: "01a-primary-recovery",
        stop_reason: null,
      } as never,
      {
        repository: "Shagon1k/TailorTales",
        workspace: { branch_prefix: "TT", worktree_root: worktreeRoot },
      },
      {
        url: "https://github.com/Shagon1k/TailorTales/pull/601",
        title: "Recovery PR",
        number: 601,
        headSha: resultHead,
      },
    );
    assert(
      JSON.stringify(discordControls).includes(
        "kurami:recover_managed_task:r_managed_recovery",
      ),
      "Proven managed recovery was not exposed in Discord controls",
    );
    const waitingProbeDb = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    waitingProbeDb.exec(`
      UPDATE run_ci_snapshots SET aggregate_state='pending', completed_at=NULL
      WHERE run_id='r_managed_recovery';
      INSERT INTO run_control_requests (
        request_id, run_id, action, requested_via, idempotency_key
      ) VALUES ('rq_waiting_probe','r_managed_recovery','recover_managed_task',
        'cli','managed-recovery:waiting-probe');
    `);
    waitingProbeDb.close();
    const waitingPlan = runNode(
      resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
      [
        "recover-managed-task",
        "--run-id",
        "r_managed_recovery",
        "--request-id",
        "rq_waiting_probe",
      ],
      home,
      baseEnv,
    );
    assert(
      (waitingPlan.plan as JsonObject).targetRoundState === "waiting_ci",
      "Fresh pending exact-head CI did not plan waiting_ci recovery",
    );
    const resetWaitingProbe = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    resetWaitingProbe.exec(`
      DELETE FROM run_control_requests WHERE request_id='rq_waiting_probe';
      UPDATE run_ci_snapshots
      SET aggregate_state='passed',
          completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          last_observed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE run_id='r_managed_recovery';
    `);
    resetWaitingProbe.close();
    const request = runNode(
      controlsPath,
      [
        "request",
        "--run-id",
        "r_managed_recovery",
        "--action",
        "recover_managed_task",
        "--via",
        "discord",
        "--apply",
      ],
      home,
      baseEnv,
    );
    const directApplyFailure = runNodeFailure(
      resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
      [
        "recover-managed-task",
        "--run-id",
        "r_managed_recovery",
        "--request-id",
        String(request.requestId),
        "--apply",
      ],
      home,
      baseEnv,
    );
    assert(
      directApplyFailure.includes("only be applied by the live controller"),
      "Session manager allowed recovery outside the deterministic controller",
    );
    const controller = runNode(controllerPath, ["--apply"], home, baseEnv);
    assert(
      (controller.results as JsonObject[]).some(
        (result) =>
          result.action === "recover_managed_task" &&
          result.status === "applied",
      ),
      "Deterministic controller did not finalize managed recovery",
    );
    const verified = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    const recovered = verified
      .prepare(
        `SELECT r.state, r.owner_state, rr.tmux_session_name,
                f.round_state, f.result_head_sha, f.snapshot_json,
                q.request_state
         FROM runs r JOIN run_resources rr USING (run_id)
         JOIN run_review_fix_rounds f USING (run_id)
         JOIN run_control_requests q ON q.request_id=?
         WHERE r.run_id='r_managed_recovery'`,
      )
      .get(String(request.requestId)) as {
      state: string;
      owner_state: string;
      tmux_session_name: string | null;
      round_state: string;
      result_head_sha: string | null;
      snapshot_json: string;
      request_state: string;
    };
    const history = verified
      .prepare(
        `SELECT reason FROM run_state_history WHERE run_id='r_managed_recovery'
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get() as { reason: string };
    verified.close();
    assert(
      recovered.state === "parked_review" &&
        recovered.owner_state === "none" &&
        recovered.tmux_session_name === null &&
        recovered.round_state === "resolving" &&
        recovered.result_head_sha === resultHead &&
        recovered.snapshot_json === '[{"threadId":"preserved-thread"}]' &&
        recovered.request_state === "applied" &&
        history.reason === "review_fix_managed_task_recovered" &&
        !(await import("node:fs")).existsSync(tmuxState),
      "Recovered task did not enter the normal exact-head resolving lifecycle",
    );
    const resolutionPlan = runNode(controllerPath, [], home, baseEnv);
    assert(
      (resolutionPlan.plans as JsonObject[]).some(
        (plan) =>
          plan.action === "review_fix_resolve" &&
          plan.roundId === "rfr_managed501",
      ),
      "Recovered passed-CI round was not scheduled for normal finalization",
    );
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        controlsProven: true,
        discordControlsProven: true,
        controllerFinalizedRecovery: true,
        directSessionMutationRefused: true,
        originalSnapshotPreserved: true,
        normalResolutionLifecycleRestored: true,
        refusals: [
          "cancellation",
          "mismatched_head",
          "stale_ci",
          "unknown_ci",
          "dirty_worktree",
          "approval_blocker",
          "dead_session",
          "ambiguous_session",
          "ambiguous_task",
        ],
      })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
