import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { TriageFacts, TriageItemFact } from "./triage-snapshot.ts";

process.umask(0o077);

export const triageRankingPolicyVersion = "deterministic-v2";

export type RankedTriageItem = {
  itemId: string;
  issueNumber: number;
  title: string;
  url: string;
  score: number;
  priorityScore: number;
  effortScore: number;
  ageScore: number;
  reasons: string[];
};

export type TriageRanking = {
  policyVersion: string;
  factualHash: string;
  project: string;
  ranked: RankedTriageItem[];
  selected: RankedTriageItem | null;
  explanation: string;
};

export type PersistedTriageRanking = {
  project: string;
  action: "changed" | "unchanged";
  factualHash: string;
  policyVersion: string;
  selectedIssueNumber: number | null;
  suggestedSince: string;
  eligible: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function normalized(value: string | null): string {
  return value?.trim().toLowerCase().replace(/[\s_-]+/gu, " ") ?? "";
}

function priorityWeight(value: string | null): number {
  const name = normalized(value);
  const p = /^p([0-4])\b/u.exec(name);
  if (p) return 5_000 - Number(p[1]) * 1_000;
  if (["critical", "urgent"].includes(name)) return 5_000;
  if (name === "high") return 4_000;
  if (["medium", "normal"].includes(name)) return 3_000;
  if (name === "low") return 2_000;
  return 0;
}

function effortWeight(value: string | null): number {
  const name = normalized(value);
  if (/^(?:xs|extra small)\b/u.test(name)) return 40;
  if (/^(?:s|small)\b/u.test(name)) return 32;
  if (/^(?:m|medium)\b/u.test(name)) return 22;
  if (/^(?:l|large)\b/u.test(name)) return 10;
  if (/^(?:xl|extra large)\b/u.test(name)) return 0;
  const numeric = Number(/^(\d+(?:\.\d+)?)/u.exec(name)?.[1]);
  if (Number.isFinite(numeric) && numeric > 0)
    return Math.max(0, 40 - Math.min(numeric, 8) * 5);
  return 0;
}

function ageWeight(createdAt: string | null, now: Date): number {
  if (!createdAt) return 0;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || created > now.valueOf()) return 0;
  return Math.min(30, Math.floor((now.valueOf() - created) / 86_400_000));
}

function requiredIssueFields(
  item: TriageItemFact,
): item is TriageItemFact & {
  issueNumber: number;
  title: string;
  url: string;
} {
  return (
    item.eligible &&
    Number.isInteger(item.issueNumber) &&
    item.issueNumber! > 0 &&
    Boolean(item.title?.trim()) &&
    Boolean(item.url?.startsWith("https://"))
  );
}

function itemReasons(
  item: TriageItemFact,
  priorityScore: number,
  effortScore: number,
  ageScore: number,
): string[] {
  const reasons: string[] = [];
  if (priorityScore > 0 && item.priority)
    reasons.push(`Owner priority ${item.priority}`);
  if (effortScore > 0 && item.effort) reasons.push(`Effort ${item.effort}`);
  if (ageScore > 0)
    reasons.push(`Waiting ${ageScore}${ageScore === 30 ? "+" : ""} days`);
  reasons.push("Ready to start");
  return reasons;
}

