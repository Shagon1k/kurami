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
  throw new Error("Expected command to fail");
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const testHome = await mkdtemp(
    resolve(tmpdir(), "kurami-run-controls-test-"),
  );
  try {
    await mkdir(resolve(testHome, "config"), { recursive: true, mode: 0o700 });
    await copyFile(
      resolve(appDirectory, "../config/orchestrator.yaml"),
      resolve(testHome, "config/orchestrator.yaml"),
    );
    await copyFile(
      resolve(appDirectory, "../config/projects.yaml"),
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
    addDirect("r_preview", 9305, "autonomous", "parked_review", "none", null);
    addDirect("r_stop", 9306, "autonomous", "parked_review", "none", null);
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
      "rq_preview",
      "r_preview",
      "preview_start",
      "test:preview",
    );
    insertRequest.run("rq_stop", "r_stop", "stop", "test:stop");
    verify.close();

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
      actions.r_preview === "preview_allocate",
      "Preview should allocate only on request",
    );
    assert(
      actions.r_stop === "request_stop",
      "Stop request should be explicit",
    );
    assert(
      actions.r_review_ready === undefined,
      "Review-ready must not auto-start preview",
    );

    runNode(controller, ["--apply"], testHome);
    const notificationState = new DatabaseSync(databasePath);
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
    const control = resolve(appDirectory, "src/run-controls.ts");
    const activePreviewError = runNodeFails(
      control,
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
        prematureReviewEventCount,
        ambiguousSendingRetried: false,
        historicalTerminalBackfilled: false,
        previewHistoryDoesNotRepeatReview: true,
        telegramProactiveDisabled: true,
        noAutomaticPreview: true,
        activePreviewRejected: true,
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
