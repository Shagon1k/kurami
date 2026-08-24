import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  planDailyProjectAssessment,
  runDailyProposalCycle,
} from "../src/metadata-proposal-scheduler.ts";
import { persistTriageRanking, rankTriageFacts } from "../src/triage-rank.ts";
import {
  buildTriageFacts,
  persistTriageSnapshot,
  type RawTriageItem,
} from "../src/triage-snapshot.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function item(number: number): RawTriageItem {
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
    bodyDigest: String(number).repeat(64).slice(0, 64),
    createdAt: "2026-08-01T08:00:00.000Z",
    closedAt: null,
    blockedByOpenCount: 0,
    blockingOpenCount: 0,
    blockedByTotalCount: 0,
    blockingTotalCount: 0,
    blockedBy: [],
    blocking: [],
  };
}

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

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const migrationsDirectory = resolve(app, "migrations");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-metadata-scheduler-"));
  try {
    const upgrade = new DatabaseSync(resolve(home, "upgrade-v21.db"));
    upgrade.exec("PRAGMA foreign_keys=ON;");
    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
      .sort();
    for (const migration of migrationNames.filter((name) => name <= "021_guarded_metadata_sync.sql"))
      upgrade.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    upgrade.exec(`
      INSERT INTO project_metadata_proposal_batches (
        batch_id, project, batch_number, batch_kind, batch_state, factual_hash,
        change_sequence, source_items_json, source_digest, candidate_count
      ) VALUES (
        'pmb_upgrade', 'tailortales', 1, 'bootstrap', 'applied', '${"a".repeat(64)}',
        1, '[]', '${"b".repeat(64)}', 1
      );
    `);
    upgrade.exec(
      await readFile(resolve(migrationsDirectory, "022_automatic_metadata_admission.sql"), "utf8"),
    );
    assert(
      (upgrade.prepare("SELECT batch_state FROM project_metadata_proposal_batches WHERE batch_id='pmb_upgrade'").get() as { batch_state: string }).batch_state === "applied" &&
        (upgrade.prepare("SELECT COUNT(*) AS count FROM project_metadata_daily_admissions").get() as { count: number }).count === 0,
      "Schema 22 did not preserve populated v21 metadata state",
    );
    upgrade.close();

    const database = new DatabaseSync(resolve(home, "orchestrator.db"));
    database.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrationNames)
      database.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));

    const facts = buildTriageFacts(
      "tailortales",
      config,
      Array.from({ length: 25 }, (_, index) => item(index + 1)),
      [],
    );
    const snapshot = persistTriageSnapshot(
      database,
      facts,
      "2026-08-20T06:00:00.000Z",
      null,
    );
    persistTriageRanking(
      database,
      rankTriageFacts(facts, snapshot.factualHash, new Date("2026-08-20T06:01:00.000Z")),
      "2026-08-20T06:01:00.000Z",
    );

    let workerCalls = 0;
    const worker = (batchId: string): { state: string } => {
      workerCalls += 1;
      database
        .prepare(
          `UPDATE project_metadata_proposal_batches
           SET batch_state='ready', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE batch_id=? AND batch_state='planned'`,
        )
        .run(batchId);
      return { state: "ready" };
    };

    const disabled = runDailyProposalCycle(
      database,
      "2026-08-20",
      true,
      worker,
      "tailortales",
      1,
      0,
    );
    assert(
      disabled.results[0]?.action === "disabled" &&
        workerCalls === 0 &&
        (database.prepare("SELECT COUNT(*) AS count FROM project_metadata_daily_admissions").get() as { count: number }).count === 0,
      "AI triage/day 0 did not disable proposals cleanly",
    );
    const raisedLimit = runDailyProposalCycle(
      database,
      "2026-08-20",
      false,
      worker,
      "tailortales",
      1,
      40,
    );
    assert(
      raisedLimit.results[0]?.action === "create" &&
        ((raisedLimit.results[0] as { assessment?: { candidates?: unknown[] } }).assessment?.candidates?.length ?? 0) === 25 &&
        workerCalls === 0,
      "Raised AI triage/day limit did not expand one logical review batch",
    );

    database
      .prepare(
        `INSERT INTO project_events (
           event_id, observed_at, project, item_id, content_id, content_type,
           repository, issue_number, title, url, payload_json
         ) VALUES (
           'evt-capacity', '2026-08-20T06:10:00.000Z', 'tailortales',
           'capacity-item', 'capacity-content', 'Issue', 'Shagon1k/TailorTales',
           9001, 'Capacity fixture', 'https://example.invalid/issues/9001', '{}'
         )`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO runs (
           run_id, trigger_event_id, project, item_id, content_id, repository,
           issue_number, interaction_policy, state, owner_state, execution_mode
         ) VALUES (
           'run-capacity', 'evt-capacity', 'tailortales', 'capacity-item',
           'capacity-content', 'Shagon1k/TailorTales', 9001, 'autonomous',
           'running', 'cli', 'live'
         )`,
      )
      .run();
    const capacity = runDailyProposalCycle(
      database,
      "2026-08-20",
      true,
      worker,
      "tailortales",
      1,
    );
    assert(
      capacity.results[0]?.action === "capacity" &&
        workerCalls === 0 &&
        (database.prepare("SELECT COUNT(*) AS count FROM project_metadata_proposal_batches").get() as { count: number }).count === 0,
      "Automatic metadata assessment ignored global LLM capacity",
    );
    database.prepare("DELETE FROM runs WHERE run_id='run-capacity'").run();
    database.prepare("DELETE FROM project_events WHERE event_id='evt-capacity'").run();

    const dry = runDailyProposalCycle(
      database,
      "2026-08-20",
      false,
      () => {
        throw new Error("Dry cycle invoked worker");
      },
      "tailortales",
    );
    assert(
      dry.results[0]?.action === "create" &&
        workerCalls === 0 &&
        (database.prepare("SELECT COUNT(*) AS count FROM project_metadata_proposal_batches").get() as { count: number }).count === 0,
      "Dry daily admission mutated state or invoked AI",
    );

    const first = runDailyProposalCycle(
      database,
      "2026-08-20",
      true,
      worker,
      "tailortales",
    );
    assert(first.ok && Number(workerCalls) === 1, "First daily batch was not assessed");
    const firstBatch = database
      .prepare(
        `SELECT batch_id, candidate_count FROM project_metadata_proposal_batches
         WHERE project='tailortales' ORDER BY batch_number LIMIT 1`,
      )
      .get() as { batch_id: string; candidate_count: number };
    assert(firstBatch.candidate_count === 12, "Automatic batch exceeded the review limit");
    database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET batch_state='applied', completed_at='2026-08-20T08:00:00.000Z'
         WHERE batch_id=?`,
      )
      .run(firstBatch.batch_id);

    const limited = runDailyProposalCycle(
      database,
      "2026-08-20",
      true,
      worker,
      "tailortales",
    );
    assert(
      limited.results[0]?.action === "daily_limit" && Number(workerCalls) === 1,
      "A terminal batch admitted a second automatic batch on the same day",
    );

    const second = runDailyProposalCycle(
      database,
      "2026-08-21",
      true,
      worker,
      "tailortales",
    );
    assert(second.ok && Number(workerCalls) === 2, "Bootstrap did not continue next day");
    const secondBatch = database
      .prepare(
        `SELECT batch_id, candidate_count FROM project_metadata_proposal_batches
         WHERE project='tailortales' ORDER BY batch_number DESC LIMIT 1`,
      )
      .get() as { batch_id: string; candidate_count: number };
    assert(secondBatch.candidate_count === 12, "Second bootstrap chunk is not bounded");
    database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET batch_state='applied', completed_at='2026-08-21T08:00:00.000Z'
         WHERE batch_id=?`,
      )
      .run(secondBatch.batch_id);

    runDailyProposalCycle(database, "2026-08-22", true, worker, "tailortales");
    const thirdBatch = database
      .prepare(
        `SELECT batch_id, candidate_count FROM project_metadata_proposal_batches
         WHERE project='tailortales' ORDER BY batch_number DESC LIMIT 1`,
      )
      .get() as { batch_id: string; candidate_count: number };
    assert(
      thirdBatch.candidate_count === 1 && Number(workerCalls) === 3,
      "Final bootstrap remainder was not assessed as one small batch",
    );
    database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET batch_state='applied', completed_at='2026-08-22T08:00:00.000Z'
         WHERE batch_id=?`,
      )
      .run(thirdBatch.batch_id);

    const cursor = runDailyProposalCycle(
      database,
      "2026-08-23",
      true,
      worker,
      "tailortales",
    );
    assert(
      cursor.results[0]?.action === "cursor" && Number(workerCalls) === 3,
      "Completed bootstrap did not advance to idle without AI",
    );
    const idle = runDailyProposalCycle(
      database,
      "2026-08-24",
      true,
      worker,
      "tailortales",
    );
    assert(
      idle.results[0]?.action === "unchanged" && Number(workerCalls) === 3,
      "Unchanged project invoked another AI assessment",
    );

    database.exec(`
      DELETE FROM project_metadata_daily_admissions;
      DELETE FROM project_metadata_assessment_cursors WHERE project='tailortales';
      DELETE FROM project_metadata_field_ownership;
      DELETE FROM project_metadata_proposal_events;
      DELETE FROM project_metadata_proposals;
      DELETE FROM project_metadata_proposal_batches;
    `);
    const failed = runDailyProposalCycle(
      database,
      "2026-08-25",
      true,
      () => {
        throw new Error("worker unavailable");
      },
      "tailortales",
    );
    assert(!failed.ok && failed.failures === 1, "Worker failure was hidden");
    const resumable = planDailyProjectAssessment(database, "tailortales", "2026-08-25");
    assert(
      resumable.action === "resume",
      "A planned batch interrupted before AI could not be resumed safely",
    );
    const resumed = runDailyProposalCycle(
      database,
      "2026-08-25",
      true,
      worker,
      "tailortales",
    );
    assert(
      resumed.ok && resumed.results[0]?.action === "resumed",
      "Same-day recovery created a duplicate batch instead of resuming",
    );

    database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET batch_state='running', updated_at='2026-08-25T07:00:00.000Z'
         WHERE batch_id=?`,
      )
      .run((resumed.results[0] as { batchId: string }).batchId);
    const stale = planDailyProjectAssessment(database, "tailortales", "2026-08-26");
    assert(stale.action === "recover", "A prior-day running worker was not recoverable");
    const recovered = runDailyProposalCycle(
      database,
      "2026-08-26",
      true,
      worker,
      "tailortales",
    );
    assert(
      recovered.ok && recovered.results[0]?.action === "recovered",
      "Stale worker recovery did not create one bounded replacement",
    );

    const script = await readFile(resolve(app, "run-projects-digest.sh"), "utf8");
    assert(
      script.includes("if (( $# == 0 )); then") &&
        script.includes("metadata-proposal-scheduler.ts") &&
        script.includes("project-event-consumer.lock") &&
        script.includes("digest delivery continues"),
      "Daily-only scheduler boundary is missing from Projects Digest",
    );
    assert(
      database.prepare("PRAGMA foreign_key_check").all().length === 0,
      "Automatic proposal cycle left foreign-key violations",
    );
    database.close();

    process.stdout.write(
      `${JSON.stringify({ ok: true, populatedV21UpgradePreserved: true, dailyBatchLimit: 1, defaultIssuesPerDay: 12, configurableIssuesPerDay: "0-40", dryRunNoMutation: true, globalLlmCapacityRespected: true, eventDrivenCreationDisabled: true, controllerLockShared: true, bootstrapDays: 3, sameDayResume: true, staleWorkerRecovery: true, idleNoAi: true, workerFailureVisible: true, externalWrites: 0 })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
