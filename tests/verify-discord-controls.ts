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
      env: { ...process.env, ORCHESTRATOR_HOME: home, ...extraEnv },
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

function customIds(payload: JsonObject): string[] {
  const rows = Array.isArray(payload.components) ? payload.components : [];
  return rows.flatMap((row) => {
    const components = (row as JsonObject).components;
    if (!Array.isArray(components)) return [];
    return components
      .map((component) => String((component as JsonObject).custom_id ?? ""))
      .filter(Boolean);
  });
}

function componentLabels(payload: JsonObject): string[] {
  const rows = Array.isArray(payload.components) ? payload.components : [];
  return rows.flatMap((row) => {
    const components = (row as JsonObject).components;
    if (!Array.isArray(components)) return [];
    return components
      .map((component) => String((component as JsonObject).label ?? ""))
      .filter(Boolean);
  });
}

function componentUrls(payload: JsonObject): string[] {
  const rows = Array.isArray(payload.components) ? payload.components : [];
  return rows.flatMap((row) => {
    const components = (row as JsonObject).components;
    if (!Array.isArray(components)) return [];
    return components
      .map((component) => String((component as JsonObject).url ?? ""))
      .filter(Boolean);
  });
}

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const testHome = await mkdtemp(resolve(tmpdir(), "kurami-discord-test-"));
  const guildId = "1538486166330933358";
  const parentChannel = "1538490534820061286";
  const ownerUserId = "234723725168082944";
  const codexThreadId = "01a00b9d-e72b-73f3-af6e-30760c2191c4";
  const codexLaunchUrl =
    `https://go.shagon1k.win/codex/threads/${codexThreadId}`;
  const parentMessages: JsonObject[] = [];
  const cardEdits: JsonObject[] = [];
  const threadControlCreates: JsonObject[] = [];
  const threadControlEdits: JsonObject[] = [];
  const threadEvents: JsonObject[] = [];
  const threadMemberAdds: string[] = [];
  const threadPatches: JsonObject[] = [];
  const pinnedMessages = new Set<string>();
  const pinWrites: string[] = [];
  let threadExists = false;
  let nextThreadMessage = 2000;

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = request.url ?? "/";
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
      if (method === "GET" && url === "/channels/1001/messages/pins?limit=50") {
        sendJson(response, 200, {
          items: [...pinnedMessages].map((messageId) => ({
            pinned_at: "2026-08-16T09:10:01.000Z",
            message: { id: messageId, channel_id: "1001" },
          })),
          has_more: false,
        });
        return;
      }
      if (
        method === "PUT" &&
        /^\/channels\/1001\/messages\/pins\/\d+$/u.test(url)
      ) {
        const messageId = url.split("/").at(-1)!;
        pinnedMessages.add(messageId);
        pinWrites.push(messageId);
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
        sendJson(response, 200, {
          id: url.split("/").at(-1),
          channel_id: "1001",
        });
        return;
      }
      if (method === "POST" && url === "/channels/1001/messages") {
        const payload = await readJson(request);
        if (String(payload.content ?? "").startsWith("**Run controls ·"))
          threadControlCreates.push(payload);
        else threadEvents.push(payload);
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

    const notifier = resolve(appDirectory, "src/notify-discord-controls.ts");
    const control = resolve(appDirectory, "src/run-controls.ts");
    const first = await runNode(notifier, ["--apply"], testHome, discordEnv);
    trace("first-sync-complete");
    assert(first.ok === true, "Initial Discord reconciliation failed");
    assert(parentMessages.length === 1, "Ticket starter card was duplicated");
    assert(threadExists, "Ticket thread was not created from the starter card");
    assert(cardEdits.length === 1, "Live card was not reconciled exactly once");
    assert(threadMemberAdds.length === 1, "Owner was not added to the thread");
    assert(
      threadControlCreates.length === 1,
      "Persistent thread-local controls were not created",
    );
    assert(
      threadEvents.length === 1,
      "Durable attention event was not delivered",
    );
    assert(
      customIds(cardEdits[0]!).length === 0,
      "Starter card retained thread-inert custom controls",
    );
    const firstControls = customIds(threadControlCreates[0]!);
    assert(
      firstControls.includes("kurami:status:r_discord_smoke") &&
        firstControls.includes("kurami:stop:r_discord_smoke") &&
        !firstControls.includes("kurami:take_control:r_discord_smoke") &&
        !firstControls.includes("kurami:preview_start:r_discord_smoke"),
      "Live card has the wrong native control set",
    );
    const firstLabels = componentLabels(threadControlCreates[0]!);
    assert(
      firstLabels.includes("Cancel run") &&
        !firstLabels.includes("Take control") &&
        !firstLabels.includes("Start preview") &&
        !firstLabels.includes("Stop"),
      "Active controls have the wrong contextual labels",
    );
    assert(
      pinWrites.length === 1 && pinWrites[0] === "2001",
      "Persistent thread controls were not pinned exactly once",
    );
    assert(
      componentLabels(threadEvents[0]!).includes("Open controls") &&
        componentUrls(threadEvents[0]!).includes(
          `https://discord.com/channels/${guildId}/1001/2001`,
        ),
      "Durable event did not link back to the canonical controls",
    );
    assert(
      String(threadEvents[0]!.content).includes("CI failed") &&
        String(threadEvents[0]!.content).includes("Secret scan"),
      "CI attention event did not explain the failing check",
    );
    const embeds = cardEdits[0]!.embeds as JsonObject[];
    const fields = embeds[0]!.fields as JsonObject[];
    assert(
      fields.some(
        (field) =>
          field.name === "Stage since" &&
          String(field.value).startsWith("16.08.26 12:10 · <t:") &&
          String(field.value).endsWith(":R>"),
      ),
      "Stage timestamp is not owner-local and self-updating",
    );
    const ci = fields.find((field) => field.name === "CI");
    assert(
      String(ci?.value ?? "").includes("Failed") &&
        String(ci?.value ?? "").includes("Secret scan"),
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
        surface.control_message_id === "2001" &&
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

    await runNode(notifier, ["--apply"], testHome, discordEnv);
    trace("idempotent-sync-complete");
    assert(
      parentMessages.length === 1,
      "Idempotent sync recreated the ticket card",
    );
    assert(
      threadControlCreates.length === 1,
      "Idempotent sync recreated controls",
    );
    assert(threadEvents.length === 1, "Idempotent sync redelivered an event");
    assert(threadMemberAdds.length === 1, "Idempotent sync re-added the owner");
    assert(pinWrites.length === 1, "Idempotent sync pinned controls twice");

    const threadReady = new DatabaseSync(databasePath);
    threadReady
      .prepare(
        `UPDATE run_resources SET codex_thread_id=?
         WHERE run_id='r_discord_smoke'`,
      )
      .run(codexThreadId);
    threadReady.close();
    await runNode(notifier, ["--apply"], testHome, discordEnv);
    const readyControls = customIds(threadControlEdits.at(-1)!);
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
    const pendingControls = threadControlEdits.at(-1)!;
    assert(
      String(pendingControls.content).includes("Preparing human control") &&
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

    await runNode(
      notifier,
      ["show", "--run-id", "r_discord_smoke", "--apply"],
      testHome,
      discordEnv,
    );
    trace("show-controls-complete");
    assert(
      threadControlCreates.length === 1 &&
        threadControlEdits.length === readinessEditCount + 1,
      "Show controls did not edit the persistent thread message",
    );
    assert(
      customIds(threadControlEdits.at(-1)!).includes(
        "kurami:status:r_discord_smoke",
      ),
      "Fresh control surface did not contain native controls",
    );
    assert(pinWrites.length === 1, "Show controls pinned the message twice");

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
    const parkedLabels = componentLabels(threadControlEdits.at(-1)!);
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
    const remoteControls = threadControlEdits.at(-1)!;
    assert(
      componentLabels(remoteControls).includes("Open in Codex") &&
        componentUrls(remoteControls).includes(codexLaunchUrl) &&
        !customIds(remoteControls).includes(
          "kurami:take_control:r_discord_smoke",
        ),
      "Remote ownership did not expose the HTTPS Codex launcher",
    );
    const remoteCard = cardEdits.at(-1)!;
    const remoteEmbed = (remoteCard.embeds as JsonObject[])[0]!;
    const remoteFields = remoteEmbed.fields as JsonObject[];
    const handoff = remoteFields.find(
      (field) => field.name === "Codex handoff",
    );
    const handoffValue = String(handoff?.value ?? "");
    assert(
      handoffValue.includes("[TT-9401]: Discord control 9401") &&
        handoffValue.includes("shagserv / TailorTales") &&
        handoffValue.includes(codexThreadId) &&
        handoffValue.includes("managed CLI/tmux no longer owns this task"),
      "Remote card omitted the task, connection, thread fallback, or ownership note",
    );
    const humanEvent = threadEvents.at(-1)!;
    assert(
      String(humanEvent.content).includes("Preparation is ready for you") &&
        componentLabels(humanEvent).includes("Open in Codex") &&
        componentUrls(humanEvent).includes(codexLaunchUrl),
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
           lease_id, run_id, slot_number, state, compose_project_name
         ) VALUES ('lease-discord', 'r_discord_smoke', 1, 'running', 'discord-smoke')`,
      )
      .run();
    preview
      .prepare(
        `UPDATE run_progress_cards
         SET stage='preview_ready', detail='Preview passed health checks.',
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
      String(threadEvents.at(-1)!.content).includes("Preview is ready"),
      "Preview-ready notification was not delivered to the ticket thread",
    );
    assert(
      componentLabels(threadEvents.at(-1)!).includes("Open controls"),
      "Preview-ready notification did not link to controls",
    );
    assert(
      customIds(threadControlEdits.at(-1)!).includes(
        "kurami:preview_stop:r_discord_smoke",
      ),
      "Live card did not switch to Stop preview",
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
    const preservedControls = customIds(threadControlEdits.at(-1)!);
    const preservedLabels = componentLabels(threadControlEdits.at(-1)!);
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
    const publishedControls = threadControlEdits.at(-1)!;
    const publishedCard = cardEdits.at(-1)!;
    const publishedEmbed = (publishedCard.embeds as JsonObject[])[0]!;
    assert(
      String(publishedControls.content).includes(
        "Cancelled — published work preserved",
      ) &&
        componentLabels(publishedControls).includes("Open PR") &&
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
        String(publishedEmbed.description).includes(
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
        controlMessagePinned: pinWrites.length === 1,
        contextualTakeoverLabel: true,
        pendingTakeoverVisible: true,
        remoteCodexLauncher: true,
        remoteHandoffContext: true,
        delayedThreadReadinessReconciled: true,
        activePreviewHidden: true,
        parkedPreviewEnabled: true,
        cancelledWorkConfirmation: true,
        stageTimestampSemantic: true,
        eventControlLinks: true,
        previewReadyDelivered: true,
        publishedCancellationPreserved: true,
        publishedCancellationTerminalControls: true,
        showControlsEdited: true,
        idempotent: true,
        deterministicLookup: true,
        ambiguityRejected: true,
        historicalBackfill: false,
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
