import type { CinemaBoxOfficeSection, CinemaCoverage, CinemaSourceReference } from "./model.ts";
import { boxOfficeFilmIdentity } from "./providers/box-office-watch.ts";

/** Fail-soft boundary for supplemental WORLD facts; never infer international totals. */
export function reconcileWorldWeekend(
  section: CinemaBoxOfficeSection,
  sources: CinemaSourceReference[],
  coverage: CinemaCoverage,
): CinemaBoxOfficeSection {
  const coverageEnd = new Date(Date.parse(coverage.end) - 86_400_000).toISOString().slice(0, 10);
  const periods = new Map(sources.map((source) => [source.id, source.period]));
  const domestic = section.charts.find((chart) => chart.region === "US/CA" && chart.period === "weekend");
  const domesticPeriods = new Set(domestic?.entries.map((entry) => periods.get(entry.sourceId)));
  const domesticEnd = domesticPeriods.size === 1 ? [...domesticPeriods][0] : undefined;
  const expectedEnd = domesticEnd && /^\d{4}-\d{2}-\d{2}$/u.test(domesticEnd) ? domesticEnd : coverageEnd;
  const diagnostics: string[] = [];
  const charts = section.charts.filter((chart) => {
    if (chart.region !== "WORLD" || chart.period !== "weekend") return true;
    // Fourteen-day freshness is not proof that two charts cover the same weekend.
    if (chart.entries.some((entry) => periods.get(entry.sourceId) !== expectedEnd)
      || domestic?.entries.some((entry) => periods.get(entry.sourceId) !== expectedEnd)) {
      diagnostics.push(`${chart.id}:omitted:unverified_same_weekend:${expectedEnd}`);
      return false;
    }
    for (const world of chart.entries) {
      const matches = domestic?.entries.filter((entry) => entry.id === world.id
        || boxOfficeFilmIdentity(entry.title) === boxOfficeFilmIdentity(world.title)) ?? [];
      // Only an unambiguous exact identity can establish a contradiction.
      if (matches.length !== 1) continue;
      const us = matches[0]!;
      const cumulativeLowerBound = us.cumulativeGross ?? us.gross;
      if ((world.gross.currency === us.gross.currency && world.gross.amount < us.gross.amount)
        || (world.cumulativeGross?.currency === cumulativeLowerBound.currency
          && world.cumulativeGross.amount < cumulativeLowerBound.amount)) {
        diagnostics.push(`${chart.id}:omitted:world_below_domestic:${world.id}:${us.id}:${expectedEnd}`);
      }
    }
    return !diagnostics.some((diagnostic) => diagnostic.startsWith(`${chart.id}:omitted:`));
  });
  if (!diagnostics.length) return section;
  // Retain rejected source references for audit, but no contradictory chart facts.
  return { ...section, charts, state: charts.length ? "partial" : "failed",
    diagnostics: [...new Set([...(section.diagnostics ?? []), ...diagnostics])] };
}
