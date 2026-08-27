import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type {
  TriageFacts,
  TriageItemFact,
} from "./orchestrator/projects/triage/snapshot.ts";
import { loadEffectiveOrchestratorConfig } from "./orchestrator/settings/runtime-settings.ts";

process.umask(0o077);

export const metadataProposalPolicyVersion = "metadata-v1";
// One detached AI request stays bounded even when the owner raises the daily limit.
export const maximumProposalBatchIssues = 12;
export const maximumProposalDailyIssues = 40;

export type MetadataFieldName = "priority" | "effort";

export type MetadataProposalCandidate = {
  itemId: string;
  repository: string;
  issueNumber: number;
  title: string;
  url: string;
  status: string;
  priority: string | null;
  effort: string | null;
  labels: string[];
  hasDescription: boolean;
  bodyDigest: string | null;
  createdAt: string | null;
  fields: MetadataFieldName[];
};

type SnapshotRow = {
  project: string;
  factual_hash: string;
  facts_json: string;
  change_sequence: number;
};

type CursorRow = {
  project: string;
  factual_hash: string;
  change_sequence: number;
};

type ActiveBatchRow = {
  batch_id: string;
  batch_state: string;
  factual_hash: string;
  source_items_json: string;
};

export type AssessmentPlan =
  | {
      project: string;
      action: "disabled";
      reason: "ai_triage_disabled";
    }
  | {
      project: string;
      action: "active";
      batchId: string;
      batchState: string;
      deferredFactualHash: string | null;
    }
  | {
      project: string;
      action: "unchanged";
      factualHash: string;
      changeSequence: number;
    }
  | {
      project: string;
      action: "cursor";
      factualHash: string;
      changeSequence: number;
      reason: "no_candidates" | "bootstrap_complete";
    }
  | {
      project: string;
      action: "create";
      batchKind: "bootstrap" | "changed";
      factualHash: string;
      changeSequence: number;
      candidates: MetadataProposalCandidate[];
      remainingCandidates: number;
      supersedeBatchId: string | null;
    };

function fail(message: string): never {
  throw new Error(message);
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function missing(value: string | null): boolean {
  return !value?.trim();
}

function requiredBacklogIssue(
  facts: TriageFacts,
  item: TriageItemFact,
): item is TriageItemFact & {
  repository: string;
  issueNumber: number;
  title: string;
  url: string;
  status: string;
} {
  return (
    item.contentType === "Issue" &&
    item.issueState === "OPEN" &&
    item.status === facts.statuses.backlog &&
    Boolean(item.repository?.trim()) &&
    Number.isInteger(item.issueNumber) &&
    item.issueNumber! > 0 &&
    Boolean(item.title?.trim()) &&
    Boolean(item.url?.startsWith("https://"))
  );
}

export function candidateFromFact(
  facts: TriageFacts,
  item: TriageItemFact,
): MetadataProposalCandidate | null {
  if (!requiredBacklogIssue(facts, item)) return null;
  const fields: MetadataFieldName[] = [];
  if (missing(item.priority)) fields.push("priority");
  if (missing(item.effort)) fields.push("effort");
  if (fields.length === 0) return null;
  return {
    itemId: item.itemId,
    repository: item.repository,
    issueNumber: item.issueNumber,
    title: item.title.trim(),
    url: item.url,
    status: item.status,
    priority: item.priority?.trim() || null,
    effort: item.effort?.trim() || null,
    labels: [...item.labels].sort((left, right) => left.localeCompare(right)),
    hasDescription: item.hasDescription,
    bodyDigest: item.bodyDigest,
    createdAt: item.createdAt,
    fields,
  };
}

export function proposalRelevantDigest(candidate: MetadataProposalCandidate): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        itemId: candidate.itemId,
        title: candidate.title,
        status: candidate.status,
        priority: candidate.priority,
        effort: candidate.effort,
        labels: candidate.labels,
        hasDescription: candidate.hasDescription,
        bodyDigest: candidate.bodyDigest,
        fields: candidate.fields,
      }),
    )
    .digest("hex");
}

