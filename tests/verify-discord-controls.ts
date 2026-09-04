import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { chmodSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function trace(message: string): void {
  if (process.env.KURAMI_TEST_TRACE === "1")
    process.stderr.write(`${message}\n`);
}

async function runNode(
  path: string,
  args: string[],
  home: string,
  extraEnv: Record<string, string> = {},
): Promise<JsonObject> {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [path, ...args], {
      env: { ...process.env, KURAMI_HOME: home, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      const line = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
      if (code !== 0)
        rejectRun(new Error(`Command failed (${code}): ${stderr || stdout}`));
      else {
        try {
          resolveRun(JSON.parse(line ?? "{}") as JsonObject);
        } catch (error) {
          rejectRun(error);
        }
      }
    });
  });
}

async function runNodeFails(
  path: string,
  args: string[],
  home: string,
): Promise<string> {
  try {
    await runNode(path, args, home);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected command to fail");
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonObject;
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: JsonObject,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function nestedComponents(payload: JsonObject): JsonObject[] {
  const result: JsonObject[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const object = value as JsonObject;
    if (typeof object.type === "number") result.push(object);
    if (Array.isArray(object.components)) visit(object.components);
  };
  visit(payload.components);
  return result;
}

function customIds(payload: JsonObject): string[] {
  return nestedComponents(payload)
    .map((component) => String(component.custom_id ?? ""))
    .filter(Boolean);
}

function componentLabels(payload: JsonObject): string[] {
  return nestedComponents(payload).flatMap((component) => [
    ...(component.label ? [String(component.label)] : []),
    ...(Array.isArray(component.options)
      ? component.options.map((option) =>
          String((option as JsonObject).label ?? ""),
        )
      : []),
  ]);
}

function componentText(payload: JsonObject): string {
  return nestedComponents(payload)
    .filter((component) => component.type === 10)
    .map((component) => String(component.content ?? ""))
    .join("\n");
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const testHome = await mkdtemp(resolve(tmpdir(), "kurami-discord-test-"));
  const guildId = "1538486166330933358";
  const parentChannel = "1538490534820061286";
  const resourceGuardChannel = "1538633903726788758";
  const ownerUserId = "234723725168082944";
  const codexThreadId = "01a00b9d-e72b-73f3-af6e-30760c2191c4";
  const codexLaunchUrl =
    `https://go.shagon1k.win/codex/threads/${codexThreadId}`;
  const parentMessages: JsonObject[] = [];
  const cardEdits: JsonObject[] = [];
  const threadControlCreates: JsonObject[] = [];
  const threadControlEdits: JsonObject[] = [];
  const threadEvents: JsonObject[] = [];
  const resourceGuardMessages: JsonObject[] = [];
  const threadMemberAdds: string[] = [];
  const threadPatches: JsonObject[] = [];
  const deletedThreadMessages: string[] = [];
  let latestDashboard: JsonObject | null = null;
  const currentDashboard = (): JsonObject => {
    assert(latestDashboard, "No current Discord dashboard was captured");
    return latestDashboard;
  };
  let threadExists = false;
  let nextThreadMessage = 2000;

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = request.url ?? "/";
      if (
        method === "POST" &&
        url === `/channels/${resourceGuardChannel}/messages`
      ) {
        resourceGuardMessages.push(await readJson(request));
        sendJson(response, 200, {
          id: "7001",
          channel_id: resourceGuardChannel,
        });
        return;
      }
      if (method === "POST" && url === `/channels/${parentChannel}/messages`) {
        parentMessages.push(await readJson(request));
        sendJson(response, 200, { id: "1001", channel_id: parentChannel });
        return;
      }
      if (method === "GET" && url === "/channels/1001") {
        if (!threadExists) {
          sendJson(response, 404, { message: "Unknown Channel" });
          return;
        }
        sendJson(response, 200, {
          id: "1001",
          type: 11,
          parent_id: parentChannel,
        });
        return;
      }
      if (
        method === "POST" &&
        url === `/channels/${parentChannel}/messages/1001/threads`
      ) {
        threadExists = true;
        sendJson(response, 200, {
          id: "1001",
          type: 11,
          parent_id: parentChannel,
        });
        return;
      }
      if (method === "PATCH" && url === "/channels/1001") {
        threadPatches.push(await readJson(request));
        sendJson(response, 200, { id: "1001", type: 11 });
        return;
      }
      if (
        method === "PUT" &&
        url === `/channels/1001/thread-members/${ownerUserId}`
      ) {
        threadMemberAdds.push(ownerUserId);
        response.writeHead(204);
        response.end();
        return;
      }
      if (
        method === "DELETE" &&
        /^\/channels\/1001\/messages\/\d+$/u.test(url)
      ) {
        deletedThreadMessages.push(url.split("/").at(-1)!);
        response.writeHead(204);
        response.end();
        return;
      }
      if (
        method === "PATCH" &&
        url === `/channels/${parentChannel}/messages/1001`
      ) {
        cardEdits.push(await readJson(request));
        sendJson(response, 200, { id: "1001", channel_id: parentChannel });
        return;
      }
      if (
        method === "PATCH" &&
        /^\/channels\/1001\/messages\/\d+$/u.test(url)
      ) {
        const payload = await readJson(request);
        threadControlEdits.push(payload);
        latestDashboard = payload;
        sendJson(response, 200, {
          id: url.split("/").at(-1),
          channel_id: "1001",
        });
        return;
      }
      if (method === "POST" && url === "/channels/1001/messages") {
        const payload = await readJson(request);
        if (componentText(payload).includes("-# Run ")) {
          threadControlCreates.push(payload);
          latestDashboard = payload;
        } else threadEvents.push(payload);
        nextThreadMessage += 1;
        sendJson(response, 200, {
          id: String(nextThreadMessage),
          channel_id: "1001",
        });
        return;
      }
      sendJson(response, 404, { message: `Unhandled ${method} ${url}` });
    } catch (error) {
      sendJson(response, 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  trace("server-listening");
  const address = server.address();
  assert(address && typeof address === "object", "Fake Discord server failed");
  const discordEnv = {
    DISCORD_API_BASE: `http://127.0.0.1:${address.port}`,
    DISCORD_BOT_TOKEN: "non-secret-test-token",
    DISCORD_ALLOWED_USERS: ownerUserId,
    HERMES_HOME: testHome,
  };

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
    const databasePath = resolve(testHome, "state/orchestrator.db");
    mkdirSync(resolve(testHome, "state"), { recursive: true, mode: 0o700 });
    const setup = new DatabaseSync(databasePath, { timeout: 5_000 });
    setup.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE schema_migrations (
        migration TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
      ) STRICT;
    `);
    const recordMigration = setup.prepare(
      "INSERT INTO schema_migrations (migration) VALUES (?)",
    );
    const migrationsDirectory = resolve(appDirectory, "migrations");
    for (const migration of readdirSync(migrationsDirectory)
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
      .sort()) {
      setup.exec("BEGIN IMMEDIATE");
      try {
        setup.exec(
          readFileSync(resolve(migrationsDirectory, migration), "utf8"),
        );
        recordMigration.run(migration);
        setup.exec("COMMIT");
      } catch (error) {
        setup.exec("ROLLBACK");
        throw error;
      }
    }
    setup.close();
    chmodSync(databasePath, 0o600);
    trace("database-ready");

    const database = new DatabaseSync(databasePath);
    database
      .prepare(
        `UPDATE discord_transport_settings SET activated_at = '2026-08-16T09:00:00.000Z' WHERE singleton = 1`,
      )
      .run();

    const insertEvent = database.prepare(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, from_status, to_status,
        payload_json, processing_state
      ) VALUES (?, ?, 'tailortales', ?, ?, 'Issue', 'Shagon1k/TailorTales',
                ?, ?, ?, 'Backlog', 'In progress',
                '{"issueState":"OPEN","labels":[],"hasDescription":true}',
                'processed')
    `);
    const insertRun = database.prepare(`
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode,
        created_at, updated_at
      ) VALUES (?, ?, 'tailortales', ?, ?, 'Shagon1k/TailorTales', ?,
                'autonomous', ?, ?, 'live', ?, ?)
    `);
    const insertResource = database.prepare(`
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name, codex_thread_id
      ) VALUES (?, 'provisioned', ?, ?, ?)
    `);
    const addRun = (
      runId: string,
      issue: number,
      createdAt: string,
      state = "running",
      owner = "cli",
      codexThreadId: string | null = null,
    ): void => {
      const eventId = `event-${issue}`;
      const itemId = `item-${issue}`;
      const contentId = `content-${issue}`;
      insertEvent.run(
        eventId,
        createdAt,
        itemId,
        contentId,
        issue,
        `[Test]: Discord control ${issue}`,
        `https://example.invalid/issues/${issue}`,
      );
      insertRun.run(
        runId,
        eventId,
        itemId,
        contentId,
        issue,
        state,
        owner,
        createdAt,
        createdAt,
      );
      insertResource.run(
        runId,
        `/tmp/worktrees/${issue}/TailorTales`,
        `TT-${issue}_discord-control`,
        codexThreadId,
      );
    };

    addRun("r_discord_smoke", 9401, "2026-08-16T09:10:00.000Z");
    database
      .prepare(
        `INSERT INTO run_progress_cards (
           run_id, stage, detail, content_digest, updated_at
         ) VALUES (?, 'working', 'Codex is implementing the issue.', 'digest-working', ?)`,
      )
      .run("r_discord_smoke", "2026-08-16T09:10:00.000Z");
    database
      .prepare(
        `INSERT INTO run_ci_snapshots (
           run_id, repository, pull_request_number, pull_request_url,
           pull_request_title, head_sha, aggregate_state, checks_json,
           content_digest, first_observed_at, last_observed_at, completed_at
         ) VALUES (
           ?, 'Shagon1k/TailorTales', 9401,
           'https://example.invalid/pulls/9401', 'CI pull 9401',
           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'failed',
           '[{"name":"Secret scan","state":"failed","source":"check_run","detailsUrl":"https://example.invalid/checks/9401"}]',
           'digest-ci-failed', '2026-08-16T09:10:00.000Z',
           '2026-08-16T09:11:00.000Z', '2026-08-16T09:11:00.000Z'
         )`,
      )
      .run("r_discord_smoke");
    database
      .prepare(
        `INSERT INTO run_control_events (
           event_id, run_id, event_kind, payload_json
         ) VALUES (
           'event-attention', ?, 'attention_required',
           '{"source":"ci","state":"failed","headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pullRequestUrl":"https://example.invalid/pulls/9401","checks":[{"name":"Secret scan","state":"failed","source":"check_run","detailsUrl":"https://example.invalid/checks/9401"}]}'
         )`,
      )
      .run("r_discord_smoke");
    database.close();

    const notifier = resolve(
      appDirectory,
      "src/orchestrator/controls/discord.ts",
    );
    const control = resolve(appDirectory, "src/orchestrator/controls/run.ts");
    const first = await runNode(notifier, ["--apply"], testHome, discordEnv);
    trace("first-sync-complete");
    assert(first.ok === true, "Initial Discord reconciliation failed");
    assert(parentMessages.length === 1, "Ticket starter card was duplicated");
    assert(
      parentMessages[0]!.flags === 32768 &&
        !Object.hasOwn(parentMessages[0]!, "content") &&
        !Object.hasOwn(parentMessages[0]!, "embeds") &&
        componentText(parentMessages[0]!).includes(
          "The current dashboard is the latest bot message",
        ),
      "Ticket starter is not a compact Components V2 thread header",
    );
    assert(threadExists, "Ticket thread was not created from the starter card");
    assert(cardEdits.length === 1, "Live card was not reconciled exactly once");
    assert(threadMemberAdds.length === 1, "Owner was not added to the thread");
    assert(
      threadControlCreates.length === 2,
      "Current dashboard was not recreated below the delivered event",
    );
    assert(
      threadEvents.length === 1,
      "Durable attention event was not delivered",
    );
    assert(
      customIds(cardEdits[0]!).length === 0,
      "Starter card retained thread-inert custom controls",
    );
    const firstCurrentDashboard = threadControlCreates.at(-1)!;
    assert(
      firstCurrentDashboard.flags === 32768 &&
        !Object.hasOwn(firstCurrentDashboard, "content") &&
        !Object.hasOwn(firstCurrentDashboard, "embeds"),
      "Run dashboard is not a pure Components V2 message",
    );
    const firstControls = customIds(firstCurrentDashboard);
    assert(
      firstControls.includes("kurami:stop:r_discord_smoke") &&
        !firstControls.includes("kurami:status:r_discord_smoke") &&
        !firstControls.includes("kurami:take_control:r_discord_smoke") &&
        !firstControls.includes("kurami:preview_start:r_discord_smoke"),
      "Live card has the wrong native control set",
    );
    const firstLabels = componentLabels(firstCurrentDashboard);
    assert(
      firstLabels.includes("Cancel run") &&
        !firstLabels.includes("Take control") &&
        !firstLabels.includes("Start preview") &&
        !firstLabels.includes("Stop"),
      "Active controls have the wrong contextual labels",
    );
    assert(
      deletedThreadMessages.includes("2001") &&
        !componentLabels(threadEvents[0]!).includes("Open controls"),
      "Delivered event did not rotate the unpinned dashboard safely",
    );
    assert(
      componentText(threadEvents[0]!).includes("CI failed") &&
        componentText(threadEvents[0]!).includes("Secret scan"),
      "CI attention event did not explain the failing check",
    );
    assert(
      componentText(firstCurrentDashboard).includes(
        "Run r_discord_sm · Updated 16.08.26 12:10",
      ) &&
        componentText(firstCurrentDashboard).includes("Control** · AI Agent") &&
        !componentText(firstCurrentDashboard).includes("Owner       Released"),
      "Dashboard footer is unstable or autonomous ownership is mislabeled",
    );
    assert(
      componentText(firstCurrentDashboard).includes("Failed") &&
        componentText(firstCurrentDashboard).includes("Secret scan"),
      "Live card omitted the normalized CI snapshot",
    );

    const state = new DatabaseSync(databasePath);
    const surface = state
      .prepare(
        `SELECT state, live_card_message_id, thread_id, control_message_id,
                owner_user_id, attempt_count
         FROM run_discord_surfaces WHERE run_id = ?`,
      )
      .get("r_discord_smoke") as {
      state: string;
      live_card_message_id: string;
      thread_id: string;
      control_message_id: string;
      owner_user_id: string;
      attempt_count: number;
    };
    assert(
      surface.state === "active" &&
        surface.live_card_message_id === "1001" &&
        surface.thread_id === "1001" &&
        surface.control_message_id === "2003" &&
        surface.owner_user_id === ownerUserId &&
        surface.attempt_count === 0,
      "Discord surface identity was not durably finalized",
    );
    const attentionDelivery = state
      .prepare(
        `SELECT delivery_state FROM run_discord_event_deliveries WHERE event_id = 'event-attention'`,
      )
      .get() as { delivery_state: string };
    assert(
      attentionDelivery.delivery_state === "delivered",
      "Discord event delivery was not finalized",
    );
    state.close();

    const prePull = new DatabaseSync(databasePath);
    prePull.exec(`
      UPDATE run_progress_cards
      SET stage='starting', detail='Starting Codex.',
          content_digest='digest-starting-without-pr'
      WHERE run_id='r_discord_smoke';
      UPDATE run_ci_snapshots
      SET pull_request_number=NULL, pull_request_url=NULL,
          pull_request_title=NULL, head_sha=NULL,
          aggregate_state='pending', checks_json='[]',
          content_digest='digest-ci-before-pr', completed_at=NULL
      WHERE run_id='r_discord_smoke';
    `);
    prePull.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const prePullText = componentText(currentDashboard());
    assert(
      !prePullText.includes("**CI**"),
      "CI noise was shown before the managed pull request existed",
    );
    const waitingGithub = new DatabaseSync(databasePath);
    waitingGithub
      .prepare(
        `UPDATE run_progress_cards
         SET stage='waiting_github',
             detail='GitHub Project is temporarily unavailable; waiting for a fresh status snapshot before starting Codex.',
             content_digest='digest-waiting-github'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    waitingGithub.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    assert(
      componentText(currentDashboard()).includes("Waiting for GitHub"),
      "The GitHub discovery wait was not presented clearly on the live card",
    );
    const restorePull = new DatabaseSync(databasePath);
    restorePull.exec(`
      UPDATE run_progress_cards
      SET stage='working', detail='Codex is implementing the issue.',
          content_digest='digest-working-restored'
      WHERE run_id='r_discord_smoke';
      UPDATE run_ci_snapshots
      SET pull_request_number=9401,
          pull_request_url='https://example.invalid/pulls/9401',
          pull_request_title='CI pull 9401',
          head_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          aggregate_state='failed',
          checks_json='[{"name":"Secret scan","state":"failed","source":"check_run","detailsUrl":"https://example.invalid/checks/9401"}]',
          content_digest='digest-ci-failed-restored',
          completed_at='2026-08-16T09:11:00.000Z'
      WHERE run_id='r_discord_smoke';
    `);
    restorePull.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);

    await runNode(notifier, ["--apply"], testHome, discordEnv);
    trace("idempotent-sync-complete");
    assert(
      parentMessages.length === 1,
      "Idempotent sync recreated the ticket card",
    );
    assert(
      threadControlCreates.length === 2,
      "Idempotent sync recreated controls",
    );
    assert(threadEvents.length === 1, "Idempotent sync redelivered an event");
    assert(threadMemberAdds.length === 1, "Idempotent sync re-added the owner");

    const threadReady = new DatabaseSync(databasePath);
    threadReady
      .prepare(
        `UPDATE run_resources SET codex_thread_id=?
         WHERE run_id='r_discord_smoke'`,
      )
      .run(codexThreadId);
    threadReady.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const readyControls = customIds(currentDashboard());
    assert(
      readyControls.includes("kurami:take_control:r_discord_smoke") &&
        !readyControls.includes("kurami:preview_start:r_discord_smoke"),
      "Thread readiness did not reconcile controls without a card-stage change",
    );
    const stableReadinessEditCount = threadControlEdits.length;
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    assert(
      threadControlEdits.length === stableReadinessEditCount,
      "Stable thread readiness caused repeated card edits",
    );

    const attentionState = new DatabaseSync(databasePath);
    attentionState.exec(`
      UPDATE runs SET state='needs_attention', owner_state='cli'
      WHERE run_id='r_discord_smoke';
      UPDATE run_progress_cards
      SET stage='needs_attention', detail='The run needs attention before it can continue.',
          content_digest='digest-needs-attention',
          updated_at='2026-08-16T09:12:00.000Z'
      WHERE run_id='r_discord_smoke';
    `);
    attentionState.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const attentionControls = customIds(currentDashboard());
    assert(
      !attentionControls.includes("kurami:take_control:r_discord_smoke"),
      "Needs-attention run exposed a takeover action the controller will reject",
    );

    const repairReady = new DatabaseSync(databasePath);
    repairReady.exec(`
      UPDATE runs SET state='parked_review', owner_state='none'
      WHERE run_id='r_discord_smoke';
      UPDATE run_progress_cards
      SET stage='review_ready', detail='Ready for review.',
          content_digest='digest-repair-ready',
          updated_at='2026-08-16T09:12:30.000Z'
      WHERE run_id='r_discord_smoke';
    `);
    repairReady.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const repairControls = customIds(currentDashboard());
    assert(
      repairControls.includes("kurami:ci_repair:r_discord_smoke") &&
        repairControls.includes("kurami:ai_review:r_discord_smoke") &&
        componentLabels(currentDashboard()).includes("Attempt CI fix"),
      "Stable PR did not expose independent CI repair and AI review actions",
    );
    const reviewQueued = new DatabaseSync(databasePath);
    reviewQueued.exec(`
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via,
        idempotency_key
      ) VALUES (
        'rq_discord_review', 'r_discord_smoke', 'ai_review', 'pending',
        'discord', 'test:discord-review'
      );
    `);
    reviewQueued.close();
    await runNode(notifier, ["show", "--run-id", "r_discord_smoke", "--apply"], testHome, discordEnv);
    assert(
      componentText(currentDashboard()).includes("AI Review queued") &&
        !customIds(currentDashboard()).includes(
          "kurami:ai_review:r_discord_smoke",
        ),
      "Queued AI review did not immediately hide its duplicate action",
    );
    const reviewRunning = new DatabaseSync(databasePath);
    reviewRunning.exec(`
      UPDATE run_control_requests
      SET request_state='applied',
          completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE request_id='rq_discord_review';
      INSERT INTO run_ai_reviews (
        review_id, run_id, request_id, review_number, review_state,
        repository, pull_request_number, pull_request_url, base_ref,
        base_sha, head_sha, tmux_session_name
      ) VALUES (
        'air_discord_review', 'r_discord_smoke', 'rq_discord_review', 1,
        'running', 'Shagon1k/TailorTales', 9401,
        'https://example.invalid/pulls/9401', 'main',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'rv-tt-9401-test-1'
      );
    `);
    reviewRunning.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const reviewingCard = currentDashboard();
    assert(
      componentText(reviewingCard).includes("**AI review**") &&
        componentText(reviewingCard).includes("Reviewing PR") &&
        !customIds(currentDashboard()).includes(
          "kurami:ai_review:r_discord_smoke",
        ),
      "Running AI review was not composed independently into the live card",
    );
    const reviewReady = new DatabaseSync(databasePath);
    reviewReady.exec(`
      UPDATE run_ai_reviews
      SET review_state='ready', critical_count=1, important_count=2,
          suggestion_count=3,
          github_review_url='https://example.invalid/pulls/9401#pullrequestreview-1',
          completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE review_id='air_discord_review';
    `);
    reviewReady.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const reviewedCard = currentDashboard();
    const reviewedText = componentText(reviewedCard);
    const reviewedSummary = nestedComponents(reviewedCard)
      .filter((component) => component.type === 10)
      .map((component) => String(component.content ?? ""))
      .find(
        (content) => content.includes("```text") && content.includes("AI review"),
      );
    assert(
      reviewedText.includes("AI Review Ready") &&
        customIds(currentDashboard()).includes(
          "kurami:review_fix:r_discord_smoke",
        ) &&
        reviewedText.includes(
          "1 Critical · 2 Important · 3 Suggestions",
        ) &&
        reviewedText.includes(
          "✅ **Ready** · [Open review](https://example.invalid/pulls/9401#pullrequestreview-1)",
        ) &&
        (reviewedSummary ?? "").includes("✅ Ready") &&
        !(reviewedSummary ?? "").includes("Open review") &&
        !reviewedText.includes("[✅ Ready]") &&
        !reviewedText.includes("**[Open review]"),
      "Ready AI review did not expose aggregate findings without Discord chatter",
    );
    const fixQueued = new DatabaseSync(databasePath);
    fixQueued.exec(`
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via,
        idempotency_key
      ) VALUES (
        'rq_discord_review_fix', 'r_discord_smoke', 'review_fix', 'pending',
        'discord', 'test:discord-review-fix'
      );
    `);
    fixQueued.close();
    await runNode(notifier, ["show", "--run-id", "r_discord_smoke", "--apply"], testHome, discordEnv);
    assert(
      componentText(currentDashboard()).includes("Review fix queued") &&
        !customIds(currentDashboard()).includes(
          "kurami:review_fix:r_discord_smoke",
        ) &&
        !componentLabels(currentDashboard()).includes("Start preview"),
      "Queued review fix did not hide conflicting controls",
    );
    const activeFix = new DatabaseSync(databasePath);
    activeFix.exec(`
      UPDATE run_control_requests
      SET request_state='applied',
          completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE request_id='rq_discord_review_fix';
      INSERT INTO run_review_fix_rounds (
        round_id, run_id, request_id, round_number, round_state,
        repository, pull_request_number, pull_request_url,
        source_head_sha, snapshot_json, result_head_sha
      ) VALUES (
        'rfr_discord123', 'r_discord_smoke', 'rq_discord_review_fix', 1,
        'waiting_ci', 'Shagon1k/TailorTales', 9401,
        'https://example.invalid/pulls/9401',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '[]',
        'cccccccccccccccccccccccccccccccccccccccc'
      );
    `);
    activeFix.close();
    const newerHead = new DatabaseSync(databasePath);
    newerHead.exec(`
      UPDATE run_ci_snapshots
      SET head_sha='cccccccccccccccccccccccccccccccccccccccc',
          aggregate_state='pending', completed_at=NULL,
          content_digest='digest-new-head',
          last_observed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id='r_discord_smoke';
    `);
    newerHead.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const validatingCard = currentDashboard();
    assert(
      componentText(validatingCard).includes(
        "Review fixes are still being validated",
      ) &&
        !componentLabels(currentDashboard()).includes("Start preview") &&
        !customIds(currentDashboard()).includes(
          "kurami:ai_review:r_discord_smoke",
        ),
      "Active review fix exposed conflicting controls or misleading outdated text",
    );
    const clearFix = new DatabaseSync(databasePath);
    clearFix.exec(`
      DELETE FROM run_review_fix_rounds WHERE round_id='rfr_discord123';
      DELETE FROM run_control_requests WHERE request_id='rq_discord_review_fix';
    `);
    clearFix.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const outdatedCard = currentDashboard();
    assert(
      !componentText(outdatedCard).includes("AI Review Ready") &&
        componentText(outdatedCard).includes("Outdated") &&
        customIds(currentDashboard()).includes(
          "kurami:ai_review:r_discord_smoke",
        ),
      "A review for an older SHA was not marked outdated and made repeatable",
    );
    const retryAfterFailure = new DatabaseSync(databasePath);
    retryAfterFailure.exec(`
      UPDATE run_ai_reviews
      SET review_state='failed', failure_reason='Previous review timed out'
      WHERE review_id='air_discord_review';
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via,
        idempotency_key
      ) VALUES (
        'rq_discord_review_retry', 'r_discord_smoke', 'ai_review', 'pending',
        'discord', 'test:discord-review-retry'
      );
    `);
    retryAfterFailure.close();
    await runNode(notifier, ["show", "--run-id", "r_discord_smoke", "--apply"], testHome, discordEnv);
    const queuedRetryCard = currentDashboard();
    assert(
      componentText(queuedRetryCard).includes("AI Review queued") &&
        !componentText(queuedRetryCard).includes("**AI review**"),
      "Queued retry kept the previous failed AI review in the live card",
    );
    const clearReview = new DatabaseSync(databasePath);
    clearReview.exec(`
      DELETE FROM run_ai_reviews WHERE review_id='air_discord_review';
      DELETE FROM run_control_requests
      WHERE request_id IN ('rq_discord_review', 'rq_discord_review_retry');
      UPDATE run_ci_snapshots
      SET head_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          aggregate_state='failed',
          content_digest='digest-ci-failed-restored',
          completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id='r_discord_smoke';
    `);
    clearReview.close();
    const repairWaiting = new DatabaseSync(databasePath);
    repairWaiting.exec(`
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via,
        idempotency_key, completed_at
      ) VALUES (
        'rq_discord_waiting', 'r_discord_smoke', 'ci_repair', 'applied',
        'discord', 'test:discord-waiting',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
      INSERT INTO run_ci_repair_attempts (
        attempt_id, run_id, request_id, attempt_number, source_head_sha,
        source_ci_state, source_checks_json, attempt_state
      ) VALUES (
        'cra_discord_waiting', 'r_discord_smoke', 'rq_discord_waiting', 1,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'failed',
        '[{"name":"Secret scan","state":"failed","source":"check_run","detailsUrl":"https://example.invalid/checks/9401"}]',
        'waiting_ci'
      );
      UPDATE run_progress_cards
      SET stage='ci_repair_waiting',
          detail='Fix attempt 1/2 was pushed. Waiting for checks to start.',
          content_digest='digest-repair-waiting',
          updated_at='2026-08-16T09:12:45.000Z'
      WHERE run_id='r_discord_smoke';
    `);
    repairWaiting.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const waitingControls = currentDashboard();
    const waitingText = componentText(waitingControls);
    assert(
      waitingText.includes("Waiting for CI") &&
        !componentLabels(waitingControls).includes("Take control") &&
        !componentLabels(waitingControls).includes("Continue in Codex") &&
        !componentLabels(waitingControls).includes("Attempt CI fix") &&
        waitingText.includes("Waiting for checks") &&
        waitingText.includes("Previous failure") &&
        !waitingText.includes("❌ Failed"),
      "CI repair waiting state mixed old failure data with new-check status",
    );
    const clearRepairWaiting = new DatabaseSync(databasePath);
    clearRepairWaiting.exec(`
      DELETE FROM run_ci_repair_attempts
      WHERE attempt_id='cra_discord_waiting';
      DELETE FROM run_control_requests
      WHERE request_id='rq_discord_waiting';
    `);
    clearRepairWaiting.close();
    const repairBusy = new DatabaseSync(databasePath);
    repairBusy.exec(`
      UPDATE runs SET state='running', owner_state='cli'
      WHERE run_id='r_discord_smoke';
      UPDATE run_progress_cards
      SET stage='working', detail='Codex is implementing the issue.',
          content_digest='digest-working-restored'
      WHERE run_id='r_discord_smoke';
    `);
    repairBusy.close();

    const handoffPending = new DatabaseSync(databasePath);
    handoffPending
      .prepare(
        `UPDATE run_progress_cards
         SET stage='handoff_pending',
             detail='Take control requested; safely interrupting the active Codex turn and preparing handoff.',
             content_digest='digest-handoff-pending',
             updated_at='2026-08-16T09:13:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    handoffPending.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const pendingControls = currentDashboard();
    assert(
      componentText(pendingControls).includes("Preparing human control") &&
        componentText(pendingControls).includes("Control** · Handoff pending") &&
        !componentLabels(pendingControls).includes("Take control") &&
        componentLabels(pendingControls).includes("Cancel run"),
      "Pending takeover did not replace the active Take control button",
    );

    const workingAgain = new DatabaseSync(databasePath);
    workingAgain
      .prepare(
        `UPDATE run_progress_cards
         SET stage='working',
             detail='Codex is working autonomously in the isolated worktree.',
             content_digest='digest-working-restored',
             updated_at='2026-08-16T09:14:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    workingAgain.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const readinessEditCount = threadControlEdits.length;
    const readinessCreateCount = threadControlCreates.length;
    const readinessDeleteCount = deletedThreadMessages.length;

    await runNode(
      notifier,
      ["show", "--thread-id", "1001", "--apply"],
      testHome,
      discordEnv,
    );
    trace("show-controls-complete");
    assert(
      threadControlCreates.length === readinessCreateCount + 1 &&
        threadControlEdits.length === readinessEditCount &&
        deletedThreadMessages.length === readinessDeleteCount + 1,
      "Show controls did not move the current dashboard safely",
    );
    assert(
      customIds(currentDashboard()).includes("kurami:stop:r_discord_smoke") &&
        !customIds(currentDashboard()).includes(
          "kurami:status:r_discord_smoke",
        ),
      "Fresh control surface did not contain native controls",
    );

    const parked = new DatabaseSync(databasePath);
    parked
      .prepare(
        `UPDATE runs
         SET state='parked_review', owner_state='none',
             updated_at='2026-08-16T09:15:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    parked
      .prepare(
        `UPDATE run_progress_cards
         SET stage='review_ready',
             detail='Autonomous work is parked and ready for review.',
             content_digest='digest-review',
             updated_at='2026-08-16T09:15:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    parked.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const parkedLabels = componentLabels(currentDashboard());
    assert(
      parkedLabels.includes("Continue in Codex") &&
        parkedLabels.includes("Start preview") &&
        !parkedLabels.includes("Take control"),
      "Parked review did not switch to Continue in Codex",
    );

    const remote = new DatabaseSync(databasePath);
    remote
      .prepare(
        `UPDATE runs
         SET state='remote_owned', owner_state='remote',
             updated_at='2026-08-16T09:17:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    remote
      .prepare(
        `UPDATE run_progress_cards
         SET stage='human_control',
             detail='The existing Codex task is under human control.',
             content_digest='digest-human-control',
             updated_at='2026-08-16T09:17:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    remote
      .prepare(
        `INSERT INTO run_control_events (
           event_id, run_id, event_kind, payload_json
         ) VALUES ('event-human-control', 'r_discord_smoke',
                   'human_control_ready', '{}')`,
      )
      .run();
    remote.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const remoteControls = currentDashboard();
    assert(
      componentLabels(remoteControls).includes("Continue autonomously") &&
        componentLabels(remoteControls).includes("Start preview") &&
        componentText(remoteControls).includes("Control** · You") &&
        !componentText(remoteControls).includes("Control** · AI Agent") &&
        componentText(remoteControls).includes(`[Codex](${codexLaunchUrl})`) &&
        customIds(remoteControls).includes(
          "kurami:take_control:r_discord_smoke",
        ),
      "Remote ownership did not expose the Codex launcher, autonomous continuation, and preview controls",
    );
    const handoffValue = componentText(remoteControls);
    assert(
      handoffValue.includes("[TT-9401]: Discord control 9401") &&
        handoffValue.includes("shagserv / TailorTales") &&
        handoffValue.includes(codexThreadId) &&
        handoffValue.includes("managed CLI/tmux no longer owns this task"),
      "Remote card omitted the task, connection, thread fallback, or ownership note",
    );
    const successorPending = new DatabaseSync(databasePath);
    successorPending
      .prepare(
        `UPDATE run_progress_cards
         SET stage='autonomous_successor_pending',
             detail='Autonomous continuation requested; starting a fresh managed Codex task after the owner boundary.',
             content_digest='digest-autonomous-successor-pending',
             updated_at='2026-08-16T09:17:30.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    successorPending.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const successorPendingControls = currentDashboard();
    assert(
      componentText(successorPendingControls).includes(
        "Starting autonomous continuation",
      ) &&
        !componentLabels(successorPendingControls).includes(
          "Continue autonomously",
        ) &&
        !componentLabels(successorPendingControls).includes(
          "Continue in Codex",
        ) &&
        componentLabels(successorPendingControls).includes("Cancel run"),
      "Queued autonomous continuation kept a conflicting continuation control visible",
    );
    const humanEvent = threadEvents.at(-1)!;
    assert(
      componentText(humanEvent).includes("Preparation is ready for you") &&
        componentText(humanEvent).includes(`[Open in Codex](${codexLaunchUrl})`),
      "Human-control event did not include the Codex launcher",
    );

    const restoreReview = new DatabaseSync(databasePath);
    restoreReview
      .prepare(
        `UPDATE runs
         SET state='parked_review', owner_state='none',
             updated_at='2026-08-16T09:18:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    restoreReview
      .prepare(
        `UPDATE run_progress_cards
         SET stage='review_ready',
             detail='Autonomous work is parked and ready for review.',
             content_digest='digest-review-restored',
             updated_at='2026-08-16T09:18:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    restoreReview.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);

    const preview = new DatabaseSync(databasePath);
    preview
      .prepare(
        `INSERT INTO preview_leases (
           lease_id, run_id, slot_number, state, compose_project_name, expires_at,
           runtime_adapter, artifact_root, artifact_digest,
           artifact_file_count, artifact_total_bytes
         ) VALUES (
           'lease-discord', 'r_discord_smoke', 1, 'running', 'discord-smoke',
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'),
           'static', '/tmp/discord-static-artifact',
           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
           1, 866
         )`,
      )
      .run();
    preview
      .prepare(
        `UPDATE run_progress_cards
         SET stage='preview_ready',
             detail='Preview expires soon. Extend it or it will be removed automatically.',
             content_digest='digest-preview', updated_at='2026-08-16T09:20:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    preview
      .prepare(
        `INSERT INTO run_control_events (
           event_id, run_id, event_kind, payload_json
         ) VALUES ('event-preview', 'r_discord_smoke', 'preview_ready', '{}')`,
      )
      .run();
    preview.close();

    await runNode(notifier, ["--apply"], testHome, discordEnv);
    trace("preview-sync-complete");
    assert(
      componentText(threadEvents.at(-1)!).includes("Preview is ready"),
      "Preview-ready notification was not delivered to the ticket thread",
    );
    assert(
      !componentLabels(threadEvents.at(-1)!).includes("Open controls"),
      "Preview-ready timeline event retained a stale control link",
    );
    assert(
      customIds(currentDashboard()).includes(
        "kurami:preview_stop:r_discord_smoke",
      ),
      "Live card did not switch to Stop preview",
    );
    const previewLabels = componentLabels(currentDashboard());
    assert(
      previewLabels.includes("Remove preview") &&
        componentText(currentDashboard()).includes("[Preview](https://") &&
        !previewLabels.includes("Open artifact") &&
        !previewLabels.includes("Remove artifact"),
      "Static preview exposed adapter-specific owner-facing controls",
    );
    assert(
      customIds(currentDashboard()).includes(
        "kurami:run_actions:r_discord_smoke",
      ) && previewLabels.includes("Cancel run"),
      "Dashboard overflow did not preserve lower-priority contextual actions",
    );
    assert(
      customIds(currentDashboard()).includes(
        "kurami:preview_extend:r_discord_smoke",
      ),
      "Expiring preview did not expose the bounded extension control",
    );
    assert(
      customIds(currentDashboard()).includes(
        "kurami:preview_reviewed:r_discord_smoke",
      ),
      "Unreviewed preview did not expose owner acknowledgement",
    );
    const unreviewedText = componentText(currentDashboard());
    assert(
      unreviewedText.includes("Not reviewed"),
      "Live card did not identify the unreviewed preview",
    );
    assert(
      unreviewedText.includes("Runtime: Static artifact"),
      "Live card did not keep the static runtime type in preview details",
    );
    const acknowledged = new DatabaseSync(databasePath);
    acknowledged
      .prepare(`
        UPDATE preview_leases
        SET reviewed_at='2026-08-16T09:21:00.000Z',
            reviewed_by='discord:424242', reviewed_via='discord'
        WHERE lease_id='lease-discord'
      `)
      .run();
    acknowledged.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    assert(
      !customIds(currentDashboard()).includes(
        "kurami:preview_reviewed:r_discord_smoke",
      ),
      "Reviewed preview retained the acknowledgement button",
    );
    const reviewedPreviewText = componentText(currentDashboard());
    assert(
      reviewedPreviewText.includes("Reviewed artifact `aaaaaaaaaaaa`"),
      "Live card did not show the preview acknowledgement",
    );
    const previewPolicy = new DatabaseSync(databasePath);
    previewPolicy.exec(`
      UPDATE runs
      SET preview_required=1,
          preview_required_label='preview-required',
          completion_requested_at='2026-08-16T09:22:00.000Z',
          completion_source_event_id='event-9401'
      WHERE run_id='r_discord_smoke';
      UPDATE preview_leases
      SET verified_head_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      WHERE lease_id='lease-discord';
      UPDATE run_progress_cards
      SET stage='preview_required',
          detail='Preview was reviewed for the exact current PR SHA; completion will resume automatically.',
          content_digest='digest-preview-required',
          updated_at='2026-08-16T09:22:00.000Z'
      WHERE run_id='r_discord_smoke';
    `);
    previewPolicy.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const policyCard = currentDashboard();
    const policyText = componentText(policyCard);
    assert(
      policyText.includes("Preview required") &&
        policyText.includes("**Preview policy**") &&
        policyText.includes("completion paused") &&
        policyText.includes("SHA `aaaaaaa`"),
      "Preview-required policy was not explained on the live card",
    );
    const stalePreview = new DatabaseSync(databasePath);
    stalePreview
      .prepare(`
        UPDATE run_ci_snapshots
        SET head_sha='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            content_digest='digest-preview-new-head',
            last_observed_at='2026-08-16T09:23:00.000Z'
        WHERE run_id='r_discord_smoke'
      `)
      .run();
    stalePreview.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const stalePreviewValue = componentText(currentDashboard());
    assert(
      stalePreviewValue.includes("Outdated") &&
        stalePreviewValue.includes("reviewed for SHA `aaaaaaa`") &&
        stalePreviewValue.includes("Current PR SHA `bbbbbbb`") &&
        !stalePreviewValue.includes("✅ Reviewed for SHA `aaaaaaa`"),
      "Stale preview acknowledgement was still presented as current",
    );
    const stableParentCount = parentMessages.length;
    const stableControlCount = threadControlCreates.length;
    const stableEventCount = threadEvents.length;
    const stableControlEditCount = threadControlEdits.length;
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    assert(
      parentMessages.length === stableParentCount &&
        threadControlCreates.length === stableControlCount &&
        threadEvents.length === stableEventCount &&
        threadControlEdits.length === stableControlEditCount,
      "Stable reconciliation produced duplicate Discord messages",
    );

    const resourceGuardState = new DatabaseSync(databasePath);
    resourceGuardState.exec(`
      INSERT INTO resource_quarantines (
        quarantine_id, resource_type, resource_key, project, run_id,
        quarantine_state, reason, evidence_json,
        first_observed_at, last_observed_at
      ) VALUES (
        'rq_discord_smoke', 'worktree', '/tmp/worktrees/orphan-smoke',
        'tailortales', NULL, 'observed', 'unmapped_worktree_directory',
        '{"path":"/tmp/worktrees/orphan-smoke"}',
        '2026-08-16T09:24:00.000Z', '2026-08-16T09:24:00.000Z'
      );
      INSERT INTO resource_guard_events (
        event_id, quarantine_id, lifecycle_started_at, event_kind,
        resource_type, resource_key, project, run_id, reason, event_at
      ) VALUES (
        'rge_discord_smoke', 'rq_discord_smoke',
        '2026-08-16T09:24:00.000Z', 'observed', 'worktree',
        '/tmp/worktrees/orphan-smoke', 'tailortales', NULL,
        'unmapped_worktree_directory', '2026-08-16T09:24:00.000Z'
      );
    `);
    resourceGuardState.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    assert(
      resourceGuardMessages.length === 1 &&
        String(resourceGuardMessages[0]!.content).includes(
          "Kurami Resource Guard",
        ) &&
        String(resourceGuardMessages[0]!.content).includes("Observed") &&
        resourceGuardMessages[0]!.enforce_nonce === true,
      "Resource Guard event did not use the existing Discord notifier path",
    );
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    assert(
      resourceGuardMessages.length === 1,
      "Resource Guard notifier duplicated a delivered transition",
    );

    const selected = await runNode(
      control,
      ["controls", "--project", "tailortales", "--issue", "9401"],
      testHome,
    );
    assert(
      selected.run_id === "r_discord_smoke" &&
        Array.isArray(selected.available_actions),
      "Deterministic controls lookup did not resolve the exact run",
    );
    await runNode(
      control,
      [
        "request",
        "--run-id",
        "r_discord_smoke",
        "--action",
        "stop",
        "--via",
        "discord",
        "--apply",
      ],
      testHome,
    );
    const requestCheck = new DatabaseSync(databasePath);
    const requestSource = requestCheck
      .prepare(
        `SELECT requested_via FROM run_control_requests
         WHERE run_id='r_discord_smoke' AND action='stop'`,
      )
      .get() as { requested_via: string };
    assert(
      requestSource.requested_via === "discord",
      "Discord request source was lost",
    );
    requestCheck
      .prepare(`
        UPDATE runs
        SET preview_required=0, preview_required_label=NULL,
            completion_requested_at=NULL, completion_source_event_id=NULL
        WHERE run_id='r_discord_smoke'
      `)
      .run();

    // The remainder of this regression exercises unpublished cancellation.
    // Remove the earlier synthetic CI/PR fixture so it does not turn that
    // separate scenario into published-work cancellation.
    requestCheck
      .prepare(`DELETE FROM run_ci_snapshots WHERE run_id='r_discord_smoke'`)
      .run();
    requestCheck
      .prepare(
        `UPDATE run_discord_surfaces
         SET pull_request_url=NULL, pull_request_title=NULL, content_digest=NULL
         WHERE run_id='r_discord_smoke'`,
      )
      .run();

    requestCheck
      .prepare(
        `UPDATE preview_leases
         SET state='released', released_at='2026-08-16T09:25:00.000Z'
         WHERE run_id='r_discord_smoke' AND state='running'`,
      )
      .run();
    requestCheck
      .prepare(
        `UPDATE runs
         SET state='needs_attention', owner_state='none', stop_reason='cancelled',
             updated_at='2026-08-16T09:25:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    requestCheck
      .prepare(
        `UPDATE run_progress_cards
         SET stage='cancelled_work_preserved',
             detail='Cancellation stopped automation; unpublished local work is preserved.',
             content_digest='digest-cancelled-work-preserved',
             updated_at='2026-08-16T09:25:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    requestCheck.close();

    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const preservedControls = customIds(currentDashboard());
    const preservedLabels = componentLabels(currentDashboard());
    assert(
      preservedControls.includes("kurami:discard_prompt:r_discord_smoke") &&
        preservedLabels.includes("Discard local work") &&
        !preservedControls.includes("kurami:stop:r_discord_smoke") &&
        !preservedControls.includes("kurami:preview_start:r_discord_smoke") &&
        !preservedControls.includes("kurami:take_control:r_discord_smoke"),
      "Preserved cancellation did not expose only the guarded discard action",
    );

    const publishedCancellation = new DatabaseSync(databasePath);
    publishedCancellation
      .prepare(
        `UPDATE run_discord_surfaces
         SET pull_request_url='https://example.invalid/pulls/9401',
             pull_request_title='Published cancellation'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    publishedCancellation
      .prepare(
        `UPDATE run_progress_cards
         SET content_digest='digest-cancelled-published',
             updated_at='2026-08-16T09:25:30.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    publishedCancellation.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const publishedControls = currentDashboard();
    const publishedText = componentText(publishedControls);
    assert(
      publishedText.includes(
        "Cancelled — published work preserved",
      ) &&
        publishedText.includes("[PR") &&
        componentLabels(publishedControls).includes(
          "Close draft PR & discard",
        ) &&
        !componentLabels(publishedControls).includes("Discard local work") &&
        !componentLabels(publishedControls).includes("Cancel run") &&
        customIds(publishedControls).includes(
          "kurami:discard_published_prompt:r_discord_smoke",
        ) &&
        !customIds(publishedControls).includes(
          "kurami:discard_prompt:r_discord_smoke",
        ) &&
        !customIds(publishedControls).includes(
          "kurami:stop:r_discord_smoke",
        ) &&
        publishedText.includes(
          "published branch and pull request were preserved",
        ),
      "Published cancellation still offered an impossible local discard",
    );

    const requestRestore = new DatabaseSync(databasePath);
    requestRestore
      .prepare(
        `UPDATE runs
         SET state='parked_review', owner_state='none', stop_reason=NULL,
             updated_at='2026-08-16T09:26:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    requestRestore
      .prepare(
        `UPDATE run_progress_cards
         SET stage='review_ready',
             detail='Autonomous work is parked and ready for review.',
             content_digest='digest-review-after-preserved',
             updated_at='2026-08-16T09:26:00.000Z'
         WHERE run_id='r_discord_smoke'`,
      )
      .run();
    requestRestore.close();

    const secondEvent = `event-9402`;
    const ambiguityState = new DatabaseSync(databasePath);
    ambiguityState
      .prepare(
        `INSERT INTO project_events (
           event_id, observed_at, project, item_id, content_id, content_type,
           repository, issue_number, title, url, from_status, to_status,
           payload_json, processing_state
         ) VALUES (?, '2026-08-16T09:30:00.000Z', 'tailortales', 'item-9402',
                   'content-9402', 'Issue', 'Shagon1k/TailorTales', 9402,
                   '[Test]: Ambiguous run', 'https://example.invalid/issues/9402',
                   'Backlog', 'In progress',
                   '{"issueState":"OPEN","labels":[],"hasDescription":true}', 'processed')`,
      )
      .run(secondEvent);
    ambiguityState
      .prepare(
        `INSERT INTO runs (
           run_id, trigger_event_id, project, item_id, content_id, repository,
           issue_number, interaction_policy, state, owner_state, execution_mode,
           created_at, updated_at
         ) VALUES ('r_discord_second', ?, 'tailortales', 'item-9402', 'content-9402',
                   'Shagon1k/TailorTales', 9402, 'autonomous', 'running', 'cli',
                   'live', '2026-08-16T09:30:00.000Z', '2026-08-16T09:30:00.000Z')`,
      )
      .run(secondEvent);
    ambiguityState
      .prepare(
        `INSERT INTO run_resources (
           run_id, resource_state, worktree_path, branch_name, codex_thread_id
         ) VALUES ('r_discord_second', 'provisioned', '/tmp/worktrees/9402/TailorTales',
                   'TT-9402_ambiguous-run', 'thread-9402')`,
      )
      .run();
    ambiguityState.close();
    const ambiguity = await runNodeFails(control, ["controls"], testHome);
    assert(
      ambiguity.includes("Multiple eligible runs match"),
      "Ambiguity did not fail closed",
    );

    const historical = new DatabaseSync(databasePath);
    historical
      .prepare(
        `INSERT INTO project_events (
           event_id, observed_at, project, item_id, content_id, content_type,
           repository, issue_number, title, url, from_status, to_status,
           payload_json, processing_state
         ) VALUES ('event-9399', '2026-08-16T08:00:00.000Z', 'tailortales',
                   'item-9399', 'content-9399', 'Issue', 'Shagon1k/TailorTales',
                   9399, '[Test]: Historical', 'https://example.invalid/issues/9399',
                   'Human Review', 'Done',
                   '{"issueState":"CLOSED","labels":[],"hasDescription":true}', 'processed')`,
      )
      .run();
    historical
      .prepare(
        `INSERT INTO runs (
           run_id, trigger_event_id, project, item_id, content_id, repository,
           issue_number, interaction_policy, state, owner_state, execution_mode,
           stop_reason, created_at, updated_at
         ) VALUES ('r_discord_historical', 'event-9399', 'tailortales', 'item-9399',
                   'content-9399', 'Shagon1k/TailorTales', 9399, 'autonomous',
                   'archived', 'none', 'live', 'completed',
                   '2026-08-16T08:00:00.000Z', '2026-08-16T08:00:00.000Z')`,
      )
      .run();
    historical
      .prepare(
        `INSERT INTO run_resources (
           run_id, resource_state, worktree_path, branch_name
         ) VALUES ('r_discord_historical', 'released', '/tmp/worktrees/9399/TailorTales',
                   'TT-9399_historical')`,
      )
      .run();
    historical
      .prepare(
        `INSERT INTO run_progress_cards (
           run_id, stage, detail, content_digest, updated_at
         ) VALUES ('r_discord_historical', 'completed', 'Historical completion.',
                   'digest-historical', '2026-08-16T08:00:00.000Z')`,
      )
      .run();
    historical.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    assert(
      parentMessages.length === stableParentCount,
      "Discord migration backfilled a historical terminal run",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        isolated: true,
        ticketCards: parentMessages.length,
        threadCreated: threadExists,
        ownerAutoJoined: threadMemberAdds.length === 1,
        liveCardEdits: cardEdits.length,
        nativeControls: readyControls.length,
        persistentControlMessages: threadControlCreates.length,
        dashboardUnpinned: true,
        dashboardRotations: deletedThreadMessages.length,
        contextualTakeoverLabel: true,
        boundedCiRepairControl: true,
        ownerControlledReviewFix: true,
        pendingTakeoverVisible: true,
        remoteCodexLauncher: true,
        remoteHandoffContext: true,
        delayedThreadReadinessReconciled: true,
        activePreviewHidden: true,
        parkedPreviewEnabled: true,
        cancelledWorkConfirmation: true,
        stageTimestampSemantic: true,
        timelineControlsAbsent: true,
        previewReadyDelivered: true,
        previewAcknowledgementVisible: true,
        previewRequiredPolicyVisible: true,
        publishedCancellationPreserved: true,
        publishedCancellationTerminalControls: true,
        statusDashboardMoved: true,
        idempotent: true,
        deterministicLookup: true,
        ambiguityRejected: true,
        historicalBackfill: false,
        resourceGuardDelivered: resourceGuardMessages.length === 1,
        resourceGuardIdempotent: true,
        threadPatches: threadPatches.length,
      })}\n`,
    );
  } finally {
    trace("closing-server");
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
      server.closeAllConnections();
    });
    await rm(testHome, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}
