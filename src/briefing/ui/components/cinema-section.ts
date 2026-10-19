import { renderTrendChart } from "../charts/index.ts";
import { cinemaTrendInput } from "../../cinema/chart-adapter.ts";
import type { BriefingPayload } from "../../model.ts";
import {
  parseCinemaEnvelope,
  type CinemaChart,
  type CinemaEnvelope,
  type CinemaNote,
} from "../../cinema/model.ts";
import { originalTitleFromBilingual } from "../../cinema/titles.ts";
import { escapeHtml } from "../html.ts";
import {digestLanguage,digestText as t} from "../../i18n.ts";
import {renderDisclosure} from "../../../ui-library/components/disclosure.ts";
import {FIGURE_ATTRIBUTE,surfaceAttributes} from "../../../ui-library/components/surface.ts";

/** Refresh navigation and controls without rewriting a retained edition's content. */
export function refreshCinemaUi(html:string):string {
  if(!html.includes("data-cinema-edition="))return html;
  html=html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi,(_tag,attributes,css:string)=>`<style${attributes}>${css.replace(/\.cinema-rank__more\s+summary\s*\{[^}]*\}/g,"")}</style>`);
  html=html.replace(/<details class="cinema-rank__more"><summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/g,(_match,summary,body)=>renderDisclosure({summary,body,variant:"inline",className:"cinema-rank__more"}));
  if(html.includes("data-cinema-contents"))return html;
  const sections=[["box-office",t("Прокат","Box office")],["trailers",t("Трейлеры","Trailers")],["premieres",t("Премьеры","Premieres")],["cinema-news",t("Новости","News")]];
  const links=sections.filter(([id])=>html.includes(`id="${id}"`)).map(([id,label])=>`<a href="#${id}">${escapeHtml(label)}</a>`).join("");
  if(!links)return html;
  return html.replace(/(<section class="hero">[\s\S]*?<\/section>)/,`$1<nav class="cinema-contents" data-cinema-contents aria-label="${t("Разделы кинообзора","Cinema sections")}">${links}</nav>`);
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat(digestLanguage()==="en"?"en-US":"ru-RU", {
    style: "currency",
    currency,
    notation: amount >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 1_000_000 ? 1 : 0,
  }).format(amount);
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU", { day: "numeric", month: "short" })
    .format(new Date(`${value}T12:00:00Z`));
}

