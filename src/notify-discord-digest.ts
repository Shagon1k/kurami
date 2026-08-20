import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import type { TriageStats } from "./triage-snapshot.ts";

process.umask(0o077);

type OrchestratorConfig = {
  version: number;
  discord?: { digest_channel_id?: string };
};

type ProjectConfig = {
  owner: string;
  project_number: number;
  repository: string;
  workspace: { branch_prefix: string };
};

type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type DigestRow = {
  project: string;
  factual_hash: string;
  change_sequence: number;
  stats_json: string;
  last_changed_at: string;
  last_checked_at: string;
  policy_version: string;
  selected_issue_number: number | null;
  selected_title: string | null;
  selected_url: string | null;
  explanation: string;
  ranking_content_digest: string;
  suggested_since: string;
  message_id: string | null;
  surface_channel_id: string | null;
  surface_content_digest: string | null;
  surface_state: string | null;
};

type DiscordObject = Record<string, unknown>;

const apiBase = (
  process.env.DISCORD_API_BASE ?? "https://discord.com/api/v10"
).replace(/\/$/u, "");

function fail(message: string): never {
  throw new Error(message);
}

function parseEnvValue(content: string, key: string): string | undefined {
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match || match[1] !== key) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    return value || undefined;
  }
  return undefined;
}

async function loadDiscordToken(hermesHome: string): Promise<string> {
  const scoped = process.env.DISCORD_BOT_TOKEN?.trim();
  if (scoped) return scoped;
  const env = await readFile(resolve(hermesHome, ".env"), "utf8");
  const token = parseEnvValue(env, "DISCORD_BOT_TOKEN");
  if (!token) fail("DISCORD_BOT_TOKEN is unavailable");
  return token;
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function unixTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1_000) : 0;
}

function projectName(config: ProjectConfig): string {
  return config.repository.split("/").at(-1) ?? config.repository;
}

function projectUrl(config: ProjectConfig): string {
  return `https://github.com/users/${encodeURIComponent(config.owner)}/projects/${config.project_number}`;
}

function linkLabel(value: string): string {
  return value.replace(/[\[\]\r\n]+/gu, " ").trim();
}

function desiredDigest(row: DigestRow): string {
  return createHash("sha256")
    .update(
      [
        row.ranking_content_digest,
        row.stats_json,
        row.last_checked_at.slice(0, 10),
        String(row.change_sequence),
        "discord-project-digest-v1",
      ].join(":"),
    )
    .digest("hex");
}

function overview(stats: TriageStats): string {
  return [
    `Remaining **${stats.remainingOpen}** · Backlog **${stats.backlog}** · Ready **${stats.eligible}**`,
    `Blocked **${stats.blocked}** · Active **${stats.active}** · Review **${stats.review}**`,
    `Deferred **${stats.deferred}** · Done **${stats.done}**`,
  ].join("\n");
}

