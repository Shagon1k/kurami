import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalRuntimeSettings,
  currentRuntimeSettings,
  inspectSettingsIdle,
  loadRuntimeSettingsInputs,
  normalizeRuntimeSettings,
  runtimeSettingsHash,
  type RuntimeSettings,
  type RuntimeSettingsBaseConfig,
  type SettingsIdleInspection,
} from "./runtime-settings.ts";

process.umask(0o077);

type Command = "status" | "apply" | "reset" | "rollback";

type Arguments = {
  command: Command;
  expectedRevision: number | null;
  actorId: string | null;
  via: "discord" | "cli" | null;
  values: Partial<Omit<RuntimeSettings, "version" | "project_wip">>;
  projectWip: Record<string, number>;
};

type SettingsResponse = {
  ok: true;
  action: "status" | "applied" | "reset" | "rolled_back" | "unchanged";
  revision: number;
  source: "defaults" | "runtime_override";
  settings: RuntimeSettings;
  defaults: RuntimeSettings;
  idle: SettingsIdleInspection;
  changes: Array<{ name: string; before: number; after: number }>;
  maintenanceChannelId: string;
  allowedGuildIds: string[];
  appliedAt: string | null;
};

function fail(message: string): never {
  throw new Error(message);
}

function parseInteger(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/u.test(value)) fail(`Invalid ${name}`);
  return Number(value);
}

function parseArguments(args: string[]): Arguments {
  const command = args.shift();
  if (!command || !["status", "apply", "reset", "rollback"].includes(command)) {
    fail(
      "Usage: orchestrator-settings.ts <status|apply|reset|rollback> [--expected-revision N --actor-id ID --via discord|cli]",
    );
  }
  const parsed: Arguments = {
    command: command as Command,
    expectedRevision: null,
    actorId: null,
    via: null,
    values: {},
    projectWip: {},
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--expected-revision") {
      parsed.expectedRevision = parseInteger(value, "expected revision");
    } else if (flag === "--actor-id") {
      if (!value || !/^\d{1,40}$/u.test(value)) fail("Invalid actor ID");
      parsed.actorId = value;
    } else if (flag === "--via") {
      if (value !== "discord" && value !== "cli") fail("Invalid settings source");
      parsed.via = value;
    } else if (flag === "--max-llm") {
      parsed.values.max_llm_running_global = parseInteger(value, "max LLM");
    } else if (flag === "--ai-triage-daily") {
      parsed.values.ai_triage_daily = parseInteger(value, "AI triage/day");
    } else if (flag === "--global-wip") {
      parsed.values.max_active_global = parseInteger(value, "Global WIP");
    } else if (flag === "--project-wip") {
      const match = value?.match(/^([a-z0-9-]+)=(\d+)$/u);
      if (!match) fail("Invalid project WIP override");
      parsed.projectWip[match[1]!] = Number(match[2]);
    } else if (flag === "--max-previews") {
      parsed.values.max_previews_global = parseInteger(value, "max previews");
    } else if (flag === "--max-preview-builds") {
      parsed.values.max_preview_builds_global = parseInteger(
        value,
        "max preview builds",
      );
    } else if (flag === "--preview-ttl-hours") {
      parsed.values.preview_ttl_hours = parseInteger(value, "preview lifetime");
    } else {
      fail(`Unknown settings argument: ${flag ?? "missing"}`);
    }
    index += 1;
  }
  if (parsed.command !== "status") {
    if (parsed.expectedRevision === null || !parsed.actorId || !parsed.via) {
      fail("Settings mutation requires expected revision, actor ID, and source");
    }
  }
  if (parsed.command !== "apply" && (Object.keys(parsed.values).length || Object.keys(parsed.projectWip).length)) {
    fail(`${parsed.command} does not accept setting values`);
  }
  return parsed;
}

function maintenanceChannelId(base: RuntimeSettingsBaseConfig): string {
  const channel = (base.discord as Record<string, unknown> | undefined)
    ?.maintenance_channel_id;
  if (typeof channel !== "string" || !/^\d{5,30}$/u.test(channel)) {
    fail("Invalid maintenance Discord channel configuration");
  }
  return channel;
}

function changes(
  before: RuntimeSettings,
  after: RuntimeSettings,
): Array<{ name: string; before: number; after: number }> {
  const result: Array<{ name: string; before: number; after: number }> = [];
  const scalars: Array<keyof Omit<RuntimeSettings, "version" | "project_wip">> = [
    "max_llm_running_global",
    "ai_triage_daily",
    "max_active_global",
    "max_previews_global",
    "max_preview_builds_global",
    "preview_ttl_hours",
  ];
  for (const name of scalars) {
    if (before[name] !== after[name]) {
      result.push({ name, before: before[name], after: after[name] });
    }
  }
  for (const name of [...new Set([
    ...Object.keys(before.project_wip),
    ...Object.keys(after.project_wip),
  ])].sort()) {
    if (before.project_wip[name] !== after.project_wip[name]) {
      result.push({
        name: `project_wip.${name}`,
        before: before.project_wip[name] ?? 0,
        after: after.project_wip[name] ?? 0,
      });
    }
  }
  return result;
}

