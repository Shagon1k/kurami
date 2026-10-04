import { createHash } from "node:crypto";
import {
  fetchJson,
  fetchBuffer,
  fetchText,
  providerIssue,
  retryOperation,
  type FetchLike,
  type ProviderIssue,
  type RetryPolicy,
} from "../providers/common.ts";
import type { ComposioToolCaller } from "../providers/composio-mcp.ts";
import type { CinemaRuntimeConfig } from "../runtime-config.ts";
import type { SectionState } from "../model.ts";
import type {
  CinemaBoxOfficeSection,
  CinemaCoverage,
  CinemaSourceReference,
} from "./model.ts";
import { normalizeBoxOfficeWatch } from "./providers/box-office-watch.ts";
import { reconcileWorldWeekend } from "./box-office-consistency.ts";
import { apArticlePublishedAt, discoverApBoxOfficeLinks, parseApTopTen } from "./providers/ap.ts";
import { parseCinemaLtMovieDetails, parseCinemaLtPremieres, type CinemaLtPremiereCandidate } from "./providers/cinema-lt.ts";
import { parseCinemaRss, type CinemaNewsCandidate } from "./providers/rss.ts";
import { normalizeLkcSheetRows } from "./providers/lkc.ts";
import { discoverLkcWeekendWorkbook, parseLkcWorkbook } from "./providers/lkc-xlsx.ts";
import {
  kinopoiskReaderUrl,
  parseKinopoiskWeekend,
  type KinopoiskWeekendMarket,
} from "./providers/kinopoisk.ts";
import { normalizeYouTubeCandidates, type YouTubeTrailerCandidate } from "./providers/youtube.ts";
import { selectNewsCandidates, selectTrailerCandidates, type SelectedNewsCandidate, type SelectedTrailerCandidate } from "./selection.ts";
import { cinemaPremiereCoverage, cinemaWeeklyCoverage } from "./time-windows.ts";

export type CinemaCandidateSection<T> = {
  state: SectionState;
  candidates: T[];
  provenance: string[];
  diagnostics: string[];
};

export type CinemaCollectionCandidate = {
  version: 1;
  capturedAt: string;
  localDate: string;
  market: string;
  timezone: string;
  language: string;
  coverage: {
    boxOffice: CinemaCoverage;
    trailers: CinemaCoverage;
    premieres: CinemaCoverage;
    news: CinemaCoverage;
  };
  boxOffice: CinemaBoxOfficeSection;
  trailers: CinemaCandidateSection<SelectedTrailerCandidate>;
  premieres: CinemaCandidateSection<CinemaLtPremiereCandidate>;
  news: CinemaCandidateSection<SelectedNewsCandidate>;
  provenance: CinemaSourceReference[];
  diagnostics: string[];
};

export type CinemaCollectorOptions = {
  localDate: string;
  config: CinemaRuntimeConfig;
  caller?: ComposioToolCaller;
  fetchImpl?: FetchLike;
  retry?: Partial<RetryPolicy>;
  now?: () => Date;
};

type SourceOutcome<T> = { ok: true; value: T; source: CinemaSourceReference } | { ok: false; issue: ProviderIssue };

const RSS_SOURCES = [
  ["variety", "Variety", "variety.com"],
  ["deadline", "Deadline", "deadline.com"],
  ["hollywoodReporter", "The Hollywood Reporter", "www.hollywoodreporter.com"],
  ["indiewire", "IndieWire", "www.indiewire.com"],
] as const;

