import {
  briefingPaths,
  cleanupExpired,
  initializeBriefingStore,
  openBriefingDatabase,
  refreshPublishedEdition,
  retainedDailyEditions,
  type EditionRow,
} from "./store.ts";
import {
  briefingAddonEnabled,
  parseBriefingPayload,
  type BriefingPayload,
} from "./model.ts";
import { renderBriefingPage } from "./ui/render-page.ts";
import {
  composioReadConnectionFromEnvironment,
  createComposioReadToolCaller,
} from "./providers/composio-mcp.ts";
import type { fetchGmailSnapshot } from "./providers/composio-gmail.ts";
import type { fetchCalendarSnapshot, NormalizedCalendarEvent } from "./providers/composio-calendar.ts";
import type { fetchOpenMeteo } from "./providers/open-meteo.ts";
import type { FetchLike, ProviderState } from "./providers/common.ts";
import { collectDynamicBriefingSnapshot } from "./providers/dynamic-snapshot.ts";
import { applyLiveAddons, LIVE_ADDONS } from "./addons/live.ts";
export { calendarEvent, calendarConflicts } from "./addons/calendar/lifecycle.ts";
export { mailItem, classifyMail } from "./addons/mail/lifecycle.ts";
export { weatherValue } from "./addons/weather/lifecycle.ts";
export { providerComplete, sectionState } from "./addons/provider-state.ts";
import { loadBriefingRuntimeConfig } from "./runtime-config.ts";
import { refreshDerivedAddons } from "./addons/derived.ts";
import {collectWeeklyHistory} from "./weekly/lifecycle.ts";
import {refreshStocksSafely} from "./stocks/collector.ts";

type PollerResult = {
  refreshedAt: string;
  editions: Array<{ id: string; state: "updated" | "skipped"; reason?: string }>;
  providers: { gmail: ProviderState; calendar: ProviderState; weather: ProviderState };
  deleted: string[];
};

export type DigestCentralPollerDependencies = {
  weatherFetch?: FetchLike;
};

function nextLocalDate(localDate: string): string {
  const parsed = new Date(`${localDate}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid retained local date ${localDate}`);
  return new Date(parsed.getTime() + 86_400_000).toISOString().slice(0, 10);
}

export { refreshDataQuality } from "./addons/quality.ts";
import { refreshDataQuality } from "./addons/quality.ts";

export function updatePayload(
  original: BriefingPayload,
  refreshedAt: string,
  gmail: Awaited<ReturnType<typeof fetchGmailSnapshot>>,
  calendar: Awaited<ReturnType<typeof fetchCalendarSnapshot>>,
  calendarItems: NormalizedCalendarEvent[] | null,
  weather: Awaited<ReturnType<typeof fetchOpenMeteo>>,
): BriefingPayload {
  const next = structuredClone(original);
  applyLiveAddons(next, { gmail, calendar, weather }, { refreshedAt, calendarItems });
  refreshDerivedAddons(next, { at: refreshedAt });
  refreshDataQuality(next, refreshedAt);
  return parseBriefingPayload(next);
}

export async function runDigestCentralPoller(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: DigestCentralPollerDependencies = {},
): Promise<PollerResult> {
  const paths = briefingPaths(environment);
  await initializeBriefingStore(paths);
  const config = await loadBriefingRuntimeConfig(paths, environment);
  const stocksRefresh=refreshStocksSafely(config.stocks,paths);
  const refreshedAt = new Date().toISOString();
  const before = openBriefingDatabase(paths);
  let retained: EditionRow[];
  try {
    retained = retainedDailyEditions(before, refreshedAt);
  } finally {
    before.close();
  }
  if (retained.length === 0) {
    await stocksRefresh;
    const history=openBriefingDatabase(paths);
    try {collectWeeklyHistory(history,config.weekly,refreshedAt,config.timeZone);}
    catch {console.warn("Weekly observation cleanup failed");}
    finally {history.close();}
    const cleanup = await cleanupExpired(refreshedAt, paths);
    return {
      refreshedAt,
      editions: [],
      providers: { gmail: "empty", calendar: "empty", weather: "empty" },
      deleted: cleanup.deleted,
    };
  }
  const enabled = Object.fromEntries(LIVE_ADDONS.map(addon => [
    addon.id,
    config.addons[addon.id] && retained.some(row => {
      try { return briefingAddonEnabled(parseBriefingPayload(JSON.parse(row.payload_json)), addon.id); }
      catch { return false; }
    }),
  ]));
  const snapshot = await collectDynamicBriefingSnapshot({
    getCaller: () => createComposioReadToolCaller(composioReadConnectionFromEnvironment(environment)),
    gmailQuery: config.gmailQuery, gmailPageSize: config.gmailPageSize,
    calendars: config.calendars, localDate: retained[0]!.local_date,
    endLocalDateExclusive: nextLocalDate(retained.at(-1)!.local_date),
    includeTomorrow: config.signals.enabled && config.signals.rules.earlyTomorrow,
    timeZone: config.timeZone, weatherLocation: config.weatherLocation,
    fetchImpl: dependencies.weatherFetch, enabled,
    retry: { attempts: 3, timeoutMs: 12_000, initialDelayMs: 300, maximumDelayMs: 2_000 },
  });
  const editions: PollerResult["editions"] = [];
  for (const row of retained) {
    try {
      const original = parseBriefingPayload(JSON.parse(row.payload_json) as unknown);
      const payload = structuredClone(original);
      applyLiveAddons(payload, snapshot, { refreshedAt, enabled });
      refreshDerivedAddons(payload, { at: new Date().toISOString(), settings: { signals: config.signals, weekly:config.weekly } });
      refreshDataQuality(payload, refreshedAt);
      const validated = parseBriefingPayload(payload);
      await refreshPublishedEdition(validated, renderBriefingPage(validated), row.content_digest, paths);
      editions.push({ id: row.id, state: "updated" });
    } catch (error) {
      editions.push({
        id: row.id,
        state: "skipped",
        reason: error instanceof Error ? error.message.slice(0, 180) : "Refresh failed",
      });
    }
  }
  const history=openBriefingDatabase(paths);
  await stocksRefresh;
  try {collectWeeklyHistory(history,config.weekly,refreshedAt,config.timeZone);}
  catch {console.warn("Weekly observation failed; live refresh continues");}
  finally {history.close();}
  const cleanup = await cleanupExpired(refreshedAt, paths);
  return {
    refreshedAt,
    editions,
    providers: { gmail: snapshot.gmail.state, calendar: snapshot.calendar.state, weather: snapshot.weather.state },
    deleted: cleanup.deleted,
  };
}

function parseArguments(argv: string[]): { apply: boolean; quiet: boolean } {
  const allowed = new Set(["--apply", "--quiet"]);
  for (const value of argv) if (!allowed.has(value)) throw new Error(`Unknown poller option ${value}`);
  return { apply: argv.includes("--apply"), quiet: argv.includes("--quiet") };
}

if (import.meta.main) {
  const args = parseArguments(process.argv.slice(2));
  if (!args.apply) {
    process.stderr.write("Digest Central Poller requires --apply\n");
    process.exitCode = 64;
  } else {
    runDigestCentralPoller()
      .then((result) => {
        if (!args.quiet) process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
        if (result.editions.some((edition) => edition.state === "skipped")) process.exitCode = 1;
      })
      .catch((error: unknown) => {
        process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
        process.exitCode = 1;
      });
  }
}
