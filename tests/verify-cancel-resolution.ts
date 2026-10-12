import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function command(program: string, args: string[], cwd?: string): string {
  return execFileSync(program, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function runNode(path: string, args: string[], home: string): Record<string, unknown> {
  return JSON.parse(
    execFileSync(process.execPath, [path, ...args], {
      encoding: "utf8",
      env: { ...process.env, KURAMI_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "kurami-discard-test-")));
  try {
    const canonical = resolve(home, "repos/TailorTales");
    const bare = resolve(home, "origin.git");
    const worktreeRoot = resolve(home, "worktrees");
    await mkdir(canonical, { recursive: true });
    await mkdir(worktreeRoot, { recursive: true });
    command("git", ["init", "-b", "main"], canonical);
    command("git", ["config", "user.name", "Kurami Test"], canonical);
    command("git", ["config", "user.email", "kurami@example.invalid"], canonical);
    await writeFile(resolve(canonical, "file.txt"), "base\n");
    command("git", ["add", "file.txt"], canonical);
    command("git", ["commit", "-m", "base"], canonical);
    command("git", ["init", "--bare", bare]);
    command("git", ["remote", "add", "origin", bare], canonical);
    command("git", ["push", "-u", "origin", "main"], canonical);
    const baseSha = command("git", ["rev-parse", "HEAD"], canonical);

    await mkdir(resolve(home, "config"), { recursive: true });
    await writeFile(
      resolve(home, "config/projects.yaml"),
      `version: 1\nprojects:\n  tailortales:\n    repository: Shagon1k/TailorTales\n    workspace:\n      canonical_repository: ${canonical}\n      worktree_root: ${worktreeRoot}\n`,
    );
    runNode(resolve(app, "src/orchestrator/state/init-run-store.ts"), [], home);
    const database = new DatabaseSync(resolve(home, "state/orchestrator.db"));

    const seed = (runId: string, issue: number, branch: string, path: string): void => {
      database.prepare(`
        INSERT INTO project_events (
          event_id, observed_at, project, item_id, content_id, content_type,
          repository, issue_number, title, url, payload_json, processing_state
        ) VALUES (?, '2026-08-17T00:00:00.000Z', 'tailortales', ?, ?, 'Issue',
                  'Shagon1k/TailorTales', ?, 'Cancel test', 'https://example.invalid',
                  '{}', 'processed')
      `).run(`event-${issue}`, `item-${issue}`, `content-${issue}`, issue);
      database.prepare(`
        INSERT INTO runs (
          run_id, trigger_event_id, project, item_id, content_id, repository,
          issue_number, interaction_policy, state, owner_state, stop_reason,
          execution_mode
        ) VALUES (?, ?, 'tailortales', ?, ?, 'Shagon1k/TailorTales', ?,
                  'autonomous', 'needs_attention', 'none', 'cancelled', 'live')
      `).run(runId, `event-${issue}`, `item-${issue}`, `content-${issue}`, issue);
      database.prepare(`
        INSERT INTO run_resources (
          run_id, resource_state, base_sha, worktree_path, branch_name
        ) VALUES (?, 'provisioned', ?, ?, ?)
      `).run(runId, baseSha, path, branch);
    };

    const attempt = resolve(worktreeRoot, "TT-1_cancel");
    const worktree = resolve(attempt, "TailorTales");
    await mkdir(attempt, { recursive: true });
    command("git", ["worktree", "add", "-b", "TT-1_cancel", worktree, baseSha], canonical);
    await writeFile(resolve(worktree, "file.txt"), "discard me\n");
    seed("r_discard", 1, "TT-1_cancel", worktree);
    database.prepare(`INSERT INTO run_control_requests
      (request_id,run_id,action,requested_via,idempotency_key,request_state)
      VALUES ('rq_discard_successor','r_discard','take_control','cli','discard-successor','applied')`).run();
    database.prepare(`INSERT INTO run_autonomous_successions
      (succession_id,run_id,request_id,succession_number,succession_state,
       predecessor_thread_id,worktree_path,branch_name,source_head_sha,handoff_context_json)
      VALUES ('ras_discard','r_discard','rq_discard_successor',1,'starting',
              'prior-thread',?,'TT-1_cancel',?,'{}')`).run(worktree,baseSha);

    const canonicalScript = resolve(
      app,
      "src/orchestrator/projects/worktrees/cancel-resolution.ts",
    );
    const plan = runNode(canonicalScript, ["discard", "--run-id", "r_discard"], home) as {
      plan: { eligible: boolean; changedFiles: string[] };
    };
    assert(plan.plan.eligible, "Dirty unpublished work was not discardable");
    assert(plan.plan.changedFiles.includes("file.txt"), "Changed file was not reported");
    const applied = runNode(
      canonicalScript,
      ["discard", "--run-id", "r_discard", "--apply"],
      home,
    );
    assert(applied.action === "discarded_local_work", "Discard was not applied");
    const final = database.prepare(`
      SELECT r.state, rr.resource_state
      FROM runs r JOIN run_resources rr USING (run_id)
      WHERE r.run_id = 'r_discard'
    `).get() as { state: string; resource_state: string };
    assert(final.state === "cancelled", "Discard did not finalize cancellation");
    assert(final.resource_state === "released", "Discard did not release resources");
    const succession = database.prepare(`SELECT succession_state,completed_at
      FROM run_autonomous_successions WHERE succession_id='ras_discard'`).get() as
      {succession_state:string;completed_at:string|null};
    assert(succession.succession_state === "parked" && Boolean(succession.completed_at),
      "Discard left its successor active and settings locked");

    const publishedAttempt = resolve(worktreeRoot, "TT-2_published");
    const publishedWorktree = resolve(publishedAttempt, "TailorTales");
    await mkdir(publishedAttempt, { recursive: true });
    command("git", ["worktree", "add", "-b", "TT-2_published", publishedWorktree, baseSha], canonical);
    await writeFile(resolve(publishedWorktree, "file.txt"), "preserve me\n");
    command("git", ["push", "-u", "origin", "TT-2_published"], publishedWorktree);
    seed("r_published", 2, "TT-2_published", publishedWorktree);
    const preserved = runNode(
      canonicalScript,
      ["discard", "--run-id", "r_published", "--apply"],
      home,
    ) as { action: string; blockers: string[] };
    assert(preserved.action === "preserved", "Published branch was not preserved");
    assert(
      preserved.blockers.some((value) => value.includes("remote branch exists")),
      "Published-branch blocker was not explicit",
    );
    assert(
      (await readFile(resolve(publishedWorktree, "file.txt"), "utf8")) === "preserve me\n",
      "Published worktree was mutated",
    );

    const discardPublishedAttempt = resolve(worktreeRoot, "TT-3_discard-published");
    const discardPublishedWorktree = resolve(discardPublishedAttempt, "TailorTales");
    await mkdir(discardPublishedAttempt, { recursive: true });
    command(
      "git",
      ["worktree", "add", "-b", "TT-3_discard-published", discardPublishedWorktree, baseSha],
      canonical,
    );
    await writeFile(resolve(discardPublishedWorktree, "file.txt"), "published result\n");
    command("git", ["add", "file.txt"], discardPublishedWorktree);
    command("git", ["commit", "-m", "published result"], discardPublishedWorktree);
    const publishedHead = command("git", ["rev-parse", "HEAD"], discardPublishedWorktree);
    command("git", ["push", "-u", "origin", "TT-3_discard-published"], discardPublishedWorktree);
    seed(
      "r_discard_published",
      3,
      "TT-3_discard-published",
      discardPublishedWorktree,
    );

    const fakeBin = resolve(home, "fake-bin");
    const fakeGh = resolve(fakeBin, "gh");
    const ghLog = resolve(home, "fake-gh.log");
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      fakeGh,
      `#!/bin/sh
set -eu
case "$1:$2" in
  pr:list)
    printf '%s\\n' "$KURAMI_TEST_PR_JSON"
    ;;
  pr:close)
    printf '%s\\n' "$*" >> "$KURAMI_TEST_GH_LOG"
    ;;
  *)
    printf 'unexpected gh invocation: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`,
    );
    await chmod(fakeGh, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ""}`;
    process.env.KURAMI_TEST_GH_LOG = ghLog;
    process.env.KURAMI_TEST_PR_JSON = JSON.stringify([
      {
        number: 303,
        state: "OPEN",
        isDraft: true,
        headRefOid: publishedHead,
        url: "https://example.invalid/pulls/303",
        title: "Draft result",
      },
    ]);
    const failingHooks = resolve(home, "failing-hooks");
    const failingPrePush = resolve(failingHooks, "pre-push");
    await mkdir(failingHooks, { recursive: true });
    await writeFile(failingPrePush, "#!/bin/sh\nexit 66\n");
    await chmod(failingPrePush, 0o755);
    command(
      "git",
      ["config", "core.hooksPath", failingHooks],
      canonical,
    );
    const publishedDiscard = runNode(
      canonicalScript,
      ["discard-published", "--run-id", "r_discard_published", "--apply"],
      home,
    );
    process.env.PATH = originalPath;
    delete process.env.KURAMI_TEST_GH_LOG;
    delete process.env.KURAMI_TEST_PR_JSON;
    assert(
      publishedDiscard.action === "discarded_published_work",
      "Explicit published discard was not applied",
    );
    assert(!(await pathExists(discardPublishedWorktree)), "Published worktree survived discard");
    assert(
      command(
        "git",
        ["ls-remote", "--heads", "origin", "TT-3_discard-published"],
        canonical,
      ) === "",
      "Published remote branch survived discard",
    );
    assert(
      (await readFile(ghLog, "utf8")).includes("pr close 303"),
      "Verified Draft PR was not closed",
    );
    const publishedFinal = database.prepare(`
      SELECT r.state, rr.resource_state
      FROM runs r JOIN run_resources rr USING (run_id)
      WHERE r.run_id = 'r_discard_published'
    `).get() as { state: string; resource_state: string };
    assert(publishedFinal.state === "cancelled", "Published discard did not finalize cancellation");
    assert(
      publishedFinal.resource_state === "released",
      "Published discard did not release resources",
    );
    database.close();
    process.stdout.write(
      `${JSON.stringify({ ok: true, isolated: true, unpublishedDiscarded: true, publishedPreserved: true, publishedDraftDiscarded: true, changedFilesReported: true })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