function sourceId(provider: string, url: string): string {
  return `cinema:${provider}:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

function issueText(provider: string, issue: ProviderIssue): string {
  return `${provider}:${issue.code}:${issue.message}`.slice(0, 360);
}

function sectionState(items: unknown[], issues: ProviderIssue[]): SectionState {
  if (items.length === 0) return issues.length ? "failed" : "empty";
  return issues.length ? "partial" : "ready";
}

function boxOfficeCoverage(weekendEnd: string): CinemaCoverage {
  const end = new Date(`${weekendEnd}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 3);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function collectApBoxOfficeFallback(
  options: CinemaCollectorOptions,
  capturedAt: string,
  primaryDiagnostics: string[],
): Promise<{
  section: CinemaBoxOfficeSection;
  coverage: CinemaCoverage;
  sources: CinemaSourceReference[];
}> {
  const coverage = cinemaWeeklyCoverage(options.localDate, options.config.timeZone);
  const discoveryUrl = new URL(options.config.sources.apMovies.discoveryUrl);
  const discovery = await fetchText(discoveryUrl, { fetchImpl: options.fetchImpl, retry: options.retry });
  if (!discovery.ok) {
    return {
      section: {
        state: "failed",
        capturedAt,
        charts: [],
        signals: [],
        trend: [],
        provenance: [],
        diagnostics: [...primaryDiagnostics, issueText("ap", discovery.issue)],
      },
      coverage,
      sources: [],
    };
  }
  const links = discoverApBoxOfficeLinks(discovery.value, 8, discoveryUrl.toString());
  const failures: string[] = [];
  for (const link of links) {
    const article = await fetchText(new URL(link), { fetchImpl: options.fetchImpl, retry: options.retry });
    if (!article.ok) {
      failures.push(issueText("ap", article.issue));
      continue;
    }
    try {
      const publishedAt = apArticlePublishedAt(article.value);
      if (!publishedAt || Date.parse(publishedAt) < Date.parse(coverage.start) || Date.parse(publishedAt) >= Date.parse(coverage.end)) {
        throw new Error("AP box-office article is outside the exact weekly coverage window");
      }
      const id = sourceId("ap", link);
      const chart = parseApTopTen({ html: article.value, sourceUrl: link, sourceId: id });
      return {
        section: {
          state: "partial",
          capturedAt,
          featuredId: chart.entries[0]?.id,
          charts: [chart],
          signals: [],
          trend: [],
          provenance: [id],
          diagnostics: [...primaryDiagnostics, "box-office-watch:fallback_to_ap"],
        },
        coverage,
        sources: [{
          id,
          provider: "Associated Press",
          url: link,
          fetchedAt: capturedAt,
          publishedAt,
          region: "US/CA",
          period: `${coverage.start}/${coverage.end}`,
          evidence: "AP weekly Comscore domestic Top 10 fallback",
        }],
      };
    } catch (error) {
      failures.push(issueText("ap", providerIssue(error, "ap_box_office_schema")));
    }
  }
  return {
    section: {
      state: "failed",
      capturedAt,
      charts: [],
      signals: [],
      trend: [],
      provenance: [],
      diagnostics: [...primaryDiagnostics, ...failures, "ap:no_qualified_box_office_article"],
    },
    coverage,
    sources: [],
  };
}

async function collectBoxOffice(options: CinemaCollectorOptions, capturedAt: string): Promise<{
  section: CinemaBoxOfficeSection;
  coverage: CinemaCoverage;
  sources: CinemaSourceReference[];
}> {
  const weekendUrl = new URL(options.config.sources.boxOfficeWatch.weekendUrl);
  const yearlyUrl = new URL(options.config.sources.boxOfficeWatch.yearlyUrl);
  const [weekend, yearly] = await Promise.all([
    fetchJson(weekendUrl, { fetchImpl: options.fetchImpl, retry: options.retry }),
    fetchJson(yearlyUrl, { fetchImpl: options.fetchImpl, retry: options.retry }),
  ]);
  const issues: ProviderIssue[] = [];
  if (!weekend.ok) issues.push(weekend.issue);
  if (!yearly.ok) issues.push(yearly.issue);
  const fallbackCoverage = cinemaWeeklyCoverage(options.localDate, options.config.timeZone);
  if (!weekend.ok || !yearly.ok) {
    return collectApBoxOfficeFallback(
      options,
      capturedAt,
      issues.map((issue) => issueText("box-office-watch", issue)),
    );
  }
  try {
    const id = sourceId("box-office-watch", "https://boxofficewatch.com/");
    const normalized = normalizeBoxOfficeWatch({
      weekend: weekend.value,
      yearly: yearly.value,
      editionDate: options.localDate,
      sourceId: id,
    });
    const source: CinemaSourceReference = {
      id,
      provider: "Box Office Watch",
      url: "https://boxofficewatch.com/",
      fetchedAt: capturedAt,
      region: "US/WORLD",
      period: normalized.weekendEnd,
    };
    return {
      section: {
        state: "ready",
        capturedAt,
        featuredId: normalized.featuredId,
        charts: normalized.charts,
        signals: normalized.signals,
        trend: normalized.trend,
        provenance: [id],
      },
      coverage: boxOfficeCoverage(normalized.weekendEnd),
      sources: [source],
    };
  } catch (error) {
    const issue = providerIssue(error, "box_office_watch_schema");
    return collectApBoxOfficeFallback(options, capturedAt, [issueText("box-office-watch", issue)]);
  }
}

