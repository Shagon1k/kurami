import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { BriefingPaths } from "./store.ts";
import type { CalendarSource } from "./providers/composio-calendar.ts";
import type { OpenMeteoLocation } from "./providers/open-meteo.ts";
import type { AddonSwitches, BuiltinAddonId } from "./addons/live-contract.ts";
import { parseSignalsConfig, type SignalsConfig } from "./addons/signals/config.ts";
import {parseWeeklyConfig,type WeeklyConfig} from "./weekly/config.ts";
import {parseStocksConfig,type StocksConfig} from "./stocks/config.ts";

type JsonRecord = Record<string, unknown>;

export async function readBriefingAddonSwitches(configPath: string): Promise<AddonSwitches> {
  const root = record(parseYaml(await readFile(configPath, "utf8")), "root");
  const sources = record(root.sources, "sources");
  return sourceAddonSwitches(sources);
}

function sourceAddonSwitches(sources: JsonRecord): Record<BuiltinAddonId, boolean> {
  return Object.fromEntries(["mail", "calendar", "weather", "news"].map(id => {
    const source = sources[id] === undefined ? {} : record(sources[id], `sources.${id}`);
    if (source.enabled !== undefined && typeof source.enabled !== "boolean") {
      throw new Error(`Invalid briefing config: sources.${id}.enabled must be boolean`);
    }
    return [id, source.enabled !== false];
  })) as Record<BuiltinAddonId, boolean>;
}

// The public digest keeps exactly the latest seven daily editions. Keeping this
// value in the runtime config module gives the store and config validation one
// authoritative policy instead of trusting an agent-authored payload date.
export const DAILY_RETENTION_DAYS = 7;

export type BriefingRuntimeConfig = {
  configPath: string;
  addons: Record<"mail" | "calendar" | "weather" | "news", boolean>;
  signals: SignalsConfig;
  weekly: WeeklyConfig;
  stocks: StocksConfig;
  stocksDiscovery: boolean;
  timeZone: string;
  retentionDays: number;
  gmailQuery: string;
  gmailPageSize: number;
  calendars: CalendarSource[];
  weatherLocation: OpenMeteoLocation;
  discordChannelId: string;
  safety: {
    productionMutationsEnabled: boolean;
    initialChannelCleanupConfirmed: boolean;
    requireBoundedTelegramCommit: true;
  };
};

export type CinemaChannelSeed = {
  key: string;
  id: string;
  label: string;
  role: "official" | "discovery";
};

export type CinemaRuntimeConfig = {
  configPath: string;
  enabled: boolean;
  market: string;
  timeZone: string;
  language: string;
  limits: {
    trailers: number;
    premieres: number;
    news: number;
    providerCandidates: number;
  };
  sources: {
    boxOfficeWatch: { weekendUrl: string; yearlyUrl: string };
    kinopoisk: { worldWeekendUrl: string; usaWeekendUrl: string; readerBaseUrl: string };
    apMovies: { discoveryUrl: string };
    lkc: { reportsUrl: string };
    cinemaLt: { repertoireUrl: string };
    tmdb: { apiBaseUrl: string };
    youtube: { channels: CinemaChannelSeed[] };
    weeklyNews: Record<"variety" | "deadline" | "hollywoodReporter" | "indiewire", string>;
  };
};

export type TelegramCaptureSource = {
  key: string;
  id: number;
  label: string;
};

export type TelegramCaptureConfig = {
  configPath: string;
  enabled?: boolean;
  profile: "telegram-user";
  pageSize: number;
  discoveryLimit: number;
  channels: TelegramCaptureSource[];
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

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid briefing config: ${label} must be boolean`);
  }
  return value;
}

function safeInteger(value: unknown, label: string): number {
  const result = finiteNumber(value, label);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`Invalid briefing config: ${label} must be a safe integer`);
  }
  return result;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const result = safeInteger(value, label);
  if (result < minimum || result > maximum) {
    throw new Error(`Invalid briefing config: ${label} must be ${minimum}..${maximum}`);
  }
  return result;
}

function httpsUrl(value: unknown, label: string, expectedHost: string): string {
  const result = string(value, label);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`Invalid briefing config: ${label} must be an HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hostname !== expectedHost
  ) {
    throw new Error(`Invalid briefing config: ${label} must use ${expectedHost} over HTTPS`);
  }
  return parsed.toString();
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
  const safety = record(root.safety, "safety");
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
  if ((calendar.enabled !== false && calendars.length === 0) || new Set(calendars.map((item) => item.key)).size !== calendars.length) {
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
  const requireBoundedTelegramCommit = boolean(
    safety.require_bounded_telegram_commit,
    "safety.require_bounded_telegram_commit",
  );
  if (!requireBoundedTelegramCommit) {
    throw new Error("Invalid briefing config: bounded Telegram commit is mandatory");
  }
  return {
    configPath: loaded.path,
    timeZone,
    addons: sourceAddonSwitches(sources),
    signals: parseSignalsConfig(root.signals),
    weekly: parseWeeklyConfig(root.weekly),
    stocks: parseStocksConfig(root.stocks),
    stocksDiscovery: Boolean(root.stocksDiscovery&&typeof root.stocksDiscovery==="object"&&(root.stocksDiscovery as JsonRecord).enabled===true),
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
    safety: {
      productionMutationsEnabled: boolean(
        safety.production_mutations_enabled,
        "safety.production_mutations_enabled",
      ),
      initialChannelCleanupConfirmed: boolean(
        safety.initial_channel_cleanup_confirmed,
        "safety.initial_channel_cleanup_confirmed",
      ),
      requireBoundedTelegramCommit: true,
    },
  };
}

