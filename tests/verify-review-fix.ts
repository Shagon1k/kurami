import strictAssert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  fetchSummaryOnlyReviewFindings,
  replyAndResolveReviewThread,
  selectActionableReviewThreads,
} from "../src/orchestrator/integrations/github/review-threads.ts";
import { loadOwnerGitHubTokenFromFile } from "../src/orchestrator/integrations/github/app-auth.ts";
import { reviewFixPrompt } from "../src/orchestrator/projects/sessions/prompts.ts";
import { buildGitHubReviewPayload } from "../src/orchestrator/projects/reviews/worker.ts";

type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runNode(
  script: string,
  args: string[],
  home: string,
  env: NodeJS.ProcessEnv = {},
): JsonObject {
  const output = execFileSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env, KURAMI_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output.trim().split(/\r?\n/u).filter(Boolean).at(-1)!) as JsonObject;
}

function runNodeFailure(
  script: string,
  args: string[],
  home: string,
  env: NodeJS.ProcessEnv = {},
): string {
  try {
    runNode(script, args, home, env);
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
  throw new Error("Expected command to fail");
}

function git(directory: string, args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "kurami-review-fix-test-")));
  try {
    const migrationsDirectory = resolve(app, "migrations");
    const migrations = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
      .sort();
    const upgrade = new DatabaseSync(resolve(home, "upgrade-v15.db"));
    upgrade.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations.filter((name) => name < "016_"))
      upgrade.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    upgrade.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, payload_json, processing_state
      ) VALUES ('event-upgrade-fix','2026-08-19T10:00:00.000Z','tailortales',
        'item-upgrade-fix','content-upgrade-fix','Issue','Shagon1k/TailorTales',
        140,'Upgrade fix','https://example.invalid/issues/140','{}','processed');
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES ('r_upgrade_fix','event-upgrade-fix','tailortales','item-upgrade-fix',
        'content-upgrade-fix','Shagon1k/TailorTales',140,'autonomous',
        'parked_review','none','live');
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via, idempotency_key
      ) VALUES ('rq_aaaaaaaaaaaaaaaa','r_upgrade_fix','ai_review','applied','discord','upgrade:review');
      INSERT INTO run_ai_reviews (
        review_id, run_id, request_id, review_number, review_state, repository,
        pull_request_number, pull_request_url, base_ref, base_sha, head_sha,
        tmux_session_name
      ) VALUES ('air_aaaaaaaaaaaaaaaa','r_upgrade_fix','rq_aaaaaaaaaaaaaaaa',1,'ready',
        'Shagon1k/TailorTales',240,'https://example.invalid/pulls/240','main',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','rv-upgrade-fix');
    `);
    upgrade.exec(await readFile(resolve(migrationsDirectory, "016_review_fix.sql"), "utf8"));
    assert(
      (upgrade.prepare("SELECT COUNT(*) AS count FROM run_ai_reviews").get() as { count: number }).count === 1 &&
        upgrade.prepare("PRAGMA foreign_key_check").all().length === 0,
      "Schema 16 did not preserve populated P3 review data",
    );
    for (const migration of migrations.filter((name) => name.slice(0, 3) > "016"))
      upgrade.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    upgrade.exec(`
      INSERT INTO run_control_requests (
        request_id, run_id, action, requested_via, idempotency_key
      ) VALUES ('rq_upgrade_recovery','r_upgrade_fix','recover_managed_task',
        'cli','upgrade:managed-recovery');
    `);
    assert(
      (upgrade.prepare("SELECT COUNT(*) AS count FROM run_ai_reviews").get() as { count: number }).count === 1 &&
        (upgrade.prepare("SELECT action FROM run_control_requests WHERE request_id='rq_upgrade_recovery'").get() as { action: string }).action === "recover_managed_task" &&
        upgrade.prepare("PRAGMA foreign_key_check").all().length === 0,
      "Managed recovery migration did not preserve populated control dependencies",
    );
    upgrade.close();

    const head = "b".repeat(40);
    const marker = `<!-- kurami-ai-finding:air_abcd:1;head=${head} -->`;
    const selected = selectActionableReviewThreads(
      [
        {
          id: "thread-ai",
          isResolved: false,
          isOutdated: false,
          path: "src/a.ts",
          line: 12,
          comments: {
            nodes: [
              { databaseId: 101, author: { login: "kurami-ai" }, body: `Important finding\n${marker}`, url: "https://example.invalid/thread-ai" },
              { databaseId: 102, author: { login: "Shagon1k" }, body: "Keep the public behavior unchanged." },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
        {
          id: "thread-owner",
          isResolved: false,
          isOutdated: false,
          path: "src/b.ts",
          line: 7,
          comments: {
            nodes: [{ databaseId: 201, author: { login: "Shagon1k" }, body: "Please cover this edge case.", url: "https://example.invalid/thread-owner" }],
          },
        },
        {
          id: "thread-foreign",
          isResolved: false,
          isOutdated: false,
          path: "src/c.ts",
          line: 3,
          comments: { nodes: [{ databaseId: 301, author: { login: "someone" }, body: "Untrusted comment" }] },
        },
        {
          id: "thread-resolved",
          isResolved: true,
          isOutdated: false,
          path: "src/d.ts",
          line: 4,
          comments: { nodes: [{ databaseId: 401, author: { login: "Shagon1k" }, body: "Already handled" }] },
        },
      ],
      "Shagon1k",
      head,
      new Set(["air_abcd"]),
    );
    assert(
      selected.length === 2 &&
        selected[0]?.sourceKind === "ai" &&
        selected[0]?.reviewId === "air_abcd" && selected[0]?.findingNumber === 1 &&
        selected[0]?.ownerReplies[0] === "Keep the public behavior unchanged." &&
        selected[1]?.sourceKind === "owner" && selected[1]?.reviewId === null && selected[1]?.findingNumber === null,
      "Review thread snapshot was not deterministic",
    );
    const summaryPayload = buildGitHubReviewPayload(
      {
        summary: "Anchor fallback.",
        findings: [
          { severity: "important", confidence: "high", title: "GitHub source", body: "Read this from GitHub.", path: "src/fallback.ts", line: 9 },
        ],
      },
      "air_abcd",
      head,
      { inlineFindings: [], summaryOnlyFindings: [{ severity: "important", confidence: "high", title: "GitHub source", body: "Read this from GitHub.", path: "src/fallback.ts", line: 9 }] },
    );
    const githubSummaryFindings = await fetchSummaryOnlyReviewFindings(
      "app-token",
      "Shagon1k/TailorTales",
      240,
      head,
      [{ reviewId: "air_abcd", githubReviewId: "88" }],
      async () => new Response(JSON.stringify({ commit_id: head, body: summaryPayload.body }), { status: 200 }),
    );
    assert(
      githubSummaryFindings.length === 1 &&
        githubSummaryFindings[0]?.title === "GitHub source" &&
        githubSummaryFindings[0]?.reviewId === "air_abcd",
      "Fix Review did not reload summary-only findings from GitHub",
    );
    const legacyBotLogin = selectActionableReviewThreads(
      [
        {
          id: "thread-legacy-bot-login",
          isResolved: false,
          isOutdated: false,
          path: "src/legacy.ts",
          line: 2,
          comments: {
            nodes: [
              {
                databaseId: 501,
                author: { login: "kurami-ai[bot]" },
                body: `Legacy login shape\n${marker}`,
              },
            ],
          },
        },
      ],
      "Shagon1k",
      head,
      new Set(["air_abcd"]),
    );
    assert(
      legacyBotLogin[0]?.sourceKind === "ai",
      "GitHub App login normalization rejected the legacy bot suffix",
    );
    const longRoot = "  Owner requirement\n" + "evidence ".repeat(900) + "\nMigration, replay matching and final verification.  ";
    const longReply = "Follow-up: " + "я".repeat(4500) + " preserve this final requirement.";
    const complete = selectActionableReviewThreads([{
      id: "long-owner", path: "schema.prisma", comments: { nodes: [
        { databaseId: 900, author: { login: "Shagon1k" }, body: longRoot },
        { databaseId: 901, author: { login: "Shagon1k" }, body: longReply },
      ] },
    }], "Shagon1k", head, new Set());
    strictAssert.equal(complete[0]!.rootBody, longRoot);
    strictAssert.deepEqual(complete[0]!.ownerReplies, [longReply]);
    const evidenceRun = {repository:"owner/repo", issue_number:1, issue_url:"", run_id:"r_test"};
    const evidenceContext = {requestId:"rq_test",roundId:"rfr_test",roundNumber:1,sourceHeadSha:head,
      pullRequestNumber:1,pullRequestUrl:"https://github.com/owner/repo/pull/1",threads:complete,summaryOnlyFindings:[]};
    const completePrompt = reviewFixPrompt(evidenceRun, evidenceContext);
    strictAssert.ok(completePrompt.includes(longRoot.replaceAll("\n", "\\n")));
    strictAssert.ok(completePrompt.includes("preserve this final requirement."));
    strictAssert.ok(completePrompt.includes("only when explicitly authorized by the owner"));
    strictAssert.ok(completePrompt.includes("does not authorize applying migrations to production or shared databases"));
    strictAssert.ok(!completePrompt.includes("dependency upgrades, migrations, permissions"));
    strictAssert.throws(() => reviewFixPrompt(evidenceRun, {...evidenceContext,
      threads:[{...complete[0]!,rootBody:"я".repeat(40000)}]}), /64 KiB.*no requirements were truncated/);

    const prompt = reviewFixPrompt(
      {
        repository: "Shagon1k/TailorTales",
        issue_number: 140,
        issue_url: "https://example.invalid/issues/140",
        run_id: "r_review_fix",
      },
      {
        requestId: "rq_fix",
        roundId: "rfr_fix",
        roundNumber: 1,
        sourceHeadSha: head,
        pullRequestNumber: 240,
        pullRequestUrl: "https://example.invalid/pulls/240",
        threads: selected,
        summaryOnlyFindings: [
          {
            reviewId: "air_abcd",
            findingNumber: 2,
            severity: "important",
            confidence: "high",
            title: "Summary-only finding",
            body: "GitHub rejected the inline anchor, so this evidence must still be fixed.",
            path: "src/fallback.ts",
            line: 9,
          },
        ],
      },
    );
    assert(
      prompt.includes(`exact PR head SHA ${head}`) &&
        prompt.includes("Fix exactly these 3 review item") &&
        prompt.includes("Summary-only finding") &&
        prompt.includes("GitHub rejected the inline anchor") &&
        prompt.includes("Do not address new or resolved threads") &&
        prompt.includes("never force-push") &&
        prompt.includes("Do not ask for or wait for a separate interactive commit confirmation") &&
        prompt.includes("do not start another review or fix round"),
      "Review fix prompt is not exact-SHA bounded",
    );

    let phase: "first" | "second" = "first";
    let requests = 0;
    const authorizations: string[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      requests += 1;
      authorizations.push(String(new Headers(init?.headers).get("Authorization")));
      const url = String(input);
      const payload = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      if (url.endsWith("/graphql") && payload.query?.includes("query("))
        return new Response(
          JSON.stringify({
            data: {
              node: {
                isResolved: phase === "second",
                comments: {
                  nodes:
                    phase === "second"
                      ? [{ databaseId: 999, body: "done\n<!-- kurami-review-fix:rfr_fix:thread-ai -->" }]
                      : [],
                },
              },
            },
          }),
          { status: 200 },
        );
      if (url.includes("/comments/101/replies"))
        return new Response(JSON.stringify({ id: 999 }), { status: 201 });
      return new Response(
        JSON.stringify({ data: { resolveReviewThread: { thread: { id: "thread-ai", isResolved: true } } } }),
        { status: 200 },
      );
    };
    const replyBody = "Fixed.\n<!-- kurami-review-fix:rfr_fix:thread-ai -->";
    const replyId = await replyAndResolveReviewThread(
      "app-token",
      "owner-token",
      "Shagon1k/TailorTales",
      240,
      "thread-ai",
      101,
      replyBody,
      fakeFetch,
    );
    assert(
      replyId === 999 &&
        requests === 3 &&
        authorizations[0] === "Bearer app-token" &&
        authorizations[1] === "Bearer app-token" &&
        authorizations[2] === "Bearer owner-token",
      "Review reply and resolution did not use split credentials",
    );
    phase = "second";
    requests = 0;
    authorizations.length = 0;
    await replyAndResolveReviewThread(
      "app-token",
      "owner-token",
      "Shagon1k/TailorTales",
      240,
      "thread-ai",
      101,
      replyBody,
      fakeFetch,
    );
    assert(
      requests === 1 && authorizations[0] === "Bearer app-token",
      "Review thread reconciliation is not idempotent",
    );

    await mkdir(resolve(home, "secrets"), { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(home, "secrets/github.env"),
      "export GH_TOKEN=github_pat_1234567890abcdefghij\nPROJECT_HINT=ignored\n",
      { mode: 0o600 },
    );
    assert(
      (await loadOwnerGitHubTokenFromFile(home)) ===
        "github_pat_1234567890abcdefghij",
      "Owner GitHub token was not loaded from the protected secret file",
    );

    await mkdir(resolve(home, "config"), { recursive: true });
    await writeFile(
      resolve(home, "config/orchestrator.yaml"),
      await readFile(resolve(app, "deploy/config/orchestrator.yaml"), "utf8"),
    );
    const worktreeRoot = resolve(home, "worktrees/tailortales");
    const happyWorktree = resolve(worktreeRoot, "141/TailorTales");
    const dirtyWorktree = resolve(worktreeRoot, "142/TailorTales");
    const canonicalRepository = resolve(home, "repositories/TailorTales");
    let projects = await readFile(
      resolve(app, "deploy/config/projects.yaml"),
      "utf8",
    );
    projects = projects
      .replace("/home/shagon1k/_projects/TailorTales", canonicalRepository)
      .replace(
        "/home/shagon1k/_projects/.worktrees/tailortales",
        worktreeRoot,
      );
    await writeFile(
      resolve(home, "config/projects.yaml"),
      projects,
    );
    for (const [worktree, branch] of [
      [happyWorktree, "TT-141_fix"],
      [dirtyWorktree, "TT-142_fix"],
    ] as const) {
      await mkdir(worktree, { recursive: true, mode: 0o700 });
      execFileSync(
        "git",
        ["init", "--initial-branch", branch, worktree],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      git(worktree, ["config", "user.name", "Kurami Test"]);
      git(worktree, ["config", "user.email", "kurami@example.invalid"]);
      await writeFile(resolve(worktree, "review-fix.txt"), "source\n");
      git(worktree, ["add", "review-fix.txt"]);
      git(worktree, ["commit", "-m", "source"]);
    }
    const sourceSha = git(happyWorktree, ["rev-parse", "HEAD"]);
    const dirtySourceSha = git(dirtyWorktree, ["rev-parse", "HEAD"]);
    await writeFile(resolve(happyWorktree, "review-fix.txt"), "delivered\n");
    git(happyWorktree, ["add", "review-fix.txt"]);
    git(happyWorktree, ["commit", "-m", "deliver review fix"]);
    const resultSha = git(happyWorktree, ["rev-parse", "HEAD"]);
    await writeFile(resolve(dirtyWorktree, "review-fix.txt"), "staged fix\n");
    git(dirtyWorktree, ["add", "review-fix.txt"]);
    runNode(resolve(app, "src/orchestrator/state/init-run-store.ts"), [], home);
    const state = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    state.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, payload_json, processing_state
      ) VALUES ('event-fix','2026-08-19T11:00:00.000Z','tailortales','item-fix',
        'content-fix','Issue','Shagon1k/TailorTales',141,'Fix review',
        'https://example.invalid/issues/141','{}','processed');
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES ('r_review_fix','event-fix','tailortales','item-fix','content-fix',
        'Shagon1k/TailorTales',141,'autonomous','parked_review','none','live');
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name, codex_thread_id
      ) VALUES ('r_review_fix','provisioned','/tmp/review-fix','TT-141_fix','01a-primary');
      INSERT INTO run_ci_snapshots (
        run_id, repository, pull_request_number, pull_request_url,
        pull_request_title, head_sha, aggregate_state, checks_json,
        content_digest, first_observed_at, last_observed_at, completed_at
      ) VALUES ('r_review_fix','Shagon1k/TailorTales',241,
        'https://example.invalid/pulls/241','Fix review',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','passed','[]','fix-ci',
        '2026-08-19T11:00:00.000Z','2026-08-19T11:01:00.000Z','2026-08-19T11:01:00.000Z');
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via, idempotency_key
      ) VALUES ('rq_review_ready','r_review_fix','ai_review','applied','discord','review:ready');
      INSERT INTO run_ai_reviews (
        review_id, run_id, request_id, review_number, review_state, repository,
        pull_request_number, pull_request_url, base_ref, base_sha, head_sha,
        tmux_session_name, important_count
      ) VALUES ('air_review_ready','r_review_fix','rq_review_ready',1,'ready',
        'Shagon1k/TailorTales',241,'https://example.invalid/pulls/241','main',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','rv-review-ready',1);
    `);
    state
      .prepare(
        `UPDATE run_resources SET worktree_path=? WHERE run_id='r_review_fix'`,
      )
      .run(happyWorktree);
    state
      .prepare(
        `UPDATE run_ci_snapshots SET head_sha=? WHERE run_id='r_review_fix'`,
      )
      .run(sourceSha);
    state
      .prepare(
        `UPDATE run_ai_reviews SET head_sha=? WHERE run_id='r_review_fix'`,
      )
      .run(sourceSha);
    state.close();
    const controls = runNode(
      resolve(app, "src/orchestrator/controls/run.ts"),
      ["controls", "--project", "tailortales", "--issue", "141"],
      home,
    );
    assert(
      (controls.available_actions as string[]).includes("review_fix"),
      "Current actionable review did not expose Fix Review",
    );
    const created = runNode(
      resolve(app, "src/orchestrator/controls/run.ts"),
      ["request", "--run-id", "r_review_fix", "--action", "review_fix", "--via", "discord", "--apply"],
      home,
    );
    const controller = runNode(resolve(app, "src/orchestrator/runtime/controller.ts"), [], home);
    assert(
      (controller.plans as JsonObject[]).some(
        (plan) => plan.action === "review_fix_start" && plan.requestId === created.requestId,
      ),
      "Controller did not plan the explicit review fix",
    );

    const fakeBin = resolve(home, "fake-bin");
    const fakeTmuxState = resolve(home, "review-fix-tmux-alive");
    const fakeTmuxLog = resolve(home, "review-fix-tmux.log");
    const fakeCodex = resolve(home, "fake-codex.mjs");
    const archiveLog = resolve(home, "review-fix-archives.log");
    await mkdir(fakeBin, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(fakeBin, "tmux"),
      `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_TMUX_LOG"
case "$1" in
  has-session)
    test -f "$FAKE_TMUX_STATE"
    ;;
  capture-pane)
    printf '%s\\n' 'Review fixes committed and pushed.' \
      '─ Worked for 5m 58s ─' \
      'Token usage: total=97,952 input=85,968 output=11,984' \
      'To continue this session, run codex resume 01a07546-c4c9-7ac3-a74e-1e5ca49f39a8'
    ;;
  send-keys)
    exit 0
    ;;
  kill-session)
    /bin/rm -f "$FAKE_TMUX_STATE"
    ;;
  *)
    exit 64
    ;;
esac
`,
      { mode: 0o700 },
    );
    await writeFile(fakeTmuxState, "alive\n", { mode: 0o600 });
    await writeFile(
      fakeCodex,
      `#!${process.execPath}\nimport { appendFileSync, existsSync, writeFileSync } from "node:fs";\nimport { createInterface } from "node:readline";\nimport { DatabaseSync } from "node:sqlite";\nconst lines = createInterface({ input: process.stdin });\nfor await (const line of lines) {\n  const message = JSON.parse(line);\n  if (message.method === "thread/archive") {\n    appendFileSync(process.env.FAKE_CODEX_ARCHIVE_LOG, message.params.threadId + "\\n");\n    if (process.env.FAKE_ARCHIVE_MUTATION_DB && process.env.FAKE_ARCHIVE_MUTATION_MARKER && !existsSync(process.env.FAKE_ARCHIVE_MUTATION_MARKER)) {\n      const database = new DatabaseSync(process.env.FAKE_ARCHIVE_MUTATION_DB);\n      database.prepare("UPDATE runs SET owner_state='remote' WHERE run_id=?").run(process.env.FAKE_ARCHIVE_MUTATION_RUN);\n      database.close();\n      writeFileSync(process.env.FAKE_ARCHIVE_MUTATION_MARKER, "mutated\\n");\n    }\n  }\n  if (typeof message.id === "number") {\n    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");\n  }\n}\n`,
      { mode: 0o700 },
    );
    const lifecycleEnv = {
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_TMUX_STATE: fakeTmuxState,
      FAKE_TMUX_LOG: fakeTmuxLog,
      CODEX_BIN: fakeCodex,
      FAKE_CODEX_ARCHIVE_LOG: archiveLog,
      CONTROLLER_QUIET: "0",
    };
    const lifecycleState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const requestId = String(created.requestId);
    lifecycleState
      .prepare(
        `UPDATE run_control_requests
         SET request_state='applied', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE request_id=?`,
      )
      .run(requestId);
    lifecycleState.exec(`
      UPDATE runs SET owner_state='cli' WHERE run_id='r_review_fix';
      UPDATE run_resources
      SET tmux_session_name='cx-tt-141-review-fix',
          codex_thread_id='01a-review-fix-completed',
          previous_codex_thread_id='01a-primary'
      WHERE run_id='r_review_fix';
      UPDATE run_ci_snapshots
      SET aggregate_state='passed'
      WHERE run_id='r_review_fix';
    `);
    lifecycleState
      .prepare(
        `UPDATE run_ci_snapshots SET head_sha=? WHERE run_id='r_review_fix'`,
      )
      .run(resultSha);
    lifecycleState
      .prepare(
        `INSERT INTO run_review_fix_rounds (
           round_id, run_id, request_id, round_number, round_state,
           repository, pull_request_number, pull_request_url,
           source_head_sha, snapshot_json, codex_thread_id
         ) VALUES ('rfr_feedface1234','r_review_fix',?,1,'running',
           'Shagon1k/TailorTales',241,'https://example.invalid/pulls/241',
           ?,'[]',
           '01a-review-fix-completed')`,
      )
      .run(requestId, sourceSha);
    lifecycleState.exec(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,thread_id,turn_id,phase,turn_status,stopped_at,worktree_path,branch_name)
      SELECT 'task-'||f.round_id,f.run_id,'review_fix',f.round_id,rr.tmux_session_name,rr.codex_thread_id,'turn-'||f.round_id,'terminal','completed',strftime('%Y-%m-%dT%H:%M:%fZ','now'),rr.worktree_path,rr.branch_name
      FROM run_review_fix_rounds f JOIN run_resources rr USING(run_id) WHERE f.round_id='rfr_feedface1234'`);
    lifecycleState.close();

    const lifecycleController = runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    assert(
      (lifecycleController.results as JsonObject[]).some(
        (result) =>
          result.runId === "r_review_fix" &&
          result.action === "park" &&
          result.status === "applied",
      ),
      "Controller did not park a completed review-fix writer",
    );
    const lifecycleVerify = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const lifecycleRound = lifecycleVerify
      .prepare(
        `SELECT f.round_state, f.result_head_sha, f.waiting_ci_started_at,
                r.owner_state, rr.tmux_session_name
         FROM run_review_fix_rounds f
         JOIN runs r USING (run_id)
         JOIN run_resources rr USING (run_id)
         WHERE f.round_id='rfr_feedface1234'`,
      )
      .get() as {
      round_state: string;
      result_head_sha: string | null;
      waiting_ci_started_at: string | null;
      owner_state: string;
      tmux_session_name: string | null;
    };
    assert(
      lifecycleRound.round_state === "waiting_ci" &&
        lifecycleRound.result_head_sha === null &&
        lifecycleRound.waiting_ci_started_at !== null &&
        lifecycleRound.owner_state === "none" &&
        lifecycleRound.tmux_session_name === null,
      "Terminal review-fix observation did not stop at a fresh CI-wait boundary",
    );
    const shutdownCalls = await readFile(fakeTmuxLog, "utf8");
    assert(
      shutdownCalls.includes(
        "kill-session -t =cx-tt-141-review-fix",
      ),
      "Completed unresponsive Codex process was not boundedly stopped",
    );
    lifecycleVerify.close();
    const ciObservationController = runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    assert(
      (ciObservationController.results as JsonObject[]).some(
        (result) =>
          result.action === "review_fix_resolve" &&
          result.roundId === "rfr_feedface1234",
      ),
      "Fresh controller observation did not execute review-fix resolution",
    );
    const observedState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const observedRound = observedState
      .prepare(
        `SELECT round_state, result_head_sha
         FROM run_review_fix_rounds WHERE round_id='rfr_feedface1234'`,
      )
      .get() as { round_state: string; result_head_sha: string | null };
    assert(
      observedRound.round_state === "resolving" &&
        observedRound.result_head_sha === resultSha,
      "Fresh exact CI observation did not advance the round to resolution",
    );
    const resolvingController = runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      [],
      home,
    );
    assert(
      (resolvingController.plans as JsonObject[]).some(
        (plan) =>
          plan.action === "review_fix_resolve" &&
          plan.roundId === "rfr_feedface1234",
      ),
      "Controller did not schedule review thread resolution",
    );
    observedState.exec(`
      UPDATE run_review_fix_rounds
      SET round_state='succeeded', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE round_id='rfr_feedface1234';
    `);
    observedState.close();
    const cleanupController = runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    assert(
      (cleanupController.results as JsonObject[]).some(
        (result) =>
          result.action === "review_fix_cleanup" &&
          result.runId === "r_review_fix" &&
          result.status === "applied",
      ),
      `Controller did not apply review-fix task cleanup: ${JSON.stringify(cleanupController)}`,
    );
    const lifecycleCleanup = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const cleanedMapping = lifecycleCleanup
      .prepare(
        `SELECT codex_thread_id, previous_codex_thread_id
         FROM run_resources WHERE run_id='r_review_fix'`,
      )
      .get() as {
      codex_thread_id: string;
      previous_codex_thread_id: string | null;
    };
    assert(
      cleanedMapping.codex_thread_id === "01a-primary" &&
        cleanedMapping.previous_codex_thread_id === null &&
        (await readFile(archiveLog, "utf8")).trim() ===
          "01a-review-fix-completed",
      "Successful review-fix cleanup did not archive the writer and restore the primary task",
    );
    lifecycleCleanup.close();

    const secondReviewRequest = runNode(
      resolve(app, "src/orchestrator/controls/run.ts"),
      ["request", "--run-id", "r_review_fix", "--action", "ai_review", "--via", "discord", "--apply"],
      home,
    );
    const secondReviewId = String(secondReviewRequest.requestId);
    const secondReviewState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    secondReviewState
      .prepare(
        `UPDATE run_control_requests
         SET request_state='applied', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE request_id=?`,
      )
      .run(secondReviewId);
    secondReviewState
      .prepare(
        `INSERT INTO run_ai_reviews (
           review_id, run_id, request_id, review_number, review_state,
           repository, pull_request_number, pull_request_url, base_ref,
           base_sha, head_sha, tmux_session_name, important_count
         ) VALUES ('air_second_cycle','r_review_fix',?,2,'ready',
           'Shagon1k/TailorTales',241,'https://example.invalid/pulls/241',
           'main',?,?, 'rv-second-cycle',1)`,
      )
      .run(secondReviewId, sourceSha, resultSha);
    secondReviewState.close();
    const secondFixRequest = runNode(
      resolve(app, "src/orchestrator/controls/run.ts"),
      ["request", "--run-id", "r_review_fix", "--action", "review_fix", "--via", "discord", "--apply"],
      home,
    );
    const secondFixRequestId = String(secondFixRequest.requestId);

    await writeFile(resolve(happyWorktree, "review-fix.txt"), "delivered twice\n");
    git(happyWorktree, ["add", "review-fix.txt"]);
    git(happyWorktree, ["commit", "-m", "deliver second review fix"]);
    const secondResultSha = git(happyWorktree, ["rev-parse", "HEAD"]);
    await writeFile(fakeTmuxState, "alive\n", { mode: 0o600 });
    const secondFixState = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    secondFixState
      .prepare(
        `UPDATE run_control_requests
         SET request_state='applied', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE request_id=?`,
      )
      .run(secondFixRequestId);
    secondFixState.exec(`
      UPDATE runs SET state='parked_review', owner_state='cli'
      WHERE run_id='r_review_fix';
      UPDATE run_resources
      SET tmux_session_name='cx-tt-141-review-fix-2',
          codex_thread_id='01a-review-fix-completed-2',
          previous_codex_thread_id='01a-primary'
      WHERE run_id='r_review_fix';
      UPDATE run_ci_snapshots
      SET head_sha='${resultSha}', aggregate_state='pending', completed_at=NULL,
          last_error=NULL,
          last_observed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id='r_review_fix';
    `);
    secondFixState
      .prepare(
        `INSERT INTO run_review_fix_rounds (
           round_id, run_id, request_id, round_number, round_state,
           repository, pull_request_number, pull_request_url,
           source_head_sha, snapshot_json, codex_thread_id,
           created_at, updated_at
         ) VALUES ('rfr_deadbeef5678','r_review_fix',?,2,'running',
           'Shagon1k/TailorTales',241,'https://example.invalid/pulls/241',
           ?,'[]','01a-review-fix-completed-2',
           '2026-08-19T10:00:00.000Z','2026-08-19T10:00:00.000Z')`,
      )
      .run(secondFixRequestId, resultSha);
    secondFixState.exec(`
      INSERT INTO run_review_fix_threads (
        round_id, thread_id, root_comment_id, source_kind, path, line
      ) VALUES ('rfr_deadbeef5678','thread-pf-11',711,'owner',
        'src/review-fix.ts',27);
    `);
    let duplicateActiveRejected = false;
    try {
      secondFixState.exec(`
        INSERT INTO run_control_requests (
          request_id, run_id, action, request_state, requested_via, idempotency_key
        ) VALUES ('rq_duplicate_active','r_review_fix','review_fix','applied','cli','duplicate-active');
        INSERT INTO run_review_fix_rounds (
          round_id, run_id, request_id, round_number, round_state,
          repository, pull_request_number, pull_request_url,
          source_head_sha, snapshot_json
        ) VALUES ('rfr_duplicate_active','r_review_fix','rq_duplicate_active',3,'running',
          'Shagon1k/TailorTales',241,'https://example.invalid/pulls/241',
          '${resultSha}','[]');
      `);
    } catch {
      duplicateActiveRejected = true;
      secondFixState.exec(
        `DELETE FROM run_control_requests WHERE request_id='rq_duplicate_active'`,
      );
    }
    secondFixState.exec(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,thread_id,turn_id,phase,turn_status,stopped_at,worktree_path,branch_name)
      SELECT 'task-'||f.round_id,f.run_id,'review_fix',f.round_id,rr.tmux_session_name,rr.codex_thread_id,'turn-'||f.round_id,'terminal','completed',strftime('%Y-%m-%dT%H:%M:%fZ','now'),rr.worktree_path,rr.branch_name
      FROM run_review_fix_rounds f JOIN run_resources rr USING(run_id) WHERE f.run_id='r_review_fix' AND f.round_state='running'`);
    secondFixState.close();
    assert(duplicateActiveRejected, "A second active review-fix round was admitted");

    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const secondBoundaryState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const secondBoundary = secondBoundaryState
      .prepare(
        `SELECT f.round_state, f.failure_reason, f.waiting_ci_started_at,
                r.state AS run_state, rr.codex_thread_id,
                rr.previous_codex_thread_id
         FROM run_review_fix_rounds f
         JOIN runs r USING (run_id)
         JOIN run_resources rr USING (run_id)
         WHERE f.round_id='rfr_deadbeef5678'`,
      )
      .get() as {
      round_state: string;
      failure_reason: string | null;
      waiting_ci_started_at: string | null;
      run_state: string;
      codex_thread_id: string;
      previous_codex_thread_id: string | null;
    };
    assert(
      secondBoundary.round_state === "waiting_ci" &&
        secondBoundary.failure_reason === null &&
        secondBoundary.waiting_ci_started_at !== null &&
        secondBoundary.run_state === "parked_review" &&
        secondBoundary.codex_thread_id === "01a-review-fix-completed-2" &&
        secondBoundary.previous_codex_thread_id === "01a-primary",
      "Stale task timestamps caused immediate review_fix_no_new_head after park",
    );
    secondBoundaryState.close();
    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const delayedState = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    const stillWaiting = delayedState
      .prepare(
        `SELECT round_state FROM run_review_fix_rounds
         WHERE round_id='rfr_deadbeef5678'`,
      )
      .get() as { round_state: string };
    assert(
      stillWaiting.round_state === "waiting_ci",
      "Fresh CI-wait boundary reused the stale task start time",
    );
    delayedState.exec(`
      UPDATE run_review_fix_rounds
      SET waiting_ci_started_at='2026-08-19T10:00:00.000Z'
      WHERE round_id='rfr_deadbeef5678';
    `);
    delayedState.close();
    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const falseFailureState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const falseFailure = falseFailureState
      .prepare(
        `SELECT f.round_state, f.failure_reason, f.completed_at,
                r.state AS run_state, rr.codex_thread_id,
                rr.previous_codex_thread_id
         FROM run_review_fix_rounds f JOIN runs r USING (run_id)
         JOIN run_resources rr USING (run_id)
         WHERE f.round_id='rfr_deadbeef5678'`,
      )
      .get() as {
      round_state: string;
      failure_reason: string | null;
      completed_at: string;
      run_state: string;
      codex_thread_id: string;
      previous_codex_thread_id: string | null;
    };
    assert(
      falseFailure.round_state === "needs_attention" &&
        falseFailure.failure_reason === "review_fix_no_new_head" &&
        falseFailure.run_state === "needs_attention" &&
        falseFailure.codex_thread_id === "01a-review-fix-completed-2" &&
        falseFailure.previous_codex_thread_id === "01a-primary",
      "Timed-out no-new-head state did not preserve exact recovery identity",
    );
    falseFailureState.exec(`
      INSERT INTO run_state_history (
        run_id, from_state, to_state, reason, details_json
      ) VALUES ('r_review_fix','needs_attention','needs_attention',
        'generic_needs_attention','{}');
      UPDATE run_ci_snapshots
      SET head_sha='${secondResultSha}', aggregate_state='passed',
          completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          last_observed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id='r_review_fix';
      UPDATE run_review_fix_rounds
      SET completed_at=datetime('now','-1 second')
      WHERE round_id='rfr_deadbeef5678';
    `);
    falseFailureState.close();
    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const negativeState = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    assert(
      (negativeState.prepare(
        `SELECT round_state FROM run_review_fix_rounds WHERE round_id='rfr_deadbeef5678'`,
      ).get() as { round_state: string }).round_state === "needs_attention",
      "Generic needs_attention was accepted as no-new-head recovery evidence",
    );
    negativeState.exec(`
      INSERT INTO run_state_history (
        run_id, from_state, to_state, reason, details_json
      ) VALUES ('r_review_fix','needs_attention','needs_attention',
        'review_fix_no_new_head','{}');
      UPDATE run_resources SET codex_thread_id='01a-mismatched-task'
      WHERE run_id='r_review_fix';
    `);
    negativeState.close();
    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const mismatchedState = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    assert(
      (mismatchedState.prepare(
        `SELECT round_state FROM run_review_fix_rounds WHERE round_id='rfr_deadbeef5678'`,
      ).get() as { round_state: string }).round_state === "needs_attention",
      "Changed review-fix task identity was accepted for automatic recovery",
    );
    mismatchedState.exec(`
      UPDATE run_resources
      SET codex_thread_id='01a-primary', previous_codex_thread_id=NULL
      WHERE run_id='r_review_fix';
    `);
    mismatchedState.close();
    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const unprovenCleanupState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    assert(
      (unprovenCleanupState.prepare(
        `SELECT round_state FROM run_review_fix_rounds WHERE round_id='rfr_deadbeef5678'`,
      ).get() as { round_state: string }).round_state === "needs_attention",
      "Restored-primary mapping without exact cleanup evidence was accepted",
    );
    unprovenCleanupState.exec(`
      UPDATE run_resources
      SET codex_thread_id='01a-review-fix-completed-2',
          previous_codex_thread_id='01a-primary',
          tmux_session_name='cx-tt-141-still-active'
      WHERE run_id='r_review_fix';
      UPDATE runs SET owner_state='cli' WHERE run_id='r_review_fix';
    `);
    unprovenCleanupState.close();
    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const activeState = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    assert(
      (activeState.prepare(
        `SELECT round_state FROM run_review_fix_rounds WHERE round_id='rfr_deadbeef5678'`,
      ).get() as { round_state: string }).round_state === "needs_attention",
      "Active review-fix worker was accepted for automatic recovery",
    );
    activeState.exec(`
      UPDATE run_resources SET tmux_session_name=NULL WHERE run_id='r_review_fix';
      UPDATE runs SET owner_state='none' WHERE run_id='r_review_fix';
      UPDATE run_ci_snapshots SET aggregate_state='unknown', completed_at=NULL
      WHERE run_id='r_review_fix';
    `);
    activeState.close();
    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const unknownState = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    assert(
      (unknownState.prepare(
        `SELECT round_state FROM run_review_fix_rounds WHERE round_id='rfr_deadbeef5678'`,
      ).get() as { round_state: string }).round_state === "needs_attention",
      "Unknown CI state was accepted for automatic no-new-head recovery",
    );
    unknownState.exec(`
      UPDATE run_ci_snapshots
      SET aggregate_state='passed',
          completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          last_observed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id='r_review_fix';
    `);
    unknownState.close();
    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const activeMappingState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const activeMappingRecovery = activeMappingState
      .prepare(
        `SELECT f.round_state, f.result_head_sha, f.resolution_attempt_count,
                f.waiting_ci_started_at, r.state AS run_state, rr.codex_thread_id,
                rr.previous_codex_thread_id
         FROM run_review_fix_rounds f
         JOIN runs r USING (run_id)
         JOIN run_resources rr USING (run_id)
         WHERE f.round_id='rfr_deadbeef5678'`,
      )
      .get() as {
      round_state: string;
      result_head_sha: string | null;
      resolution_attempt_count: number;
      waiting_ci_started_at: string | null;
      run_state: string;
      codex_thread_id: string;
      previous_codex_thread_id: string | null;
    };
    assert(
      activeMappingRecovery.round_state === "resolving" &&
        activeMappingRecovery.result_head_sha === secondResultSha &&
        activeMappingRecovery.resolution_attempt_count === 1 &&
        activeMappingRecovery.waiting_ci_started_at !== "2026-08-19T10:00:00.000Z" &&
        activeMappingRecovery.run_state === "parked_review" &&
        activeMappingRecovery.codex_thread_id ===
          "01a-review-fix-completed-2" &&
        activeMappingRecovery.previous_codex_thread_id === "01a-primary",
      "Active review-fix mapping no longer supports exact no-new-head recovery",
    );
    activeMappingState.exec(`
      UPDATE run_review_fix_rounds
      SET round_state='needs_attention', result_head_sha=NULL,
          resolution_attempt_count=0, failure_reason='review_fix_ci_failed',
          completed_at=datetime('now','-1 second'),
          waiting_ci_started_at='2026-08-19T10:00:00.000Z'
      WHERE round_id='rfr_deadbeef5678';
      UPDATE runs SET state='needs_attention' WHERE run_id='r_review_fix';
      UPDATE run_ci_snapshots
      SET aggregate_state='passed', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          last_observed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id='r_review_fix';
      INSERT INTO run_state_history (
        run_id, from_state, to_state, reason, details_json
      ) VALUES ('r_review_fix','needs_attention','needs_attention',
        'review_fix_ci_failed','{}');
    `);
    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const timeoutRecovery = activeMappingState
      .prepare(
        `SELECT round_state, failure_reason, waiting_ci_started_at
         FROM run_review_fix_rounds WHERE round_id='rfr_deadbeef5678'`,
      )
      .get() as {
      round_state: string;
      failure_reason: string | null;
      waiting_ci_started_at: string | null;
    };
    assert(
      timeoutRecovery.round_state === "resolving" &&
        timeoutRecovery.failure_reason === null &&
        timeoutRecovery.waiting_ci_started_at !== "2026-08-19T10:00:00.000Z",
      "Fresh exact CI evidence did not recover a stale review-fix CI timeout",
    );
    activeMappingState.exec(`
      UPDATE run_review_fix_rounds
      SET round_state='needs_attention', result_head_sha=NULL,
          resolution_attempt_count=0,
          failure_reason='review_fix_no_new_head',
          completed_at=datetime('now','-1 second')
      WHERE round_id='rfr_deadbeef5678';
      UPDATE runs SET state='needs_attention' WHERE run_id='r_review_fix';
      UPDATE run_ci_snapshots
      SET aggregate_state='unknown', completed_at=NULL
      WHERE run_id='r_review_fix';
    `);
    activeMappingState.close();
    const cleanupMutationMarker = resolve(home, "archive-cleanup-mutated");
    const faultedCleanupFailure = runNodeFailure(
      resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
      ["cleanup-review-fix", "--run-id", "r_review_fix", "--apply"],
      home,
      {
        ...lifecycleEnv,
        FAKE_ARCHIVE_MUTATION_DB: resolve(home, "state/orchestrator.db"),
        FAKE_ARCHIVE_MUTATION_MARKER: cleanupMutationMarker,
        FAKE_ARCHIVE_MUTATION_RUN: "r_review_fix",
      },
    );
    assert(
      faultedCleanupFailure.includes("changed during review fix task cleanup"),
      "Late cleanup validation fault did not preserve durable finalization",
    );
    const faultedCleanupState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const durableCleanup = faultedCleanupState
      .prepare(
        `SELECT o.operation_state, r.owner_state, rr.codex_thread_id,
                rr.previous_codex_thread_id
         FROM run_review_fix_operations o
         JOIN run_review_fix_rounds f USING (round_id)
         JOIN runs r ON r.run_id=f.run_id
         JOIN run_resources rr ON rr.run_id=f.run_id
         WHERE o.round_id='rfr_deadbeef5678' AND o.operation_kind='cleanup'`,
      )
      .get() as {
      operation_state: string;
      owner_state: string;
      codex_thread_id: string;
      previous_codex_thread_id: string | null;
    };
    assert(
      durableCleanup.operation_state === "side_effect_succeeded" &&
        durableCleanup.owner_state === "remote" &&
        durableCleanup.codex_thread_id === "01a-review-fix-completed-2" &&
        durableCleanup.previous_codex_thread_id === "01a-primary",
      "Successful archival was not durably reconcilable after late validation failed",
    );
    faultedCleanupState.exec(
      `UPDATE runs SET owner_state='none' WHERE run_id='r_review_fix'`,
    );
    faultedCleanupState.close();
    runNode(
      resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
      ["cleanup-review-fix", "--run-id", "r_review_fix", "--apply"],
      home,
      lifecycleEnv,
    );
    const completedCleanupState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const completedCleanup = completedCleanupState
      .prepare(
        `SELECT o.operation_state, r.owner_state, rr.codex_thread_id,
                rr.previous_codex_thread_id
         FROM run_review_fix_operations o
         JOIN run_review_fix_rounds f USING (round_id)
         JOIN runs r ON r.run_id=f.run_id
         JOIN run_resources rr ON rr.run_id=f.run_id
         WHERE o.round_id='rfr_deadbeef5678' AND o.operation_kind='cleanup'`,
      )
      .get() as {
      operation_state: string;
      owner_state: string;
      codex_thread_id: string;
      previous_codex_thread_id: string | null;
    };
    assert(
      completedCleanup.operation_state === "completed" &&
        completedCleanup.owner_state === "none" &&
        completedCleanup.codex_thread_id === "01a-primary" &&
        completedCleanup.previous_codex_thread_id === null,
      "Review-fix cleanup did not restore the primary task mapping",
    );
    completedCleanupState.exec(`
      DELETE FROM run_review_fix_operations
      WHERE round_id='rfr_deadbeef5678' AND operation_kind='cleanup';
      UPDATE run_ci_snapshots
      SET aggregate_state='passed',
          completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          last_observed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id='r_review_fix';
    `);
    completedCleanupState.close();
    runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    const convergedState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const converged = convergedState
      .prepare(
        `SELECT f.round_state, f.result_head_sha, f.resolution_attempt_count,
                r.state AS run_state, rr.codex_thread_id,
                rr.previous_codex_thread_id
         FROM run_review_fix_rounds f
         JOIN runs r USING (run_id)
         JOIN run_resources rr USING (run_id)
         WHERE f.round_id='rfr_deadbeef5678'`,
      )
      .get() as {
      round_state: string;
      result_head_sha: string | null;
      resolution_attempt_count: number;
      run_state: string;
      codex_thread_id: string;
      previous_codex_thread_id: string | null;
    };
    assert(
      converged.round_state === "resolving" &&
        converged.result_head_sha === secondResultSha &&
        converged.resolution_attempt_count === 1 &&
        converged.run_state === "parked_review" &&
        converged.codex_thread_id === "01a-primary" &&
        converged.previous_codex_thread_id === null,
      "Post-cleanup exact-head CI did not heal false no-new-head state",
    );
    convergedState.close();

    const reviewerKey = resolve(home, "secrets/reviewer-private-key.pem");
    const fakeGithubFetch = resolve(home, "fake-github-fetch.mjs");
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    await writeFile(reviewerKey, privateKey, { mode: 0o600 });
    await writeFile(
      resolve(home, "secrets/github-reviewer-app.env"),
      [
        "KURAMI_GITHUB_REVIEWER_APP_ID=1",
        "KURAMI_GITHUB_REVIEWER_INSTALLATION_ID=2",
        `KURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE=${reviewerKey}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await writeFile(
      fakeGithubFetch,
      `globalThis.fetch = async (input, init) => {
  const url = String(input);
  const payload = JSON.parse(String(init?.body ?? "{}"));
  if (url.includes("/app/installations/") && url.endsWith("/access_tokens"))
    return new Response(JSON.stringify({ token: "installation_token_1234567890", expires_at: "2099-01-01T00:00:00.000Z" }), { status: 201 });
  if (url.includes("/comments/711/replies"))
    return new Response(JSON.stringify({ id: 712 }), { status: 201 });
  if (url.endsWith("/graphql") && payload.query?.includes("query("))
    return new Response(JSON.stringify({ data: { node: { isResolved: false, comments: { nodes: [] } } } }), { status: 200 });
  if (url.endsWith("/graphql") && payload.query?.includes("mutation("))
    return new Response(JSON.stringify({ data: { resolveReviewThread: { thread: { id: "thread-pf-11", isResolved: true } } } }), { status: 200 });
  throw new Error("Unexpected fake GitHub request: " + url);
};
`,
      { mode: 0o600 },
    );
    const resolvedController = runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      {
        ...lifecycleEnv,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fakeGithubFetch}`.trim(),
      },
    );
    assert(
      (resolvedController.results as JsonObject[]).some(
        (result) =>
          result.action === "review_fix_resolve" &&
          result.roundId === "rfr_deadbeef5678" &&
          result.status === "applied",
      ),
      "Recovered PF-11 round did not run the existing thread resolver",
    );
    const secondCleanupState = new DatabaseSync(
      resolve(home, "state/orchestrator.db"),
    );
    const resolved = secondCleanupState
      .prepare(
        `SELECT f.round_state, t.thread_state, t.reply_comment_id
         FROM run_review_fix_rounds f
         JOIN run_review_fix_threads t USING (round_id)
         WHERE f.round_id='rfr_deadbeef5678' AND t.thread_id='thread-pf-11'`,
      )
      .get() as {
      round_state: string;
      thread_state: string;
      reply_comment_id: number | null;
    };
    assert(
      resolved.round_state === "succeeded" &&
        resolved.thread_state === "resolved" &&
        resolved.reply_comment_id === 712 &&
        (await readFile(archiveLog, "utf8")).trim().split("\n").join(",") ===
          "01a-review-fix-completed,01a-review-fix-completed-2",
      "Post-cleanup PF-11 lifecycle did not resolve its snapshot thread",
    );
    secondCleanupState.exec(`
      DELETE FROM run_review_fix_operations WHERE round_id IN (
        SELECT round_id FROM run_review_fix_rounds WHERE run_id='r_review_fix'
      );
      DELETE FROM run_review_fix_threads WHERE round_id IN (
        SELECT round_id FROM run_review_fix_rounds WHERE run_id='r_review_fix'
      );
      DELETE FROM run_review_fix_rounds WHERE run_id='r_review_fix';
      DELETE FROM run_ai_reviews WHERE review_id='air_second_cycle';
      DELETE FROM run_control_requests
      WHERE request_id IN ('${secondReviewId}','${secondFixRequestId}');
      UPDATE runs SET owner_state='none' WHERE run_id='r_review_fix';
      UPDATE run_resources
      SET tmux_session_name=NULL, codex_thread_id='01a-primary',
          previous_codex_thread_id=NULL
      WHERE run_id='r_review_fix';
    `);
    secondCleanupState.close();

    const dirtyState = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    dirtyState.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, payload_json, processing_state
      ) VALUES ('event-fix-dirty','2026-08-19T12:00:00.000Z','tailortales',
        'item-fix-dirty','content-fix-dirty','Issue','Shagon1k/TailorTales',142,
        'Dirty review fix','https://example.invalid/issues/142','{}','processed');
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES ('r_review_fix_dirty','event-fix-dirty','tailortales',
        'item-fix-dirty','content-fix-dirty','Shagon1k/TailorTales',142,
        'autonomous','parked_review','cli','live');
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name, codex_thread_id,
        previous_codex_thread_id, tmux_session_name
      ) VALUES ('r_review_fix_dirty','provisioned','/tmp/placeholder',
        'TT-142_fix','01a-review-fix-dirty','01a-primary-dirty',
        'cx-tt-142-review-fix');
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via, idempotency_key
      ) VALUES ('rq_review_fix_dirty','r_review_fix_dirty','review_fix','applied',
        'discord','review:fix:dirty');
    `);
    dirtyState
      .prepare(
        `UPDATE run_resources SET worktree_path=?
         WHERE run_id='r_review_fix_dirty'`,
      )
      .run(dirtyWorktree);
    dirtyState
      .prepare(
        `INSERT INTO run_review_fix_rounds (
           round_id, run_id, request_id, round_number, round_state,
           repository, pull_request_number, pull_request_url,
           source_head_sha, snapshot_json, codex_thread_id
         ) VALUES ('rfr_dirty','r_review_fix_dirty','rq_review_fix_dirty',1,
           'running','Shagon1k/TailorTales',242,
           'https://example.invalid/pulls/242',?,'[]','01a-review-fix-dirty')`,
      )
      .run(dirtySourceSha);
    dirtyState.exec(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,thread_id,turn_id,phase,turn_status,stopped_at,worktree_path,branch_name)
      SELECT 'task-'||f.round_id,f.run_id,'review_fix',f.round_id,rr.tmux_session_name,rr.codex_thread_id,'turn-'||f.round_id,'terminal','completed',strftime('%Y-%m-%dT%H:%M:%fZ','now'),rr.worktree_path,rr.branch_name
      FROM run_review_fix_rounds f JOIN run_resources rr USING(run_id) WHERE f.run_id='r_review_fix_dirty' AND f.round_state='running'`);
    dirtyState.close();

    const dirtyPark = runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      ["--apply"],
      home,
      lifecycleEnv,
    );
    assert(
      (dirtyPark.results as JsonObject[]).some(
        (result) =>
          result.runId === "r_review_fix_dirty" &&
          result.action === "park" &&
          result.status === "deferred" &&
          String(result.reason).includes("staged or uncommitted work"),
      ),
      "Staged dirty review fix with unchanged HEAD did not fail closed before park",
    );
    const dirtyVerify = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    const preserved = dirtyVerify
      .prepare(
        `SELECT r.state, r.owner_state, rr.tmux_session_name,
                rr.codex_thread_id, rr.previous_codex_thread_id,
                f.round_state, f.failure_reason
         FROM runs r JOIN run_resources rr USING (run_id)
         JOIN run_review_fix_rounds f USING (run_id)
         WHERE r.run_id='r_review_fix_dirty'`,
      )
      .get() as {
      state: string;
      owner_state: string;
      tmux_session_name: string | null;
      codex_thread_id: string;
      previous_codex_thread_id: string | null;
      round_state: string;
      failure_reason: string | null;
    };
    assert(
      preserved.state === "needs_attention" &&
        preserved.owner_state === "cli" &&
        preserved.tmux_session_name === "cx-tt-142-review-fix" &&
        preserved.codex_thread_id === "01a-review-fix-dirty" &&
        preserved.previous_codex_thread_id === "01a-primary-dirty" &&
        preserved.round_state === "needs_attention" &&
        preserved.failure_reason === "review_fix_uncommitted_changes" &&
        git(dirtyWorktree, ["diff", "--cached", "--name-only"]) ===
          "review-fix.txt",
      "Dirty review-fix context or staged work was not preserved in needs_attention",
    );
    dirtyVerify.exec(`
      UPDATE run_review_fix_rounds
      SET round_state='succeeded', failure_reason=NULL
      WHERE round_id='rfr_dirty';
    `);
    dirtyVerify.close();
    const cleanupFailure = runNodeFailure(
      resolve(app, "src/orchestrator/projects/sessions/manager.ts"),
      ["cleanup-review-fix", "--run-id", "r_review_fix_dirty", "--apply"],
      home,
      lifecycleEnv,
    );
    assert(
      (cleanupFailure.includes("staged or uncommitted work") || cleanupFailure.includes("not ready for review fix cleanup")) &&
        (await readFile(archiveLog, "utf8")).trim().split("\n").join(",") ===
          "01a-review-fix-completed,01a-review-fix-completed-2",
      "Dirty review-fix task was archived during cleanup",
    );
    const guardedPlan = runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      [],
      home,
      lifecycleEnv,
    );
    assert(
      !(guardedPlan.plans as JsonObject[]).some(
        (plan) =>
          plan.runId === "r_review_fix_dirty" &&
          plan.action === "review_fix_cleanup",
      ),
      "Guarded review-fix attention state still scheduled automatic cleanup",
    );

    const recoveryState = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    recoveryState.exec("BEGIN IMMEDIATE");
    recoveryState
      .prepare(
        `UPDATE run_control_requests
         SET request_state='applied', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE request_id=?`,
      )
      .run(requestId);
    recoveryState.exec(`
      UPDATE runs SET state='needs_attention' WHERE run_id='r_review_fix';
      UPDATE run_ci_snapshots
      SET aggregate_state='passed'
      WHERE run_id='r_review_fix';
    `);
    recoveryState
      .prepare(
        `UPDATE run_ci_snapshots SET head_sha=? WHERE run_id='r_review_fix'`,
      )
      .run(resultSha);
    recoveryState
      .prepare(
        `INSERT INTO run_review_fix_rounds (
           round_id, run_id, request_id, round_number, round_state,
           repository, pull_request_number, pull_request_url,
           source_head_sha, snapshot_json, codex_thread_id, result_head_sha,
           resolution_attempt_count, failure_reason, completed_at
         ) VALUES ('rfr_abcdef123456','r_review_fix',?,1,'needs_attention',
           'Shagon1k/TailorTales',241,'https://example.invalid/pulls/241',
           ?,'[]','01a-review-fix',
           ?,3,
           'GitHub thread reconciliation failed after 3 attempts: denied',
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      )
      .run(requestId, sourceSha, resultSha);
    recoveryState.exec(`
      INSERT INTO run_review_fix_threads (
        round_id, thread_id, root_comment_id, source_kind, path, line,
        thread_state, failure_reason
      ) VALUES ('rfr_abcdef123456','thread-recovery',601,'owner','src/a.ts',12,
        'failed','GitHub did not resolve the review thread');
      COMMIT;
    `);
    recoveryState.close();
    const recoveryPlan = runNode(
      resolve(app, "src/orchestrator/projects/reviews/fix-manager.ts"),
      ["recover", "--round-id", "rfr_abcdef123456"],
      home,
    );
    assert(
      recoveryPlan.apply === false &&
        (recoveryPlan.plan as JsonObject).action ===
          "retry_github_resolution_only",
      "Resolution-only recovery was not planned",
    );
    runNode(
      resolve(app, "src/orchestrator/projects/reviews/fix-manager.ts"),
      ["recover", "--round-id", "rfr_abcdef123456", "--apply"],
      home,
    );
    const recovered = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    const recoveredRound = recovered
      .prepare(
        `SELECT f.round_state, f.resolution_attempt_count, f.failure_reason,
                r.state AS run_state, t.thread_state
         FROM run_review_fix_rounds f
         JOIN runs r ON r.run_id=f.run_id
         JOIN run_review_fix_threads t ON t.round_id=f.round_id
         WHERE f.round_id='rfr_abcdef123456'`,
      )
      .get() as {
      round_state: string;
      resolution_attempt_count: number;
      failure_reason: string | null;
      run_state: string;
      thread_state: string;
    };
    recovered.close();
    assert(
      recoveredRound.round_state === "resolving" &&
        recoveredRound.resolution_attempt_count === 0 &&
        recoveredRound.failure_reason === null &&
        recoveredRound.run_state === "parked_review" &&
        recoveredRound.thread_state === "pending",
      "Resolution-only recovery did not restore a bounded retry state",
    );
    const recoveryController = runNode(
      resolve(app, "src/orchestrator/runtime/controller.ts"),
      [],
      home,
    );
    assert(
      (recoveryController.plans as JsonObject[]).some(
        (plan) =>
          plan.action === "review_fix_resolve" &&
          plan.roundId === "rfr_abcdef123456",
      ),
      "Controller did not plan recovered GitHub-only resolution",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        deterministicSnapshot: true,
        githubAppLoginNormalized: true,
        ownerRepliesAreInstructions: true,
        exactShaPrompt: true,
        unresolvedOnly: true,
        ownerTriggered: true,
        freshWriterPlanned: true,
        splitCredentialResolution: true,
        idempotentGitHubResolution: true,
        completedWriterShutdown: true,
        passedCiResolutionScheduled: true,
        cleanupScheduled: true,
        twoSequentialReviewFixCycles: true,
        freshWaitBoundary: true,
        falseNoNewHeadConverged: true,
        reasonAwareRecoveryNegatives: true,
        oneActiveRoundEnforced: true,
        cleanupSideEffectReconciled: true,
        stagedDirtyTaskPreserved: true,
        dirtyCleanupGuarded: true,
        resolutionOnlyRecovery: true,
        populatedV15UpgradePreserved: true,
        populatedV30UpgradePreserved: true,
      })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
