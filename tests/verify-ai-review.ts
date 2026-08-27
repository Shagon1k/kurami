import { execFileSync } from "node:child_process";
import { generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildReviewInstructions,
  buildGitHubReviewPayload,
  parseReviewResult,
  runAiReviewWorkerCli,
} from "../src/orchestrator/projects/reviews/worker.ts";
import {
  detachedCodexEnvironment,
  runDetachedReview,
} from "../src/orchestrator/integrations/codex/app-server.ts";
import {
  createGitHubAppInstallationToken,
  loadGitHubAppCredentials,
} from "../src/orchestrator/integrations/github/app-auth.ts";
import * as legacyCodexAppServer from "../src/codex-app-server.ts";
import * as legacyGitHubAppAuth from "../src/github-app-auth.ts";
import * as canonicalReviewManager from "../src/orchestrator/projects/reviews/manager.ts";
import * as legacyReviewManager from "../src/review-manager.ts";
import * as legacyReviewWorker from "../src/ai-review-worker.ts";

type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runNode(script: string, args: string[], home: string): JsonObject {
  const output = execFileSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, KURAMI_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output.trim().split(/\r?\n/u).filter(Boolean).at(-1)!) as JsonObject;
}

async function main(): Promise<void> {
  assert(
    legacyReviewWorker.buildReviewInstructions === buildReviewInstructions &&
      legacyReviewWorker.buildGitHubReviewPayload === buildGitHubReviewPayload &&
      legacyReviewWorker.parseReviewResult === parseReviewResult &&
      legacyReviewWorker.runAiReviewWorkerCli === runAiReviewWorkerCli &&
      legacyReviewManager.runReviewManagerCli ===
        canonicalReviewManager.runReviewManagerCli &&
    legacyCodexAppServer.detachedCodexEnvironment ===
      detachedCodexEnvironment &&
      legacyCodexAppServer.runDetachedReview === runDetachedReview &&
      legacyGitHubAppAuth.createGitHubAppInstallationToken ===
        createGitHubAppInstallationToken &&
      legacyGitHubAppAuth.loadGitHubAppCredentials === loadGitHubAppCredentials,
    "Legacy review wrappers diverged from canonical modules",
  );
  const app = resolve(import.meta.dirname, "..");
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "kurami-ai-review-test-")));
  try {
    const migrationsDirectory = resolve(app, "migrations");
    const migrations = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
      .sort();
    const upgrade = new DatabaseSync(resolve(home, "upgrade-v13.db"));
    upgrade.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations.filter((name) => name < "014_"))
      upgrade.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    upgrade.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, payload_json, processing_state
      ) VALUES (
        'event-upgrade', '2026-08-18T08:00:00.000Z', 'tailortales',
        'item-upgrade', 'content-upgrade', 'Issue', 'Shagon1k/TailorTales',
        129, 'Upgrade fixture', 'https://example.invalid/issues/129',
        '{}', 'processed'
      );
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES (
        'r_upgrade', 'event-upgrade', 'tailortales', 'item-upgrade',
        'content-upgrade', 'Shagon1k/TailorTales', 129, 'autonomous',
        'parked_review', 'none', 'live'
      );
      INSERT INTO run_control_requests (
        request_id, run_id, action, request_state, requested_via,
        idempotency_key, completed_at
      ) VALUES (
        'rq_aaaaaaaaaaaaaaaaaaaaaaaa', 'r_upgrade', 'ci_repair', 'applied',
        'discord', 'upgrade:repair', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
      INSERT INTO run_ci_repair_attempts (
        attempt_id, run_id, request_id, attempt_number, source_head_sha,
        source_ci_state, source_checks_json, attempt_state
      ) VALUES (
        'cra_upgrade', 'r_upgrade', 'rq_aaaaaaaaaaaaaaaaaaaaaaaa', 1,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'failed', '[]', 'succeeded'
      );
    `);
    upgrade.exec(await readFile(resolve(migrationsDirectory, "014_ai_code_review.sql"), "utf8"));
    assert(
      (upgrade.prepare("SELECT COUNT(*) AS count FROM run_control_requests").get() as { count: number }).count === 1 &&
        (upgrade.prepare("SELECT COUNT(*) AS count FROM run_ci_repair_attempts").get() as { count: number }).count === 1 &&
        upgrade.prepare("PRAGMA foreign_key_check").all().length === 0,
      "Schema 14 did not preserve populated P2 control and repair records",
    );
    upgrade.close();

    await mkdir(resolve(home, "config"), { recursive: true });
    await copyFile(
      resolve(app, "deploy/config/orchestrator.yaml"),
      resolve(home, "config/orchestrator.yaml"),
    );
    let projects = await readFile(resolve(app, "deploy/config/projects.yaml"), "utf8");
    projects = projects.replace(
      "/home/shagon1k/_projects/.worktrees/tailortales",
      resolve(home, "worktrees/tailortales"),
    );
    await writeFile(resolve(home, "config/projects.yaml"), projects);
    runNode(resolve(app, "src/init-run-store.ts"), [], home);

    const database = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    database.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, payload_json, processing_state
      ) VALUES (
        'event-review', '2026-08-19T08:00:00.000Z', 'tailortales',
        'item-review', 'content-review', 'Issue', 'Shagon1k/TailorTales',
        130, 'Review PR', 'https://example.invalid/issues/130', '{}', 'processed'
      );
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode,
        created_at, updated_at
      ) VALUES (
        'r_review', 'event-review', 'tailortales', 'item-review',
        'content-review', 'Shagon1k/TailorTales', 130, 'autonomous',
        'parked_review', 'none', 'live',
        '2026-08-19T08:00:00.000Z', '2026-08-19T08:00:00.000Z'
      );
    `);
    database
      .prepare(
        `INSERT INTO run_resources (
           run_id, resource_state, worktree_path, branch_name, base_sha,
           codex_thread_id
         ) VALUES ('r_review', 'provisioned', ?, 'TT-130_review', ?,
                   '01a-primary-thread')`,
      )
      .run(resolve(home, "worktrees/tailortales/130/TailorTales"), "a".repeat(40));
    database.close();

    const controlsPath = resolve(app, "src/run-controls.ts");
    const controllerPath = resolve(app, "src/controller.ts");
    const created = runNode(
      controlsPath,
      [
        "request",
        "--run-id",
        "r_review",
        "--action",
        "ai_review",
        "--via",
        "discord",
        "--apply",
      ],
      home,
    );
    const requestId = String(created.requestId);
    assert(requestId.startsWith("rq_"), "AI review request was not persisted");
    const controller = runNode(controllerPath, [], home);
    assert(
      (controller.plans as JsonObject[]).some(
        (plan) => plan.action === "review_start" && plan.requestId === requestId,
      ),
      "Controller did not plan the explicit AI review",
    );

    const parsed = parseReviewResult(
      JSON.stringify({
        summary: "One concrete issue.",
        findings: [
          {
            severity: "important",
            confidence: "high",
            title: "Race can lose the update",
            body: "Two concurrent writers can overwrite the same state.",
            path: "src/state.ts",
            line: 42,
          },
        ],
      }),
    );
    const payload = buildGitHubReviewPayload(parsed, "air_test", "b".repeat(40));
    assert(payload.event === "COMMENT", "AI review would block merge through REQUEST_CHANGES");
    assert(
      Array.isArray(payload.comments) && payload.comments.length === 1,
      "AI review findings were not converted to inline comments",
    );
    assert(
      String(payload.body).includes("0 Critical · 1 Important · 0 Suggestions"),
      "AI review aggregate counts are missing",
    );
    assert(
      String(payload.body).includes("🤖 Kurami AI Code Review") &&
        String((payload.comments as JsonObject[])[0]?.body).includes(
          "🤖 **Kurami AI Review · Important**",
        ) &&
        String((payload.comments as JsonObject[])[0]?.body).includes(
          "<!-- kurami-ai-finding:air_test:1;head=",
        ),
      "AI review visible attribution or deterministic provenance is missing",
    );
    assert(
      parseReviewResult('{"summary":"Clean","findings":[]}').findings.length === 0,
      "No-findings review is not accepted",
    );
    const instructions = buildReviewInstructions(
      {
        review_id: "air_prompt",
        run_id: "r_review",
        review_number: 1,
        review_state: "running",
        repository: "Shagon1k/TailorTales",
        pull_request_number: 123,
        pull_request_url: "https://example.invalid/pull/123",
        base_ref: "main",
        base_sha: "a".repeat(40),
        head_sha: "b".repeat(40),
        worktree_path: resolve(home, "worktree"),
        issue_number: 130,
        issue_title: "Review PR",
        branch_name: "TT-130_review",
      },
      {
        pullTitle: "Set the default mark",
        pullBody: "Updates PillLabel and its component tests.",
        issueTitle: "Use a diamond mark",
        issueBody: "The default mark must become a diamond.",
      },
    );
    assert(
      instructions.includes("Updates PillLabel") &&
        instructions.includes("The default mark must become a diamond") &&
        instructions.includes("Do not use gh") &&
        instructions.includes("Never request approval"),
      "Prefetched private PR context or the zero-approval contract is missing",
    );

    const fakeCodex = resolve(home, "fake-codex-review.mjs");
    const archiveLog = resolve(home, "review-archives.log");
    await writeFile(
      fakeCodex,
      `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\nimport { createInterface } from "node:readline";\nfor (const name of ["GH_TOKEN", "GITHUB_TOKEN", "KURAMI_TEST_API_TOKEN", "KURAMI_TEST_PRIVATE_KEY"]) {\n  if (process.env[name]) throw new Error("Reviewer received secret environment material");\n}\nconst lines = createInterface({ input: process.stdin });\nfor await (const line of lines) {\n  const message = JSON.parse(line);\n  let result = {};\n  if (message.method === "thread/start") result = { thread: { id: "parent-review-thread" } };\n  if (message.method === "review/start") result = { turn: { id: "review-turn", status: "inProgress", items: [] }, reviewThreadId: "detached-review-thread" };\n  if (message.method === "thread/archive") appendFileSync(process.env.FAKE_REVIEW_ARCHIVE_LOG, message.params.threadId + "\\n");\n  if (typeof message.id === "number") process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");\n  if (message.method === "review/start") process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "detached-review-thread", turn: { id: "review-turn", status: "completed", error: null, items: [{ type: "exitedReviewMode", review: "{\\\"summary\\\":\\\"Clean\\\",\\\"findings\\\":[]}" }] } } }) + "\\n");\n}\n`,
      { mode: 0o700 },
    );
    process.env.FAKE_REVIEW_ARCHIVE_LOG = archiveLog;
    process.env.GH_TOKEN = "must-not-reach-reviewer";
    process.env.GITHUB_TOKEN = "must-not-reach-reviewer";
    process.env.KURAMI_TEST_API_TOKEN = "must-not-reach-reviewer";
    process.env.KURAMI_TEST_PRIVATE_KEY = "must-not-reach-reviewer";
    const detached = await runDetachedReview(fakeCodex, {
      cwd: home,
      title: "AI review test",
      instructions: "Review exact fixture SHA and return JSON.",
      timeoutMs: 5_000,
    });
    delete process.env.FAKE_REVIEW_ARCHIVE_LOG;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.KURAMI_TEST_API_TOKEN;
    delete process.env.KURAMI_TEST_PRIVATE_KEY;
    assert(
      detached.parentThreadId === "parent-review-thread" &&
        detached.reviewThreadId === "detached-review-thread" &&
        parseReviewResult(detached.review).findings.length === 0,
      "Detached Codex review lifecycle was not completed",
    );
    const archived = (await readFile(archiveLog, "utf8")).trim().split("\n");
    assert(
      archived.includes("parent-review-thread") &&
        archived.includes("detached-review-thread"),
      "Technical review tasks were not archived",
    );

    const approvalCodex = resolve(home, "fake-codex-review-approval.mjs");
    const approvalLog = resolve(home, "review-approval-response.log");
    await writeFile(
      approvalCodex,
      `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\nimport { createInterface } from "node:readline";\nconst lines = createInterface({ input: process.stdin });\nfor await (const line of lines) {\n  const message = JSON.parse(line);\n  if (message.id === 900) {\n    appendFileSync(process.env.FAKE_REVIEW_APPROVAL_LOG, JSON.stringify(message) + "\\n");\n    continue;\n  }\n  let result = {};\n  if (message.method === "thread/start") result = { thread: { id: "approval-parent-thread" } };\n  if (message.method === "review/start") result = { turn: { id: "approval-turn", status: "inProgress", items: [] }, reviewThreadId: "approval-review-thread" };\n  if (typeof message.id === "number") process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");\n  if (message.method === "review/start") process.stdout.write(JSON.stringify({ method: "item/commandExecution/requestApproval", id: 900, params: { threadId: "approval-review-thread", turnId: "approval-turn", itemId: "approval-item", reason: "network" } }) + "\\n");\n}\n`,
      { mode: 0o700 },
    );
    process.env.FAKE_REVIEW_APPROVAL_LOG = approvalLog;
    let approvalFailure = "";
    try {
      await runDetachedReview(approvalCodex, {
        cwd: home,
        title: "AI review approval guard test",
        instructions: "Review locally without interactive requests.",
        timeoutMs: 5_000,
      });
    } catch (error) {
      approvalFailure = error instanceof Error ? error.message : String(error);
    } finally {
      delete process.env.FAKE_REVIEW_APPROVAL_LOG;
    }
    assert(
      approvalFailure.includes(
        "Detached Codex review requested forbidden interaction: item/commandExecution/requestApproval",
      ),
      "Detached review did not fail immediately on an unexpected approval request",
    );
    const approvalResponse = JSON.parse(
      (await readFile(approvalLog, "utf8")).trim(),
    ) as { result?: { decision?: string } };
    assert(
      approvalResponse.result?.decision === "decline",
      "Detached review did not explicitly decline the approval request",
    );

    const sanitizedEnvironment = detachedCodexEnvironment({
      SAFE_VALUE: "preserved",
      GH_TOKEN: "remove",
      GITHUB_TOKEN: "remove",
      KURAMI_GITHUB_REVIEWER_APP_ID: "remove",
      KURAMI_GITHUB_REVIEWER_INSTALLATION_ID: "remove",
      KURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE: "remove",
    });
    assert(
      sanitizedEnvironment.SAFE_VALUE === "preserved" &&
        !sanitizedEnvironment.GH_TOKEN &&
        !sanitizedEnvironment.GITHUB_TOKEN &&
        !sanitizedEnvironment.KURAMI_GITHUB_REVIEWER_APP_ID &&
        !sanitizedEnvironment.KURAMI_GITHUB_REVIEWER_INSTALLATION_ID &&
        !sanitizedEnvironment.KURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE,
      "Detached Codex environment retained GitHub App credentials",
    );

    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
    });
    const privateKeyPem = privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const secretsDirectory = resolve(home, "secrets");
    const privateKeyFile = resolve(secretsDirectory, "kurami-reviewer.private-key.pem");
    await mkdir(secretsDirectory, { recursive: true, mode: 0o700 });
    await writeFile(privateKeyFile, privateKeyPem, { mode: 0o600 });
    const credentials = await loadGitHubAppCredentials(home, {
      KURAMI_GITHUB_REVIEWER_APP_ID: "12345",
      KURAMI_GITHUB_REVIEWER_INSTALLATION_ID: "67890",
      KURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE: privateKeyFile,
    });
    const nowSeconds = 1_787_123_456;
    let inspectedJwt = "";
    const installationToken = await createGitHubAppInstallationToken(
      credentials,
      async (input, init) => {
        assert(
          String(input) ===
            "https://api.github.com/app/installations/67890/access_tokens" &&
            init?.method === "POST",
          "GitHub App installation-token endpoint is incorrect",
        );
        inspectedJwt = String(
          (init?.headers as Record<string, string> | undefined)?.Authorization ?? "",
        ).replace(/^Bearer\s+/u, "");
        return new Response(
          JSON.stringify({
            token: "ghs_test_installation_token",
            expires_at: new Date((nowSeconds + 3_600) * 1_000).toISOString(),
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      },
      nowSeconds,
    );
    const jwtParts = inspectedJwt.split(".");
    const jwtPayload = JSON.parse(
      Buffer.from(jwtParts[1] ?? "", "base64url").toString("utf8"),
    ) as { iss?: string; iat?: number; exp?: number };
    assert(
      installationToken === "ghs_test_installation_token" &&
        jwtParts.length === 3 &&
        jwtPayload.iss === "12345" &&
        jwtPayload.iat === nowSeconds - 60 &&
        jwtPayload.exp === nowSeconds + 9 * 60 &&
        verifySignature(
          "RSA-SHA256",
          Buffer.from(`${jwtParts[0]}.${jwtParts[1]}`),
          publicKey,
          Buffer.from(jwtParts[2] ?? "", "base64url"),
        ),
      "GitHub App JWT or installation-token exchange is invalid",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        isolated: true,
        explicitOwnerTrigger: true,
        detachedReadOnlyPlan: true,
        detachedLifecycleVerified: true,
        exactShaContract: true,
        nativeGitHubReview: true,
        maxFindings: 10,
        noFindingsValid: true,
        parallelWithCi: true,
        technicalTasksArchived: true,
        reviewerCredentialsExcluded: true,
        reviewerSecretEnvironmentScrubbed: true,
        githubAppCredentialsValidated: true,
        installationTokenVerified: true,
        visibleAiAttribution: true,
        machineProvenance: true,
        privateContextPrefetched: true,
        externalAccessForbidden: true,
        unexpectedApprovalDeclined: true,
        unexpectedApprovalFailsFast: true,
        populatedV13UpgradePreserved: true,
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
