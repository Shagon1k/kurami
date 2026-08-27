import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { skipBatch } from "./proposals/manager.ts";

process.umask(0o077);

type BatchRow = {
  batch_id: string;
  project: string;
  batch_number: number;
  batch_kind: string;
  batch_state: string;
  candidate_count: number;
  proposal_count: number;
  summary: string | null;
  sync_state: string;
  sync_attempt_count: number;
  sync_last_error: string | null;
  discussion_thread_id: string | null;
  discussion_archived_at: string | null;
};

type ProposalRow = {
  proposal_id: string;
  issue_number: number;
  title: string;
  url: string;
  field_name: "priority" | "effort";
  baseline_value: string | null;
  proposed_value: string;
  confidence: "high" | "medium";
  reason: string;
  evidence_json: string;
  proposal_state: string;
  previous_value: string | null;
  applied_value: string | null;
  failure_reason: string | null;
};

function fail(message: string): never {
  throw new Error(message);
}

function loadBatch(database: DatabaseSync, batchId: string): BatchRow {
  const row = database
    .prepare(
      `SELECT batch_id, project, batch_number, batch_kind, batch_state,
              candidate_count, proposal_count, summary, sync_state,
              sync_attempt_count, sync_last_error, discussion_thread_id,
              discussion_archived_at
       FROM project_metadata_proposal_batches WHERE batch_id = ?`,
    )
    .get(batchId) as BatchRow | undefined;
  if (!row) fail(`Metadata proposal batch not found: ${batchId}`);
  return row;
}

function proposals(database: DatabaseSync, batchId: string): ProposalRow[] {
  return database
    .prepare(
      `SELECT proposal_id, issue_number, title, url, field_name, baseline_value,
              proposed_value, confidence, reason, evidence_json, proposal_state,
              previous_value, applied_value, failure_reason
       FROM project_metadata_proposals
       WHERE batch_id = ?
       ORDER BY issue_number, field_name`,
    )
    .all(batchId) as ProposalRow[];
}

function recordEvent(
  database: DatabaseSync,
  batchId: string,
  eventType: string,
  details: unknown,
): void {
  database
    .prepare(
      `INSERT INTO project_metadata_proposal_events (
         event_id, batch_id, event_type, actor, details_json
       ) VALUES (?, ?, ?, 'discord_owner', ?)`,
    )
    .run(
      `pme_${randomUUID().replaceAll("-", "")}`,
      batchId,
      eventType,
      JSON.stringify(details),
    );
}

function status(database: DatabaseSync, batchId: string): Record<string, unknown> {
  const batch = loadBatch(database, batchId);
  const rows = proposals(database, batchId);
  const count = (state: string): number =>
    rows.filter(({ proposal_state }) => proposal_state === state).length;
  return {
    ok: true,
    action: "status",
    batchId,
    project: batch.project,
    batchNumber: batch.batch_number,
    batchKind: batch.batch_kind,
    batchState: batch.batch_state,
    candidateCount: batch.candidate_count,
    proposalCount: batch.proposal_count,
    summary: batch.summary,
    syncState: batch.sync_state,
    syncAttemptCount: batch.sync_attempt_count,
    syncLastError: batch.sync_last_error,
    discussionThreadId: batch.discussion_thread_id,
    counts: {
      pending: count("pending"),
      accepted: count("accepted"),
      skipped: count("skipped"),
      applied: count("applied"),
      conflicted: count("conflicted"),
      failed: count("failed"),
    },
    proposals: rows.map((row) => ({
      proposalId: row.proposal_id,
      issueNumber: row.issue_number,
      title: row.title,
      url: row.url,
      field: row.field_name,
      baselineValue: row.baseline_value,
      proposedValue: row.proposed_value,
      confidence: row.confidence,
      reason: row.reason,
      evidence: JSON.parse(row.evidence_json) as string[],
      state: row.proposal_state,
      previousValue: row.previous_value,
      appliedValue: row.applied_value,
      failureReason: row.failure_reason,
    })),
  };
}

