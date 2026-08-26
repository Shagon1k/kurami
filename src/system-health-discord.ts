import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import {
  componentMessage,
  container,
  separator,
  textDisplay,
  type DiscordObject,
} from "./discord-ui.ts";
import {
  formatUptime,
  evaluateHealthAlerts,
  readHealthAlertState,
  writeHealthAlertState,
  type HealthAlertDecision,
} from "./server-health.ts";
import {
  inspectRuntimeHealth,
  type RuntimeHealthResult,
} from "./runtime-health.ts";

process.umask(0o077);

type HealthDiscordConfig = {
  version: number;
  discord?: {
    health_channel_id?: string;
    alerts_channel_id?: string;
  };
};

type HealthSurfaceState = {
  version: 1;
  channelId: string;
  messageId: string;
};

type DiscordDeliveryOptions = {
  token: string;
  channelId: string;
  apiBase: string;
};

const defaultApiBase = "https://discord.com/api/v10";
const healthyColor = 0x57f287;
const warningColor = 0xfee75c;
const criticalColor = 0xed4245;

function fail(message: string): never {
  throw new Error(message);
}

function validateChannelId(value: string | undefined, key: string): string {
  const channelId = value?.trim() ?? "";
  if (!/^\d{5,30}$/u.test(channelId)) fail(`${key} must be configured`);
  return channelId;
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
    ) {
      value = value.slice(1, -1);
    }
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

