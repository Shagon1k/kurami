import type { BriefingPayload } from "../../model.ts";
import {
  parseCinemaEnvelope,
  type CinemaChart,
  type CinemaEnvelope,
  type CinemaNote,
  type CinemaTrendSeries,
} from "../../cinema/model.ts";
import { originalTitleFromBilingual } from "../../cinema/titles.ts";
import { escapeHtml } from "../html.ts";

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    notation: amount >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 1_000_000 ? 1 : 0,
  }).format(amount);
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" })
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
  return `<span class="kurami-note ${escapeHtml(className)}" data-note-id="${escapeHtml(item.id)}">${escapeHtml(item.text)} <span aria-hidden="true">${noteMark(item.mark)}</span></span>`;
}

function chartRows(chart: CinemaChart, visible = 5): string {
  return chart.entries.map((entry) => `<tr${entry.rank > visible ? " class=\"cinema-rank__extra\"" : ""}>
    <td>${entry.rank}</td><th scope="row">${escapeHtml(chart.region === "LT" ? originalTitleFromBilingual(entry.title) : entry.title)}</th>
    <td>${money(entry.gross.amount, entry.gross.currency)}</td>
    <td>${entry.changePercent === undefined ? "—" : `${entry.changePercent > 0 ? "+" : ""}${Math.round(entry.changePercent)}%`}</td>
  </tr>`).join("");
}

function rankTable(chart: CinemaChart): string {
  const hasMore = chart.entries.length > 5;
  return `<article class="cinema-rank"><header><div><span>${escapeHtml(chart.region)}</span><h3>${escapeHtml(chart.label)}</h3></div><span>${chart.period === "ytd" ? "год" : "уикенд"}</span></header>
    <table><thead><tr><th>#</th><th>Фильм</th><th>Сборы</th><th>Δ</th></tr></thead><tbody>${chartRows(chart)}</tbody></table>
    ${hasMore ? `<details class="cinema-rank__more"><summary>Показать топ-10</summary><span class="sr-only">Остальные строки уже находятся в таблице и открываются стилями.</span></details>` : ""}
  </article>`;
}

