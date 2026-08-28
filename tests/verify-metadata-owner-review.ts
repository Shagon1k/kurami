import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { planProjectAssessment } from "../src/orchestrator/projects/metadata/proposals/manager.ts";
import {
  buildTriageFacts,
  persistTriageSnapshot,
  type RawTriageItem,
} from "../src/orchestrator/projects/triage/snapshot.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runControl(
  script: string,
  home: string,
  args: string[],
): Promise<Record<string, unknown>> {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, KURAMI_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code !== 0) rejectRun(new Error(stderr || stdout));
      else resolveRun(JSON.parse(stdout.trim()) as Record<string, unknown>);
    });
  });
}

function item(project: string, number: number): RawTriageItem {
  return {
    itemId: `${project}-${number}`,
    contentType: "Issue",
    repository: `Shagon1k/${project}`,
    issueNumber: number,
    title: `${project} issue ${number}`,
    url: `https://example.invalid/${project}/issues/${number}`,
    issueState: "OPEN",
    status: "Backlog",
    priority: null,
    effort: null,
    labels: [],
    labelsTotalCount: 0,
    hasDescription: true,
    bodyDigest: String(number).repeat(64).slice(0, 64),
    createdAt: "2026-08-01T00:00:00.000Z",
    closedAt: null,
    blockedByOpenCount: 0,
    blockingOpenCount: 0,
    blockedByTotalCount: 0,
    blockingTotalCount: 0,
    blockedBy: [],
    blocking: [],
  };
}

function config(project: string) {
  return {
    owner: "Shagon1k",
    project_number: 2,
    repository: `Shagon1k/${project}`,
    status_field: "Status",
    statuses: {
      backlog: "Backlog",
      active: "In progress",
      review: "Human Review",
      done: "Done",
      deferred: "Deferred",
    },
    workspace: {
      canonical_repository: `/tmp/${project}`,
      worktree_root: `/tmp/worktrees/${project}`,
      base_branch: "main",
    },
    triage: {
      enabled: true,
      priority_field: "Priority",
      effort_field: "Effort",
    },
  };
}

