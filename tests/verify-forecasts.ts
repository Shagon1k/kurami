// Forecasts: the disk line needs a week of readings and a steady rise and stays quiet beyond 60 days or above
// the threshold; the Codex limit forecast needs part of the window behind it and speaks only before the reset.
import assert from "node:assert/strict";
import { addDiskDay, diskForecast, type DiskDay } from "../src/system/health/disk-trend.ts";
import { limitRunsOutAt } from "../src/hub/render.ts";

const series = (values: number[]): DiskDay[] => values.reduce<DiskDay[]>((days, value, index) => addDiskDay(days, new Date(Date.UTC(2026, 8, 1 + index, 12)).toISOString(), value), []);
assert.equal(diskForecast(series([50, 51, 52, 53, 54, 55]), 85), null, "six days are not a trend");
assert.deepEqual(diskForecast(series([50, 51, 52, 53, 54, 55, 56]), 85), { days: 29, thresholdPercent: 85, percentPerDay: 1 });
assert.equal(diskForecast(series([50, 50, 50, 50, 50, 50, 50]), 85), null, "flat usage has no date");
assert.equal(diskForecast(series([20, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6]), 85), null, "more than 60 days away is not shown");
assert.equal(diskForecast(series([84, 85, 86, 87, 88, 89, 90]), 85), null, "already past the threshold: the health alert speaks instead");
assert.equal(diskForecast(series([50, 51, 52, 53, 54, 55, 56]), undefined), null);
const sameDay = addDiskDay(addDiskDay([], "2026-09-01T01:00:00Z", 10), "2026-09-01T23:00:00Z", 11);
assert.deepEqual(sameDay, [{ day: "2026-09-01", usedPercent: 11 }], "one reading per day, the last one");
assert.equal(series(Array.from({ length: 70 }, (_, index) => index)).length, 60, "sixty days are kept");

const limit = { name: "primary", windowMinutes: 10080, resetsAt: "2026-09-20T10:00:00Z", observedAt: "2026-09-16T06:59:00Z" };
assert.equal(limitRunsOutAt({ ...limit, usedPercent: 42, remainingPercent: 58 })?.slice(0, 13), "2026-09-20T06", "42% in 2.9 days runs out just before the reset");
assert.equal(limitRunsOutAt({ ...limit, usedPercent: 20, remainingPercent: 80 }), null, "a slower pace lasts past the reset");
assert.equal(limitRunsOutAt({ ...limit, observedAt: "2026-09-13T12:00:00Z", usedPercent: 30, remainingPercent: 70 }), null, "two hours into a week say nothing");
assert.equal(limitRunsOutAt({ ...limit, usedPercent: 100, remainingPercent: 0 }), null, "an exhausted limit has its own label");
console.log(JSON.stringify({ ok: true, forecasts: "disk trend gates, one reading a day, limit pace before reset" }));
