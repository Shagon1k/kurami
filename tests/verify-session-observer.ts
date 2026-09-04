import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { classifyTranscript } from "../src/orchestrator/projects/sessions/observe.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const blocker = `
Publishing is blocked because gh credentials are invalid.
Following the workflow, I stopped before staging or committing.
Re-authenticate with: gh auth login -h github.com

› Implement {feature}
`;
const transient = `
Publishing is blocked at the moment, so I am retrying the safe check.
• Working (12s • esc to interrupt)
`;
const approval = `
Would you like to run the following command?
Press enter to confirm or esc to cancel
`;
const conversationalQuestion = `
I can run the focused smoke test next if useful. Would you like to run it now?
• Working (12s • esc to interrupt)
`;

assert(
  classifyTranscript(blocker) === "idle_textual_blocker",
  "Idle textual blocker was not detected",
);
assert(
  classifyTranscript(transient) === null,
  "Transient blocker narration caused a false alert",
);
assert(
  classifyTranscript(approval) === "waiting_on_approval",
  "Approval prompt was not detected",
);
assert(
  classifyTranscript(conversationalQuestion) === null,
  "A conversational question was misclassified as an interactive approval",
);

async function verifyDurableApprovalHandling(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-session-observer-"));
  const fakeBin = resolve(home, "fake-bin");
  try {
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    const fakeTmux = resolve(fakeBin, "tmux");
    await writeFile(
      fakeTmux,
      `#!/bin/sh
set -eu
printf '%s' "$FAKE_TMUX_TRANSCRIPT"
`,
      { mode: 0o700 },
    );
    await chmod(fakeTmux, 0o700);
    const env = {
      ...process.env,
      KURAMI_HOME: home,
      ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations"),
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_TMUX_TRANSCRIPT: approval,
    };
    execFileSync(
      process.execPath,
      [resolve(app, "src/orchestrator/state/init-run-store.ts")],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );
    const databasePath = resolve(home, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json, processing_state
      ) VALUES (
        'event-observer', '2026-09-04T12:00:00.000Z', 'pickflick',
        'item-observer', 'content-observer', 'Issue',
        'Shagon1k/PickFlick', 9, '[Test]: Approval blocker',
        'https://example.invalid/issues/9', 'In progress', 'In progress',
        '{"issueState":"OPEN","labels":[],"hasDescription":true}', 'processed'
      );
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES (
        'r_observer_approval', 'event-observer', 'pickflick',
        'item-observer', 'content-observer', 'Shagon1k/PickFlick',
        9, 'autonomous', 'running', 'cli', 'live'
      );
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name, codex_thread_id,
        tmux_session_name
      ) VALUES (
        'r_observer_approval', 'provisioned', '/tmp/worktree', 'PF-9_test',
        'thread-observer', 'cx-pf-9-observer'
      );
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via, idempotency_key
      ) VALUES (
        'rq_observer_takeover', 'r_observer_approval', 'take_control',
        'pending', 'discord', 'observer-approval-takeover'
      );
    `);
    database.close();

    const observer = resolve(app, "src/orchestrator/projects/sessions/observe.ts");
    execFileSync(process.execPath, [observer, "--project", "pickflick"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    execFileSync(process.execPath, [observer, "--project", "pickflick"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const verify = new DatabaseSync(databasePath, { readOnly: true });
    const run = verify
      .prepare(`SELECT state, owner_state FROM runs WHERE run_id='r_observer_approval'`)
      .get() as { state: string; owner_state: string };
    const history = verify
      .prepare(`SELECT reason FROM run_state_history WHERE run_id='r_observer_approval' ORDER BY sequence DESC LIMIT 1`)
      .get() as { reason: string };
    const request = verify
      .prepare(`SELECT request_state FROM run_control_requests WHERE request_id='rq_observer_takeover'`)
      .get() as { request_state: string };
    const event = verify
      .prepare(`SELECT payload_json FROM run_control_events WHERE event_id='ce_r_observer_approval_codex_approval'`)
      .get() as { payload_json: string };
    verify.close();
    assert(
      run.state === "needs_attention" && run.owner_state === "cli",
      "Approval blocker did not preserve the CLI session in needs_attention",
    );
    assert(
      history.reason === "codex_waiting_on_approval",
      "Approval blocker history reason is missing",
    );
    assert(
      request.request_state === "rejected",
      "Pending takeover was not rejected after the approval blocker",
    );
    const payload = JSON.parse(event.payload_json) as { source: string; kind: string };
    assert(
      payload.source === "codex" && payload.kind === "waiting_on_approval",
      "Approval blocker did not create a durable attention event",
    );
    env.FAKE_TMUX_TRANSCRIPT = conversationalQuestion;
    execFileSync(process.execPath, [observer, "--project", "pickflick"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const recovered = new DatabaseSync(databasePath, { readOnly: true });
    const recoveredRun = recovered
      .prepare(`SELECT state, owner_state FROM runs WHERE run_id='r_observer_approval'`)
      .get() as { state: string; owner_state: string };
    const recoveryHistory = recovered
      .prepare(`SELECT reason FROM run_state_history WHERE run_id='r_observer_approval' ORDER BY sequence DESC LIMIT 1`)
      .get() as { reason: string };
    recovered.close();
    assert(
      recoveredRun.state === "running" && recoveredRun.owner_state === "cli",
      "A cleared approval blocker did not restore the managed run",
    );
    assert(
      recoveryHistory.reason === "codex_approval_blocker_cleared",
      "Cleared approval recovery did not leave durable history",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

await verifyDurableApprovalHandling();

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    idleTextualBlocker: true,
    transientIgnored: true,
    approvalDetected: true,
    approvalBlockerIsDurable: true,
  })}\n`,
);