function factsCandidates(facts: TriageFacts): MetadataProposalCandidate[] {
  return facts.items
    .map((item) => candidateFromFact(facts, item))
    .filter((item): item is MetadataProposalCandidate => item !== null);
}

function parseFacts(row: SnapshotRow): TriageFacts {
  const facts = JSON.parse(row.facts_json) as TriageFacts;
  if (facts.project !== row.project) fail(`Facts project mismatch: ${row.project}`);
  return facts;
}

function loadCurrent(database: DatabaseSync, project: string): SnapshotRow {
  const row = database
    .prepare(
      `SELECT project, factual_hash, facts_json, change_sequence
       FROM project_triage_state WHERE project = ?`,
    )
    .get(project) as SnapshotRow | undefined;
  if (!row) fail(`No Projects Digest facts found for project: ${project}`);
  return row;
}

function loadCursor(database: DatabaseSync, project: string): CursorRow | null {
  return (
    (database
      .prepare(
        `SELECT project, factual_hash, change_sequence
         FROM project_metadata_assessment_cursors WHERE project = ?`,
      )
      .get(project) as CursorRow | undefined) ?? null
  );
}

function loadActiveBatch(database: DatabaseSync, project: string): ActiveBatchRow | null {
  return (
    (database
      .prepare(
        `SELECT batch_id, batch_state, factual_hash, source_items_json
         FROM project_metadata_proposal_batches
         WHERE project = ?
           AND batch_state IN ('planned', 'running', 'ready', 'discussing', 'accepted')
         ORDER BY batch_number DESC LIMIT 1`,
      )
      .get(project) as ActiveBatchRow | undefined) ?? null
  );
}

function rankingOrder(database: DatabaseSync, project: string): Map<string, number> {
  const row = database
    .prepare("SELECT ranking_json FROM project_triage_rankings WHERE project = ?")
    .get(project) as { ranking_json: string } | undefined;
  if (!row) return new Map();
  const ranking = JSON.parse(row.ranking_json) as Array<{ itemId?: string }>;
  return new Map(
    ranking
      .filter((entry): entry is { itemId: string } => Boolean(entry.itemId))
      .map((entry, index) => [entry.itemId, index]),
  );
}

function ordered(
  database: DatabaseSync,
  project: string,
  candidates: MetadataProposalCandidate[],
): MetadataProposalCandidate[] {
  const order = rankingOrder(database, project);
  return [...candidates].sort(
    (left, right) =>
      (order.get(left.itemId) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.itemId) ?? Number.MAX_SAFE_INTEGER) ||
      left.issueNumber - right.issueNumber ||
      left.itemId.localeCompare(right.itemId),
  );
}

function assessedBootstrapItems(
  database: DatabaseSync,
  project: string,
  currentFacts: TriageFacts,
): Set<string> {
  const rows = database
    .prepare(
      `SELECT source_items_json
       FROM project_metadata_proposal_batches
       WHERE project = ? AND batch_kind = 'bootstrap'
         AND batch_state NOT IN ('failed', 'superseded')`,
    )
    .all(project) as Array<{ source_items_json: string }>;
  const current = new Map(
    factsCandidates(currentFacts).map((candidate) => [candidate.itemId, candidate]),
  );
  const assessed = new Set<string>();
  for (const { source_items_json } of rows) {
    for (const source of JSON.parse(source_items_json) as MetadataProposalCandidate[]) {
      const candidate = current.get(source.itemId);
      if (
        candidate &&
        proposalRelevantDigest(candidate) === proposalRelevantDigest(source)
      )
        assessed.add(source.itemId);
    }
  }
  return assessed;
}

function baselineFacts(
  database: DatabaseSync,
  project: string,
  sequence: number,
): TriageFacts | null {
  const row = database
    .prepare(
      `SELECT project, factual_hash, facts_json, change_sequence
       FROM project_triage_snapshots
       WHERE project = ? AND change_sequence = ?`,
    )
    .get(project, sequence) as SnapshotRow | undefined;
  return row ? parseFacts(row) : null;
}

