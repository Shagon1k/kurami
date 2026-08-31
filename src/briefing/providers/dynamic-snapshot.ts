import type { ProviderIssue, ProviderState, RetryPolicy } from "./common.ts";
import {
  fetchCalendarSnapshot,
  type CalendarSnapshot,
  type CalendarSource,
} from "./composio-calendar.ts";
import {
  fetchGmailSnapshot,
  type GmailSnapshot,
} from "./composio-gmail.ts";
import type { ComposioToolCaller } from "./composio-mcp.ts";
import {
  fetchOpenMeteo,
  type OpenMeteoLocation,
  type WeatherSnapshot,
} from "./open-meteo.ts";
import type { FetchLike, ProviderResult } from "./common.ts";

export type DynamicBriefingSnapshot = {
  state: ProviderState;
  refreshedAt: string;
  localDate: string;
  gmail: ProviderResult<GmailSnapshot>;
  calendar: ProviderResult<CalendarSnapshot>;
  weather: ProviderResult<WeatherSnapshot>;
  issues: ProviderIssue[];
};

export type DynamicSnapshotOptions = {
  caller: ComposioToolCaller;
  gmailQuery: string;
  calendars: CalendarSource[];
  localDate: string;
  timeZone: string;
  weatherLocation: OpenMeteoLocation;
  fetchImpl?: FetchLike;
  retry?: Partial<RetryPolicy>;
  now?: () => Date;
};

function aggregateState(results: Array<ProviderResult<unknown>>): ProviderState {
  if (results.every((result) => result.state === "failed")) return "failed";
  if (results.some((result) => result.state === "failed" || result.state === "partial")) {
    return "partial";
  }
  if (results.every((result) => result.state === "empty")) return "empty";
  return "ready";
}

/**
 * Collects one edition's dynamic inputs. Open-Meteo runs alongside the MCP
 * work, while Gmail and Calendar remain sequential because the restricted
 * Composio Session declares no parallel tool-call support.
 */
export async function collectDynamicBriefingSnapshot(
  options: DynamicSnapshotOptions,
): Promise<DynamicBriefingSnapshot> {
  const clock = options.now ?? (() => new Date());
  const refreshedAt = clock().toISOString();
  const weatherPromise = fetchOpenMeteo({
    location: options.weatherLocation,
    fetchImpl: options.fetchImpl,
    retry: options.retry,
    now: clock,
  });
  const gmail = await fetchGmailSnapshot(options.caller, {
    query: options.gmailQuery,
    retry: options.retry,
    now: clock,
  });
  const calendar = await fetchCalendarSnapshot(options.caller, {
    localDate: options.localDate,
    timeZone: options.timeZone,
    sources: options.calendars,
    retry: options.retry,
    now: clock,
  });
  const weather = await weatherPromise;
  const results: Array<ProviderResult<unknown>> = [gmail, calendar, weather];
  return {
    state: aggregateState(results),
    refreshedAt,
    localDate: options.localDate,
    gmail,
    calendar,
    weather,
    issues: results.flatMap((result) => result.issues),
  };
}
