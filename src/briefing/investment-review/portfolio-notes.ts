// Investment review ↔ Daily. Two small links between the Sunday review and the morning edition:
// - the portfolio baseline (the positions the review counts) must be confirmed within 30 days or the Sunday
//   review stops; from day 25 Daily says so, and "Состав не менялся" re-dates the latest baseline to today;
// - a review may give a position or idea a `revisitOn` day; that morning Daily shows the reminder.
// Everything stays in state/briefing/portfolio, readable only by the owner's processes.
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PortfolioBaseline } from "./model.ts";
import { resolveBaseline } from "./automation.ts";
import { loadReview } from "./store.ts";

export const BASELINE_MAX_AGE_DAYS = 30, BASELINE_REMIND_AFTER_DAYS = 25;
export type PortfolioNotes = { asOf: string; ageDays: number; remind: boolean; watch: { symbol: string; text: string }[] };

const portfolioDirectory = (stateDirectory: string) => join(stateDirectory, "portfolio");
const days = (from: string, to: string) => Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86_400_000);

export async function portfolioNotes(stateDirectory: string, today: string): Promise<PortfolioNotes | null> {
  let baseline;
  try { baseline = await resolveBaseline(portfolioDirectory(stateDirectory), undefined); } catch { return null; }
  const watch: PortfolioNotes["watch"] = [];
  for (const slot of ["weekly", "monthly"] as const) {
    const review = await loadReview(join(portfolioDirectory(stateDirectory), "reviews"), slot).catch(() => null);
    for (const item of [...(review?.draft.positions ?? []), ...(review?.draft.ideas ?? [])])
      if (item.revisitOn === today && !watch.some(entry => entry.symbol === item.symbol)) watch.push({ symbol: item.symbol, text: item.revisitWhen.slice(0, 300) });
  }
  const ageDays = days(baseline.date, today);
  return { asOf: baseline.date, ageDays, remind: ageDays >= BASELINE_REMIND_AFTER_DAYS, watch };
}

/** "The positions have not changed": writes the latest baseline again, dated today. In a new month the
 *  month's trade and contribution counters start from zero, since nothing was bought or added. */
export async function confirmBaseline(stateDirectory: string, today: string): Promise<{ asOf: string; changed: boolean }> {
  const directory = portfolioDirectory(stateDirectory), latest = await resolveBaseline(directory, undefined);
  if (latest.date === today) return { asOf: today, changed: false };
  if (latest.date > today) throw new Error("The latest baseline is dated in the future");
  const sameMonth = latest.date.slice(0, 7) === today.slice(0, 7);
  const next: PortfolioBaseline = { ...latest.baseline, asOfLocalDate: today,
    unknowns: sameMonth ? latest.baseline.unknowns : { currentMonthExecutedTrades: 0, currentMonthNewContributionsEUR: 0 } };
  const path = join(directory, `baseline-${today}.json`), temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  return { asOf: today, changed: true };
}
