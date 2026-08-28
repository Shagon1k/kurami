import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as canonicalRelease from "../src/orchestrator/projects/worktrees/release.ts";
import * as legacyRelease from "../src/orchestrator/projects/worktrees/release.ts";

process.umask(0o077);

function run(command: string, args: string[], cwd?: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function git(repository: string, args: string[]): string {
  return run("git", ["-C", repository, ...args]);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  legacyRelease.runReleaseWorktreeCli ===
    canonicalRelease.runReleaseWorktreeCli,
  "Legacy release-worktree is not a transparent compatibility wrapper",
);

async function main(): Promise<void> {
  const appDirectory = resolve(import.meta.dirname, "..");
  const testHome = await realpath(
    await mkdtemp(resolve(tmpdir(), "kurami-release-test-")),
  );
  const origin = resolve(testHome, "origin.git");
  const canonical = resolve(testHome, "projects/TailorTales");
  const worktreeRoot = resolve(testHome, "projects/.worktrees/tailortales");
  const fakeBin = resolve(testHome, "bin");
  const fakeGh = resolve(fakeBin, "gh");
  const branch = "TT-9901_release-test";
  const attemptDirectory = resolve(worktreeRoot, branch);
  const worktree = resolve(attemptDirectory, "TailorTales");
  const runId = "r_release_test";

  try {
    await mkdir(canonical, { recursive: true, mode: 0o700 });
    await mkdir(resolve(testHome, "config"), { recursive: true, mode: 0o700 });
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await writeFile(fakeGh, "#!/bin/sh\nprintf '[]\\n'\n", "utf8");
    await chmod(fakeGh, 0o700);
    process.env.PATH = `${fakeBin}:${process.env.PATH ?? ""}`;
    run("git", ["init", "--bare", origin]);
    run("git", ["init", "-b", "main", canonical]);
    git(canonical, ["config", "user.name", "Kurami Test"]);
    git(canonical, ["config", "user.email", "kurami-test@example.invalid"]);
    await writeFile(resolve(canonical, "README.md"), "base\n", "utf8");
    git(canonical, ["add", "README.md"]);
    git(canonical, ["commit", "-m", "test: base"]);
    git(canonical, ["remote", "add", "origin", origin]);
    git(canonical, ["push", "-u", "origin", "main"]);
    const baseSha = git(canonical, ["rev-parse", "HEAD"]);

    await mkdir(attemptDirectory, { recursive: true, mode: 0o700 });
    git(canonical, ["worktree", "add", "-b", branch, worktree, baseSha]);
    await writeFile(resolve(worktree, "release.txt"), "merged work\n", "utf8");
    git(worktree, ["add", "release.txt"]);
    git(worktree, ["commit", "-m", "test: merged work"]);
    const headSha = git(worktree, ["rev-parse", "HEAD"]);

    await writeFile(
      resolve(testHome, "config/projects.yaml"),
      [
        "version: 1",
        "projects:",
        "  tailortales:",
        "    repository: Shagon1k/TailorTales",
        "    workspace:",
        `      canonical_repository: ${canonical}`,
        `      worktree_root: ${worktreeRoot}`,
        "      base_branch: main",
        "",
      ].join("\n"),
      "utf8",
    );
    execFileSync(process.execPath, [resolve(appDirectory, "src/orchestrator/state/init-run-store.ts")], {
      env: {
        ...process.env,
        KURAMI_HOME: testHome,
        ORCHESTRATOR_MIGRATIONS_DIR: resolve(appDirectory, "migrations"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    const databasePath = resolve(testHome, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    database
      .prepare(`
        INSERT INTO project_events (
          event_id, observed_at, project, item_id, content_id, content_type,
          repository, issue_number, title, url, from_status, to_status,
          payload_json, processing_state
        ) VALUES (
          'release-event', '2026-08-14T00:00:00.000Z', 'tailortales',
          'release-item', 'release-content', 'Issue', 'Shagon1k/TailorTales',
          9901, '[Test]: Completed release', 'https://example.invalid/9901',
          'Human Review', 'Done', '{}', 'processed'
        )
      `)
      .run();
    database
      .prepare(`
        INSERT INTO runs (
          run_id, trigger_event_id, project, item_id, content_id, repository,
          issue_number, interaction_policy, state, owner_state,
          execution_mode, stop_reason
        ) VALUES (
          ?, 'release-event', 'tailortales', 'release-item', 'release-content',
          'Shagon1k/TailorTales', 9901, 'autonomous', 'stopping', 'remote',
          'live', 'completed'
        )
      `)
      .run(runId);
    database
      .prepare(`
        INSERT INTO run_resources (
          run_id, resource_state, base_sha, worktree_path, branch_name
        ) VALUES (?, 'provisioned', ?, ?, ?)
      `)
      .run(runId, baseSha, worktree, branch);
    database.close();

    const environment = {
      ...process.env,
      KURAMI_HOME: testHome,
      ORCHESTRATOR_MIGRATIONS_DIR: resolve(appDirectory, "migrations"),
    };
    const release = (script: string, apply: boolean): Record<string, unknown> => {
      const args = [resolve(appDirectory, script), "--run-id", runId];
      if (apply) args.push("--apply");
      return JSON.parse(
        execFileSync(process.execPath, args, {
          encoding: "utf8",
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ) as Record<string, unknown>;
    };

    const beforeMerge = release(
      "src/orchestrator/projects/worktrees/release.ts",
      true,
    );
    assert(beforeMerge.action === "waiting_for_merge", "Unmerged work was released");
    assert(await exists(worktree), "Unmerged worktree was removed");

    git(canonical, ["merge", "--squash", branch]);
    git(canonical, ["commit", "-m", "test: squash merge release branch"]);
    git(canonical, ["push", "origin", "main"]);
    await writeFile(
      fakeGh,
      [
        "#!/bin/sh",
        `printf '%s\\n' '[{"number":9902,"url":"https://example.invalid/pull/9902","headRefOid":"${headSha}","mergedAt":"2026-08-14T12:00:00Z"}]'`,
        "",
      ].join("\n"),
      "utf8",
    );
    const afterMerge = release("src/orchestrator/projects/worktrees/release.ts", true);
    assert(afterMerge.action === "released", "Merged worktree was not released");
    assert(
      afterMerge.mergeEvidence === "github_pr",
      `Expected GitHub PR merge evidence, got ${String(afterMerge.mergeEvidence)}`,
    );
    assert(!(await exists(worktree)), "Merged worktree still exists");

    const verification = new DatabaseSync(databasePath, { readOnly: true });
    const row = verification
      .prepare(`
        SELECT r.state, r.owner_state, rr.resource_state
        FROM runs r JOIN run_resources rr USING (run_id)
        WHERE r.run_id = ?
      `)
      .get(runId) as { state: string; owner_state: string; resource_state: string };
    verification.close();
    assert(
      row.state === "archived" &&
        row.owner_state === "none" &&
        row.resource_state === "released",
      `Unexpected final state: ${JSON.stringify(row)}`,
    );
    process.stdout.write(
      `${JSON.stringify({ ok: true, isolated: true, beforeMerge: beforeMerge.action, afterMerge: afterMerge.action, mergeEvidence: afterMerge.mergeEvidence, baseSha, headSha, final: row })}\n`,
    );
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
