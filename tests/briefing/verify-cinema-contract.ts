import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseApTopTen } from "../../src/briefing/cinema/providers/ap.ts";
import { normalizeBoxOfficeWatch } from "../../src/briefing/cinema/providers/box-office-watch.ts";
import { parseCinemaLtPremieres } from "../../src/briefing/cinema/providers/cinema-lt.ts";
import { normalizeLkcSheetRows } from "../../src/briefing/cinema/providers/lkc.ts";
import { parseCinemaRss } from "../../src/briefing/cinema/providers/rss.ts";
import { normalizeTmdbMovieResults } from "../../src/briefing/cinema/providers/tmdb.ts";
import { normalizeYouTubeCandidates } from "../../src/briefing/cinema/providers/youtube.ts";
import {
  cinemaEnvelopePromotable,
  parseCinemaEnvelope,
} from "../../src/briefing/cinema/model.ts";
import {
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

const config = await loadCinemaRuntimeConfig(
  { home: root } as never,
  { BRIEFING_CONFIG_PATH: resolve(root, "deploy/config/briefing.yaml") } as NodeJS.ProcessEnv,
);
assert.equal(config.enabled, false);
assert.equal(config.market, "LT");
assert.equal(config.timeZone, "Europe/Vilnius");
assert.equal(config.limits.trailers, 8);
assert.equal(config.limits.news, 15);
assert.equal(config.sources.youtube.channels.length, 15);
assert.equal(config.sources.youtube.channels.filter((channel) => channel.role === "discovery").length, 1);
assert.equal(config.sources.youtube.channels.find((channel) => channel.key === "warner-bros")?.id, "UCjmJDM5pRKbUlVIzDYYWb6g");

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

const lkcRows = JSON.parse(await fixture("lkc-rows.json")) as unknown[][];
const lkc = normalizeLkcSheetRows(lkcRows);
assert.equal(lkc.length, 2);
assert.equal(lkc[0]?.changePercent, 50.4510964130685);
assert.equal(lkc[0]?.releaseDate, "2026-07-17");
assert.throws(
  () => normalizeLkcSheetRows([lkcRows[0]!, lkcRows[1]!.slice(0, 4), lkcRows[2]!]),
  /missing header/u,
);

const cinemaLt = parseCinemaLtPremieres({
  html: await fixture("cinema-lt.html"),
  coverage: premieresCoverage,
  timeZone: config.timeZone,
});
assert.equal(cinemaLt.length, 1);
assert.equal(cinemaLt[0]?.originalTitle, "Future Film");
assert.equal(cinemaLt[0]?.releaseDate, "2026-09-04");

const youtube = normalizeYouTubeCandidates({
  response: JSON.parse(await fixture("youtube.json")),
  channels: config.sources.youtube.channels,
  coverage: weekly,
});
assert.equal(youtube.length, 1);
assert.equal(youtube[0]?.publisher, "Warner Bros.");
assert.equal(youtube[0]?.durationSeconds, 151);

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

const tmdb = normalizeTmdbMovieResults(JSON.parse(await fixture("tmdb.json")));
assert.equal(tmdb.length, 1);
assert.equal(tmdb[0]?.id, 123456);
assert.equal(tmdb[0]?.posterPath, "/future-film.jpg");

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
  "Box-office pulse",
  "Трейлеры недели",
  "Премьеры",
  "Коротко о важном",
  "data-cinema-edition=\"2026-08-29\"",
  "Kurami Cinema",
]) assert.match(cinemaHtml, new RegExp(marker));
assert.doesNotMatch(cinemaHtml, /Kurami Daily Briefing/u);
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

process.stdout.write(`${JSON.stringify({
  ok: true,
  cinemaDisabledByDefault: true,
  verifiedYouTubeSeeds: config.sources.youtube.channels.length,
  deterministicProviders: 9,
  dstWindowHours: 169,
  promotionThresholdCovered: true,
  failedPromotionPreservesCurrent: true,
  deterministicFullAndDailyRenderers: true,
  rendererFailureIsolated: true,
  editionAndSnapshotPromoteAtomically: true,
})}\n`);
