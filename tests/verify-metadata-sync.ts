import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  decideSync,
  claimSync,
  inspectAcceptedBatch,
  markGlobalFailure,
  planNextSync,
  recoverStaleSyncs,
  syncAcceptedBatch,
  type MetadataProjectClient,
  type ProjectDefinition,
} from "../src/metadata-sync.ts";
import * as canonicalSync from "../src/orchestrator/projects/metadata/sync.ts";
import * as legacySync from "../src/metadata-sync.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class FakeGithub implements MetadataProjectClient {
  readonly values = new Map<string, string | null>();
  readonly failingReads = new Set<string>();
  readonly writes: Array<{
    projectId: string;
    itemId: string;
    fieldId: string;
    optionId: string;
  }> = [];
  readonly definition: ProjectDefinition = {
    projectId: "PVT_project",
    fields: {
      priority: {
        id: "PVTSSF_priority",
        name: "Priority",
        options: ["P1", "P2", "P3"].map((name) => ({ id: `priority-${name}`, name })),
      },
      effort: {
        id: "PVTSSF_effort",
        name: "Effort",
        options: ["XS", "S", "M", "L", "XL"].map((name) => ({ id: `effort-${name}`, name })),
      },
    },
  };

  resolveProject(): ProjectDefinition {
    return this.definition;
  }

  readField(itemId: string, fieldName: string): string | null {
    if (this.failingReads.has(`${itemId}:${fieldName}`))
      throw new Error("temporary read failure");
    return this.values.get(`${itemId}:${fieldName}`) ?? null;
  }

  writeField(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): void {
    this.writes.push({ projectId, itemId, fieldId, optionId });
    const fieldName = fieldId === "PVTSSF_priority" ? "Priority" : "Effort";
    const option = Object.values(this.definition.fields)
      .flatMap(({ options }) => options)
      .find(({ id }) => id === optionId);
    if (!option) throw new Error(`Unknown fake option: ${optionId}`);
    this.values.set(`${itemId}:${fieldName}`, option.name);
  }
}

const config = {
  owner: "Shagon1k",
  project_number: 2,
  repository: "Shagon1k/TailorTales",
  triage: { priority_field: "Priority", effort_field: "Effort" },
};

function insertBatch(
  database: DatabaseSync,
  batchId: string,
  batchNumber: number,
  proposals: Array<{
    id: string;
    item: string;
    issue: number;
    field: "priority" | "effort";
    value: string;
  }>,
): void {
  database
    .prepare(
      `INSERT INTO project_metadata_proposal_batches (
         batch_id, project, batch_number, batch_kind, batch_state,
         factual_hash, change_sequence, source_items_json, source_digest,
         candidate_count, proposal_count, accepted_by, accepted_at, sync_state,
         sync_attempt_count, sync_started_at
       ) VALUES (?, 'tailortales', ?, 'changed', 'accepted', ?, ?, '[]', ?,
                 ?, ?, 'discord_owner', ?, 'syncing', 1, ?)`,
    )
    .run(
      batchId,
      batchNumber,
      String(batchNumber).repeat(64).slice(0, 64),
      batchNumber,
      "d".repeat(64),
      new Set(proposals.map(({ item }) => item)).size,
      proposals.length,
      "2026-08-20T12:00:00.000Z",
      "2026-08-20T12:01:00.000Z",
    );
  const insert = database.prepare(
    `INSERT INTO project_metadata_proposals (
       proposal_id, batch_id, item_id, repository, issue_number, title, url,
       field_name, baseline_value, proposed_value, confidence, reason,
       evidence_json, proposal_state, accepted_by, accepted_at
     ) VALUES (?, ?, ?, 'Shagon1k/TailorTales', ?, ?, ?, ?, NULL, ?, 'high',
               'Evidence-backed proposal.', '[]', 'accepted', 'discord_owner', ?)`,
  );
  for (const proposal of proposals)
    insert.run(
      proposal.id,
      batchId,
      proposal.item,
      proposal.issue,
      `Issue ${proposal.issue}`,
      `https://example.invalid/issues/${proposal.issue}`,
      proposal.field,
      proposal.value,
      "2026-08-20T12:00:00.000Z",
    );
}