function response(
  action: SettingsResponse["action"],
  database: DatabaseSync,
  base: RuntimeSettingsBaseConfig,
  projectNames: string[],
  allowedGuildIds: string[],
  idle: SettingsIdleInspection,
  diff: SettingsResponse["changes"] = [],
): SettingsResponse {
  const snapshot = currentRuntimeSettings(database, base, projectNames);
  return {
    ok: true,
    action,
    revision: snapshot.revision,
    source: snapshot.source,
    settings: snapshot.settings,
    defaults: snapshot.defaults,
    idle,
    changes: diff,
    maintenanceChannelId: maintenanceChannelId(base),
    allowedGuildIds,
    appliedAt: snapshot.appliedAt,
  };
}

function insertRevision(
  database: DatabaseSync,
  action: "apply" | "reset" | "rollback",
  before: RuntimeSettings,
  after: RuntimeSettings,
  previousRevision: number,
  actorId: string,
  via: "discord" | "cli",
): void {
  const settingsJson = canonicalRuntimeSettings(after);
  database
    .prepare(`
      INSERT INTO orchestrator_setting_revisions (
        action, settings_json, previous_settings_json, settings_sha256,
        previous_settings_sha256, previous_revision, actor_id, applied_via
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      action,
      settingsJson,
      canonicalRuntimeSettings(before),
      runtimeSettingsHash(settingsJson),
      runtimeSettingsHash(canonicalRuntimeSettings(before)),
      previousRevision || null,
      actorId,
      via,
    );
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const { base, projects } = await loadRuntimeSettingsInputs(orchestratorHome);
  const projectNames = Object.keys(projects.projects).sort();
  const allowedGuildIds = [
    ...new Set(
      Object.values(projects.projects)
        .map((project) =>
          String(
            (project as { discord?: { guild_id?: unknown } }).discord?.guild_id ?? "",
          ),
        )
        .filter((guildId) => /^\d{5,30}$/u.test(guildId)),
    ),
  ].sort();
  if (allowedGuildIds.length === 0) fail("Projects registry has no allowed Discord guilds");
  const database = new DatabaseSync(resolve(orchestratorHome, "state/orchestrator.db"), {
    readOnly: args.command === "status",
    timeout: 5_000,
  });
  database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  try {
    if (args.command === "status") {
      const idle = inspectSettingsIdle(database);
      process.stdout.write(
        `${JSON.stringify(response("status", database, base, projectNames, allowedGuildIds, idle))}\n`,
      );
      return;
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      const snapshot = currentRuntimeSettings(database, base, projectNames);
      if (snapshot.revision !== args.expectedRevision) {
        fail(
          `Settings changed since this panel opened: expected revision ${args.expectedRevision}, current revision ${snapshot.revision}`,
        );
      }
      const idle = inspectSettingsIdle(database);
      if (!idle.idle) {
        fail(`Settings are locked until the orchestrator is idle: ${idle.reasons.join("; ")}`);
      }
      let next: RuntimeSettings;
      let revisionAction: "apply" | "reset" | "rollback";
      let resultAction: SettingsResponse["action"];
      if (args.command === "apply") {
        next = normalizeRuntimeSettings(
          {
            ...snapshot.settings,
            ...args.values,
            project_wip: { ...snapshot.settings.project_wip, ...args.projectWip },
          },
          base,
          projectNames,
        );
        revisionAction = "apply";
        resultAction = "applied";
      } else if (args.command === "reset") {
        next = snapshot.defaults;
        revisionAction = "reset";
        resultAction = "reset";
      } else {
        if (snapshot.revision === 0) {
          database.exec("ROLLBACK");
          process.stdout.write(
            `${JSON.stringify(response("unchanged", database, base, projectNames, allowedGuildIds, idle))}\n`,
          );
          return;
        }
        const latest = database
          .prepare(`
            SELECT previous_settings_json, previous_settings_sha256
            FROM orchestrator_setting_revisions
            WHERE revision = ?
          `)
          .get(snapshot.revision) as
          | { previous_settings_json: string; previous_settings_sha256: string }
          | undefined;
        if (!latest) fail("Latest settings revision is unavailable");
        if (
          runtimeSettingsHash(latest.previous_settings_json) !==
          latest.previous_settings_sha256
        ) {
          fail("Previous runtime settings checksum does not match");
        }
        next = normalizeRuntimeSettings(
          JSON.parse(latest.previous_settings_json) as unknown,
          base,
          projectNames,
        );
        revisionAction = "rollback";
        resultAction = "rolled_back";
      }
      const diff = changes(snapshot.settings, next);
      if (diff.length === 0) {
        database.exec("ROLLBACK");
        process.stdout.write(
          `${JSON.stringify(response("unchanged", database, base, projectNames, allowedGuildIds, idle))}\n`,
        );
        return;
      }
      insertRevision(
        database,
        revisionAction,
        snapshot.settings,
        next,
        snapshot.revision,
        args.actorId!,
        args.via!,
      );
      database.exec("COMMIT");
      process.stdout.write(
        `${JSON.stringify(response(resultAction, database, base, projectNames, allowedGuildIds, idle, diff))}\n`,
      );
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
