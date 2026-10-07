import type { BriefingPayload, MailClass } from "../model.ts";
import type { CalendarSnapshot, CalendarSource, NormalizedCalendarEvent } from "../providers/composio-calendar.ts";
import type { GmailSnapshot } from "../providers/composio-gmail.ts";
import type { ComposioToolCaller } from "../providers/composio-mcp.ts";
import type { OpenMeteoLocation, WeatherSnapshot } from "../providers/open-meteo.ts";
import type { FetchLike, ProviderResult, RetryPolicy } from "../providers/common.ts";

export type LiveAddonId = "mail" | "calendar" | "weather";
export type BuiltinAddonId = LiveAddonId | "news";
export type AddonSwitches = Partial<Record<BuiltinAddonId, boolean>>;
export type LiveResults = {
  gmail: ProviderResult<GmailSnapshot>;
  calendar: ProviderResult<CalendarSnapshot>;
  weather: ProviderResult<WeatherSnapshot>;
};
export type LiveCollectionContext = {
  caller?: ComposioToolCaller;
  getCaller?: () => ComposioToolCaller;
  gmailQuery: string;
  gmailPageSize?: number;
  calendars: CalendarSource[];
  localDate: string;
  endLocalDateExclusive?: string;
  includeTomorrow?: boolean;
  timeZone: string;
  weatherLocation: OpenMeteoLocation;
  fetchImpl?: FetchLike;
  retry?: Partial<RetryPolicy>;
  now?: () => Date;
  enabled?: AddonSwitches;
};
export function requireCaller(context: LiveCollectionContext): ComposioToolCaller {
  const caller = context.caller ?? context.getCaller?.();
  if (!caller) throw new Error("Composio read connection is unavailable");
  return caller;
}
export type LiveApplyContext = {
  refreshedAt: string;
  enabled?: AddonSwitches;
  initial?: boolean;
  classifications?: Record<string, MailClass>;
  /** Owner rules by sender address (mail-learning.ts). */
  senderRules?: Record<string, MailClass>;
  calendarItems?: NormalizedCalendarEvent[] | null;
};
export type LiveAddon = {
  id: LiveAddonId;
  providerKey: keyof LiveResults;
  lane: "mcp" | "http";
  collect(context: LiveCollectionContext): Promise<ProviderResult<unknown>>;
  apply(payload: BriefingPayload, results: LiveResults, context: LiveApplyContext): void;
};