export async function loadTelegramCaptureConfig(
  paths: BriefingPaths,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<TelegramCaptureConfig> {
  const loaded = await readConfigFile(paths, environment);
  const root = record(loaded.value, "root");
  const sources = record(root.sources, "sources");
  const news = record(sources.news, "sources.news");
  if (news.enabled === false) {
    return { configPath: loaded.path, enabled: false, profile: "telegram-user", pageSize: 100, discoveryLimit: 100, channels: [] };
  }
  if (news.enabled !== true) {
    throw new Error("Invalid briefing config: Telegram news enabled flag is required");
  }
  if (string(news.profile, "sources.news.profile") !== "telegram-user") {
    throw new Error("Invalid briefing config: Telegram news profile must be telegram-user");
  }
  const settings = record(news.settings, "sources.news.settings");
  const pageSize = safeInteger(settings.page_size ?? 100, "news.page_size");
  const discoveryLimit = safeInteger(
    settings.discovery_limit ?? pageSize,
    "news.discovery_limit",
  );
  if (pageSize < 1 || pageSize > 200 || discoveryLimit < pageSize || discoveryLimit > 500) {
    throw new Error(
      "Invalid briefing config: Telegram page size must be 1..200 and discovery limit must be page size..500",
    );
  }
  if (!Array.isArray(news.channels)) {
    throw new Error("Invalid briefing config: sources.news.channels must be an array");
  }
  const channels = news.channels
    .map((value, index) => ({ value: record(value, `news.channels[${index}]`), index }))
    .filter(({ value }) => value.enabled !== false)
    .map(({ value, index }) => ({
      key: string(value.key, `news.channels[${index}].key`),
      id: safeInteger(value.id, `news.channels[${index}].id`),
      label: string(value.label, `news.channels[${index}].label`),
    }));
  if (
    channels.length === 0
    || new Set(channels.map((channel) => channel.key)).size !== channels.length
    || new Set(channels.map((channel) => channel.id)).size !== channels.length
  ) {
    throw new Error("Invalid briefing config: enabled Telegram channel keys and IDs must be unique");
  }
  return {
    configPath: loaded.path,
    profile: "telegram-user",
    pageSize,
    discoveryLimit,
    channels,
  };
}

export async function loadCinemaRuntimeConfig(
  paths: BriefingPaths,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CinemaRuntimeConfig> {
  const loaded = await readConfigFile(paths, environment);
  const root = record(loaded.value, "root");
  const cinema = record(root.cinema, "cinema");
  const limits = record(cinema.limits, "cinema.limits");
  const sources = record(cinema.sources, "cinema.sources");
  const boxOfficeWatch = record(sources.box_office_watch, "cinema.sources.box_office_watch");
  const kinopoisk = record(sources.kinopoisk, "cinema.sources.kinopoisk");
  const apMovies = record(sources.ap_movies, "cinema.sources.ap_movies");
  const lkc = record(sources.lkc, "cinema.sources.lkc");
  const cinemaLt = record(sources.cinema_lt, "cinema.sources.cinema_lt");
  const tmdb = record(sources.tmdb, "cinema.sources.tmdb");
  const youtube = record(sources.youtube, "cinema.sources.youtube");
  const weeklyNews = record(sources.weekly_news, "cinema.sources.weekly_news");
  const timeZone = string(cinema.timezone, "cinema.timezone");
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
  } catch {
    throw new Error("Invalid briefing config: cinema.timezone is invalid");
  }
  const market = string(cinema.market, "cinema.market");
  if (!/^[A-Z]{2}$/u.test(market)) {
    throw new Error("Invalid briefing config: cinema.market must be an ISO alpha-2 code");
  }
  if (!Array.isArray(youtube.channels)) {
    throw new Error("Invalid briefing config: cinema.sources.youtube.channels must be an array");
  }
  const channels = youtube.channels.map((entry, index) => {
    const channel = record(entry, `cinema.youtube.channels[${index}]`);
    const role = string(channel.role, `cinema.youtube.channels[${index}].role`);
    if (role !== "official" && role !== "discovery") {
      throw new Error(`Invalid briefing config: cinema.youtube.channels[${index}].role is unsupported`);
    }
    const id = string(channel.id, `cinema.youtube.channels[${index}].id`);
    if (!/^UC[A-Za-z0-9_-]{22}$/u.test(id)) {
      throw new Error(`Invalid briefing config: cinema.youtube.channels[${index}].id is invalid`);
    }
    return {
      key: string(channel.key, `cinema.youtube.channels[${index}].key`),
      id,
      label: string(channel.label, `cinema.youtube.channels[${index}].label`),
      role,
    } satisfies CinemaChannelSeed;
  });
  if (
    channels.length === 0
    || new Set(channels.map((channel) => channel.key)).size !== channels.length
    || new Set(channels.map((channel) => channel.id)).size !== channels.length
  ) {
    throw new Error("Invalid briefing config: Cinema YouTube channel keys and IDs must be unique");
  }
  return {
    configPath: loaded.path,
    enabled: boolean(cinema.enabled, "cinema.enabled"),
    market,
    timeZone,
    language: string(cinema.language, "cinema.language"),
    limits: {
      trailers: boundedInteger(limits.trailers, "cinema.limits.trailers", 1, 12),
      premieres: boundedInteger(limits.premieres, "cinema.limits.premieres", 1, 20),
      news: boundedInteger(limits.news, "cinema.limits.news", 1, 20),
      providerCandidates: boundedInteger(
        limits.provider_candidates,
        "cinema.limits.provider_candidates",
        20,
        500,
      ),
    },
    sources: {
      boxOfficeWatch: {
        weekendUrl: httpsUrl(
          boxOfficeWatch.weekend_url,
          "cinema.sources.box_office_watch.weekend_url",
          "boxofficewatch.com",
        ),
        yearlyUrl: httpsUrl(
          boxOfficeWatch.yearly_url,
          "cinema.sources.box_office_watch.yearly_url",
          "boxofficewatch.com",
        ),
      },
      kinopoisk: {
        worldWeekendUrl: httpsUrl(
          kinopoisk.world_weekend_url,
          "cinema.sources.kinopoisk.world_weekend_url",
          "www.kinopoisk.ru",
        ),
        usaWeekendUrl: httpsUrl(
          kinopoisk.usa_weekend_url,
          "cinema.sources.kinopoisk.usa_weekend_url",
          "www.kinopoisk.ru",
        ),
        readerBaseUrl: (() => {
          const value = httpsUrl(
            kinopoisk.reader_base_url,
            "cinema.sources.kinopoisk.reader_base_url",
            "r.jina.ai",
          ).replace(/\/$/u, "");
          if (!new URL(value).pathname.startsWith("/https://www.kinopoisk.ru")) {
            throw new Error("Invalid briefing config: cinema.sources.kinopoisk.reader_base_url must target www.kinopoisk.ru");
          }
          return value;
        })(),
      },
      apMovies: {
        discoveryUrl: httpsUrl(
          apMovies.discovery_url,
          "cinema.sources.ap_movies.discovery_url",
          "apnews.com",
        ),
      },
      lkc: {
        reportsUrl: httpsUrl(
          lkc.reports_url,
          "cinema.sources.lkc.reports_url",
          "www.lkc.lt",
        ),
      },
      cinemaLt: {
        repertoireUrl: httpsUrl(
          cinemaLt.repertoire_url,
          "cinema.sources.cinema_lt.repertoire_url",
          "cinema.lt",
        ),
      },
      tmdb: {
        apiBaseUrl: httpsUrl(
          tmdb.api_base_url,
          "cinema.sources.tmdb.api_base_url",
          "api.themoviedb.org",
        ).replace(/\/$/u, ""),
      },
      youtube: { channels },
      weeklyNews: {
        variety: httpsUrl(weeklyNews.variety, "cinema.sources.weekly_news.variety", "variety.com"),
        deadline: httpsUrl(weeklyNews.deadline, "cinema.sources.weekly_news.deadline", "deadline.com"),
        hollywoodReporter: httpsUrl(
          weeklyNews.hollywood_reporter,
          "cinema.sources.weekly_news.hollywood_reporter",
          "www.hollywoodreporter.com",
        ),
        indiewire: httpsUrl(
          weeklyNews.indiewire,
          "cinema.sources.weekly_news.indiewire",
          "www.indiewire.com",
        ),
      },
    },
  };
}
