import type { BriefingAddonEnvelope, SectionState } from "../model.ts";

export type CinemaCoverage = { start: string; end: string };

export type CinemaSourceReference = {
  id: string;
  provider: string;
  url: string;
  fetchedAt: string;
  publishedAt?: string;
  region?: string;
  period?: string;
  evidence?: string;
};

export type CinemaMoney = { amount: number; currency: string };

export type CinemaRankedEntry = {
  id: string;
  title: string;
  rank: number;
  gross: CinemaMoney;
  cumulativeGross?: CinemaMoney;
  changePercent?: number;
  previousRank?: number;
  weeks?: number;
  admissions?: number;
  showCount?: number;
  releaseDate?: string;
  distributor?: string;
  sourceId: string;
};

export type CinemaChart = {
  id: string;
  label: string;
  region: string;
  period: "weekend" | "ytd";
  entries: CinemaRankedEntry[];
};

export type CinemaSignal = {
  id: string;
  kind: "largest-debut" | "best-hold" | "sharpest-drop" | "rank-movement" | "estimate-surprise";
  filmId: string;
  filmTitle?: string;
  label: string;
  value?: number;
  unit?: string;
  sourceId: string;
};

export type CinemaTrendPoint = {
  at: string;
  label: string;
  gross: number | null;
  changePercent?: number;
  debut?: boolean;
};

export type CinemaTrendSeries = {
  id: string;
  label: string;
  currency: string;
  points: CinemaTrendPoint[];
};

export type CinemaGlobalPulse = {
  id: string;
  headline: string;
  summary: string;
  value: number;
  unit: string;
  territory: string;
  period: string;
  sourceId: string;
};

export type CinemaBoxOfficeSection = {
  state: SectionState;
  capturedAt: string;
  featuredId?: string;
  charts: CinemaChart[];
  signals: CinemaSignal[];
  trend: CinemaTrendSeries[];
  globalPulse: CinemaGlobalPulse[];
  provenance: string[];
  diagnostics?: string[];
};

export type CinemaTrailer = {
  id: string;
  title: string;
  videoId: string;
  publisher: string;
  publisherChannelId: string;
  publisherRole: "official" | "discovery";
  publishedAt: string;
  sourceUrl: string;
  thumbnailSrc?: string;
  durationSeconds?: number;
  trailerType: "main" | "teaser" | "final" | "other";
  tmdbId?: number;
  sourceId: string;
};

export type CinemaPremiere = {
  id: string;
  localTitle: string;
  originalTitle?: string;
  releaseDate: string;
  sourceUrl: string;
  posterSrc?: string;
  genres?: string[];
  runtimeMinutes?: number;
  ageRating?: string;
  directors?: string[];
  cast?: string[];
  budget?: CinemaMoney;
  tmdbId?: number;
  sourceId: string;
};

export type CinemaNewsStory = {
  id: string;
  headline: string;
  summary: string;
  publisher: string;
  publishedAt: string;
  sourceUrl: string;
  imageSrc?: string;
  sourceId: string;
};

export type CinemaItemSection<T> = {
  state: SectionState;
  capturedAt: string;
  items: T[];
  provenance: string[];
  diagnostics?: string[];
};

export type CinemaNote = {
  id: string;
  target: string;
  text: string;
  mark: "arrow-down" | "arrow-down-left" | "arrow-down-right" | "arrow-right";
};

export type CinemaSnapshotData = {
  market: string;
  timezone: string;
  language: string;
  localDate: string;
  coverage: {
    boxOffice: CinemaCoverage;
    trailers: CinemaCoverage;
    premieres: CinemaCoverage;
    news: CinemaCoverage;
  };
  boxOffice: CinemaBoxOfficeSection;
  trailers: CinemaItemSection<CinemaTrailer>;
  premieres: CinemaItemSection<CinemaPremiere>;
  news: CinemaItemSection<CinemaNewsStory>;
  notes: CinemaNote[];
  quality: { summary: string; diagnostics: string[] };
  provenance: CinemaSourceReference[];
};

