import { section, setSection } from "../envelopes.ts";
import { fetchCalendarSnapshot, partitionCalendarItemsByLocalDate, type NormalizedCalendarEvent } from "../../providers/composio-calendar.ts";
import { requireCaller, type LiveAddon } from "../live-contract.ts";
import { providerComplete } from "../provider-state.ts";
import { nextLocalDate } from "../../dates.ts";

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

export function calendarEvent(value: NormalizedCalendarEvent): Record<string, unknown> {
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
    status: value.status,
    duration: durationLabel(value),
    ...(value.externalUrl ? { externalUrl: value.externalUrl } : {}),
  };
}

export function calendarConflicts(items: NormalizedCalendarEvent[]): Array<Record<string, unknown>> {
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


export const calendarLifecycle: LiveAddon = {
  id: "calendar", providerKey: "calendar", lane: "mcp",
  collect: context => fetchCalendarSnapshot(requireCaller(context), {
    localDate: context.localDate, endLocalDateExclusive: context.includeTomorrow
      ? nextLocalDate(context.endLocalDateExclusive ?? nextLocalDate(context.localDate)) : context.endLocalDateExclusive,
    timeZone: context.timeZone, sources: context.calendars,
    pageSize: 250, maximumPagesPerSource: 10, retry: context.retry, now: context.now,
  }),
  apply(payload, results, context) {
    const result = results.calendar;
    if (providerComplete(result)) {
      const items = context.calendarItems === undefined
        ? partitionCalendarItemsByLocalDate(result.value.items, payload.edition.timezone).get(payload.edition.localDate) ?? []
        : context.calendarItems;
      if (items === null) return;
      const { staleAt: _staleAt, tomorrow: _tomorrow, ...prior } = section(payload, "calendar");
      const tomorrowDate = nextLocalDate(payload.edition.localDate);
      const tomorrowItems = partitionCalendarItemsByLocalDate(result.value.items,payload.edition.timezone).get(tomorrowDate) ?? [];
      const tomorrow = result.value.localDateEndExclusive > tomorrowDate ? {
        localDate: tomorrowDate, state: tomorrowItems.length ? "ready" : "empty",
        events: tomorrowItems.map(calendarEvent),
      } : undefined;
      setSection(payload, "calendar", { ...prior, state: items.length ? "ready" : "empty", fetchedAt: result.fetchedAt,
        allDayEvents: items.filter(item => item.allDay).map(calendarEvent),
        events: items.filter(item => !item.allDay).map(calendarEvent),
        conflicts: calendarConflicts(items), sources: result.value.sources, ...(tomorrow ? { tomorrow } : {}) });
    } else if (context.initial) {
      setSection(payload, "calendar", { state: "failed", events: [], allDayEvents: [], conflicts: [] });
    } else {
      setSection(payload, "calendar", { ...section(payload, "calendar"), state: "stale", staleAt: context.refreshedAt });
    }
    const ids = new Set(["events", "allDayEvents", "demoEvents"].flatMap(key =>
      Array.isArray(section(payload, "calendar")[key]) ? (section(payload, "calendar")[key] as Array<{ id: string }>).map(item => item.id) : []));
    payload.notes = payload.notes?.filter(note => !note.target.startsWith("calendar-event:") || ids.has(note.target.slice(15)));
    if (payload.notes?.length === 0) delete payload.notes;
  },
};
