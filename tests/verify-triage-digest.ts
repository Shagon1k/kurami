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
    const initialPayload = JSON.stringify(payload);
    assert(
      payload.flags === 32768 &&
        payload.content === null &&
        payload.embeds === null &&
        initialPayload.includes("TailorTales · Project digest") &&
        initialPayload.includes("Suggested next") &&
        initialPayload.includes("```text") &&
        initialPayload.includes("[Suggested issue]") &&
        !initialPayload.includes("Open suggested issue") &&
        !initialPayload.includes("Open project") &&
        !initialPayload.toLowerCase().includes("due date") &&
        !initialPayload.includes("Snapshot") &&
        !initialPayload.includes("deterministic-v2"),
      "Digest card contract is incomplete",
    );
    const unchanged = JSON.parse(
      (await runNode(notifier, ["--apply"], notifierEnvironment)).stdout,
    ) as { ok: boolean; results: unknown[] };
    assert(unchanged.ok && unchanged.results.length === 0 && requests.length === 1, "Idle digest edited the card");

    database
      .prepare(
        `INSERT INTO project_metadata_proposal_batches (
           batch_id, project, batch_number, batch_kind, batch_state,
           factual_hash, change_sequence, source_items_json, source_digest,
           candidate_count, proposal_count, summary
         ) VALUES (
           'pmb_aabb', 'tailortales', 1, 'changed', 'ready', ?, 1,
           '[]', ?, 2, 2, '2 metadata proposals ready for 2 issues.'
         )`,
      )
      .run(snapshot.factualHash, "c".repeat(64));
    const insertProposal = database.prepare(
      `INSERT INTO project_metadata_proposals (
         proposal_id, batch_id, item_id, repository, issue_number, title, url,
         field_name, baseline_value, proposed_value, confidence, reason,
         evidence_json
       ) VALUES (?, 'pmb_aabb', ?, 'Shagon1k/TailorTales', ?, ?, ?, ?, NULL,
                 ?, 'high', 'Evidence-backed proposal.', '[]')`,
    );
    insertProposal.run(
      "pmp_aabb",
      "item-1",
      1,
      "Issue 1",
      "https://example.invalid/issues/1",
      "priority",
      "P2",
    );
    insertProposal.run(
      "pmp_ccdd",
      "item-2",
      2,
      "Issue 2",
      "https://example.invalid/issues/2",
      "effort",
      "M",
    );
    const metadataReady = JSON.parse(
      (await runNode(notifier, ["--apply"], notifierEnvironment)).stdout,
    ) as { ok: boolean; results: Array<{ action: string }> };
    const metadataPayload = JSON.stringify(requests.at(-1)?.body);
    assert(
      metadataReady.ok &&
        metadataReady.results[0]?.action === "edited" &&
        requests.at(-1)?.method === "PATCH" &&
        metadataPayload.includes("Metadata proposals") &&
        metadataPayload.includes("2 pending") &&
        metadataPayload.includes("1 Priority · 1 Effort") &&
        metadataPayload.includes("Owner review required. GitHub is unchanged.") &&
        metadataPayload.includes("Accept batch") &&
        metadataPayload.includes("Review proposals") &&
        metadataPayload.includes("Discuss batch") &&
        metadataPayload.includes("Skip batch") &&
        !metadataPayload.includes("Snapshot") &&
        !metadataPayload.includes("deterministic-v2"),
      "Ready metadata batch did not appear on the persistent digest card",
    );
    const requestCountAfterMetadata = requests.length;
    const metadataIdle = JSON.parse(
      (await runNode(notifier, ["--apply"], notifierEnvironment)).stdout,
    ) as { ok: boolean; results: unknown[] };
    assert(
      metadataIdle.ok &&
        metadataIdle.results.length === 0 &&
        requests.length === requestCountAfterMetadata,
      "Unchanged metadata batch edited the digest card",
    );

    database.exec(`
      UPDATE project_metadata_proposal_batches
      SET batch_state='accepted', sync_state='queued', accepted_by='discord_owner',
          accepted_at='2026-08-20T13:00:00.000Z', updated_at='2026-08-20T13:00:00.000Z'
      WHERE batch_id='pmb_aabb';
      UPDATE project_metadata_proposals
      SET proposal_state='accepted', accepted_by='discord_owner',
          accepted_at='2026-08-20T13:00:00.000Z'
      WHERE batch_id='pmb_aabb';
    `);
    await runNode(notifier, ["--apply"], notifierEnvironment);
    const approvedPayload = JSON.stringify(requests.at(-1)?.body);
    assert(
      approvedPayload.includes("Approved · 2 proposals") &&
        approvedPayload.includes("Guarded GitHub sync is queued") &&
        approvedPayload.includes("Review approved batch") &&
        !approvedPayload.includes("Accept batch"),
      "Approved metadata batch did not enter the guarded-sync UI",
    );
    database.exec(`
      UPDATE project_metadata_proposal_batches
      SET sync_state='syncing', sync_attempt_count=1,
          updated_at='2026-08-20T13:01:00.000Z'
      WHERE batch_id='pmb_aabb';
    `);
    await runNode(notifier, ["--apply"], notifierEnvironment);
    const syncingPayload = JSON.stringify(requests.at(-1)?.body);
    assert(
      syncingPayload.includes("Applying · 2 proposals") &&
        syncingPayload.includes("revalidating each field"),
      "Active guarded sync is not visible in the digest",
    );
    database.exec(`
      UPDATE project_metadata_proposals
      SET proposal_state='applied', applied_value=proposed_value,
          applied_at='2026-08-20T13:02:00.000Z'
      WHERE proposal_id='pmp_aabb';
      UPDATE project_metadata_proposals
      SET proposal_state='conflicted', previous_value='L',
          failure_reason='Owner value preserved'
      WHERE proposal_id='pmp_ccdd';
      UPDATE project_metadata_proposal_batches
      SET batch_state='partially_applied', sync_state='partial',
          completed_at='2026-08-20T13:02:00.000Z',
          sync_completed_at='2026-08-20T13:02:00.000Z',
          updated_at='2026-08-20T13:02:00.000Z'
      WHERE batch_id='pmb_aabb';
    `);
    await runNode(notifier, ["--apply"], notifierEnvironment);
    const partialPayload = JSON.stringify(requests.at(-1)?.body);
    assert(
      partialPayload.includes("Partially applied · 1 applied") &&
        partialPayload.includes("1 owner values preserved") &&
        partialPayload.includes("Review sync result") &&
        !partialPayload.includes("Accept batch"),
      "Partial guarded-sync result did not preserve owner-facing evidence",
    );
    database.exec(`
      UPDATE project_metadata_proposals
      SET proposal_state='conflicted', applied_value=NULL, applied_at=NULL,
          previous_value='P1', failure_reason='Owner value preserved'
      WHERE proposal_id='pmp_aabb';
      UPDATE project_metadata_proposal_batches
      SET updated_at='2026-08-20T13:02:30.000Z'
      WHERE batch_id='pmb_aabb';
    `);
    await runNode(notifier, ["--apply"], notifierEnvironment);
    const noWritePayload = JSON.stringify(requests.at(-1)?.body);
    assert(
      noWritePayload.includes("Needs attention · nothing applied") &&
        noWritePayload.includes("2 owner values preserved"),
      "All-conflict guarded sync was mislabeled as partially applied",
    );
    database.exec(`
      UPDATE project_metadata_proposals
      SET proposal_state='accepted', applied_value=NULL, applied_at=NULL,
          previous_value=NULL, failure_reason=NULL
      WHERE batch_id='pmb_aabb';
      UPDATE project_metadata_proposal_batches
      SET batch_state='accepted', sync_state='failed', sync_attempt_count=2,
          sync_last_error='bounded attempts exhausted', completed_at=NULL,
          sync_completed_at=NULL, updated_at='2026-08-20T13:03:00.000Z'
      WHERE batch_id='pmb_aabb';
    `);
    await runNode(notifier, ["--apply"], notifierEnvironment);
    const attentionPayload = JSON.stringify(requests.at(-1)?.body);
    assert(
      attentionPayload.includes("Needs attention · 2 proposals") &&
        attentionPayload.includes("Automatic attempts are exhausted") &&
        attentionPayload.includes("Retry sync"),
      "Exhausted guarded sync has no deterministic owner recovery",
    );

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
        pollerWrapper.includes('"${PROJECTS_DIGEST}" --project "${PROJECT}"') &&
        pollerWrapper.includes('"${METADATA_SYNC}" --project "${PROJECT}" --apply') &&
        pollerWrapper.includes("metadata_sync_changed == 1"),
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
        metadataOwnerReviewCard: true,
        metadataIdleNoOp: true,
        guardedSyncQueuedCard: true,
        guardedSyncRunningCard: true,
        guardedSyncPartialCard: true,
        guardedSyncAttentionCard: true,
        explicitSyncRetryControl: true,
        technicalFooterHidden: true,
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
