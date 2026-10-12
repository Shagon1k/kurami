import { verifyReviewProfiles } from "./review-profiles.ts";
import { setTimeout as delay } from "node:timers/promises";
import { verifyReviewSnapshots } from "./ai-review-snapshot.ts";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildReviewInstructions,
  buildGitHubReviewPayload,
  changedRightLines,
  findPublishedReviewWithMarker,
  parseReviewResult,
  reviewOutputSchema,
  runAiReviewWorkerCli,
  shouldRetryWithoutInlineComments,
  splitReviewFindings,
} from "../src/orchestrator/projects/reviews/worker.ts";
import {
  detachedCodexEnvironment,
  runDetachedReview,
} from "../src/orchestrator/integrations/codex/app-server.ts";
import {
  createGitHubAppInstallationToken,
  loadGitHubAppCredentials,
} from "../src/orchestrator/integrations/github/app-auth.ts";

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
  verifyReviewProfiles();
  verifyReviewSnapshots();
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
    runNode(resolve(app, "src/orchestrator/state/init-run-store.ts"), [], home);

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

    const controlsPath = resolve(app, "src/orchestrator/controls/run.ts");
    const controllerPath = resolve(app, "src/orchestrator/runtime/controller.ts");
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
            line: 41,
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
      String(payload.body).includes("🔎 Kurami · General Review") &&
        String((payload.comments as JsonObject[])[0]?.body).includes(
          "**🔎 Kurami · General Review · Important**",
        ) &&
        String((payload.comments as JsonObject[])[0]?.body).includes(
          "<!-- kurami-ai-finding:air_test:1;head=",
        ),
      "AI review visible attribution or deterministic provenance is missing",
    );
    const publication = splitReviewFindings(
      {
        summary: "Anchor checks are required.",
        findings: [
          parsed.findings[0]!,
          {
            severity: "suggestion",
            confidence: "medium",
            title: "Old line",
            body: "This reference is not on the changed right side.",
            path: "src/state.ts",
            line: 7,
          },
        ],
      },
      changedRightLines(`diff --git a/src/state.ts b/src/state.ts
index aaaaaaa..bbbbbbb 100644
--- a/src/state.ts
+++ b/src/state.ts
@@ -40,3 +40,3 @@ export function update() {
 old();
-save(previous);
+save(next);
 done();`),
    );
    assert(
      publication.inlineFindings.length === 1 && publication.inlineFindings[0]?.line === 41 &&
        publication.summaryOnlyFindings.length === 1 && publication.summaryOnlyFindings[0]?.line === 7,
      "AI review findings were not split by changed right-side line eligibility",
    );
    const fallbackPayload = buildGitHubReviewPayload(
      { summary: "Anchor checks are required.", findings: [...publication.inlineFindings, ...publication.summaryOnlyFindings] },
      "air_fallback",
      "c".repeat(40),
      publication,
    );
    assert(
      Array.isArray(fallbackPayload.comments) && fallbackPayload.comments.length === 1 &&
        String(fallbackPayload.body).includes("Findings without an inline anchor") &&
        String(fallbackPayload.body).includes("`src/state.ts:7`"),
      "Unanchorable AI review findings would still fail the entire GitHub review publication",
    );
    assert(
      shouldRetryWithoutInlineComments(
        new Error('gh: Unprocessable Entity (HTTP 422)\n{"errors":["Path could not be resolved"]}'),
        publication,
      ) &&
        !shouldRetryWithoutInlineComments(new Error("HTTP 422: unrelated validation failure"), publication) &&
        !shouldRetryWithoutInlineComments(
          new Error('Path could not be resolved'),
          { inlineFindings: [], summaryOnlyFindings: publication.summaryOnlyFindings },
        ),
      "AI review publication retry must only downgrade inline findings for known GitHub anchor failures",
    );
    const retryPayload = buildGitHubReviewPayload(
      { summary: "Anchor checks are required.", findings: [...publication.inlineFindings, ...publication.summaryOnlyFindings] },
      "air_retry",
      "d".repeat(40),
      { inlineFindings: [], summaryOnlyFindings: [...publication.inlineFindings, ...publication.summaryOnlyFindings] },
    );
    assert(
      Array.isArray(retryPayload.comments) && retryPayload.comments.length === 0 &&
        String(retryPayload.body).includes("`src/state.ts:41`") &&
        String(retryPayload.body).includes("`src/state.ts:7`"),
      "GitHub anchor fallback would not preserve every finding in the review summary",
    );
    const publishedAfterEmptyResponse = findPublishedReviewWithMarker(
      [
        { id: 17, commit_id: "wrong", body: "<!-- kurami-ai-review:air_response;head=expected -->" },
        { id: 18, commit_id: "e".repeat(40), body: "unrelated review" },
        {
          id: 19,
          html_url: "https://example.invalid/reviews/19",
          commit_id: "e".repeat(40),
          body: `review\n<!-- kurami-ai-review:air_response;head=${"e".repeat(40)} -->`,
        },
      ],
      "air_response",
      "e".repeat(40),
    );
    assert(
      publishedAfterEmptyResponse?.id === 19 &&
        findPublishedReviewWithMarker([], "air_response", "e".repeat(40)) === undefined,
      "An empty successful GitHub publication response cannot be recovered from exact review provenance",
    );
    assert(
      parseReviewResult('{"summary":"Clean","findings":[]}').findings.length === 0,
      "No-findings review is not accepted",
    );
    let rejectedReviewModeProse = false;
    try {
      parseReviewResult("## Review\n\n- [P1] The changed line triples instead of doubles the input.");
    } catch (error) {
      rejectedReviewModeProse = (error as Error).message === "Codex review result is not valid JSON";
    }
    assert(rejectedReviewModeProse, "Free-form review-mode prose must not become a publishable finding");
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

    for (const phrase of [
      "actual requirements", "both likelihood and impact",
      "preserving security, authorization, data integrity, and explicit acceptance requirements",
      "For proposed additions, identify a concrete scenario and impact",
      "smallest sufficient fix", "Low-impact hypotheticals are not blockers",
      "acceptable limitations are not defects", "Do not manufacture simplicity findings",
      "this diff introduces a concrete maintenance or correctness cost",
      "with evidence and a proportionate simplification",
      "fewer lines or a preferred style alone are not grounds for a finding",
      "read-only independent review", "Do not modify files, Git state, GitHub, or any external state",
      `Review only the diff ${"a".repeat(40)}..${"b".repeat(40)}`,
      `The worktree HEAD must remain exactly ${"b".repeat(40)}`,
      "Return at most 10 findings", "changed RIGHT-side line",
      "Return only JSON with this exact shape", "An empty findings array is a valid successful review",
    ]) assert(instructions.includes(phrase), `Review prompt contract missing: ${phrase}`);

    const fakeCodex = resolve(home, "fake-codex-review.mjs");
    const archiveLog = resolve(home, "review-archives.log");
    const requestLog = resolve(home, "review-request.log");
    await writeFile(
      fakeCodex,
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "KURAMI_TEST_API_TOKEN", "KURAMI_TEST_PRIVATE_KEY"]) {
  if (process.env[name]) throw new Error("Reviewer received secret environment material");
}
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const message = JSON.parse(line);
  let result = {};
  if (message.method === "thread/start") {
    if (message.params.approvalPolicy !== "never" || message.params.sandbox !== "read-only") throw new Error("Review isolation was weakened");
    result = { thread: { id: "review-thread" } };
  }
  if (message.method === "thread/name/set" && (message.params.threadId !== "review-thread" || message.params.name !== "AI review test")) throw new Error("Review thread was not named");
  if (message.method === "review/start") result = { turn: { id: "review-turn", status: "inProgress", items: [] }, reviewThreadId: "review-thread" };
  if (message.method === "turn/start") {
    appendFileSync(process.env.FAKE_REVIEW_REQUEST_LOG, JSON.stringify(message.params) + "\\n");
    if (message.params.threadId !== "review-thread") throw new Error("Review did not use its dedicated thread");
    result = { turn: { id: "review-turn", status: "inProgress", items: [] } };
  }
  if (message.method === "thread/archive") appendFileSync(process.env.FAKE_REVIEW_ARCHIVE_LOG, message.params.threadId + "\\n");
  if (typeof message.id === "number") process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
  if (message.method === "turn/start") {
    process.stdout.write(JSON.stringify({ method: "item/completed", params: { threadId: "review-thread", turnId: "review-turn", item: { type: "agentMessage", phase: "commentary", text: "Inspecting the diff." } } }) + "\\n");
    process.stdout.write(JSON.stringify({ method: "item/completed", params: { threadId: "review-thread", turnId: "review-turn", item: { type: "agentMessage", phase: "final_answer", text: JSON.stringify({ summary: "Clean", findings: [] }) } } }) + "\\n");
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "review-thread", turn: { id: "review-turn", status: "completed", error: null, items: [] } } }) + "\\n");
  }
  if (message.method === "review/start") {
    process.stdout.write(JSON.stringify({ method: "item/completed", params: { threadId: "review-thread", turnId: "review-turn", item: { type: "exitedReviewMode", review: "## Review\\n\\n- [P1] The changed line triples instead of doubles the input." } } }) + "\\n");
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "review-thread", turn: { id: "review-turn", status: "completed", error: null, items: [] } } }) + "\\n");
  }
}
`,
      { mode: 0o700 },
    );
    process.env.FAKE_REVIEW_ARCHIVE_LOG = archiveLog;
    process.env.FAKE_REVIEW_REQUEST_LOG = requestLog;
    process.env.GH_TOKEN = "must-not-reach-reviewer";
    process.env.GITHUB_TOKEN = "must-not-reach-reviewer";
    process.env.KURAMI_TEST_API_TOKEN = "must-not-reach-reviewer";
    process.env.KURAMI_TEST_PRIVATE_KEY = "must-not-reach-reviewer";
    let startedIdentity: [string, string] | undefined;
    const detached = await runDetachedReview(fakeCodex, {
      cwd: home,
      title: "AI review test",
      instructions: "Review exact fixture SHA and return JSON.",
      outputSchema: reviewOutputSchema,
      timeoutMs: 5_000,
      onStarted: (threadId, turnId) => {
        startedIdentity = [threadId, turnId];
      },
    });
    delete process.env.FAKE_REVIEW_ARCHIVE_LOG;
    delete process.env.FAKE_REVIEW_REQUEST_LOG;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.KURAMI_TEST_API_TOKEN;
    delete process.env.KURAMI_TEST_PRIVATE_KEY;
    assert(
      detached.parentThreadId === "review-thread" &&
        detached.reviewThreadId === "review-thread" &&
        startedIdentity?.[0] === "review-thread" &&
        startedIdentity?.[1] === "review-turn" &&
        parseReviewResult(detached.review).findings.length === 0,
      "Isolated Codex review lifecycle was not completed",
    );
    const reviewRequest = JSON.parse(await readFile(requestLog, "utf8")) as {
      threadId?: string;
      input?: Array<{ type?: string; text?: string }>;
      outputSchema?: unknown;
    };
    assert(
      reviewRequest.threadId === "review-thread" &&
        reviewRequest.input?.[0]?.type === "text" &&
        reviewRequest.input[0].text === "Review exact fixture SHA and return JSON." &&
        JSON.stringify(reviewRequest.outputSchema) === JSON.stringify(reviewOutputSchema),
      "Review did not request a schema-constrained final message on its dedicated thread",
    );
    const archived = (await readFile(archiveLog, "utf8")).trim().split("\n");
    assert(
      archived.length === 1 && archived[0] === "review-thread",
      "Technical review task was not archived exactly once",
    );

    const approvalCodex = resolve(home, "fake-codex-review-approval.mjs");
    const approvalLog = resolve(home, "review-approval-response.log");
    await writeFile(
      approvalCodex,
      `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\nimport { createInterface } from "node:readline";\n// stdin closes after the decline; drain it before this fixture exits.\nprocess.on("SIGTERM", () => {});\nconst lines = createInterface({ input: process.stdin });\nfor await (const line of lines) {\n  const message = JSON.parse(line);\n  if (message.id === 900) {\n    appendFileSync(process.env.FAKE_REVIEW_APPROVAL_LOG, JSON.stringify(message) + "\\n");\n    continue;\n  }\n  let result = {};\n  if (message.method === "thread/start") result = { thread: { id: "approval-parent-thread" } };\n  if (message.method === "turn/start") result = { turn: { id: "approval-turn", status: "inProgress", items: [] } };\n  if (typeof message.id === "number") process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");\n  if (message.method === "turn/start") process.stdout.write(JSON.stringify({ method: "item/commandExecution/requestApproval", id: 900, params: { threadId: "approval-parent-thread", turnId: "approval-turn", itemId: "approval-item", reason: "network" } }) + "\\n");\n}\n`,
      { mode: 0o700 },
    );
    process.env.FAKE_REVIEW_APPROVAL_LOG = approvalLog;
    let approvalFailure = "";
    try {
      await runDetachedReview(approvalCodex, {
        cwd: home,
        title: "AI review approval guard test",
        instructions: "Review locally without interactive requests.",
        outputSchema: reviewOutputSchema,
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
    // Client shutdown does not await the fixture's exit or filesystem write.
    let approvalResponse: { result?: { decision?: string } } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { approvalResponse = JSON.parse((await readFile(approvalLog, "utf8")).trim()); break; }
      catch { await delay(10); }
    }
    assert(approvalResponse, "Approval fixture did not record the decline before exiting");
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