function linePaths(series: CinemaTrendSeries[], width: number, height: number): string {
  const values = series.flatMap((item) => item.points.map((point) => point.gross)).filter((value): value is number => value !== null);
  const maximum = Math.max(...values, 1);
  return series.map((item, seriesIndex) => {
    const points = item.points.map((point, index) => point.gross === null ? null : {
      x: 56 + index * ((width - 80) / Math.max(1, item.points.length - 1)),
      y: 18 + (1 - point.gross / maximum) * (height - 54),
      point,
    });
    const segments: string[][] = [];
    for (const point of points) {
      if (!point) continue;
      const last = segments.at(-1);
      const previousIndex = points.indexOf(point) - 1;
      if (!last || previousIndex < 0 || points[previousIndex] === null) segments.push([]);
      segments.at(-1)!.push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
    }
    const lines = segments.filter((segment) => segment.length > 0)
      .map((segment) => `<polyline points="${segment.join(" ")}"/>`).join("");
    const dots = points.filter((point): point is NonNullable<typeof point> => point !== null)
      .map(({ x, y, point }) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" tabindex="0"><title>${escapeHtml(item.label)} · ${escapeHtml(point.label)} · ${money(point.gross!, item.currency)}</title></circle>`).join("");
    return `<g class="cinema-trend__series cinema-trend__series--${seriesIndex}" data-trend-series="${seriesIndex}">${lines}${dots}</g>`;
  }).join("");
}

function trendJson(series: CinemaTrendSeries[]): string {
  return Buffer.from(JSON.stringify(series), "utf8").toString("base64url");
}

function trendAxis(series: CinemaTrendSeries[]): string {
  const values = series.flatMap((item) => item.points.map((point) => point.gross)).filter((value): value is number => value !== null);
  const maximum = Math.max(...values, 1);
  return [1, .67, .33, 0].map((ratio, index) => {
    const y = [42, 106, 170, 224][index]!;
    return `<text x="48" y="${y + 3}" text-anchor="end">${escapeHtml(money(maximum * ratio, series[0]?.currency ?? "USD"))}</text>`;
  }).join("");
}

function trend(envelope: CinemaEnvelope): string {
  const series = envelope.data.boxOffice.trend;
  if (!series.length) return "";
  const points = series[0]!.points;
  const labels = points.map((point, index, all) => `<text x="${56 + index * (640 / Math.max(1, all.length - 1))}" y="246" text-anchor="middle">${escapeHtml(point.label)}</text>`).join("");
  return `<article class="cinema-trend" data-cinema-trend data-cinema-trend-data="${trendJson(series)}"><header><div><span>${points.length} уикендов</span><h3>Динамика текущего топа</h3></div><div class="cinema-trend__legend" aria-label="Линии графика">${series.map((item, index) => `<button type="button" class="cinema-trend__key cinema-trend__key--${index}" data-trend-key="${index}" aria-pressed="true">${escapeHtml(item.label)}</button>`).join("")}</div></header>
    <div class="cinema-trend__toolbar"><span>Масштаб по времени</span><div class="cinema-trend__zoom"><button type="button" data-trend-zoom-out aria-label="Показать больше уикендов">−</button><output data-trend-window>${points.length} / ${points.length}</output><button type="button" data-trend-zoom-in aria-label="Показать меньше уикендов">+</button></div></div>
    <svg viewBox="0 0 720 260" role="img" aria-label="Динамика кассовых сборов пяти фильмов"><g class="cinema-trend__grid"><line x1="56" y1="42" x2="696" y2="42"/><line x1="56" y1="106" x2="696" y2="106"/><line x1="56" y1="170" x2="696" y2="170"/><line x1="56" y1="224" x2="696" y2="224"/></g>${linePaths(series, 720, 230)}<g class="cinema-trend__labels cinema-trend__labels--y" data-trend-y-labels>${trendAxis(series)}</g><g class="cinema-trend__labels cinema-trend__labels--x" data-trend-x-labels>${labels}</g></svg>
  </article>`;
}

function regionOrder(chart: CinemaChart): number {
  if (chart.region === "WORLD") return 0;
  if (chart.region === "US/CA") return 1;
  if (chart.region === "LT") return 2;
  return 3;
}

const RANK_REGIONS = [
  { id: "WORLD", label: "Мировой прокат" },
  { id: "US/CA", label: "США" },
  { id: "LT", label: "Литва" },
] as const;

function emptyRankTable(region: typeof RANK_REGIONS[number], period: CinemaChart["period"]): string {
  const suffix = period === "weekend" ? "уикенд" : "с начала года";
  return `<article class="cinema-rank cinema-rank--empty"><header><div><span>${escapeHtml(region.id)}</span><h3>${escapeHtml(region.label)} — ${suffix}</h3></div><span>${period === "ytd" ? "год" : "уикенд"}</span></header><div class="cinema-rank__empty"><strong>Нет надёжных данных</strong><p>Появятся автоматически, когда будет подключён проверенный источник.</p></div></article>`;
}

function rankGroup(charts: CinemaChart[], period: CinemaChart["period"]): string {
  const selected = charts.filter((chart) => chart.period === period).sort((left, right) => regionOrder(left) - regionOrder(right));
  const title = period === "weekend" ? "Последний уикенд" : "С начала года";
  const cards = RANK_REGIONS.map((region) => {
    const chart = selected.find((candidate) => candidate.region === region.id);
    return chart ? rankTable(chart) : emptyRankTable(region, period);
  });
  return `<section class="cinema-rank-group" data-rank-period="${period}"><header><h3>${title}</h3><span>${selected.length} из ${RANK_REGIONS.length} рынков</span></header><div class="cinema-ranks">${cards.join("")}</div></section>`;
}

function boxOffice(envelope: CinemaEnvelope): string {
  const section = envelope.data.boxOffice;
  if (section.state === "failed" || !section.charts.length) return "";
  const featured = section.charts.flatMap((chart) => chart.entries)
    .find((entry) => entry.id === section.featuredId);
  return `<section class="cinema-block cinema-box-office" id="box-office"><header class="cinema-heading"><div><p class="section-kicker">Прокат · цифры</p><h2>Пульс проката</h2></div>${note(envelope, "box-office")}</header>
    ${featured ? `<article class="cinema-winner"><span>Лидер последнего уикенда</span><strong>${escapeHtml(featured.title)}</strong><b>${money(featured.gross.amount, featured.gross.currency)}</b></article>` : ""}
    ${section.signals.length ? `<div class="cinema-signals">${section.signals.map((signal) => `<article><span>${escapeHtml(signal.label)}</span><strong>${escapeHtml(signal.filmTitle ?? section.charts.flatMap((chart) => chart.entries).find((entry) => entry.id === signal.filmId)?.title ?? signal.filmId)}</strong><b>${signal.value === undefined ? "" : `${signal.value > 0 ? "+" : ""}${signal.unit === "USD" ? money(signal.value, "USD") : `${Math.round(signal.value)}${signal.unit ?? ""}`}`}</b></article>`).join("")}</div>` : ""}
    ${trend(envelope)}
    <div class="cinema-rank-groups">${rankGroup(section.charts, "weekend")}${rankGroup(section.charts, "ytd")}</div>
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
  return `<section class="cinema-block" id="trailers"><header class="cinema-heading"><div><p class="section-kicker">Свежие · ${items.length}</p><h2>Трейлеры недели</h2></div>${note(envelope, "trailers")}</header><div class="cinema-trailer-grid">${items.map((item) => `<a class="cinema-trailer" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer"><span class="cinema-art${item.thumbnailSrc ? " has-image" : ""}">${item.thumbnailSrc ? `<img src="${escapeHtml(item.thumbnailSrc)}" alt="">` : ""}<b aria-hidden="true">▶</b>${duration(item.durationSeconds) ? `<i>${duration(item.durationSeconds)}</i>` : ""}</span><span class="cinema-card__copy"><small>${escapeHtml(item.publisher)} · ${escapeHtml(item.trailerType)}</small><strong>${escapeHtml(item.title)}</strong><em>${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(item.publishedAt))}</em></span></a>`).join("")}</div></section>`;
}

function premiereFacts(item: CinemaEnvelope["data"]["premieres"]["items"][number]): string {
  const facts = [
    item.directors?.length ? `<span><b>Режиссёр</b>${escapeHtml(item.directors.join(", "))}</span>` : "",
    item.cast?.length ? `<span><b>В ролях</b>${escapeHtml(item.cast.join(", "))}</span>` : "",
    item.runtimeMinutes ? `<span><b>Хронометраж</b>${Math.floor(item.runtimeMinutes / 60)} ч ${item.runtimeMinutes % 60} мин</span>` : "",
  ].filter(Boolean);
  return facts.length ? `<span class="cinema-premiere__facts">${facts.join("")}</span>` : "";
}

function premieres(envelope: CinemaEnvelope): string {
  const items = envelope.data.premieres.items;
  if (!items.length) return "";
  return `<section class="cinema-block" id="premieres"><header class="cinema-heading"><div><p class="section-kicker">Литва · следующая неделя</p><h2>Премьеры</h2></div>${note(envelope, "premieres")}</header><div class="cinema-premiere-grid">${items.map((item) => `<a class="cinema-premiere" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer"><span class="cinema-poster${item.posterSrc ? " has-image" : ""}">${item.posterSrc ? `<img src="${escapeHtml(item.posterSrc)}" alt="">` : `<b>${escapeHtml((item.originalTitle ?? item.localTitle).slice(0, 1))}</b>`}</span><span class="cinema-card__copy"><small>${shortDate(item.releaseDate)}${item.ageRating ? ` · ${escapeHtml(item.ageRating)}` : ""}</small><strong>${escapeHtml(item.originalTitle ?? item.localTitle)}</strong>${item.originalTitle ? `<em>${escapeHtml(item.localTitle)}</em>` : ""}${item.genres?.length ? `<span class="cinema-card__genres">${item.genres.map((genre) => `<i>${escapeHtml(genre)}</i>`).join("")}</span>` : ""}${premiereFacts(item)}</span></a>`).join("")}</div></section>`;
}

function news(envelope: CinemaEnvelope): string {
  const items = envelope.data.news.items;
  if (!items.length) return "";
  return `<section class="cinema-block" id="cinema-news"><header class="cinema-heading"><div><p class="section-kicker">За 7 дней · ${items.length}</p><h2>Новости</h2></div>${note(envelope, "news")}</header><div class="cinema-news-list">${items.map((item, index) => `<article class="cinema-news"><span>${String(index + 1).padStart(2, "0")}</span><span class="cinema-news__image${item.imageSrc ? " has-image" : ""}" aria-hidden="true">${item.imageSrc ? `<img src="${escapeHtml(item.imageSrc)}" alt="">` : ""}</span><div class="cinema-news__copy"><small>${escapeHtml(item.publisher)} · ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(item.publishedAt))}</small>${note(envelope, `news:${item.id}`, "cinema-news__note")}<h3>${escapeHtml(item.headline)}</h3><p>${escapeHtml(item.summary)}</p></div><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть источник: ${escapeHtml(item.headline)}">↗</a></article>`).join("")}</div></section>`;
}

function full(envelope: CinemaEnvelope): string {
  return `<div class="cinema-suite" data-cinema-edition="${escapeHtml(envelope.data.localDate)}">${boxOffice(envelope)}${trailers(envelope)}${premieres(envelope)}${news(envelope)}</div>`;
}

function preview(envelope: CinemaEnvelope): string {
  const chart = envelope.data.boxOffice.charts.find((item) => item.id === "us-weekend") ?? envelope.data.boxOffice.charts[0];
  const winner = chart?.entries[0];
  return `<section class="cinema-preview"><div><p class="section-kicker">Субботний add-on</p><h2>Кино за неделю</h2><p>${winner ? `В прокате лидирует ${escapeHtml(winner.title)}; ` : ""}${envelope.data.trailers.items.length} свежих трейлеров и ${envelope.data.premieres.items.length} премьер на следующей неделе.</p></div><div class="cinema-preview__facts"><span><b>${envelope.data.news.items.length}</b> новостей</span><span><b>${envelope.data.boxOffice.signals.length}</b> движений</span></div><a class="button button--primary" href="/cinema">Открыть Cinema ↗</a></section>`;
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