function changedCandidates(
  currentFacts: TriageFacts,
  previousFacts: TriageFacts | null,
): MetadataProposalCandidate[] {
  const previous = new Map(
    (previousFacts ? factsCandidates(previousFacts) : []).map((candidate) => [
      candidate.itemId,
      proposalRelevantDigest(candidate),
    ]),
  );
  return factsCandidates(currentFacts).filter(
    (candidate) =>
      previous.get(candidate.itemId) !== proposalRelevantDigest(candidate),
  );
}

function activeBatchTargetChanged(
  active: ActiveBatchRow,
  currentFacts: TriageFacts,
): boolean {
  const current = new Map(
    factsCandidates(currentFacts).map((candidate) => [candidate.itemId, candidate]),
  );
  return (JSON.parse(active.source_items_json) as MetadataProposalCandidate[]).some(
    (source) => {
      const candidate = current.get(source.itemId);
      return (
        !candidate ||
        proposalRelevantDigest(candidate) !== proposalRelevantDigest(source)
      );
    },
  );
}

export function planProjectAssessment(
  database: DatabaseSync,
  project: string,
  dailyLimit = maximumProposalBatchIssues,
): AssessmentPlan {
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > maximumProposalDailyIssues)
    fail(`AI triage/day must be an integer between 0 and ${maximumProposalDailyIssues}`);
  if (dailyLimit === 0)
    return { project, action: "disabled", reason: "ai_triage_disabled" };
  const current = loadCurrent(database, project);
  const currentFacts = parseFacts(current);
  const cursor = loadCursor(database, project);
  const active = loadActiveBatch(database, project);
  if (active) {
    if (active.batch_state === "accepted") {
      return {
        project,
        action: "active",
        batchId: active.batch_id,
        batchState: active.batch_state,
        deferredFactualHash:
          active.factual_hash === current.factual_hash ? null : current.factual_hash,
      };
    }
    const targetChanged = activeBatchTargetChanged(active, currentFacts);
    if (!targetChanged) {
      return {
        project,
        action: "active",
        batchId: active.batch_id,
        batchState: active.batch_state,
        deferredFactualHash:
          active.factual_hash === current.factual_hash ? null : current.factual_hash,
      };
    }
  }

  let batchKind: "bootstrap" | "changed";
  let candidates: MetadataProposalCandidate[];
  if (!cursor) {
    batchKind = "bootstrap";
    const assessed = assessedBootstrapItems(database, project, currentFacts);
    candidates = factsCandidates(currentFacts).filter(
      ({ itemId }) => !assessed.has(itemId),
    );
  } else {
    if (cursor.factual_hash === current.factual_hash && !active) {
      return {
        project,
        action: "unchanged",
        factualHash: current.factual_hash,
        changeSequence: current.change_sequence,
      };
    }
    batchKind = "changed";
    candidates = changedCandidates(
      currentFacts,
      baselineFacts(database, project, cursor.change_sequence),
    );
  }

  if (active) {
    const sourceIds = new Set(
      (JSON.parse(active.source_items_json) as MetadataProposalCandidate[]).map(
        ({ itemId }) => itemId,
      ),
    );
    const currentById = new Map(
      factsCandidates(currentFacts).map((candidate) => [candidate.itemId, candidate]),
    );
    for (const itemId of sourceIds) {
      const currentCandidate = currentById.get(itemId);
      if (currentCandidate && !candidates.some((item) => item.itemId === itemId))
        candidates.push(currentCandidate);
    }
  }

  candidates = ordered(database, project, candidates);
  if (candidates.length === 0) {
    return {
      project,
      action: "cursor",
      factualHash: current.factual_hash,
      changeSequence: current.change_sequence,
      reason: cursor ? "no_candidates" : "bootstrap_complete",
    };
  }
  return {
    project,
    action: "create",
    batchKind,
    factualHash: current.factual_hash,
    changeSequence: current.change_sequence,
    candidates: candidates.slice(0, dailyLimit),
    remainingCandidates: Math.max(0, candidates.length - dailyLimit),
    supersedeBatchId: active?.batch_id ?? null,
  };
}

