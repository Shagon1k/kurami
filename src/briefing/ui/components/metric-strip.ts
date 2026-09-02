import type { BriefingPayload, KuramiNoteTarget } from "../../model.ts";
import { displayString, escapeHtml } from "../html.ts";
import { renderKuramiNote } from "./kurami-note.ts";

export type MetricCard = {
  key: string;
  label: string;
  value: string;
  chip: string;
  context: string;
  warning?: boolean;
  liveClock?: boolean;
};

function numberValue(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatTemperature(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}°`;
}

function formatRefresh(payload: BriefingPayload): string {
  const source = payload.live?.lastSuccessAt ?? payload.live?.refreshedAt ?? payload.edition.generatedAt;
  const date = new Date(source);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: payload.edition.timezone,
  }).format(date);
}

function note(payload: BriefingPayload, target: KuramiNoteTarget): string {
  return renderKuramiNote(payload.notes?.find((item) => item.target === target), "metric-card__note");
}

export function mailMetricCard(payload: BriefingPayload): MetricCard {
  const mailCount = numberValue(payload.mail, "count") ?? payload.mail.items.length;
  return {
    key: "mail",
    label: "Письма",
    value: String(mailCount),
    chip: mailCount === 0 ? "чисто" : "Primary · unread",
    context: mailCount === 0 ? "новых писем нет" : "актуальный входящий список",
  };
}

export function storiesMetricCard(payload: BriefingPayload): MetricCard {
  return {
    key: "stories",
    label: "Сюжеты",
    value: String(payload.news.items.length),
    chip: "срез 09:00",
    context: "новости выпуска не меняются",
  };
}

export function timeMetricCard(payload: BriefingPayload): MetricCard {
  return {
    key: "time",
    label: "Время",
    value: "--:--",
    chip: `обновлено ${formatRefresh(payload)}`,
    context: payload.edition.timezone,
    liveClock: true,
    warning: payload.live?.state === "partial" || payload.live?.state === "stale" || payload.live?.state === "failed",
  };
}

export function weatherMetricCard(payload: BriefingPayload): MetricCard {
  const weather = payload.weather ?? { state: "failed" as const };
  const weatherState = weather.state;
  return {
    key: "weather",
    label: "Погода",
    value: formatTemperature(numberValue(weather, "temperatureC")),
    chip: displayString(weather.condition, weatherState === "ready" ? "сейчас" : "нет данных"),
    context: displayString(
      weather.summary,
      weatherState === "stale" ? "последний успешный прогноз" : displayString(weather.location, "Vilnius"),
    ),
    warning: weatherState !== "ready",
  };
}

export function renderMetricStrip(
  payload: BriefingPayload,
  cards: MetricCard[] = [
    mailMetricCard(payload),
    storiesMetricCard(payload),
    timeMetricCard(payload),
    weatherMetricCard(payload),
  ],
): string {

  return `<section class="metric-strip" aria-label="Коротко о выпуске">${cards.map((card) => {
    const target = `metric:${card.key}` as KuramiNoteTarget;
    return `<article class="metric-card" data-metric="${escapeHtml(card.key)}">
      <span class="metric-card__label">${escapeHtml(card.label)}</span>
      <strong class="metric-card__value"${card.liveClock ? ` data-live-clock data-timezone="${escapeHtml(payload.edition.timezone)}"` : ""}>${escapeHtml(card.value)}</strong>
      <span class="metric-card__chip${card.warning ? " warning" : ""}">${escapeHtml(card.chip)}</span>
      <p class="metric-card__context">${escapeHtml(card.context)}</p>
      ${note(payload, target)}
    </article>`;
  }).join("")}</section>`;
}
