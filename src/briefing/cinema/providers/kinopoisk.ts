import type { CinemaChart } from "../model.ts";

export type KinopoiskWeekendMarket = "world" | "usa";

export type KinopoiskWeekendSnapshot = {
  weekendEnd: string;
  chart: CinemaChart;
};

const MONTHS = new Map<string, number>([
  ["января", 0], ["февраля", 1], ["марта", 2], ["апреля", 3],
  ["мая", 4], ["июня", 5], ["июля", 6], ["августа", 7],
  ["сентября", 8], ["октября", 9], ["ноября", 10], ["декабря", 11],
]);

function fail(message: string): never {
  throw new Error(`Invalid Kinopoisk box-office response: ${message}`);
}

function kinopoiskUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "www.kinopoisk.ru" || !url.pathname.startsWith("/box/")) {
    fail("source URL is outside the configured public box-office pages");
  }
  return url;
}

/** Builds the replaceable read-only transport URL without changing source identity. */
export function kinopoiskReaderUrl(sourceUrl: string, readerBaseUrl: string): URL {
  const source = kinopoiskUrl(sourceUrl);
  const base = new URL(readerBaseUrl);
  if (base.protocol !== "https:" || base.hostname !== "r.jina.ai"
    || !base.pathname.startsWith("/https://www.kinopoisk.ru")) {
    fail("reader transport is not scoped to www.kinopoisk.ru");
  }
  return new URL(`${readerBaseUrl.replace(/\/$/u, "")}${source.pathname}${source.search}`);
}

function weekendEnd(markdown: string): string {
  const header = /\[(\d{4}) год\][\s\S]{0,300}?уик-энд №\d+,\s*([^←\n]{3,50})/iu.exec(markdown);
  if (!header) fail("weekend label is missing");
  const year = Number(header[1]);
  const label = header[2]!.replace(/\s+/gu, " ").trim();
  const sameMonth = /^(\d{1,2})\s*[—–-]\s*(\d{1,2})\s+([а-яё]+)$/iu.exec(label);
  const crossMonth = /^(\d{1,2})\s+([а-яё]+)\s*[—–-]\s*(\d{1,2})\s+([а-яё]+)$/iu.exec(label);
  const day = Number(sameMonth?.[2] ?? crossMonth?.[3]);
  const monthLabel = (sameMonth?.[3] ?? crossMonth?.[4])?.toLocaleLowerCase("ru-RU");
  const month = monthLabel ? MONTHS.get(monthLabel) : undefined;
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(day) || month === undefined) {
    fail("weekend label format drifted");
  }
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    fail("weekend end date is invalid");
  }
  return date.toISOString().slice(0, 10);
}

function amount(value: string): number {
  const result = Number(value.replace(/\s+/gu, ""));
  if (!Number.isSafeInteger(result) || result < 0) fail("gross is invalid");
  return result;
}

function change(direction: string | undefined, value: string | undefined): number | undefined {
  if (!direction || !value) return undefined;
  const result = Number(value.replace(",", "."));
  if (!Number.isFinite(result)) fail("change is invalid");
  return direction === "↓" ? -result : result;
}

function cleanTitle(value: string, localTitle: string): string {
  const title = value.replace(/\s+/gu, " ").trim();
  return (title || localTitle).slice(0, 220);
}

function rowSlices(markdown: string): Array<{ rank: number; localTitle: string; filmId: string; body: string }> {
  const start = markdown.indexOf("# Cборы уик-энда:");
  const end = markdown.indexOf("© boxofficemojo.com", start);
  if (start < 0 || end < 0) fail("canonical table boundary is missing");
  const table = markdown.slice(start, end);
  const rowPattern = /(?:^|\s)(\d{1,2})\.\s*(?:[+-]\d+\s*)?\[([^\]]+)\]\(https:\/\/www\.kinopoisk\.ru\/film\/(\d+)\/\)/gu;
  const matches = [...table.matchAll(rowPattern)];
  if (matches.length < 5) fail("fewer than five ranked rows were found");
  return matches.slice(0, 10).map((match, index) => ({
    rank: Number(match[1]),
    localTitle: match[2]!.trim(),
    filmId: match[3]!,
    body: table.slice(match.index! + match[0].length, matches[index + 1]?.index ?? table.length).trim(),
  }));
}

function worldChart(markdown: string, sourceId: string): CinemaChart {
  const entries = rowSlices(markdown).map((row) => {
    // The reader may retain bold markers around either gross or territory
    // counts. Strip presentation markup before applying the numeric contract.
    const body = row.body.replace(/\*\*/gu, " ").replace(/\s+/gu, " ").replace(/\s+[+-]\d+\s*$/u, "").trim();
    const parsed = /^(.*?)\s+(\d{1,3})\s+(\d{1,3}(?:\s\d{3})+)(?:\s*([↑↓])(\d+(?:[.,]\d+)?)%)?\s*(\d{1,3}(?:\s\d{3})+)\s+(\d+)$/u.exec(body);
    if (!parsed) fail(`world row ${row.rank} drifted`);
    return {
      id: `kinopoisk:${row.filmId}`,
      title: cleanTitle(parsed[1]!, row.localTitle),
      rank: row.rank,
      gross: { amount: amount(parsed[3]!), currency: "USD" },
      cumulativeGross: { amount: amount(parsed[6]!), currency: "USD" },
      ...(change(parsed[4], parsed[5]) === undefined ? {} : { changePercent: change(parsed[4], parsed[5])! }),
      weeks: Number(parsed[2]),
      sourceId,
    };
  });
  return { id: "world-weekend", label: "Мировой прокат — уикенд", region: "WORLD", period: "weekend", entries };
}

function usaChart(markdown: string, sourceId: string): CinemaChart {
  const entries = rowSlices(markdown).map((row) => {
    const parsed = /^(.*?)\[(\d{1,3})\]\*\*(\d{1,3}(?:\s\d{3})+)\*\*(?:\s*([↑↓])(\d+(?:[.,]\d+)?)%)?/u.exec(row.body);
    if (!parsed) fail(`USA row ${row.rank} drifted`);
    return {
      id: `kinopoisk:${row.filmId}`,
      title: cleanTitle(parsed[1]!, row.localTitle),
      rank: row.rank,
      gross: { amount: amount(parsed[3]!), currency: "USD" },
      ...(change(parsed[4], parsed[5]) === undefined ? {} : { changePercent: change(parsed[4], parsed[5])! }),
      weeks: Number(parsed[2]),
      sourceId,
    };
  });
  return { id: "us-weekend", label: "США — уикенд", region: "US/CA", period: "weekend", entries };
}

/**
 * Provider adapter: Kinopoisk/Jina markdown in, canonical CinemaChart out.
 * The renderer and composer never depend on provider-specific markup.
 */
export function parseKinopoiskWeekend(input: {
  markdown: string;
  sourceUrl: string;
  sourceId: string;
  market: KinopoiskWeekendMarket;
}): KinopoiskWeekendSnapshot {
  if (Buffer.byteLength(input.markdown, "utf8") > 1_024 * 1_024) fail("response exceeds 1 MiB");
  const source = kinopoiskUrl(input.sourceUrl);
  if (!source.pathname.includes(`/type/${input.market}/`)) fail("source URL market does not match adapter market");
  if (!input.markdown.includes("URL Source: https://www.kinopoisk.ru/box/")) fail("reader source identity is missing");
  return {
    weekendEnd: weekendEnd(input.markdown),
    chart: input.market === "world" ? worldChart(input.markdown, input.sourceId) : usaChart(input.markdown, input.sourceId),
  };
}
