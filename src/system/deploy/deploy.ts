// One release command for everything that runs on the server. `deploy <commit>` moves the live checkout
// to a commit on main and then does only what the change needs: orchestrator migrations, the Digest build,
// the docs release, the Hermes copies and restarts of the services whose code changed (decided by the same
// read-only release-drift check Hub shows). It ends by checking that nothing lags; if a step fails it goes
// back to the previous commit the same way. `rollback` returns to the commit before the last release.
// A commit is released only after the regression suites passed on its exact tree: with no such run on
// record, the release runs them first in a scratch worktree (a few minutes) and stops if they fail.
// Progress goes to state/deploy/last.json (Hub shows it), each release to state/deploy/history.jsonl.
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, symlink, writeFile, appendFile, open } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { checkReleaseDrift, type DriftItem } from "../release-drift.ts";
import { passedFull } from "../test-receipts.ts";

const exec = promisify(execFile);
export type StepStatus = "running" | "done" | "skipped" | "failed";
export type DeployStep = { name: string; status: StepStatus; detail?: string };
export type DeployRecord = {
  id: string; action: "deploy" | "rollback"; from: string; to: string; actor: string;
  status: "running" | "succeeded" | "failed" | "rolled_back"; startedAt: string; finishedAt?: string;
  steps: DeployStep[]; notes: string[];
};
export type Runner = (command: string, args: string[], options: { cwd: string; timeoutMs?: number }) => Promise<string>;
export type DeployContext = {
  app: string; home: string; run: Runner; drift: () => Promise<DriftItem[]>; now?: () => Date;
  /** Runs the full regression on a commit; throws when it fails. Defaults to a scratch worktree. */
  test?: (commit: string) => Promise<void>;
};
export type DeployOptions = { skipTests?: boolean };

