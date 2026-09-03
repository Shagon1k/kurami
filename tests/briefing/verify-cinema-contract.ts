import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apArticlePublishedAt, parseApTopTen } from "../../src/briefing/cinema/providers/ap.ts";
import { normalizeBoxOfficeWatch } from "../../src/briefing/cinema/providers/box-office-watch.ts";
import { parseCinemaLtMovieDetails, parseCinemaLtPremieres } from "../../src/briefing/cinema/providers/cinema-lt.ts";
import { normalizeLkcSheetRows } from "../../src/briefing/cinema/providers/lkc.ts";
import { originalTitleFromBilingual } from "../../src/briefing/cinema/titles.ts";
import { kinopoiskReaderUrl, parseKinopoiskWeekend } from "../../src/briefing/cinema/providers/kinopoisk.ts";
import { parseCinemaRss } from "../../src/briefing/cinema/providers/rss.ts";
import { normalizeTmdbMovieResults } from "../../src/briefing/cinema/providers/tmdb.ts";
import { normalizeYouTubeCandidates } from "../../src/briefing/cinema/providers/youtube.ts";
import { collectCinemaCandidate } from "../../src/briefing/cinema/collector.ts";
import { runCinemaCli } from "../../src/briefing/cinema/cli.ts";
import { selectNewsCandidates, selectTrailerCandidates } from "../../src/briefing/cinema/selection.ts";
import { composeCinemaEnvelope, composeCinemaFallbackEnvelope } from "../../src/briefing/cinema/composer.ts";
import { cacheCinemaMedia } from "../../src/briefing/cinema/media-cache.ts";
import {
  cinemaEnvelopePromotable,
  parseCinemaEnvelope,
} from "../../src/briefing/cinema/model.ts";
import {
  cinemaSnapshotForDaily,
  loadCinemaSnapshot,
  promoteCinemaEdition,
  promoteCinemaSnapshot,
} from "../../src/briefing/cinema/promotion.ts";
import { cinemaEnvelopeToBriefingPayload } from "../../src/briefing/cinema/payload.ts";
import {
  cinemaPremiereCoverage,
  cinemaWeeklyCoverage,
} from "../../src/briefing/cinema/time-windows.ts";
import { loadCinemaRuntimeConfig } from "../../src/briefing/runtime-config.ts";
import { renderBriefingPage } from "../../src/briefing/ui/render-page.ts";
import {
  briefingPaths,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
  preparePreview,
  validateRenderedHtml,
  type BriefingPaths,
} from "../../src/briefing/store.ts";

const root = resolve(import.meta.dirname, "../..");
const fixture = (name: string): Promise<string> => readFile(
  resolve(root, "tests/fixtures/briefing/cinema", name),
  "utf8",
);

function xmlText(value: unknown): string {
  return String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function cellReference(index: number, row: number): string {
  let column = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    column = String.fromCharCode(65 + ((value - 1) % 26)) + column;
  }
  return `${column}${row}`;
}

function storedZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(nameBuffer.byteLength, 26);
    locals.push(local, nameBuffer, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(nameBuffer.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += local.byteLength + nameBuffer.byteLength + data.byteLength;
  }
  const centralOffset = offset;
  const centralSize = centrals.reduce((total, part) => total + part.byteLength, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function lkcWorkbookFixture(rows: unknown[][]): Buffer {
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const reference = cellReference(columnIndex, rowIndex + 1);
    return typeof value === "number"
      ? `<c r="${reference}"><v>${value}</v></c>`
      : `<c r="${reference}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return storedZip({
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

const config = await loadCinemaRuntimeConfig(
  { home: root } as never,
  { BRIEFING_CONFIG_PATH: resolve(root, "deploy/config/briefing.yaml") } as NodeJS.ProcessEnv,
);
assert.equal(config.enabled, true);
assert.equal(config.market, "LT");
assert.equal(config.timeZone, "Europe/Vilnius");
assert.equal(config.limits.trailers, 9);
assert.equal(config.limits.news, 15);
assert.equal(config.sources.youtube.channels.length, 15);
assert.equal(config.sources.youtube.channels.filter((channel) => channel.role === "discovery").length, 1);
assert.equal(config.sources.youtube.channels.find((channel) => channel.key === "warner-bros")?.id, "UCjmJDM5pRKbUlVIzDYYWb6g");
assert.equal(kinopoiskReaderUrl(config.sources.kinopoisk.worldWeekendUrl, config.sources.kinopoisk.readerBaseUrl).toString(), "https://r.jina.ai/https://www.kinopoisk.ru/box/type/world/");

const weekly = cinemaWeeklyCoverage("2026-08-29", config.timeZone);
assert.deepEqual(weekly, {
  start: "2026-08-22T06:00:00.000Z",
  end: "2026-08-29T06:00:00.000Z",
});
const dstWeekly = cinemaWeeklyCoverage("2026-10-31", config.timeZone);
assert.equal((Date.parse(dstWeekly.end) - Date.parse(dstWeekly.start)) / 3_600_000, 169);
const premieresCoverage = cinemaPremiereCoverage("2026-08-29", config.timeZone);
assert.deepEqual(premieresCoverage, {
  start: "2026-08-30T21:00:00.000Z",
  end: "2026-09-06T21:00:00.000Z",
});
assert.throws(() => cinemaWeeklyCoverage("2026-08-28", config.timeZone), /Saturday/u);

const boxOfficeFixture = JSON.parse(await fixture("box-office-watch.json")) as Record<string, unknown>;
const boxOffice = normalizeBoxOfficeWatch({
  weekend: boxOfficeFixture.weekend,
  yearly: boxOfficeFixture.yearly,
  editionDate: "2026-08-29",
  sourceId: "source:bow",
});
assert.equal(boxOffice.weekendEnd, "2026-08-23");
assert.equal(boxOffice.charts[0]?.entries.length, 6);
assert.equal(boxOffice.charts[2]?.entries.length, 5);
assert.equal(boxOffice.signals.find((signal) => signal.kind === "largest-debut")?.filmId, "bow:insidious-out-of-the-further");
assert.equal(boxOffice.signals.find((signal) => signal.kind === "largest-debut")?.filmTitle, "Insidious: Out of the Further");
assert.equal(boxOffice.signals.find((signal) => signal.kind === "best-hold")?.filmId, "bow:the-odyssey");
const debutTrend = boxOffice.trend.find((series) => series.id === "bow:insidious-out-of-the-further");
assert.deepEqual(debutTrend?.points.map((point) => point.gross), [null, null, null, null, null, 25304111]);
assert.equal(debutTrend?.points.at(-1)?.debut, true);

const ap = parseApTopTen({
  html: await fixture("ap-top-ten.html"),
  sourceUrl: "https://apnews.com/article/box-office-example-123",
  sourceId: "source:ap",
});
assert.equal(ap.entries.length, 10);
assert.equal(ap.entries[0]?.gross.amount, 39_000_000);
assert.equal(ap.entries[9]?.rank, 10);
assert.equal(apArticlePublishedAt('<meta property="article:published_time" content="2026-08-28T12:00:00Z">'), "2026-08-28T12:00:00.000Z");

const lkcRows = JSON.parse(await fixture("lkc-rows.json")) as unknown[][];
const lkc = normalizeLkcSheetRows(lkcRows);
assert.equal(lkc.length, 2);
assert.equal(lkc[0]?.title, "The Odyssey");
assert.equal(lkc[1]?.title, "Spider-Man: Brand New Day");
assert.equal(lkc[0]?.changePercent, 50.4510964130685);
assert.equal(lkc[0]?.releaseDate, "2026-07-17");
assert.equal(originalTitleFromBilingual("Vietinis pavadinimas (Original Title (IMAX))"), "Original Title (IMAX)");
assert.equal(originalTitleFromBilingual("Only Available Title"), "Only Available Title");
assert.throws(
  () => normalizeLkcSheetRows([lkcRows[0]!, lkcRows[1]!.slice(0, 4), lkcRows[2]!]),
  /missing header/u,
);
const lkcWithMissingShowCount = structuredClone(lkcRows);
lkcWithMissingShowCount[2]![7] = "-";
assert.equal(normalizeLkcSheetRows(lkcWithMissingShowCount)[0]?.showCount, undefined);
const lkcWithTotalFooter = structuredClone(lkcRows);
lkcWithTotalFooter.push([14, null, "Total (2)", 100_000]);
assert.equal(normalizeLkcSheetRows(lkcWithTotalFooter).length, 2);
const lkcWorkbook = lkcWorkbookFixture(lkcRows);

const cinemaLt = parseCinemaLtPremieres({
  html: await fixture("cinema-lt.html"),
  coverage: premieresCoverage,
  timeZone: config.timeZone,
});
assert.equal(cinemaLt.length, 1);
assert.equal(cinemaLt[0]?.originalTitle, "Future Film");
assert.equal(cinemaLt[0]?.releaseDate, "2026-09-04");
const cinemaLtDetails = parseCinemaLtMovieDetails(await fixture("cinema-lt-detail.html"));
assert.deepEqual(cinemaLtDetails.genres, ["Drama", "Adventure"]);
assert.deepEqual(cinemaLtDetails.directors, ["Greta Example"]);
assert.deepEqual(cinemaLtDetails.cast, ["Alex Actor", "Mira Star", "Jonas Player", "Lina Hero"]);
assert.equal(cinemaLtDetails.runtimeMinutes, 127);
assert.equal(cinemaLtDetails.ageRating, "N-13");

const kinopoiskWorld = parseKinopoiskWeekend({
  markdown: await fixture("kinopoisk-world.md"),
  sourceUrl: config.sources.kinopoisk.worldWeekendUrl,
  sourceId: "source:kinopoisk-world",
  market: "world",
});
assert.equal(kinopoiskWorld.weekendEnd, "2026-08-23");
assert.equal(kinopoiskWorld.chart.id, "world-weekend");
assert.equal(kinopoiskWorld.chart.entries.length, 8);
assert.equal(kinopoiskWorld.chart.entries[0]?.title, "The Odyssey");
assert.equal(kinopoiskWorld.chart.entries[0]?.gross.amount, 48_698_000);
assert.equal(kinopoiskWorld.chart.entries[0]?.changePercent, -28);
const kinopoiskUsa = parseKinopoiskWeekend({
  markdown: await fixture("kinopoisk-usa.md"),
  sourceUrl: config.sources.kinopoisk.usaWeekendUrl,
  sourceId: "source:kinopoisk-usa",
  market: "usa",
});
assert.equal(kinopoiskUsa.chart.entries.length, 5);
assert.equal(kinopoiskUsa.chart.entries[0]?.title, "Spider-Man: Brand New Day");
assert.equal(kinopoiskUsa.chart.entries[0]?.gross.amount, 22_513_101);

const youtube = normalizeYouTubeCandidates({
  response: JSON.parse(await fixture("youtube.json")),
  channels: config.sources.youtube.channels,
  coverage: weekly,
});
assert.equal(youtube.length, 1);
assert.equal(youtube[0]?.publisher, "Warner Bros.");
assert.equal(youtube[0]?.durationSeconds, 151);

// Composio's channel-list tool returns playlist items: the top-level `id` is
// the playlist item, while the stable video ID lives in snippet.resourceId.
const composioPlaylistItem = normalizeYouTubeCandidates({
  response: {
    data: {
      items: [{
        id: "VVVqbUpETTVwUktiVWxWSXpEWVlXYjZnLjA4TTFOVGVtS1NV",
        kind: "youtube#playlistItem",
        snippet: {
          channelId: "UCjmJDM5pRKbUlVIzDYYWb6g",
          title: "Practical Magic 2 — Official Trailer",
          description: "Official trailer.",
          publishedAt: "2026-08-28T20:00:15Z",
          resourceId: { kind: "youtube#video", videoId: "08M1NTemKSU" },
          thumbnails: { high: { url: "https://i.ytimg.com/vi/08M1NTemKSU/hqdefault.jpg" } },
        },
      }],
    },
    successful: true,
  },
  channels: config.sources.youtube.channels,
  coverage: weekly,
});
assert.equal(composioPlaylistItem.length, 1);
assert.equal(composioPlaylistItem[0]?.videoId, "08M1NTemKSU");
assert.equal(composioPlaylistItem[0]?.sourceUrl, "https://www.youtube.com/watch?v=08M1NTemKSU");

const selectedTrailers = selectTrailerCandidates([
  ...youtube,
  {
    ...youtube[0]!,
    id: "youtube:StreetFi001",
    videoId: "StreetFi001",
    title: "Street Fighter | New Trailer (2026 Movie)",
    sourceUrl: "https://www.youtube.com/watch?v=StreetFi001",
  },
  {
    ...youtube[0]!,
    id: "youtube:StreetFi002",
    videoId: "StreetFi002",
    title: "Street Fighter | Playable Trailer (2026 Movie)",
    sourceUrl: "https://www.youtube.com/watch?v=StreetFi002",
  },
  {
    ...youtube[0]!,
    id: "youtube:PromoCopy01",
    videoId: "PromoCopy01",
    title: "The new Street Fighter trailer just dropped. Watch the new trailer now",
    sourceUrl: "https://www.youtube.com/watch?v=PromoCopy01",
  },
  {
    ...youtube[0]!,
    id: "youtube:Archive1993",
    videoId: "Archive1993",
    title: "UNDERCOVER BLUES (1993) | Official Trailer",
    sourceUrl: "https://www.youtube.com/watch?v=Archive1993",
  },
], 9);
assert.equal(selectedTrailers.filter((item) => item.filmKey === "street fighter").length, 1);
assert.equal(selectedTrailers.some((item) => item.videoId === "PromoCopy01"), false);
assert.equal(selectedTrailers.some((item) => item.videoId === "Archive1993"), false);
const prolificTitles = ["Atlas Rising", "Copper Lake", "Distant Harbor", "Emerald City", "Frozen Valley"];
const prolificPublisher = prolificTitles.map((title, index) => ({
  ...youtube[0]!,
  id: `youtube:prolific${index}`,
  videoId: `Prolific${String(index).padStart(3, "0")}`,
  title: `${title} — Official Trailer`,
  sourceUrl: `https://www.youtube.com/watch?v=Prolific${String(index).padStart(3, "0")}`,
}));
assert.equal(selectTrailerCandidates(prolificPublisher, 9).length, 3);
const mixedPublishers = prolificPublisher.concat(
  ["North Star", "Open Water", "Stone House", "Night Train", "Bright Field", "Quiet River"].map((title, index) => ({
    ...youtube[0]!,
    id: `youtube:mixed${index}`,
    videoId: `Mixed${String(index).padStart(6, "0")}`,
    publisher: `Publisher ${index + 1}`,
    publisherChannelId: `UC${String(index + 1).repeat(22)}`,
    title: `${title} — Official Trailer`,
    sourceUrl: `https://www.youtube.com/watch?v=Mixed${String(index).padStart(6, "0")}`,
  })),
);
const mixedSelection = selectTrailerCandidates(mixedPublishers, 9);
assert.equal(mixedSelection.length, 9);
assert.equal(Math.max(...[...new Set(mixedSelection.map((item) => item.publisherChannelId))].map(
  (publisher) => mixedSelection.filter((item) => item.publisherChannelId === publisher).length,
)), 3);

