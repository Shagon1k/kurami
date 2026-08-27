import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applyAssessmentPlan,
  maximumProposalBatchIssues,
  planProjectAssessment,
  skipBatch,
  type MetadataProposalCandidate,
} from "../src/metadata-proposal-manager.ts";
import {
  buildMetadataProposalInstructions,
  deterministicProposalSummary,
  metadataAssessmentChunks,
  maximumMetadataAiChunkIssues,
  maximumMetadataAiAttempts,
  parseMetadataProposalResult,
  persistMetadataProposalResult,
  runValidatedMetadataAssessment,
} from "../src/metadata-proposal-worker.ts";
import * as canonicalManager from "../src/orchestrator/projects/metadata/proposals/manager.ts";
import * as canonicalWorker from "../src/orchestrator/projects/metadata/proposals/worker.ts";
import * as legacyManager from "../src/metadata-proposal-manager.ts";
import * as legacyWorker from "../src/metadata-proposal-worker.ts";
import { persistTriageRanking, rankTriageFacts } from "../src/triage-rank.ts";
import {
  buildTriageFacts,
  persistTriageSnapshot,
  type RawTriageItem,
} from "../src/triage-snapshot.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function item(number: number, overrides: Partial<RawTriageItem> = {}): RawTriageItem {
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
    labels: number % 2 === 0 ? ["frontend"] : ["backend"],
    labelsTotalCount: 1,
    hasDescription: true,
    bodyDigest: String(number).repeat(64).slice(0, 64),
    createdAt: `2026-07-${String(Math.min(number, 28)).padStart(2, "0")}T08:00:00.000Z`,
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

