import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";

process.umask(0o077);

type TriageConfig = {
  enabled?: boolean;
  priority_field?: string;
  effort_field?: string;
};

type ProjectConfig = {
  owner: string;
  project_number: number;
  repository: string;
  status_field: string;
  statuses: {
    backlog: string;
    active: string;
    review: string;
    done: string;
    deferred: string;
  };
  workspace?: {
    canonical_repository?: string;
    worktree_root?: string;
    base_branch?: string;
  };
  triage?: TriageConfig;
};

type Registry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type ProjectFieldValue = { name?: string; number?: number } | null;

type DependencyNode = {
  id: string;
  number: number;
  state: string;
  url: string;
  repository: { nameWithOwner: string };
};

type IssueContent = {
  __typename: "Issue";
  id: string;
  number: number;
  title: string;
  url: string;
  state: string;
  body: string;
  createdAt: string;
  closedAt: string | null;
  labels: {
    totalCount: number;
    nodes: Array<{ name: string }>;
  };
  repository: { nameWithOwner: string };
  issueDependenciesSummary: {
    blockedBy: number;
    blocking: number;
    totalBlockedBy: number;
    totalBlocking: number;
  };
  blockedBy: { totalCount: number; nodes: DependencyNode[] };
  blocking: { totalCount: number; nodes: DependencyNode[] };
};

type ProjectNode = {
  id: string;
  type: string;
  status: ProjectFieldValue;
  priority: ProjectFieldValue;
  effort: ProjectFieldValue;
  content: IssueContent | { __typename: string } | null;
};