const rssSpecs = [
  ["rss-variety.xml", "Variety", "variety.com"],
  ["rss-deadline.xml", "Deadline", "deadline.com"],
  ["rss-thr.xml", "The Hollywood Reporter", "www.hollywoodreporter.com"],
  ["rss-indiewire.xml", "IndieWire", "www.indiewire.com"],
] as const;
const rssStories = [];
for (const [name, publisher, expectedHost] of rssSpecs) {
  const stories = parseCinemaRss({
    xml: await fixture(name),
    publisher,
    expectedHost,
    coverage: weekly,
  });
  assert.equal(stories.length, 1);
  rssStories.push(...stories);
}
assert.equal(rssStories.find((story) => story.publisher === "Variety")?.imageUrl?.includes("variety.com"), true);
assert.equal(rssStories.find((story) => story.publisher === "IndieWire")?.imageUrl, undefined);

const newsCandidate = (id: string, publisher: string, title: string, excerpt: string, categories: string[] = []) => ({
  id,
  publisher,
  title,
  excerpt,
  categories,
  publishedAt: "2026-08-28T12:00:00Z",
  sourceUrl: `https://${publisher === "Variety" ? "variety.com" : "deadline.com"}/${id}`,
});
const qualifiedNews = selectNewsCandidates([
  newsCandidate("sandra-a", "Variety", "Sandra Hüller, Maria Schrader Team Up for ‘Arbeit und Struktur’", "The film enters production.", ["Film"]),
  newsCandidate("sandra-b", "Deadline", "Sandra Hüller To Star As Wolfgang Herrndorf In Maria Schrader’s ‘Work And Structure’", "The movie enters production.", ["Film"]),
  newsCandidate("hotel", "Variety", "Four Seasons Launches Refresh of Hotel Danieli", "The Venice hotel has appeared in movies.", ["Travel"]),
  newsCandidate("hotel-film-category", "Variety", "Four Seasons Launches Refresh of Hotel Danieli", "The Venice hotel hosts a festival crowd.", ["Film"]),
  newsCandidate("tv-season", "Deadline", "The Gentlemen Season 3 Adds a New Showrunner", "The television series continues.", ["Film"]),
  newsCandidate("unscripted", "Variety", "Asian Male Pageantry Competition Series Heads to Buyers", "An unscripted television format seeks a buyer at a film market.", ["Film"]),
  newsCandidate("tv-market", "Variety", "Nippon TV Sets Tokyo Market Conference Lineup", "Broadcasters will discuss television formats.", ["Film"]),
  newsCandidate("deal", "Deadline", "Studio Acquires New Animated Feature for Global Theatrical Release", "The distribution deal closes this week.", ["Film"]),
], weekly.end, 20);
assert.equal(qualifiedNews.length, 2);
assert.equal(qualifiedNews.some((story) => story.id === "deal"), true);
assert.equal(qualifiedNews.some((story) => story.id === "hotel-film-category"), false);
assert.equal(qualifiedNews.some((story) => story.id === "tv-season"), false);
assert.equal(qualifiedNews.some((story) => story.id === "unscripted"), false);
assert.equal(qualifiedNews.some((story) => story.id === "tv-market"), false);
assert.equal(qualifiedNews.filter((story) => story.id.startsWith("sandra-")).length, 1);