async function main(): Promise<void> {
  assert(
    legacySync.planNextSync === canonicalSync.planNextSync &&
      legacySync.syncAcceptedBatch === canonicalSync.syncAcceptedBatch &&
      legacySync.runMetadataSyncCli === canonicalSync.runMetadataSyncCli,
    "Legacy metadata sync is not a transparent compatibility wrapper",
  );
  const app = resolve(import.meta.dirname, "..");
  const migrationsDirectory = resolve(app, "migrations");
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
  const home = await mkdtemp(resolve(tmpdir(), "kurami-metadata-sync-"));
  try {
    const upgrade = new DatabaseSync(resolve(home, "upgrade-v20.db"));
    upgrade.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations.filter((name) => name <= "020_metadata_owner_review.sql"))
      upgrade.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    upgrade.exec(`
      INSERT INTO project_metadata_proposal_batches (
        batch_id, project, batch_number, batch_kind, batch_state, factual_hash,
        change_sequence, source_items_json, source_digest, candidate_count,
        proposal_count, accepted_by, accepted_at
      ) VALUES (
        'pmb_upgrade', 'tailortales', 1, 'changed', 'accepted', '${"a".repeat(64)}',
        1, '[]', '${"b".repeat(64)}', 1, 0, 'discord_owner',
        '2026-08-20T12:00:00.000Z'
      );
    `);
    upgrade.exec(
      await readFile(resolve(migrationsDirectory, "021_guarded_metadata_sync.sql"), "utf8"),
    );
    const upgraded = upgrade
      .prepare(
        `SELECT batch_state, sync_state, sync_attempt_count
         FROM project_metadata_proposal_batches WHERE batch_id='pmb_upgrade'`,
      )
      .get() as Record<string, unknown>;
    assert(
      upgraded.batch_state === "accepted" &&
        upgraded.sync_state === "queued" &&
        upgraded.sync_attempt_count === 0,
      "Schema 21 did not queue a populated v20 accepted batch",
    );
    upgrade.close();

    const database = new DatabaseSync(resolve(home, "orchestrator.db"));
    database.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations)
      database.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));

    const github = new FakeGithub();
    github.values.set("item-owner:Effort", "L");
    github.values.set("item-owned:Effort", "S");
    github.values.set("item-satisfied:Effort", "XL");
    database.exec(`
      INSERT INTO project_metadata_proposal_batches (
        batch_id, project, batch_number, batch_kind, batch_state, factual_hash,
        change_sequence, source_items_json, source_digest, candidate_count,
        proposal_count, completed_at
      ) VALUES (
        'pmb_previous', 'tailortales', 1, 'changed', 'applied', '${"e".repeat(64)}',
        1, '[]', '${"f".repeat(64)}', 1, 1, '2026-08-20T11:00:00.000Z'
      );
      INSERT INTO project_metadata_proposals (
        proposal_id, batch_id, item_id, repository, issue_number, title, url,
        field_name, proposed_value, confidence, reason, evidence_json,
        proposal_state, applied_value, applied_at
      ) VALUES (
        'pmp_previous', 'pmb_previous', 'item-owned', 'Shagon1k/TailorTales', 3,
        'Owned issue', 'https://example.invalid/issues/3', 'effort', 'S', 'high',
        'Prior bot proposal.', '[]', 'applied', 'S', '2026-08-20T11:00:00.000Z'
      );
      INSERT INTO project_metadata_field_ownership (
        project, item_id, field_name, repository, issue_number, batch_id,
        proposal_id, applied_value, applied_at, updated_at
      ) VALUES (
        'tailortales', 'item-owned', 'effort', 'Shagon1k/TailorTales', 3,
        'pmb_previous', 'pmp_previous', 'S', '2026-08-20T11:00:00.000Z',
        '2026-08-20T11:00:00.000Z'
      );
    `);
    insertBatch(database, "pmb_sync", 2, [
      { id: "pmp_blank", item: "item-blank", issue: 1, field: "priority", value: "P2" },
      { id: "pmp_owner", item: "item-owner", issue: 2, field: "effort", value: "M" },
      { id: "pmp_owned", item: "item-owned", issue: 3, field: "effort", value: "M" },
      { id: "pmp_satisfied", item: "item-satisfied", issue: 4, field: "effort", value: "XL" },
    ]);
    database.exec(`
      UPDATE project_metadata_proposal_batches
      SET sync_state='queued', sync_attempt_count=0, sync_started_at=NULL
      WHERE batch_id='pmb_sync';
    `);
    const inspection = inspectAcceptedBatch(database, "pmb_sync", config, github) as {
      counts: Record<string, number>;
      externalWrites: number;
    };
    assert(
      inspection.counts.write === 2 &&
        inspection.counts.satisfied === 1 &&
        inspection.counts.conflict === 1 &&
        inspection.externalWrites === 0 &&
        github.writes.length === 0,
      "Read-only live-field verification changed state or lost a guarded outcome",
    );
    const claimedSync = claimSync(database, "pmb_sync");
    assert(claimedSync.sync_state === "syncing", "Verified batch could not be claimed");
    const result = syncAcceptedBatch(database, "pmb_sync", config, github);
    assert(result.action === "partially_applied", "Mixed guarded sync was not partial");
    assert(
      github.writes.slice().length === 2,
      "Guarded sync wrote an unsafe or duplicate field",
    );
    assert(
      github.values.get("item-owner:Effort") === "L",
      "Owner-authored value was overwritten",
    );
    const states = database
      .prepare(
        `SELECT proposal_id, proposal_state FROM project_metadata_proposals
         WHERE batch_id='pmb_sync' ORDER BY proposal_id`,
      )
      .all() as Array<{ proposal_id: string; proposal_state: string }>;
    assert(
      states.map(({ proposal_state }) => proposal_state).join(",") ===
        "applied,applied,conflicted,applied",
      "Proposal outcomes do not preserve owner drift",
    );
    const ownership = database
      .prepare(
        `SELECT item_id, applied_value FROM project_metadata_field_ownership
         WHERE project='tailortales' ORDER BY item_id`,
      )
      .all() as Array<{ item_id: string; applied_value: string }>;
    assert(
      JSON.stringify(ownership) ===
        JSON.stringify([
          { item_id: "item-blank", applied_value: "P2" },
          { item_id: "item-owned", applied_value: "M" },
        ]),
      "Bot ownership was not recorded conservatively",
    );

    insertBatch(database, "pmb_next", 3, [
      { id: "pmp_next", item: "item-owned", issue: 3, field: "effort", value: "L" },
    ]);
    const next = syncAcceptedBatch(database, "pmb_next", config, github);
    assert(next.action === "applied", "Bot-owned value was not safely updatable");
    assert(github.values.get("item-owned:Effort") === "L", "Bot-owned update was lost");

    github.values.set("item-owned:Effort", "XL");
    insertBatch(database, "pmb_drift", 4, [
      { id: "pmp_drift", item: "item-owned", issue: 3, field: "effort", value: "S" },
    ]);
    const writesBeforeDrift = github.writes.length;
    const drift = syncAcceptedBatch(database, "pmb_drift", config, github);
    assert(drift.action === "partially_applied", "Owner drift did not produce partial result");
    assert(
      github.writes.length === writesBeforeDrift && github.values.get("item-owned:Effort") === "XL",
      "Manual value after bot ownership was overwritten",
    );

    const p0 = decideSync(
      { field_name: "priority", proposed_value: "P0" },
      null,
      null,
      github.definition.fields.priority,
    );
    assert(p0.action === "failed", "P0 passed the final sync boundary");

    insertBatch(database, "pmb_retry", 5, [
      { id: "pmp_retry", item: "item-retry", issue: 5, field: "effort", value: "M" },
    ]);
    database.exec(`
      UPDATE project_metadata_proposal_batches
      SET sync_state='queued', sync_attempt_count=0, sync_started_at=NULL
      WHERE batch_id='pmb_retry';
    `);
    const dryPlan = planNextSync(database, "tailortales");
    assert(
      dryPlan?.batch_id === "pmb_retry" && dryPlan.sync_attempt_count === 0,
      "Read-only sync planning mutated the accepted batch",
    );
    const firstClaim = claimSync(database, "pmb_retry");
    const firstFailure = markGlobalFailure(database, firstClaim, new Error("temporary"));
    assert(firstFailure.action === "retry_scheduled", "First failure did not schedule one retry");
    const secondPlan = planNextSync(database, "tailortales");
    assert(secondPlan?.batch_id === "pmb_retry", "Bounded retry was not planned");
    const secondClaim = claimSync(database, "pmb_retry");
    const secondFailure = markGlobalFailure(database, secondClaim, new Error("still failing"));
    assert(secondFailure.action === "needs_attention", "Retry budget exhaustion was hidden");
    assert(
      planNextSync(database, "tailortales") === null,
      "Exhausted metadata sync entered an infinite retry loop",
    );

    database.exec(`
      UPDATE project_metadata_proposal_batches
      SET sync_state='syncing', sync_started_at='2026-08-20T00:00:00.000Z'
      WHERE batch_id='pmb_retry';
    `);
    assert(
      JSON.stringify(recoverStaleSyncs(database, "tailortales")) ===
        JSON.stringify(["pmb_retry"]),
      "Stale metadata sync claim was not recovered",
    );
    assert(
      planNextSync(database, "tailortales") === null,
      "Recovered exhausted claim unexpectedly regained retry authority",
    );
    database.exec(`
      UPDATE project_metadata_proposal_batches
      SET batch_state='failed', completed_at='2026-08-20T13:04:00.000Z'
      WHERE batch_id='pmb_retry';
    `);

    insertBatch(database, "pmb_transient", 6, [
      { id: "pmp_transient_ok", item: "item-transient-ok", issue: 6, field: "effort", value: "S" },
      { id: "pmp_transient_wait", item: "item-transient-wait", issue: 7, field: "effort", value: "M" },
    ]);
    github.failingReads.add("item-transient-wait:Effort");
    let transientError: unknown;
    try {
      syncAcceptedBatch(database, "pmb_transient", config, github);
    } catch (error) {
      transientError = error;
    }
    assert(transientError instanceof Error, "Transient field failure was hidden");
    const transientBatch = database
      .prepare(
        `SELECT batch_id, project, batch_number, batch_state, sync_state,
                sync_attempt_count, sync_started_at
         FROM project_metadata_proposal_batches WHERE batch_id='pmb_transient'`,
      )
      .get() as Parameters<typeof markGlobalFailure>[1];
    const transientRetry = markGlobalFailure(database, transientBatch, transientError);
    assert(transientRetry.action === "retry_scheduled", "Transient field failure was not bounded-retryable");
    const transientStates = database
      .prepare(
        `SELECT proposal_state FROM project_metadata_proposals
         WHERE batch_id='pmb_transient' ORDER BY proposal_id`,
      )
      .all() as Array<{ proposal_state: string }>;
    assert(
      transientStates.map(({ proposal_state }) => proposal_state).join(",") === "applied,accepted",
      "Transient failure discarded partial progress or became terminal too early",
    );
    github.failingReads.clear();
    claimSync(database, "pmb_transient");
    const transientRecovered = syncAcceptedBatch(database, "pmb_transient", config, github);
    assert(
      transientRecovered.action === "applied" &&
        github.writes.filter(({ itemId }) => itemId === "item-transient-ok").length === 1,
      "Bounded retry repeated a completed write or failed to resume the pending field",
    );
    const events = database
      .prepare(
        `SELECT event_type, actor FROM project_metadata_proposal_events
         WHERE batch_id='pmb_sync' ORDER BY occurred_at, rowid`,
      )
      .all() as Array<{ event_type: string; actor: string }>;
    assert(
      events.some(({ event_type }) => event_type === "owner_value_preserved") &&
        events.every(({ actor }) => actor === "kurami_sync"),
      "Guarded sync provenance is incomplete",
    );
    database.close();

    process.stdout.write(
      `${JSON.stringify({ ok: true, populatedV20Queued: true, readOnlyLiveVerification: true, blankOnlyFirstWrite: true, ownerValuesPreserved: true, botOwnedUpdates: true, manualDriftProtected: true, alreadySatisfiedNoWrite: true, p0FinalBoundary: true, fieldOwnership: true, dryPlanNoMutation: true, transientFieldRetry: true, partialProgressPreserved: true, staleClaimRecovery: true, maxAttempts: 2, exhaustedState: "needs_attention", appendOnlyProvenance: true, writes: github.writes.length })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