function duration(seconds: number | undefined): string {
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function noteMark(mark: CinemaNote["mark"]): string {
  return mark === "arrow-down" ? "↓" : mark === "arrow-down-left" ? "↙" : mark === "arrow-down-right" ? "↘" : "→";
}

function note(envelope: CinemaEnvelope, target: string, className = "cinema-heading__note"): string {
  const item = envelope.data.notes.find((candidate) => candidate.target === target);
  if (!item) return "";
  return `<span class="kurami-note ${escapeHtml(className)}" data-note-id="${escapeHtml(item.id)}"${digestLanguage()==="en"&&!item.enText?' lang="ru"':''}>${escapeHtml(digestLanguage()==="en"?item.enText??item.text:item.text)} <span aria-hidden="true">${noteMark(item.mark)}</span></span>`;
}

function chartRows(chart: CinemaChart, visible = 5): string {
  return chart.entries.map((entry) => `<tr${entry.rank > visible ? " class=\"cinema-rank__extra\"" : ""}>
    <td>${entry.rank}</td><th scope="row">${escapeHtml(chart.region === "LT" ? originalTitleFromBilingual(entry.title) : entry.title)}</th>
    <td>${money(entry.gross.amount, entry.gross.currency)}</td>
    <td>${entry.changePercent === undefined ? "—" : `${entry.changePercent > 0 ? "+" : ""}${Math.round(entry.changePercent)}%`}</td>
  </tr>`).join("");
}

function rankPeriod(envelope: CinemaEnvelope, chart: CinemaChart): string {
  const sourceIds = new Set(chart.entries.map((entry) => entry.sourceId));
  const sources = envelope.data.provenance.filter((source) => sourceIds.has(source.id));
  const formatDate = (value: string): string | undefined => {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(digestLanguage() === "en" ? "en-GB" : "ru-RU", {
        day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
      }).format(date)
      : undefined;
  };
  if (chart.period === "ytd") {
    const collected = sources[0] && formatDate(sources[0].fetchedAt);
    return `${envelope.data.localDate.slice(0, 4)}${collected ? ` · ${t("Собрано", "Collected")} ${collected}` : ""}`;
  }
  const periods = [...new Set(sources.map((source) => source.period))];
  const period = periods.length === 1 ? periods[0] : undefined;
  if (period && /^\d{4}-\d{2}-\d{2}$/u.test(period)) {
    const end = formatDate(period);
    if (end) return `${t("Уикенд по", "Weekend ending")} ${end}`;
  }
  if (period?.includes("/")) {
    const [start, end] = period.split("/").map(formatDate);
    if (start && end) return `${t("Период источника:", "Source period:")} ${start} – ${end}`;
  }
  return t("Период не подтверждён", "Period not confirmed");
}

function rankTable(chart: CinemaChart, envelope: CinemaEnvelope): string {
  const hasMore = chart.entries.length > 5;
  const region = RANK_REGIONS.find(item => item.id === chart.region);
  const title = region ? `${t(region.label, region.enLabel)} — ${chart.period === "ytd" ? t("с начала года", "year to date") : t("уикенд", "weekend")}` : chart.label;
  return `<article class="cinema-rank"><header><div><span>${escapeHtml(chart.region)}</span><h3>${escapeHtml(title)}</h3></div><span>${chart.period === "ytd" ? t("год","year") : t("уикенд","weekend")}</span></header>
    <p class="section-kicker">${escapeHtml(rankPeriod(envelope, chart))}</p>
    <table><thead><tr><th>#</th><th>${t("Фильм","Film")}</th><th>${t("Сборы","Gross")}</th><th>Δ</th></tr></thead><tbody>${chartRows(chart)}</tbody></table>
    ${hasMore ? renderDisclosure({summary:t("Показать топ-10","Show top 10"),variant:"inline",className:"cinema-rank__more",body:`<span class="sr-only">${t("Остальные строки уже находятся в таблице и открываются стилями.","The remaining rows are already in the table and are revealed by styles.")}</span>`}) : ""}
  </article>`;
}

function trend(envelope: CinemaEnvelope): string {
  const series = envelope.data.boxOffice.trend;
  return series.length ? renderTrendChart(cinemaTrendInput(series)) : "";
}

function regionOrder(chart: CinemaChart): number {
  if (chart.region === "WORLD") return 0;
  if (chart.region === "US/CA") return 1;
  if (chart.region === "LT") return 2;
  return 3;
}

const RANK_REGIONS = [
  { id: "WORLD", label: "Мировой прокат", enLabel:"Worldwide" },
  { id: "US/CA", label: "США", enLabel:"US" },
  { id: "LT", label: "Литва", enLabel:"Lithuania" },
] as const;

function emptyRankTable(region: typeof RANK_REGIONS[number], period: CinemaChart["period"], envelope: CinemaEnvelope): string {
  const suffix = period === "weekend" ? t("уикенд","weekend") : t("с начала года","year to date");
  const omittedWorld = region.id === "WORLD" && period === "weekend"
    && envelope.data.boxOffice.diagnostics?.some((issue) => issue.startsWith("world-weekend:omitted:"));
  const reason = region.id === "LT" && period === "ytd"
    ? t("Годовой рейтинг для этого рынка не собирается.", "Year-to-date rankings are not collected for this market.")
    : omittedWorld
      ? t("Не удалось подтвердить совпадение уикендов или согласованность сборов.", "Matching weekends or consistent totals could not be verified.")
      : t("Данные источника недоступны для этого выпуска.", "Source data is unavailable for this edition.");
  return `<article class="cinema-rank cinema-rank--empty"><header><div><span>${escapeHtml(region.id)}</span><h3>${escapeHtml(t(region.label,region.enLabel))} — ${suffix}</h3></div><span>${period === "ytd" ? t("год","year") : t("уикенд","weekend")}</span></header><div class="cinema-rank__empty"><strong>${t("Нет надёжных данных","No reliable data")}</strong><p>${escapeHtml(reason)}</p></div></article>`;
}

function rankGroup(envelope: CinemaEnvelope, period: CinemaChart["period"]): string {
  const selected = envelope.data.boxOffice.charts.filter((chart) => chart.period === period).sort((left, right) => regionOrder(left) - regionOrder(right));
  const title = period === "weekend" ? t("Последний уикенд","Latest weekend") : t("С начала года","Year to date");
  const cards = RANK_REGIONS.map((region) => {
    const chart = selected.find((candidate) => candidate.region === region.id);
    return chart ? rankTable(chart, envelope) : emptyRankTable(region, period, envelope);
  });
  return `<section class="cinema-rank-group" data-rank-period="${period}"><header><h3>${title}</h3><span>${selected.length} ${t("из","of")} ${RANK_REGIONS.length} ${t("рынков","markets")}</span></header><div class="cinema-ranks">${cards.join("")}</div></section>`;
}

function boxOffice(envelope: CinemaEnvelope): string {
  const section = envelope.data.boxOffice;
  if (section.state === "failed" || !section.charts.length) return "";
  const usWeekend = section.charts.find((chart) => chart.region === "US/CA" && chart.period === "weekend");
  const featured = usWeekend?.entries.find((entry) => entry.id === section.featuredId)
    ?? usWeekend?.entries.find((entry) => entry.rank === 1);
  const signalLabels={"largest-debut":t("Крупнейший дебют","Biggest debut"),"best-hold":t("Лучшее удержание","Best hold"),"sharpest-drop":t("Самое резкое падение","Sharpest drop"),"rank-movement":t("Движение в чарте","Chart movement"),"estimate-surprise":t("Сюрприз против прогноза","Versus estimate")};
  return `<section${surfaceAttributes("lead")} class="cinema-block cinema-box-office" id="box-office"><header class="cinema-heading section-heading"><div><p class="section-kicker">${t("Прокат · цифры","Box office · numbers")}</p><h2>${t("Пульс проката","Box-office pulse")}</h2></div>${note(envelope, "box-office")}</header>
    ${featured ? `<article class="cinema-winner"><span>${t("Лидер уикенда в США","US weekend leader")} · ${escapeHtml(rankPeriod(envelope, usWeekend!))}</span><strong>${escapeHtml(featured.title)}</strong><b${FIGURE_ATTRIBUTE}>${money(featured.gross.amount, featured.gross.currency)}</b></article>` : ""}
    ${section.signals.length ? `<div class="cinema-signals">${section.signals.map((signal) => `<article><span>${escapeHtml(signalLabels[signal.kind])}</span><strong>${escapeHtml(signal.filmTitle ?? section.charts.flatMap((chart) => chart.entries).find((entry) => entry.id === signal.filmId)?.title ?? signal.filmId)}</strong><b>${signal.value === undefined ? "" : `${signal.value > 0 ? "+" : ""}${signal.unit === "USD" ? money(signal.value, "USD") : `${Math.round(signal.value)}${signal.unit ?? ""}`}`}</b></article>`).join("")}</div>` : ""}
    ${trend(envelope)}
    <div class="cinema-rank-groups">${rankGroup(envelope, "weekend")}${rankGroup(envelope, "ytd")}</div>
  </section>`;
}

type CinemaTrailer = CinemaEnvelope["data"]["trailers"]["items"][number];

function displayedTrailers(items: CinemaTrailer[], publisherLimit = 3): CinemaTrailer[] {
  const publisherCounts = new Map<string, number>();
  return items.filter((item) => {
    const count = publisherCounts.get(item.publisherChannelId) ?? 0;
    if (count >= publisherLimit) return false;
    publisherCounts.set(item.publisherChannelId, count + 1);
    return true;
  });
}

function trailers(envelope: CinemaEnvelope): string {
  const items = displayedTrailers(envelope.data.trailers.items);
  if (!items.length) return "";
  return `<section${surfaceAttributes("panel")} class="cinema-block" id="trailers"><header class="cinema-heading section-heading"><div><p class="section-kicker">${t("Свежие","Recent")} · ${items.length}</p><h2>${t("Трейлеры недели","Trailers this week")}</h2></div>${note(envelope, "trailers")}</header><div class="cinema-trailer-grid">${items.map((item) => `<a class="cinema-trailer" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer"><span class="cinema-art${item.thumbnailSrc ? " has-image" : ""}">${item.thumbnailSrc ? `<img src="${escapeHtml(item.thumbnailSrc)}" alt="">` : ""}<b aria-hidden="true">▶</b>${duration(item.durationSeconds) ? `<i>${duration(item.durationSeconds)}</i>` : ""}</span><span class="cinema-card__copy"><small>${escapeHtml(item.publisher)} · ${escapeHtml(item.trailerType)}</small><strong>${escapeHtml(item.title)}</strong><em>${new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU", { day: "numeric", month: "short" }).format(new Date(item.publishedAt))}</em></span></a>`).join("")}</div></section>`;
}

