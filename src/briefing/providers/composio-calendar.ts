import { createHash } from "node:crypto";
import {
  ProviderError,
  providerIssue,
  retryOperation,
  type ProviderIssue,
  type ProviderResult,
  type RetryPolicy,
} from "./common.ts";
import {
  extractComposioPayload,
  type ComposioToolCaller,
} from "./composio-mcp.ts";

type JsonRecord = Record<string, unknown>;

export type CalendarSource = {
  key: string;
  id: string;
  label: string;
  role: string;
};

export type NormalizedCalendarEvent = {
  id: string;
  provider: "google-calendar";
  providerItemId: string;
  sourceKey: string;
  sourceLabel: string;
  sourceRole: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  tentative: boolean;
  status: string;
  responseStatus: string | null;
  timeZone: string;
  externalUrl: string | null;
};

export type CalendarSourceStatus = {
  key: string;
  label: string;
  state: "ready" | "empty" | "partial" | "failed";
  itemCount: number;
  pageCount: number;
};

export type CalendarSnapshot = {
  localDate: string;
  localDateEndExclusive: string;
  timeZone: string;
  timeMin: string;
  timeMax: string;
  items: NormalizedCalendarEvent[];
  sources: CalendarSourceStatus[];
};

export type CalendarFetchOptions = {
  localDate: string;
  endLocalDateExclusive?: string;
  timeZone: string;
  sources: CalendarSource[];
  pageSize?: number;
  maximumPagesPerSource?: number;
  retry?: Partial<RetryPolicy>;
  now?: () => Date;
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedPlainText(value: unknown, maximum: number): string {
  const plain = text(value).replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
  return plain.length <= maximum
    ? plain
    : `${plain.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function datePartsInZone(instant: Date, timeZone: string): Record<string, number> {
  const values: Record<string, number> = {};
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return values;
}

function offsetAt(instant: Date, timeZone: string): number {
  const parts = datePartsInZone(instant, timeZone);
  const equivalentUtc = Date.UTC(
    parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!,
  );
  return equivalentUtc - instant.getTime();
}

function midnightInstant(localDate: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(localDate);
  if (!match) throw new ProviderError("calendar_invalid_date", "Calendar date must use YYYY-MM-DD");
  const wallClockUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  let instant = new Date(wallClockUtc);
  for (let index = 0; index < 4; index += 1) {
    const next = new Date(wallClockUtc - offsetAt(instant, timeZone));
    if (next.getTime() === instant.getTime()) break;
    instant = next;
  }
  return instant;
}

function nextDate(localDate: string): string {
  const instant = new Date(`${localDate}T12:00:00Z`);
  if (Number.isNaN(instant.getTime())) {
    throw new ProviderError("calendar_invalid_date", "Calendar date must use YYYY-MM-DD");
  }
  return new Date(instant.getTime() + 86_400_000).toISOString().slice(0, 10);
}

function offsetText(offsetMilliseconds: number): string {
  const totalMinutes = Math.round(offsetMilliseconds / 60_000);
  const sign = totalMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(totalMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function zonedDayBounds(
  localDate: string,
  timeZone: string,
): { timeMin: string; timeMax: string } {
  return zonedDateRangeBounds(localDate, nextDate(localDate), timeZone);
}

export function zonedDateRangeBounds(
  startLocalDate: string,
  endLocalDateExclusive: string,
  timeZone: string,
): { timeMin: string; timeMax: string } {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
  } catch {
    throw new ProviderError("calendar_invalid_timezone", "Calendar timezone is invalid");
  }
  if (endLocalDateExclusive <= startLocalDate) {
    throw new ProviderError("calendar_invalid_range", "Calendar date range must be increasing");
  }
  const start = midnightInstant(startLocalDate, timeZone);
  const end = midnightInstant(endLocalDateExclusive, timeZone);
  return {
    timeMin: `${startLocalDate}T00:00:00${offsetText(offsetAt(start, timeZone))}`,
    timeMax: `${endLocalDateExclusive}T00:00:00${offsetText(offsetAt(end, timeZone))}`,
  };
}

export function calendarEventLocalDate(
  event: NormalizedCalendarEvent,
  timeZone: string,
): string {
  if (event.allDay) return event.start.slice(0, 10);
  const instant = new Date(event.start);
  if (Number.isNaN(instant.getTime())) {
    throw new ProviderError("calendar_invalid_timestamp", "Calendar event timestamp is invalid");
  }
  const parts = datePartsInZone(instant, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function partitionCalendarItemsByLocalDate(
  items: NormalizedCalendarEvent[],
  timeZone: string,
): Map<string, NormalizedCalendarEvent[]> {
  const partitions = new Map<string, NormalizedCalendarEvent[]>();
  for (const event of items) {
    const date = calendarEventLocalDate(event, timeZone);
    const partition = partitions.get(date) ?? [];
    partition.push(event);
    partitions.set(date, partition);
  }
  return partitions;
}

function safeUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function eventBoundary(value: unknown): { value: string; allDay: boolean; timeZone: string } | null {
  if (!isRecord(value)) return null;
  const dateTime = text(value.dateTime ?? value.date_time);
  if (dateTime) {
    const parsed = new Date(dateTime);
    if (Number.isNaN(parsed.getTime())) return null;
    return { value: parsed.toISOString(), allDay: false, timeZone: text(value.timeZone) };
  }
  const date = text(value.date);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  return { value: date, allDay: true, timeZone: text(value.timeZone) };
}

function selfResponseStatus(event: JsonRecord): string | null {
  if (!Array.isArray(event.attendees)) return null;
  const attendee = event.attendees.find((entry) => isRecord(entry) && entry.self === true);
  return isRecord(attendee) ? text(attendee.responseStatus ?? attendee.response_status) || null : null;
}

function originalStartIdentity(event: JsonRecord, fallback: string): string {
  const original = event.originalStartTime ?? event.original_start_time;
  if (!isRecord(original)) return fallback;
  return text(original.dateTime ?? original.date) || fallback;
}

function normalizeEvent(
  value: unknown,
  source: CalendarSource,
  fallbackTimeZone: string,
): NormalizedCalendarEvent | null {
  if (!isRecord(value)) return null;
  const status = text(value.status).toLowerCase() || "confirmed";
  if (status === "cancelled") return null;
  const responseStatus = selfResponseStatus(value);
  if (responseStatus?.toLowerCase() === "declined") return null;
  const providerId = text(value.id);
  const start = eventBoundary(value.start);
  const end = eventBoundary(value.end);
  if (!providerId || !start || !end) return null;
  const occurrence = originalStartIdentity(value, start.value);
  const providerItemId = `${source.key}:${providerId}:${occurrence}`;
  return {
    id: `calendar_${createHash("sha256").update(providerItemId).digest("hex").slice(0, 20)}`,
    provider: "google-calendar",
    providerItemId,
    sourceKey: source.key,
    sourceLabel: source.label,
    sourceRole: source.role,
    title: boundedPlainText(value.summary, 220) || "Без названия",
    description: boundedPlainText(value.description, 500),
    location: boundedPlainText(value.location, 240),
    start: start.value,
    end: end.value,
    allDay: start.allDay,
    tentative: status === "tentative" || responseStatus?.toLowerCase() === "tentative",
    status,
    responseStatus,
    timeZone: start.timeZone || fallbackTimeZone,
    externalUrl: safeUrl(value.htmlLink ?? value.html_link),
  };
}

function unwrapEnvelope(value: unknown): { items: unknown[]; nextPageToken: string } {
  const payload = extractComposioPayload(value);
  if (!isRecord(payload)) {
    throw new ProviderError("calendar_invalid_response", "Calendar provider returned an invalid response");
  }
  if (payload.successful === false) {
    throw new ProviderError("calendar_provider_error", "Calendar provider rejected the read request", true);
  }
  const data = isRecord(payload.data) ? payload.data : payload;
  if (data.items !== undefined && !Array.isArray(data.items)) {
    throw new ProviderError("calendar_invalid_items", "Calendar provider returned an invalid event list");
  }
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextPageToken: text(data.nextPageToken ?? data.next_page_token),
  };
}

type SourceResult = {
  state: CalendarSourceStatus["state"];
  items: NormalizedCalendarEvent[];
  pageCount: number;
  attempts: number;
  issues: ProviderIssue[];
};

async function fetchSource(
  caller: ComposioToolCaller,
  source: CalendarSource,
  timeMin: string,
  timeMax: string,
  timeZone: string,
  options: CalendarFetchOptions,
): Promise<SourceResult> {
  const pageSize = Math.min(2500, Math.max(1, Math.trunc(options.pageSize ?? 100)));
  const maximumPages = Math.min(50, Math.max(1, Math.trunc(options.maximumPagesPerSource ?? 10)));
  const items = new Map<string, NormalizedCalendarEvent>();
  const seenTokens = new Set<string>();
  const issues: ProviderIssue[] = [];
  let token = "";
  let pageCount = 0;
  let attempts = 0;
  let exhausted = false;
  while (pageCount < maximumPages) {
    const arguments_: Record<string, unknown> = {
      calendarId: source.id,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: pageSize,
    };
    if (token) arguments_.pageToken = token;
    const page = await retryOperation(
      (signal) => caller("GOOGLECALENDAR_EVENTS_LIST", arguments_, signal).then(unwrapEnvelope),
      options.retry,
    );
    attempts += page.attempts;
    if (!page.ok) {
      issues.push({ ...page.issue, message: `${source.label}: ${page.issue.message}` });
      break;
    }
    pageCount += 1;
    for (const raw of page.value.items) {
      try {
        const event = normalizeEvent(raw, source, timeZone);
        if (event) items.set(event.providerItemId, event);
      } catch (error) {
        const issue = providerIssue(error, "calendar_normalization_error");
        issues.push({ ...issue, message: `${source.label}: ${issue.message}` });
      }
    }
    const next = page.value.nextPageToken;
    if (!next) {
      exhausted = true;
      break;
    }
    if (seenTokens.has(next) || next === token) {
      issues.push({
        code: "calendar_pagination_loop",
        message: `${source.label}: provider returned a repeated cursor`,
        transient: false,
      });
      break;
    }
    seenTokens.add(next);
    token = next;
  }
  if (!exhausted && pageCount >= maximumPages) {
    issues.push({
      code: "calendar_page_limit",
      message: `${source.label}: pagination reached its configured safety limit`,
      transient: false,
    });
  }
  const normalized = [...items.values()];
  const state = pageCount === 0 && issues.length > 0
    ? "failed"
    : issues.length > 0
      ? "partial"
      : normalized.length === 0
        ? "empty"
        : "ready";
  return { state, items: normalized, pageCount, attempts, issues };
}

export async function fetchCalendarSnapshot(
  caller: ComposioToolCaller,
  options: CalendarFetchOptions,
): Promise<ProviderResult<CalendarSnapshot>> {
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  let localDateEndExclusive: string;
  let bounds: { timeMin: string; timeMax: string };
  let sources: CalendarSource[];
  try {
    localDateEndExclusive = options.endLocalDateExclusive ?? nextDate(options.localDate);
    bounds = zonedDateRangeBounds(
      options.localDate,
      localDateEndExclusive,
      options.timeZone,
    );
    sources = options.sources.filter((source) =>
      Boolean(source.key.trim() && source.id.trim() && source.label.trim()));
    if (sources.length !== options.sources.length || sources.length === 0) {
      throw new ProviderError(
        "calendar_sources_invalid",
        "Every configured calendar requires a key, provider ID, and label",
      );
    }
    if (new Set(sources.map((source) => source.key)).size !== sources.length) {
      throw new ProviderError("calendar_source_key_duplicate", "Calendar source keys must be unique");
    }
  } catch (error) {
    return {
      state: "failed",
      value: null,
      fetchedAt,
      attempts: 0,
      issues: [providerIssue(error, "calendar_configuration_error")],
    };
  }
  const items = new Map<string, NormalizedCalendarEvent>();
  const statuses: CalendarSourceStatus[] = [];
  const issues: ProviderIssue[] = [];
  let attempts = 0;
  for (const source of sources) {
    // Composio read Sessions do not advertise parallel tool calls.
    const sourceResult = await fetchSource(
      caller, source, bounds.timeMin, bounds.timeMax, options.timeZone, options,
    );
    attempts += sourceResult.attempts;
    issues.push(...sourceResult.issues);
    for (const item of sourceResult.items) items.set(item.providerItemId, item);
    statuses.push({
      key: source.key,
      label: source.label,
      state: sourceResult.state,
      itemCount: sourceResult.items.length,
      pageCount: sourceResult.pageCount,
    });
  }
  const normalizedItems = [...items.values()].sort((left, right) =>
    left.start.localeCompare(right.start) || left.title.localeCompare(right.title));
  const snapshot: CalendarSnapshot = {
    localDate: options.localDate,
    localDateEndExclusive,
    timeZone: options.timeZone,
    timeMin: bounds.timeMin,
    timeMax: bounds.timeMax,
    items: normalizedItems,
    sources: statuses,
  };
  if (statuses.every((source) => source.state === "failed")) {
    return { state: "failed", value: null, fetchedAt, attempts, issues };
  }
  if (statuses.some((source) => source.state === "partial" || source.state === "failed")) {
    return { state: "partial", value: snapshot, fetchedAt, attempts, issues };
  }
  return {
    state: normalizedItems.length === 0 ? "empty" : "ready",
    value: snapshot,
    fetchedAt,
    attempts,
    issues,
  };
}
