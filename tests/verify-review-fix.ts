import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  replyAndResolveReviewThread,
  selectActionableReviewThreads,
} from "../src/orchestrator/integrations/github/review-threads.ts";
import { loadOwnerGitHubTokenFromFile } from "../src/orchestrator/integrations/github/app-auth.ts";
import * as legacyGitHubAppAuth from "../src/github-app-auth.ts";
import * as legacyReviewThreads from "../src/github-review-threads.ts";
import * as canonicalReviewFixManager from "../src/orchestrator/projects/reviews/fix-manager.ts";
import * as legacyReviewFixManager from "../src/review-fix-manager.ts";
import { reviewFixPrompt } from "../src/session-manager.ts";

type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runNode(script: string, args: string[], home: string): JsonObject {
  const output = execFileSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ORCHESTRATOR_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output.trim().split(/\r?\n/u).filter(Boolean).at(-1)!) as JsonObject;
}

async function main(): Promise<void> {
  assert(
    legacyReviewFixManager.runReviewFixManagerCli ===
      canonicalReviewFixManager.runReviewFixManagerCli &&
    legacyReviewThreads.replyAndResolveReviewThread ===
      replyAndResolveReviewThread &&
      legacyReviewThreads.selectActionableReviewThreads ===
        selectActionableReviewThreads &&
      legacyGitHubAppAuth.loadOwnerGitHubTokenFromFile ===
        loadOwnerGitHubTokenFromFile,
    "Legacy GitHub review wrappers diverged from canonical modules",
  );
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
        selected[0]?.ownerReplies[0] === "Keep the public behavior unchanged." &&
        selected[1]?.sourceKind === "owner",
      "Review thread snapshot was not deterministic",
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
      },
    );
    assert(
      prompt.includes(`exact PR head SHA ${head}`) &&
        prompt.includes("Fix exactly these 2 unresolved review thread") &&
        prompt.includes("Do not address new or resolved threads") &&
        prompt.includes("never force-push") &&
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
    await writeFile(
      resolve(home, "config/projects.yaml"),
      await readFile(resolve(app, "deploy/config/projects.yaml"), "utf8"),
    );
    runNode(resolve(app, "src/init-run-store.ts"), [], home);
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
    state.close();
    const controls = runNode(
      resolve(app, "src/run-controls.ts"),
      ["controls", "--project", "tailortales", "--issue", "141"],
      home,
    );
    assert(
      (controls.available_actions as string[]).includes("review_fix"),
      "Current actionable review did not expose Fix Review",
    );
    const created = runNode(
      resolve(app, "src/run-controls.ts"),
      ["request", "--run-id", "r_review_fix", "--action", "review_fix", "--via", "discord", "--apply"],
      home,
    );
    const controller = runNode(resolve(app, "src/controller.ts"), [], home);
    assert(
      (controller.plans as JsonObject[]).some(
        (plan) => plan.action === "review_fix_start" && plan.requestId === created.requestId,
      ),
      "Controller did not plan the explicit review fix",
    );

    const recoveryState = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    const requestId = String(created.requestId);
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
      SET head_sha='cccccccccccccccccccccccccccccccccccccccc',
          aggregate_state='passed'
      WHERE run_id='r_review_fix';
    `);
    recoveryState
      .prepare(
        `INSERT INTO run_review_fix_rounds (
           round_id, run_id, request_id, round_number, round_state,
           repository, pull_request_number, pull_request_url,
           source_head_sha, snapshot_json, codex_thread_id, result_head_sha,
           resolution_attempt_count, failure_reason, completed_at
         ) VALUES ('rfr_abcdef123456','r_review_fix',?,1,'needs_attention',
           'Shagon1k/TailorTales',241,'https://example.invalid/pulls/241',
           'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','[]','01a-review-fix',
           'cccccccccccccccccccccccccccccccccccccccc',3,
           'GitHub thread reconciliation failed after 3 attempts: denied',
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      )
      .run(requestId);
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
      resolve(app, "src/controller.ts"),
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
        resolutionOnlyRecovery: true,
        populatedV15UpgradePreserved: true,
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
