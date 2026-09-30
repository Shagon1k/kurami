import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type SettingField = {
  name: string; flag: string; min: number; max: number;
  group: string; unit: string; label: {en: string; ru: string};
};
export type SettingsSchema = {
  version: 1;
  fields: SettingField[];
  projectWip: {name: string; flag: string; min: number; max: number; unit: string};
  constraints: {left: string; right: string; message: string}[];
  health: {allowedIntervals: number[]; defaultIntervalMinutes: number};
};
export const settingsSchema: SettingsSchema = JSON.parse(readFileSync(resolve(import.meta.dirname, "settings-schema.json"), "utf8"));
if (settingsSchema.version !== 1) throw new Error("Unsupported settings schema");

export function settingsInteger(value: unknown, field: {name: string; min: number; max: number}): number {
  if (!Number.isInteger(value) || Number(value) < field.min || Number(value) > field.max) {
    throw new Error(`${field.name} must be an integer between ${field.min} and ${field.max}`);
  }
  return Number(value);
}

export function validateSettingsRelations(settings: Record<string, unknown> & {project_wip: Record<string, number>}): void {
  for (const rule of settingsSchema.constraints) {
    if (rule.left === "project_wip.*") {
      for (const [project, value] of Object.entries(settings.project_wip)) {
        if (value > Number(settings[rule.right])) throw new Error(rule.message.replace("{project}", project));
      }
      continue;
    }
    if (Number(settings[rule.left]) > Number(settings[rule.right])) throw new Error(rule.message);
  }
}