async function collectKinopoiskWeekend(
  options: CinemaCollectorOptions,
  capturedAt: string,
  market: KinopoiskWeekendMarket,
): Promise<{
  section: Pick<CinemaBoxOfficeSection, "state" | "charts" | "provenance" | "diagnostics">;
  sources: CinemaSourceReference[];
}> {
  const sourceUrl = market === "world"
    ? options.config.sources.kinopoisk.worldWeekendUrl
    : options.config.sources.kinopoisk.usaWeekendUrl;
  const transportUrl = kinopoiskReaderUrl(sourceUrl, options.config.sources.kinopoisk.readerBaseUrl);
  const response = await fetchText(transportUrl, {
    fetchImpl: options.fetchImpl,
    retry: options.retry,
    maximumBytes: 1_024 * 1_024,
    accept: "text/plain, text/markdown;q=0.9",
  });
  if (!response.ok) return {
    section: { state: "failed", charts: [], provenance: [], diagnostics: [issueText(`kinopoisk-${market}`, response.issue)] },
    sources: [],
  };
  try {
    const id = sourceId(`kinopoisk-${market}`, sourceUrl);
    const normalized = parseKinopoiskWeekend({ markdown: response.value, sourceUrl, sourceId: id, market });
    const ageDays = (Date.parse(`${options.localDate}T12:00:00Z`) - Date.parse(`${normalized.weekendEnd}T12:00:00Z`)) / 86_400_000;
    if (ageDays < 0 || ageDays > 14) throw new Error(`Kinopoisk ${market} weekend is stale or future-dated`);
    return {
      section: { state: "ready", charts: [normalized.chart], provenance: [id], diagnostics: [] },
      sources: [{
        id,
        provider: "Kinopoisk",
        url: sourceUrl,
        fetchedAt: capturedAt,
        region: market === "world" ? "WORLD" : "US/CA",
        period: normalized.weekendEnd,
        evidence: "Public Kinopoisk weekend chart via bounded reader transport; upstream data credited to Box Office Mojo",
      }],
    };
  } catch (error) {
    const issue = providerIssue(error, "kinopoisk_box_office_schema");
    return {
      section: { state: "failed", charts: [], provenance: [], diagnostics: [issueText(`kinopoisk-${market}`, issue)] },
      sources: [],
    };
  }
}

