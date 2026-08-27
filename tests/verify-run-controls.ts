import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Plan = { action: string; runId: string; requestId?: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runNode(
  path: string,
  args: string[],
  home: string,
): Record<string, unknown> {
  const output = execFileSync(process.execPath, [path, ...args], {
    encoding: "utf8",
    env: { ...process.env, ORCHESTRATOR_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output) as Record<string, unknown>;
}

function runNodeFails(path: string, args: string[], home: string): string {
  try {
    runNode(path, args, home);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    return typeof stderr === "string" ? stderr : String(error);
  }
  throw new Error(`Expected command to fail: ${args.join(" ")}`);
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const canonicalControls = await import(
    "../src/orchestrator/controls/run.ts"
  );
  const legacyControls = await import("../src/run-controls.ts");
  assert(
    legacyControls.runRunControlsCli === canonicalControls.runRunControlsCli,
    "Legacy run-controls wrapper diverged from the canonical module",
  );
  const testHome = await mkdtemp(
    resolve(tmpdir(), "kurami-run-controls-test-"),
  );
  try {
    await mkdir(resolve(testHome, "config"), { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(appDirectory, "deploy/config/orchestrator.yaml"),
      resolve(testHome, "config/orchestrator.yaml"),
    );
    await copyFile(
      resolve(appDirectory, "deploy/config/projects.yaml"),
      resolve(testHome, "config/projects.yaml"),
    );
    runNode(resolve(appDirectory, "src/init-run-store.ts"), [], testHome);
    const databasePath = resolve(testHome, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);

    const insertEvent = database.prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json, processing_state
      ) VALUES (?, '2026-08-15T12:00:00.000Z', 'tailortales', ?, ?, 'Issue',
                'Shagon1k/TailorTales', ?, ?, ?, 'In progress', 'Human Review',
                '{"issueState":"OPEN","labels":[],"hasDescription":true}', 'processed')
    `);
    const insertRun = database.prepare(`
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES (?, ?, 'tailortales', ?, ?, 'Shagon1k/TailorTales', ?, ?, ?, ?, 'live')
    `);
    const insertResource = database.prepare(`
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name,
        codex_thread_id, tmux_session_name
      ) VALUES (?, 'provisioned', ?, ?, ?, ?)
    `);
    const addRun = (
      runId: string,
      issue: number,
      policy: string,
      state: string,
      owner: string,
      tmux: string | null,
    ): void => {
      const eventId = `event-${issue}`;
      const itemId = `item-${issue}`;
      const contentId = `content-${issue}`;
      insertEvent.run(
        eventId,
        itemId,
        contentId,
        issue,
        `[Test]: Control ${issue}`,
        `https://example.invalid/issues/${issue}`,
      );
      insertRun.run(
        runId,
        eventId,
        itemId,
        contentId,
        issue,
        policy,
        state,
        owner,
      );
      insertResource.run(
        runId,
        `/tmp/worktrees/${issue}/TailorTales`,
        `TT-${issue}_control-test`,
        `thread-${issue}`,
        tmux,
      );
    };

    addRun("r_review_ready", 9301, "autonomous", "parked_review", "none", null);
    database
      .prepare(
        `
        INSERT INTO run_state_history (
          run_id, from_state, to_state, reason, details_json
        ) VALUES (
          'r_review_ready', 'parked_review', 'parked_review',
          'codex_cli_park_completed', '{}'
        )
      `,
      )
      .run();
    database.close();

    const controller = resolve(appDirectory, "src/controller.ts");
    runNode(controller, ["--apply"], testHome);

    const previewHistory = new DatabaseSync(databasePath);
    previewHistory
      .prepare(
        `
        INSERT INTO run_state_history (
          run_id, from_state, to_state, reason, details_json
        ) VALUES (
          'r_review_ready', 'parked_review', 'parked_review',
          'preview_slot_leased', '{}'
        )
      `,
      )
      .run();
    previewHistory.close();

    runNode(controller, ["--apply"], testHome);

    const verify = new DatabaseSync(databasePath);
    const eventCount = Number(
      (
        verify
          .prepare(
            `
      SELECT COUNT(*) AS count FROM run_control_events
      WHERE run_id = 'r_review_ready' AND event_kind = 'review_ready'
    `,
          )
          .get() as { count: number }
      ).count,
    );
    assert(eventCount === 1, "Review notification outbox is not idempotent");
    const notificationPlan = runNode(
      resolve(appDirectory, "src/notify-controls.ts"),
      [],
      testHome,
    ) as unknown as {
      pending: Array<{ runId: string; kind: string }>;
      pendingCards: Array<{ runId: string; stage: string }>;
    };
    assert(
      notificationPlan.pending.length === 1 &&
        notificationPlan.pending[0]?.runId === "r_review_ready" &&
        notificationPlan.pending[0]?.kind === "review_ready",
      "Notifier did not expose the durable review event",
    );
    assert(
      notificationPlan.pendingCards?.some(
        (card: { runId: string; stage: string }) =>
          card.runId === "r_review_ready" && card.stage === "review_ready",
      ),
      "Notifier did not expose the durable progress card",
    );
    const disabledTelegram = runNode(
      resolve(appDirectory, "src/notify-controls.ts"),
      ["--apply"],
      testHome,
    ) as unknown as { action: string; delivered: number };
    assert(
      disabledTelegram.action === "disabled" &&
        disabledTelegram.delivered === 0,
      "Proactive Telegram delivery is not disabled by default",
    );

    const addDirect = (
      runId: string,
      issue: number,
      policy: string,
      state: string,
      owner: string,
      tmux: string | null,
    ): void => {
      const eventId = `event-${issue}`;
      const itemId = `item-${issue}`;
      const contentId = `content-${issue}`;
      verify
        .prepare(
          `
        INSERT INTO project_events (
          event_id, observed_at, project, item_id, content_id, content_type,
          repository, issue_number, title, url, from_status, to_status,
          payload_json, processing_state
        ) VALUES (?, '2026-08-15T12:00:00.000Z', 'tailortales', ?, ?, 'Issue',
                  'Shagon1k/TailorTales', ?, ?, ?, 'In progress', 'Human Review',
                  '{"issueState":"OPEN","labels":[],"hasDescription":true}', 'processed')
      `,
        )
        .run(
          eventId,
          itemId,
          contentId,
          issue,
          `[Test]: Control ${issue}`,
          `https://example.invalid/issues/${issue}`,
        );
      verify
        .prepare(
          `
        INSERT INTO runs (
          run_id, trigger_event_id, project, item_id, content_id, repository,
          issue_number, interaction_policy, state, owner_state, execution_mode
        ) VALUES (?, ?, 'tailortales', ?, ?, 'Shagon1k/TailorTales', ?, ?, ?, ?, 'live')
      `,
        )
        .run(runId, eventId, itemId, contentId, issue, policy, state, owner);
      verify
        .prepare(
          `
        INSERT INTO run_resources (
          run_id, resource_state, worktree_path, branch_name,
          codex_thread_id, tmux_session_name
        ) VALUES (?, 'provisioned', ?, ?, ?, ?)
      `,
        )
        .run(
          runId,
          `/tmp/worktrees/${issue}/TailorTales`,
          `TT-${issue}_control-test`,
          `thread-${issue}`,
          tmux,
        );
    };

    addDirect(
      "r_auto_park",
      9302,
      "autonomous",
      "parked_review",
      "cli",
      "cx-9302",
    );
    addDirect(
      "r_human_handoff",
      9303,
      "human_control",
      "running",
      "cli",
      "cx-9303",
    );
    addDirect(
      "r_take_control",
      9304,
      "autonomous",
      "parked_review",
      "none",
      null,
    );
    addDirect(
      "r_takeover_pending",
      9315,
      "autonomous",
      "running",
      "cli",
      "cx-9315",
    );
    verify
      .prepare(
        `UPDATE runs SET execution_mode = 'dry_run'
         WHERE run_id = 'r_takeover_pending'`,
      )
      .run();
    addDirect("r_preview", 9305, "autonomous", "parked_review", "none", null);
    addDirect("r_stop", 9306, "autonomous", "parked_review", "none", null);
    addDirect(
      "r_preserved_cancel",
      9311,
      "autonomous",
      "needs_attention",
      "none",
      null,
    );
    verify
      .prepare(
        `UPDATE runs
         SET stop_reason = 'cancelled'
         WHERE run_id = 'r_preserved_cancel'`,
      )
      .run();
    addDirect(
      "r_published_cancel",
      9316,
      "autonomous",
      "needs_attention",
      "none",
      null,
    );
    verify
      .prepare(
        `UPDATE runs
         SET stop_reason = 'cancelled'
         WHERE run_id = 'r_published_cancel'`,
      )
      .run();
    addDirect(
      "r_cancelled_backlog",
      9312,
      "autonomous",
      "cancelled",
      "none",
      null,
    );
    verify
      .prepare(
        `UPDATE runs
         SET stop_reason = 'cancelled'
         WHERE run_id = 'r_cancelled_backlog'`,
      )
      .run();
    verify
      .prepare(
        `UPDATE run_resources
         SET resource_state = 'released'
         WHERE run_id = 'r_cancelled_backlog'`,
      )
      .run();
    verify
      .prepare(
        `INSERT INTO project_items (
           project, item_id, content_id, content_type, repository,
           issue_number, title, url, status, first_seen_at, last_seen_at
         ) VALUES (
           'tailortales', 'item-9312', 'content-9312', 'Issue',
           'Shagon1k/TailorTales', 9312, '[Test]: Control 9312',
           'https://example.invalid/issues/9312', 'Backlog',
           '2026-08-15T12:00:00.000Z', '2026-08-15T12:00:00.000Z'
         )`,
      )
      .run();
    addDirect(
      "r_cancelled_retry_old",
      9313,
      "autonomous",
      "cancelled",
      "none",
      null,
    );
    verify.exec(`
      UPDATE runs
      SET stop_reason = 'cancelled'
      WHERE run_id = 'r_cancelled_retry_old';
      UPDATE run_resources
      SET resource_state = 'released'
      WHERE run_id = 'r_cancelled_retry_old';
      INSERT INTO project_items (
        project, item_id, content_id, content_type, repository,
        issue_number, title, url, status, first_seen_at, last_seen_at
      ) VALUES (
        'tailortales', 'item-9313', 'content-9313', 'Issue',
        'Shagon1k/TailorTales', 9313, '[Test]: Control 9313',
        'https://example.invalid/issues/9313', 'In progress',
        '2026-08-15T12:00:00.000Z', '2026-08-15T12:01:00.000Z'
      );
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json, processing_state
      ) VALUES (
        'event-9313-retry', '2026-08-15T12:01:00.000Z', 'tailortales',
        'item-9313', 'content-9313', 'Issue', 'Shagon1k/TailorTales',
        9313, '[Test]: Control 9313',
        'https://example.invalid/issues/9313', 'Backlog', 'In progress',
        '{"issueState":"OPEN","labels":[],"hasDescription":true}',
        'processed'
      );
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES (
        'r_retry_new', 'event-9313-retry', 'tailortales', 'item-9313',
        'content-9313', 'Shagon1k/TailorTales', 9313, 'autonomous',
        'running', 'none', 'live'
      );
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name
      ) VALUES (
        'r_retry_new', 'provisioned',
        '/tmp/worktrees/9313-retry/TailorTales',
        'TT-9313_control-test_retry'
      );
    `);
    addDirect(
      "r_legacy_cancelled_without_reason",
      9314,
      "autonomous",
      "cancelled",
      "none",
      null,
    );
    verify
      .prepare(
        `UPDATE run_resources
         SET resource_state = 'released'
         WHERE run_id = 'r_legacy_cancelled_without_reason'`,
      )
      .run();
    addDirect(
      "r_early_cancel",
      9309,
      "autonomous",
      "stopping",
      "cli",
      "cx-tt-9309-early",
    );
    verify
      .prepare(
        `UPDATE run_resources SET codex_thread_id = NULL WHERE run_id = 'r_early_cancel'`,
      )
      .run();
    verify
      .prepare(
        `UPDATE runs SET stop_reason = 'cancelled' WHERE run_id = 'r_early_cancel'`,
      )
      .run();
    addDirect(
      "r_cancel_race",
      9310,
      "autonomous",
      "parked_review",
      "cli",
      "cx-tt-9310-race",
    );
    verify
      .prepare(
        `UPDATE runs SET stop_reason = 'cancelled' WHERE run_id = 'r_cancel_race'`,
      )
      .run();
    addDirect(
      "r_preview_ready",
      9307,
      "autonomous",
      "parked_review",
      "none",
      null,
    );
    addDirect(
      "r_finalizing_review",
      9308,
      "autonomous",
      "parked_review",
      "cli",
      null,
    );
    addDirect(
      "r_runtime_timeout",
      9317,
      "autonomous",
      "needs_attention",
      "none",
      null,
    );
    verify
      .prepare(
        `INSERT INTO run_state_history (
           run_id, from_state, to_state, reason, details_json
         ) VALUES (
           'r_runtime_timeout', 'running', 'needs_attention',
           'main_writer_runtime_budget_exceeded',
           '{"timeoutMinutes":240,"preserved":["worktree","branch","codex_thread"]}'
         )`,
      )
      .run();
    verify
      .prepare(
        `
      INSERT INTO preview_leases (
        lease_id, run_id, slot_number, state, compose_project_name
      ) VALUES ('lease-preview-ready', 'r_preview_ready', 1, 'running', 'preview-ready-test')
    `,
      )
      .run();
    const insertRequest = verify.prepare(`
      INSERT INTO run_control_requests (
        request_id, run_id, action, requested_via, idempotency_key
      ) VALUES (?, ?, ?, 'telegram', ?)
    `);
    insertRequest.run("rq_take", "r_take_control", "take_control", "test:take");
    insertRequest.run(
      "rq_take_pending",
      "r_takeover_pending",
      "take_control",
      "test:take-pending",
    );
    insertRequest.run(
      "rq_preview",
      "r_preview",
      "preview_start",
      "test:preview",
    );
    insertRequest.run("rq_stop", "r_stop", "stop", "test:stop");
    insertRequest.run(
      "rq_discard",
      "r_preserved_cancel",
      "discard_local",
      "test:discard",
    );
    insertRequest.run(
      "rq_discard_published",
      "r_published_cancel",
      "discard_published",
      "test:discard-published",
    );
    verify.close();

    const controlPath = resolve(
      appDirectory,
      "src/orchestrator/controls/run.ts",
    );
    const immediateTakeover = runNode(
      controlPath,
      [
        "request",
        "--run-id",
        "r_takeover_pending",
        "--action",
        "take_control",
        "--via",
        "discord",
        "--apply",
      ],
      testHome,
    );
    assert(
      immediateTakeover.action === "existing",
      "Repeated pending takeover did not remain idempotent",
    );
    const immediateState = new DatabaseSync(databasePath);
    const immediateCard = immediateState
      .prepare(
        `SELECT stage, detail FROM run_progress_cards
         WHERE run_id = 'r_takeover_pending'`,
      )
      .get() as { stage: string; detail: string };
    immediateState.close();
    assert(
      immediateCard.stage === "handoff_pending" &&
        immediateCard.detail.includes("safely interrupting"),
      "Accepted takeover request did not update the durable card immediately",
    );
    const repeatedCancelError = runNodeFails(
      controlPath,
      [
        "request",
        "--run-id",
        "r_preserved_cancel",
        "--action",
        "stop",
        "--via",
        "discord",
        "--apply",
      ],
      testHome,
    );
    assert(
      repeatedCancelError.includes("already in progress or awaiting resolution"),
      "A cancelled run accepted a second cancellation request",
    );
    const activePreviewError = runNodeFails(
      controlPath,
      [
        "request",
        "--run-id",
        "r_human_handoff",
        "--action",
        "preview_start",
        "--via",
        "discord",
        "--apply",
      ],
      testHome,
    );
    assert(
      activePreviewError.includes("stable review state"),
      "Active CLI run accepted a premature preview request",
    );

    const planned = runNode(controller, [], testHome) as unknown as {
      plans: Plan[];
    };
    const actions = Object.fromEntries(
      planned.plans.map((plan) => [plan.runId, plan.action]),
    );
    assert(actions.r_auto_park === "park", "Review should park, not hand off");
    assert(
      actions.r_human_handoff === "handoff",
      "Human-control preparation should hand off",
    );
    assert(
      actions.r_take_control === "claim_remote",
      "Take control should claim the same parked thread",
    );
    assert(
      actions.r_takeover_pending === "handoff",
      "Active Take control request should plan a safe handoff",
    );
    assert(
      actions.r_preview === "preview_allocate",
      "Preview should allocate only on request",
    );
    assert(
      actions.r_stop === "request_stop",
      "Stop request should be explicit",
    );
    assert(
      actions.r_preserved_cancel === "discard_cancelled",
      "Confirmed unpublished cancellation should plan guarded discard",
    );
    assert(
      actions.r_published_cancel === "discard_published_cancelled",
      "Confirmed published cancellation should plan exact Draft PR cleanup",
    );
    assert(
      actions.r_cancelled_backlog === "project_backlog",
      "An unrecorded Backlog state must be acknowledged exactly once",
    );
    assert(
      actions.r_cancelled_retry_old === undefined,
      "A historical cancellation must not move an item owned by a newer run",
    );
    assert(
      actions.r_legacy_cancelled_without_reason === undefined,
      "A legacy terminal run without explicit cancellation intent must not move the Project item",
    );
    assert(
      actions.r_early_cancel === "cancel_cli",
      "Early cancellation must not depend on a synchronized Codex thread",
    );
    assert(
      actions.r_cancel_race === "cancel_cli",
      "A later Human Review event must not override cancellation intent",
    );
    assert(
      actions.r_review_ready === undefined,
      "Review-ready must not auto-start preview",
    );

    const discardPlanCleanup = new DatabaseSync(databasePath);
    discardPlanCleanup
      .prepare(
        `DELETE FROM run_control_requests
         WHERE request_id IN ('rq_discard', 'rq_discard_published')`,
      )
      .run();
    discardPlanCleanup.close();

    runNode(controller, ["--apply"], testHome);
    const notificationState = new DatabaseSync(databasePath);
    const remoteClaim = notificationState
      .prepare(
        `SELECT state, owner_state FROM runs WHERE run_id = 'r_take_control'`,
      )
      .get() as { state: string; owner_state: string };
    assert(
      remoteClaim.state === "remote_owned" &&
        remoteClaim.owner_state === "remote",
      "Parked takeover did not enter the durable remote-owned state",
    );
    const remoteClaimHistory = Number(
      (
        notificationState
          .prepare(
            `SELECT COUNT(*) AS count FROM run_state_history
             WHERE run_id = 'r_take_control'
               AND reason = 'remote_claim_completed'
               AND to_state = 'remote_owned'`,
          )
          .get() as { count: number }
      ).count,
    );
    assert(
      remoteClaimHistory === 1,
      "Remote claim transition was not recorded exactly once",
    );
    const backlogAcknowledged = Number(
      (
        notificationState
          .prepare(
            `
              SELECT COUNT(*) AS count FROM run_state_history
              WHERE run_id = 'r_cancelled_backlog'
                AND reason = 'cancelled_item_already_backlog'
            `,
          )
          .get() as { count: number }
      ).count,
    );
    assert(
      backlogAcknowledged === 1,
      "Backlog satisfaction was not recorded exactly once",
    );
    const previewEventCount = Number(
      (
        notificationState
          .prepare(
            `
        SELECT COUNT(*) AS count FROM run_control_events
        WHERE run_id = 'r_preview_ready' AND event_kind = 'preview_ready'
      `,
          )
          .get() as { count: number }
      ).count,
    );
    assert(previewEventCount === 1, "Preview-ready event is not idempotent");
    const previewCard = notificationState
      .prepare(
        `
      SELECT stage FROM run_progress_cards WHERE run_id = 'r_preview_ready'
    `,
      )
      .get() as { stage: string };
    assert(
      previewCard.stage === "preview_ready",
      "Preview progress card is stale",
    );
    const finalizingCard = notificationState
      .prepare(
        `SELECT stage, detail FROM run_progress_cards
         WHERE run_id = 'r_finalizing_review'`,
      )
      .get() as { stage: string; detail: string };
    assert(
      finalizingCard.stage === "finalizing_review" &&
        finalizingCard.detail.includes("waiting for the active Codex turn"),
      "CLI-owned Human Review was falsely reported as ready",
    );
    const timeoutCard = notificationState
      .prepare(
        `SELECT stage, detail FROM run_progress_cards
         WHERE run_id = 'r_runtime_timeout'`,
      )
      .get() as { stage: string; detail: string };
    assert(
      timeoutCard.stage === "needs_attention" &&
        timeoutCard.detail.includes("240-minute limit") &&
        timeoutCard.detail.includes("preserved"),
      "Runtime timeout was not explained in the durable Discord card",
    );
    const takeoverPendingCard = notificationState
      .prepare(
        `SELECT stage, detail FROM run_progress_cards
         WHERE run_id = 'r_takeover_pending'`,
      )
      .get() as { stage: string; detail: string };
    assert(
      takeoverPendingCard.stage === "handoff_pending" &&
        takeoverPendingCard.detail.includes("safely interrupting"),
      "Pending Take control request was not visible in the progress card",
    );
    const prematureReviewEventCount = Number(
      (
        notificationState
          .prepare(
            `SELECT COUNT(*) AS count FROM run_control_events
             WHERE run_id = 'r_finalizing_review'
               AND event_kind = 'review_ready'`,
          )
          .get() as { count: number }
      ).count,
    );
    assert(
      prematureReviewEventCount === 0,
      "Review-ready event was created before CLI ownership was released",
    );
    notificationState
      .prepare(
        `
      UPDATE run_control_events SET delivery_state = 'sending'
      WHERE run_id = 'r_review_ready' AND event_kind = 'review_ready'
    `,
      )
      .run();
    notificationState.close();
    const successorRequest = runNode(
      controlPath,
      [
        "request",
        "--run-id",
        "r_take_control",
        "--action",
        "take_control",
        "--via",
        "discord",
        "--apply",
      ],
      testHome,
    );
    assert(
      successorRequest.action === "created" &&
        successorRequest.intent === "autonomous_successor",
      "Remote-owned run did not accept an explicit autonomous successor request",
    );
    const successorState = new DatabaseSync(databasePath);
    const successorCard = successorState
      .prepare(
        `SELECT stage, detail FROM run_progress_cards
         WHERE run_id = 'r_take_control'`,
      )
      .get() as { stage: string; detail: string };
    assert(
      successorCard.stage === "autonomous_successor_pending" &&
        successorCard.detail.includes("fresh managed Codex task"),
      "Autonomous continuation reused the human-control handoff presentation",
    );
    successorState
      .prepare(
        `DELETE FROM run_control_requests
         WHERE run_id='r_take_control' AND action='take_control'
           AND request_state IN ('pending','processing')`,
      )
      .run();
    successorState.close();
    const ambiguousDeliveryPlan = runNode(
      resolve(appDirectory, "src/notify-controls.ts"),
      [],
      testHome,
    ) as unknown as { pending: Array<{ runId: string }> };
    assert(
      !ambiguousDeliveryPlan.pending.some(
        (event) => event.runId === "r_review_ready",
      ),
      "Ambiguous sending event would be retried and duplicated",
    );
    const control = resolve(appDirectory, "src/orchestrator/controls/run.ts");
    const remotePreview = runNode(
      control,
      [
        "request",
        "--run-id",
        "r_take_control",
        "--action",
        "preview_start",
        "--via",
        "discord",
        "--apply",
      ],
      testHome,
    );
    assert(
      remotePreview.action === "created" &&
        remotePreview.requestedAction === "preview_start",
      "Remote-owned run rejected an owner-requested preview refresh",
    );
    const remotePreviewCleanup = new DatabaseSync(databasePath);
    remotePreviewCleanup
      .prepare(
        `DELETE FROM run_control_requests
         WHERE run_id='r_take_control' AND action='preview_start'`,
      )
      .run();
    remotePreviewCleanup.close();
    const status = runNode(
      control,
      ["status", "--run-id", "r_review_ready"],
      testHome,
    );
    assert(
      status.state === "parked_review",
      "Status did not return the durable run state",
    );

    const historical = new DatabaseSync(databasePath);
    historical
      .prepare(
        `UPDATE runs SET state = 'archived', owner_state = 'none' WHERE run_id = 'r_review_ready'`,
      )
      .run();
    historical.prepare(`DELETE FROM run_progress_cards`).run();
    historical.close();
    runNode(controller, ["--apply"], testHome);
    const historicalCheck = new DatabaseSync(databasePath);
    const archivedCardCount = Number(
      (
        historicalCheck
          .prepare(
            `SELECT COUNT(*) AS count FROM run_progress_cards WHERE run_id = 'r_review_ready'`,
          )
          .get() as { count: number }
      ).count,
    );
    historicalCheck.close();
    assert(
      archivedCardCount === 0,
      "Migration reconciliation backfilled a historical terminal run",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        isolated: true,
        reviewEventCount: eventCount,
        previewEventCount,
        notificationPending: notificationPlan.pending.length,
        progressCard: previewCard.stage,
        finalizingReviewCard: finalizingCard.stage,
        runtimeTimeoutCard: timeoutCard.stage,
        takeoverPendingCard: takeoverPendingCard.stage,
        immediateTakeoverCard: immediateCard.stage,
        repeatedCancellationRejected: true,
        prematureReviewEventCount,
        ambiguousSendingRetried: false,
        historicalTerminalBackfilled: false,
        previewHistoryDoesNotRepeatReview: true,
        legacyTerminalWithoutReasonIgnored: true,
        telegramProactiveDisabled: true,
        noAutomaticPreview: true,
        activePreviewRejected: true,
        remoteClaimed: true,
        actions,
      })}\n`,
    );
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