export function digestPayload(
  row: DigestRow,
  config: ProjectConfig,
  create: boolean,
): DiscordObject {
  const stats = JSON.parse(row.stats_json) as TriageStats;
  const prefix = config.workspace.branch_prefix;
  const suggestion =
    row.selected_issue_number && row.selected_title && row.selected_url
      ? [
          `[${prefix}-${row.selected_issue_number} · ${truncate(linkLabel(row.selected_title), 180)}](${row.selected_url})`,
          truncate(row.explanation, 700),
        ].join("\n")
      : row.explanation;
  const suggestedSince = unixTimestamp(row.suggested_since);
  const lastChecked = unixTimestamp(row.last_checked_at);
  const components = [
    ...(row.selected_url
      ? [
          {
            type: 2,
            style: 5,
            label: "Open suggested issue",
            url: row.selected_url,
          },
        ]
      : []),
    {
      type: 2,
      style: 5,
      label: "Open project",
      url: projectUrl(config),
    },
  ];
  return {
    content: `**${projectName(config)} · Project digest**`,
    embeds: [
      {
        title: "Suggested next",
        description: truncate(suggestion, 4_000),
        color: row.selected_issue_number ? 0x5865f2 : 0x99aab5,
        fields: [
          { name: "Project health", value: overview(stats) },
          {
            name: "Freshness",
            value: [
              suggestedSince ? `Suggested <t:${suggestedSince}:R>` : "",
              lastChecked ? `Last checked <t:${lastChecked}:R>` : "",
            ]
              .filter(Boolean)
              .join(" · "),
          },
        ],
        footer: {
          text: `Snapshot ${row.change_sequence} · ${row.policy_version}`,
        },
      },
    ],
    components: [{ type: 1, components }],
    allowed_mentions: { parse: [] },
    ...(create
      ? {
          nonce: `digest-${createHash("sha256")
            .update(row.project)
            .digest("hex")
            .slice(0, 18)}`,
          enforce_nonce: true,
        }
      : {}),
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function discordRequest(
  token: string,
  method: string,
  path: string,
  payload?: DiscordObject,
  allowNotFound = false,
): Promise<DiscordObject | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bot ${token}`,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (allowNotFound && response.status === 404) return null;
    if (response.status === 429) {
      const body = (await response.json()) as { retry_after?: number };
      await delay(Math.min(Math.max(Number(body.retry_after ?? 1), 0.1), 5) * 1_000);
      continue;
    }
    if (response.status >= 500 && attempt < 2) {
      await delay(250 * (attempt + 1));
      continue;
    }
    if (!response.ok) {
      const text = await response.text();
      fail(
        `Discord ${method} ${path} failed: HTTP ${response.status} ${text.slice(0, 300)}`,
      );
    }
    if (response.status === 204) return {};
    return (await response.json()) as DiscordObject;
  }
  fail(`Discord ${method} ${path} exhausted bounded retries`);
}

function loadRows(
  database: DatabaseSync,
  selectedProject: string | null,
): DigestRow[] {
  return database
    .prepare(`
      SELECT ts.project, ts.factual_hash, ts.change_sequence, ts.stats_json,
             ts.last_changed_at, ts.last_checked_at,
             tr.policy_version, tr.selected_issue_number, tr.selected_title,
             tr.selected_url, tr.explanation,
             tr.content_digest AS ranking_content_digest,
             tr.suggested_since,
             ds.message_id, ds.channel_id AS surface_channel_id,
             ds.content_digest AS surface_content_digest,
             ds.state AS surface_state
      FROM project_triage_state ts
      JOIN project_triage_rankings tr ON tr.project = ts.project
        AND tr.factual_hash = ts.factual_hash
      LEFT JOIN project_discord_digest_surfaces ds ON ds.project = ts.project
      WHERE (? IS NULL OR ts.project = ?)
      ORDER BY ts.project
    `)
    .all(selectedProject, selectedProject) as DigestRow[];
}

function recordFailure(
  database: DatabaseSync,
  project: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  database
    .prepare(`
      UPDATE project_discord_digest_surfaces
      SET state = 'failed', last_error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project = ?
    `)
    .run(message.slice(0, 500), project);
}

async function reconcile(
  database: DatabaseSync,
  token: string,
  channelId: string,
  row: DigestRow,
  config: ProjectConfig,
): Promise<Record<string, unknown>> {
  const digest = desiredDigest(row);
  if (
    row.message_id &&
    row.surface_state === "active" &&
    row.surface_content_digest === digest
  )
    return { project: row.project, action: "unchanged", messageId: row.message_id };
  database
    .prepare(`
      INSERT INTO project_discord_digest_surfaces (
        project, channel_id, state, attempt_count
      ) VALUES (?, ?, 'pending', 1)
      ON CONFLICT(project) DO UPDATE SET
        state = 'pending', attempt_count = attempt_count + 1,
        last_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `)
    .run(row.project, channelId);
  if (row.surface_channel_id && row.surface_channel_id !== channelId)
    fail(`Digest channel changed for existing project ${row.project}`);
  let messageId = row.message_id;
  let action = "edited";
  if (messageId) {
    const edited = await discordRequest(
      token,
      "PATCH",
      `/channels/${channelId}/messages/${messageId}`,
      digestPayload(row, config, false),
      true,
    );
    if (!edited) messageId = null;
  }
  if (!messageId) {
    const created = await discordRequest(
      token,
      "POST",
      `/channels/${channelId}/messages`,
      digestPayload(row, config, true),
    );
    messageId = String(created?.id ?? "");
    if (!/^\d+$/u.test(messageId)) fail("Discord returned no digest message ID");
    action = "created";
  }
  database
    .prepare(`
      UPDATE project_discord_digest_surfaces
      SET channel_id = ?, message_id = ?, content_digest = ?,
          state = 'active', attempt_count = 0, last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project = ?
    `)
    .run(channelId, messageId, digest, row.project);
  return { project: row.project, action, messageId };
}

function parseArguments(args: string[]): {
  selectedProject: string | null;
  apply: boolean;
} {
  const index = args.indexOf("--project");
  const selectedProject = index === -1 ? null : args[index + 1]?.trim();
  if (index !== -1 && (!selectedProject || selectedProject.startsWith("--")))
    fail("--project requires a value");
  const known = new Set(["--apply", "--project", selectedProject]);
  if (args.some((arg) => !known.has(arg)))
    fail("Usage: notify-discord-digest.ts [--project <project>] [--apply]");
  return { selectedProject: selectedProject ?? null, apply: args.includes("--apply") };
}

async function main(): Promise<void> {
  const { selectedProject, apply } = parseArguments(process.argv.slice(2));
  const orchestratorHome = resolve(
    process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const hermesHome = resolve(
    process.env.HERMES_HOME ?? "/home/shagon1k/_hermes/_core",
  );
  const [orchestratorConfig, registry] = (await Promise.all([
    readFile(resolve(orchestratorHome, "config/orchestrator.yaml"), "utf8"),
    readFile(resolve(orchestratorHome, "config/projects.yaml"), "utf8"),
  ])).map((content) => parse(content)) as [OrchestratorConfig, ProjectsRegistry];
  if (orchestratorConfig.version !== 1 || registry.version !== 1)
    fail("Unsupported configuration version");
  const channelId = orchestratorConfig.discord?.digest_channel_id?.trim();
  if (!channelId || !/^\d+$/u.test(channelId))
    fail("discord.digest_channel_id must be configured");
  if (selectedProject && !registry.projects[selectedProject])
    fail(`Unknown project: ${selectedProject}`);
  const database = new DatabaseSync(
    resolve(orchestratorHome, "state/orchestrator.db"),
    { timeout: 5_000 },
  );
  try {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const rows = loadRows(database, selectedProject).filter(
      (row) => Boolean(registry.projects[row.project]),
    );
    const pending = rows.filter((row) => {
      const digest = desiredDigest(row);
      return (
        !row.message_id ||
        row.surface_state !== "active" ||
        row.surface_content_digest !== digest
      );
    });
    if (!apply) {
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          apply: false,
          channelId,
          cards: rows.length,
          pending: pending.map((row) => ({
            project: row.project,
            action: row.message_id ? "edit" : "create",
          })),
        })}\n`,
      );
      return;
    }
    if (pending.length === 0) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, channelId, results: [] })}\n`,
      );
      return;
    }
    const token = await loadDiscordToken(hermesHome);
    const results: Array<Record<string, unknown>> = [];
    for (const row of pending) {
      try {
        results.push(
          await reconcile(
            database,
            token,
            channelId,
            row,
            registry.projects[row.project]!,
          ),
        );
      } catch (error) {
        recordFailure(database, row.project, error);
        results.push({
          project: row.project,
          action: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const failures = results.filter(({ action }) => action === "failed");
    process.stdout.write(
      `${JSON.stringify({
        ok: failures.length === 0,
        apply: true,
        channelId,
        results,
      })}\n`,
    );
    if (failures.length > 0) process.exitCode = 1;
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