async function collectLithuanianBoxOffice(options: CinemaCollectorOptions, capturedAt: string): Promise<{
  section: Pick<CinemaBoxOfficeSection, "state" | "charts" | "provenance" | "diagnostics">;
  sources: CinemaSourceReference[];
}> {
  const reportsUrl = new URL(options.config.sources.lkc.reportsUrl);
  const discovery = await fetchText(reportsUrl, { fetchImpl: options.fetchImpl, retry: options.retry });
  if (!discovery.ok) return {
    section: { state: "failed", charts: [], provenance: [], diagnostics: [issueText("lkc", discovery.issue)] },
    sources: [],
  };
  try {
    const workbook = discoverLkcWeekendWorkbook(discovery.value, reportsUrl.toString(), options.localDate);
    const downloaded = await fetchBuffer(new URL(workbook.url), {
      fetchImpl: options.fetchImpl,
      retry: options.retry,
      maximumBytes: 2 * 1_024 * 1_024,
      accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    if (!downloaded.ok) return {
      section: { state: "failed", charts: [], provenance: [], diagnostics: [issueText("lkc", downloaded.issue)] },
      sources: [],
    };
    const rows = normalizeLkcSheetRows(parseLkcWorkbook(downloaded.value));
    const id = sourceId("lkc", workbook.url);
    return {
      section: {
        state: "ready",
        charts: [{
          id: "lt-weekend",
          label: "Литва — уикенд",
          region: options.config.market,
          period: "weekend",
          entries: rows.slice(0, 10).map((entry) => ({
            id: entry.id,
            title: entry.title,
            rank: entry.rank,
            gross: { amount: entry.weekendGrossEur, currency: "EUR" },
            cumulativeGross: { amount: entry.cumulativeGrossEur, currency: "EUR" },
            ...(entry.changePercent === undefined ? {} : { changePercent: entry.changePercent }),
            ...(entry.previousRank === undefined ? {} : { previousRank: entry.previousRank }),
            ...(entry.weekInRelease === undefined ? {} : { weeks: entry.weekInRelease }),
            ...(entry.admissions === undefined ? {} : { admissions: entry.admissions }),
            ...(entry.showCount === undefined ? {} : { showCount: entry.showCount }),
            ...(entry.releaseDate === undefined ? {} : { releaseDate: entry.releaseDate }),
            ...(entry.distributor === undefined ? {} : { distributor: entry.distributor }),
            sourceId: id,
          })),
        }],
        provenance: [id],
        diagnostics: [],
      },
      sources: [{
        id,
        provider: "Lithuanian Film Centre",
        url: workbook.url,
        fetchedAt: capturedAt,
        region: options.config.market,
        period: `${workbook.weekendStart}/${workbook.weekendEnd}`,
      }],
    };
  } catch (error) {
    const issue = providerIssue(error, "lkc_schema");
    return {
      section: { state: "failed", charts: [], provenance: [], diagnostics: [issueText("lkc", issue)] },
      sources: [],
    };
  }
}

async function collectPremieres(options: CinemaCollectorOptions, coverage: CinemaCoverage, capturedAt: string): Promise<{
  section: CinemaCandidateSection<CinemaLtPremiereCandidate>;
  sources: CinemaSourceReference[];
}> {
  const url = new URL(options.config.sources.cinemaLt.repertoireUrl);
  const response = await fetchText(url, { fetchImpl: options.fetchImpl, retry: options.retry });
  if (!response.ok) return {
    section: { state: "failed", candidates: [], provenance: [], diagnostics: [issueText("cinema-lt", response.issue)] },
    sources: [],
  };
  try {
    const baseCandidates = parseCinemaLtPremieres({
      html: response.value,
      coverage,
      timeZone: options.config.timeZone,
      limit: options.config.limits.premieres,
    });
    const detailDiagnostics: string[] = [];
    const candidates = await Promise.all(baseCandidates.map(async (candidate) => {
      const detailUrl = new URL(candidate.sourceUrl);
      detailUrl.hash = "";
      const detail = await fetchText(detailUrl, { fetchImpl: options.fetchImpl, retry: options.retry });
      if (!detail.ok) {
        detailDiagnostics.push(issueText("cinema-lt-detail", detail.issue));
        return candidate;
      }
      try {
        return { ...candidate, ...parseCinemaLtMovieDetails(detail.value) };
      } catch (error) {
        detailDiagnostics.push(issueText("cinema-lt-detail", providerIssue(error, "cinema_lt_detail_schema")));
        return candidate;
      }
    }));
    const id = sourceId("cinema-lt", url.toString());
    return {
      section: {
        state: candidates.length ? (detailDiagnostics.length ? "partial" : "ready") : "empty",
        candidates,
        provenance: [id],
        diagnostics: detailDiagnostics,
      },
      sources: [{ id, provider: "cinema.lt", url: url.toString(), fetchedAt: capturedAt, region: options.config.market }],
    };
  } catch (error) {
    const issue = providerIssue(error, "cinema_lt_schema");
    return {
      section: { state: "failed", candidates: [], provenance: [], diagnostics: [issueText("cinema-lt", issue)] },
      sources: [],
    };
  }
}

async function collectNews(options: CinemaCollectorOptions, coverage: CinemaCoverage, capturedAt: string): Promise<{
  section: CinemaCandidateSection<SelectedNewsCandidate>;
  sources: CinemaSourceReference[];
}> {
  const outcomes = await Promise.all(RSS_SOURCES.map(async ([key, publisher, expectedHost]): Promise<SourceOutcome<CinemaNewsCandidate[]>> => {
    const url = new URL(options.config.sources.weeklyNews[key]);
    const response = await fetchText(url, { fetchImpl: options.fetchImpl, retry: options.retry, accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" });
    if (!response.ok) return { ok: false, issue: response.issue };
    try {
      const value = parseCinemaRss({ xml: response.value, publisher, expectedHost, coverage, limit: options.config.limits.providerCandidates });
      return {
        ok: true,
        value,
        source: { id: sourceId(key, url.toString()), provider: publisher, url: url.toString(), fetchedAt: capturedAt, period: `${coverage.start}/${coverage.end}` },
      };
    } catch (error) {
      return { ok: false, issue: providerIssue(error, "cinema_rss_schema") };
    }
  }));
  const candidates = outcomes.flatMap((outcome) => outcome.ok ? outcome.value : []);
  const sources = outcomes.flatMap((outcome) => outcome.ok ? [outcome.source] : []);
  const issues = outcomes.flatMap((outcome, index) => outcome.ok ? [] : [{ ...outcome.issue, message: `${RSS_SOURCES[index]![1]}: ${outcome.issue.message}` }]);
  const byPublisher = new Map(sources.map((source) => [source.provider, source.id]));
  // The collector freezes a bounded, qualified candidate pool. The later
  // editorial/composer boundary selects the final `limits.news` stories.
  const poolLimit = Math.min(options.config.limits.providerCandidates, options.config.limits.news * 3);
  const selected = selectNewsCandidates(candidates, coverage.end, poolLimit)
    .map((candidate) => ({ ...candidate, id: candidate.id }));
  return {
    section: {
      state: sectionState(selected, issues),
      candidates: selected,
      provenance: [...new Set(selected.map((candidate) => byPublisher.get(candidate.publisher)).filter((value): value is string => Boolean(value)))],
      diagnostics: issues.map((issue) => issueText("weekly-news", issue)),
    },
    sources: sources.filter((source) => selected.some((candidate) => candidate.publisher === source.provider)),
  };
}

async function collectTrailers(options: CinemaCollectorOptions, coverage: CinemaCoverage, capturedAt: string): Promise<{
  section: CinemaCandidateSection<SelectedTrailerCandidate>;
  sources: CinemaSourceReference[];
}> {
  if (!options.caller) return {
    section: { state: "failed", candidates: [], provenance: [], diagnostics: ["youtube:composio_read_unavailable"] },
    sources: [],
  };
  const issues: ProviderIssue[] = [];
  const candidates: YouTubeTrailerCandidate[] = [];
  for (const channel of options.config.sources.youtube.channels) {
    const response = await retryOperation(
      (signal) => options.caller!("YOUTUBE_LIST_CHANNEL_VIDEOS", {
        channelId: channel.id,
        maxResults: 25,
        part: "snippet",
      }, signal),
      options.retry,
    );
    if (!response.ok) {
      issues.push(response.issue);
      continue;
    }
    try {
      candidates.push(...normalizeYouTubeCandidates({
        response: response.value,
        channels: options.config.sources.youtube.channels,
        coverage,
        limit: options.config.limits.providerCandidates,
      }));
    } catch (error) {
      issues.push(providerIssue(error, "youtube_schema"));
    }
  }
  const selected = selectTrailerCandidates(candidates, options.config.limits.trailers);
  const id = sourceId("youtube", "https://www.youtube.com/");
  return {
    section: {
      state: sectionState(selected, issues),
      candidates: selected,
      provenance: selected.length ? [id] : [],
      diagnostics: issues.map((issue) => issueText("youtube", issue)),
    },
    sources: selected.length ? [{ id, provider: "YouTube", url: "https://www.youtube.com/", fetchedAt: capturedAt, period: `${coverage.start}/${coverage.end}` }] : [],
  };
}

export async function collectCinemaCandidate(options: CinemaCollectorOptions): Promise<CinemaCollectionCandidate> {
  const capturedAt = (options.now ?? (() => new Date()))().toISOString();
  const weekly = cinemaWeeklyCoverage(options.localDate, options.config.timeZone);
  const premieresCoverage = cinemaPremiereCoverage(options.localDate, options.config.timeZone);
  const [boxOffice, worldBoxOffice, lithuanianBoxOffice, premieres, news, trailers] = await Promise.all([
    collectBoxOffice(options, capturedAt),
    collectKinopoiskWeekend(options, capturedAt, "world"),
    collectLithuanianBoxOffice(options, capturedAt),
    collectPremieres(options, premieresCoverage, capturedAt),
    collectNews(options, weekly, capturedAt),
    collectTrailers(options, weekly, capturedAt),
  ]);
  const hasUsWeekend = boxOffice.section.charts.some((chart) => chart.region === "US/CA" && chart.period === "weekend");
  const usaFallback = hasUsWeekend ? null : await collectKinopoiskWeekend(options, capturedAt, "usa");
  const supplementalCharts = [
    ...worldBoxOffice.section.charts,
    ...(usaFallback?.section.charts ?? []),
    ...lithuanianBoxOffice.section.charts,
  ];
  const mergedCharts = [...boxOffice.section.charts, ...supplementalCharts].filter((chart, index, charts) => (
    charts.findIndex((candidate) => candidate.region === chart.region && candidate.period === chart.period) === index
  ));
  const baseState = boxOffice.section.state === "failed" && usaFallback?.section.charts.length ? "partial" : boxOffice.section.state;
  const boxOfficeStates = [baseState, worldBoxOffice.section.state, lithuanianBoxOffice.section.state];
  const mergedBoxOffice: CinemaBoxOfficeSection = {
    ...boxOffice.section,
    state: boxOfficeStates.every((state) => state === "ready")
      ? "ready"
      : mergedCharts.length ? "partial" : "failed",
    charts: mergedCharts,
    provenance: [
      ...boxOffice.section.provenance,
      ...worldBoxOffice.section.provenance,
      ...(usaFallback?.section.provenance ?? []),
      ...lithuanianBoxOffice.section.provenance,
    ],
    diagnostics: [
      ...(boxOffice.section.diagnostics ?? []),
      ...(worldBoxOffice.section.diagnostics ?? []),
      ...(usaFallback?.section.diagnostics ?? []),
      ...(lithuanianBoxOffice.section.diagnostics ?? []),
    ],
  };
  const provenance = [
    ...boxOffice.sources,
    ...worldBoxOffice.sources,
    ...(usaFallback?.sources ?? []),
    ...lithuanianBoxOffice.sources,
    ...premieres.sources,
    ...news.sources,
    ...trailers.sources,
  ];
  const reconciledBoxOffice = reconcileWorldWeekend(mergedBoxOffice, provenance, boxOffice.coverage);
  const diagnostics = [
    ...(reconciledBoxOffice.diagnostics ?? []),
    ...premieres.section.diagnostics,
    ...news.section.diagnostics,
    ...trailers.section.diagnostics,
  ];
  return {
    version: 1,
    capturedAt,
    localDate: options.localDate,
    market: options.config.market,
    timezone: options.config.timeZone,
    language: options.config.language,
    coverage: { boxOffice: boxOffice.coverage, trailers: weekly, premieres: premieresCoverage, news: weekly },
    boxOffice: reconciledBoxOffice,
    trailers: trailers.section,
    premieres: premieres.section,
    news: news.section,
    provenance,
    diagnostics,
  };
}
