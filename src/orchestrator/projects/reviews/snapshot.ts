import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export function reviewSnapshotPath(home: string, reviewId: string): string {
  if (!/^air_[a-f0-9]+$/u.test(reviewId)) throw new Error("Invalid review snapshot identity");
  return resolve(home, "state/ai-review-snapshots", reviewId);
}

function git(path: string, args: string[], environment = process.env): string {
  return execFileSync("git", ["-C", path, ...args], {
    encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
  }).trim();
}

export function reviewSnapshotMatches(path: string, headSha: string): boolean {
  return git(path, ["rev-parse", "HEAD"]) === headSha && !git(path, ["status", "--porcelain"]);
}

// A standalone repository, not a linked worktree: no shared refs, index, hooks or
// object writes in the managed source copy. Credentials exist only in fetch's env.
export function createReviewSnapshot(path: string, remote: string, pullNumber: number,
  headSha: string, baseSha: string, token?: string): void {
  if (!/^[a-f0-9]{40,64}$/u.test(headSha) || !/^[a-f0-9]{40,64}$/u.test(baseSha) ||
      !Number.isSafeInteger(pullNumber) || pullNumber < 1) throw new Error("Invalid review source identity");
  mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
  mkdirSync(path, { mode: 0o700 }); // Refuse reuse, including an interrupted prior attempt.
  try {
    git(path, ["init", "--quiet", "--template="]);
    git(path, ["config", "core.hooksPath", "/dev/null"]);
    const env = token ? { ...process.env, GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      GIT_CONFIG_KEY_1: "credential.helper", GIT_CONFIG_VALUE_1: "" } : process.env;
    try {
      git(path, ["fetch", "--depth=1", "--no-tags", "--", remote, `refs/pull/${pullNumber}/head`], env);
      if (git(path, ["rev-parse", "FETCH_HEAD"]) !== headSha)
        throw new Error("Pull request changed while preparing review snapshot");
      git(path, ["fetch", "--depth=1", "--no-tags", "--", remote, baseSha], env);
    } catch {
      // Do not propagate diagnostics from an authenticated Git process.
      throw new Error("Could not fetch exact review snapshot; PR may have moved or reviewer access is unavailable");
    }
    git(path, ["checkout", "--quiet", "--detach", headSha]);
    if (!reviewSnapshotMatches(path, headSha)) throw new Error("Review snapshot is not clean at the exact PR SHA");
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw error;
  }
}

export function removeReviewSnapshot(home: string, reviewId: string): void {
  rmSync(reviewSnapshotPath(home, reviewId), { recursive: true, force: true });
}
