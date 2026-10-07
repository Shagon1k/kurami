// Local regression receipts. GitHub Actions is off, so the regression run on this server is the check. A run
// on a clean checkout records the git tree it tested (state/test-receipts/<tree>.json) and reports the
// `kurami/regression` commit status on GitHub, so a pull request shows whether its head passed. A release
// looks up the receipt of the tree it is about to run and runs the suites itself when there is none.
// The receipt is keyed by tree, not commit: tests usually run before the commit, and a merge commit whose
// content was already tested needs no rerun. `report` posts the status once the tested tree is committed.
import { execFile, spawnSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { resolveKuramiHome } from "../core/kurami-home.ts";

const exec = promisify(execFile);

export type TestReceipt = {
  tree: string; commit: string; scope: "full" | "changed"; ok: boolean;
  suites: number; failedSuites: string[]; durationMs: number; at: string;
};

export const STATUS_CONTEXT = "kurami/regression";
const KEEP_DAYS = 30;

export const receiptsDirectory = (home: string): string => resolve(home, "state/test-receipts");
export const receiptPath = (home: string, tree: string): string => resolve(receiptsDirectory(home), `${tree}.json`);

export async function readReceipt(home: string, tree: string): Promise<TestReceipt | null> {
  if (!/^[0-9a-f]{40}$/.test(tree)) return null;
  try { return JSON.parse(await readFile(receiptPath(home, tree), "utf8")) as TestReceipt; } catch { return null; }
}

/** A full passing run of this tree; a later failure of the same tree replaces it. */
export async function passedFull(home: string, tree: string): Promise<TestReceipt | null> {
  const receipt = await readReceipt(home, tree);
  return receipt?.ok && receipt.scope === "full" ? receipt : null;
}

/** Writes the receipt; a passing changed-only run never replaces a full one of the same tree. */
export async function writeReceipt(home: string, receipt: TestReceipt): Promise<void> {
  const previous = await readReceipt(home, receipt.tree);
  if (previous?.ok && previous.scope === "full" && receipt.ok && receipt.scope === "changed") return;
  const directory = receiptsDirectory(home), path = receiptPath(home, receipt.tree), temporary = `${path}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    const info = name.endsWith(".json") ? await stat(resolve(directory, name)).catch(() => null) : null;
    if (info && info.mtimeMs < cutoff) await rm(resolve(directory, name), { force: true });
  }
}

/** The tree of the working directory as it would be committed (untracked files included, ignored ones
 * not), computed in a scratch index so the real one is untouched. Null outside a git checkout. */
export function workingTree(root: string): string | null {
  const git = (args: string[], env: NodeJS.ProcessEnv = process.env) => spawnSync("git", args, { cwd: root, encoding: "utf8", env });
  const real = git(["rev-parse", "--git-path", "index"]).stdout.trim();
  if (!real) return null;
  const index = resolve(tmpdir(), `kurami-test-index-${process.pid}-${Date.now()}`), env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    try { copyFileSync(resolve(root, real), index); } catch {}
    // node_modules (a directory or a worktree's symlink) is ignored by .gitignore, so `add -A` skips it.
    if (git(["add", "-A", "--", "."], env).status !== 0) return null;
    const tree = git(["write-tree"], env).stdout.trim();
    return /^[0-9a-f]{40}$/.test(tree) ? tree : null;
  } finally { rmSync(index, { force: true }); }
}

/** owner/repo of the GitHub origin, or null for another remote. */
export function githubRepository(remoteUrl: string): string | null {
  return /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim())?.[1] ?? null;
}

export function statusDescription(receipt: TestReceipt): string {
  const minutes = Math.max(1, Math.round(receipt.durationMs / 60_000));
  return receipt.ok
    ? `${receipt.scope === "full" ? "All" : "Changed"}: ${receipt.suites} suites passed in ${minutes} min on the server`
    : `Failed: ${receipt.failedSuites.join(", ")}`.slice(0, 140);
}

/** Reports the receipt as a commit status. Best effort: an unpushed commit or no `gh` only logs a line. */
export async function reportStatus(app: string, receipt: TestReceipt): Promise<string> {
  try {
    const repository = githubRepository((await exec("git", ["remote", "get-url", "origin"], { cwd: app })).stdout);
    if (!repository) return "no GitHub origin";
    await exec("gh", ["api", "--method", "POST", `repos/${repository}/statuses/${receipt.commit}`,
      "-f", `state=${receipt.ok ? "success" : "failure"}`, "-f", `context=${STATUS_CONTEXT}`, "-f", `description=${statusDescription(receipt)}`],
      { cwd: app, timeout: 20_000 });
    return `${STATUS_CONTEXT}: ${receipt.ok ? "success" : "failure"} on ${receipt.commit.slice(0, 7)}`;
  } catch (error) {
    return `status not reported (${(error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 120)})`;
  }
}

/** `report [ref]`: posts the status of the receipt for the ref's tree (default HEAD) after it is pushed. */
export async function runTestReceiptsCli(argv = process.argv.slice(2)): Promise<Record<string, unknown>> {
  const [command, ref = "HEAD"] = argv;
  if (command !== "report") throw new Error("Usage: test-receipts.ts report [ref]");
  const app = process.cwd(), home = resolveKuramiHome("/home/shagon1k/_hermes/_kurami");
  const rev = (spec: string) => spawnSync("git", ["rev-parse", "--verify", spec], { cwd: app, encoding: "utf8" }).stdout.trim();
  const commit = rev(`${ref}^{commit}`), tree = rev(`${ref}^{tree}`);
  const receipt = await readReceipt(home, tree);
  if (!receipt) return { ok: false, error: `No test run recorded for ${commit.slice(0, 7)}: run npm test or npm run test:changed first` };
  return { ok: receipt.ok, receipt: { scope: receipt.scope, suites: receipt.suites, at: receipt.at }, status: await reportStatus(app, { ...receipt, commit }) };
}

if (import.meta.main) {
  runTestReceiptsCli().then(result => { process.stdout.write(`${JSON.stringify(result)}\n`); if (!result.ok) process.exitCode = 1; })
    .catch((error: unknown) => { process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`); process.exitCode = 1; });
}
