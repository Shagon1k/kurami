import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { codexLaunchUrl } from "./codex-deeplink.ts";

process.umask(0o077);

type DiscordConfig = { guild_id: string; channel_id: string };
type ProjectConfig = {
  discord?: DiscordConfig;
  preview?: Record<string, unknown>;
  workspace: { branch_prefix: string };
};
type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};
type EventKind =
  | "review_ready"
  | "human_control_ready"
  | "preview_ready"
  | "preview_failed"
  | "attention_required";
type CiState = "pending" | "passed" | "failed" | "missing" | "unknown";
type CiCheck = {
  name: string;
  state: CiState;
  source: "check_run" | "commit_status" | "missing";
  detailsUrl: string | null;
};
type CiEventPayload = {
  source: "ci";
  state: "failed" | "missing";
  headSha: string;
  pullRequestUrl?: string | null;
  pullRequestTitle?: string | null;
  checks: CiCheck[];
};
type CardRow = {
  run_id: string;
  stage: string;
  detail: string;
  content_digest: string;
  desired_surface_digest: string;
  updated_at: string;
  project: string;
  repository: string;
  issue_number: number;
  interaction_policy: string;
  run_state: string;
  owner_state: string;
  stop_reason: string | null;
  title: string | null;
  issue_url: string | null;
  branch_name: string | null;
  codex_thread_id: string | null;
  previous_codex_thread_id: string | null;
  preview_hostname: string | null;
  preview_state: string | null;
  preview_expires_at: string | null;
  preview_extension_count: number;
  preview_reviewed_at: string | null;
  preview_reviewed_by: string | null;
  preview_reviewed_via: string | null;
  preview_verified_head_sha: string | null;
  preview_runtime_adapter: "compose" | "static" | null;
  preview_artifact_digest: string | null;
  preview_artifact_file_count: number | null;
  preview_artifact_total_bytes: number | null;
  preview_required: number;
  preview_required_label: string | null;
  completion_requested_at: string | null;
  preview_requirement_satisfied_at: string | null;
  surface_state: string | null;
  surface_guild_id: string | null;
  surface_parent_channel_id: string | null;
  live_card_message_id: string | null;
  discord_thread_id: string | null;
  control_message_id: string | null;
  discord_owner_user_id: string | null;
  surface_content_digest: string | null;
  pull_request_url: string | null;
  pull_request_title: string | null;
  surface_attempt_count: number | null;
  ci_pull_request_url: string | null;
  ci_pull_request_title: string | null;
  ci_pull_request_number: number | null;
  ci_head_sha: string | null;
  ci_aggregate_state: CiState | null;
  ci_checks_json: string | null;
  ci_last_error: string | null;
  ci_repair_attempt_count: number;
  ci_repair_state: string | null;
  ai_review_state: string | null;
  ai_review_head_sha: string | null;
  ai_review_critical_count: number;
  ai_review_important_count: number;
  ai_review_suggestion_count: number;
  ai_review_url: string | null;
  ai_review_failure_reason: string | null;
  ai_review_request_active_count: number;
  review_fix_state: string | null;
  review_fix_round_number: number | null;
  review_fix_thread_count: number;
  review_fix_request_active_count: number;
};
type EventRow = {
  event_id: string;
  run_id: string;
  event_kind: EventKind;
  project: string;
  repository: string;
  issue_number: number;
  run_state: string;
  owner_state: string;
  title: string | null;
  issue_url: string | null;
  branch_name: string | null;
  codex_thread_id: string | null;
  preview_hostname: string | null;
  guild_id: string;
  thread_id: string;
  control_message_id: string | null;
  delivery_state: string;
  payload_json: string;
  current_ci_head_sha: string | null;
  current_ci_aggregate_state: CiState | null;
  current_ci_checks_json: string | null;
  current_ci_pull_request_url: string | null;
};
type PullRequest = {
  url: string;
  title: string;
  number?: number;
  headSha?: string;
  baseRefName?: string;
};
type DiscordObject = Record<string, unknown>;