function recordEvent(
  database: DatabaseSync,
  batchId: string,
  eventType: string,
  details: unknown,
  actor = "kurami",
): void {
  database
    .prepare(
      `INSERT INTO project_metadata_proposal_events (
         event_id, batch_id, event_type, actor, details_json
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id("pme"), batchId, eventType, actor, JSON.stringify(details));
}

function updateCursor(
  database: DatabaseSync,
  project: string,
  factualHash: string,
  changeSequence: number,
  batchId: string | null,
): void {
  database
    .prepare(
      `INSERT INTO project_metadata_assessment_cursors (
         project, factual_hash, change_sequence, assessed_at, last_batch_id
       ) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
       ON CONFLICT(project) DO UPDATE SET
         factual_hash=excluded.factual_hash,
         change_sequence=excluded.change_sequence,
         assessed_at=excluded.assessed_at,
         last_batch_id=excluded.last_batch_id`,
    )
    .run(project, factualHash, changeSequence, batchId);
}

export function applyAssessmentPlan(
  database: DatabaseSync,
  plan: AssessmentPlan,
): Record<string, unknown> {
  if (plan.action === "disabled" || plan.action === "active" || plan.action === "unchanged")
    return plan;
  database.exec("BEGIN IMMEDIATE");
  try {
    if (plan.action === "cursor") {
      updateCursor(
        database,
        plan.project,
        plan.factualHash,
        plan.changeSequence,
        null,
      );
      database.exec("COMMIT");
      return { ...plan, applied: true };
    }
    const batchId = id("pmb");
    if (plan.supersedeBatchId) {
      database
        .prepare(
          `UPDATE project_metadata_proposal_batches
           SET batch_state='superseded',
               completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE batch_id=?
             AND batch_state IN ('planned', 'running', 'ready', 'discussing')`,
        )
        .run(plan.supersedeBatchId);
    }
    const nextNumber = (
      database
        .prepare(
          `SELECT COALESCE(MAX(batch_number), 0) + 1 AS value
           FROM project_metadata_proposal_batches WHERE project = ?`,
        )
        .get(plan.project) as { value: number }
    ).value;
    const source = JSON.stringify(plan.candidates);
    const digest = createHash("sha256").update(source).digest("hex");
    database
      .prepare(
        `INSERT INTO project_metadata_proposal_batches (
           batch_id, project, batch_number, batch_kind, batch_state,
           factual_hash, change_sequence, source_items_json, source_digest,
           candidate_count
         ) VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?)`,
      )
      .run(
        batchId,
        plan.project,
        nextNumber,
        plan.batchKind,
        plan.factualHash,
        plan.changeSequence,
        source,
        digest,
        plan.candidates.length,
      );
    if (plan.supersedeBatchId) {
      database
        .prepare(
          `UPDATE project_metadata_proposal_batches
           SET superseded_by_batch_id=? WHERE batch_id=?`,
        )
        .run(batchId, plan.supersedeBatchId);
      recordEvent(database, plan.supersedeBatchId, "superseded", {
        supersededByBatchId: batchId,
      });
    }
    recordEvent(database, batchId, "planned", {
      policyVersion: metadataProposalPolicyVersion,
      candidateCount: plan.candidates.length,
      remainingCandidates: plan.remainingCandidates,
    });
    database.exec("COMMIT");
    return { ...plan, applied: true, batchId, batchNumber: nextNumber };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function projects(database: DatabaseSync, selectedProject: string | null): string[] {
  const rows = database
    .prepare(
      `SELECT project FROM project_triage_state
       WHERE (? IS NULL OR project = ?) ORDER BY project`,
    )
    .all(selectedProject, selectedProject) as Array<{ project: string }>;
  if (selectedProject && rows.length === 0)
    fail(`No Projects Digest facts found for project: ${selectedProject}`);
  return rows.map(({ project }) => project);
}

function parsePrepareArgs(args: string[]): { project: string | null; apply: boolean } {
  const projectIndex = args.indexOf("--project");
  const project = projectIndex === -1 ? null : args[projectIndex + 1]?.trim();
  if (projectIndex !== -1 && (!project || project.startsWith("--")))
    fail("--project requires a value");
  const known = new Set(["prepare", "--project", project, "--apply"]);
  if (args[0] !== "prepare" || args.some((arg) => !known.has(arg)))
    fail(
      "Usage: metadata-proposal-manager.ts prepare [--project <project>] [--apply]",
    );
  return { project, apply: args.includes("--apply") };
}

function parseSkipArgs(args: string[]): { batchId: string; apply: boolean } {
  const index = args.indexOf("--batch-id");
  const batchId = index === -1 ? "" : args[index + 1]?.trim() ?? "";
  const known = new Set(["skip", "--batch-id", batchId, "--apply"]);
  if (
    args[0] !== "skip" ||
    !/^pmb_[a-f0-9]+$/u.test(batchId) ||
    args.some((arg) => !known.has(arg))
  )
    fail(
      "Usage: metadata-proposal-manager.ts skip --batch-id <batch_id> [--apply]",
    );
  return { batchId, apply: args.includes("--apply") };
}

export function skipBatch(
  database: DatabaseSync,
  batchId: string,
  apply: boolean,
  actor = "kurami",
): Record<string, unknown> {
  const row = database
    .prepare(
      `SELECT batch_id, project, batch_kind, batch_state, factual_hash, change_sequence
       FROM project_metadata_proposal_batches WHERE batch_id = ?`,
    )
    .get(batchId) as
    | {
        batch_id: string;
        project: string;
        batch_kind: "bootstrap" | "changed";
        batch_state: string;
        factual_hash: string;
        change_sequence: number;
      }
    | undefined;
  if (!row) fail(`Metadata proposal batch not found: ${batchId}`);
  if (!(row.batch_state === "ready" || row.batch_state === "discussing"))
    fail(`Metadata proposal batch is not skippable: ${row.batch_state}`);
  if (!apply) return { ok: true, apply: false, action: "skip", batchId };
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET batch_state='skipped', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE batch_id=?`,
      )
      .run(batchId);
    database
      .prepare(
        `UPDATE project_metadata_proposals
         SET proposal_state='skipped', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE batch_id=? AND proposal_state='pending'`,
      )
      .run(batchId);
    recordEvent(database, batchId, "skipped", {}, actor);
    let remainingBootstrapCandidates = 0;
    let bootstrapCursor:
      | { factualHash: string; changeSequence: number }
      | null = null;
    if (row.batch_kind === "bootstrap") {
      const current = loadCurrent(database, row.project);
      const currentFacts = parseFacts(current);
      const assessed = assessedBootstrapItems(database, row.project, currentFacts);
      remainingBootstrapCandidates = factsCandidates(currentFacts).filter(
        ({ itemId }) => !assessed.has(itemId),
      ).length;
      bootstrapCursor = {
        factualHash: current.factual_hash,
        changeSequence: current.change_sequence,
      };
    }
    if (row.batch_kind === "changed" || remainingBootstrapCandidates === 0) {
      updateCursor(
        database,
        row.project,
        bootstrapCursor?.factualHash ?? row.factual_hash,
        bootstrapCursor?.changeSequence ?? row.change_sequence,
        batchId,
      );
    }
    database.exec("COMMIT");
    return {
      ok: true,
      apply: true,
      action: "skipped",
      batchId,
      remainingBootstrapCandidates,
      cursorAdvanced:
        row.batch_kind === "changed" || remainingBootstrapCandidates === 0,
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const database = new DatabaseSync(
    resolve(orchestratorHome, "state/orchestrator.db"),
    { timeout: 5_000 },
  );
  database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  try {
    if (args[0] === "prepare") {
      const parsed = parsePrepareArgs(args);
      const config = await loadEffectiveOrchestratorConfig(orchestratorHome);
      const plans = projects(database, parsed.project).map((project) =>
        planProjectAssessment(database, project, config.limits.ai_triage_daily),
      );
      const results = parsed.apply
        ? plans.map((plan) => applyAssessmentPlan(database, plan))
        : plans;
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: parsed.apply, results })}\n`,
      );
      return;
    }
    if (args[0] === "skip") {
      const parsed = parseSkipArgs(args);
      process.stdout.write(
        `${JSON.stringify(skipBatch(database, parsed.batchId, parsed.apply))}\n`,
      );
      return;
    }
    fail("Usage: metadata-proposal-manager.ts <prepare|skip> ...");
  } finally {
    database.close();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
