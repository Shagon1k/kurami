import type { CinemaCoverage } from "./model.ts";

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function dateParts(localDate: string): { year: number; month: number; day: number } {
  const match = LOCAL_DATE.exec(localDate);
  if (!match) throw new Error("Cinema local date must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) throw new Error("Cinema local date is invalid");
  return { year, month, day };
}

export function addLocalDays(localDate: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new Error("Cinema day offset must be a safe integer");
  const { year, month, day } = dateParts(localDate);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(result.getUTCFullYear()).padStart(4, "0"),
    String(result.getUTCMonth() + 1).padStart(2, "0"),
    String(result.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function zonedParts(instant: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

export function localTimeInstant(
  localDate: string,
  hour: number,
  timeZone: string,
): string {
  const { year, month, day } = dateParts(localDate);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Cinema local hour must be 0..23");
  }
  new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
  const target = Date.UTC(year, month - 1, day, hour);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedParts(new Date(guess), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year!,
      observed.month! - 1,
      observed.day!,
      observed.hour!,
      observed.minute!,
      observed.second!,
    );
    const correction = target - observedAsUtc;
    guess += correction;
    if (correction === 0) break;
  }
  const verified = zonedParts(new Date(guess), timeZone);
  if (
    verified.year !== year
    || verified.month !== month
    || verified.day !== day
    || verified.hour !== hour
    || verified.minute !== 0
  ) throw new Error("Cinema local time cannot be resolved in the configured timezone");
  return new Date(guess).toISOString();
}

export function cinemaWeeklyCoverage(localDate: string, timeZone: string): CinemaCoverage {
  const { year, month, day } = dateParts(localDate);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 6) {
    throw new Error("Cinema weekly coverage requires a Saturday local date");
  }
  return {
    start: localTimeInstant(addLocalDays(localDate, -7), 9, timeZone),
    end: localTimeInstant(localDate, 9, timeZone),
  };
}

export function cinemaPremiereCoverage(localDate: string, timeZone: string): CinemaCoverage {
  const { year, month, day } = dateParts(localDate);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 6) {
    throw new Error("Cinema premiere coverage requires a Saturday local date");
  }
  const nextMonday = addLocalDays(localDate, 2);
  return {
    start: localTimeInstant(nextMonday, 0, timeZone),
    end: localTimeInstant(addLocalDays(nextMonday, 7), 0, timeZone),
  };
}

export function instantInsideCoverage(instant: string, coverage: CinemaCoverage): boolean {
  const value = Date.parse(instant);
  return Number.isFinite(value)
    && value >= Date.parse(coverage.start)
    && value < Date.parse(coverage.end);
}