const defaultRunner: Runner = async (command, args, options) =>
  (await exec(command, args, { cwd: options.cwd, timeout: options.timeoutMs ?? 600_000, maxBuffer: 20_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();

export const deployPaths = (home: string) => ({ directory: resolve(home, "state/deploy"), last: resolve(home, "state/deploy/last.json"), history: resolve(home, "state/deploy/history.jsonl"), lock: resolve(home, "state/deploy/lock") });

export async function readLastDeploy(home: string): Promise<DeployRecord | null> {
  try { return JSON.parse(await readFile(deployPaths(home).last, "utf8")) as DeployRecord; } catch { return null; }
}

/** The last successful release that moved the checkout. */
async function previousRelease(home: string): Promise<DeployRecord | null> {
  try {
    const lines = (await readFile(deployPaths(home).history, "utf8")).trim().split("\n").filter(Boolean);
    for (const line of lines.reverse()) { const record = JSON.parse(line) as DeployRecord; if (record.status === "succeeded" && record.from !== record.to) return record; }
  } catch {}
  return null;
}

class Release {
  readonly record: DeployRecord;
  private readonly context: DeployContext;
  constructor(context: DeployContext, record: DeployRecord) { this.context = context; this.record = record; }
  private async save(): Promise<void> {
    const paths = deployPaths(this.context.home), temporary = `${paths.last}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.record)}\n`, { mode: 0o600 });
    await rename(temporary, paths.last);
  }
  async step<T>(name: string, work: () => Promise<{ detail?: string; skipped?: boolean; value?: T }>): Promise<T | undefined> {
    const step: DeployStep = { name, status: "running" };
    this.record.steps.push(step); await this.save();
    try {
      const result = await work();
      step.status = result.skipped ? "skipped" : "done";
      if (result.detail) step.detail = result.detail;
      await this.save();
      return result.value;
    } catch (error) {
      step.status = "failed"; step.detail = (error instanceof Error ? error.message : String(error)).slice(0, 400);
      await this.save();
      throw error;
    }
  }
  async finish(status: DeployRecord["status"]): Promise<void> {
    this.record.status = status; this.record.finishedAt = (this.context.now?.() ?? new Date()).toISOString();
    await this.save();
    await appendFile(deployPaths(this.context.home).history, `${JSON.stringify(this.record)}\n`, { mode: 0o600 });
  }
}

/** Brings the server in line with the checkout: what lags is fixed in a fixed order. */
async function converge(context: DeployContext, release: Release, from: string, to: string): Promise<void> {
  const { app, run } = context;
  const git = (...args: string[]) => run("git", args, { cwd: app });
  const changed = from === to ? [] : (await git("diff", "--name-only", from, to)).split("\n").filter(Boolean);
  await release.step("Orchestrator migrations", async () => {
    if (!changed.some(file => /^migrations\/[^/]+\.sql$/.test(file))) return { skipped: true };
    await run("npm", ["run", "-s", "db:init"], { cwd: app }); return {};
  });
  let drift = await context.drift();
  const has = (code: DriftItem["code"]) => drift.some(item => item.code === code);
  await release.step("Digest build", async () => {
    if (!has("digest_build_stale")) return { skipped: true };
    await run("npm", ["run", "-s", "briefing:build"], { cwd: app }); return {};
  });
  await release.step("Docs release", async () => {
    if (!has("docs_release_stale")) return { skipped: true };
    await releaseDocs(context); return {};
  });
  await release.step("Hermes copies", async () => {
    if (!has("hermes_copy_stale")) return { skipped: true };
    const plugin = await run(resolve(app, "bin/sync-hermes-plugin.sh"), ["--check"], { cwd: app }).then(() => false, () => true);
    await run(resolve(app, "bin/sync-hermes-plugin.sh"), ["--apply"], { cwd: app });
    await run(resolve(app, "bin/sync-hermes-skills.sh"), ["--apply"], { cwd: app });
    if (plugin) release.record.notes.push("The Discord plugin changed: restart hermes-gateway when convenient to load it.");
    return {};
  });
  // Restarts come last: the build and the docs above make their services stale too.
  drift = await context.drift();
  await release.step("Restart services", async () => {
    const stale = drift.find(item => item.code === "service_stale");
    if (!stale) return { skipped: true };
    const units = stale.en.replace(/^.*: /, "").split(", ").map(name => `kurami-${name}`);
    await run("systemctl", ["--user", "restart", ...units], { cwd: app, timeoutMs: 120_000 });
    return { detail: units.join(" ") };
  });
  await release.step("Check", async () => {
    const left = (await context.drift()).filter(item => item.code !== "checkout_behind" && item.code !== "checkout_dirty");
    if (left.length) throw new Error(`Still lagging: ${left.map(item => item.en).join("; ")}`);
    return {};
  });
}

/** Builds the docs, keeps the current release as a rollback copy, swaps in the new one and checks access. */
async function releaseDocs(context: DeployContext): Promise<void> {
  const { app, home, run } = context, docs = resolve(home, "state/human-docs");
  await run("npm", ["run", "-s", "docs:build-docs-release"], { cwd: app });
  let previous = "unknown";
  try { previous = String((JSON.parse(await readFile(resolve(docs, "release/build.json"), "utf8")) as { docsSha?: unknown }).docsSha ?? "unknown"); } catch {}
  await rm(resolve(docs, "release.new"), { recursive: true, force: true });
  await cp(resolve(docs, "release"), resolve(docs, `rollback-${previous}`), { recursive: true, force: true }).catch(() => undefined);
  await cp(resolve(app, "dist/human-docs"), resolve(docs, "release.new"), { recursive: true });
  await rm(resolve(docs, "release.old"), { recursive: true, force: true });
  await rename(resolve(docs, "release"), resolve(docs, "release.old")).catch(() => undefined);
  await rename(resolve(docs, "release.new"), resolve(docs, "release"));
  await rm(resolve(docs, "release.old"), { recursive: true, force: true });
  await run("systemctl", ["--user", "restart", "kurami-human-docs"], { cwd: app, timeoutMs: 60_000 });
  await run("npm", ["run", "-s", "docs:verify-access"], { cwd: app });
  await run("npm", ["run", "-s", "docs:prune-releases", "--", "--apply"], { cwd: app });
}

/** The full regression on `commit`, in a scratch worktree beside the live checkout; it records its receipt. */
async function testInWorktree(context: DeployContext, commit: string): Promise<void> {
  const { app, home, run } = context, directory = resolve(home, "state/deploy/test-tree");
  const git = (...args: string[]) => run("git", args, { cwd: app });
  await rm(directory, { recursive: true, force: true }); await git("worktree", "prune");
  await git("worktree", "add", "--detach", "-q", directory, commit);
  try {
    await symlink(resolve(app, "node_modules"), resolve(directory, "node_modules"));
    await run(process.execPath, ["tests/run-regression.ts"], { cwd: directory, timeoutMs: 60 * 60_000 });
  } finally { await git("worktree", "remove", "--force", directory).catch(() => undefined); }
}

async function withLock<T>(home: string, work: () => Promise<T>): Promise<T> {
  const paths = deployPaths(home);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(paths.lock, "wx", 0o600); }
  catch {
    const owner = Number((await readFile(paths.lock, "utf8").catch(() => "")).trim());
    let alive = false;
    try { if (owner) { process.kill(owner, 0); alive = true; } } catch {}
    if (alive) throw new Error("Another release is running");
    await rm(paths.lock, { force: true });
    handle = await open(paths.lock, "wx", 0o600);
  }
  await handle.writeFile(String(process.pid)); await handle.close();
  try { return await work(); } finally { await rm(paths.lock, { force: true }); }
}

/** Moves the checkout to `target` (a commit on main) and converges; on failure returns to where it was. */
export async function deploy(context: DeployContext, target: string, actor: string, action: "deploy" | "rollback" = "deploy", options: DeployOptions = {}): Promise<DeployRecord> {
  const { app, home, run } = context;
  const git = (...args: string[]) => run("git", args, { cwd: app });
  return withLock(home, async () => {
    if (await git("status", "--porcelain", "--untracked-files=no")) throw new Error("The live checkout has uncommitted changes");
    await git("fetch", "-q", "origin", "main");
    const to = await git("rev-parse", "--verify", `${target}^{commit}`), from = await git("rev-parse", "HEAD");
    await git("merge-base", "--is-ancestor", to, "origin/main").catch(() => { throw new Error(`${to.slice(0, 7)} is not on main`); });
    const now = context.now?.() ?? new Date();
    const release = new Release(context, { id: `${now.toISOString()}-${to.slice(0, 7)}`, action, from, to, actor, status: "running", startedAt: now.toISOString(), steps: [], notes: [] });
    // Before anything moves: a failure here leaves the server as it was.
    try {
      await release.step("Tests", async () => {
        if (from === to) return { skipped: true, detail: "already live" };
        if (action === "rollback") return { skipped: true, detail: "an earlier release" };
        if (options.skipTests) { release.record.notes.push("Released without tests (--skip-tests)."); return { skipped: true, detail: "skipped by the owner" }; }
        const passed = await passedFull(home, await git("rev-parse", `${to}^{tree}`));
        if (passed) return { skipped: true, detail: `passed ${passed.at.slice(0, 16).replace("T", " ")} UTC` };
        await (context.test ?? (commit => testInWorktree(context, commit)))(to);
        return { detail: "passed" };
      });
    } catch (error) { await release.finish("failed"); throw error; }
    try {
      await release.step(action === "rollback" ? "Return checkout" : "Move checkout", async () => {
        if (from === to) return { skipped: true, detail: "already there" };
        // Forward along main is a fast-forward; a rollback resets the branch to the earlier commit.
        if (action === "deploy") await git("merge", "--ff-only", "-q", to); else await git("reset", "-q", "--hard", to);
        return { detail: `${from.slice(0, 7)} → ${to.slice(0, 7)}` };
      });
      await converge(context, release, from, to);
      await release.finish("succeeded");
      return release.record;
    } catch (error) {
      if (from === to || action === "rollback") { await release.finish("failed"); throw error; }
      try {
        await release.step("Roll back", async () => { await git("reset", "-q", "--hard", from); return { detail: `back to ${from.slice(0, 7)}` }; });
        await converge(context, release, to, from);
        await release.finish("rolled_back");
      } catch { await release.finish("failed"); }
      throw error;
    }
  });
}

export async function rollback(context: DeployContext, actor: string): Promise<DeployRecord> {
  const last = await previousRelease(context.home);
  if (!last || last.from === last.to) throw new Error("No earlier release to return to");
  return deploy(context, last.from, actor, "rollback");
}

export async function runDeployCli(argv = process.argv.slice(2)): Promise<DeployRecord | Record<string, unknown>> {
  const app = resolve(import.meta.dirname, "../../.."), home = resolveKuramiHome("/home/shagon1k/_hermes/_kurami");
  const context: DeployContext = { app, home, run: defaultRunner, drift: () => checkReleaseDrift({ app, home }) };
  const [command, target] = argv, actor = argv[argv.indexOf("--actor") + 1] && argv.includes("--actor") ? argv[argv.indexOf("--actor") + 1]! : "cli";
  if (command === "status") {
    const git = (...args: string[]) => defaultRunner("git", args, { cwd: app, timeoutMs: 20_000 }).catch(() => null);
    const head = await git("rev-parse", "HEAD"), remote = (await git("ls-remote", "origin", "refs/heads/main"))?.split(/\s+/)[0] ?? null;
    const previous = await previousRelease(home);
    // Whether main already passed the regression; the release runs it first otherwise.
    const remoteTree = remote ? await git("rev-parse", "--verify", "-q", `${remote}^{tree}`) : null;
    const tested = remoteTree ? (await passedFull(home, remoteTree))?.at ?? null : null;
    return { ok: true, head, remote, tested, rollbackTo: previous?.from ?? null, last: await readLastDeploy(home), drift: await context.drift() };
  }
  if (command === "deploy" && target) return deploy(context, target, actor, "deploy", { skipTests: argv.includes("--skip-tests") });
  if (command === "rollback") {
    // Hub passes the commit it showed; refuse if the history moved meanwhile.
    const expected = argv.includes("--to") ? argv[argv.indexOf("--to") + 1] : undefined;
    const previous = await previousRelease(home);
    if (expected && previous?.from !== expected) throw new Error("The rollback target changed since the panel opened");
    return rollback(context, actor);
  }
  throw new Error("Usage: deploy.ts status | deploy <commit|origin/main> [--skip-tests] [--actor ID] | rollback [--to COMMIT] [--actor ID]");
}

if (import.meta.main) {
  runDeployCli().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  });
}