function accept(
  database: DatabaseSync,
  batchId: string,
  apply: boolean,
): Record<string, unknown> {
  const batch = loadBatch(database, batchId);
  if (batch.batch_state !== "ready" && batch.batch_state !== "discussing")
    fail(`Metadata proposal batch is not acceptable: ${batch.batch_state}`);
  const pending = proposals(database, batchId).filter(
    ({ proposal_state }) => proposal_state === "pending",
  );
  if (pending.length === 0) fail("Metadata proposal batch has no pending proposals");
  if (!apply)
    return { ok: true, apply: false, action: "accept", batchId, proposals: pending.length };
  database.exec("BEGIN IMMEDIATE");
  try {
    const timestamp = new Date().toISOString();
    database
      .prepare(
        `UPDATE project_metadata_proposals
         SET proposal_state='accepted', accepted_by='discord_owner', accepted_at=?,
             updated_at=?
         WHERE batch_id=? AND proposal_state='pending'`,
      )
      .run(timestamp, timestamp, batchId);
    const changed = database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET batch_state='accepted', accepted_by='discord_owner', accepted_at=?,
             sync_state='queued', sync_attempt_count=0, sync_started_at=NULL,
             sync_completed_at=NULL, sync_last_error=NULL, updated_at=?
         WHERE batch_id=? AND batch_state IN ('ready', 'discussing')`,
      )
      .run(timestamp, timestamp, batchId);
    if (changed.changes !== 1) fail("Metadata proposal accept race");
    recordEvent(database, batchId, "accepted", { proposals: pending.length });
    database.exec("COMMIT");
    return {
      ok: true,
      apply: true,
      action: "accepted",
      batchId,
      proposals: pending.length,
      githubWrites: 0,
      discussionThreadId: batch.discussion_thread_id,
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function exclude(
  database: DatabaseSync,
  batchId: string,
  proposalIds: string[],
  apply: boolean,
): Record<string, unknown> {
  const batch = loadBatch(database, batchId);
  if (batch.batch_state !== "ready" && batch.batch_state !== "discussing")
    fail(`Metadata proposal batch does not accept exceptions: ${batch.batch_state}`);
  const pending = proposals(database, batchId).filter(
    ({ proposal_state }) => proposal_state === "pending",
  );
  const rows = proposals(database, batchId);
  const pendingIds = new Set(pending.map(({ proposal_id }) => proposal_id));
  const skippedIds = new Set(
    rows
      .filter(({ proposal_state }) => proposal_state === "skipped")
      .map(({ proposal_id }) => proposal_id),
  );
  const selected = [...new Set(proposalIds)];
  if (selected.length === 0) fail("Select at least one proposal to exclude");
  if (
    selected.some(
      (proposalId) => !pendingIds.has(proposalId) && !skippedIds.has(proposalId),
    )
  )
    fail("An excluded proposal does not belong to the reviewable batch state");
  const selectedPending = selected.filter((proposalId) => pendingIds.has(proposalId));
  if (selectedPending.length === pending.length && pending.length > 0)
    fail("Use Skip batch when every proposal should be excluded");
  if (selectedPending.length === 0)
    return {
      ok: true,
      apply,
      action: "unchanged",
      batchId,
      proposals: 0,
      alreadyExcluded: selected.length,
      remaining: pending.length,
      githubWrites: 0,
    };
  if (!apply)
    return {
      ok: true,
      apply: false,
      action: "exclude",
      batchId,
      proposals: selectedPending.length,
    };
  database.exec("BEGIN IMMEDIATE");
  try {
    const update = database.prepare(
      `UPDATE project_metadata_proposals
       SET proposal_state='skipped', updated_at=?
       WHERE proposal_id=? AND batch_id=? AND proposal_state='pending'`,
    );
    const timestamp = new Date().toISOString();
    for (const proposalId of selectedPending) {
      if (update.run(timestamp, proposalId, batchId).changes !== 1)
        fail(`Metadata proposal exception race: ${proposalId}`);
      recordEvent(database, batchId, "proposal_excluded", { proposalId });
    }
    database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET updated_at=? WHERE batch_id=? AND batch_state IN ('ready', 'discussing')`,
      )
      .run(timestamp, batchId);
    database.exec("COMMIT");
    return {
      ok: true,
      apply: true,
      action: "excluded",
      batchId,
      proposals: selectedPending.length,
      alreadyExcluded: selected.length - selectedPending.length,
      remaining: pending.length - selectedPending.length,
      githubWrites: 0,
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function restore(
  database: DatabaseSync,
  batchId: string,
  proposalIds: string[],
  apply: boolean,
): Record<string, unknown> {
  const batch = loadBatch(database, batchId);
  if (batch.batch_state !== "ready" && batch.batch_state !== "discussing")
    fail(`Metadata proposal batch does not accept restores: ${batch.batch_state}`);
  const rows = proposals(database, batchId);
  const pendingIds = new Set(
    rows
      .filter(({ proposal_state }) => proposal_state === "pending")
      .map(({ proposal_id }) => proposal_id),
  );
  const skippedIds = new Set(
    rows
      .filter(({ proposal_state }) => proposal_state === "skipped")
      .map(({ proposal_id }) => proposal_id),
  );
  const selected = [...new Set(proposalIds)];
  if (selected.length === 0) fail("Select at least one proposal to restore");
  if (
    selected.some(
      (proposalId) => !skippedIds.has(proposalId) && !pendingIds.has(proposalId),
    )
  )
    fail("A restored proposal does not belong to the reviewable batch state");
  const selectedSkipped = selected.filter((proposalId) => skippedIds.has(proposalId));
  if (selectedSkipped.length === 0)
    return {
      ok: true,
      apply,
      action: "unchanged",
      batchId,
      proposals: 0,
      alreadyPending: selected.length,
      remaining: pendingIds.size,
      githubWrites: 0,
    };
  if (!apply)
    return {
      ok: true,
      apply: false,
      action: "restore",
      batchId,
      proposals: selectedSkipped.length,
    };
  database.exec("BEGIN IMMEDIATE");
  try {
    const timestamp = new Date().toISOString();
    const update = database.prepare(
      `UPDATE project_metadata_proposals
       SET proposal_state='pending', updated_at=?
       WHERE proposal_id=? AND batch_id=? AND proposal_state='skipped'`,
    );
    for (const proposalId of selectedSkipped) {
      if (update.run(timestamp, proposalId, batchId).changes !== 1)
        fail(`Metadata proposal restore race: ${proposalId}`);
      recordEvent(database, batchId, "proposal_restored", { proposalId });
    }
    database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET updated_at=? WHERE batch_id=? AND batch_state IN ('ready', 'discussing')`,
      )
      .run(timestamp, batchId);
    database.exec("COMMIT");
    return {
      ok: true,
      apply: true,
      action: "restored",
      batchId,
      proposals: selectedSkipped.length,
      alreadyPending: selected.length - selectedSkipped.length,
      remaining: pendingIds.size + selectedSkipped.length,
      githubWrites: 0,
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function discuss(
  database: DatabaseSync,
  batchId: string,
  apply: boolean,
): Record<string, unknown> {
  const batch = loadBatch(database, batchId);
  if (batch.batch_state !== "ready" && batch.batch_state !== "discussing")
    fail(`Metadata proposal batch is not discussable: ${batch.batch_state}`);
  if (!apply)
    return {
      ok: true,
      apply: false,
      action: "discuss",
      batchId,
      discussionThreadId: batch.discussion_thread_id,
    };
  if (batch.batch_state === "ready") {
    const timestamp = new Date().toISOString();
    database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET batch_state='discussing', discussion_started_at=COALESCE(discussion_started_at, ?),
             discussion_archived_at=NULL, updated_at=?
         WHERE batch_id=? AND batch_state='ready'`,
      )
      .run(timestamp, timestamp, batchId);
    recordEvent(database, batchId, "discussion_requested", {});
  }
  return {
    ok: true,
    apply: true,
    action: "discussing",
    batchId,
    project: batch.project,
    batchNumber: batch.batch_number,
    discussionThreadId: batch.discussion_thread_id,
  };
}

function recordDiscussionThread(
  database: DatabaseSync,
  batchId: string,
  threadId: string,
  apply: boolean,
): Record<string, unknown> {
  const batch = loadBatch(database, batchId);
  if (batch.batch_state !== "discussing")
    fail(`Metadata proposal batch is not discussing: ${batch.batch_state}`);
  if (!/^\d+$/u.test(threadId)) fail("Invalid Discord discussion thread ID");
  if (batch.discussion_thread_id && batch.discussion_thread_id !== threadId)
    fail("Metadata proposal batch already owns a different discussion thread");
  if (batch.discussion_thread_id === threadId)
    return { ok: true, apply, action: "thread_already_recorded", batchId, threadId };
  if (!apply)
    return { ok: true, apply: false, action: "record_thread", batchId, threadId };
  const changed = database
    .prepare(
      `UPDATE project_metadata_proposal_batches
       SET discussion_thread_id=?, updated_at=?
       WHERE batch_id=? AND batch_state='discussing'
         AND (discussion_thread_id IS NULL OR discussion_thread_id=?)`,
    )
    .run(threadId, new Date().toISOString(), batchId, threadId);
  if (changed.changes !== 1) fail("Metadata discussion thread record race");
  recordEvent(database, batchId, "discussion_thread_recorded", { threadId });
  return { ok: true, apply: true, action: "thread_recorded", batchId, threadId };
}

function recordDiscussionArchived(
  database: DatabaseSync,
  batchId: string,
  apply: boolean,
): Record<string, unknown> {
  const batch = loadBatch(database, batchId);
  if (batch.batch_state !== "accepted" && batch.batch_state !== "skipped")
    fail(`Metadata proposal batch discussion is not archivable: ${batch.batch_state}`);
  if (!batch.discussion_thread_id)
    return { ok: true, apply, action: "no_discussion", batchId };
  if (batch.discussion_archived_at)
    return { ok: true, apply, action: "already_archived", batchId };
  if (!apply)
    return { ok: true, apply: false, action: "record_archive", batchId };
  const timestamp = new Date().toISOString();
  const changed = database
    .prepare(
      `UPDATE project_metadata_proposal_batches
       SET discussion_archived_at=?, updated_at=?
       WHERE batch_id=? AND batch_state IN ('accepted', 'skipped')
         AND discussion_archived_at IS NULL`,
    )
    .run(timestamp, timestamp, batchId);
  if (changed.changes === 1)
    recordEvent(database, batchId, "discussion_archived", {
      threadId: batch.discussion_thread_id,
    });
  return { ok: true, apply: true, action: "archive_recorded", batchId };
}

function retrySync(
  database: DatabaseSync,
  batchId: string,
  apply: boolean,
): Record<string, unknown> {
  const batch = loadBatch(database, batchId);
  if (
    batch.batch_state !== "accepted" ||
    batch.sync_state !== "failed" ||
    batch.sync_attempt_count < 2
  )
    fail("Metadata sync has not exhausted its automatic attempts");
  if (!apply)
    return {
      ok: true,
      apply: false,
      action: "retry_sync",
      batchId,
      previousAttempts: batch.sync_attempt_count,
    };
  const now = new Date().toISOString();
  const changed = database
    .prepare(
      `UPDATE project_metadata_proposal_batches
       SET sync_state='queued', sync_attempt_count=0, sync_started_at=NULL,
           sync_last_error=NULL, updated_at=?
       WHERE batch_id=? AND batch_state='accepted' AND sync_state='failed'
         AND sync_attempt_count>=2`,
    )
    .run(now, batchId);
  if (changed.changes !== 1) fail("Metadata sync retry race");
  recordEvent(database, batchId, "sync_retry_requested", {
    previousAttempts: batch.sync_attempt_count,
  });
  return {
    ok: true,
    apply: true,
    action: "sync_retry_queued",
    batchId,
    previousAttempts: batch.sync_attempt_count,
    githubWrites: 0,
  };
}

function parseArguments(args: string[]): {
  action: string;
  batchId: string;
  proposalIds: string[];
  threadId: string | null;
  apply: boolean;
} {
  const action = args[0] ?? "";
  const batchIndex = args.indexOf("--batch-id");
  const batchId = batchIndex >= 0 ? args[batchIndex + 1]?.trim() ?? "" : "";
  const threadIndex = args.indexOf("--thread-id");
  const threadId = threadIndex >= 0 ? args[threadIndex + 1]?.trim() ?? "" : null;
  const proposalIds = args.flatMap((arg, index) =>
    arg === "--proposal-id" ? [args[index + 1]?.trim() ?? ""] : [],
  );
  if (!(["status", "accept", "exclude", "restore", "discuss", "record-thread", "record-archive", "retry-sync", "skip"] as string[]).includes(action))
    fail("Unknown metadata proposal control action");
  if (!/^pmb_[a-f0-9]+$/u.test(batchId)) fail("--batch-id is required");
  if (proposalIds.some((proposalId) => !/^pmp_[a-f0-9]+$/u.test(proposalId)))
    fail("Invalid --proposal-id");
  const values = new Set([action, "--batch-id", batchId, "--proposal-id", ...proposalIds, "--thread-id", threadId, "--apply"]);
  if (args.some((arg) => !values.has(arg))) fail("Unknown metadata proposal control argument");
  return { action, batchId, proposalIds, threadId, apply: args.includes("--apply") };
}

export async function runMetadataProposalControlsCli(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2));
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ??
      process.env.ORCHESTRATOR_HOME ??
      resolve(import.meta.dirname, "../../../../.."),
  );
  const database = new DatabaseSync(resolve(orchestratorHome, "state/orchestrator.db"), {
    timeout: 5_000,
  });
  database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  try {
    let result: Record<string, unknown>;
    if (parsed.action === "status") result = status(database, parsed.batchId);
    else if (parsed.action === "accept") result = accept(database, parsed.batchId, parsed.apply);
    else if (parsed.action === "exclude")
      result = exclude(database, parsed.batchId, parsed.proposalIds, parsed.apply);
    else if (parsed.action === "restore")
      result = restore(database, parsed.batchId, parsed.proposalIds, parsed.apply);
    else if (parsed.action === "discuss") result = discuss(database, parsed.batchId, parsed.apply);
    else if (parsed.action === "record-thread") {
      if (!parsed.threadId) fail("--thread-id is required");
      result = recordDiscussionThread(database, parsed.batchId, parsed.threadId, parsed.apply);
    } else if (parsed.action === "record-archive") {
      result = recordDiscussionArchived(database, parsed.batchId, parsed.apply);
    } else if (parsed.action === "retry-sync") {
      result = retrySync(database, parsed.batchId, parsed.apply);
    } else {
      const batch = loadBatch(database, parsed.batchId);
      const skipped = skipBatch(
        database,
        parsed.batchId,
        parsed.apply,
        "discord_owner",
      );
      result = { ...skipped, discussionThreadId: batch.discussion_thread_id, githubWrites: 0 };
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  runMetadataProposalControlsCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