type GraphqlResponse = {
  data?: {
    user?: {
      projectV2?: {
        items: {
          nodes: ProjectNode[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    };
    rateLimit?: { cost: number; remaining: number; resetAt: string };
  };
  errors?: Array<{ message: string }>;
};

export type ActiveRunFact = {
  runId: string;
  itemId: string;
  state: string;
  ownerState: string;
};

export type RawTriageItem = {
  itemId: string;
  contentType: string;
  repository: string | null;
  issueNumber: number | null;
  title: string | null;
  url: string | null;
  issueState: string | null;
  status: string | null;
  priority: string | null;
  effort: string | null;
  labels: string[];
  labelsTotalCount: number;
  hasDescription: boolean;
  bodyDigest: string | null;
  createdAt: string | null;
  closedAt: string | null;
  blockedByOpenCount: number;
  blockingOpenCount: number;
  blockedByTotalCount: number;
  blockingTotalCount: number;
  blockedBy: Array<{
    repository: string;
    number: number;
    state: string;
    url: string;
  }>;
  blocking: Array<{
    repository: string;
    number: number;
    state: string;
    url: string;
  }>;
};

export type TriageItemFact = RawTriageItem & {
  activeRun: ActiveRunFact | null;
  eligible: boolean;
  eligibilityReasons: string[];
  dependencyDetailsTruncated: boolean;
  labelsTruncated: boolean;
};

export type TriageStats = {
  issues: number;
  remainingOpen: number;
  backlog: number;
  eligible: number;
  blocked: number;
  needsClarification: number;
  active: number;
  review: number;
  deferred: number;
  done: number;
};

export type TriageFacts = {
  policyVersion: 1;
  project: string;
  repository: string;
  fields: { status: string; priority: string; effort: string };
  statuses: ProjectConfig["statuses"];
  runtimeSupported: boolean;
  items: TriageItemFact[];
  stats: TriageStats;
};

export type PersistedTriageSnapshot = {
  project: string;
  action: "changed" | "unchanged";
  factualHash: string;
  changeSequence: number;
  stats: TriageStats;
  lastChangedAt: string;
  lastCheckedAt: string;
};

const QUERY = String.raw`
  query TriageProjectItems(
    $login: String!
    $number: Int!
    $statusField: String!
    $priorityField: String!
    $effortField: String!
    $after: String
  ) {
    user(login: $login) {
      projectV2(number: $number) {
        items(first: 100, after: $after) {
          nodes {
            id
            type
            status: fieldValueByName(name: $statusField) {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
            priority: fieldValueByName(name: $priorityField) {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
            effort: fieldValueByName(name: $effortField) {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
              ... on ProjectV2ItemFieldNumberValue { number }
            }
            content {
              __typename
              ... on Issue {
                id
                number
                title
                url
                state
                body
                createdAt
                closedAt
                labels(first: 50) {
                  totalCount
                  nodes { name }
                }
                repository { nameWithOwner }
                issueDependenciesSummary {
                  blockedBy
                  blocking
                  totalBlockedBy
                  totalBlocking
                }
                blockedBy(first: 100) {
                  totalCount
                  nodes {
                    id
                    number
                    state
                    url
                    repository { nameWithOwner }
                  }
                }
                blocking(first: 100) {
                  totalCount
                  nodes {
                    id
                    number
                    state
                    url
                    repository { nameWithOwner }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
    rateLimit { cost remaining resetAt }
  }
`;

const terminalRunStates = new Set(["rejected", "cancelled", "archived"]);

function fail(message: string): never {
  throw new Error(message);
}

function stringField(value: ProjectFieldValue): string | null {
  if (typeof value?.name === "string" && value.name.trim()) return value.name.trim();
  if (typeof value?.number === "number" && Number.isFinite(value.number))
    return String(value.number);
  return null;
}

function dependencyFacts(nodes: DependencyNode[]): RawTriageItem["blockedBy"] {
  return nodes
    .map((node) => ({
      repository: node.repository.nameWithOwner,
      number: node.number,
      state: node.state,
      url: node.url,
    }))
    .sort((left, right) =>
      `${left.repository}#${left.number}`.localeCompare(
        `${right.repository}#${right.number}`,
      ),
    );
}

function isIssueContent(
  content: ProjectNode["content"],
): content is IssueContent {
  return content?.__typename === "Issue" && "repository" in content;
}

function nodeToRawItem(node: ProjectNode): RawTriageItem {
  const content = isIssueContent(node.content) ? node.content : null;
  return {
    itemId: node.id,
    contentType: node.content?.__typename ?? node.type,
    repository: content?.repository.nameWithOwner ?? null,
    issueNumber: content?.number ?? null,
    title: content?.title ?? null,
    url: content?.url ?? null,
    issueState: content?.state ?? null,
    status: stringField(node.status),
    priority: stringField(node.priority),
    effort: stringField(node.effort),
    labels: (content?.labels.nodes.map(({ name }) => name) ?? []).sort((a, b) =>
      a.localeCompare(b),
    ),
    labelsTotalCount: content?.labels.totalCount ?? 0,
    hasDescription: Boolean(content?.body.trim()),
    bodyDigest: content
      ? createHash("sha256").update(content.body.trim()).digest("hex")
      : null,
    createdAt: content?.createdAt ?? null,
    closedAt: content?.closedAt ?? null,
    blockedByOpenCount: content?.issueDependenciesSummary.blockedBy ?? 0,
    blockingOpenCount: content?.issueDependenciesSummary.blocking ?? 0,
    blockedByTotalCount:
      content?.issueDependenciesSummary.totalBlockedBy ??
      content?.blockedBy.totalCount ??
      0,
    blockingTotalCount:
      content?.issueDependenciesSummary.totalBlocking ??
      content?.blocking.totalCount ??
      0,
    blockedBy: dependencyFacts(content?.blockedBy.nodes ?? []),
    blocking: dependencyFacts(content?.blocking.nodes ?? []),
  };
}

export function buildTriageFacts(
  project: string,
  config: ProjectConfig,
  rawItems: RawTriageItem[],
  activeRuns: ActiveRunFact[],
): TriageFacts {
  const runtimeSupported = Boolean(
    config.workspace?.canonical_repository &&
      config.workspace.worktree_root &&
      config.workspace.base_branch,
  );
  const runsByItem = new Map(
    activeRuns
      .filter((run) => !terminalRunStates.has(run.state))
      .map((run) => [run.itemId, run]),
  );
  const items = rawItems
    .map((item): TriageItemFact => {
      const activeRun = runsByItem.get(item.itemId) ?? null;
      const reasons: string[] = [];
      if (item.contentType !== "Issue") reasons.push("not_issue");
      if (item.repository !== config.repository) reasons.push("repository_mismatch");
      if (item.issueState !== "OPEN") reasons.push("issue_not_open");
      if (item.status !== config.statuses.backlog) reasons.push("not_backlog");
      if (!item.hasDescription) reasons.push("needs_clarification");
      if (item.blockedByOpenCount > 0) reasons.push("blocked_by_open_issue");
      if (activeRun) reasons.push("active_run_exists");
      if (!runtimeSupported) reasons.push("unsupported_runtime");
      return {
        ...item,
        activeRun,
        eligible: reasons.length === 0,
        eligibilityReasons: reasons,
        dependencyDetailsTruncated:
          item.blockedByTotalCount > item.blockedBy.length ||
          item.blockingTotalCount > item.blocking.length,
        labelsTruncated: item.labelsTotalCount > item.labels.length,
      };
    })
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
  const issues = items.filter(
    (item) => item.contentType === "Issue" && item.repository === config.repository,
  );
  const stats: TriageStats = {
    issues: issues.length,
    remainingOpen: issues.filter(
      (item) =>
        item.issueState === "OPEN" &&
        item.status !== config.statuses.done &&
        item.status !== config.statuses.deferred,
    ).length,
    backlog: issues.filter((item) => item.status === config.statuses.backlog).length,
    eligible: issues.filter((item) => item.eligible).length,
    blocked: issues.filter(
      (item) =>
        item.status === config.statuses.backlog && item.blockedByOpenCount > 0,
    ).length,
    needsClarification: issues.filter(
      (item) => item.status === config.statuses.backlog && !item.hasDescription,
    ).length,
    active: issues.filter((item) => item.status === config.statuses.active).length,
    review: issues.filter((item) => item.status === config.statuses.review).length,
    deferred: issues.filter((item) => item.status === config.statuses.deferred).length,
    done: issues.filter((item) => item.status === config.statuses.done).length,
  };
  return {
    policyVersion: 1,
    project,
    repository: config.repository,
    fields: {
      status: config.status_field,
      priority: config.triage?.priority_field?.trim() || "Priority",
      effort: config.triage?.effort_field?.trim() || "Effort",
    },
    statuses: config.statuses,
    runtimeSupported,
    items,
    stats,
  };
}

export function factualHash(facts: TriageFacts): string {
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

export function persistTriageSnapshot(
  database: DatabaseSync,
  facts: TriageFacts,
  checkedAt: string,
  sourceProjectCapturedAt: string | null,
): PersistedTriageSnapshot {
  const hash = factualHash(facts);
  const factsJson = JSON.stringify(facts);
  const statsJson = JSON.stringify(facts.stats);
  const previous = database
    .prepare(`
      SELECT factual_hash, change_sequence, first_observed_at,
             last_changed_at, last_checked_at
      FROM project_triage_state
      WHERE project = ?
    `)
    .get(facts.project) as
    | {
        factual_hash: string;
        change_sequence: number;
        first_observed_at: string;
        last_changed_at: string;
        last_checked_at: string;
      }
    | undefined;
  if (previous && previous.factual_hash === hash) {
    database
      .prepare(`
        UPDATE project_triage_state
        SET last_checked_at = ?, source_project_captured_at = ?
        WHERE project = ? AND factual_hash = ?
      `)
      .run(checkedAt, sourceProjectCapturedAt, facts.project, hash);
    return {
      project: facts.project,
      action: "unchanged",
      factualHash: hash,
      changeSequence: previous.change_sequence,
      stats: facts.stats,
      lastChangedAt: previous.last_changed_at,
      lastCheckedAt: checkedAt,
    };
  }

  const changeSequence = (previous?.change_sequence ?? 0) + 1;
  const snapshotId = `ts_${createHash("sha256")
    .update(`${facts.project}\u0000${changeSequence}\u0000${hash}`)
    .digest("hex")
    .slice(0, 24)}`;
  const firstObservedAt = previous?.first_observed_at ?? checkedAt;
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(`
        INSERT INTO project_triage_snapshots (
          snapshot_id, project, change_sequence, factual_hash,
          facts_json, stats_json, captured_at, source_project_captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        snapshotId,
        facts.project,
        changeSequence,
        hash,
        factsJson,
        statsJson,
        checkedAt,
        sourceProjectCapturedAt,
      );
    database
      .prepare(`
        INSERT INTO project_triage_state (
          project, factual_hash, facts_json, stats_json, change_sequence,
          first_observed_at, last_changed_at, last_checked_at,
          source_project_captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project) DO UPDATE SET
          factual_hash = excluded.factual_hash,
          facts_json = excluded.facts_json,
          stats_json = excluded.stats_json,
          change_sequence = excluded.change_sequence,
          last_changed_at = excluded.last_changed_at,
          last_checked_at = excluded.last_checked_at,
          source_project_captured_at = excluded.source_project_captured_at
      `)
      .run(
        facts.project,
        hash,
        factsJson,
        statsJson,
        changeSequence,
        firstObservedAt,
        checkedAt,
        checkedAt,
        sourceProjectCapturedAt,
      );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return {
    project: facts.project,
    action: "changed",
    factualHash: hash,
    changeSequence,
    stats: facts.stats,
    lastChangedAt: checkedAt,
    lastCheckedAt: checkedAt,
  };
}

function graphql(config: ProjectConfig, after: string | null): GraphqlResponse {
  const args = [
    "api",
    "graphql",
    "--field",
    `query=${QUERY}`,
    "--field",
    `login=${config.owner}`,
    "--field",
    `number=${config.project_number}`,
    "--field",
    `statusField=${config.status_field}`,
    "--field",
    `priorityField=${config.triage?.priority_field?.trim() || "Priority"}`,
    "--field",
    `effortField=${config.triage?.effort_field?.trim() || "Effort"}`,
  ];
  if (after !== null) args.push("--field", `after=${after}`);
  return JSON.parse(
    execFileSync("gh", args, {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ) as GraphqlResponse;
}

async function fetchItems(config: ProjectConfig): Promise<RawTriageItem[]> {
  const items: RawTriageItem[] = [];
  let after: string | null = null;
  do {
    const response = graphql(config, after);
    if (response.errors?.length)
      fail(response.errors.map(({ message }) => message).join("; "));
    const project = response.data?.user?.projectV2;
    if (!project)
      fail(`Project not found or inaccessible: ${config.owner}/${config.project_number}`);
    items.push(...project.items.nodes.map(nodeToRawItem));
    after = project.items.pageInfo.hasNextPage
      ? project.items.pageInfo.endCursor
      : null;
  } while (after !== null);
  return items;
}

function loadActiveRuns(database: DatabaseSync, project: string): ActiveRunFact[] {
  return database
    .prepare(`
      SELECT run_id, item_id, state, owner_state
      FROM runs
      WHERE project = ?
        AND state NOT IN ('rejected', 'cancelled', 'archived')
      ORDER BY item_id, created_at DESC
    `)
    .all(project)
    .map((row) => {
      const run = row as {
        run_id: string;
        item_id: string;
        state: string;
        owner_state: string;
      };
      return {
        runId: run.run_id,
        itemId: run.item_id,
        state: run.state,
        ownerState: run.owner_state,
      };
    });
}

function sourceCapturedAt(database: DatabaseSync, project: string): string | null {
  const row = database
    .prepare("SELECT last_captured_at FROM project_poll_state WHERE project = ?")
    .get(project) as { last_captured_at: string } | undefined;
  return row?.last_captured_at ?? null;
}

function selectedProjectFromArgs(args: string[]): string | null {
  const index = args.indexOf("--project");
  if (index === -1) return null;
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith("--")) fail("--project requires a value");
  return value;
}

async function main(): Promise<void> {
  const orchestratorHome = resolve(
    process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const registry = parse(
    await readFile(resolve(orchestratorHome, "config/projects.yaml"), "utf8"),
  ) as Registry;
  if (registry.version !== 1 || !registry.projects)
    fail("Unsupported projects registry");
  const selectedProject = selectedProjectFromArgs(process.argv.slice(2));
  if (selectedProject && !registry.projects[selectedProject])
    fail(`Unknown project: ${selectedProject}`);
  const entries = Object.entries(registry.projects).filter(
    ([project, config]) =>
      (!selectedProject || project === selectedProject) && config.triage?.enabled !== false,
  );
  const database = new DatabaseSync(
    resolve(orchestratorHome, "state/orchestrator.db"),
    { timeout: 5_000 },
  );
  try {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const checkedAt = new Date().toISOString();
    const results: PersistedTriageSnapshot[] = [];
    for (const [project, config] of entries) {
      const items = await fetchItems(config);
      const facts = buildTriageFacts(
        project,
        config,
        items,
        loadActiveRuns(database, project),
      );
      results.push(
        persistTriageSnapshot(
          database,
          facts,
          checkedAt,
          sourceCapturedAt(database, project),
        ),
      );
    }
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        checkedAt,
        projects: results,
        changed: results.filter(({ action }) => action === "changed").length,
        unchanged: results.filter(({ action }) => action === "unchanged").length,
        next: "advisory_ranking_not_started",
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