function insertBatch(
  database: DatabaseSync,
  project: string,
  batchId: string,
  factualHash: string,
  issueNumber: number,
  proposalIds: string[],
): void {
  database
    .prepare(
      `INSERT INTO project_metadata_proposal_batches (
         batch_id, project, batch_number, batch_kind, batch_state,
         factual_hash, change_sequence, source_items_json, source_digest,
         candidate_count, proposal_count, summary
       ) VALUES (?, ?, 1, 'changed', 'ready', ?, 1, '[]', ?, 1, ?, ?)`,
    )
    .run(
      batchId,
      project,
      factualHash,
      "b".repeat(64),
      proposalIds.length,
      `${proposalIds.length} metadata proposals ready for 1 issue.`,
    );
  const insert = database.prepare(
    `INSERT INTO project_metadata_proposals (
       proposal_id, batch_id, item_id, repository, issue_number, title, url,
       field_name, baseline_value, proposed_value, confidence, reason,
       evidence_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'high', ?, '[]')`,
  );
  proposalIds.forEach((proposalId, index) => {
    const field = index === 0 ? "priority" : "effort";
    insert.run(
      proposalId,
      batchId,
      `${project}-${issueNumber}`,
      `Shagon1k/${project}`,
      issueNumber,
      `${project} issue ${issueNumber}`,
      `https://example.invalid/${project}/issues/${issueNumber}`,
      field,
      field === "priority" ? "P2" : "M",
      "Evidence-backed owner proposal.",
    );
  });
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const migrationsDirectory = resolve(app, "migrations");
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
  const home = await mkdtemp(resolve(tmpdir(), "kurami-metadata-owner-review-"));
  try {
    const upgrade = new DatabaseSync(resolve(home, "upgrade-v19.db"));
    upgrade.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations.filter((name) => name <= "019_metadata_proposal_batches.sql"))
      upgrade.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    upgrade.exec(`
      INSERT INTO project_metadata_proposal_batches (
        batch_id, project, batch_number, batch_kind, batch_state, factual_hash,
        change_sequence, source_items_json, source_digest, candidate_count,
        proposal_count, summary
      ) VALUES (
        'pmb_aa', 'preserved', 1, 'changed', 'ready', '${"a".repeat(64)}',
        1, '[]', '${"b".repeat(64)}', 1, 0, 'Preserved ready batch.'
      );
    `);
    upgrade.exec(
      await readFile(resolve(migrationsDirectory, "020_metadata_owner_review.sql"), "utf8"),
    );
    const preserved = upgrade
      .prepare(
        `SELECT batch_state, accepted_by, discussion_thread_id
         FROM project_metadata_proposal_batches WHERE batch_id='pmb_aa'`,
      )
      .get() as Record<string, unknown>;
    assert(
      preserved.batch_state === "ready" &&
        preserved.accepted_by === null &&
        preserved.discussion_thread_id === null,
      "Schema 20 did not preserve a populated v19 ready batch",
    );
    upgrade.close();

    await mkdir(resolve(home, "state"), { recursive: true });
    const database = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    database.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations)
      database.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));

    for (const project of ["tailortales", "pickflick"]) {
      const facts = buildTriageFacts(project, config(project), [item(project, 1)], []);
      const snapshot = persistTriageSnapshot(
        database,
        facts,
        "2026-08-20T12:00:00.000Z",
        null,
      );
      if (project === "tailortales")
        insertBatch(
          database,
          project,
          "pmb_bb",
          snapshot.factualHash,
          1,
          ["pmp_bb", "pmp_cc"],
        );
      else
        insertBatch(database, project, "pmb_cc", snapshot.factualHash, 1, ["pmp_dd"]);
    }
    database.close();

    const control = resolve(app, "src/orchestrator/projects/metadata/controls.ts");
    const initial = await runControl(control, home, ["status", "--batch-id", "pmb_bb"]);
    assert(
      initial.batchState === "ready" &&
        (initial.counts as { pending: number }).pending === 2,
      "Owner status did not expose the ready batch",
    );
    const excluded = await runControl(control, home, [
      "exclude",
      "--batch-id",
      "pmb_bb",
      "--proposal-id",
      "pmp_cc",
      "--apply",
    ]);
    assert(
      excluded.action === "excluded" && excluded.remaining === 1 && excluded.githubWrites === 0,
      "Batch exceptions were not SQLite-only and deterministic",
    );
    const duplicateExclude = await runControl(control, home, [
      "exclude",
      "--batch-id",
      "pmb_bb",
      "--proposal-id",
      "pmp_cc",
      "--apply",
    ]);
    assert(
      duplicateExclude.action === "unchanged" && duplicateExclude.remaining === 1,
      "A stale multi-select retry was not idempotent",
    );
    const restored = await runControl(control, home, [
      "restore",
      "--batch-id",
      "pmb_bb",
      "--proposal-id",
      "pmp_cc",
      "--apply",
    ]);
    assert(
      restored.action === "restored" && restored.remaining === 2 && restored.githubWrites === 0,
      "Accidental proposal exclusion was not reversible",
    );
    await runControl(control, home, [
      "exclude",
      "--batch-id",
      "pmb_bb",
      "--proposal-id",
      "pmp_cc",
      "--apply",
    ]);
    await runControl(control, home, ["discuss", "--batch-id", "pmb_bb", "--apply"]);
    await runControl(control, home, [
      "record-thread",
      "--batch-id",
      "pmb_bb",
      "--thread-id",
      "1539929665068601364",
      "--apply",
    ]);
    const accepted = await runControl(control, home, [
      "accept",
      "--batch-id",
      "pmb_bb",
      "--apply",
    ]);
    assert(
      accepted.action === "accepted" && accepted.proposals === 1 && accepted.githubWrites === 0,
      "Owner acceptance was not a guarded SQLite-only decision",
    );
    const archived = await runControl(control, home, [
      "record-archive",
      "--batch-id",
      "pmb_bb",
      "--apply",
    ]);
    assert(archived.action === "archive_recorded", "Discussion archive was not recorded");

    const skipped = await runControl(control, home, [
      "skip",
      "--batch-id",
      "pmb_cc",
      "--apply",
    ]);
    assert(
      skipped.action === "skipped" && skipped.githubWrites === 0,
      "Owner skip was not SQLite-only",
    );

    const exhausted = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    exhausted.exec(`
      UPDATE project_metadata_proposal_batches
      SET sync_state='failed', sync_attempt_count=2,
          sync_last_error='bounded attempts exhausted'
      WHERE batch_id='pmb_bb';
    `);
    exhausted.close();
    const retryPlan = await runControl(control, home, [
      "retry-sync",
      "--batch-id",
      "pmb_bb",
    ]);
    assert(
      retryPlan.action === "retry_sync" && retryPlan.previousAttempts === 2,
      "Exhausted sync retry was not inspectable",
    );
    const retried = await runControl(control, home, [
      "retry-sync",
      "--batch-id",
      "pmb_bb",
      "--apply",
    ]);
    assert(
      retried.action === "sync_retry_queued" && retried.githubWrites === 0,
      "Explicit owner retry did not remain SQLite-only",
    );

    const verified = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    const acceptedBatch = verified
      .prepare(
        `SELECT batch_state, accepted_by, accepted_at, sync_state,
                sync_attempt_count, discussion_thread_id, discussion_archived_at
         FROM project_metadata_proposal_batches WHERE batch_id='pmb_bb'`,
      )
      .get() as Record<string, unknown>;
    const proposalStates = verified
      .prepare(
        `SELECT proposal_id, proposal_state FROM project_metadata_proposals
         WHERE batch_id='pmb_bb' ORDER BY proposal_id`,
      )
      .all() as Array<{ proposal_id: string; proposal_state: string }>;
    assert(
      acceptedBatch.batch_state === "accepted" &&
        acceptedBatch.accepted_by === "discord_owner" &&
        typeof acceptedBatch.accepted_at === "string" &&
        acceptedBatch.sync_state === "queued" &&
        acceptedBatch.sync_attempt_count === 0 &&
        acceptedBatch.discussion_thread_id === "1539929665068601364" &&
        typeof acceptedBatch.discussion_archived_at === "string" &&
        proposalStates.map(({ proposal_state }) => proposal_state).join(",") === "accepted,skipped",
      "Durable owner decision state is incomplete",
    );
    const active = planProjectAssessment(verified, "tailortales");
    assert(
      active.action === "active" && active.batchState === "accepted",
      "Accepted batch did not hold the project until guarded sync",
    );
    const events = verified
      .prepare(
        `SELECT event_type, actor FROM project_metadata_proposal_events
         WHERE batch_id='pmb_bb' ORDER BY occurred_at, event_id`,
      )
      .all() as Array<{ event_type: string; actor: string }>;
    assert(
        events.some(({ event_type, actor }) => event_type === "accepted" && actor === "discord_owner") &&
        events.some(({ event_type }) => event_type === "discussion_archived") &&
        events.some(({ event_type }) => event_type === "sync_retry_requested"),
      "Owner decisions lack append-only provenance",
    );
    const skipEvent = verified
      .prepare(
        `SELECT actor FROM project_metadata_proposal_events
         WHERE batch_id='pmb_cc' AND event_type='skipped'`,
      )
      .get() as { actor: string };
    assert(skipEvent.actor === "discord_owner", "Owner Skip lost its actor provenance");
    assert(verified.prepare("PRAGMA foreign_key_check").all().length === 0, "Foreign keys failed");
    verified.close();

    const controlSource = await readFile(control, "utf8");
    assert(
      !controlSource.includes("GH_TOKEN") &&
        !controlSource.includes("gh api") &&
        !controlSource.includes("projectV2"),
      "Owner-review controls contain an unexpected GitHub write path",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        populatedV19UpgradePreserved: true,
        ownerStatus: true,
        batchExceptions: true,
        staleSelectionIdempotent: true,
        exclusionRestore: true,
        discussionLifecycle: true,
        batchAccept: true,
        batchSkip: true,
        acceptedBatchHeldForSync: true,
        guardedSyncQueued: true,
        explicitSyncRetry: true,
        githubWrites: 0,
        appendOnlyProvenance: true,
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
