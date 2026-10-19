import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reconcileWorldWeekend } from "../../src/briefing/cinema/box-office-consistency.ts";
import type { CinemaBoxOfficeSection, CinemaCoverage, CinemaSourceReference } from "../../src/briefing/cinema/model.ts";

const frozen = JSON.parse(await readFile(new URL("../fixtures/briefing/cinema/box-office-conflict-2026-10-03.json", import.meta.url), "utf8")) as {
  boxOffice: CinemaBoxOfficeSection; provenance: CinemaSourceReference[]; coverage: { boxOffice: CinemaCoverage };
};
const original = structuredClone(frozen);
const result = reconcileWorldWeekend(frozen.boxOffice, frozen.provenance, frozen.coverage.boxOffice);
assert.deepEqual(frozen, original, "never mutate frozen facts");
assert.deepEqual(result.charts, frozen.boxOffice.charts.filter(chart => chart.id !== "world-weekend"));
assert.equal(result.state, "partial");
assert.equal(result.diagnostics?.filter(item => item.includes("world_below_domestic")).length, 4);
assert.ok(result.diagnostics?.some(item => item.includes("kinopoisk:7400696:bow:primetime:2026-09-27")));
assert.deepEqual(result.signals, frozen.boxOffice.signals);
assert.deepEqual(result.trend, frozen.boxOffice.trend);
assert.deepEqual(result.provenance, frozen.boxOffice.provenance);
assert.deepEqual(reconcileWorldWeekend(result, frozen.provenance, frozen.coverage.boxOffice), result);

// Controlled synthetic values exercise the rule, not proposed replacement facts.
const compatible = structuredClone(frozen.boxOffice);
const us = compatible.charts.find(chart => chart.region === "US/CA" && chart.period === "weekend")!;
const world = compatible.charts.find(chart => chart.id === "world-weekend")!;
world.entries = us.entries.map(entry => ({ ...structuredClone(entry), id: `other:${entry.id}`, sourceId: world.entries[0]!.sourceId }));
assert.equal(reconcileWorldWeekend(compatible, frozen.provenance, frozen.coverage.boxOffice), compatible);
world.entries[0]!.gross.amount += 1;
assert.equal(reconcileWorldWeekend(compatible, frozen.provenance, frozen.coverage.boxOffice), compatible);
world.entries[0]!.cumulativeGross = { ...us.entries[0]!.gross, amount: us.entries[0]!.gross.amount - 1 };
assert.ok(reconcileWorldWeekend(compatible, frozen.provenance, frozen.coverage.boxOffice).diagnostics?.some(item => item.includes("world_below_domestic")));

const older = frozen.provenance.map(source => source.region === "WORLD" ? { ...source, period: "2026-09-20" } : source);
assert.ok(reconcileWorldWeekend(frozen.boxOffice, older, frozen.coverage.boxOffice).diagnostics?.some(item => item.includes("unverified_same_weekend")));
const unknown = frozen.provenance.map(source => source.region === "WORLD" ? { ...source, period: undefined } : source);
assert.ok(reconcileWorldWeekend(frozen.boxOffice, unknown, frozen.coverage.boxOffice).diagnostics?.some(item => item.includes("unverified_same_weekend")));
const noCumulative = structuredClone(compatible);
noCumulative.charts.find(chart => chart.region === "US/CA" && chart.period === "weekend")!.entries.forEach(entry => delete entry.cumulativeGross);
assert.ok(reconcileWorldWeekend(noCumulative, frozen.provenance, frozen.coverage.boxOffice).diagnostics?.some(item => item.includes("world_below_domestic")));
// A proven domestic weekend takes precedence over an editorial weekly window.
const weeklyCoverage = { start: "2026-09-26T06:00:00Z", end: "2026-10-03T06:00:00Z" };
const verifiedSameWeekend = structuredClone(compatible);
verifiedSameWeekend.charts.find(chart => chart.id === "world-weekend")!.entries.forEach(entry => delete entry.cumulativeGross);
assert.equal(reconcileWorldWeekend(verifiedSameWeekend, frozen.provenance, weeklyCoverage), verifiedSameWeekend);
assert.ok(reconcileWorldWeekend(verifiedSameWeekend, older, weeklyCoverage).diagnostics?.some(issue => issue.includes("unverified_same_weekend")));
const missingDomesticPeriod = frozen.provenance.map(source => source.region === "US/CA" || source.region === "US/WORLD" ? { ...source, period: undefined } : source);
assert.ok(reconcileWorldWeekend(verifiedSameWeekend, missingDomesticPeriod, weeklyCoverage).diagnostics?.some(issue => issue.includes("unverified_same_weekend")));

console.log("Cinema box-office consistency regression passed (frozen 2026-10-03, no mutation, dated joins, lower bounds, idempotence)");
