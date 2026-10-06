// Kurami-wide default appearance: the theme and mode every device uses until it picks its own in the
// header menu. Hub → Controls → Settings writes it; the web gateway turns it into the
// `kurami-theme-default` cookie that the theme runtime reads before first paint.
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { themeVariants } from "../../ui-library/themes/index.ts";

process.umask(0o077);

export type AppearanceMode = "light" | "dark";
type AppearanceState = { version: 1; revision: number; theme: string; mode: AppearanceMode; actorId: string; appliedAt: string };

/** Themes and the modes each supports: Paper has both; a variant lists its own. */
export const appearanceThemes: Record<string, AppearanceMode[]> = {
  paper: ["light", "dark"],
  ...Object.fromEntries(themeVariants.map(variant => [variant.name, (["light", "dark"] as const).filter(mode => variant.modes[mode])])),
};

function fail(message: string): never {
  throw new Error(message);
}

export function validAppearance(theme: unknown, mode: unknown): theme is string {
  return typeof theme === "string" && Object.hasOwn(appearanceThemes, theme) && appearanceThemes[theme].includes(mode as AppearanceMode);
}

function parse(raw: string): AppearanceState {
  const value = JSON.parse(raw) as Partial<AppearanceState>;
  if (value.version === 1 && Number.isInteger(value.revision) && Number(value.revision) >= 1 && validAppearance(value.theme, value.mode)
    && typeof value.actorId === "string" && typeof value.appliedAt === "string") return value as AppearanceState;
  fail("Appearance settings state is invalid");
}

export function appearanceStatePath(home = resolveKuramiHome("/home/shagon1k/_hermes/_kurami")): string {
  return resolve(home, "state/appearance-settings.json");
}

/** The cookie value ("<theme>.<mode>") for the gateway, or null when no default was chosen or the file is unusable. */
export function readAppearanceDefault(path = appearanceStatePath()): string | null {
  try { const state = parse(readFileSync(path, "utf8")); return `${state.theme}.${state.mode}`; } catch { return null; }
}

async function readState(path: string): Promise<AppearanceState | null> {
  try { return parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function writeState(path: string, state: AppearanceState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function response(action: "status" | "applied" | "unchanged", state: AppearanceState | null): Record<string, unknown> {
  return { ok: true, action, revision: state?.revision ?? 0, theme: state?.theme ?? "paper", mode: state?.mode ?? null, themes: appearanceThemes, appliedAt: state?.appliedAt ?? null };
}

export async function runAppearanceSettingsCli(argv = process.argv.slice(2)): Promise<Record<string, unknown>> {
  const args = [...argv], command = args.shift();
  if (command !== "status" && command !== "apply") fail("Usage: appearance-settings.ts <status|apply> [--theme NAME --mode light|dark --expected-revision N --actor-id ID]");
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!["--theme", "--mode", "--expected-revision", "--actor-id"].includes(flag ?? "") || value === undefined) fail(`Unknown appearance argument: ${flag ?? "missing"}`);
    options[flag!.slice(2)] = value;
  }
  const path = appearanceStatePath(), previous = await readState(path);
  if (command === "status") {
    if (args.length) fail("Appearance status accepts no arguments");
    return response("status", previous);
  }
  if (!validAppearance(options.theme, options.mode)) fail("Unknown theme or a mode that theme does not have");
  if (!/^\d+$/.test(options["expected-revision"] ?? "")) fail("Invalid expected revision");
  if (!/^\d{1,40}$/.test(options["actor-id"] ?? "")) fail("Invalid actor ID");
  const current = previous?.revision ?? 0;
  if (Number(options["expected-revision"]) !== current) fail(`Appearance changed since this panel opened: expected revision ${options["expected-revision"]}, current revision ${current}`);
  if (previous && previous.theme === options.theme && previous.mode === options.mode) return response("unchanged", previous);
  const next: AppearanceState = { version: 1, revision: current + 1, theme: options.theme!, mode: options.mode as AppearanceMode, actorId: options["actor-id"]!, appliedAt: new Date().toISOString() };
  await writeState(path, next);
  return response("applied", next);
}

if (import.meta.main) {
  runAppearanceSettingsCli().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  });
}