const tmdb = normalizeTmdbMovieResults(JSON.parse(await fixture("tmdb.json")));
assert.equal(tmdb.length, 1);
assert.equal(tmdb[0]?.id, 123456);
assert.equal(tmdb[0]?.posterPath, "/future-film.jpg");

const rssByUrl = new Map<string, string>([
  [config.sources.weeklyNews.variety, await fixture("rss-variety.xml")],
  [config.sources.weeklyNews.deadline, await fixture("rss-deadline.xml")],
  [config.sources.weeklyNews.hollywoodReporter, await fixture("rss-thr.xml")],
  [config.sources.weeklyNews.indiewire, await fixture("rss-indiewire.xml")],
]);
const kinopoiskWorldTransport = kinopoiskReaderUrl(
  config.sources.kinopoisk.worldWeekendUrl,
  config.sources.kinopoisk.readerBaseUrl,
).toString();
const kinopoiskUsaTransport = kinopoiskReaderUrl(
  config.sources.kinopoisk.usaWeekendUrl,
  config.sources.kinopoisk.readerBaseUrl,
).toString();
const collectorFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url === config.sources.boxOfficeWatch.weekendUrl) {
    return new Response(JSON.stringify(boxOfficeFixture.weekend), { status: 200 });
  }
  if (url === config.sources.boxOfficeWatch.yearlyUrl) {
    return new Response(JSON.stringify(boxOfficeFixture.yearly), { status: 200 });
  }
  if (url === kinopoiskWorldTransport) return new Response(await fixture("kinopoisk-world.md"), { status: 200 });
  if (url === kinopoiskUsaTransport) return new Response(await fixture("kinopoisk-usa.md"), { status: 200 });
  if (url === config.sources.cinemaLt.repertoireUrl) {
    return new Response(await fixture("cinema-lt.html"), { status: 200 });
  }
  if (url === "https://cinema.lt/filmai/ateities-filmas") {
    return new Response(await fixture("cinema-lt-detail.html"), { status: 200 });
  }
  if (url === config.sources.lkc.reportsUrl) {
    return new Response('<a href="/docs/Filmu rodymo ataskaitos/Savaitgalio (Weekend) TOP 2026.08.21-08.23.xlsx">LKC</a>', { status: 200 });
  }
  if (url === new URL("/docs/Filmu rodymo ataskaitos/Savaitgalio (Weekend) TOP 2026.08.21-08.23.xlsx", config.sources.lkc.reportsUrl).toString()) {
    return new Response(Uint8Array.from(lkcWorkbook), { status: 200 });
  }
  const rss = rssByUrl.get(url);
  if (rss) return new Response(rss, { status: 200 });
  return new Response("not found", { status: 404 });
};
const collected = await collectCinemaCandidate({
  localDate: "2026-08-29",
  config,
  fetchImpl: collectorFetch,
  caller: async (name, arguments_) => {
    assert.equal(name, "YOUTUBE_LIST_CHANNEL_VIDEOS");
    assert.equal(typeof arguments_.channelId, "string");
    assert.equal(arguments_.maxResults, 25);
    assert.equal(arguments_.part, "snippet");
    assert.equal("published_after" in arguments_, false);
    return JSON.parse(await fixture("youtube.json"));
  },
  retry: { attempts: 1, timeoutMs: 1_000 },
  now: () => new Date("2026-08-29T06:05:00Z"),
});
assert.equal(collected.boxOffice.state, "ready");
assert.equal(collected.boxOffice.charts.find((chart) => chart.id === "world-weekend")?.entries.length, 8);
assert.equal(collected.boxOffice.charts.find((chart) => chart.id === "lt-weekend")?.entries.length, 2);
assert.equal(collected.trailers.state, "ready");
assert.equal(collected.trailers.candidates.length, 1);
assert.equal(collected.premieres.state, "ready");
assert.deepEqual(collected.premieres.candidates[0]?.directors, ["Greta Example"]);
assert.equal(collected.news.state, "ready");
assert.equal(collected.news.candidates.length, 4);
assert.equal(collected.diagnostics.length, 0);