function premiereFacts(item: CinemaEnvelope["data"]["premieres"]["items"][number]): string {
  const facts = [
    item.directors?.length ? `<span><b>${t("Режиссёр","Director")}</b>${escapeHtml(item.directors.join(", "))}</span>` : "",
    item.cast?.length ? `<span><b>${t("В ролях","Cast")}</b>${escapeHtml(item.cast.join(", "))}</span>` : "",
    item.runtimeMinutes ? `<span><b>${t("Хронометраж","Runtime")}</b>${Math.floor(item.runtimeMinutes / 60)} ${t("ч","h")} ${item.runtimeMinutes % 60} ${t("мин","min")}</span>` : "",
  ].filter(Boolean);
  return facts.length ? `<span class="cinema-premiere__facts">${facts.join("")}</span>` : "";
}

function premieres(envelope: CinemaEnvelope): string {
  const items = envelope.data.premieres.items;
  if (!items.length) return "";
  return `<section${surfaceAttributes("panel")} class="cinema-block" id="premieres"><header class="cinema-heading section-heading"><div><p class="section-kicker">${t("Литва · следующая неделя","Lithuania · next week")}</p><h2>${t("Премьеры","Premieres")}</h2></div>${note(envelope, "premieres")}</header><div class="cinema-premiere-grid">${items.map((item) => `<a class="cinema-premiere" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer"><span class="cinema-poster${item.posterSrc ? " has-image" : ""}">${item.posterSrc ? `<img src="${escapeHtml(item.posterSrc)}" alt="">` : `<b>${escapeHtml((item.originalTitle ?? item.localTitle).slice(0, 1))}</b>`}</span><span class="cinema-card__copy"><small>${shortDate(item.releaseDate)}${item.ageRating ? ` · ${escapeHtml(item.ageRating)}` : ""}</small><strong>${escapeHtml(item.originalTitle ?? item.localTitle)}</strong>${item.originalTitle ? `<em>${escapeHtml(item.localTitle)}</em>` : ""}${item.genres?.length ? `<span class="cinema-card__genres">${item.genres.map((genre) => `<i>${escapeHtml(genre)}</i>`).join("")}</span>` : ""}${premiereFacts(item)}</span></a>`).join("")}</div></section>`;
}

