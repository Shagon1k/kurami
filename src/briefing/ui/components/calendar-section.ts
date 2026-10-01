import { section } from "../../addons/envelopes.ts";
import type { BriefingPayload } from "../../model.ts";
import { displayString, escapeHtml, externalUrl, records } from "../html.ts";
import { renderKuramiNote } from "./kurami-note.ts";
import {digestLanguage,digestText} from "../../i18n.ts";

function eventTime(event: Record<string, unknown>): string {
  if (event.allDay === true) return digestText("Весь день","All day");
  const display = displayString(event.displayTime);
  if (display) return display;
  const start = displayString(event.start);
  if (!start) return "—";
  const parsed = new Date(start);
  if (!Number.isFinite(parsed.getTime())) return start;
  return new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Vilnius",
  }).format(parsed);
}

function mapsUrl(event: Record<string, unknown>, location: string): string | null {
  const provided = externalUrl(event.locationUrl);
  if (provided) return provided;
  if (!location) return null;
  if (/\b(?:microsoft\s+teams|zoom|google\s+meet|webex|online)\b|https?:\/\//iu.test(location)) {
    return null;
  }
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", location);
  return url.toString();
}

function eventCountLabel(count: number): string {
  if(digestLanguage()==="en")return `${count} ${count===1?"event":"events"}`;
  const mod10 = count % 10;
  const mod100 = count % 100;
  const noun = mod10 === 1 && mod100 !== 11
    ? "событие"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? "события"
      : "событий";
  return `${count} ${noun}`;
}

export function renderCalendarSection(payload: BriefingPayload): string {
  const events = [
    ...records(section(payload, "calendar").allDayEvents),
    ...records(section(payload, "calendar").events),
    ...records(section(payload, "calendar").demoEvents),
  ];
  const conflicts = records(section(payload, "calendar").conflicts).length;
  const label = events.length
    ? eventCountLabel(events.length)
    : section(payload, "calendar").state === "empty" ? digestText("день свободен","day free") : digestText("нет данных","no data");

  const rows = events.length
    ? events.map((event) => {
      const eventId = displayString(event.id);
      const eventNote = eventId
        ? payload.notes?.find((note) => note.target === `calendar-event:${eventId}`)
        : undefined;
      const demo = event.demo === true || displayString(event.sourceLabel).toLowerCase() === "demo";
      const tentative = event.tentative === true || displayString(event.responseStatus).toLowerCase() === "tentative";
      const location = displayString(event.location);
      const locationUrl = mapsUrl(event, location);
      const meta = [displayString(event.calendarLabel), displayString(event.duration)].filter(Boolean).join(" · ");
      const description = displayString(event.description);
      const renderedLocation = location
        ? locationUrl
          ? `<a class="agenda-row__location" href="${escapeHtml(locationUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(location)} ↗</a>`
          : `<span class="agenda-row__location">${escapeHtml(location)}</span>`
        : "";
      return `<article class="agenda-row${demo ? " is-demo" : ""}">
        <time class="agenda-row__time">${escapeHtml(eventTime(event))}</time>
        <div class="agenda-row__copy"><strong>${escapeHtml(displayString(event.title, digestText("Без названия","Untitled")))}</strong>${meta ? `<span>${escapeHtml(meta)}</span>` : ""}${renderedLocation}${description ? `<p>${escapeHtml(description)}</p>` : ""}${renderKuramiNote(eventNote, "agenda-row__note")}</div>
        <div class="agenda-row__badges">${tentative ? '<span class="agenda-row__badge">TENTATIVE</span>' : ""}${demo ? '<span class="agenda-row__badge is-demo">DEMO</span>' : ""}</div>
      </article>`;
    }).join("")
    : `<div class="section-empty"><strong>${section(payload, "calendar").state === "empty" ? digestText("На сегодня событий нет","No events today") : digestText("Календарь пока недоступен","Calendar unavailable")}</strong><span>${section(payload, "calendar").state === "empty" ? digestText("Можно оставить день свободным.","Your day is free.") : digestText("Секция обновится после следующего успешного чтения.","This section will update after the next successful refresh.")}</span></div>`;

  const sectionNote = payload.notes?.find((note) => note.target === "calendar");
  return `<section class="briefing-panel briefing-panel--calendar" aria-labelledby="calendar-heading">
    ${renderKuramiNote(sectionNote, "briefing-panel__note")}
    <header class="briefing-panel__header"><div><p class="section-kicker">${digestText("Три календаря","Three calendars")}</p><h2 id="calendar-heading">${digestText("Расписание","Schedule")}</h2></div><span>${escapeHtml(conflicts ? `${conflicts} ${digestText("конфликт","conflict")}` : label)}</span></header>
    <div class="agenda-list briefing-panel__scroll"${events.length > 4 ? ` data-overflow="true" role="region" tabindex="0" aria-label="${digestText("Все события на сегодня","All events today")}"` : ""}>${rows}</div>
  </section>`;
}