export type CinemaEnvelope = BriefingAddonEnvelope & {
  version: 1;
  data: CinemaSnapshotData;
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/u;
const STATES = new Set<SectionState>(["ready", "empty", "partial", "stale", "failed"]);
const LOCAL_IMAGE = /^\/media\/cinema\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

function fail(message: string): never {
  throw new Error(`Invalid Cinema envelope: ${message}`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    fail(`${label} must be non-empty text of at most ${maximum} characters`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, maximum = 2_000): string | undefined {
  return value === undefined ? undefined : text(value, label, maximum);
}

function safeId(value: unknown, label: string): string {
  const result = text(value, label, 160);
  if (!SAFE_ID.test(result)) fail(`${label} is unsafe`);
  return result;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function positiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, label);
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    fail(`${label} must be a positive safe integer no greater than ${maximum}`);
  }
  return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const result = finite(value, label);
  if (!Number.isSafeInteger(result) || result < 0) fail(`${label} must be a non-negative safe integer`);
  return result;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!Number.isFinite(Date.parse(result))) fail(`${label} must be RFC3339-compatible`);
  return result;
}

function date(value: unknown, label: string): string {
  const result = text(value, label, 10);
  if (!LOCAL_DATE.test(result) || !Number.isFinite(Date.parse(`${result}T00:00:00Z`))) {
    fail(`${label} must be YYYY-MM-DD`);
  }
  return result;
}

function state(value: unknown, label: string): SectionState {
  const result = text(value, label, 16) as SectionState;
  if (!STATES.has(result)) fail(`${label} is unsupported`);
  return result;
}

function enumeration<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T {
  const result = text(value, label, 40) as T;
  if (!allowed.includes(result)) fail(`${label} is unsupported`);
  return result;
}

function list<T>(value: unknown, label: string, maximum: number, parser: (entry: unknown, label: string) => T): T[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must contain at most ${maximum} items`);
  return value.map((entry, index) => parser(entry, `${label}[${index}]`));
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} must be unique`);
}

