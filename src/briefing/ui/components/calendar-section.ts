import type { BriefingPayload } from "../../model.ts";
import { displayString, escapeHtml, records } from "../html.ts";

function eventTime(event: Record<string, unknown>): string {
  const display = displayString(event.displayTime);
  if (display) return display;
  const start = displayString(event.start);
  if (!start) return "—";
  const parsed = new Date(start);
  if (!Number.isFinite(parsed.getTime())) return start;
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Vilnius",
  }).format(parsed);
}

function eventMeta(event: Record<string, unknown>): string {
  return [
    displayString(event.calendarLabel),
    displayString(event.duration),
    displayString(event.location),
  ].filter(Boolean).join(" · ");
}

export function renderCalendarSection(payload: BriefingPayload): string {
  const events = [
    ...records(payload.calendar.events),
    ...records(payload.calendar.demoEvents),
  ];
  const conflicts = records(payload.calendar.conflicts).length;
  const label = events.length
    ? `${events.length} ${events.length === 1 ? "событие" : "события"}`
    : payload.calendar.state === "empty" ? "день свободен" : "нет данных";

  const rows = events.length
    ? events.map((event) => {
      const demo = event.demo === true || displayString(event.sourceLabel).toLowerCase() === "demo";
      return `<article class="agenda-row${demo ? " is-demo" : ""}">
        <time class="agenda-row__time">${escapeHtml(eventTime(event))}</time>
        <div class="agenda-row__copy"><strong>${escapeHtml(displayString(event.title, "Без названия"))}</strong>${eventMeta(event) ? `<span>${escapeHtml(eventMeta(event))}</span>` : ""}</div>
        ${demo ? '<span class="agenda-row__demo">DEMO</span>' : ""}
      </article>`;
    }).join("")
    : `<div class="section-empty"><strong>${payload.calendar.state === "empty" ? "На сегодня событий нет" : "Календарь пока недоступен"}</strong><span>${payload.calendar.state === "empty" ? "Можно оставить день свободным." : "Секция обновится после следующего успешного чтения."}</span></div>`;

  return `<section class="briefing-panel briefing-panel--calendar" aria-labelledby="calendar-heading">
    <header class="briefing-panel__header"><div><p class="section-kicker">Три календаря</p><h2 id="calendar-heading">Сегодня</h2></div><span>${escapeHtml(conflicts ? `${conflicts} конфликт` : label)}</span></header>
    <div class="agenda-list">${rows}</div>
  </section>`;
}
