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
  parseBriefingPayload,
  type BriefingPayload,
  type MailItem,
  type SectionState,
} from "./model.ts";
import { renderBriefingPage } from "./ui/render-page.ts";
import {
  composioReadConnectionFromEnvironment,
  createComposioReadToolCaller,
} from "./providers/composio-mcp.ts";
import {
  fetchGmailSnapshot,
  type GmailSnapshot,
  type NormalizedGmailMessage,
} from "./providers/composio-gmail.ts";
import {
  fetchCalendarSnapshot,
  partitionCalendarItemsByLocalDate,
  type CalendarSnapshot,
  type NormalizedCalendarEvent,
} from "./providers/composio-calendar.ts";
import { fetchOpenMeteo, type WeatherSnapshot } from "./providers/open-meteo.ts";
import {
  providerIssue,
  type FetchLike,
  type ProviderResult,
  type ProviderState,
} from "./providers/common.ts";
import { loadBriefingRuntimeConfig } from "./runtime-config.ts";

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

function durationLabel(event: NormalizedCalendarEvent): string {
  if (event.allDay) return "Весь день";
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "";
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}ч ${remainder}м` : `${hours}ч`;
}

function calendarEvent(value: NormalizedCalendarEvent): Record<string, unknown> {
  return {
    id: value.id,
    provider: value.provider,
    providerItemId: value.providerItemId,
    sourceKey: value.sourceKey,
    calendarLabel: value.sourceLabel,
    calendarRole: value.sourceRole,
    title: value.title,
    description: value.description,
    location: value.location,
    start: value.start,
    end: value.end,
    allDay: value.allDay,
    tentative: value.tentative,
    responseStatus: value.responseStatus,
    duration: durationLabel(value),
    ...(value.externalUrl ? { externalUrl: value.externalUrl } : {}),
  };
}

function calendarConflicts(items: NormalizedCalendarEvent[]): Array<Record<string, unknown>> {
  const timed = items.filter((item) => !item.allDay)
    .map((item) => ({ item, start: Date.parse(item.start), end: Date.parse(item.end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
    .sort((left, right) => left.start - right.start);
  const conflicts: Array<Record<string, unknown>> = [];
  for (let left = 0; left < timed.length; left += 1) {
    for (let right = left + 1; right < timed.length && timed[right]!.start < timed[left]!.end; right += 1) {
      conflicts.push({ firstId: timed[left]!.item.id, secondId: timed[right]!.item.id });
    }
  }
  return conflicts;
}

function classifyMail(item: NormalizedGmailMessage): "ACTION" | "IMPORTANT" | "GENERAL" {
  if (item.classification === "IMPORTANT") return "IMPORTANT";
  const signal = `${item.title} ${item.summary}`.toLocaleLowerCase("ru");
  return /\b(?:action|required|deadline|confirm|approval|approve|respond|reply|payment|invoice|trial)\b|(?:нужно|требуется|подтверд|ответить|оплат|срок|заканчивается)/iu.test(signal)
    ? "ACTION"
    : "GENERAL";
}

function mailItem(item: NormalizedGmailMessage): MailItem {
  return {
    id: item.id,
    provider: "gmail",
    providerItemId: item.providerItemId,
    threadId: item.threadId,
    class: classifyMail(item),
    subject: item.title,
    sender: item.sender,
    summary: item.summary,
    receivedAt: item.receivedAt,
    ...(item.externalUrl ? { externalUrl: item.externalUrl } : {}),
  };
}

function weatherValue(snapshot: WeatherSnapshot, state: SectionState): BriefingPayload["weather"] {
  const high = snapshot.maximumCelsius === null ? "" : `до ${Math.round(snapshot.maximumCelsius)}°`;
  const precipitation = snapshot.precipitationProbabilityPercent === null
    ? ""
    : `осадки ${snapshot.precipitationProbabilityPercent}%`;
  return {
    state,
    provider: snapshot.provider,
    location: snapshot.location,
    observedAt: snapshot.observedAt,
    temperatureC: snapshot.temperatureCelsius,
    feelsLikeC: snapshot.apparentTemperatureCelsius,
    condition: `${snapshot.condition.emoji} ${snapshot.condition.label}`,
    summary: [high, precipitation].filter(Boolean).join(" · ") || snapshot.location,
  };
}

function sectionState(value: ProviderState): SectionState {
  return value;
}

function providerComplete<T>(result: ProviderResult<T>): result is ProviderResult<T> & { value: T } {
  return result.value !== null && (result.state === "ready" || result.state === "empty");
}

function failedProviderResult<T>(
  error: unknown,
  fetchedAt: string,
  fallbackCode: string,
): ProviderResult<T> {
  return {
    state: "failed",
    value: null,
    fetchedAt,
    attempts: 0,
    issues: [providerIssue(error, fallbackCode)],
  };
}

function updatePayload(
  original: BriefingPayload,
  refreshedAt: string,
  gmail: Awaited<ReturnType<typeof fetchGmailSnapshot>>,
  calendar: Awaited<ReturnType<typeof fetchCalendarSnapshot>>,
  calendarItems: NormalizedCalendarEvent[] | null,
  weather: Awaited<ReturnType<typeof fetchOpenMeteo>>,
): BriefingPayload {
  const next = structuredClone(original);
  const states = [gmail.state, calendar.state, weather.state];
  const anyFailure = states.some((state) => state === "failed" || state === "partial");
  next.live = {
    refreshedAt,
    state: anyFailure ? "partial" : "ready",
    ...(anyFailure && original.live?.lastSuccessAt
      ? { lastSuccessAt: original.live.lastSuccessAt }
      : { lastSuccessAt: refreshedAt }),
  };
  if (providerComplete(gmail)) {
    next.mail = {
      ...next.mail,
      state: sectionState(gmail.state),
      count: gmail.value.unreadCount,
      fetchedAt: gmail.fetchedAt,
      items: gmail.value.items.map(mailItem),
    } as BriefingPayload["mail"];
  } else {
    next.mail = { ...next.mail, state: "stale", staleAt: refreshedAt };
  }
  if (providerComplete(calendar) && calendarItems !== null) {
    next.calendar = {
      ...next.calendar,
      state: calendar.state === "partial" ? "partial" : calendarItems.length ? "ready" : "empty",
      fetchedAt: calendar.fetchedAt,
      allDayEvents: calendarItems.filter((item) => item.allDay).map(calendarEvent),
      events: calendarItems.filter((item) => !item.allDay).map(calendarEvent),
      conflicts: calendarConflicts(calendarItems),
      sources: calendar.value.sources,
    } as BriefingPayload["calendar"];
  } else if (!providerComplete(calendar)) {
    next.calendar = { ...next.calendar, state: "stale", staleAt: refreshedAt };
  }
  if (providerComplete(weather)) next.weather = weatherValue(weather.value, sectionState(weather.state));
  else if (next.weather) next.weather = { ...next.weather, state: "stale", staleAt: refreshedAt };
  else next.weather = { state: "failed", location: "Vilnius", summary: "Прогноз временно недоступен" };
  return parseBriefingPayload(next);
}

export async function runDigestCentralPoller(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: DigestCentralPollerDependencies = {},
): Promise<PollerResult> {
  const paths = briefingPaths(environment);
  await initializeBriefingStore(paths);
  const config = await loadBriefingRuntimeConfig(paths, environment);
  const refreshedAt = new Date().toISOString();
  const before = openBriefingDatabase(paths);
  let retained: EditionRow[];
  try {
    retained = retainedDailyEditions(before, refreshedAt);
  } finally {
    before.close();
  }
  if (retained.length === 0) {
    const cleanup = await cleanupExpired(refreshedAt, paths);
    return {
      refreshedAt,
      editions: [],
      providers: { gmail: "empty", calendar: "empty", weather: "empty" },
      deleted: cleanup.deleted,
    };
  }
  const retry = { attempts: 3, timeoutMs: 12_000, initialDelayMs: 300, maximumDelayMs: 2_000 };
  const weatherPromise = fetchOpenMeteo({
    location: config.weatherLocation,
    fetchImpl: dependencies.weatherFetch,
    retry,
  });
  const oldest = retained[0]!.local_date;
  const newest = retained.at(-1)!.local_date;
  let gmail: ProviderResult<GmailSnapshot>;
  let calendar: ProviderResult<CalendarSnapshot>;
  try {
    const caller = createComposioReadToolCaller(composioReadConnectionFromEnvironment(environment));
    gmail = await fetchGmailSnapshot(caller, {
      query: config.gmailQuery,
      pageSize: config.gmailPageSize,
      maximumPages: 20,
      retry,
    });
    calendar = await fetchCalendarSnapshot(caller, {
      localDate: oldest,
      endLocalDateExclusive: nextLocalDate(newest),
      timeZone: config.timeZone,
      sources: config.calendars,
      pageSize: 250,
      maximumPagesPerSource: 10,
      retry,
    });
  } catch (error) {
    gmail = failedProviderResult(error, refreshedAt, "gmail_connection_unavailable");
    calendar = failedProviderResult(error, refreshedAt, "calendar_connection_unavailable");
  }
  const weather = await weatherPromise;
  const partitions = providerComplete(calendar)
    ? partitionCalendarItemsByLocalDate(calendar.value.items, config.timeZone)
    : new Map<string, NormalizedCalendarEvent[]>();
  const editions: PollerResult["editions"] = [];
  for (const row of retained) {
    try {
      const original = parseBriefingPayload(JSON.parse(row.payload_json) as unknown);
      const payload = updatePayload(
        original,
        refreshedAt,
        gmail,
        calendar,
        providerComplete(calendar) ? partitions.get(row.local_date) ?? [] : null,
        weather,
      );
      await refreshPublishedEdition(payload, renderBriefingPage(payload), row.content_digest, paths);
      editions.push({ id: row.id, state: "updated" });
    } catch (error) {
      editions.push({
        id: row.id,
        state: "skipped",
        reason: error instanceof Error ? error.message.slice(0, 180) : "Refresh failed",
      });
    }
  }
  const cleanup = await cleanupExpired(refreshedAt, paths);
  return {
    refreshedAt,
    editions,
    providers: { gmail: gmail.state, calendar: calendar.state, weather: weather.state },
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