const apArticleUrl = "https://apnews.com/article/weekly-box-office-test";
const fallbackCollected = await collectCinemaCandidate({
  localDate: "2026-08-29",
  config,
  fetchImpl: async (input) => {
    const url = String(input);
    if (url === config.sources.boxOfficeWatch.weekendUrl || url === config.sources.boxOfficeWatch.yearlyUrl) {
      return new Response("unavailable", { status: 503 });
    }
    if (url === config.sources.apMovies.discoveryUrl) {
      return new Response('<a href="/article/weekly-box-office-test">box office</a>', { status: 200 });
    }
    if (url === apArticleUrl) return new Response(`<meta property="article:published_time" content="2026-08-28T12:00:00Z">${await fixture("ap-top-ten.html")}`, { status: 200 });
    return collectorFetch(input);
  },
  caller: async () => JSON.parse(await fixture("youtube.json")),
  retry: { attempts: 1, timeoutMs: 1_000 },
  now: () => new Date("2026-08-29T06:05:00Z"),
});
assert.equal(fallbackCollected.boxOffice.state, "partial");
assert.equal(fallbackCollected.boxOffice.charts.find((chart) => chart.id === "us-weekend")?.entries.length, 10);
assert.equal(fallbackCollected.provenance.some((source) => source.provider === "Associated Press"), true);
assert.equal(fallbackCollected.boxOffice.trend.length, 0);

const kinopoiskFallbackCollected = await collectCinemaCandidate({
  localDate: "2026-09-05",
  config,
  fetchImpl: async (input) => {
    const url = String(input);
    if (url === config.sources.boxOfficeWatch.weekendUrl || url === config.sources.boxOfficeWatch.yearlyUrl
      || url === config.sources.apMovies.discoveryUrl) {
      return new Response("unavailable", { status: 503 });
    }
    if (url === kinopoiskWorldTransport) {
      const currentWorld = (await fixture("kinopoisk-world.md")).replace("№34, 21—23 августа", "№35, 28—30 августа");
      return new Response(currentWorld, { status: 200 });
    }
    if (url === kinopoiskUsaTransport) return new Response(await fixture("kinopoisk-usa.md"), { status: 200 });
    return collectorFetch(input);
  },
  caller: async () => JSON.parse(await fixture("youtube.json")),
  retry: { attempts: 1, timeoutMs: 1_000 },
  now: () => new Date("2026-09-05T06:05:00Z"),
});
assert.equal(kinopoiskFallbackCollected.boxOffice.state, "partial");
assert.equal(kinopoiskFallbackCollected.boxOffice.charts.find((chart) => chart.id === "us-weekend")?.entries[0]?.title, "Spider-Man: Brand New Day");
assert.equal(kinopoiskFallbackCollected.provenance.filter((source) => source.provider === "Kinopoisk").length, 2);
assert.equal(kinopoiskFallbackCollected.boxOffice.trend.length, 0);

const editorialDraft = {
  version: 1,
  localDate: "2026-08-29",
  news: collected.news.candidates.map((candidate, index) => ({
    candidateId: candidate.id,
    headline: `Кинематографическая новость недели номер ${index + 1}`,
    summary: `Проверенный источник сообщил важную деталь киноиндустрии; этот краткий пересказ сохраняет факты и не меняет исходные данные номер ${index + 1}.`,
  })),
  notes: [{ id: "note:test", target: `news:${collected.news.candidates[0]!.id}`, text: "вот это поворот", mark: "arrow-down-left" }],
};
const mediaRoot = await mkdtemp(resolve(tmpdir(), "kurami-cinema-media-"));
const missingNewsImage = collected.news.candidates.find((item) => !item.imageUrl);
const fallbackImageUrl = missingNewsImage ? new URL("/fallback-cinema.jpg", missingNewsImage.sourceUrl).toString() : "";
const cachedMedia = await cacheCinemaMedia({
  candidate: collected,
  draft: editorialDraft,
  config,
  mediaRoot,
  fetchImpl: async (input) => String(input) === missingNewsImage?.sourceUrl
    ? new Response(`<html><head><meta property="og:image" content="${fallbackImageUrl}?w=1440&#038;h=810"></head></html>`, { status: 200 })
    : new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { status: 200 }),
  retry: { attempts: 1, timeoutMs: 1_000 },
});
assert.equal(cachedMedia.cached > 0, true);
if (missingNewsImage) assert.equal(typeof cachedMedia.media[missingNewsImage.id], "string");
assert.equal(Object.values(cachedMedia.media).every((path) => path.startsWith("/media/cinema/2026-08-29/")), true);
await rm(mediaRoot, { recursive: true, force: true });
const composed = composeCinemaEnvelope({ candidate: collected, config, draft: editorialDraft, media: cachedMedia.media });
assert.equal(composed.state, "ready");
assert.equal(composed.data.news.items.length, 4);
assert.equal(composed.data.news.items[0]?.publisher.length !== 0, true);
assert.throws(() => composeCinemaEnvelope({
  candidate: collected,
  config,
  draft: {
    version: 1,
    localDate: "2026-08-29",
    news: [{
      candidateId: collected.news.candidates[0]!.id,
      headline: "Что произошло: очередная история",
      summary: "Русский пересказ достаточной длины, который всё равно не должен пропустить запрещённый шаблон заголовка.",
    }],
    notes: [],
  },
}), /forbidden generic copy/u);
const fallback = composeCinemaFallbackEnvelope({ candidate: collected, config });
assert.equal(fallback.data.news.state, "failed");
assert.equal(fallback.data.news.items.length, 0);
assert.equal(fallback.state, "partial");

