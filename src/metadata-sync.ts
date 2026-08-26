import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";

process.umask(0o077);

const maximumSyncAttempts = 2;
const staleSyncMilliseconds = 15 * 60 * 1_000;

type ProjectConfig = {
  owner: string;
  project_number: number;
  repository: string;
  triage?: { priority_field?: string; effort_field?: string };
};

type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type BatchRow = {
  batch_id: string;
  project: string;
  batch_number: number;
  batch_state: string;
  sync_state: string;
  sync_attempt_count: number;
  sync_started_at: string | null;
};

type ProposalRow = {
  proposal_id: string;
  batch_id: string;
  item_id: string;
  repository: string;
  issue_number: number;
  field_name: "priority" | "effort";
  proposed_value: string;
  proposal_state: string;
};

type OwnershipRow = { applied_value: string };

export type ProjectField = {
  id: string;
  name: string;
  options: Array<{ id: string; name: string }>;
};

export type ProjectDefinition = {
  projectId: string;
  fields: Record<"priority" | "effort", ProjectField>;
};

export interface MetadataProjectClient {
  resolveProject(config: ProjectConfig): ProjectDefinition;
  readField(itemId: string, fieldName: string): string | null;
  writeField(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): void;
}

export type SyncDecision =
  | { action: "satisfied"; currentValue: string }
  | { action: "write"; previousValue: string | null; optionId: string }
  | { action: "conflict"; currentValue: string; reason: string }
  | { action: "failed"; reason: string };

