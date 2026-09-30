import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { parse } from "yaml";
import { collectHealthCycle, readHealthCycle, deliverHealthNotifications } from "./health-cycle.ts";
import type { HealthHistoryEntry } from "./health-history.ts";
export { readHealthHistory, recordHealthHistory, type HealthHistoryEntry } from "./health-history.ts";
import {
  actionRow,
  componentMessage,
  container,
  separator,
  stringSelect,
  textDisplay,
  type DiscordObject,
} from "../../discord/ui.ts";
import {
  formatUptime,
  type HealthAlertDecision,
} from "./server-health.ts";
import type { RuntimeHealthResult } from "../../orchestrator/health/runtime.ts";

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

function metricStack(rows: Array<[string, string, string?]>): string {
  return rows
    .map(([label, value, detail]) =>
      [`**${label} ${value}**`, detail].filter(Boolean).join("\n"),
    )
    .join("\n\n");
}

function statusStack(rows: Array<[string, string]>): string {
  return rows.map(([label, value]) => `**${label}** · ${value}`).join("\n");
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

function systemRows(result: RuntimeHealthResult): Array<[string, string, string?]> {
  const server = result.server;
  const cpuStatistics = result.cpuStatistics;
  const swap =
    server.swapTotalGiB === 0
      ? "off"
      : `${server.swapUsedGiB}/${server.swapTotalGiB} GiB`;
  const network = result.networkConnectivity;
  const speed = result.networkSpeed;
  const speedText = speed
    ? `${Math.round(speed.downloadMbps)}↓ / ${Math.round(speed.uploadMbps)}↑ Mbps`
    : "speed pending";
  const cpuDetail =
    cpuStatistics.averagePercent === null
      ? `avg ${cpuStatistics.windowMinutes}m collecting`
      : `avg ${cpuStatistics.windowMinutes}m ${cpuStatistics.averagePercent}% · peak ${cpuStatistics.peakPercent}%`;
  return [
    ["CPU", `${server.cpuUsedPercent}% (5s)`, `${cpuDetail} · load ${server.loadAverage.join(" / ")}`],
    [
      "RAM",
      `${server.memoryUsedGiB}/${server.memoryTotalGiB} GiB`,
      `${server.memoryAvailableGiB} GiB free`,
    ],
    [
      "Network",
      `${network.status} · ${network.latencyMs === null ? "n/a" : `${network.latencyMs} ms`}`,
      speedText,
    ],
    [
      "Disk",
      `${result.resourceGuard.disk.usedPercent}%`,
      `${result.resourceGuard.disk.availableGiB} GiB free`,
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
    [
      "Docker",
      `${result.containerRuntime.running} up  ·  ${result.containerRuntime.unhealthy} unhealthy${result.dockerRootless ? "" : "  ·  daemon not rootless"}`,
    ],
    ["Previews", `${result.activePreviewLeases} active`],
    [
      "Worktrees",
      `${result.resourceGuard.worktrees.global}/${result.resourceGuard.worktrees.maxGlobal} managed`,
    ],
    ["Quarantine", String(result.resourceGuard.quarantines.quarantined)],
    ["Backup", backup],
  ];
}

function consumerRows(result: RuntimeHealthResult): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (result.topConsumers.cpu) {
    const value = result.topConsumers.cpu;
    rows.push([
      "CPU process",
      `${value.name}  ·  ${value.cpuPercent}% CPU  ·  ${value.rssMiB} MiB RAM`,
    ]);
  }
  if (result.topConsumers.memory) {
    const value = result.topConsumers.memory;
    rows.push([
      "RAM process",
      `${value.name}  ·  ${value.rssMiB} MiB RAM  ·  ${value.cpuPercent}% CPU`,
    ]);
  }
  if (result.topConsumers.containerCpu) {
    const value = result.topConsumers.containerCpu;
    rows.push([
      "Container CPU",
      `${value.name}  ·  ${value.cpuPercent}% CPU  ·  ${value.memoryUsage}`,
    ]);
  }
  if (
    result.topConsumers.containerMemory &&
    result.topConsumers.containerMemory.name !== result.topConsumers.containerCpu?.name
  ) {
    const value = result.topConsumers.containerMemory;
    rows.push([
      "Container RAM",
      `${value.name}  ·  ${value.memoryUsage}  ·  ${value.cpuPercent}% CPU`,
    ]);
  }
  return rows;
}

function cardColor(result: RuntimeHealthResult): number {
  if (result.alertIssues.some((issue) => issue.severity === "critical")) {
    return criticalColor;
  }
  return result.ok ? healthyColor : warningColor;
}

function healthSections(result: RuntimeHealthResult): DiscordObject[] {
  return [
    textDisplay(`### 🖥️ System\n${metricStack(systemRows(result))}`),
    separator(),
    textDisplay(
      `### 🧭 Project Orchestrator\n${statusStack(orchestratorRows(result))}`,
    ),
  ];
}

export function systemHealthCard(
  result: RuntimeHealthResult,
  history: HealthHistoryEntry[] = [],
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
  if (history.length > 0) {
    body.push(
      separator(),
      textDisplay("### Recent health runs"),
      actionRow([
        stringSelect(
          "kurami:health:history",
          "Inspect one of the last 10 runs…",
          history.slice(0, 10).map((entry) => ({
            label: `${vilniusTimestamp(entry.checkedAt)} · ${entry.ok ? "healthy" : "attention"}`,
            value: entry.id,
            description: `CPU ${entry.cpuPercent}% · RAM ${entry.memoryPercent}% · Disk ${entry.diskPercent}%`,
          })),
        ),
      ]),
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
    const consumers = consumerRows(result);
    if (consumers.length > 0) {
      body.push(
        separator(),
        textDisplay(`### Top consumers at alert time\n${table(consumers)}`),
      );
    }
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
      signal: AbortSignal.timeout(15_000),
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
    history?: HealthHistoryEntry[];
  },
): Promise<{ action: "created" | "edited"; messageId: string }> {
  const channelId = validateChannelId(options.channelId, "health channel ID");
  const previous = await readHealthSurfaceState(options.statePath);
  const messageId = previous?.channelId === channelId ? previous.messageId : null;
  const payload = systemHealthCard(options.result, options.history ?? []);
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

export async function cleanupHealthChannel(
  options: DiscordDeliveryOptions & { statePath: string },
): Promise<{ keptMessageId: string; scanned: number; deleted: number }> {
  const channelId = validateChannelId(options.channelId, "health channel ID");
  const state = await readHealthSurfaceState(options.statePath);
  if (!state || state.channelId !== channelId) {
    fail("Persistent health card state does not match the configured channel");
  }
  await discordRequest(
    options,
    "GET",
    `/channels/${channelId}/messages/${state.messageId}`,
  );
  const currentUser = await discordRequest(options, "GET", "/users/@me");
  const botUserId = String(currentUser?.id ?? "");
  if (!/^\d+$/u.test(botUserId)) fail("Discord returned no bot user ID");
  const messages: Array<{ id: string; authorId: string }> = [];
  let before: string | null = null;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = await discordRequest(
      options,
      "GET",
      `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`,
    ) as unknown;
    if (!Array.isArray(page)) fail("Discord returned an invalid Health message page");
    const pageMessages = page
      .map((message) => ({
        id: String((message as { id?: unknown }).id ?? ""),
        authorId: String(
          (message as { author?: { id?: unknown } }).author?.id ?? "",
        ),
      }))
      .filter((message) => /^\d+$/u.test(message.id));
    messages.push(...pageMessages);
    const ids = pageMessages.map((message) => message.id);
    if (ids.length < 100) break;
    before = ids.at(-1) ?? null;
    if (pageNumber === 9) fail("Health channel cleanup exceeded 1000 messages");
  }
  if (!messages.some((message) => message.id === state.messageId)) {
    fail("Persistent health card was not found during cleanup");
  }
  const stale = messages.filter(
    (message) =>
      message.id !== state.messageId && message.authorId === botUserId,
  );
  for (const message of stale) {
    await discordRequest(
      options,
      "DELETE",
      `/channels/${channelId}/messages/${message.id}`,
    );
  }
  return {
    keptMessageId: state.messageId,
    scanned: messages.length,
    deleted: stale.length,
  };
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

function parseMode(
  args: string[],
): "run" | "heartbeat" | "alerts" | "deliver" | "cleanup-health-channel" {
  if (args.length === 1 && args[0] === "--run") return "run";
  if (args.length === 1 && args[0] === "--heartbeat") return "heartbeat";
  if (args.length === 1 && args[0] === "--alerts") return "alerts";
  if (args.length === 1 && args[0] === "--deliver") return "deliver";
  if (args.length === 1 && args[0] === "--cleanup-health-channel") {
    return "cleanup-health-channel";
  }
  fail(
    "Usage: system-health-discord.ts [--run | --heartbeat | --alerts | --deliver | --cleanup-health-channel]",
  );
}

export async function runSystemHealthDiscordCli(args = process.argv.slice(2), collect = collectHealthCycle): Promise<void> {
  const mode = parseMode(args);
  const kuramiHome = resolveKuramiHome(
    resolve(import.meta.dirname, "../../../.."),
  );
  const hermesHome = resolve(
    process.env.HERMES_HOME ?? "/home/shagon1k/_hermes/_core",
  );
  const cycle = mode === "cleanup-health-channel" ? null : mode === "deliver"
    ? readHealthCycle(kuramiHome) : await collect(kuramiHome);
  if (mode !== "cleanup-health-channel" && !cycle) fail("No collected Health cycle is available");
  const config = parse(
    await readFile(resolve(kuramiHome, "config/orchestrator.yaml"), "utf8"),
  ) as HealthDiscordConfig;
  if (config.version !== 1) fail("Unsupported configuration version");
  const apiBase = process.env.DISCORD_API_BASE ?? defaultApiBase;
  const token = await loadDiscordToken(hermesHome);

  if (mode === "cleanup-health-channel") {
    const healthChannelId = validateChannelId(
      config.discord?.health_channel_id,
      "discord.health_channel_id",
    );
    const cleanup = await cleanupHealthChannel({
      token,
      channelId: healthChannelId,
      apiBase,
      statePath: resolve(kuramiHome, "state/system-health-discord.json"),
    });
    process.stdout.write(
      `${JSON.stringify({ ok: true, mode, channelId: healthChannelId, ...cleanup })}\n`,
    );
    return;
  }

  const {result, history} = cycle!;

  const deliverAlerts = async (): Promise<Record<string, unknown>> => {
    const alertsChannelId = validateChannelId(
      config.discord?.alerts_channel_id,
      "discord.alerts_channel_id",
    );
    const delivery = await deliverHealthNotifications(kuramiHome, notification => sendSystemHealthAlert({
        token,
        channelId: alertsChannelId,
        apiBase,
        ...notification,
      }));
    return {
      channelId: alertsChannelId,
      ...delivery,
    };
  };

  const updateHeartbeat = async (): Promise<Record<string, unknown>> => {
    const healthChannelId = validateChannelId(
      config.discord?.health_channel_id,
      "discord.health_channel_id",
    );
    const delivery = await reconcileSystemHealthCard({
      token,
      channelId: healthChannelId,
      apiBase,
      result,
      history,
      statePath: resolve(kuramiHome, "state/system-health-discord.json"),
    });
    return { channelId: healthChannelId, history: history.length, ...delivery };
  };

  if (mode === "alerts") {
    process.stdout.write(`${JSON.stringify({ ok: true, mode, ...(await deliverAlerts()) })}\n`);
    return;
  }
  if (mode === "heartbeat") {
    process.stdout.write(`${JSON.stringify({ ok: true, mode, ...(await updateHeartbeat()) })}\n`);
    return;
  }
  const [alerts, heartbeat] = await Promise.all([deliverAlerts(), updateHeartbeat()]);
  process.stdout.write(`${JSON.stringify({ ok: true, mode, alerts, heartbeat })}\n`);
}

if (import.meta.main) {
  runSystemHealthDiscordCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
