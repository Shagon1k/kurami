// Release drift: whether what runs on the server matches main. Merging is not deploying (the live checkout
// is pulled by hand, Digest is a build, docs are a separate release, the Hermes plugin and skills are
// copies), and a lag once went unnoticed for a week. Every check is read-only; a check that cannot run
// is skipped rather than reported. Hub runs this in the background and shows what lags as one alert.
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { firstTouched, moduleClosure, type ModuleClosure } from "../core/module-closure.ts";

const run = promisify(execFile);

export type DriftCode = "checkout_behind" | "checkout_dirty" | "service_stale" | "digest_build_stale" | "docs_release_stale" | "hermes_copy_stale";
export type DriftItem = { code: DriftCode; ru: string; en: string };

/** Services that run the checkout's code directly, with their entry point. Digest runs a build (below). */
export const SERVICE_ENTRIES: Record<string, string> = { "kurami-hub": "src/hub/server.ts", "kurami-projects": "src/projects-site/server.ts", "kurami-web": "src/web/server.ts" };

type Options = { app: string; home: string; timeoutMs?: number; remote?: boolean };

async function output(command: string, args: string[], cwd: string, timeoutMs: number): Promise<string | null> {
  try { return (await run(command, args, { cwd, timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout.trim(); }
  catch { return null; }
}

async function succeeds(command: string, args: string[], cwd: string, timeoutMs: number): Promise<boolean | null> {
  try { await run(command, args, { cwd, timeout: timeoutMs }); return true; }
  catch (error) { return typeof (error as { code?: unknown }).code === "number" ? false : null; }
}

async function newestMtime(directory: string): Promise<number | null> {
  try {
    let newest = 0;
    for (const entry of await readdir(directory, { recursive: true, withFileTypes: true }))
      if (entry.isFile()) newest = Math.max(newest, (await stat(resolve(entry.parentPath, entry.name))).mtimeMs);
    return newest || null;
  } catch { return null; }
}

const plural = (count: number, one: string, few: string, many: string) => {
  const ten = count % 10, hundred = count % 100;
  return ten === 1 && hundred !== 11 ? one : ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14) ? few : many;
};

export async function checkReleaseDrift(options: Options): Promise<DriftItem[]> {
  const { app, home } = options, timeout = options.timeoutMs ?? 15_000, items: DriftItem[] = [];
  const git = (...args: string[]) => output("git", args, app, timeout);
  const head = await git("rev-parse", "HEAD");
  if (!head) return items;

  if (options.remote !== false) {
    const remote = (await git("ls-remote", "origin", "refs/heads/main"))?.split(/\s+/)[0];
    if (remote && /^[0-9a-f]{40}$/.test(remote) && remote !== head) {
      const behind = Number(await git("rev-list", "--count", `HEAD..${remote}`));
      items.push(Number.isInteger(behind) && behind > 0
        ? { code: "checkout_behind", ru: `Рабочая версия позади main на ${behind} ${plural(behind, "коммит", "коммита", "коммитов")}`, en: `The live version is ${behind} commit${behind === 1 ? "" : "s"} behind main` }
        : { code: "checkout_behind", ru: `Рабочая версия не совпадает с main (${remote.slice(0, 7)})`, en: `The live version differs from main (${remote.slice(0, 7)})` });
    }
  }
  if (await git("status", "--porcelain", "--untracked-files=no"))
    items.push({ code: "checkout_dirty", ru: "В рабочей версии есть незакоммиченные правки", en: "The live version has uncommitted changes" });

  // The checkout's commit at a moment, from the reflog of main (when git moved it, and to what).
  const moves = ((await git("reflog", "--date=unix", "--format=%H %gd", "refs/heads/main")) ?? "").split("\n")
    .map(line => /^([0-9a-f]{40}) main@\{(\d+)\}/.exec(line)).filter(Boolean).map(match => ({ sha: match![1]!, at: Number(match![2]) * 1000 }));
  const shaAt = (at: number) => moves.find(move => move.at <= at)?.sha ?? null;
  const changedSince = async (sha: string | null) => sha === null ? null : sha === head ? [] : ((await git("diff", "--name-only", sha, head)) ?? "").split("\n").filter(Boolean);
  const closures = new Map<string, ModuleClosure>();
  const closure = (entry: string) => closures.get(entry) ?? closures.set(entry, moduleClosure(app, [entry])).get(entry)!;
  const startedAt = async (unit: string) => {
    const value = await output("systemctl", ["--user", "show", unit, "-p", "ActiveEnterTimestamp", "--timestamp=unix", "--value"], app, timeout);
    return value?.startsWith("@") ? Number(value.slice(1)) * 1000 : null;
  };

  // A service is stale when code it depends on changed after it started.
  const stale: string[] = [];
  for (const [unit, entry] of Object.entries(SERVICE_ENTRIES)) {
    const started = await startedAt(unit);
    if (started === null) continue;
    const changed = await changedSince(shaAt(started));
    if (changed && firstTouched(closure(entry), changed)) stale.push(unit.replace("kurami-", ""));
  }
  // Digest runs from its build: restart when the build is newer than the service.
  const built = await newestMtime(resolve(app, "dist/briefing")), briefingStarted = await startedAt("kurami-briefing");
  if (built && briefingStarted && built > briefingStarted + 1000) stale.push("briefing");
  if (stale.length) items.push({ code: "service_stale", ru: `Не перезапущены после выкладки: ${stale.join(", ")}`, en: `Not restarted after the update: ${stale.join(", ")}` });

  // The Digest build must include every change to what it compiles.
  if (built) {
    const changed = await changedSince(shaAt(built));
    if (changed && firstTouched(closure("src/briefing/server.ts"), changed))
      items.push({ code: "digest_build_stale", ru: "Сборка Digest старше исходников", en: "The Digest build is older than its sources" });
  }

  // Docs are released separately; the release records the commit it was built from.
  try {
    const release = JSON.parse(await readFile(resolve(home, "state/human-docs/release/build.json"), "utf8")) as { docsSha?: unknown };
    const docsSha = typeof release.docsSha === "string" && /^[0-9a-f]{40}$/.test(release.docsSha) ? release.docsSha : null;
    const changed = await changedSince(docsSha);
    if (changed && firstTouched(closure("src/human-docs/build.ts"), changed))
      items.push({ code: "docs_release_stale", ru: "Документация не выпущена после изменений", en: "The docs have changes that are not released" });
  } catch {}

  // The Hermes Discord plugin and skills are installed copies of tracked files.
  const copies: string[] = [];
  if (await succeeds(resolve(app, "bin/sync-hermes-plugin.sh"), ["--check"], app, timeout) === false) copies.push("Discord plugin");
  if (await succeeds(resolve(app, "bin/sync-hermes-skills.sh"), ["--check"], app, timeout) === false) copies.push("skills");
  if (copies.length) items.push({ code: "hermes_copy_stale", ru: `Hermes: не синхронизированы ${copies.map(copy => copy === "skills" ? "навыки" : "плагин Discord").join(" и ")}`, en: `Hermes: ${copies.join(" and ")} not synchronized` });
  return items;
}

/** Re-checks in the background every `intervalMs`; `latest` is what Hub shows. */
export class ReleaseDriftMonitor {
  latest: DriftItem[] = [];
  checkedAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly options: Options;
  private readonly intervalMs: number;
  constructor(options: Options, intervalMs = 10 * 60_000) {
    this.options = options;
    this.intervalMs = intervalMs;
  }
  async refresh(): Promise<void> {
    try { this.latest = await checkReleaseDrift(this.options); this.checkedAt = Date.now(); } catch {}
  }
  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