const orchestratorHome = resolve(
  process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const hermesHome = resolve(
  process.env.HERMES_HOME ?? "/home/shagon1k/_hermes/_core",
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");
const apiBase = (
  process.env.DISCORD_API_BASE ?? "https://discord.com/api/v10"
).replace(/\/$/u, "");
const terminalStages = new Set(["completed", "cancelled"]);
const ownerTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Vilnius",
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const desiredSurfaceDigestSql = `
  pc.content_digest || ':' || r.state || ':' || r.owner_state || ':' ||
  COALESCE(rr.codex_thread_id, 'thread:none') || ':' ||
  COALESCE(rr.previous_codex_thread_id, 'previous-thread:none') || ':' ||
  COALESCE(pl.state, 'preview:none') || ':' ||
  COALESCE(pl.expires_at, 'expiry:none') || ':' ||
  COALESCE(pl.extension_count, 0) || ':' ||
  COALESCE(pl.reviewed_at, 'reviewed:none') || ':' ||
  COALESCE(pl.reviewed_by, 'reviewer:none') || ':' ||
  COALESCE(pl.verified_head_sha, 'preview-head:none') || ':' ||
  COALESCE(pl.runtime_adapter, 'adapter:none') || ':' ||
  COALESCE(pl.artifact_digest, 'artifact:none') || ':' ||
  COALESCE(pl.artifact_file_count, -1) || ':' ||
  COALESCE(pl.artifact_total_bytes, -1) || ':' ||
  r.preview_required || ':' ||
  COALESCE(r.completion_requested_at, 'completion:none') || ':' ||
  COALESCE(r.preview_requirement_satisfied_at, 'preview-satisfied:none') || ':' ||
  COALESCE(ps.hostname, 'host:none') || ':' ||
  COALESCE(r.stop_reason, 'stop:none') || ':discord-ux-v6'
  || ':' || COALESCE(ci.content_digest, 'ci:none') || ':' ||
  (SELECT COUNT(*) FROM run_ci_repair_attempts repair_count
   WHERE repair_count.run_id = r.run_id) || ':' ||
  COALESCE((SELECT attempt_state FROM run_ci_repair_attempts repair_latest
            WHERE repair_latest.run_id = r.run_id
            ORDER BY repair_latest.attempt_number DESC LIMIT 1), 'repair:none') || ':' ||
  COALESCE((SELECT review_state || ':' || head_sha || ':' ||
                   critical_count || ':' || important_count || ':' ||
                   suggestion_count
            FROM run_ai_reviews review_latest
            WHERE review_latest.run_id = r.run_id
            ORDER BY review_latest.review_number DESC LIMIT 1), 'review:none') || ':' ||
  (SELECT COUNT(*) FROM run_control_requests review_request
   WHERE review_request.run_id = r.run_id
     AND review_request.action = 'ai_review'
     AND review_request.request_state IN ('pending', 'processing')) || ':' ||
  COALESCE((SELECT round_state || ':' || round_number
            FROM run_review_fix_rounds fix_latest
            WHERE fix_latest.run_id = r.run_id
            ORDER BY fix_latest.round_number DESC LIMIT 1), 'review-fix:none') || ':' ||
  (SELECT COUNT(*) FROM run_control_requests fix_request
   WHERE fix_request.run_id = r.run_id
     AND fix_request.action = 'review_fix'
     AND fix_request.request_state IN ('pending', 'processing'))
`;

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): {
  command: "sync" | "show";
  runId?: string;
  apply: boolean;
} {
  const args = process.argv.slice(2);
  const command = args[0] === "show" ? "show" : "sync";
  const runIndex = args.indexOf("--run-id");
  const runId = runIndex >= 0 ? args[runIndex + 1]?.trim() : undefined;
  const known = new Set(["show", "--run-id", runId, "--apply"]);
  if (args.some((arg) => !known.has(arg)))
    fail(
      "Usage: notify-discord-controls.ts [--apply] | show --run-id <run_id> [--apply]",
    );
  if (command === "show" && (!runId || !/^r_[A-Za-z0-9_]+$/u.test(runId)))
    fail("show requires a valid --run-id");
  if (command === "sync" && runId) fail("--run-id is only supported by show");
  return { command, runId, apply: args.includes("--apply") };
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

async function loadDiscordToken(): Promise<string> {
  const scoped = process.env.DISCORD_BOT_TOKEN?.trim();
  if (scoped) return scoped;
  const env = await readFile(resolve(hermesHome, ".env"), "utf8");
  const token = parseEnvValue(env, "DISCORD_BOT_TOKEN");
  if (!token) fail("DISCORD_BOT_TOKEN is unavailable");
  return token;
}

async function loadDiscordOwnerId(): Promise<string> {
  let raw = process.env.DISCORD_ALLOWED_USERS?.trim();
  if (!raw) {
    const env = await readFile(resolve(hermesHome, ".env"), "utf8");
    raw = parseEnvValue(env, "DISCORD_ALLOWED_USERS");
  }
  const owners = (raw ?? "").split(/[\s,]+/u).filter(Boolean);
  if (owners.length !== 1 || !/^\d+$/u.test(owners[0]!))
    fail("Discord control plane requires exactly one numeric allowed owner ID");
  return owners[0]!;
}

function ownerTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const parts = Object.fromEntries(
    ownerTimestampFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

function stageTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return ownerTimestamp(value);
  return `${ownerTimestamp(value)} · <t:${Math.floor(date.valueOf() / 1_000)}:R>`;
}

function cleanTitle(value: string | null): string {
  const title = (value ?? "Untitled issue").replace(
    /^\s*\[[^\]]+\]\s*:\s*/u,
    "",
  );
  return title.trim() || "Untitled issue";
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function threadName(card: CardRow, config: ProjectConfig): string {
  return truncate(
    `[${config.workspace.branch_prefix}-${card.issue_number}] ${cleanTitle(card.title)}`,
    100,
  );
}

function codexTaskName(
  card: Pick<CardRow, "issue_number" | "title">,
  config: ProjectConfig,
): string {
  return `[${config.workspace.branch_prefix}-${card.issue_number}]: ${cleanTitle(card.title)}`;
}

function repositoryName(repository: string): string {
  return repository.split("/").at(-1) || repository;
}

function remoteCodexContext(
  card: Pick<
    CardRow,
    | "codex_thread_id"
    | "issue_number"
    | "owner_state"
    | "repository"
    | "run_state"
    | "title"
  >,
  project: ProjectConfig,
): { launchUrl: string; summary: string } | null {
  if (card.run_state !== "remote_owned" || card.owner_state !== "remote")
    return null;
  const launchUrl = codexLaunchUrl(card.codex_thread_id);
  if (!launchUrl || !card.codex_thread_id) return null;
  return {
    launchUrl,
    summary: [
      `[Open in Codex](${launchUrl})`,
      `**Task:** ${truncate(codexTaskName(card, project), 300)}`,
      `**Connection/project:** \`shagserv / ${repositoryName(card.repository)}\``,
      `**Thread ID:** \`${card.codex_thread_id}\``,
      "Automation released: managed CLI/tmux no longer owns this task.",
    ].join("\n"),
  };
}

function deterministicNonce(kind: "card" | "event", id: string): string {
  return `${kind[0]}-${createHash("sha256").update(id).digest("hex").slice(0, 20)}`;
}

function loadDesiredCards(database: DatabaseSync): CardRow[] {
  return database
    .prepare(
      `
      SELECT pc.run_id, pc.stage, pc.detail, pc.content_digest,
             ${desiredSurfaceDigestSql} AS desired_surface_digest,
             pc.updated_at,
             r.project, r.repository, r.issue_number, r.interaction_policy,
             r.state AS run_state, r.owner_state, r.stop_reason,
             pe.title, pe.url AS issue_url,
             rr.branch_name, rr.codex_thread_id,
             rr.previous_codex_thread_id,
             ps.hostname AS preview_hostname,
             pl.state AS preview_state,
             pl.expires_at AS preview_expires_at,
             COALESCE(pl.extension_count, 0) AS preview_extension_count,
             pl.reviewed_at AS preview_reviewed_at,
             pl.reviewed_by AS preview_reviewed_by,
             pl.reviewed_via AS preview_reviewed_via,
             pl.verified_head_sha AS preview_verified_head_sha,
             pl.runtime_adapter AS preview_runtime_adapter,
             pl.artifact_digest AS preview_artifact_digest,
             pl.artifact_file_count AS preview_artifact_file_count,
             pl.artifact_total_bytes AS preview_artifact_total_bytes,
             r.preview_required, r.preview_required_label,
             r.completion_requested_at,
             r.preview_requirement_satisfied_at,
             ds.state AS surface_state,
             ds.guild_id AS surface_guild_id,
             ds.parent_channel_id AS surface_parent_channel_id,
             ds.live_card_message_id,
             ds.thread_id AS discord_thread_id,
             ds.control_message_id,
             ds.owner_user_id AS discord_owner_user_id,
             ds.content_digest AS surface_content_digest,
             ds.pull_request_url,
             ds.pull_request_title,
             ds.attempt_count AS surface_attempt_count,
             ci.pull_request_url AS ci_pull_request_url,
             ci.pull_request_title AS ci_pull_request_title,
             ci.pull_request_number AS ci_pull_request_number,
             ci.head_sha AS ci_head_sha,
             ci.aggregate_state AS ci_aggregate_state,
             ci.checks_json AS ci_checks_json,
             ci.last_error AS ci_last_error,
             (SELECT COUNT(*) FROM run_ci_repair_attempts a
              WHERE a.run_id = r.run_id) AS ci_repair_attempt_count,
             (SELECT attempt_state FROM run_ci_repair_attempts a
              WHERE a.run_id = r.run_id
              ORDER BY a.attempt_number DESC LIMIT 1) AS ci_repair_state,
             (SELECT review_state FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_state,
             (SELECT head_sha FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_head_sha,
             COALESCE((SELECT critical_count FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1), 0) AS ai_review_critical_count,
             COALESCE((SELECT important_count FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1), 0) AS ai_review_important_count,
             COALESCE((SELECT suggestion_count FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1), 0) AS ai_review_suggestion_count,
             (SELECT COALESCE(github_review_url, pull_request_url)
              FROM run_ai_reviews ar WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_url,
             (SELECT failure_reason FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_failure_reason,
             (SELECT COUNT(*) FROM run_control_requests q
              WHERE q.run_id = r.run_id AND q.action = 'ai_review'
                AND q.request_state IN ('pending', 'processing'))
               AS ai_review_request_active_count,
             (SELECT round_state FROM run_review_fix_rounds rf
              WHERE rf.run_id = r.run_id
              ORDER BY rf.round_number DESC LIMIT 1) AS review_fix_state,
             (SELECT round_number FROM run_review_fix_rounds rf
              WHERE rf.run_id = r.run_id
              ORDER BY rf.round_number DESC LIMIT 1) AS review_fix_round_number,
             COALESCE((SELECT json_array_length(snapshot_json)
              FROM run_review_fix_rounds rf WHERE rf.run_id = r.run_id
              ORDER BY rf.round_number DESC LIMIT 1), 0) AS review_fix_thread_count,
             (SELECT COUNT(*) FROM run_control_requests q
              WHERE q.run_id = r.run_id AND q.action = 'review_fix'
                AND q.request_state IN ('pending', 'processing'))
               AS review_fix_request_active_count
      FROM run_progress_cards pc
      JOIN runs r USING (run_id)
      JOIN project_events pe ON pe.event_id = r.trigger_event_id
      JOIN run_resources rr USING (run_id)
      JOIN discord_transport_settings settings ON settings.singleton = 1
      LEFT JOIN preview_leases pl
        ON pl.run_id = r.run_id AND pl.state <> 'released'
      LEFT JOIN preview_slots ps USING (slot_number)
      LEFT JOIN run_ci_snapshots ci USING (run_id)
      LEFT JOIN run_discord_surfaces ds USING (run_id)
      WHERE r.created_at >= settings.activated_at
        AND (
          ds.run_id IS NULL
          OR ds.state IN ('pending', 'provisioning', 'failed')
          OR (
            pc.stage NOT IN ('completed', 'cancelled')
            AND (
              ds.content_digest IS NULL
              OR ds.content_digest <> (${desiredSurfaceDigestSql})
              OR ds.control_message_id IS NULL
              OR ds.owner_user_id IS NULL
            )
          )
          OR (
            pc.stage IN ('completed', 'cancelled')
            AND ds.state <> 'archived'
          )
          OR (
            (
              pc.stage IN ('review_ready', 'preview_required')
              OR (pc.stage = 'completed' AND ds.state <> 'archived')
            )
            AND ds.pull_request_url IS NULL
          )
        )
        AND COALESCE(ds.attempt_count, 0) < 5
      ORDER BY r.created_at, r.run_id
    `,
    )
    .all() as CardRow[];
}

function loadCard(database: DatabaseSync, runId: string): CardRow {
  const card = database
    .prepare(
      `
      SELECT pc.run_id, pc.stage, pc.detail, pc.content_digest,
             ${desiredSurfaceDigestSql} AS desired_surface_digest,
             pc.updated_at,
             r.project, r.repository, r.issue_number, r.interaction_policy,
             r.state AS run_state, r.owner_state, r.stop_reason,
             pe.title, pe.url AS issue_url,
             rr.branch_name, rr.codex_thread_id,
             rr.previous_codex_thread_id,
             ps.hostname AS preview_hostname,
             pl.state AS preview_state,
             pl.expires_at AS preview_expires_at,
             COALESCE(pl.extension_count, 0) AS preview_extension_count,
             pl.reviewed_at AS preview_reviewed_at,
             pl.reviewed_by AS preview_reviewed_by,
             pl.reviewed_via AS preview_reviewed_via,
             pl.verified_head_sha AS preview_verified_head_sha,
             pl.runtime_adapter AS preview_runtime_adapter,
             pl.artifact_digest AS preview_artifact_digest,
             pl.artifact_file_count AS preview_artifact_file_count,
             pl.artifact_total_bytes AS preview_artifact_total_bytes,
             r.preview_required, r.preview_required_label,
             r.completion_requested_at,
             r.preview_requirement_satisfied_at,
             ds.state AS surface_state,
             ds.guild_id AS surface_guild_id,
             ds.parent_channel_id AS surface_parent_channel_id,
             ds.live_card_message_id,
             ds.thread_id AS discord_thread_id,
             ds.control_message_id,
             ds.owner_user_id AS discord_owner_user_id,
             ds.content_digest AS surface_content_digest,
             ds.pull_request_url,
             ds.pull_request_title,
             ds.attempt_count AS surface_attempt_count,
             ci.pull_request_url AS ci_pull_request_url,
             ci.pull_request_title AS ci_pull_request_title,
             ci.pull_request_number AS ci_pull_request_number,
             ci.head_sha AS ci_head_sha,
             ci.aggregate_state AS ci_aggregate_state,
             ci.checks_json AS ci_checks_json,
             ci.last_error AS ci_last_error,
             (SELECT COUNT(*) FROM run_ci_repair_attempts a
              WHERE a.run_id = r.run_id) AS ci_repair_attempt_count,
             (SELECT attempt_state FROM run_ci_repair_attempts a
              WHERE a.run_id = r.run_id
              ORDER BY a.attempt_number DESC LIMIT 1) AS ci_repair_state,
             (SELECT review_state FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_state,
             (SELECT head_sha FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_head_sha,
             COALESCE((SELECT critical_count FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1), 0) AS ai_review_critical_count,
             COALESCE((SELECT important_count FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1), 0) AS ai_review_important_count,
             COALESCE((SELECT suggestion_count FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1), 0) AS ai_review_suggestion_count,
             (SELECT COALESCE(github_review_url, pull_request_url)
              FROM run_ai_reviews ar WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_url,
             (SELECT failure_reason FROM run_ai_reviews ar
              WHERE ar.run_id = r.run_id
              ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_failure_reason,
             (SELECT COUNT(*) FROM run_control_requests q
              WHERE q.run_id = r.run_id AND q.action = 'ai_review'
                AND q.request_state IN ('pending', 'processing'))
               AS ai_review_request_active_count,
             (SELECT round_state FROM run_review_fix_rounds rf
              WHERE rf.run_id = r.run_id
              ORDER BY rf.round_number DESC LIMIT 1) AS review_fix_state,
             (SELECT round_number FROM run_review_fix_rounds rf
              WHERE rf.run_id = r.run_id
              ORDER BY rf.round_number DESC LIMIT 1) AS review_fix_round_number,
             COALESCE((SELECT json_array_length(snapshot_json)
              FROM run_review_fix_rounds rf WHERE rf.run_id = r.run_id
              ORDER BY rf.round_number DESC LIMIT 1), 0) AS review_fix_thread_count,
             (SELECT COUNT(*) FROM run_control_requests q
              WHERE q.run_id = r.run_id AND q.action = 'review_fix'
                AND q.request_state IN ('pending', 'processing'))
               AS review_fix_request_active_count
      FROM run_progress_cards pc
      JOIN runs r USING (run_id)
      JOIN project_events pe ON pe.event_id = r.trigger_event_id
      JOIN run_resources rr USING (run_id)
      JOIN discord_transport_settings settings ON settings.singleton = 1
      LEFT JOIN preview_leases pl
        ON pl.run_id = r.run_id AND pl.state <> 'released'
      LEFT JOIN preview_slots ps USING (slot_number)
      LEFT JOIN run_ci_snapshots ci USING (run_id)
      LEFT JOIN run_discord_surfaces ds USING (run_id)
      WHERE pc.run_id = ? AND r.created_at >= settings.activated_at
    `,
    )
    .get(runId) as CardRow | undefined;
  if (!card) fail(`No Discord-eligible run card found: ${runId}`);
  if (terminalStages.has(card.stage))
    fail(`Run controls are closed: ${card.stage}`);
  return card;
}

function seedEventDeliveries(database: DatabaseSync): void {
  database
    .prepare(
      `
      INSERT OR IGNORE INTO run_discord_event_deliveries (event_id)
      SELECT ce.event_id
      FROM run_control_events ce
      JOIN runs r USING (run_id)
      JOIN discord_transport_settings settings ON settings.singleton = 1
      WHERE r.created_at >= settings.activated_at
    `,
    )
    .run();
}

function loadPendingEvents(database: DatabaseSync): EventRow[] {
  return database
    .prepare(
      `
      SELECT ce.event_id, ce.run_id, ce.event_kind, ce.payload_json,
             r.project, r.repository, r.issue_number,
             r.state AS run_state, r.owner_state,
             pe.title, pe.url AS issue_url,
             rr.branch_name, rr.codex_thread_id,
             ps.hostname AS preview_hostname,
             ds.guild_id, ds.thread_id, ds.control_message_id,
             dd.delivery_state,
             ci.head_sha AS current_ci_head_sha,
             ci.aggregate_state AS current_ci_aggregate_state,
             ci.checks_json AS current_ci_checks_json,
             ci.pull_request_url AS current_ci_pull_request_url
      FROM run_control_events ce
      JOIN run_discord_event_deliveries dd USING (event_id)
      JOIN runs r USING (run_id)
      JOIN project_events pe ON pe.event_id = r.trigger_event_id
      JOIN run_resources rr USING (run_id)
      JOIN run_discord_surfaces ds USING (run_id)
      LEFT JOIN preview_leases pl
        ON pl.run_id = r.run_id AND pl.state = 'running'
      LEFT JOIN preview_slots ps USING (slot_number)
      LEFT JOIN run_ci_snapshots ci USING (run_id)
      WHERE dd.delivery_state IN ('pending', 'failed')
        AND dd.attempt_count < 5
        AND ds.thread_id IS NOT NULL
      ORDER BY ce.created_at, ce.event_id
    `,
    )
    .all() as EventRow[];
}

function ciEventPayload(value: string): CiEventPayload | null {
  try {
    const payload = JSON.parse(value) as Partial<CiEventPayload>;
    if (
      payload.source !== "ci" ||
      !["failed", "missing"].includes(payload.state ?? "") ||
      typeof payload.headSha !== "string" ||
      !Array.isArray(payload.checks)
    )
      return null;
    return payload as CiEventPayload;
  } catch {
    return null;
  }
}

function eventStillValid(event: EventRow): boolean {
  const ci = ciEventPayload(event.payload_json);
  if (event.event_kind === "attention_required" && ci)
    return (
      !["rejected", "cancelled", "archived"].includes(event.run_state) &&
      event.current_ci_head_sha === ci.headSha &&
      ["failed", "missing"].includes(event.current_ci_aggregate_state ?? "")
    );
  if (event.event_kind === "review_ready")
    return event.run_state === "parked_review" && event.owner_state === "none";
  if (event.event_kind === "human_control_ready")
    return event.run_state === "remote_owned" && event.owner_state === "remote";
  if (event.event_kind === "preview_ready")
    return Boolean(event.preview_hostname);
  if (event.event_kind === "preview_failed")
    return !["cancelled", "archived"].includes(event.run_state);
  return !["rejected", "cancelled", "archived"].includes(event.run_state);
}

function findPullRequest(
  repository: string,
  branchName: string | null,
): PullRequest | null {
  if (!branchName) return null;
  try {
    const stdout = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repository,
        "--head",
        branchName,
        "--state",
        "all",
        "--limit",
        "1",
        "--json",
        "number,url,title,headRefOid,baseRefName",
      ],
      {
        encoding: "utf8",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const found = (
      JSON.parse(stdout) as Array<{
        number: number;
        url: string;
        title: string;
        headRefOid: string;
        baseRefName: string;
      }>
    )[0];
    return found
      ? {
          number: found.number,
          url: found.url,
          title: found.title,
          headSha: found.headRefOid,
          baseRefName: found.baseRefName,
        }
      : null;
  } catch {
    return null;
  }
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    preparing: "Preparing worktree",
    starting: "Starting Codex",
    waiting_github: "Waiting for GitHub",
    working: "Codex working",
    ci_repair_queued: "CI fix queued",
    ci_repair_working: "Fixing CI",
    ci_repair_waiting: "Waiting for CI",
    review_fix_queued: "Review fix queued",
    review_fix_working: "Fixing review",
    review_fix_waiting: "Waiting for CI",
    review_fix_resolving: "Resolving review threads",
    handoff_pending: "Preparing human control",
    finalizing_review: "Finalizing for review",
    human_control: "Human control",
    review_ready: "Ready for review",
    waiting_human: "Waiting for decision",
    preview_queued: "Preview queued",
    preview_extending: "Extending preview",
    preview_stopping: "Stopping preview",
    preview_building: "Preview building",
    preview_ready: "Preview ready",
    preview_required: "Preview required",
    stopping: "Stopping",
    discarding_cancelled: "Discarding local result",
    completed: "Completed",
    cancelled: "Cancelled",
    cancelled_work_preserved: "Cancelled — local work preserved",
    needs_attention: "Needs attention",
  };
  return labels[stage] ?? stage;
}

function presentedStage(
  card: CardRow,
  pullRequest: PullRequest | null,
): { label: string; detail: string } {
  const currentHead = pullRequest?.headSha ?? card.ci_head_sha;
  const reviewIsCurrent =
    !currentHead ||
    !card.ai_review_head_sha ||
    currentHead === card.ai_review_head_sha;
  if (card.stage === "cancelled_work_preserved" && pullRequest?.url) {
    return {
      label: "Cancelled — published work preserved",
      detail:
        "Automation stopped. The published branch and pull request were preserved for manual merge or closure.",
    };
  }
  if (
    card.stage === "review_ready" &&
    card.review_fix_request_active_count > 0 &&
    !["running", "waiting_ci", "resolving"].includes(card.review_fix_state ?? "")
  ) {
    return {
      label: "Review fix queued",
      detail:
        "Fix Review was requested; capturing the current unresolved GitHub review threads.",
    };
  }
  if (
    card.stage === "review_ready" &&
    card.ai_review_request_active_count > 0 &&
    card.ai_review_state !== "running"
  ) {
    return {
      label: "AI Review queued",
      detail:
        "AI review was requested and is waiting for the independent read-only reviewer to start.",
    };
  }
  if (card.stage === "review_ready" && card.ai_review_state === "running") {
    return {
      label: card.ci_aggregate_state === "pending" ? "Validating changes" : "Reviewing PR",
      detail: "CI and the independent read-only AI review are tracked in parallel on the exact pull request SHA.",
    };
  }
  if (
    card.stage === "review_ready" &&
    card.ai_review_state === "ready" &&
    reviewIsCurrent
  ) {
    return card.ci_aggregate_state === "pending"
      ? {
          label: "Waiting for CI",
          detail: "AI review is ready in the pull request; CI is still running independently.",
        }
      : {
          label: "AI Review Ready",
          detail: "The native GitHub review is ready for owner triage in the pull request.",
        };
  }
  return { label: stageLabel(card.stage), detail: card.detail };
}

function parseCiChecks(value: string | null): CiCheck[] {
  if (!value) return [];
  try {
    const checks = JSON.parse(value) as CiCheck[];
    return Array.isArray(checks) ? checks : [];
  } catch {
    return [];
  }
}

function ciCheckLine(check: CiCheck): string {
  const mark: Record<CiState, string> = {
    passed: "✓",
    pending: "…",
    failed: "✕",
    missing: "?",
    unknown: "?",
  };
  const name = truncate(check.name, 120);
  const label =
    check.detailsUrl?.startsWith("https://") === true
      ? `[${name}](${check.detailsUrl})`
      : name;
  return `${mark[check.state]} ${label}`;
}

function ciField(
  card: CardRow,
  pullRequest: PullRequest | null,
): DiscordObject | null {
  const managedPullObserved = Boolean(
    card.ci_pull_request_url || pullRequest?.headSha,
  );
  if (!managedPullObserved || !card.ci_aggregate_state) return null;
  if (card.stage === "ci_repair_waiting") {
    const failedChecks = parseCiChecks(card.ci_checks_json).filter((check) =>
      ["failed", "missing", "unknown"].includes(check.state),
    );
    const previousFailure = failedChecks.length
      ? failedChecks
          .map((check) => {
            const name = truncate(check.name, 100);
            return check.detailsUrl?.startsWith("https://") === true
              ? `[${name}](${check.detailsUrl})`
              : name;
          })
          .join(", ")
      : "CI failure";
    const sha = card.ci_head_sha
      ? ` · \`${card.ci_head_sha.slice(0, 7)}\``
      : "";
    return {
      name: "CI",
      value: truncate(
        `**⏳ Waiting for checks**\nPrevious failure: ${previousFailure}${sha}`,
        1_024,
      ),
    };
  }
  const labels: Record<CiState, string> = {
    passed: "✅ Passed",
    pending: "⏳ Pending",
    failed: "❌ Failed",
    missing: "⚠️ Required check missing",
    unknown: "❔ Unknown",
  };
  const lines = [`**${labels[card.ci_aggregate_state]}**`];
  const checks = parseCiChecks(card.ci_checks_json);
  lines.push(...checks.map(ciCheckLine));
  if (card.ci_aggregate_state === "unknown")
    lines.push("Status could not be determined.");
  if (card.ci_head_sha) lines.push(`\`${card.ci_head_sha.slice(0, 7)}\``);
  return { name: "CI", value: truncate(lines.join("\n"), 1_024) };
}

function ciPullRequest(card: CardRow): PullRequest | null {
  if (!card.ci_pull_request_url) return null;
  return {
    url: card.ci_pull_request_url,
    title: card.ci_pull_request_title ?? "Pull request",
    ...(card.ci_pull_request_number
      ? { number: card.ci_pull_request_number }
      : {}),
    ...(card.ci_head_sha ? { headSha: card.ci_head_sha } : {}),
  };
}

function aiReviewField(
  card: CardRow,
  pullRequest: PullRequest | null,
): DiscordObject | null {
  if (!card.ai_review_state) return null;
  if (
    card.ai_review_request_active_count > 0 &&
    card.ai_review_state !== "running"
  )
    return null;
  const sha = card.ai_review_head_sha
    ? `\n\`${card.ai_review_head_sha.slice(0, 7)}\``
    : "";
  if (card.ai_review_state === "running")
    return { name: "AI review", value: `**🔍 Reviewing PR**${sha}` };
  if (card.ai_review_state === "ready") {
    const counts = [
      `${card.ai_review_critical_count} Critical`,
      `${card.ai_review_important_count} Important`,
      `${card.ai_review_suggestion_count} Suggestions`,
    ].join(" · ");
    const status = card.ai_review_url
      ? `[✅ Ready](${card.ai_review_url})`
      : "✅ Ready";
    const currentHead = pullRequest?.headSha ?? card.ci_head_sha;
    if (
      currentHead &&
      card.ai_review_head_sha &&
      currentHead !== card.ai_review_head_sha
    ) {
      const reviewFixBusy =
        card.review_fix_request_active_count > 0 ||
        ["running", "waiting_ci", "resolving"].includes(
          card.review_fix_state ?? "",
        );
      const detail = reviewFixBusy
        ? "PR changed after this review. Review fixes are still being validated."
        : card.review_fix_state === "needs_attention"
          ? "PR changed after this review. The review fix needs attention before another AI review."
          : "PR changed after this review. Run AI Code Review again.";
      return {
        name: "AI review",
        value: `**↪️ Outdated**\n${detail}${sha}`,
      };
    }
    return {
      name: "AI review",
      value: `**${status}**\n${counts}${sha}`,
    };
  }
  if (card.ai_review_state === "superseded")
    return {
      name: "AI review",
      value: `**↪️ Superseded**\nThe pull request head changed before publication.${sha}`,
    };
  return {
    name: "AI review",
    value: truncate(
      `**⚠️ Failed**${card.ai_review_failure_reason ? `\n${card.ai_review_failure_reason}` : ""}${sha}`,
      1_024,
    ),
  };
}

function stageColor(stage: string): number {
  if (stage === "completed") return 0x57f287;
  if (stage === "cancelled" || stage === "needs_attention") return 0xed4245;
  if (stage === "cancelled_work_preserved") return 0xfee75c;
  if (stage === "waiting_github") return 0xfee75c;
  if (stage === "review_ready" || stage === "waiting_human") return 0xfee75c;
  if (stage === "finalizing_review") return 0xfee75c;
  if (stage === "preview_required") return 0xfee75c;
  if (stage === "preview_ready") return 0x57f287;
  return 0x5865f2;
}

function button(
  label: string,
  style: number,
  customId?: string,
  url?: string,
): DiscordObject {
  return {
    type: 2,
    style,
    label,
    ...(customId ? { custom_id: customId } : {}),
    ...(url ? { url } : {}),
  };
}

export function controlComponents(
  card: CardRow,
  project: ProjectConfig,
  pullRequest: PullRequest | null,
): DiscordObject[] {
  const rows: DiscordObject[][] = [];
  const links: DiscordObject[] = [];
  const remote = remoteCodexContext(card, project);
  if (remote)
    links.push(button("Open in Codex", 5, undefined, remote.launchUrl));
  if (pullRequest?.url)
    links.push(
      button(
        card.stage === "completed" ? "View PR" : "Open PR",
        5,
        undefined,
        pullRequest.url,
      ),
    );
  if (card.preview_state === "running" && card.preview_hostname)
    links.push(
      button("Open preview", 5, undefined, `https://${card.preview_hostname}`),
    );
  if (card.issue_url)
    links.push(button("Open issue", 5, undefined, card.issue_url));
  if (links.length > 0) rows.push(links);

  if (!terminalStages.has(card.stage)) {
    const controls: DiscordObject[] = [
      button("Status", 2, `kurami:status:${card.run_id}`),
    ];
    const preservedCancellation = card.stage === "cancelled_work_preserved";
    const publishedCancellation =
      preservedCancellation && Boolean(pullRequest?.url);
    const reviewFixBusy =
      card.review_fix_request_active_count > 0 ||
      ["running", "waiting_ci", "resolving"].includes(
        card.review_fix_state ?? "",
      );
    const takeoverEligible =
      !preservedCancellation &&
      card.stage !== "handoff_pending" &&
      ![
        "ci_repair_queued",
        "ci_repair_working",
        "ci_repair_waiting",
        "review_fix_queued",
        "review_fix_working",
        "review_fix_waiting",
        "review_fix_resolving",
      ].includes(card.stage) &&
      Boolean(card.codex_thread_id) &&
      card.previous_codex_thread_id === null &&
      (card.owner_state === "cli" ||
        (card.owner_state === "remote" &&
          card.run_state === "remote_owned") ||
        (card.owner_state === "none" &&
          ["parked_review", "waiting_human"].includes(card.run_state)));
    if (takeoverEligible) {
      const takeoverLabel =
        card.owner_state === "cli"
          ? "Take control"
          : card.owner_state === "remote"
            ? "Continue autonomously"
            : "Continue in Codex";
      controls.push(
        button(takeoverLabel, 1, `kurami:take_control:${card.run_id}`),
      );
    }
    const previewStartEligible =
      !preservedCancellation &&
      !reviewFixBusy &&
      ((card.owner_state === "none" &&
        ["parked_review", "waiting_human"].includes(card.run_state)) ||
        (card.owner_state === "remote" &&
          card.run_state === "remote_owned"));
    const previewRequestPending = [
      "preview_queued",
      "preview_extending",
      "preview_stopping",
    ].includes(card.stage);
    if (
      project.preview &&
      !previewRequestPending &&
      (card.preview_state || previewStartEligible)
    ) {
      controls.push(
        card.preview_state
          ? button(
              "Remove preview",
              2,
              `kurami:preview_stop:${card.run_id}`,
            )
          : button(
              "Start preview",
              3,
              `kurami:preview_start:${card.run_id}`,
            ),
      );
      if (
        card.preview_state === "running" &&
        card.detail.includes("Extend it")
      )
        controls.push(
          button("Extend 24h", 3, `kurami:preview_extend:${card.run_id}`),
        );
      if (
        card.preview_state === "running" &&
        !card.preview_reviewed_at
      )
        controls.push(
          button(
            "Mark reviewed",
            1,
            `kurami:preview_reviewed:${card.run_id}`,
          ),
        );
    }
    const ciRepairEligible =
      !preservedCancellation &&
      card.stage !== "ci_repair_queued" &&
      card.run_state === "parked_review" &&
      card.owner_state === "none" &&
      Boolean(card.codex_thread_id) &&
      card.previous_codex_thread_id === null &&
      Boolean(card.ci_head_sha) &&
      ["failed", "missing"].includes(card.ci_aggregate_state ?? "") &&
      card.ci_repair_attempt_count < 2 &&
      !["running", "waiting_ci"].includes(card.ci_repair_state ?? "");
    if (ciRepairEligible)
      controls.push(
        button("Attempt CI fix", 1, `kurami:ci_repair:${card.run_id}`),
      );
    const reviewHead = pullRequest?.headSha ?? card.ci_head_sha;
    const sameHeadAlreadyReviewed =
      Boolean(reviewHead) &&
      card.ai_review_head_sha === reviewHead &&
      ["running", "ready"].includes(card.ai_review_state ?? "");
    const aiReviewEligible =
      !preservedCancellation &&
      !reviewFixBusy &&
      card.run_state === "parked_review" &&
      card.owner_state === "none" &&
      Boolean(pullRequest?.url) &&
      Boolean(reviewHead) &&
      card.previous_codex_thread_id === null &&
      !["ci_repair_queued", "ci_repair_working"].includes(card.stage) &&
      card.ai_review_request_active_count === 0 &&
      !sameHeadAlreadyReviewed &&
      card.ai_review_state !== "running";
    if (aiReviewEligible)
      controls.push(
        button("AI Code Review", 1, `kurami:ai_review:${card.run_id}`),
      );
    const currentReviewHasFindings =
      card.ai_review_state === "ready" &&
      Boolean(reviewHead) &&
      card.ai_review_head_sha === reviewHead &&
      card.ai_review_critical_count +
        card.ai_review_important_count +
        card.ai_review_suggestion_count >
        0;
    const reviewFixEligible =
      !preservedCancellation &&
      card.run_state === "parked_review" &&
      card.owner_state === "none" &&
      Boolean(card.codex_thread_id) &&
      card.previous_codex_thread_id === null &&
      currentReviewHasFindings &&
      card.review_fix_request_active_count === 0 &&
      !["running", "waiting_ci", "resolving"].includes(
        card.review_fix_state ?? "",
      ) &&
      ![
        "ci_repair_queued",
        "ci_repair_working",
        "review_fix_queued",
        "review_fix_working",
        "review_fix_waiting",
        "review_fix_resolving",
      ].includes(card.stage);
    if (reviewFixEligible)
      controls.push(
        button("Fix Review", 1, `kurami:review_fix:${card.run_id}`),
      );
    const cancellationStarted =
      card.stop_reason === "cancelled" ||
      ["stopping", "discarding_cancelled"].includes(card.stage);
    if (preservedCancellation && !publishedCancellation) {
      controls.push(
        button(
          "Discard local work",
          4,
          `kurami:discard_prompt:${card.run_id}`,
        ),
      );
    } else if (publishedCancellation) {
      controls.push(
        button(
          "Close draft PR & discard",
          4,
          `kurami:discard_published_prompt:${card.run_id}`,
        ),
      );
    } else if (!publishedCancellation && !cancellationStarted) {
      controls.push(button("Cancel run", 4, `kurami:stop:${card.run_id}`));
    }
    for (let index = 0; index < controls.length; index += 5)
      rows.push(controls.slice(index, index + 5));
  }
  return rows.map((components) => ({ type: 1, components }));
}

function linkComponents(
  card: CardRow,
  project: ProjectConfig,
  pullRequest: PullRequest | null,
): DiscordObject[] {
  const links: DiscordObject[] = [];
  const remote = remoteCodexContext(card, project);
  if (remote)
    links.push(button("Open in Codex", 5, undefined, remote.launchUrl));
  if (pullRequest?.url)
    links.push(
      button(
        card.stage === "completed" ? "View PR" : "Open PR",
        5,
        undefined,
        pullRequest.url,
      ),
    );
  if (card.preview_state === "running" && card.preview_hostname)
    links.push(
      button("Open preview", 5, undefined, `https://${card.preview_hostname}`),
    );
  if (card.issue_url)
    links.push(button("Open issue", 5, undefined, card.issue_url));
  return links.length > 0 ? [{ type: 1, components: links }] : [];
}

function threadControlPayload(
  card: CardRow,
  project: ProjectConfig,
  pullRequest: PullRequest | null,
  create: boolean,
): DiscordObject {
  const presented = presentedStage(card, pullRequest);
  return {
    content: `**Run controls · ${project.workspace.branch_prefix}-${card.issue_number}**\n${presented.label}`,
    components: controlComponents(card, project, pullRequest),
    allowed_mentions: { parse: [] },
    ...(create
      ? {
          nonce: deterministicNonce("card", `${card.run_id}:controls`),
          enforce_nonce: true,
        }
      : {}),
  };
}

function cardPayload(
  card: CardRow,
  project: ProjectConfig,
  pullRequest: PullRequest | null,
  create: boolean,
): DiscordObject {
  const presented = presentedStage(card, pullRequest);
  const fields: DiscordObject[] = [];
  if (pullRequest?.url)
    fields.push({
      name: "Pull request",
      value: `[Open PR](${pullRequest.url})`,
    });
  const ci = ciField(card, pullRequest);
  if (ci) fields.push(ci);
  const review = aiReviewField(card, pullRequest);
  if (review) fields.push(review);
  const currentPullRequestHeadSha = pullRequest?.headSha ?? card.ci_head_sha;
  const previewReviewOutdated = Boolean(
    card.preview_reviewed_at &&
      card.preview_verified_head_sha &&
      currentPullRequestHeadSha &&
      card.preview_verified_head_sha !== currentPullRequestHeadSha,
  );
  if (card.preview_hostname && card.preview_state)
    fields.push({
      name: "Preview",
      value: [
        card.preview_state === "running"
          ? `[Open preview](https://${card.preview_hostname})`
          : null,
        card.preview_runtime_adapter === "static"
          ? "Runtime: Static artifact"
          : "Runtime: Compose application",
        card.preview_runtime_adapter === "static" && card.preview_artifact_digest
          ? `${card.preview_artifact_file_count ?? 0} files · ${card.preview_artifact_total_bytes ?? 0} bytes · \`${card.preview_artifact_digest.slice(0, 12)}\``
          : null,
        card.preview_verified_head_sha
          ? `SHA \`${card.preview_verified_head_sha.slice(0, 7)}\``
          : null,
        previewReviewOutdated
          ? `↪️ Outdated · reviewed for SHA \`${card.preview_verified_head_sha!.slice(0, 7)}\`\nCurrent PR SHA \`${currentPullRequestHeadSha!.slice(0, 7)}\` requires a fresh preview review.`
          : card.preview_reviewed_at
          ? `✅ Reviewed ${
              card.preview_verified_head_sha
                ? `for SHA \`${card.preview_verified_head_sha.slice(0, 7)}\``
                : card.preview_runtime_adapter === "static" &&
                    card.preview_artifact_digest
                  ? `artifact \`${card.preview_artifact_digest.slice(0, 12)}\``
                  : "preview"
            }\n${stageTimestamp(card.preview_reviewed_at)}`
          : "👁️ Not reviewed",
        card.preview_expires_at
          ? `Expires ${stageTimestamp(card.preview_expires_at)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  if (card.preview_required === 1)
    fields.push({
      name: "Preview policy",
      value: card.preview_requirement_satisfied_at
        ? "✅ Exact preview reviewed"
        : card.completion_requested_at
          ? "⏸️ Required · completion paused"
          : `Required before completion${card.preview_required_label ? ` · \`${card.preview_required_label}\`` : ""}`,
    });
  const remote = remoteCodexContext(card, project);
  if (remote)
    fields.push({
      name: "Codex handoff",
      value: truncate(remote.summary, 1_024),
    });
  fields.push({
    name: "Stage since",
    value: stageTimestamp(card.updated_at),
    inline: true,
  });
  return {
    content: `**${project.workspace.branch_prefix}-${card.issue_number} · ${presented.label}**`,
    embeds: [
      {
        title: truncate(cleanTitle(card.title), 256),
        description: truncate(presented.detail, 4_000),
        color: stageColor(card.stage),
        fields,
        footer: { text: `Run ${card.run_id}` },
        timestamp: card.updated_at,
      },
    ],
    // The starter card is mirrored by Discord inside its message-started
    // thread. Keep it link-only and maintain actionable controls in one real
    // thread-local message instead.
    components: linkComponents(card, project, pullRequest),
    allowed_mentions: { parse: [] },
    ...(create
      ? {
          nonce: deterministicNonce("card", card.run_id),
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
      const wait = Math.min(Math.max(Number(body.retry_after ?? 1), 0.1), 5);
      await delay(wait * 1_000);
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

function updateSurfaceFailure(
  database: DatabaseSync,
  runId: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  database
    .prepare(
      `
      UPDATE run_discord_surfaces
      SET state = 'failed', last_error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id = ?
    `,
    )
    .run(message.slice(0, 500), runId);
}

async function ensureSurface(
  database: DatabaseSync,
  token: string,
  ownerUserId: string,
  card: CardRow,
  project: ProjectConfig,
): Promise<{
  messageId: string;
  threadId: string;
  controlMessageId: string | null;
  pullRequest: PullRequest | null;
}> {
  const target = project.discord;
  if (!target) fail(`Missing Discord target for project ${card.project}`);
  database
    .prepare(
      `
      INSERT OR IGNORE INTO run_discord_surfaces (
        run_id, guild_id, parent_channel_id
      ) VALUES (?, ?, ?)
    `,
    )
    .run(card.run_id, target.guild_id, target.channel_id);
  const surface = database
    .prepare(`SELECT * FROM run_discord_surfaces WHERE run_id = ?`)
    .get(card.run_id) as {
    guild_id: string;
    parent_channel_id: string;
    live_card_message_id: string | null;
    thread_id: string | null;
    control_message_id: string | null;
    owner_user_id: string | null;
    pull_request_url: string | null;
    pull_request_title: string | null;
  };
  if (
    surface.guild_id !== target.guild_id ||
    surface.parent_channel_id !== target.channel_id
  )
    fail(`Discord target changed for existing run ${card.run_id}`);
  database
    .prepare(
      `
      UPDATE run_discord_surfaces
      SET state = CASE
            WHEN state IN ('pending', 'provisioning', 'failed') THEN 'provisioning'
            ELSE state
          END,
          attempt_count = CASE
            WHEN state IN ('pending', 'provisioning', 'failed') THEN attempt_count + 1
            ELSE attempt_count
          END,
          last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id = ?
    `,
    )
    .run(card.run_id);

  const discoverLivePull = [
    "review_ready",
    "completed",
    "cancelled_work_preserved",
  ].includes(card.stage);
  let pullRequest =
    (discoverLivePull
      ? findPullRequest(card.repository, card.branch_name)
      : null) ??
    ciPullRequest(card) ??
    (surface.pull_request_url
      ? {
          url: surface.pull_request_url,
          title: surface.pull_request_title ?? "Pull request",
        }
      : null);

  let messageId = surface.live_card_message_id;
  if (!messageId) {
    const message = await discordRequest(
      token,
      "POST",
      `/channels/${target.channel_id}/messages`,
      cardPayload(card, project, pullRequest, true),
    );
    messageId = String(message?.id ?? "");
    if (!/^\d+$/u.test(messageId)) fail("Discord returned no card message ID");
    database
      .prepare(
        `
        UPDATE run_discord_surfaces
        SET live_card_message_id = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(messageId, card.run_id);
  }

  let threadId = surface.thread_id;
  if (!threadId) {
    const existing = await discordRequest(
      token,
      "GET",
      `/channels/${messageId}`,
      undefined,
      true,
    );
    if (
      existing &&
      [10, 11, 12].includes(Number(existing.type)) &&
      String(existing.parent_id ?? "") === target.channel_id
    ) {
      threadId = String(existing.id);
    } else {
      const thread = await discordRequest(
        token,
        "POST",
        `/channels/${target.channel_id}/messages/${messageId}/threads`,
        {
          name: threadName(card, project),
          auto_archive_duration: 1440,
          rate_limit_per_user: 0,
        },
      );
      threadId = String(thread?.id ?? "");
    }
    if (!/^\d+$/u.test(threadId)) fail("Discord returned no thread ID");
    database
      .prepare(
        `
        UPDATE run_discord_surfaces
        SET thread_id = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(threadId, card.run_id);
  }

  if (!terminalStages.has(card.stage)) {
    await discordRequest(token, "PATCH", `/channels/${threadId}`, {
      archived: false,
      locked: false,
    });
    if (surface.owner_user_id !== ownerUserId) {
      await discordRequest(
        token,
        "PUT",
        `/channels/${threadId}/thread-members/${ownerUserId}`,
      );
      database
        .prepare(
          `
          UPDATE run_discord_surfaces
          SET owner_user_id = ?,
              owner_joined_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE run_id = ?
        `,
        )
        .run(ownerUserId, card.run_id);
    }
  }

  return {
    messageId,
    threadId,
    controlMessageId: surface.control_message_id,
    pullRequest,
  };
}

async function reconcileThreadControls(
  database: DatabaseSync,
  token: string,
  card: CardRow,
  project: ProjectConfig,
  threadId: string,
  storedMessageId: string | null,
  pullRequest: PullRequest | null,
): Promise<string> {
  let messageId = storedMessageId;
  if (messageId) {
    const edited = await discordRequest(
      token,
      "PATCH",
      `/channels/${threadId}/messages/${messageId}`,
      threadControlPayload(card, project, pullRequest, false),
      true,
    );
    if (!edited) messageId = null;
  }
  if (!messageId) {
    const message = await discordRequest(
      token,
      "POST",
      `/channels/${threadId}/messages`,
      threadControlPayload(card, project, pullRequest, true),
    );
    messageId = String(message?.id ?? "");
    if (!/^\d+$/u.test(messageId))
      fail("Discord returned no thread control message ID");
    database
      .prepare(
        `
        UPDATE run_discord_surfaces
        SET control_message_id = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(messageId, card.run_id);
  }
  await ensureThreadControlPinned(token, threadId, messageId);
  return messageId;
}

async function ensureThreadControlPinned(
  token: string,
  threadId: string,
  messageId: string,
): Promise<void> {
  const pins = await discordRequest(
    token,
    "GET",
    `/channels/${threadId}/messages/pins?limit=50`,
  );
  const items = Array.isArray(pins?.items) ? pins.items : [];
  const alreadyPinned = items.some((item) => {
    if (!item || typeof item !== "object") return false;
    const message = (item as DiscordObject).message;
    return (
      message !== null &&
      typeof message === "object" &&
      String((message as DiscordObject).id ?? "") === messageId
    );
  });
  if (!alreadyPinned)
    await discordRequest(
      token,
      "PUT",
      `/channels/${threadId}/messages/pins/${messageId}`,
    );
}

async function reconcileCard(
  database: DatabaseSync,
  token: string,
  ownerUserId: string,
  card: CardRow,
  project: ProjectConfig,
): Promise<Record<string, unknown>> {
  try {
    const { messageId, threadId, controlMessageId, pullRequest } =
      await ensureSurface(database, token, ownerUserId, card, project);
    if (terminalStages.has(card.stage))
      await discordRequest(token, "PATCH", `/channels/${threadId}`, {
        archived: false,
        locked: false,
      });
    await discordRequest(
      token,
      "PATCH",
      `/channels/${project.discord!.channel_id}/messages/${messageId}`,
      cardPayload(card, project, pullRequest, false),
    );
    const reconciledControlMessageId = await reconcileThreadControls(
      database,
      token,
      card,
      project,
      threadId,
      controlMessageId,
      pullRequest,
    );
    if (terminalStages.has(card.stage))
      await discordRequest(token, "PATCH", `/channels/${threadId}`, {
        archived: true,
        locked: false,
      });
    database
      .prepare(
        `
        UPDATE run_discord_surfaces
        SET state = ?, content_digest = ?, pull_request_url = ?,
            pull_request_title = ?, attempt_count = 0, last_error = NULL,
            archived_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(
        terminalStages.has(card.stage) ? "archived" : "active",
        card.desired_surface_digest,
        pullRequest?.url ?? null,
        pullRequest?.title ?? null,
        terminalStages.has(card.stage) ? 1 : 0,
        card.run_id,
      );
    return {
      runId: card.run_id,
      action: card.live_card_message_id ? "card_edited" : "surface_created",
      threadId,
      messageId,
      controlMessageId: reconciledControlMessageId,
    };
  } catch (error) {
    updateSurfaceFailure(database, card.run_id, error);
    return {
      runId: card.run_id,
      action: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function showControls(
  database: DatabaseSync,
  token: string,
  ownerUserId: string,
  card: CardRow,
  project: ProjectConfig,
): Promise<Record<string, unknown>> {
  const surface = await ensureSurface(
    database,
    token,
    ownerUserId,
    card,
    project,
  );
  await discordRequest(
    token,
    "PATCH",
    `/channels/${project.discord!.channel_id}/messages/${surface.messageId}`,
    cardPayload(card, project, surface.pullRequest, false),
  );
  const messageId = await reconcileThreadControls(
    database,
    token,
    card,
    project,
    surface.threadId,
    surface.controlMessageId,
    surface.pullRequest,
  );
  database
    .prepare(
      `
      UPDATE run_discord_surfaces
      SET state = 'active', content_digest = ?, pull_request_url = ?,
          pull_request_title = ?, attempt_count = 0, last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id = ?
    `,
    )
    .run(
      card.desired_surface_digest,
      surface.pullRequest?.url ?? null,
      surface.pullRequest?.title ?? null,
      card.run_id,
    );
  return {
    runId: card.run_id,
    action: "controls_shown",
    threadId: surface.threadId,
    messageId,
  };
}

function eventMessage(
  event: EventRow,
  project: ProjectConfig,
  pullRequest: PullRequest | null,
): string {
  const ci = ciEventPayload(event.payload_json);
  if (event.event_kind === "attention_required" && ci) {
    const currentState = event.current_ci_aggregate_state;
    const currentChecks = parseCiChecks(event.current_ci_checks_json);
    const relevant = currentChecks.filter((check) =>
      ["failed", "missing", "unknown"].includes(check.state),
    );
    return [
      `**${currentState === "failed" ? "CI failed" : "Required CI check is missing"}**`,
      ...relevant.map(ciCheckLine),
      event.current_ci_pull_request_url?.startsWith("https://")
        ? `[Open PR](${event.current_ci_pull_request_url})`
        : "",
      event.issue_url ? `[Open issue](${event.issue_url})` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const header =
    event.event_kind === "human_control_ready"
      ? "Preparation is ready for you"
      : event.event_kind === "preview_ready"
        ? "Preview is ready"
        : event.event_kind === "preview_failed"
          ? "Preview failed"
          : event.event_kind === "attention_required"
            ? "Attention required"
            : "Ready for review";
  const remote = remoteCodexContext(event, project);
  return [
    `**${header}**`,
    remote?.summary ?? "",
    pullRequest ? `[Open PR](${pullRequest.url})` : "",
    event.preview_hostname
      ? `[Open preview](https://${event.preview_hostname})`
      : "",
    event.issue_url ? `[Open issue](${event.issue_url})` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function eventComponents(
  event: EventRow,
  project: ProjectConfig,
): DiscordObject[] {
  const components: DiscordObject[] = [];
  const remote = remoteCodexContext(event, project);
  if (remote)
    components.push(button("Open in Codex", 5, undefined, remote.launchUrl));
  if (!event.control_message_id)
    return components.length > 0 ? [{ type: 1, components }] : [];
  const controlUrl = `https://discord.com/channels/${event.guild_id}/${event.thread_id}/${event.control_message_id}`;
  components.push(button("Open controls", 5, undefined, controlUrl));
  return [{ type: 1, components }];
}

async function deliverEvent(
  database: DatabaseSync,
  token: string,
  event: EventRow,
  project: ProjectConfig,
): Promise<Record<string, unknown>> {
  if (!eventStillValid(event)) {
    database
      .prepare(
        `
        UPDATE run_discord_event_deliveries
        SET delivery_state = 'cancelled',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE event_id = ?
      `,
      )
      .run(event.event_id);
    return { eventId: event.event_id, action: "cancelled_stale" };
  }
  database
    .prepare(
      `
      UPDATE run_discord_event_deliveries
      SET delivery_state = 'sending', attempt_count = attempt_count + 1,
          last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE event_id = ? AND delivery_state IN ('pending', 'failed')
    `,
    )
    .run(event.event_id);
  try {
    await discordRequest(token, "PATCH", `/channels/${event.thread_id}`, {
      archived: false,
      locked: false,
    });
    const pullRequest =
      event.event_kind === "review_ready"
        ? findPullRequest(event.repository, event.branch_name)
        : null;
    const message = await discordRequest(
      token,
      "POST",
      `/channels/${event.thread_id}/messages`,
      {
        content: eventMessage(event, project, pullRequest),
        components: eventComponents(event, project),
        allowed_mentions: { parse: [] },
        nonce: deterministicNonce("event", event.event_id),
        enforce_nonce: true,
      },
    );
    const messageId = String(message?.id ?? "");
    if (!/^\d+$/u.test(messageId)) fail("Discord returned no event message ID");
    database
      .prepare(
        `
        UPDATE run_discord_event_deliveries
        SET delivery_state = 'delivered', message_id = ?,
            delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE event_id = ? AND delivery_state = 'sending'
      `,
      )
      .run(messageId, event.event_id);
    return { eventId: event.event_id, action: "delivered", messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    database
      .prepare(
        `
        UPDATE run_discord_event_deliveries
        SET delivery_state = 'failed', last_error = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE event_id = ? AND delivery_state = 'sending'
      `,
      )
      .run(message.slice(0, 500), event.event_id);
    return { eventId: event.event_id, action: "failed", error: message };
  }
}

async function main(): Promise<void> {
  const { command, runId, apply } = parseArguments();
  const registry = parse(
    await readFile(projectsPath, "utf8"),
  ) as ProjectsRegistry;
  if (registry.version !== 1) fail("Unsupported projects config version");
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (command === "show") {
    const card = loadCard(database, runId!);
    const project = registry.projects[card.project];
    if (!project?.discord)
      fail(`Missing Discord target for project ${card.project}`);
    if (!apply) {
      database.close();
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: false, action: "show_controls", runId })}\n`,
      );
      return;
    }
    const token = await loadDiscordToken();
    const ownerUserId = await loadDiscordOwnerId();
    const result = await showControls(
      database,
      token,
      ownerUserId,
      card,
      project,
    );
    database.close();
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: true, ...result })}\n`,
    );
    return;
  }
  if (apply) seedEventDeliveries(database);
  const cards = loadDesiredCards(database).filter((card) =>
    Boolean(registry.projects[card.project]?.discord),
  );
  const events = apply ? loadPendingEvents(database) : [];
  if (!apply) {
    database.close();
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        apply: false,
        pendingCards: cards.map((card) => ({
          runId: card.run_id,
          stage: card.stage,
          action: card.discord_thread_id ? "edit" : "create",
        })),
      })}\n`,
    );
    return;
  }
  if (cards.length === 0 && events.length === 0) {
    database.close();
    if (process.env.DISCORD_NOTIFIER_QUIET !== "1")
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, cards: 0, events: 0 })}\n`,
      );
    return;
  }
  const token = await loadDiscordToken();
  const ownerUserId = cards.length > 0 ? await loadDiscordOwnerId() : "";
  const results: Array<Record<string, unknown>> = [];
  for (const card of cards) {
    const project = registry.projects[card.project];
    if (!project?.discord) continue;
    results.push(
      await reconcileCard(database, token, ownerUserId, card, project),
    );
  }
  for (const event of loadPendingEvents(database)) {
    const project = registry.projects[event.project];
    if (!project?.discord) continue;
    results.push(await deliverEvent(database, token, event, project));
  }
  database.close();
  const failures = results.filter((result) => result.action === "failed");
  if (process.env.DISCORD_NOTIFIER_QUIET !== "1")
    process.stdout.write(
      `${JSON.stringify({ ok: failures.length === 0, apply: true, results })}\n`,
    );
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
