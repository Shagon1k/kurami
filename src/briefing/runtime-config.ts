import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { BriefingPaths } from "./store.ts";
import type { CalendarSource } from "./providers/composio-calendar.ts";
import type { OpenMeteoLocation } from "./providers/open-meteo.ts";

type JsonRecord = Record<string, unknown>;

// The public digest keeps exactly the latest five daily editions. Keeping this
// value in the runtime config module gives the store and config validation one
// authoritative policy instead of trusting an agent-authored payload date.
export const DAILY_RETENTION_DAYS = 5;

export type BriefingRuntimeConfig = {
  configPath: string;
  timeZone: string;
  retentionDays: number;
  gmailQuery: string;
  gmailPageSize: number;
  calendars: CalendarSource[];
  weatherLocation: OpenMeteoLocation;
  discordChannelId: string;
};

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid briefing config: ${label} must be an object`);
  }
  return value as JsonRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid briefing config: ${label} must be a non-empty string`);
  }
  return value.trim();
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid briefing config: ${label} must be a finite number`);
  }
  return value;
}

async function readConfigFile(paths: BriefingPaths, environment: NodeJS.ProcessEnv): Promise<{
  path: string;
  value: unknown;
}> {
  const candidates = environment.BRIEFING_CONFIG_PATH?.trim()
    ? [resolve(environment.BRIEFING_CONFIG_PATH)]
    : [
      resolve(paths.home, "config/briefing.yaml"),
      resolve(paths.home, "app/deploy/config/briefing.yaml"),
    ];
  for (const path of candidates) {
    try {
      return { path, value: parseYaml(await readFile(path, "utf8")) as unknown };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("Briefing runtime config is unavailable");
}

export async function loadBriefingRuntimeConfig(
  paths: BriefingPaths,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<BriefingRuntimeConfig> {
  const loaded = await readConfigFile(paths, environment);
  const root = record(loaded.value, "root");
  const edition = record(root.edition, "edition");
  const sources = record(root.sources, "sources");
  const mail = record(sources.mail, "sources.mail");
  const mailSettings = record(mail.settings, "sources.mail.settings");
  const calendar = record(sources.calendar, "sources.calendar");
  const calendarSettings = record(calendar.settings, "sources.calendar.settings");
  const weather = record(sources.weather, "sources.weather");
  const weatherSettings = record(weather.settings, "sources.weather.settings");
  const notification = record(root.notification, "notification");
  const timeZone = string(edition.timezone, "edition.timezone");
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
  } catch {
    throw new Error("Invalid briefing config: edition.timezone is invalid");
  }
  const rawCalendars = calendarSettings.calendars;
  if (!Array.isArray(rawCalendars)) {
    throw new Error("Invalid briefing config: sources.calendar.settings.calendars must be an array");
  }
  const calendars = rawCalendars
    .map((value, index) => ({ value: record(value, `calendars[${index}]`), index }))
    .filter(({ value }) => value.enabled !== false)
    .map(({ value, index }) => ({
      key: string(value.key, `calendars[${index}].key`),
      id: string(value.id, `calendars[${index}].id`),
      label: string(value.label, `calendars[${index}].label`),
      role: string(value.role, `calendars[${index}].role`),
    }));
  if (calendars.length === 0 || new Set(calendars.map((item) => item.key)).size !== calendars.length) {
    throw new Error("Invalid briefing config: enabled calendar keys must be unique");
  }
  const retentionDays = finiteNumber(edition.daily_retention_days, "edition.daily_retention_days");
  if (!Number.isInteger(retentionDays) || retentionDays !== DAILY_RETENTION_DAYS) {
    throw new Error(`Invalid briefing config: daily retention must equal ${DAILY_RETENTION_DAYS} days`);
  }
  const gmailPageSize = finiteNumber(mailSettings.page_size ?? 100, "mail.page_size");
  if (!Number.isInteger(gmailPageSize) || gmailPageSize < 1 || gmailPageSize > 100) {
    throw new Error("Invalid briefing config: mail page size must be between 1 and 100");
  }
  const discordChannelId = string(notification.destination, "notification.destination");
  if (!/^\d{10,20}$/u.test(discordChannelId)) {
    throw new Error("Invalid briefing config: Discord destination must be a channel ID");
  }
  return {
    configPath: loaded.path,
    timeZone,
    retentionDays,
    gmailQuery: string(mailSettings.query, "mail.query"),
    gmailPageSize,
    calendars,
    weatherLocation: {
      name: string(weatherSettings.location, "weather.location"),
      latitude: finiteNumber(weatherSettings.latitude, "weather.latitude"),
      longitude: finiteNumber(weatherSettings.longitude, "weather.longitude"),
      timeZone: string(weatherSettings.timezone ?? timeZone, "weather.timezone"),
    },
    discordChannelId,
  };
}