export function rankTriageFacts(
  facts: TriageFacts,
  factualHash: string,
  now = new Date(),
): TriageRanking {
  if (!/^[a-f0-9]{64}$/u.test(factualHash)) fail("Invalid factual hash");
  const ranked = facts.items
    .filter(requiredIssueFields)
    .map<RankedTriageItem>((item) => {
      const priorityScore = priorityWeight(item.priority);
      const effortScore = effortWeight(item.effort);
      const ageScore = ageWeight(item.createdAt, now);
      return {
        itemId: item.itemId,
        issueNumber: item.issueNumber,
        title: item.title.trim(),
        url: item.url,
        score: priorityScore + effortScore + ageScore,
        priorityScore,
        effortScore,
        ageScore,
        reasons: itemReasons(item, priorityScore, effortScore, ageScore),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.priorityScore - left.priorityScore ||
        right.effortScore - left.effortScore ||
        right.ageScore - left.ageScore ||
        left.issueNumber - right.issueNumber ||
        left.itemId.localeCompare(right.itemId),
    );
  const selected = ranked[0] ?? null;
  return {
    policyVersion: triageRankingPolicyVersion,
    factualHash,
    project: facts.project,
    ranked,
    selected,
    explanation: selected
      ? selected.reasons.slice(0, 3).join(" · ")
      : "No eligible backlog issue right now.",
  };
}

function rankingDigest(ranking: TriageRanking): string {
  return createHash("sha256").update(JSON.stringify(ranking)).digest("hex");
}

export function persistTriageRanking(
  database: DatabaseSync,
  ranking: TriageRanking,
  rankedAt: string,
): PersistedTriageRanking {
  const previous = database
    .prepare(`
      SELECT factual_hash, policy_version, selected_item_id,
             selected_issue_number, suggested_since
      FROM project_triage_rankings
      WHERE project = ?
    `)
    .get(ranking.project) as
    | {
        factual_hash: string;
        policy_version: string;
        selected_item_id: string | null;
        selected_issue_number: number | null;
        suggested_since: string;
      }
    | undefined;
  if (
    previous?.factual_hash === ranking.factualHash &&
    previous.policy_version === ranking.policyVersion
  ) {
    return {
      project: ranking.project,
      action: "unchanged",
      factualHash: ranking.factualHash,
      policyVersion: ranking.policyVersion,
      selectedIssueNumber: previous.selected_issue_number,
      suggestedSince: previous.suggested_since,
      eligible: ranking.ranked.length,
    };
  }
  const selectedItemId = ranking.selected?.itemId ?? null;
  const suggestedSince =
    previous?.selected_item_id === selectedItemId ? previous.suggested_since : rankedAt;
  database
    .prepare(`
      INSERT INTO project_triage_rankings (
        project, factual_hash, policy_version, ranking_json,
        selected_item_id, selected_issue_number, selected_title, selected_url,
        explanation, content_digest, suggested_since, ranked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project) DO UPDATE SET
        factual_hash = excluded.factual_hash,
        policy_version = excluded.policy_version,
        ranking_json = excluded.ranking_json,
        selected_item_id = excluded.selected_item_id,
        selected_issue_number = excluded.selected_issue_number,
        selected_title = excluded.selected_title,
        selected_url = excluded.selected_url,
        explanation = excluded.explanation,
        content_digest = excluded.content_digest,
        suggested_since = excluded.suggested_since,
        ranked_at = excluded.ranked_at
    `)
    .run(
      ranking.project,
      ranking.factualHash,
      ranking.policyVersion,
      JSON.stringify(ranking.ranked),
      selectedItemId,
      ranking.selected?.issueNumber ?? null,
      ranking.selected?.title ?? null,
      ranking.selected?.url ?? null,
      ranking.explanation,
      rankingDigest(ranking),
      suggestedSince,
      rankedAt,
    );
  return {
    project: ranking.project,
    action: "changed",
    factualHash: ranking.factualHash,
    policyVersion: ranking.policyVersion,
    selectedIssueNumber: ranking.selected?.issueNumber ?? null,
    suggestedSince,
    eligible: ranking.ranked.length,
  };
}

function selectedProjectFromArgs(args: string[]): string | null {
  const index = args.indexOf("--project");
  if (index === -1) return null;
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith("--")) fail("--project requires a value");
  if (args.length !== 2) fail("Usage: triage-rank.ts [--project <project>]");
  return value;
}

async function main(): Promise<void> {
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const database = new DatabaseSync(
    resolve(orchestratorHome, "state/orchestrator.db"),
    { timeout: 5_000 },
  );
  try {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const selectedProject = selectedProjectFromArgs(process.argv.slice(2));
    const rows = database
      .prepare(`
        SELECT project, factual_hash, facts_json
        FROM project_triage_state
        WHERE (? IS NULL OR project = ?)
        ORDER BY project
      `)
      .all(selectedProject, selectedProject) as Array<{
      project: string;
      factual_hash: string;
      facts_json: string;
    }>;
    if (selectedProject && rows.length === 0)
      fail(`No triage facts found for project: ${selectedProject}`);
    const rankedAt = new Date().toISOString();
    const projects = rows.map((row) => {
      const facts = JSON.parse(row.facts_json) as TriageFacts;
      if (facts.project !== row.project) fail(`Triage facts project mismatch: ${row.project}`);
      return persistTriageRanking(
        database,
        rankTriageFacts(facts, row.factual_hash, new Date(rankedAt)),
        rankedAt,
      );
    });
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        rankedAt,
        projects,
        changed: projects.filter(({ action }) => action === "changed").length,
        unchanged: projects.filter(({ action }) => action === "unchanged").length,
        boardMutations: false,
      })}\n`,
    );
  } finally {
    database.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
