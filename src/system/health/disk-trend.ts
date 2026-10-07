// Disk forecast. The health cycle keeps one disk reading per day (the day's last) for 60 days; a straight
// line through the last 30 says when usage reaches the admission-block threshold, where new work stops.
// Hub and the health card show it only when the date is near and the trend is clear: at least a week of
// readings, a steady rise, and no more than 60 days to go.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type DiskDay = { day: string; usedPercent: number };
export type DiskForecast = { days: number; thresholdPercent: number; percentPerDay: number };

const KEEP_DAYS = 60, FIT_DAYS = 30, MIN_DAYS = 7, HORIZON_DAYS = 60, MIN_RISE_PER_DAY = 0.05;

export function addDiskDay(days: DiskDay[], checkedAt: string, usedPercent: number): DiskDay[] {
  const day = checkedAt.slice(0, 10);
  return [...days.filter(entry => entry.day !== day), { day, usedPercent }].sort((a, b) => a.day.localeCompare(b.day)).slice(-KEEP_DAYS);
}

export function diskForecast(days: DiskDay[], thresholdPercent: number | undefined): DiskForecast | null {
  if (!thresholdPercent) return null;
  const recent = days.slice(-FIT_DAYS);
  if (recent.length < MIN_DAYS) return null;
  const origin = Date.parse(recent[0]!.day);
  const points = recent.map(entry => ({ x: (Date.parse(entry.day) - origin) / 86_400_000, y: entry.usedPercent }));
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length, meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const spread = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (spread === 0) return null;
  const slope = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / spread;
  const latest = recent.at(-1)!.usedPercent;
  if (slope < MIN_RISE_PER_DAY || latest >= thresholdPercent) return null;
  const left = Math.ceil((thresholdPercent - latest) / slope);
  return left <= HORIZON_DAYS ? { days: left, thresholdPercent, percentPerDay: Math.round(slope * 100) / 100 } : null;
}

export async function readDiskDays(path: string): Promise<DiskDay[]> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { version?: number; days?: unknown[] };
    if (value.version !== 1 || !Array.isArray(value.days)) return [];
    return value.days.filter((entry): entry is DiskDay => !!entry && typeof entry === "object" &&
      /^\d{4}-\d{2}-\d{2}$/.test(String((entry as DiskDay).day)) && Number.isFinite((entry as DiskDay).usedPercent));
  } catch { return []; }
}

export async function writeDiskDays(path: string, days: DiskDay[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, days })}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