function httpsUrl(value: unknown, label: string): string {
  const result = text(value, label, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    fail(`${label} must be an HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(`${label} must be a safe HTTPS URL`);
  return parsed.toString();
}

function localImage(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const result = text(value, label, 300);
  if (!LOCAL_IMAGE.test(result)) fail(`${label} must be an edition-owned Cinema media path`);
  return result;
}

function strings(value: unknown, label: string, maximum: number): string[] {
  const result = list(value, label, maximum, (entry, itemLabel) => text(entry, itemLabel, 120));
  unique(result, label);
  return result;
}

function coverage(value: unknown, label: string): CinemaCoverage {
  const raw = object(value, label);
  const start = timestamp(raw.start, `${label}.start`);
  const end = timestamp(raw.end, `${label}.end`);
  if (Date.parse(start) >= Date.parse(end)) fail(`${label} must be a non-empty half-open interval`);
  return { start, end };
}

function money(value: unknown, label: string): CinemaMoney {
  const raw = object(value, label);
  const currency = text(raw.currency, `${label}.currency`, 3);
  if (!/^[A-Z]{3}$/u.test(currency)) fail(`${label}.currency must be an ISO currency code`);
  const amount = finite(raw.amount, `${label}.amount`);
  if (amount < 0) fail(`${label}.amount cannot be negative`);
  return { amount, currency };
}

function source(value: unknown, label: string): CinemaSourceReference {
  const raw = object(value, label);
  return {
    id: safeId(raw.id, `${label}.id`),
    provider: text(raw.provider, `${label}.provider`, 80),
    url: httpsUrl(raw.url, `${label}.url`),
    fetchedAt: timestamp(raw.fetchedAt, `${label}.fetchedAt`),
    ...(raw.publishedAt === undefined ? {} : { publishedAt: timestamp(raw.publishedAt, `${label}.publishedAt`) }),
    ...(optionalText(raw.region, `${label}.region`, 40) ? { region: optionalText(raw.region, `${label}.region`, 40)! } : {}),
    ...(optionalText(raw.period, `${label}.period`, 80) ? { period: optionalText(raw.period, `${label}.period`, 80)! } : {}),
    ...(optionalText(raw.evidence, `${label}.evidence`, 500) ? { evidence: optionalText(raw.evidence, `${label}.evidence`, 500)! } : {}),
  };
}

function rankedEntry(value: unknown, label: string): CinemaRankedEntry {
  const raw = object(value, label);
  const result: CinemaRankedEntry = {
    id: safeId(raw.id, `${label}.id`),
    title: text(raw.title, `${label}.title`, 220),
    rank: positiveInteger(raw.rank, `${label}.rank`, 100),
    gross: money(raw.gross, `${label}.gross`),
    sourceId: safeId(raw.sourceId, `${label}.sourceId`),
  };
  if (raw.cumulativeGross !== undefined) result.cumulativeGross = money(raw.cumulativeGross, `${label}.cumulativeGross`);
  if (raw.changePercent !== undefined) result.changePercent = finite(raw.changePercent, `${label}.changePercent`);
  if (raw.previousRank !== undefined) result.previousRank = positiveInteger(raw.previousRank, `${label}.previousRank`, 100);
  if (raw.weeks !== undefined) result.weeks = positiveInteger(raw.weeks, `${label}.weeks`, 1_000);
  if (raw.admissions !== undefined) result.admissions = nonNegativeInteger(raw.admissions, `${label}.admissions`);
  if (raw.showCount !== undefined) result.showCount = nonNegativeInteger(raw.showCount, `${label}.showCount`);
  if (raw.releaseDate !== undefined) result.releaseDate = date(raw.releaseDate, `${label}.releaseDate`);
  if (raw.distributor !== undefined) result.distributor = text(raw.distributor, `${label}.distributor`, 200);
  return result;
}

function chart(value: unknown, label: string): CinemaChart {
  const raw = object(value, label);
  const entries = list(raw.entries, `${label}.entries`, 10, rankedEntry);
  unique(entries.map((entry) => entry.id), `${label}.entries IDs`);
  unique(entries.map((entry) => String(entry.rank)), `${label}.entries ranks`);
  return {
    id: safeId(raw.id, `${label}.id`),
    label: text(raw.label, `${label}.label`, 120),
    region: text(raw.region, `${label}.region`, 40),
    period: enumeration(raw.period, `${label}.period`, ["weekend", "ytd"] as const),
    entries,
  };
}

function signal(value: unknown, label: string): CinemaSignal {
  const raw = object(value, label);
  return {
    id: safeId(raw.id, `${label}.id`),
    kind: enumeration(raw.kind, `${label}.kind`, [
      "largest-debut",
      "best-hold",
      "sharpest-drop",
      "rank-movement",
      "estimate-surprise",
    ] as const),
    filmId: safeId(raw.filmId, `${label}.filmId`),
    ...(raw.filmTitle === undefined ? {} : { filmTitle: text(raw.filmTitle, `${label}.filmTitle`, 240) }),
    label: text(raw.label, `${label}.label`, 160),
    ...(raw.value === undefined ? {} : { value: finite(raw.value, `${label}.value`) }),
    ...(raw.unit === undefined ? {} : { unit: text(raw.unit, `${label}.unit`, 20) }),
    sourceId: safeId(raw.sourceId, `${label}.sourceId`),
  };
}

function trendPoint(value: unknown, label: string): CinemaTrendPoint {
  const raw = object(value, label);
  const gross = raw.gross === null ? null : finite(raw.gross, `${label}.gross`);
  if (gross !== null && gross < 0) fail(`${label}.gross cannot be negative`);
  return {
    at: date(raw.at, `${label}.at`),
    label: text(raw.label, `${label}.label`, 40),
    gross,
    ...(raw.changePercent === undefined ? {} : { changePercent: finite(raw.changePercent, `${label}.changePercent`) }),
    ...(raw.debut === undefined ? {} : { debut: raw.debut === true }),
  };
}

function trendSeries(value: unknown, label: string): CinemaTrendSeries {
  const raw = object(value, label);
  const points = list(raw.points, `${label}.points`, 6, trendPoint);
  unique(points.map((point) => point.at), `${label}.point dates`);
  return {
    id: safeId(raw.id, `${label}.id`),
    label: text(raw.label, `${label}.label`, 160),
    currency: text(raw.currency, `${label}.currency`, 3),
    points,
  };
}

function globalPulse(value: unknown, label: string): CinemaGlobalPulse {
  const raw = object(value, label);
  return {
    id: safeId(raw.id, `${label}.id`),
    headline: text(raw.headline, `${label}.headline`, 220),
    summary: text(raw.summary, `${label}.summary`, 600),
    value: finite(raw.value, `${label}.value`),
    unit: text(raw.unit, `${label}.unit`, 30),
    territory: text(raw.territory, `${label}.territory`, 80),
    period: text(raw.period, `${label}.period`, 80),
    sourceId: safeId(raw.sourceId, `${label}.sourceId`),
  };
}

function boxOffice(value: unknown): CinemaBoxOfficeSection {
  const raw = object(value, "data.boxOffice");
  // Two periods across WORLD, US/CA and LT are the complete deterministic UI grid.
  const charts = list(raw.charts, "data.boxOffice.charts", 6, chart);
  const signals = list(raw.signals, "data.boxOffice.signals", 4, signal);
  const trend = list(raw.trend, "data.boxOffice.trend", 5, trendSeries);
  const pulse = list(raw.globalPulse, "data.boxOffice.globalPulse", 5, globalPulse);
  unique(charts.map((entry) => entry.id), "data.boxOffice chart IDs");
  unique(signals.map((entry) => entry.id), "data.boxOffice signal IDs");
  unique(trend.map((entry) => entry.id), "data.boxOffice trend IDs");
  unique(pulse.map((entry) => entry.id), "data.boxOffice pulse IDs");
  return {
    state: state(raw.state, "data.boxOffice.state"),
    capturedAt: timestamp(raw.capturedAt, "data.boxOffice.capturedAt"),
    ...(raw.featuredId === undefined ? {} : { featuredId: safeId(raw.featuredId, "data.boxOffice.featuredId") }),
    charts,
    signals,
    trend,
    globalPulse: pulse,
    provenance: strings(raw.provenance, "data.boxOffice.provenance", 20),
    ...(raw.diagnostics === undefined ? {} : { diagnostics: strings(raw.diagnostics, "data.boxOffice.diagnostics", 20) }),
  };
}

function trailer(value: unknown, label: string): CinemaTrailer {
  const raw = object(value, label);
  const channelId = text(raw.publisherChannelId, `${label}.publisherChannelId`, 24);
  if (!CHANNEL_ID.test(channelId)) fail(`${label}.publisherChannelId is invalid`);
  const videoId = text(raw.videoId, `${label}.videoId`, 16);
  if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId)) fail(`${label}.videoId is invalid`);
  return {
    id: safeId(raw.id, `${label}.id`),
    title: text(raw.title, `${label}.title`, 240),
    videoId,
    publisher: text(raw.publisher, `${label}.publisher`, 120),
    publisherChannelId: channelId,
    publisherRole: enumeration(raw.publisherRole, `${label}.publisherRole`, ["official", "discovery"] as const),
    publishedAt: timestamp(raw.publishedAt, `${label}.publishedAt`),
    sourceUrl: httpsUrl(raw.sourceUrl, `${label}.sourceUrl`),
    ...(localImage(raw.thumbnailSrc, `${label}.thumbnailSrc`) ? { thumbnailSrc: localImage(raw.thumbnailSrc, `${label}.thumbnailSrc`)! } : {}),
    ...(raw.durationSeconds === undefined ? {} : { durationSeconds: positiveInteger(raw.durationSeconds, `${label}.durationSeconds`, 7_200) }),
    trailerType: enumeration(raw.trailerType, `${label}.trailerType`, ["main", "teaser", "final", "other"] as const),
    ...(raw.tmdbId === undefined ? {} : { tmdbId: positiveInteger(raw.tmdbId, `${label}.tmdbId`) }),
    sourceId: safeId(raw.sourceId, `${label}.sourceId`),
  };
}

function premiere(value: unknown, label: string): CinemaPremiere {
  const raw = object(value, label);
  return {
    id: safeId(raw.id, `${label}.id`),
    localTitle: text(raw.localTitle, `${label}.localTitle`, 220),
    ...(raw.originalTitle === undefined ? {} : { originalTitle: text(raw.originalTitle, `${label}.originalTitle`, 220) }),
    releaseDate: date(raw.releaseDate, `${label}.releaseDate`),
    sourceUrl: httpsUrl(raw.sourceUrl, `${label}.sourceUrl`),
    ...(localImage(raw.posterSrc, `${label}.posterSrc`) ? { posterSrc: localImage(raw.posterSrc, `${label}.posterSrc`)! } : {}),
    ...(raw.genres === undefined ? {} : { genres: strings(raw.genres, `${label}.genres`, 8) }),
    ...(raw.runtimeMinutes === undefined ? {} : { runtimeMinutes: positiveInteger(raw.runtimeMinutes, `${label}.runtimeMinutes`, 1_000) }),
    ...(raw.ageRating === undefined ? {} : { ageRating: text(raw.ageRating, `${label}.ageRating`, 20) }),
    ...(raw.directors === undefined ? {} : { directors: strings(raw.directors, `${label}.directors`, 3) }),
    ...(raw.cast === undefined ? {} : { cast: strings(raw.cast, `${label}.cast`, 4) }),
    ...(raw.budget === undefined ? {} : { budget: money(raw.budget, `${label}.budget`) }),
    ...(raw.tmdbId === undefined ? {} : { tmdbId: positiveInteger(raw.tmdbId, `${label}.tmdbId`) }),
    sourceId: safeId(raw.sourceId, `${label}.sourceId`),
  };
}

function newsStory(value: unknown, label: string): CinemaNewsStory {
  const raw = object(value, label);
  return {
    id: safeId(raw.id, `${label}.id`),
    headline: text(raw.headline, `${label}.headline`, 220),
    summary: text(raw.summary, `${label}.summary`, 600),
    publisher: text(raw.publisher, `${label}.publisher`, 120),
    publishedAt: timestamp(raw.publishedAt, `${label}.publishedAt`),
    sourceUrl: httpsUrl(raw.sourceUrl, `${label}.sourceUrl`),
    ...(localImage(raw.imageSrc, `${label}.imageSrc`) ? { imageSrc: localImage(raw.imageSrc, `${label}.imageSrc`)! } : {}),
    sourceId: safeId(raw.sourceId, `${label}.sourceId`),
  };
}

function itemSection<T>(
  value: unknown,
  label: string,
  maximum: number,
  parser: (entry: unknown, label: string) => T,
): CinemaItemSection<T> {
  const raw = object(value, label);
  const items = list(raw.items, `${label}.items`, maximum, parser);
  unique(items.map((item) => safeId((item as { id: string }).id, `${label}.item.id`)), `${label} item IDs`);
  return {
    state: state(raw.state, `${label}.state`),
    capturedAt: timestamp(raw.capturedAt, `${label}.capturedAt`),
    items,
    provenance: strings(raw.provenance, `${label}.provenance`, 30),
    ...(raw.diagnostics === undefined ? {} : { diagnostics: strings(raw.diagnostics, `${label}.diagnostics`, 20) }),
  };
}

function note(value: unknown, label: string): CinemaNote {
  const raw = object(value, label);
  const noteText = text(raw.text, `${label}.text`, 48);
  if (noteText.split(/\s+/u).length > 4) fail(`${label}.text must contain at most four words`);
  return {
    id: safeId(raw.id, `${label}.id`),
    target: safeId(raw.target, `${label}.target`),
    text: noteText,
    mark: enumeration(raw.mark, `${label}.mark`, ["arrow-down", "arrow-down-left", "arrow-down-right", "arrow-right"] as const),
  };
}

export function parseCinemaEnvelope(value: unknown): CinemaEnvelope {
  const envelope = object(value, "envelope");
  if (envelope.version !== 1) fail("version must equal 1");
  const envelopeState = state(envelope.state, "state");
  const capturedAt = timestamp(envelope.capturedAt, "capturedAt");
  const data = object(envelope.data, "data");
  const local = date(data.localDate, "data.localDate");
  const timezone = text(data.timezone, "data.timezone", 80);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    fail("data.timezone is invalid");
  }
  const market = text(data.market, "data.market", 2);
  if (!/^[A-Z]{2}$/u.test(market)) fail("data.market must be an ISO alpha-2 code");
  const rawCoverage = object(data.coverage, "data.coverage");
  const sources = list(data.provenance, "data.provenance", 100, source);
  unique(sources.map((entry) => entry.id), "data.provenance IDs");
  const result: CinemaEnvelope = {
    version: 1,
    state: envelopeState,
    capturedAt,
    data: {
      market,
      timezone,
      language: text(data.language, "data.language", 12),
      localDate: local,
      coverage: {
        boxOffice: coverage(rawCoverage.boxOffice, "data.coverage.boxOffice"),
        trailers: coverage(rawCoverage.trailers, "data.coverage.trailers"),
        premieres: coverage(rawCoverage.premieres, "data.coverage.premieres"),
        news: coverage(rawCoverage.news, "data.coverage.news"),
      },
      boxOffice: boxOffice(data.boxOffice),
      trailers: itemSection(data.trailers, "data.trailers", 9, trailer),
      premieres: itemSection(data.premieres, "data.premieres", 12, premiere),
      news: itemSection(data.news, "data.news", 15, newsStory),
      notes: list(data.notes, "data.notes", 12, note),
      quality: (() => {
        const quality = object(data.quality, "data.quality");
        return {
          summary: text(quality.summary, "data.quality.summary", 500),
          diagnostics: strings(quality.diagnostics, "data.quality.diagnostics", 40),
        };
      })(),
      provenance: sources,
    },
  };
  assertCinemaIntegrity(result);
  return result;
}

function sectionHasContent(envelope: CinemaEnvelope): boolean[] {
  const boxOffice = envelope.data.boxOffice;
  return [
    boxOffice.charts.some((entry) => entry.entries.length > 0) || boxOffice.globalPulse.length > 0,
    envelope.data.trailers.items.length > 0,
    envelope.data.premieres.items.length > 0,
    envelope.data.news.items.length > 0,
  ];
}

export function cinemaEnvelopePromotable(envelope: CinemaEnvelope): boolean {
  if (envelope.state === "ready") {
    return sectionHasContent(envelope).some(Boolean)
      && [
        envelope.data.boxOffice.state,
        envelope.data.trailers.state,
        envelope.data.premieres.state,
        envelope.data.news.state,
      ].every((entry) => entry === "ready" || entry === "empty");
  }
  return envelope.state === "partial" && sectionHasContent(envelope).filter(Boolean).length >= 2;
}

export function assertCinemaIntegrity(envelope: CinemaEnvelope): void {
  const sourceIds = new Set(envelope.data.provenance.map((entry) => entry.id));
  const referenced = [
    ...envelope.data.boxOffice.provenance,
    ...envelope.data.boxOffice.charts.flatMap((entry) => entry.entries.map((item) => item.sourceId)),
    ...envelope.data.boxOffice.signals.map((entry) => entry.sourceId),
    ...envelope.data.boxOffice.globalPulse.map((entry) => entry.sourceId),
    ...envelope.data.trailers.provenance,
    ...envelope.data.trailers.items.map((entry) => entry.sourceId),
    ...envelope.data.premieres.provenance,
    ...envelope.data.premieres.items.map((entry) => entry.sourceId),
    ...envelope.data.news.provenance,
    ...envelope.data.news.items.map((entry) => entry.sourceId),
  ];
  for (const id of referenced) if (!sourceIds.has(id)) fail(`missing provenance ${id}`);

  const editionEnd = Date.parse(`${envelope.data.localDate}T23:59:59.999Z`);
  for (const [name, window] of Object.entries(envelope.data.coverage)) {
    const permittedFutureDays = name === "premieres" ? 9 : 1.5;
    if (Date.parse(window.end) > editionEnd + permittedFutureDays * 24 * 60 * 60 * 1_000) {
      fail(`data.coverage.${name}.end is implausibly future-dated`);
    }
  }
  for (const premiereItem of envelope.data.premieres.items) {
    const release = Date.parse(`${premiereItem.releaseDate}T00:00:00Z`);
    const window = envelope.data.coverage.premieres;
    if (release < Date.parse(window.start) - 24 * 60 * 60 * 1_000
      || release >= Date.parse(window.end) + 24 * 60 * 60 * 1_000) {
      fail(`premiere ${premiereItem.id} falls outside the configured local week`);
    }
  }
  const currentEntries = envelope.data.boxOffice.charts.flatMap((entry) => entry.entries);
  if (envelope.data.boxOffice.featuredId
    && !currentEntries.some((entry) => entry.id === envelope.data.boxOffice.featuredId)) {
    fail("featured box-office film is absent from charts");
  }
  if (["empty", "failed", "stale"].includes(envelope.state) && cinemaEnvelopePromotable(envelope)) {
    fail(`${envelope.state} envelope cannot be promotable`);
  }
}
