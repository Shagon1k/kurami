import {surfaceAttributes} from "../../../ui-library/components/surface.ts";
import { section } from "../../addons/envelopes.ts";
import type { BriefingPayload, KuramiNoteTarget } from "../../model.ts";
import { displayString, escapeHtml } from "../html.ts";
import { renderKuramiNote } from "./kurami-note.ts";
import {digestLanguage,digestText} from "../../i18n.ts";
import {renderIcon,type IconName} from "../../../ui-library/components/icon.ts";

const weatherTerms:Record<string,string>={"Ясно":"Clear","Преимущественно ясно":"Mostly clear","Переменная облачность":"Partly cloudy","Пасмурно":"Overcast","Туман":"Fog","Морось":"Drizzle","Дождь":"Rain","Снег":"Snow","Ливни":"Showers","Снегопад":"Snowfall","Гроза":"Thunderstorm","Неизвестные условия":"Unknown conditions"};
function englishWeather(value:string):string {
  if(digestLanguage()==="ru")return value;
  let result=value;
  for(const [ru,en] of Object.entries(weatherTerms))result=result.replace(ru,en);
  return result.replace(/до\s+(-?\d+)°/gu,"high $1°").replace(/осадки\s+(\d+)%/gu,"precipitation $1%").replace("Прогноз временно недоступен","Forecast temporarily unavailable");
}

export type MetricCard = {
  key: string;
  label: string;
  value: string;
  segments?: Array<{icon:IconName;value:number;label:string}>;
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
  const mailCount = numberValue(section(payload, "mail"), "count") ?? section(payload, "mail").items.length;
  return {
    key: "mail",
    label: digestText("Письма","Mail"),
    value: String(mailCount),
    chip: mailCount === 0 ? digestText("чисто","clear") : "Primary · unread",
    context: mailCount === 0 ? digestText("новых писем нет","no new mail") : digestText("актуальный входящий список","current inbox"),
  };
}

export function storiesMetricCard(payload: BriefingPayload): MetricCard {
  return {
    key: "stories",
    label: digestText("Сюжеты","Stories"),
    value: String(section(payload, "news").items.length),
    chip: digestText("срез 09:00","09:00 snapshot"),
    context: digestText("новости выпуска не меняются","edition news is frozen"),
  };
}

export function timeMetricCard(payload: BriefingPayload): MetricCard {
  return {
    key: "time",
    label: digestText("Время","Time"),
    value: "--:--",
    chip: `${digestText("обновлено","updated")} ${formatRefresh(payload)}`,
    context: payload.edition.timezone,
    liveClock: true,
    warning: payload.live?.state === "partial" || payload.live?.state === "stale" || payload.live?.state === "failed",
  };
}

export function weatherMetricCard(payload: BriefingPayload): MetricCard {
  const weather = section(payload, "weather") ?? { state: "failed" as const };
  const weatherState = weather.state;
  return {
    key: "weather",
    label: digestText("Погода","Weather"),
    value: formatTemperature(numberValue(weather, "temperatureC")),
    chip: englishWeather(displayString(weather.condition, weatherState === "ready" ? digestText("сейчас","now") : digestText("нет данных","no data"))),
    context: englishWeather(displayString(
      weather.summary,
      weatherState === "stale" ? digestText("последний успешный прогноз","last successful forecast") : displayString(weather.location, "Vilnius"),
    )),
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
  return renderMetricCards(cards,payload.edition.timezone,key=>note(payload,`metric:${key}` as KuramiNoteTarget));
}
export function renderMetricCards(cards:MetricCard[],timezone:string,renderNote:(key:string)=>string=()=>""):string {
  return `<section class="metric-strip"${surfaceAttributes("panel")} aria-label="${digestText("Коротко о выпуске","Edition at a glance")}">${cards.map((card) => {
    return `<article class="metric-card" data-metric="${escapeHtml(card.key)}">
      <span class="metric-card__label">${escapeHtml(card.label)}</span>
      <strong class="metric-card__value${card.segments?" metric-card__value--segments":""}"${card.liveClock ? ` data-live-clock data-timezone="${escapeHtml(timezone)}"` : ""}>${card.segments?card.segments.map(segment=>`<span class="metric-card__segment">${renderIcon(segment.icon)}<span>${escapeHtml(String(segment.value))}</span><small>${escapeHtml(segment.label)}</small></span>`).join(""):escapeHtml(card.value)}</strong>
      <span class="metric-card__chip${card.warning ? " warning" : ""}">${escapeHtml(card.chip)}</span>
      <p class="metric-card__context">${escapeHtml(card.context)}</p>
      ${renderNote(card.key)}
    </article>`;
  }).join("")}</section>`;
}