function news(envelope: CinemaEnvelope): string {
  const items = envelope.data.news.items;
  if (!items.length) return "";
  return `<section${surfaceAttributes("panel")} class="cinema-block" id="cinema-news"><header class="cinema-heading section-heading"><div><p class="section-kicker">${t("За 7 дней","Last 7 days")} · ${items.length}</p><h2>${t("Новости","News")}</h2></div>${note(envelope, "news")}</header><div class="cinema-news-list">${items.map((item, index) => {
    const en=digestLanguage()==="en"?item.en:undefined;
    const originalLang=digestLanguage()==="en"&&!en?' lang="ru"':"";
    const headline=en?.headline??item.headline;
    return `<article class="cinema-news"><span>${String(index + 1).padStart(2, "0")}</span><span class="cinema-news__image${item.imageSrc ? " has-image" : ""}" aria-hidden="true">${item.imageSrc ? `<img src="${escapeHtml(item.imageSrc)}" alt="">` : ""}</span><div class="cinema-news__copy"><small>${escapeHtml(item.publisher)} · ${new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU", { day: "numeric", month: "short" }).format(new Date(item.publishedAt))}</small>${note(envelope, `news:${item.id}`, "cinema-news__note")}<h3${originalLang}>${escapeHtml(headline)}</h3><p${originalLang}>${escapeHtml(en?.summary??item.summary)}</p></div><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${t("Открыть источник","Open source")}: ${escapeHtml(headline)}">↗</a></article>`;
  }).join("")}</div></section>`;
}

function full(envelope: CinemaEnvelope): string {
  return `<div class="cinema-suite" data-cinema-edition="${escapeHtml(envelope.data.localDate)}">${boxOffice(envelope)}${trailers(envelope)}${premieres(envelope)}${news(envelope)}</div>`;
}

function preview(envelope: CinemaEnvelope): string {
  const chart = envelope.data.boxOffice.charts.find((item) => item.id === "us-weekend") ?? envelope.data.boxOffice.charts[0];
  const winner = chart?.entries[0];
  return `<section class="cinema-preview"${surfaceAttributes("panel")}><div><p class="section-kicker">${t("Субботний add-on","Saturday add-on")}</p><h2>${t("Кино за неделю","Cinema this week")}</h2><p>${winner ? `${t("В прокате лидирует","Box-office leader")}: ${escapeHtml(winner.title)}; ` : ""}${envelope.data.trailers.items.length} ${t("свежих трейлеров и","recent trailers and")} ${envelope.data.premieres.items.length} ${t("премьер на следующей неделе","premieres next week")}.</p></div><div class="cinema-preview__facts"><span><b>${envelope.data.news.items.length}</b> ${t("новостей","news stories")}</span><span><b>${envelope.data.boxOffice.signals.length}</b> ${t("движений","movements")}</span></div><a class="button button--primary" href="/cinema">${t("Открыть Cinema","Open Cinema")} ↗</a></section>`;
}

export function renderCinemaSection(payload: BriefingPayload): string {
  const raw = payload.addons?.cinema;
  if (!raw) return "";
  const envelope = parseCinemaEnvelope(raw);
  if (payload.edition.type === "daily") {
    // Scheduled composition attaches only a promoted same-date snapshot.
    // Rendering trusts that explicit attachment so the exact component can
    // also be shown in a bounded operator preview without duplicating markup.
    return preview(envelope);
  }
  return full(envelope);
}