function vilniusTimestamp(value: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Vilnius",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

function table(rows: Array<[string, string]>): string {
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  return [
    "```text",
    ...rows.map(([label, value]) => `${label.padEnd(labelWidth)}  ${value}`),
    "```",
  ].join("\n");
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function issueRows(
  rows: Array<[string, string]>,
): Array<[string, string]> {
  const visible = rows
    .slice(0, 8)
    .map(([label, value]) => [label, truncate(value, 220)] as [string, string]);
  if (rows.length > visible.length) {
    visible.push(["MORE", `${rows.length - visible.length} additional checks`]);
  }
  return visible;
}

function systemRows(result: RuntimeHealthResult): Array<[string, string]> {
  const server = result.server;
  const swap =
    server.swapTotalGiB === 0
      ? "off"
      : `${server.swapUsedGiB}/${server.swapTotalGiB} GiB`;
  return [
    ["CPU", `${server.cpuUsedPercent}%  ·  load ${server.loadAverage.join(" / ")}`],
    [
      "RAM",
      `${server.memoryUsedGiB}/${server.memoryTotalGiB} GiB  ·  ${server.memoryAvailableGiB} GiB available`,
    ],
    [
      "Disk",
      `${result.resourceGuard.disk.usedPercent}%  ·  ${result.resourceGuard.disk.availableGiB} GiB available`,
    ],
    ["Swap", swap],
    ["Uptime", formatUptime(server.uptimeSeconds)],
  ];
}

function orchestratorRows(
  result: RuntimeHealthResult,
): Array<[string, string]> {
  const backup =
    result.backupAgeHours === null
      ? `missing  ·  limit ${result.backupMaxAgeHours}h`
      : `${result.backupAgeHours}h old  ·  limit ${result.backupMaxAgeHours}h`;
  return [
    ["State DB", result.databaseIntegrity === "ok" ? "healthy" : result.databaseIntegrity],
    ["Docker", result.dockerRootless ? "rootless" : "unexpected daemon"],
    ["Previews", `${result.activePreviewLeases} active`],
    [
      "Worktrees",
      `${result.resourceGuard.worktrees.global}/${result.resourceGuard.worktrees.maxGlobal} managed`,
    ],
    ["Quarantine", String(result.resourceGuard.quarantines.quarantined)],
    ["Backup", backup],
  ];
}

function cardColor(result: RuntimeHealthResult): number {
  if (result.alertIssues.some((issue) => issue.severity === "critical")) {
    return criticalColor;
  }
  return result.ok ? healthyColor : warningColor;
}

function healthSections(result: RuntimeHealthResult): DiscordObject[] {
  return [
    textDisplay(`### 🖥️ System\n${table(systemRows(result))}`),
    separator(),
    textDisplay(
      `### 🧭 Project Orchestrator\n${table(orchestratorRows(result))}`,
    ),
  ];
}

export function systemHealthCard(
  result: RuntimeHealthResult,
): DiscordObject {
  const status = result.ok
    ? "🟢 All monitored checks are healthy"
    : "🟠 One or more checks need attention";
  const body: DiscordObject[] = [
    textDisplay(`## 🩺 Kurami System Health\n${status}`),
    separator(),
    ...healthSections(result),
  ];
  if (!result.ok) {
    body.push(
      separator(),
      textDisplay(
        `### Issues\n${table(issueRows(result.problems.map((problem) => ["!", problem])))}`,
      ),
    );
  }
  body.push(
    textDisplay(
      `-# ${result.server.hostname} · Updated ${vilniusTimestamp(result.checkedAt)} Europe/Vilnius`,
    ),
  );
  return componentMessage([container(body, cardColor(result))]);
}

export function systemHealthAlertCard(
  result: RuntimeHealthResult,
  decision: HealthAlertDecision,
): DiscordObject {
  const active = Object.values(decision.active);
  const critical = active.some((issue) => issue.severity === "critical");
  const recovered = decision.kind === "recovery";
  const title = recovered
    ? "✅ Kurami System Recovered"
    : decision.kind === "reminder"
      ? "⏰ Kurami System Health Reminder"
      : critical
        ? "🚨 Kurami System Health Alert"
        : "⚠️ Kurami System Health Warning";
  const body: DiscordObject[] = [textDisplay(`## ${title}`)];
  if (active.length > 0) {
    body.push(
      separator(),
      textDisplay(
        `### Active checks\n${table(
          issueRows(
            active.map((issue) => [issue.severity.toUpperCase(), issue.message]),
          ),
        )}`,
      ),
    );
  }
  body.push(separator(), ...healthSections(result));
  body.push(
    textDisplay(
      `-# ${result.server.hostname} · Checked ${vilniusTimestamp(result.checkedAt)} Europe/Vilnius`,
    ),
  );
  return componentMessage([
    container(
      body,
      recovered ? healthyColor : critical ? criticalColor : warningColor,
    ),
  ]);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function discordRequest(
  options: DiscordDeliveryOptions,
  method: string,
  path: string,
  payload?: DiscordObject,
  allowNotFound = false,
): Promise<DiscordObject | null> {
  const apiBase = options.apiBase.replace(/\/$/u, "");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bot ${options.token}`,
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

async function readHealthSurfaceState(
  path: string,
): Promise<HealthSurfaceState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<HealthSurfaceState>;
    if (
      parsed.version === 1 &&
      /^\d+$/u.test(parsed.channelId ?? "") &&
      /^\d+$/u.test(parsed.messageId ?? "")
    ) {
      return parsed as HealthSurfaceState;
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeHealthSurfaceState(
  path: string,
  state: HealthSurfaceState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function reconcileSystemHealthCard(
  options: DiscordDeliveryOptions & {
    result: RuntimeHealthResult;
    statePath: string;
  },
): Promise<{ action: "created" | "edited"; messageId: string }> {
  const channelId = validateChannelId(options.channelId, "health channel ID");
  const previous = await readHealthSurfaceState(options.statePath);
  const messageId = previous?.channelId === channelId ? previous.messageId : null;
  const payload = systemHealthCard(options.result);
  if (messageId) {
    const edited = await discordRequest(
      options,
      "PATCH",
      `/channels/${channelId}/messages/${messageId}`,
      payload,
      true,
    );
    if (edited) return { action: "edited", messageId };
  }
  const nonce = createHash("sha256")
    .update(`kurami-system-health:${channelId}`)
    .digest("hex")
    .slice(0, 24);
  const created = await discordRequest(
    options,
    "POST",
    `/channels/${channelId}/messages`,
    { ...payload, nonce, enforce_nonce: true },
  );
  const createdId = String(created?.id ?? "");
  if (!/^\d+$/u.test(createdId)) fail("Discord returned no health message ID");
  await writeHealthSurfaceState(options.statePath, {
    version: 1,
    channelId,
    messageId: createdId,
  });
  return { action: "created", messageId: createdId };
}

export async function sendSystemHealthAlert(
  options: DiscordDeliveryOptions & {
    result: RuntimeHealthResult;
    decision: HealthAlertDecision;
    nonceSeed: string;
  },
): Promise<string> {
  const channelId = validateChannelId(options.channelId, "alerts channel ID");
  const nonce = createHash("sha256")
    .update(`kurami-system-alert:${options.nonceSeed}`)
    .digest("hex")
    .slice(0, 24);
  const created = await discordRequest(
    options,
    "POST",
    `/channels/${channelId}/messages`,
    {
      ...systemHealthAlertCard(options.result, options.decision),
      nonce,
      enforce_nonce: true,
    },
  );
  const messageId = String(created?.id ?? "");
  if (!/^\d+$/u.test(messageId)) fail("Discord returned no alert message ID");
  return messageId;
}

function parseMode(args: string[]): "heartbeat" | "alerts" {
  if (args.length === 1 && args[0] === "--heartbeat") return "heartbeat";
  if (args.length === 1 && args[0] === "--alerts") return "alerts";
  fail("Usage: system-health-discord.ts [--heartbeat | --alerts]");
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const orchestratorHome = resolve(
    process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const hermesHome = resolve(
    process.env.HERMES_HOME ?? "/home/shagon1k/_hermes/_core",
  );
  const config = parse(
    await readFile(resolve(orchestratorHome, "config/orchestrator.yaml"), "utf8"),
  ) as HealthDiscordConfig;
  if (config.version !== 1) fail("Unsupported configuration version");
  const apiBase = process.env.DISCORD_API_BASE ?? defaultApiBase;
  const token = await loadDiscordToken(hermesHome);
  const result = await inspectRuntimeHealth(orchestratorHome);

  if (mode === "heartbeat") {
    const channelId = validateChannelId(
      config.discord?.health_channel_id,
      "discord.health_channel_id",
    );
    const delivery = await reconcileSystemHealthCard({
      token,
      channelId,
      apiBase,
      result,
      statePath: resolve(orchestratorHome, "state/system-health-discord.json"),
    });
    process.stdout.write(
      `${JSON.stringify({ ok: true, mode, channelId, ...delivery })}\n`,
    );
    return;
  }

  const channelId = validateChannelId(
    config.discord?.alerts_channel_id,
    "discord.alerts_channel_id",
  );
  const alertStatePath = resolve(orchestratorHome, "state/runtime-health-alert.json");
  const previous = await readHealthAlertState(alertStatePath);
  const decision = evaluateHealthAlerts(
    previous,
    result.alertIssues,
    new Date(result.checkedAt),
    result.serverHealthConfig.alert_reminder_minutes,
  );
  if (!decision.kind) {
    await writeHealthAlertState(alertStatePath, decision.state);
    process.stdout.write(
      `${JSON.stringify({ ok: true, mode, channelId, delivered: false })}\n`,
    );
    return;
  }
  const fingerprint = Object.entries(decision.active)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, issue]) => `${key}:${issue.severity}`)
    .join("|");
  const messageId = await sendSystemHealthAlert({
    token,
    channelId,
    apiBase,
    result,
    decision,
    nonceSeed: `${decision.kind}:${previous.lastNotifiedAt ?? "initial"}:${fingerprint}`,
  });
  await writeHealthAlertState(alertStatePath, decision.state);
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode, channelId, delivered: true, messageId })}\n`,
  );
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