function fail(message: string): never {
  throw new Error(message);
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function fieldName(config: ProjectConfig, field: "priority" | "effort"): string {
  if (field === "priority") return config.triage?.priority_field?.trim() || "Priority";
  return config.triage?.effort_field?.trim() || "Effort";
}

function ghGraphql(query: string, variables: Record<string, string | number>): unknown {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) args.push("-F", `${key}=${value}`);
  return JSON.parse(
    execFileSync("gh", args, {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

class GithubProjectClient implements MetadataProjectClient {
  resolveProject(config: ProjectConfig): ProjectDefinition {
    const priority = fieldName(config, "priority");
    const effort = fieldName(config, "effort");
    const query = `
      query($owner: String!, $number: Int!) {
        user(login: $owner) {
          projectV2(number: $number) {
            id
            priority: field(name: ${JSON.stringify(priority)}) {
              ... on ProjectV2SingleSelectField { id name options { id name } }
            }
            effort: field(name: ${JSON.stringify(effort)}) {
              ... on ProjectV2SingleSelectField { id name options { id name } }
            }
          }
        }
      }
    `;
    const response = ghGraphql(query, {
      owner: config.owner,
      number: config.project_number,
    }) as {
      data?: {
        user?: {
          projectV2?: {
            id?: string;
            priority?: ProjectField;
            effort?: ProjectField;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (response.errors?.length)
      fail(response.errors.map(({ message }) => message).join("; "));
    const project = response.data?.user?.projectV2;
    if (!project?.id || !project.priority?.id || !project.effort?.id)
      fail("Configured GitHub Project metadata fields could not be resolved");
    return {
      projectId: project.id,
      fields: { priority: project.priority, effort: project.effort },
    };
  }

  readField(itemId: string, name: string): string | null {
    const query = `
      query($item: ID!, $field: String!) {
        node(id: $item) {
          ... on ProjectV2Item {
            id
            value: fieldValueByName(name: $field) {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
              ... on ProjectV2ItemFieldNumberValue { number }
            }
          }
        }
      }
    `;
    const response = ghGraphql(query, { item: itemId, field: name }) as {
      data?: { node?: { id?: string; value?: { name?: string; number?: number } | null } };
      errors?: Array<{ message: string }>;
    };
    if (response.errors?.length)
      fail(response.errors.map(({ message }) => message).join("; "));
    const item = response.data?.node;
    if (!item?.id) fail(`GitHub Project item is unavailable: ${itemId}`);
    const value = item.value;
    if (typeof value?.name === "string" && value.name.trim()) return value.name.trim();
    if (typeof value?.number === "number" && Number.isFinite(value.number))
      return String(value.number);
    return null;
  }

  writeField(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): void {
    const mutation = `
      mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $project,
          itemId: $item,
          fieldId: $field,
          value: { singleSelectOptionId: $option }
        }) { projectV2Item { id } }
      }
    `;
    const response = ghGraphql(mutation, {
      project: projectId,
      item: itemId,
      field: fieldId,
      option: optionId,
    }) as { data?: { updateProjectV2ItemFieldValue?: { projectV2Item?: { id?: string } } }; errors?: Array<{ message: string }> };
    if (response.errors?.length)
      fail(response.errors.map(({ message }) => message).join("; "));
    if (!response.data?.updateProjectV2ItemFieldValue?.projectV2Item?.id)
      fail("GitHub Project metadata mutation returned no item");
  }
}

export function decideSync(
  proposal: Pick<ProposalRow, "field_name" | "proposed_value">,
  currentValue: string | null,
  ownedValue: string | null,
  field: ProjectField,
): SyncDecision {
  if (proposal.field_name === "priority" && proposal.proposed_value === "P0")
    return { action: "failed", reason: "P0 is owner-only" };
  if (currentValue === proposal.proposed_value)
    return { action: "satisfied", currentValue };
  if (currentValue !== null && currentValue !== ownedValue)
    return {
      action: "conflict",
      currentValue,
      reason: "Current GitHub value is owner-authored or changed after proposal review",
    };
  const option = field.options.find(({ name }) => name === proposal.proposed_value);
  if (!option)
    return {
      action: "failed",
      reason: `Configured field has no ${proposal.proposed_value} option`,
    };
  return { action: "write", previousValue: currentValue, optionId: option.id };
}

function loadBatch(database: DatabaseSync, batchId: string): BatchRow {
  const row = database
    .prepare(
      `SELECT batch_id, project, batch_number, batch_state, sync_state,
              sync_attempt_count, sync_started_at
       FROM project_metadata_proposal_batches WHERE batch_id=?`,
    )
    .get(batchId) as BatchRow | undefined;
  if (!row) fail(`Metadata proposal batch not found: ${batchId}`);
  return row;
}

function acceptedProposals(database: DatabaseSync, batchId: string): ProposalRow[] {
  return database
    .prepare(
      `SELECT proposal_id, batch_id, item_id, repository, issue_number,
              field_name, proposed_value, proposal_state
       FROM project_metadata_proposals
       WHERE batch_id=? AND proposal_state='accepted'
       ORDER BY issue_number, field_name`,
    )
    .all(batchId) as ProposalRow[];
}

function ownership(
  database: DatabaseSync,
  project: string,
  itemId: string,
  field: string,
): string | null {
  const row = database
    .prepare(
      `SELECT applied_value FROM project_metadata_field_ownership
       WHERE project=? AND item_id=? AND field_name=?`,
    )
    .get(project, itemId, field) as OwnershipRow | undefined;
  return row?.applied_value ?? null;
}

function recordEvent(
  database: DatabaseSync,
  batchId: string,
  proposalId: string | null,
  eventType: string,
  details: unknown,
): void {
  database
    .prepare(
      `INSERT INTO project_metadata_proposal_events (
         event_id, batch_id, proposal_id, event_type, actor, details_json
       ) VALUES (?, ?, ?, ?, 'kurami_sync', ?)`,
    )
    .run(id("pme"), batchId, proposalId, eventType, JSON.stringify(details));
}

function markProposal(
  database: DatabaseSync,
  proposal: ProposalRow,
  state: "applied" | "conflicted" | "failed",
  previousValue: string | null,
  failureReason: string | null,
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE project_metadata_proposals
       SET proposal_state=?, previous_value=?,
           applied_value=CASE WHEN ?='applied' THEN proposed_value ELSE NULL END,
           applied_at=CASE WHEN ?='applied' THEN ? ELSE NULL END,
           failure_reason=?, updated_at=?
       WHERE proposal_id=? AND proposal_state='accepted'`,
    )
    .run(
      state,
      previousValue,
      state,
      state,
      now,
      failureReason,
      now,
      proposal.proposal_id,
    );
}

function recordOwnership(
  database: DatabaseSync,
  batch: BatchRow,
  proposal: ProposalRow,
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO project_metadata_field_ownership (
         project, item_id, field_name, repository, issue_number,
         batch_id, proposal_id, applied_value, applied_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project, item_id, field_name) DO UPDATE SET
         repository=excluded.repository,
         issue_number=excluded.issue_number,
         batch_id=excluded.batch_id,
         proposal_id=excluded.proposal_id,
         applied_value=excluded.applied_value,
         applied_at=excluded.applied_at,
         updated_at=excluded.updated_at`,
    )
    .run(
      batch.project,
      proposal.item_id,
      proposal.field_name,
      proposal.repository,
      proposal.issue_number,
      batch.batch_id,
      proposal.proposal_id,
      proposal.proposed_value,
      now,
      now,
    );
}

function finalizeBatch(database: DatabaseSync, batch: BatchRow): Record<string, unknown> {
  const counts = database
    .prepare(
      `SELECT
         SUM(CASE WHEN proposal_state='applied' THEN 1 ELSE 0 END) AS applied,
         SUM(CASE WHEN proposal_state='conflicted' THEN 1 ELSE 0 END) AS conflicted,
         SUM(CASE WHEN proposal_state='failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN proposal_state='skipped' THEN 1 ELSE 0 END) AS skipped
       FROM project_metadata_proposals WHERE batch_id=?`,
    )
    .get(batch.batch_id) as {
    applied: number;
    conflicted: number;
    failed: number;
    skipped: number;
  };
  const partial = counts.conflicted > 0 || counts.failed > 0;
  const batchState = partial ? "partially_applied" : "applied";
  const syncState = partial ? "partial" : "succeeded";
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET batch_state=?, sync_state=?, sync_completed_at=?, completed_at=?,
             sync_last_error=NULL, updated_at=?
         WHERE batch_id=? AND batch_state='accepted' AND sync_state='syncing'`,
      )
      .run(batchState, syncState, now, now, now, batch.batch_id);
    recordEvent(database, batch.batch_id, null, "sync_completed", {
      batchState,
      ...counts,
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return {
    ok: true,
    action: batchState,
    batchId: batch.batch_id,
    project: batch.project,
    ...counts,
  };
}

export function syncAcceptedBatch(
  database: DatabaseSync,
  batchId: string,
  config: ProjectConfig,
  github: MetadataProjectClient,
): Record<string, unknown> {
  const batch = loadBatch(database, batchId);
  if (batch.batch_state !== "accepted" || batch.sync_state !== "syncing")
    fail(`Metadata batch is not syncing: ${batch.batch_state}/${batch.sync_state}`);
  const proposals = acceptedProposals(database, batchId);
  if (proposals.length === 0) fail("Accepted metadata batch has no syncable proposals");
  const project = github.resolveProject(config);
  const transientFailures: string[] = [];
  for (const proposal of proposals) {
    const field = project.fields[proposal.field_name];
    let currentValue: string | null;
    try {
      currentValue = github.readField(
        proposal.item_id,
        fieldName(config, proposal.field_name),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      transientFailures.push(`#${proposal.issue_number} ${proposal.field_name}: ${reason}`);
      recordEvent(database, batchId, proposal.proposal_id, "sync_deferred", { reason });
      continue;
    }
    const decision = decideSync(
      proposal,
      currentValue,
      ownership(database, batch.project, proposal.item_id, proposal.field_name),
      field,
    );
    if (decision.action === "conflict") {
      markProposal(database, proposal, "conflicted", decision.currentValue, decision.reason);
      recordEvent(database, batchId, proposal.proposal_id, "owner_value_preserved", {
        currentValue: decision.currentValue,
        proposedValue: proposal.proposed_value,
      });
      continue;
    }
    if (decision.action === "failed") {
      markProposal(database, proposal, "failed", currentValue, decision.reason);
      recordEvent(database, batchId, proposal.proposal_id, "sync_failed", {
        reason: decision.reason,
      });
      continue;
    }
    if (decision.action === "satisfied") {
      markProposal(database, proposal, "applied", decision.currentValue, null);
      recordEvent(database, batchId, proposal.proposal_id, "already_satisfied", {
        value: decision.currentValue,
      });
      continue;
    }
    recordEvent(database, batchId, proposal.proposal_id, "write_started", {
      previousValue: decision.previousValue,
      proposedValue: proposal.proposed_value,
    });
    try {
      github.writeField(
        project.projectId,
        proposal.item_id,
        field.id,
        decision.optionId,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      transientFailures.push(`#${proposal.issue_number} ${proposal.field_name}: ${reason}`);
      recordEvent(database, batchId, proposal.proposal_id, "sync_deferred", {
        reason,
        previousValue: decision.previousValue,
      });
      continue;
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      markProposal(database, proposal, "applied", decision.previousValue, null);
      recordOwnership(database, batch, proposal);
      recordEvent(database, batchId, proposal.proposal_id, "applied", {
        previousValue: decision.previousValue,
        appliedValue: proposal.proposed_value,
      });
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  if (transientFailures.length > 0)
    fail(`Transient GitHub failures: ${transientFailures.join("; ")}`);
  return finalizeBatch(database, batch);
}

export function inspectAcceptedBatch(
  database: DatabaseSync,
  batchId: string,
  config: ProjectConfig,
  github: MetadataProjectClient,
): Record<string, unknown> {
  const batch = loadBatch(database, batchId);
  if (batch.batch_state !== "accepted")
    fail(`Metadata batch is not accepted: ${batch.batch_state}`);
  const proposals = acceptedProposals(database, batchId);
  if (proposals.length === 0) fail("Accepted metadata batch has no syncable proposals");
  const project = github.resolveProject(config);
  const results = proposals.map((proposal) => {
    const currentValue = github.readField(
      proposal.item_id,
      fieldName(config, proposal.field_name),
    );
    const decision = decideSync(
      proposal,
      currentValue,
      ownership(database, batch.project, proposal.item_id, proposal.field_name),
      project.fields[proposal.field_name],
    );
    return {
      proposalId: proposal.proposal_id,
      issueNumber: proposal.issue_number,
      field: proposal.field_name,
      currentValue,
      proposedValue: proposal.proposed_value,
      decision: decision.action,
      ...(decision.action === "conflict" || decision.action === "failed"
        ? { reason: decision.reason }
        : {}),
    };
  });
  const count = (decision: SyncDecision["action"]): number =>
    results.filter((result) => result.decision === decision).length;
  return {
    ok: true,
    apply: false,
    action: "verified",
    batchId,
    project: batch.project,
    counts: {
      write: count("write"),
      satisfied: count("satisfied"),
      conflict: count("conflict"),
      failed: count("failed"),
    },
    results,
    externalReads: proposals.length + 1,
    externalWrites: 0,
  };
}

export function recoverStaleSyncs(
  database: DatabaseSync,
  selectedProject: string | null,
): string[] {
  const rows = database
    .prepare(
      `SELECT batch_id, sync_started_at FROM project_metadata_proposal_batches
       WHERE batch_state='accepted' AND sync_state='syncing'
         AND (? IS NULL OR project=?)`,
    )
    .all(selectedProject, selectedProject) as Array<{
    batch_id: string;
    sync_started_at: string | null;
  }>;
  const now = Date.now();
  const recovered: string[] = [];
  for (const row of rows) {
    const started = row.sync_started_at ? Date.parse(row.sync_started_at) : 0;
    if (started > 0 && now - started < staleSyncMilliseconds) continue;
    database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET sync_state='failed', sync_last_error='Stale sync claim recovered',
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE batch_id=? AND batch_state='accepted' AND sync_state='syncing'`,
      )
      .run(row.batch_id);
    recordEvent(database, row.batch_id, null, "stale_sync_recovered", {});
    recovered.push(row.batch_id);
  }
  return recovered;
}

export function planNextSync(
  database: DatabaseSync,
  selectedProject: string | null,
): BatchRow | null {
  return (database
    .prepare(
      `SELECT batch_id, project, batch_number, batch_state, sync_state,
              sync_attempt_count, sync_started_at
       FROM project_metadata_proposal_batches
       WHERE batch_state='accepted'
         AND sync_state IN ('queued', 'failed')
         AND sync_attempt_count < ?
         AND (? IS NULL OR project=?)
       ORDER BY accepted_at, batch_number
       LIMIT 1`,
    )
    .get(maximumSyncAttempts, selectedProject, selectedProject) ?? null) as BatchRow | null;
}

export function claimSync(database: DatabaseSync, batchId: string): BatchRow {
  const now = new Date().toISOString();
  const changed = database
    .prepare(
      `UPDATE project_metadata_proposal_batches
       SET sync_state='syncing', sync_attempt_count=sync_attempt_count+1,
           sync_started_at=?, sync_last_error=NULL, updated_at=?
       WHERE batch_id=? AND batch_state='accepted'
         AND sync_state IN ('queued', 'failed')
         AND sync_attempt_count < ?`,
    )
    .run(now, now, batchId, maximumSyncAttempts);
  if (changed.changes !== 1) fail("Metadata sync claim race");
  recordEvent(database, batchId, null, "sync_started", {
    attempt: loadBatch(database, batchId).sync_attempt_count,
  });
  return loadBatch(database, batchId);
}

export function markGlobalFailure(
  database: DatabaseSync,
  batch: BatchRow,
  error: unknown,
): Record<string, unknown> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  database
    .prepare(
      `UPDATE project_metadata_proposal_batches
       SET sync_state='failed', sync_last_error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE batch_id=? AND batch_state='accepted' AND sync_state='syncing'`,
    )
    .run(message, batch.batch_id);
  recordEvent(database, batch.batch_id, null, "sync_attempt_failed", { message });
  return {
    ok: true,
    action:
      batch.sync_attempt_count >= maximumSyncAttempts ? "needs_attention" : "retry_scheduled",
    batchId: batch.batch_id,
    project: batch.project,
    attempt: batch.sync_attempt_count,
    error: message,
  };
}

function parseArguments(args: string[]): {
  project: string | null;
  apply: boolean;
  verify: boolean;
} {
  const index = args.indexOf("--project");
  const project = index === -1 ? null : args[index + 1]?.trim() ?? "";
  const known = new Set(["--project", project, "--verify", "--apply"]);
  const apply = args.includes("--apply");
  const verify = args.includes("--verify");
  if (
    (index !== -1 && (!project || project.startsWith("--"))) ||
    args.some((arg) => !known.has(arg)) ||
    (apply && verify)
  )
    fail("Usage: metadata-sync.ts [--project <project>] [--verify|--apply]");
  return { project: project || null, apply, verify };
}

async function main(): Promise<void> {
  const { project, apply, verify } = parseArguments(process.argv.slice(2));
  const home = resolve(
    process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const registry = parse(await readFile(resolve(home, "config/projects.yaml"), "utf8")) as ProjectsRegistry;
  if (registry.version !== 1) fail("Unsupported projects registry version");
  const database = new DatabaseSync(resolve(home, "state/orchestrator.db"), { timeout: 5_000 });
  try {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const recovered = apply ? recoverStaleSyncs(database, project) : [];
    const planned = planNextSync(database, project);
    if (!planned) {
      process.stdout.write(
        `${JSON.stringify(
          recovered.length > 0
            ? { ok: true, apply, action: "stale_recovered", batches: recovered }
            : { ok: true, apply, action: "unchanged" },
        )}\n`,
      );
      return;
    }
    if (!apply) {
      if (verify) {
        const config = registry.projects[planned.project];
        if (!config) fail(`Unknown project: ${planned.project}`);
        process.stdout.write(
          `${JSON.stringify(
            inspectAcceptedBatch(
              database,
              planned.batch_id,
              config,
              new GithubProjectClient(),
            ),
          )}\n`,
        );
        return;
      }
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: false, action: "sync", batchId: planned.batch_id, project: planned.project, attempt: planned.sync_attempt_count + 1, maxAttempts: maximumSyncAttempts, externalWrites: 0 })}\n`,
      );
      return;
    }
    const config = registry.projects[planned.project];
    if (!config) fail(`Unknown project: ${planned.project}`);
    const claimed = claimSync(database, planned.batch_id);
    let result: Record<string, unknown>;
    try {
      result = syncAcceptedBatch(database, claimed.batch_id, config, new GithubProjectClient());
    } catch (error) {
      result = markGlobalFailure(database, claimed, error);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    database.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