function expectFailure(action: () => unknown, expected: string): void {
  try {
    action();
    throw new Error(`Expected failure containing: ${expected}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expected), `Unexpected failure: ${message}`);
  }
}

async function main(): Promise<void> {
  assert(
    legacyManager.planProjectAssessment ===
      canonicalManager.planProjectAssessment &&
      legacyManager.runMetadataProposalManagerCli ===
        canonicalManager.runMetadataProposalManagerCli &&
      legacyWorker.parseMetadataProposalResult ===
        canonicalWorker.parseMetadataProposalResult &&
      legacyWorker.runMetadataProposalWorkerCli ===
        canonicalWorker.runMetadataProposalWorkerCli,
    "Legacy metadata proposal modules are not transparent compatibility wrappers",
  );
  const app = resolve(import.meta.dirname, "..");
  const migrationsDirectory = resolve(app, "migrations");
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
  const home = await mkdtemp(resolve(tmpdir(), "kurami-metadata-proposals-test-"));
  try {
    const upgrade = new DatabaseSync(resolve(home, "upgrade-v18.db"));
    upgrade.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations.filter((name) => name <= "018_project_triage_digest.sql"))
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
        resolve(migrationsDirectory, "019_metadata_proposal_batches.sql"),
        "utf8",
      ),
    );
    assert(
      (upgrade.prepare("SELECT COUNT(*) AS count FROM project_triage_state").get() as { count: number }).count === 1 &&
        upgrade.prepare("PRAGMA foreign_key_check").all().length === 0,
      "Schema 19 did not preserve populated v18 state",
    );
    upgrade.close();

    await mkdir(resolve(home, "state"), { recursive: true });
    const databasePath = resolve(home, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations)
      database.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));

    const rawItems = Array.from({ length: 14 }, (_, index) => item(index + 1));
    let facts = buildTriageFacts("tailortales", config, rawItems, []);
    let snapshot = persistTriageSnapshot(
      database,
      facts,
      "2026-08-20T06:00:00.000Z",
      null,
    );
    const ranking = rankTriageFacts(facts, snapshot.factualHash, new Date("2026-08-20T06:00:00.000Z"));
    persistTriageRanking(database, ranking, "2026-08-20T06:01:00.000Z");

    const dryPlan = planProjectAssessment(database, "tailortales");
    assert(
      dryPlan.action === "create" &&
        dryPlan.batchKind === "bootstrap" &&
        dryPlan.candidates.length === maximumProposalBatchIssues &&
        dryPlan.remainingCandidates === 2,
      "Bootstrap proposal batch was not bounded",
    );
    assert(
      (database.prepare("SELECT COUNT(*) AS count FROM project_metadata_proposal_batches").get() as { count: number }).count === 0,
      "Plan-only assessment mutated the database",
    );
    assert(
      dryPlan.candidates.map(({ itemId }) => itemId).join(",") ===
        ranking.ranked.slice(0, maximumProposalBatchIssues).map(({ itemId }) => itemId).join(","),
      "Proposal candidates did not follow deterministic digest ranking",
    );
    const expandedPlan = planProjectAssessment(database, "tailortales", 40);
    assert(
      expandedPlan.action === "create" &&
        expandedPlan.candidates.length === 14 &&
        expandedPlan.remainingCandidates === 0,
      "Configurable daily limit did not expand the logical proposal batch",
    );

    const created = applyAssessmentPlan(database, dryPlan) as { batchId: string };
    const batchId = created.batchId;
    const active = planProjectAssessment(database, "tailortales");
    assert(active.action === "active" && active.batchId === batchId, "A second active batch was planned");

    const worker = resolve(app, "src/metadata-proposal-worker.ts");
    const workerDryRun = JSON.parse(
      (
        await runNode(worker, ["--batch-id", batchId], {
          ...process.env,
          ORCHESTRATOR_HOME: home,
          ORCHESTRATOR_MIGRATIONS_DIR: migrationsDirectory,
          GH_BIN: "/definitely/not/invoked",
          CODEX_BIN: "/definitely/not/invoked",
        })
      ).stdout,
    ) as { apply: boolean; externalReads: number; externalWrites: number };
    assert(
      workerDryRun.apply === false && workerDryRun.externalReads === 0 && workerDryRun.externalWrites === 0,
      "Worker plan-only mode performed external work",
    );
    assert(
      (database.prepare("SELECT batch_state FROM project_metadata_proposal_batches WHERE batch_id=?").get(batchId) as { batch_state: string }).batch_state === "planned",
      "Worker plan-only mode changed batch state",
    );

    const candidates = dryPlan.candidates;
    const assessmentChunks = metadataAssessmentChunks(
      Array.from({ length: 40 }, (_, index) => ({
        ...candidates[0]!,
        itemId: `chunk-item-${index + 1}`,
        issueNumber: index + 1,
      })),
    );
    assert(
      maximumMetadataAiChunkIssues === 12 &&
        assessmentChunks.map((chunk) => chunk.length).join(",") === "12,12,12,4",
      "Large logical batches are not split into bounded AI chunks",
    );
    const valid = parseMetadataProposalResult(
      JSON.stringify({
        summary: "Two evidence-backed suggestions.",
        proposals: [
          {
            issueNumber: candidates[0]!.issueNumber,
            field: "priority",
            value: "P1",
            confidence: "high",
            reason: "User impact is explicit.",
            evidence: ["Issue describes a broken owner workflow."],
          },
          {
            issueNumber: candidates[0]!.issueNumber,
            field: "effort",
            value: "M",
            confidence: "medium",
            reason: "Several coordinated changes are described.",
            evidence: [],
          },
        ],
      }),
      candidates,
    );
    assert(valid.proposals.length === 2, "Valid proposal result was not parsed");
    assert(
      deterministicProposalSummary(valid.proposals) ===
        "2 metadata proposals ready for 1 issue.",
      "Proposal summary trusted model-authored arithmetic",
    );
    let aiAttempts = 0;
    const rejectedAttempts: number[] = [];
    const recoveredValidation = await runValidatedMetadataAssessment(
      candidates,
      async () => {
        aiAttempts += 1;
        return aiAttempts === 1
          ? "not-json"
          : JSON.stringify({ summary: "Valid retry.", proposals: [] });
      },
      (attempt) => rejectedAttempts.push(attempt),
    );
    assert(
      maximumMetadataAiAttempts === 2 &&
        aiAttempts === 2 &&
        rejectedAttempts.join(",") === "1" &&
        recoveredValidation.proposals.length === 0,
      "Invalid AI output did not receive exactly one bounded retry",
    );
    let technicalAttempts = 0;
    try {
      await runValidatedMetadataAssessment(candidates, async () => {
        technicalAttempts += 1;
        throw new Error("transport unavailable");
      });
      throw new Error("Technical AI failure unexpectedly succeeded");
    } catch (error) {
      assert(
        error instanceof Error &&
          error.message.includes("transport unavailable") &&
          technicalAttempts === 1,
        "Technical failure was retried as if it were invalid model output",
      );
    }
    let exhaustedAttempts = 0;
    try {
      await runValidatedMetadataAssessment(candidates, async () => {
        exhaustedAttempts += 1;
        return "still-not-json";
      });
      throw new Error("Repeated invalid AI output unexpectedly succeeded");
    } catch (error) {
      assert(
        error instanceof Error &&
          error.message.includes("failed validation after 2 attempts") &&
          exhaustedAttempts === 2,
        "Invalid AI output did not stop after the bounded retry",
      );
    }
    expectFailure(
      () =>
        parseMetadataProposalResult(
          JSON.stringify({
            proposals: [
              {
                issueNumber: candidates[0]!.issueNumber,
                field: "priority",
                value: "P0",
                confidence: "high",
                reason: "No.",
                evidence: [],
              },
            ],
          }),
          candidates,
        ),
      "invalid priority value",
    );
    expectFailure(
      () =>
        parseMetadataProposalResult(
          JSON.stringify({
            proposals: [
              {
                issueNumber: 999,
                field: "effort",
                value: "S",
                confidence: "high",
                reason: "No.",
                evidence: [],
              },
            ],
          }),
          candidates,
        ),
      "outside this batch",
    );
    expectFailure(
      () =>
        parseMetadataProposalResult(
          JSON.stringify({
            proposals: [
              {
                issueNumber: candidates[0]!.issueNumber,
                field: "effort",
                value: "S",
                confidence: "low",
                reason: "No.",
                evidence: [],
              },
            ],
          }),
          candidates,
        ),
      "invalid confidence",
    );
    expectFailure(
      () =>
        parseMetadataProposalResult(
          JSON.stringify({
            proposals: [
              {
                issueNumber: candidates[0]!.issueNumber,
                field: "effort",
                value: "S",
                confidence: "high",
                reason: "First.",
                evidence: [],
              },
              {
                issueNumber: candidates[0]!.issueNumber,
                field: "effort",
                value: "M",
                confidence: "medium",
                reason: "Second.",
                evidence: [],
              },
            ],
          }),
          candidates,
        ),
      "duplicates",
    );

    const contexts = candidates.map((candidate) => ({
      repository: candidate.repository,
      issueNumber: candidate.issueNumber,
      title: candidate.title,
      body: `Description for ${candidate.issueNumber}`,
      state: "open",
      labels: candidate.labels,
    }));
    const instructions = buildMetadataProposalInstructions(
      { project: "tailortales", batch_number: 1, batch_kind: "bootstrap" },
      candidates,
      contexts,
    );
    assert(
      instructions.includes("Never propose P0") &&
        instructions.includes("Do not infer dependency") &&
        instructions.includes("read-only") &&
        instructions.includes("Do not use network access"),
      "Detached metadata instructions are missing safety constraints",
    );

    database
      .prepare("UPDATE project_metadata_proposal_batches SET batch_state='running' WHERE batch_id=?")
      .run(batchId);
    const ready = persistMetadataProposalResult(database, batchId, valid);
    assert(ready.state === "ready" && ready.proposalCount === 2, "Proposal result was not persisted");
    const provenance = database
      .prepare(
        `SELECT field_name, baseline_value, proposed_value, confidence, evidence_json
         FROM project_metadata_proposals WHERE batch_id=? ORDER BY field_name`,
      )
      .all(batchId) as Array<Record<string, unknown>>;
    assert(
      provenance.length === 2 && provenance.every((row) => row.baseline_value === null),
      "Proposal provenance is incomplete",
    );
    assert(
      (database.prepare("SELECT summary FROM project_metadata_proposal_batches WHERE batch_id=?").get(batchId) as { summary: string }).summary ===
        "2 metadata proposals ready for 1 issue.",
      "Stored proposal summary is not deterministic",
    );

    rawItems.push(item(99, { priority: "P2", effort: "S" }));
    facts = buildTriageFacts("tailortales", config, rawItems, []);
    snapshot = persistTriageSnapshot(database, facts, "2026-08-20T07:00:00.000Z", null);
    const unrelated = planProjectAssessment(database, "tailortales");
    assert(
      unrelated.action === "active" && unrelated.deferredFactualHash === snapshot.factualHash,
      "Unrelated project change invalidated the active proposal batch",
    );

    const firstSkip = skipBatch(database, batchId, true) as {
      remainingBootstrapCandidates: number;
      cursorAdvanced: boolean;
    };
    assert(
      firstSkip.remainingBootstrapCandidates === 2 && !firstSkip.cursorAdvanced,
      "Unrelated snapshot change prematurely advanced the bootstrap cursor",
    );
    const continuation = planProjectAssessment(database, "tailortales");
    assert(
      continuation.action === "create" &&
        continuation.batchKind === "bootstrap" &&
        continuation.candidates.length === 2 &&
        continuation.remainingCandidates === 0,
      "Bootstrap did not continue with the unassessed candidates",
    );
    const continuationResult = applyAssessmentPlan(database, continuation) as { batchId: string };
    database
      .prepare("UPDATE project_metadata_proposal_batches SET batch_state='ready' WHERE batch_id=?")
      .run(continuationResult.batchId);

    const targetIssueNumber = continuation.candidates[0]!.issueNumber;
    const targetIndex = rawItems.findIndex((entry) => entry.issueNumber === targetIssueNumber);
    rawItems[targetIndex] = item(targetIssueNumber, { title: `Issue ${targetIssueNumber} updated` });
    facts = buildTriageFacts("tailortales", config, rawItems, []);
    persistTriageSnapshot(database, facts, "2026-08-20T08:00:00.000Z", null);
    const replacement = planProjectAssessment(database, "tailortales");
    assert(
      replacement.action === "create" &&
        replacement.supersedeBatchId === continuationResult.batchId,
      "Relevant target change did not plan a superseding batch",
    );
    const replacementResult = applyAssessmentPlan(database, replacement) as { batchId: string };
    const replacementId = replacementResult.batchId;
    assert(
      (database.prepare("SELECT batch_state FROM project_metadata_proposal_batches WHERE batch_id=?").get(continuationResult.batchId) as { batch_state: string }).batch_state === "superseded",
      "Previous active batch was not superseded",
    );

    database
      .prepare("UPDATE project_metadata_proposal_batches SET batch_state='ready' WHERE batch_id=?")
      .run(replacementId);
    const finalSkip = skipBatch(database, replacementId, true) as {
      remainingBootstrapCandidates: number;
      cursorAdvanced: boolean;
    };
    assert(
      finalSkip.remainingBootstrapCandidates === 0 && finalSkip.cursorAdvanced,
      "Completed bootstrap did not advance the assessment cursor",
    );
    assert(
      planProjectAssessment(database, "tailortales").action === "unchanged",
      "Completed bootstrap reran without a changed snapshot",
    );

    const workerSource = await readFile(worker, "utf8");
    assert(
      !workerSource.includes('"--method"') &&
        !workerSource.includes('"POST"') &&
        !workerSource.includes('"PATCH"') &&
        !workerSource.includes('"DELETE"'),
      "Read-only P4c worker contains a GitHub mutation path",
    );
    assert(
      database.prepare("PRAGMA foreign_key_check").all().length === 0,
      "Metadata proposal test left foreign-key violations",
    );
    database.close();

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        populatedV18UpgradePreserved: true,
        planOnlyNoMutation: true,
        bootstrapBatchSize: maximumProposalBatchIssues,
        bootstrapContinuation: true,
        deterministicCandidateOrder: true,
        oneActiveBatch: true,
        unrelatedChangesDeferred: true,
        targetChangesSupersede: true,
        p0Forbidden: true,
        dependencyInferenceExcluded: true,
        strictResultValidation: true,
        invalidResultRetryAttempts: maximumMetadataAiAttempts,
        maximumAiChunkIssues: maximumMetadataAiChunkIssues,
        technicalFailureRetryAttempts: 1,
        deterministicSummary: true,
        proposalProvenance: true,
        githubWrites: 0,
        detachedTasksReadOnly: true,
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