const source = (id: string, provider: string, url: string) => ({
  id,
  provider,
  url,
  fetchedAt: "2026-08-29T06:05:00Z",
});
const rawEnvelope = {
  version: 1,
  state: "ready",
  capturedAt: "2026-08-29T06:05:00Z",
  data: {
    market: "LT",
    timezone: config.timeZone,
    language: "ru",
    localDate: "2026-08-29",
    coverage: {
      boxOffice: { start: "2026-08-21T00:00:00Z", end: "2026-08-24T00:00:00Z" },
      trailers: weekly,
      premieres: premieresCoverage,
      news: weekly,
    },
    boxOffice: {
      state: "ready",
      capturedAt: "2026-08-29T06:05:00Z",
      featuredId: boxOffice.featuredId,
      charts: boxOffice.charts,
      signals: boxOffice.signals,
      trend: boxOffice.trend,
      globalPulse: [],
      provenance: ["source:bow"],
    },
    trailers: {
      state: "ready",
      capturedAt: "2026-08-29T06:05:00Z",
      items: youtube.map((item) => ({
        ...item,
        trailerType: "main",
        sourceId: "source:youtube",
      })),
      provenance: ["source:youtube"],
    },
    premieres: {
      state: "ready",
      capturedAt: "2026-08-29T06:05:00Z",
      items: cinemaLt.map((item) => ({
        ...item,
        sourceId: "source:cinema-lt",
      })),
      provenance: ["source:cinema-lt"],
    },
    news: {
      state: "ready",
      capturedAt: "2026-08-29T06:05:00Z",
      items: rssStories.map((item) => ({
        id: item.id,
        headline: item.title,
        summary: item.excerpt,
        publisher: item.publisher,
        publishedAt: item.publishedAt,
        sourceUrl: item.sourceUrl,
        sourceId: `source:${item.publisher.toLocaleLowerCase("en-US").replace(/[^a-z]+/gu, "-")}`,
      })),
      provenance: rssStories.map((item) => `source:${item.publisher.toLocaleLowerCase("en-US").replace(/[^a-z]+/gu, "-")}`),
    },
    notes: [{ id: "note:box", target: "box-office", text: "цифры пошли в кино", mark: "arrow-down-left" }],
    quality: { summary: "Все основные источники готовы.", diagnostics: [] },
    provenance: [
      source("source:bow", "box-office-watch", "https://boxofficewatch.com/data/weekend.json"),
      source("source:youtube", "youtube", "https://www.youtube.com/watch?v=AbCdEfGhI12"),
      source("source:cinema-lt", "cinema-lt", "https://cinema.lt/repertuaras"),
      ...rssStories.map((item) => source(
        `source:${item.publisher.toLocaleLowerCase("en-US").replace(/[^a-z]+/gu, "-")}`,
        item.publisher,
        item.sourceUrl,
      )),
    ],
  },
};
const envelope = parseCinemaEnvelope(rawEnvelope);
assert.equal(cinemaEnvelopePromotable(envelope), true);
assert.equal(envelope.data.news.items.length, 4);
assert.throws(
  () => parseCinemaEnvelope({
    ...rawEnvelope,
    data: {
      ...rawEnvelope.data,
      premieres: {
        ...rawEnvelope.data.premieres,
        items: [{ ...rawEnvelope.data.premieres.items[0], posterSrc: "https://example.com/poster.jpg" }],
      },
    },
  }),
  /edition-owned Cinema media path/u,
);
const partial = parseCinemaEnvelope({
  ...rawEnvelope,
  state: "partial",
  data: {
    ...rawEnvelope.data,
    boxOffice: { ...rawEnvelope.data.boxOffice, state: "failed", featuredId: undefined, charts: [], signals: [], trend: [], provenance: [] },
    trailers: { ...rawEnvelope.data.trailers, state: "failed", items: [], provenance: [] },
  },
});
assert.equal(cinemaEnvelopePromotable(partial), true);
const insufficient = parseCinemaEnvelope({
  ...rawEnvelope,
  state: "partial",
  data: {
    ...rawEnvelope.data,
    boxOffice: { ...rawEnvelope.data.boxOffice, state: "failed", featuredId: undefined, charts: [], signals: [], trend: [], provenance: [] },
    trailers: { ...rawEnvelope.data.trailers, state: "failed", items: [], provenance: [] },
    news: { ...rawEnvelope.data.news, state: "failed", items: [], provenance: [] },
  },
});
assert.equal(cinemaEnvelopePromotable(insufficient), false);

