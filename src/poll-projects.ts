import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";

process.umask(0o077);

type ProjectConfig = {
  owner: string;
  project_number: number;
  repository: string;
  status_field: string;
  statuses: Record<string, string>;
};

type Registry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type ProjectItem = {
  id: string;
  type: string;
  status: string | null;
  content: {
    __typename: string;
    id?: string;
    number?: number;
    title?: string;
    url?: string;
    state?: string;
    body?: string;
    labels?: { nodes: Array<{ name: string }> };
    repository?: { nameWithOwner: string };
  } | null;
};

type GraphqlResponse = {
  data?: {
    user?: {
      projectV2?: {
        items: {
          nodes: Array<{
            id: string;
            type: string;
            fieldValueByName: { name: string } | null;
            content: ProjectItem["content"];
          }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    };
    rateLimit?: {
      cost: number;
      remaining: number;
      resetAt: string;
    };
  };
  errors?: Array<{ message: string }>;
};

type SnapshotItem = {
  project: string;
  itemId: string;
  contentId: string | null;
  contentType: string | null;
  repository: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  status: string | null;
  issueState: string | null;
  labels: string[];
  hasDescription: boolean;
};

type Transition = {
  eventId: string;
  observedAt: string;
  project: string;
  itemId: string;
  contentId: string | null;
  contentType: string | null;
  repository: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  from: string | null;
  to: string | null;
  issueState: string | null;
  labels: string[];
  hasDescription: boolean;
};

const QUERY = String.raw`
  query ProjectItems(
    $login: String!
    $number: Int!
    $statusField: String!
    $after: String
  ) {
    user(login: $login) {
      projectV2(number: $number) {
        items(first: 100, after: $after) {
          nodes {
            id
            type
            fieldValueByName(name: $statusField) {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
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
                labels(first: 50) {
                  nodes { name }
                }
                repository { nameWithOwner }
              }
              ... on PullRequest {
                id
                number
                title
                url
                state
                repository { nameWithOwner }
              }
              ... on DraftIssue {
                id
                title
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
    rateLimit {
      cost
      remaining
      resetAt
    }
  }
`;

const orchestratorHome = resolve(
  process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const configPath = resolve(orchestratorHome, "config/projects.yaml");
const selectedProject = process.env.POLLER_PROJECT?.trim() || null;
const stateSuffix = selectedProject ? `-${selectedProject}` : "";
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const runLogPath = resolve(
  orchestratorHome,
  `logs/project-poller${stateSuffix}.jsonl`,
);

function fail(message: string): never {
  throw new Error(message);
}

function runGraphql(config: ProjectConfig, after: string | null): GraphqlResponse {
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
  ];

  if (after !== null) {
    args.push("--field", `after=${after}`);
  }

  const stdout = execFileSync("gh", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return JSON.parse(stdout) as GraphqlResponse;
}

async function loadRegistry(): Promise<Registry> {
  const registry = parse(await readFile(configPath, "utf8")) as Registry;

  if (registry.version !== 1 || !registry.projects) {
    fail(`Unsupported or invalid registry: ${configPath}`);
  }

  return registry;
}

async function appendRunLog(record: unknown): Promise<void> {
  await mkdir(dirname(runLogPath), { recursive: true, mode: 0o700 });
  await appendFile(runLogPath, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(runLogPath, 0o600);
}

async function fetchProject(
  project: string,
  config: ProjectConfig,
): Promise<{
  items: SnapshotItem[];
  rateLimit: { cost: number; remaining: number; resetAt: string } | null;
}> {
  const items: SnapshotItem[] = [];
  let after: string | null = null;
  let rateLimit: { cost: number; remaining: number; resetAt: string } | null = null;

  do {
    const response = runGraphql(config, after);

    if (response.errors?.length) {
      fail(response.errors.map(({ message }) => message).join("; "));
    }

    const projectData = response.data?.user?.projectV2;
    if (!projectData) {
      fail(`Project not found or inaccessible: ${config.owner}/${config.project_number}`);
    }

    for (const node of projectData.items.nodes) {
      const content = node.content;
      items.push({
        project,
        itemId: node.id,
        contentId: content?.id ?? null,
        contentType: content?.__typename ?? null,
        repository: content?.repository?.nameWithOwner ?? null,
        number: content?.number ?? null,
        title: content?.title ?? null,
        url: content?.url ?? null,
        status: node.fieldValueByName?.name ?? null,
        issueState: content?.__typename === "Issue" ? content.state ?? null : null,
        labels:
          content?.__typename === "Issue"
            ? (content.labels?.nodes.map(({ name }) => name) ?? [])
            : [],
        hasDescription:
          content?.__typename === "Issue" && Boolean(content.body?.trim()),
      });
    }

    rateLimit = response.data?.rateLimit ?? null;
    after = projectData.items.pageInfo.hasNextPage
      ? projectData.items.pageInfo.endCursor
      : null;
  } while (after !== null);

  return { items, rateLimit };
}

function persistProjectSnapshot(
  database: DatabaseSync,
  project: string,
  capturedAt: string,
  durationMs: number,
  items: SnapshotItem[],
  rateLimit: { cost: number; remaining: number; resetAt: string } | null,
): { mode: "baseline" | "poll"; transitions: Transition[] } {
  const transitions: Transition[] = [];
  const pollState = database
    .prepare("SELECT last_captured_at FROM project_poll_state WHERE project = ?")
    .get(project) as { last_captured_at: string } | undefined;
  const mode = pollState ? "poll" : "baseline";
  const getPrevious = database.prepare(`
    SELECT status, last_seen_at
    FROM project_items
    WHERE project = ? AND item_id = ?
  `);
  const upsertItem = database.prepare(`
    INSERT INTO project_items (
      project, item_id, content_id, content_type, repository, issue_number,
      title, url, status, present, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(project, item_id) DO UPDATE SET
      content_id = excluded.content_id,
      content_type = excluded.content_type,
      repository = excluded.repository,
      issue_number = excluded.issue_number,
      title = excluded.title,
      url = excluded.url,
      status = excluded.status,
      present = 1,
      last_seen_at = excluded.last_seen_at
  `);
  const insertEvent = database.prepare(`
    INSERT INTO project_events (
      event_id, observed_at, project, item_id, content_id, content_type,
      repository, issue_number, title, url, from_status, to_status,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING
  `);
  const markAbsent = database.prepare(
    "UPDATE project_items SET present = 0 WHERE project = ?",
  );
  const upsertPollState = database.prepare(`
    INSERT INTO project_poll_state (
      project, initialized_at, last_captured_at, item_count,
      last_duration_ms, rate_limit_remaining, rate_limit_reset_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project) DO UPDATE SET
      last_captured_at = excluded.last_captured_at,
      item_count = excluded.item_count,
      last_duration_ms = excluded.last_duration_ms,
      rate_limit_remaining = excluded.rate_limit_remaining,
      rate_limit_reset_at = excluded.rate_limit_reset_at
  `);

  database.exec("BEGIN IMMEDIATE");

  try {
    markAbsent.run(project);

    for (const item of items) {
      const previous = getPrevious.get(project, item.itemId) as
        | { status: string | null; last_seen_at: string }
        | undefined;

      if (mode === "poll" && previous && previous.status !== item.status) {
        const eventId = createHash("sha256")
          .update(
            [
              project,
              item.itemId,
              previous.last_seen_at,
              previous.status ?? "none",
              item.status ?? "none",
            ].join("\u0000"),
          )
          .digest("hex");
        const transition: Transition = {
          eventId,
          observedAt: capturedAt,
          project,
          itemId: item.itemId,
          contentId: item.contentId,
          contentType: item.contentType,
          repository: item.repository,
          number: item.number,
          title: item.title,
          url: item.url,
          from: previous.status,
          to: item.status,
          issueState: item.issueState,
          labels: item.labels,
          hasDescription: item.hasDescription,
        };
        const insertion = insertEvent.run(
          eventId,
          capturedAt,
          project,
          item.itemId,
          item.contentId,
          item.contentType ?? "Unknown",
          item.repository,
          item.number,
          item.title,
          item.url,
          previous.status,
          item.status,
          JSON.stringify(transition),
        );

        if (Number(insertion.changes) === 1) {
          transitions.push(transition);
        }
      }

      upsertItem.run(
        project,
        item.itemId,
        item.contentId,
        item.contentType,
        item.repository,
        item.number,
        item.title,
        item.url,
        item.status,
        capturedAt,
        capturedAt,
      );
    }

    upsertPollState.run(
      project,
      capturedAt,
      capturedAt,
      items.length,
      durationMs,
      rateLimit?.remaining ?? null,
      rateLimit?.resetAt ?? null,
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return { mode, transitions };
}

function formatTransitions(transitions: Transition[]): string {
  return transitions
    .map((transition) => {
      const issue = transition.number === null ? "item" : `#${transition.number}`;
      const title = transition.title ?? "Untitled item";
      const url = transition.url ? `\n${transition.url}` : "";
      return `${transition.project} ${issue}: ${transition.from ?? "No status"} → ${transition.to ?? "No status"}\n${title}${url}`;
    })
    .join("\n\n");
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const registry = await loadRegistry();
  const projects = selectedProject
    ? Object.entries(registry.projects).filter(([project]) => project === selectedProject)
    : Object.entries(registry.projects);

  if (selectedProject && projects.length === 0) {
    fail(`Unknown project: ${selectedProject}`);
  }

  const capturedAt = new Date().toISOString();
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  const rateLimits: Record<string, unknown> = {};
  const transitions: Transition[] = [];
  const modes: Array<"baseline" | "poll"> = [];
  let itemCount = 0;

  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

    for (const [project, config] of projects) {
      const result = await fetchProject(project, config);
      const durationMs = Date.now() - startedAt;
      const persisted = persistProjectSnapshot(
        database,
        project,
        capturedAt,
        durationMs,
        result.items,
        result.rateLimit,
      );
      rateLimits[project] = result.rateLimit;
      modes.push(persisted.mode);
      transitions.push(...persisted.transitions);
      itemCount += result.items.length;
    }
  } finally {
    database.close();
  }

  const result = {
    ok: true,
    mode: modes.every((mode) => mode === "baseline") ? "baseline" : "poll",
    capturedAt,
    durationMs: Date.now() - startedAt,
    projects: projects.length,
    items: itemCount,
    transitions,
    rateLimits,
  };

  await appendRunLog(result);

  if (transitions.length > 0) {
    process.stdout.write(`${formatTransitions(transitions)}\n`);
  } else if (process.env.POLLER_QUIET !== "1") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
