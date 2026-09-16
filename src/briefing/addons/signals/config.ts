import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export const DEFAULT_SIGNALS_CONFIG = Object.freeze({
  enabled: true, maxItems: 3, maxAgeMinutes: 180,
  overlapMinutes: 5, busyMinutes: 240, chainCount: 3, gapMinutes: 15,
  longMeetingMinutes: 120, earlyBeforeHour: 9, oldActionHours: 48,
  rainPercent: 60, coldBelowC: 0, hotFromC: 30, coolingC: 8,
  rules: { overlap: true, denseDay: true, actionMail: true, weather: true,
    longMeeting: true, earlyTomorrow: true, oldActionMail: true, coolingTomorrow: true },
});
export type SignalsConfig = { [K in Exclude<keyof typeof DEFAULT_SIGNALS_CONFIG,"rules">]:
  typeof DEFAULT_SIGNALS_CONFIG[K] extends boolean ? boolean : number } & {
  rules: { [K in keyof typeof DEFAULT_SIGNALS_CONFIG.rules]: boolean };
  error?: string;
};

/** Optional-module config errors disable execution without blocking Daily. */
export function parseSignalsConfig(input?: unknown): SignalsConfig {
  try {
    if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input))) throw new Error();
    const raw = (input ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(raw)) if (!Object.hasOwn(DEFAULT_SIGNALS_CONFIG,key)) throw new Error();
    const result = { ...DEFAULT_SIGNALS_CONFIG, ...raw, rules: { ...DEFAULT_SIGNALS_CONFIG.rules } } as SignalsConfig;
    if (typeof result.enabled !== "boolean") throw new Error();
    const ranges: Record<string, [number, number]> = {
      maxItems: [1,3], maxAgeMinutes: [30,360], overlapMinutes: [1,60],
      busyMinutes: [60,720], chainCount: [2,10], gapMinutes: [1,120],
      longMeetingMinutes: [30,480], earlyBeforeHour: [1,12], oldActionHours: [1,720],
      rainPercent: [0,100], coldBelowC: [-40,15], hotFromC: [15,50], coolingC: [1,30],
    };
    for (const [key,[min,max]] of Object.entries(ranges)) {
      const value = (result as unknown as Record<string,unknown>)[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error();
    }
    if (raw.rules !== undefined) {
      if (!raw.rules || typeof raw.rules !== "object" || Array.isArray(raw.rules)) throw new Error();
      for (const [key,value] of Object.entries(raw.rules)) {
        if (!Object.hasOwn(result.rules,key) || typeof value !== "boolean") throw new Error();
        result.rules[key as keyof SignalsConfig["rules"]] = value;
      }
    }
    return result;
  } catch { return { ...DEFAULT_SIGNALS_CONFIG, enabled: false, rules: { ...DEFAULT_SIGNALS_CONFIG.rules }, error: "invalid_signals_config" }; }
}

export async function readSignalsConfig(path: string): Promise<SignalsConfig> {
  const value = parseYaml(await readFile(path,"utf8")) as { signals?: unknown };
  return parseSignalsConfig(value.signals);
}