const snapshotDatabase = new DatabaseSync(":memory:");
snapshotDatabase.exec(`
  CREATE TABLE addon_snapshots (
    addon_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    state TEXT NOT NULL CHECK (state IN ('ready', 'empty', 'partial', 'stale', 'failed')),
    payload_json TEXT NOT NULL,
    content_digest TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
`);
const firstPromotion = promoteCinemaSnapshot(snapshotDatabase, envelope);
assert.equal(firstPromotion.status, "promoted");
assert.equal(loadCinemaSnapshot(snapshotDatabase)?.data.localDate, "2026-08-29");
assert.equal(cinemaSnapshotForDaily(snapshotDatabase, "2026-08-29")?.data.localDate, "2026-08-29");
assert.equal(cinemaSnapshotForDaily(snapshotDatabase, "2026-08-30"), undefined);
assert.equal(promoteCinemaSnapshot(snapshotDatabase, envelope).status, "unchanged");
const beforeRejected = firstPromotion.status === "promoted" ? firstPromotion.contentDigest : "";
const rejected = promoteCinemaSnapshot(snapshotDatabase, insufficient);
assert.equal(rejected.status, "rejected");
assert.equal(loadCinemaSnapshot(snapshotDatabase)?.data.localDate, "2026-08-29");
assert.equal(
  promoteCinemaSnapshot(snapshotDatabase, {
    ...rawEnvelope,
    capturedAt: "2026-08-29T05:00:00Z",
    data: {
      ...rawEnvelope.data,
      quality: { summary: "Older rerun", diagnostics: [] },
    },
  }).status,
  "rejected",
);
const revisedPromotion = promoteCinemaSnapshot(snapshotDatabase, {
  ...rawEnvelope,
  capturedAt: "2026-08-29T06:10:00Z",
  data: {
    ...rawEnvelope.data,
    quality: { summary: "Validated newer rerun", diagnostics: [] },
  },
});
assert.equal(revisedPromotion.status, "promoted");
assert.notEqual(
  revisedPromotion.status === "promoted" ? revisedPromotion.contentDigest : "",
  beforeRejected,
);
snapshotDatabase.close();

