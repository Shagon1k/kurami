import type {
  CinemaChart,
  CinemaRankedEntry,
  CinemaSignal,
  CinemaTrendSeries,
} from "../model.ts";

type JsonRecord = Record<string, unknown>;

export type BoxOfficeWatchSnapshot = {
  weekendEnd: string;
  featuredId: string;
  charts: CinemaChart[];
  signals: CinemaSignal[];
  trend: CinemaTrendSeries[];
  diagnostics: string[];
};

function fail(message: string): never {
  throw new Error(`Invalid Box Office Watch response: ${message}`);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as JsonRecord;
}

function array(value: unknown, label: string, maximum = 500): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must be an array of at most ${maximum}`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 240) fail(`${label} must be text`);
  return value.trim();
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function nullableFinite(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : finite(value, label);
}

function positiveInteger(value: unknown, label: string): number {
  const result = finite(value, label);
  if (!Number.isSafeInteger(result) || result < 1) fail(`${label} must be a positive integer`);
  return result;
}

function optionalPositiveInteger(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : positiveInteger(value, label);
}

export function boxOfficeFilmIdentity(title: string): string {
  return title.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function slug(title: string): string {
  const result = title.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 100);
  if (!result) fail("movie title cannot form a stable ID");
  return result;
}

export function boxOfficeWeekendEnd(value: unknown): string {
  const label = string(value, "current.dates");
  const sameMonth = /^([A-Za-z]+)\s+(\d{1,2})[–-](\d{1,2}),\s+(\d{4})$/u.exec(label);
  const crossMonth = /^([A-Za-z]+)\s+(\d{1,2})[–-]([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/u.exec(label);
  if (!sameMonth && !crossMonth) fail("current.dates format drifted");
  const endMonth = sameMonth?.[1] ?? crossMonth?.[3];
  const endDay = sameMonth?.[3] ?? crossMonth?.[4];
  const year = sameMonth?.[4] ?? crossMonth?.[5];
  const instant = new Date(`${endMonth} ${endDay}, ${year} 12:00:00 UTC`);
  if (!Number.isFinite(instant.getTime())) fail("current.dates is invalid");
  return instant.toISOString().slice(0, 10);
}

type ActualRow = {
  title: string;
  identity: string;
  id: string;
  gross: number;
  change: number | null;
  versusPrediction: number | null;
  total: number;
  weeks: number | null;
  previousRank: number | null;
};

function actualRow(value: unknown, label: string): ActualRow {
  const row = record(value, label);
  const title = string(row.movie, `${label}.movie`);
  const gross = finite(row.gross, `${label}.gross`);
  const total = finite(row.total, `${label}.total`);
  if (gross < 0 || total < 0) fail(`${label} contains negative gross`);
  return {
    title,
    identity: boxOfficeFilmIdentity(title),
    id: `bow:${slug(title)}`,
    gross,
    change: nullableFinite(row.change, `${label}.change`),
    versusPrediction: nullableFinite(row.vsPrediction, `${label}.vsPrediction`),
    total,
    weeks: optionalPositiveInteger(row.weeks, `${label}.weeks`),
    previousRank: optionalPositiveInteger(row.prevRank, `${label}.prevRank`),
  };
}

function rankedActuals(value: unknown, label: string): ActualRow[] {
  const rows = array(value, label, 100).map((entry, index) => actualRow(entry, `${label}[${index}]`));
  if (rows.length === 0) fail(`${label} is empty`);
  const identities = rows.map((row) => row.identity);
  if (new Set(identities).size !== identities.length) fail(`${label} contains duplicate movie identities`);
  return rows;
}

type HistoricalRow = Pick<ActualRow, "title" | "identity" | "gross">;

function historicalActuals(value: unknown, label: string): HistoricalRow[] {
  const rows = array(value, label, 100).flatMap((entry, index) => {
    const row = record(entry, `${label}[${index}]`);
    const title = string(row.movie, `${label}[${index}].movie`);
    const gross = finite(row.gross, `${label}[${index}].gross`);
    if (gross < 0) fail(`${label}[${index}].gross cannot be negative`);
    return [{ title, identity: boxOfficeFilmIdentity(title), gross }];
  });
  const identities = rows.map((row) => row.identity);
  if (new Set(identities).size !== identities.length) fail(`${label} contains duplicate movie identities`);
  return rows;
}

function chartEntries(rows: ActualRow[], sourceId: string): CinemaRankedEntry[] {
  return rows.slice(0, 10).map((row, index) => ({
    id: row.id,
    title: row.title,
    rank: index + 1,
    gross: { amount: row.gross, currency: "USD" },
    cumulativeGross: { amount: row.total, currency: "USD" },
    ...(row.change === null ? {} : { changePercent: row.change }),
    ...(row.previousRank === null ? {} : { previousRank: row.previousRank }),
    ...(row.weeks === null ? {} : { weeks: row.weeks }),
    sourceId,
  }));
}

function yearlyEntries(value: unknown, label: string, sourceId: string): CinemaRankedEntry[] {
  return array(value, label, 200).slice(0, 5).map((entry, index) => {
    const row = record(entry, `${label}[${index}]`);
    const title = string(row.movie, `${label}[${index}].movie`);
    const rank = positiveInteger(row.rank, `${label}[${index}].rank`);
    const total = finite(row.totalGross, `${label}[${index}].totalGross`);
    if (total < 0) fail(`${label}[${index}].totalGross cannot be negative`);
    return {
      id: `bow:${slug(title)}`,
      title,
      rank,
      gross: { amount: total, currency: "USD" },
      sourceId,
      ...(row.studio === undefined ? {} : { distributor: string(row.studio, `${label}[${index}].studio`) }),
    };
  });
}

function signals(rows: ActualRow[], sourceId: string): CinemaSignal[] {
  const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }));
  const debut = ranked.filter((row) => row.weeks === 1)
    .sort((a, b) => b.gross - a.gross || a.identity.localeCompare(b.identity))[0];
  const returning = ranked.filter((row) => row.weeks !== null && row.weeks > 1 && row.change !== null);
  const bestHold = [...returning].sort((a, b) => b.change! - a.change! || a.identity.localeCompare(b.identity))[0];
  const sharpestDrop = [...returning].sort((a, b) => a.change! - b.change! || a.identity.localeCompare(b.identity))[0];
  const rankMovement = ranked.filter((row) => row.previousRank !== null)
    .map((row) => ({ ...row, movement: row.previousRank! - row.rank }))
    .filter((row) => row.movement !== 0)
    .sort((a, b) => Math.abs(b.movement) - Math.abs(a.movement) || a.identity.localeCompare(b.identity))[0];
  const surprise = ranked.filter((row) => row.versusPrediction !== null)
    .sort((a, b) => Math.abs(b.versusPrediction!) - Math.abs(a.versusPrediction!) || a.identity.localeCompare(b.identity))[0];
  const result: CinemaSignal[] = [];
  if (debut) result.push({
    id: "signal:largest-debut",
    kind: "largest-debut",
    filmId: debut.id,
    filmTitle: debut.title,
    label: "Крупнейший дебют",
    value: debut.gross,
    unit: "USD",
    sourceId,
  });
  if (bestHold) result.push({
    id: "signal:best-hold",
    kind: "best-hold",
    filmId: bestHold.id,
    filmTitle: bestHold.title,
    label: "Лучшее удержание",
    value: bestHold.change!,
    unit: "%",
    sourceId,
  });
  if (sharpestDrop) result.push({
    id: "signal:sharpest-drop",
    kind: "sharpest-drop",
    filmId: sharpestDrop.id,
    filmTitle: sharpestDrop.title,
    label: "Самое резкое падение",
    value: sharpestDrop.change!,
    unit: "%",
    sourceId,
  });
  if (rankMovement) result.push({
    id: "signal:rank-movement",
    kind: "rank-movement",
    filmId: rankMovement.id,
    filmTitle: rankMovement.title,
    label: "Движение в чарте",
    value: rankMovement.movement,
    unit: "поз.",
    sourceId,
  });
  else if (surprise) result.push({
    id: "signal:estimate-surprise",
    kind: "estimate-surprise",
    filmId: surprise.id,
    filmTitle: surprise.title,
    label: "Сюрприз против прогноза",
    value: surprise.versusPrediction!,
    unit: "%",
    sourceId,
  });
  return result.slice(0, 4);
}

function trend(
  current: ActualRow[],
  currentDate: string,
  archiveValue: unknown,
): CinemaTrendSeries[] {
  const archive = array(archiveValue, "archive", 100)
    .map((entry, index) => {
      const weekend = record(entry, `archive[${index}]`);
      return { weekend, index, at: boxOfficeWeekendEnd(weekend.dates) };
    })
    .filter(({ at }) => at < currentDate)
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 5)
    .map(({ weekend, index, at }) => ({
      at,
      rows: historicalActuals(weekend.actuals, `archive[${index}].actuals`),
    }));
  const weekends = [...archive, { at: currentDate, rows: current }]
    .sort((a, b) => a.at.localeCompare(b.at));
  return current.slice(0, 5).map((film) => ({
    id: film.id,
    label: film.title,
    currency: "USD",
    points: weekends.map((weekend) => {
      const historical = weekend.rows.find((row) => row.identity === film.identity);
      const isCurrent = weekend.at === currentDate;
      return {
        at: weekend.at,
        label: weekend.at.slice(5),
        gross: historical?.gross ?? null,
        ...(isCurrent && film.change !== null ? { changePercent: film.change } : {}),
        ...(isCurrent && film.weeks === 1 ? { debut: true } : {}),
      };
    }),
  }));
}

export function normalizeBoxOfficeWatch(input: {
  weekend: unknown;
  yearly: unknown;
  editionDate: string;
  sourceId: string;
}): BoxOfficeWatchSnapshot {
  const weekend = record(input.weekend, "weekend");
  let current = record(weekend.current, "current");
  const diagnostics: string[] = [];
  // During the estimates-only phase, retain the last completed weekend, never estimates.
  if (current.actuals === null || current.actuals === undefined) {
    const completed = array(weekend.archive, "archive", 100)
      .map((entry, index) => record(entry, `archive[${index}]`))
      .filter((entry) => Array.isArray(entry.actuals) && entry.actuals.length > 0)
      .filter((entry) => boxOfficeWeekendEnd(entry.dates) <= input.editionDate)
      .sort((left, right) => boxOfficeWeekendEnd(right.dates).localeCompare(boxOfficeWeekendEnd(left.dates)))[0];
    if (!completed) fail("no completed weekend actuals are available");
    current = completed;
    diagnostics.push(`box-office-watch:latest_actuals_unavailable:using_weekend:${boxOfficeWeekendEnd(current.dates)}`);
  }
  const weekendEnd = boxOfficeWeekendEnd(current.dates);
  const edition = Date.parse(`${input.editionDate}T12:00:00Z`);
  const end = Date.parse(`${weekendEnd}T12:00:00Z`);
  const ageDays = (edition - end) / 86_400_000;
  if (!Number.isFinite(edition) || end > edition || ageDays > 14) fail("current weekend is stale or future-dated");
  const actuals = rankedActuals(current.actuals, "current.actuals");
  const yearly = record(input.yearly, "yearly");
  const year = record(yearly[input.editionDate.slice(0, 4)], `yearly.${input.editionDate.slice(0, 4)}`);
  const charts: CinemaChart[] = [
    {
      id: "us-weekend",
      label: "США — уикенд",
      region: "US/CA",
      period: "weekend",
      entries: chartEntries(actuals, input.sourceId),
    },
    {
      id: "domestic-ytd",
      label: "США — с начала года",
      region: "US/CA",
      period: "ytd",
      entries: yearlyEntries(year.domestic, "yearly.domestic", input.sourceId),
    },
    {
      id: "worldwide-ytd",
      label: "Мировой прокат — с начала года",
      region: "WORLD",
      period: "ytd",
      entries: yearlyEntries(year.worldwide, "yearly.worldwide", input.sourceId),
    },
  ];
  return {
    weekendEnd,
    featuredId: actuals[0]!.id,
    charts,
    signals: signals(actuals, input.sourceId),
    trend: trend(actuals, weekendEnd, weekend.archive),
    diagnostics,
  };
}
