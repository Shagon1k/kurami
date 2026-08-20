import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  persistTriageRanking,
  rankTriageFacts,
} from "../src/triage-rank.ts";
import {
  buildTriageFacts,
  persistTriageSnapshot,
  type RawTriageItem,
} from "../src/triage-snapshot.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function item(
  number: number,
  overrides: Partial<RawTriageItem> = {},
): RawTriageItem {
  return {
    itemId: `item-${number}`,
    contentType: "Issue",
    repository: "Shagon1k/TailorTales",
    issueNumber: number,
    title: `Issue ${number}`,
    url: `https://example.invalid/issues/${number}`,
    issueState: "OPEN",
    status: "Backlog",
    priority: null,
    effort: null,
    labels: [],
    labelsTotalCount: 0,
    hasDescription: true,
    bodyDigest: `${number}`.repeat(64).slice(0, 64),
    createdAt: `2026-07-${String(number).padStart(2, "0")}T08:00:00.000Z`,
    closedAt: null,
    blockedByOpenCount: 0,
    blockingOpenCount: 0,
    blockedByTotalCount: 0,
    blockingTotalCount: 0,
    blockedBy: [],
    blocking: [],
    ...overrides,
  };
}

async function runNode(
  script: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun({ stdout: stdout.trim(), stderr: stderr.trim() });
      else rejectRun(new Error(`Node child exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-triage-digest-test-"));
  const migrationsDirectory = resolve(app, "migrations");
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
  try {
    const upgrade = new DatabaseSync(resolve(home, "upgrade-v17.db"));
    upgrade.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations.filter((name) => name <= "017_project_triage.sql"))
      upgrade.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    upgrade.exec(`
      INSERT INTO project_triage_state (
        project, factual_hash, facts_json, stats_json, change_sequence,
        first_observed_at, last_changed_at, last_checked_at
      ) VALUES (
        'preserved', '${"a".repeat(64)}', '{}', '{}', 1,
        '2026-08-20T06:00:00.000Z', '2026-08-20T06:00:00.000Z',
        '2026-08-20T06:00:00.000Z'
      );
    `);
    upgrade.exec(
      await readFile(
        resolve(migrationsDirectory, "018_project_triage_digest.sql"),
        "utf8",
      ),
    );
    assert(
      (upgrade.prepare("SELECT COUNT(*) AS count FROM project_triage_state").get() as {
        count: number;
      }).count === 1 && upgrade.prepare("PRAGMA foreign_key_check").all().length === 0,
      "Schema 18 did not preserve populated v17 state",
    );
    upgrade.close();

    await mkdir(resolve(home, "state"), { recursive: true });
    await mkdir(resolve(home, "config"), { recursive: true });
    await writeFile(
      resolve(home, "config/orchestrator.yaml"),
      `version: 1\nmode: live\ndiscord:\n  digest_channel_id: "1539929665068601364"\nlimits: {}\n`,
    );
    await writeFile(
      resolve(home, "config/projects.yaml"),
      `version: 1\nprojects:\n  tailortales:\n    owner: Shagon1k\n    project_number: 2\n    repository: Shagon1k/TailorTales\n    workspace:\n      branch_prefix: TT\n`,
    );
    await runNode(resolve(app, "src/init-run-store.ts"), [], {
      ...process.env,
      ORCHESTRATOR_HOME: home,
      ORCHESTRATOR_MIGRATIONS_DIR: migrationsDirectory,
    });
    const database = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    const config = {
      owner: "Shagon1k",
      project_number: 2,
      repository: "Shagon1k/TailorTales",
      status_field: "Status",
      statuses: {
        backlog: "Backlog",
        active: "In progress",
        review: "Human Review",
        done: "Done",
        deferred: "Deferred",
      },
      workspace: {
        canonical_repository: "/tmp/TailorTales",
        worktree_root: "/tmp/worktrees/tailortales",
        base_branch: "main",
      },
      triage: {
        enabled: true,
        priority_field: "Priority",
        effort_field: "Effort",
      },
    };
    const facts = buildTriageFacts(
      "tailortales",
      config,
      [
        item(1, { priority: "P2", effort: "S", blockingOpenCount: 6 }),
        item(2, { priority: "P1", effort: "XL" }),
        item(3, { effort: "XS", blockingOpenCount: 8 }),
        item(4, { blockedByOpenCount: 1 }),
      ],
      [],
    );
    const snapshot = persistTriageSnapshot(
      database,
      facts,
      "2026-08-20T06:00:00.000Z",
      null,
    );
    const ranking = rankTriageFacts(
      facts,
      snapshot.factualHash,
      new Date("2026-08-20T06:00:00.000Z"),
    );
    assert(ranking.ranked.length === 3, "Ranking did not include every eligible issue");
    assert(
      ranking.selected?.issueNumber === 2 &&
        ranking.explanation.includes("Owner priority P1"),
      "Owner priority did not deterministically select the next issue",
    );
    assert(
      ranking.policyVersion === "deterministic-v2" &&
        ranking.ranked.every((entry) => !entry.reasons.some((reason) => reason.startsWith("Unblocks "))),
      "Dependency relationships affected the Projects Digest ranking",
    );
    const first = persistTriageRanking(
      database,
      ranking,
      "2026-08-20T06:01:00.000Z",
    );
    const idle = persistTriageRanking(
      database,
      ranking,
      "2026-08-20T06:02:00.000Z",
    );
    assert(first.action === "changed" && idle.action === "unchanged", "Idle ranking reran");
    assert(
      idle.suggestedSince === "2026-08-20T06:01:00.000Z",
      "Idle ranking changed Suggested since",
    );

    const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
    let nextMessageId = 9_001;
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        requests.push({
          method: request.method ?? "",
          url: request.url ?? "",
          body: body ? (JSON.parse(body) as Record<string, unknown>) : {},
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: String(nextMessageId++) }));
      });
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    assert(address && typeof address === "object", "Fake Discord did not start");
    const notifierEnvironment = {
      ...process.env,
      ORCHESTRATOR_HOME: home,
      HERMES_HOME: home,
      DISCORD_BOT_TOKEN: "test-token",
      DISCORD_API_BASE: `http://127.0.0.1:${address.port}`,
    };
    const notifier = resolve(app, "src/notify-discord-digest.ts");
    const created = JSON.parse(
      (await runNode(notifier, ["--apply"], notifierEnvironment)).stdout,
    ) as { ok: boolean; results: Array<{ action: string }> };
    assert(created.ok && created.results[0]?.action === "created", "Digest card was not created");
    assert(
      requests.length === 1 &&
        requests[0]!.method === "POST" &&
        requests[0]!.url === "/channels/1539929665068601364/messages" &&
        !requests[0]!.url.includes("thread"),
      "Digest was not posted directly to the configured text channel",
    );
    const payload = requests[0]!.body;
    assert(
      JSON.stringify(payload).includes("TailorTales · Project digest") &&
        JSON.stringify(payload).includes("Suggested next") &&
        !JSON.stringify(payload).toLowerCase().includes("due date"),
      "Digest card contract is incomplete",
    );
    const unchanged = JSON.parse(
      (await runNode(notifier, ["--apply"], notifierEnvironment)).stdout,
    ) as { ok: boolean; results: unknown[] };
    assert(unchanged.ok && unchanged.results.length === 0 && requests.length === 1, "Idle digest edited the card");

    database
      .prepare(
        `UPDATE project_triage_state
         SET last_checked_at = '2026-08-21T06:00:00.000Z'
         WHERE project = 'tailortales'`,
      )
      .run();
    const refreshed = JSON.parse(
      (await runNode(notifier, ["--apply"], notifierEnvironment)).stdout,
    ) as { ok: boolean; results: Array<{ action: string }> };
    assert(
      refreshed.ok &&
        refreshed.results[0]?.action === "edited" &&
        requests.at(-1)?.method === "PATCH" &&
        requests.at(-1)?.url ===
          "/channels/1539929665068601364/messages/9001",
      "Daily Last checked refresh did not edit the existing card",
    );
    const surface = database
      .prepare(`
        SELECT channel_id, message_id, state, attempt_count, last_error
        FROM project_discord_digest_surfaces
        WHERE project = 'tailortales'
      `)
      .get() as {
      channel_id: string;
      message_id: string;
      state: string;
      attempt_count: number;
      last_error: string | null;
    };
    assert(
      surface.channel_id === "1539929665068601364" &&
        surface.message_id === "9001" &&
        surface.state === "active" &&
        surface.attempt_count === 0 &&
        surface.last_error === null,
      "Digest surface identity was not persisted",
    );
    const pollerWrapper = await readFile(resolve(app, "run-project-poller.sh"), "utf8");
    assert(
      pollerWrapper.includes('poll_changed=1') &&
        pollerWrapper.includes('"${PROJECTS_DIGEST}" --project "${PROJECT}"'),
      "Project status changes do not trigger Projects Digest",
    );
    database.close();
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        fullEligibleRanking: ranking.ranked.length,
        deterministicSuggestedIssue: ranking.selected.issueNumber,
        ownerPriorityFirst: true,
        dependencyScoringExcluded: true,
        idleRankingNoOp: true,
        directTextChannelCards: true,
        threadsCreated: 0,
        initialMessages: 1,
        idleEdits: 0,
        dailyLastCheckedEdit: true,
        eventDrivenStatusRefresh: true,
        persistentMessageIdentity: surface.message_id,
        dueDatesExcluded: true,
        boardMutations: false,
        populatedV17UpgradePreserved: true,
      })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