const cinemaPayload = cinemaEnvelopeToBriefingPayload(envelope);
const cinemaHtml = renderBriefingPage(cinemaPayload);
validateRenderedHtml(cinemaHtml, cinemaPayload);
for (const marker of [
  "Пульс проката",
  "Трейлеры недели",
  "Премьеры",
  "Новости",
  "data-cinema-trend",
  "data-trend-key",
  "Последний уикенд",
  "С начала года",
  "Мировой прокат — уикенд",
  "Литва — с начала года",
  "Нет надёжных данных",
  "data-cinema-edition=\"2026-08-29\"",
  "Kurami Cinema",
]) assert.match(cinemaHtml, new RegExp(marker));
assert.match(cinemaHtml, /\.cinema-trend__series circle \{ fill: var\(--trend-color\)/u);
assert.doesNotMatch(cinemaHtml, /<b>Бюджет<\/b>/u);
assert.doesNotMatch(cinemaHtml, /Kurami Daily Briefing/u);
const legacyBilingualEnvelope = parseCinemaEnvelope({
  ...rawEnvelope,
  data: {
    ...rawEnvelope.data,
    boxOffice: {
      ...rawEnvelope.data.boxOffice,
      charts: rawEnvelope.data.boxOffice.charts.map((chart) => chart.id === "lt-weekend" ? {
        ...chart,
        entries: chart.entries.map((entry, index) => index === 0
          ? { ...entry, title: "Odisėja (The Odyssey)" }
          : entry),
      } : chart),
    },
  },
});
const legacyBilingualHtml = renderBriefingPage(cinemaEnvelopeToBriefingPayload(legacyBilingualEnvelope));
assert.match(legacyBilingualHtml, /<th scope="row">The Odyssey<\/th>/u);
assert.doesNotMatch(legacyBilingualHtml, /Odisėja \(The Odyssey\)/u);
const prolificEnvelope = parseCinemaEnvelope({
  ...rawEnvelope,
  data: {
    ...rawEnvelope.data,
    trailers: {
      ...rawEnvelope.data.trailers,
      items: prolificPublisher.map((item) => ({
        ...item,
        trailerType: "main",
        sourceId: "source:youtube",
      })),
    },
  },
});
const prolificHtml = renderBriefingPage(cinemaEnvelopeToBriefingPayload(prolificEnvelope));
assert.match(prolificHtml, /Atlas Rising/u);
assert.match(prolificHtml, /Distant Harbor/u);
assert.doesNotMatch(prolificHtml, /Emerald City|Frozen Valley/u);
const mixedEnvelope = parseCinemaEnvelope({
  ...rawEnvelope,
  data: {
    ...rawEnvelope.data,
    trailers: {
      ...rawEnvelope.data.trailers,
      items: mixedSelection.map((item) => ({
        ...item,
        trailerType: "main",
        sourceId: "source:youtube",
      })),
    },
  },
});
const mixedHtml = renderBriefingPage(cinemaEnvelopeToBriefingPayload(mixedEnvelope));
assert.equal((mixedHtml.match(/<a class="cinema-trailer"/gu) ?? []).length, 9);
if (process.env.CINEMA_FIXTURE_OUTPUT) {
  await writeFile(resolve(process.env.CINEMA_FIXTURE_OUTPUT), cinemaHtml, "utf8");
}

const saturdayDaily = {
  ...cinemaPayload,
  schemaVersion: 2 as const,
  edition: {
    ...cinemaPayload.edition,
    id: "daily:2026-08-29",
    type: "daily" as const,
  },
};
const dailyHtml = renderBriefingPage(saturdayDaily);
assert.match(dailyHtml, /Субботний add-on/u);
assert.match(dailyHtml, /href="\/cinema"/u);
assert.doesNotMatch(dailyHtml, /Box-office pulse/u);

const manualPreviewHtml = renderBriefingPage({
  ...saturdayDaily,
  edition: { ...saturdayDaily.edition, id: "daily:2026-08-28", localDate: "2026-08-28" },
});
assert.match(manualPreviewHtml, /Субботний add-on/u);

const isolatedFailureHtml = renderBriefingPage({
  ...saturdayDaily,
  addons: {
    cinema: { version: 1, state: "ready", capturedAt: envelope.capturedAt, data: {} },
  },
});
assert.doesNotMatch(isolatedFailureHtml, /Субботний add-on|Cinema не собрался/u);

const atomicRoot = await mkdtemp(resolve(tmpdir(), "kurami-cinema-atomic-"));
const atomicState = resolve(atomicRoot, "state/briefing");
const atomicPaths: BriefingPaths = {
  home: root,
  stateDirectory: atomicState,
  pagesDirectory: resolve(atomicState, "pages"),
  previewDirectory: resolve(atomicState, "pages/preview"),
  mediaDirectory: resolve(atomicState, "media"),
  mediaInboxDirectory: resolve(atomicState, "media-inbox"),
  databasePath: resolve(atomicState, "briefing.db"),
  migrationsDirectory: resolve(root, "migrations/briefing"),
  runsDirectory: resolve(atomicState, "runs"),
  recoveryDirectory: resolve(atomicState, "recovery"),
  artifactsDirectory: resolve(atomicRoot, "artifacts"),
  stateArtifactsDirectory: resolve(atomicState, "artifacts"),
};
try {
  await initializeBriefingStore(atomicPaths);
  await preparePreview(cinemaPayload, cinemaHtml, atomicPaths);
  const atomicDatabase = openBriefingDatabase(atomicPaths);
  try {
    const atomicPromotion = promoteCinemaEdition(
      atomicDatabase,
      cinemaPayload.edition.id,
      envelope,
    );
    assert.equal(atomicPromotion.status, "promoted");
    assert.equal(atomicPromotion.status === "promoted" ? atomicPromotion.publicationPath : "", "/cinema");
    assert.equal(loadEdition(atomicDatabase, { type: "cinema", current: true })?.id, cinemaPayload.edition.id);
    assert.equal(loadCinemaSnapshot(atomicDatabase)?.data.localDate, cinemaPayload.edition.localDate);
  } finally {
    atomicDatabase.close();
  }

} finally {
  await rm(atomicRoot, { recursive: true, force: true });
}

const cliRoot = await mkdtemp(resolve(tmpdir(), "kurami-cinema-cli-"));
try {
  const envelopePath = resolve(cliRoot, "cinema-envelope.json");
  await writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  const cliEnvironment = {
    ...process.env,
    KURAMI_HOME: cliRoot,
    BRIEFING_MIGRATIONS_DIR: resolve(root, "migrations/briefing"),
    BRIEFING_CONFIG_PATH: resolve(root, "deploy/config/briefing.yaml"),
  } as NodeJS.ProcessEnv;
  const preparedByCli = await runCinemaCli(["prepare", "--envelope", envelopePath], cliEnvironment);
  assert.equal(preparedByCli.action, "cinema-prepare");
  const promotedByCli = await runCinemaCli(["promote", "--envelope", envelopePath], cliEnvironment);
  assert.equal(promotedByCli.action, "cinema-promote");
  assert.equal(promotedByCli.publicationPath, "/cinema");
  const sameSaturdayEnvelope = parseCinemaEnvelope({
    ...rawEnvelope,
    capturedAt: "2026-08-29T06:30:00Z",
    data: {
      ...rawEnvelope.data,
      quality: { summary: "Fresh same-Saturday revision", diagnostics: [] },
    },
  });
  await writeFile(envelopePath, `${JSON.stringify(sameSaturdayEnvelope, null, 2)}\n`, "utf8");
  const beforeRevisionDatabase = openBriefingDatabase(briefingPaths(cliEnvironment));
  const beforeRevisionDigest = loadEdition(beforeRevisionDatabase, { id: "cinema:2026-08-29" })?.content_digest;
  beforeRevisionDatabase.close();
  const preparedRevision = await runCinemaCli(["prepare", "--envelope", envelopePath], cliEnvironment);
  assert.equal(preparedRevision.publishedRevision, true);
  const stagedRevisionDatabase = openBriefingDatabase(briefingPaths(cliEnvironment));
  assert.equal(loadEdition(stagedRevisionDatabase, { id: "cinema:2026-08-29" })?.content_digest, beforeRevisionDigest);
  stagedRevisionDatabase.close();
  const promotedRevision = await runCinemaCli(["promote", "--envelope", envelopePath], cliEnvironment);
  assert.equal(promotedRevision.publishedRevision, true);
  const cliDatabase = openBriefingDatabase(briefingPaths(cliEnvironment));
  try {
    assert.equal(loadCinemaSnapshot(cliDatabase)?.data.localDate, "2026-08-29");
    assert.equal(loadCinemaSnapshot(cliDatabase)?.data.quality.summary, "Fresh same-Saturday revision");
    assert.equal(loadEdition(cliDatabase, { id: "cinema:2026-08-29" })?.state, "complete");
  } finally {
    cliDatabase.close();
  }
} finally {
  await rm(cliRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  cinemaProductionEnabled: config.enabled,
  verifiedYouTubeSeeds: config.sources.youtube.channels.length,
  deterministicProviders: 10,
  dstWindowHours: 169,
  promotionThresholdCovered: true,
  failedPromotionPreservesCurrent: true,
  deterministicFullAndDailyRenderers: true,
  rendererFailureIsolated: true,
  editionAndSnapshotPromoteAtomically: true,
  apFallbackCovered: true,
  kinopoiskFallbackCovered: true,
  operationalCliCovered: true,
})}\n`);
