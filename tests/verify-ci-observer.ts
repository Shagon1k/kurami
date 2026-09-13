import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse, stringify } from "yaml";
import { normalizeRequiredChecks } from "../src/orchestrator/projects/ci/observe.ts";

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
  return JSON.parse(
    execFileSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env, KURAMI_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ) as JsonObject;
}

function pull(
  number: number,
  branch: string,
  sha: string,
  repository = "Shagon1k/TailorTales",
): JsonObject {
  return {
    number,
    html_url: `https://example.invalid/pulls/${number}`,
    title: `CI pull ${number}`,
    state: "open",
    created_at: "2026-08-18T08:00:00.000Z",
    head: {
      ref: branch,
      sha,
      repo: { full_name: repository },
    },
    base: { repo: { full_name: repository } },
  };
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-ci-test-"));
  try {
    await mkdir(resolve(home, "config"), { recursive: true });
    const sourceProjects = parse(
      await readFile(resolve(app, "deploy/config/projects.yaml"), "utf8"),
    ) as {
      projects: Record<
        string,
        {
          ci: {
            enabled: boolean;
            required_checks?: string[];
            missing_grace_minutes?: number;
          };
        }
      >;
    };
    const pickFlickCi = sourceProjects.projects.pickflick?.ci;
    assert(
      pickFlickCi?.enabled === true &&
        JSON.stringify(pickFlickCi.required_checks) ===
          JSON.stringify([
            "Secret scan",
            "Lint, type-check, test",
            "Integration and runtime smoke",
            "UI accessibility and visual regression",
            "Production images",
          ]) &&
        pickFlickCi.missing_grace_minutes === 10,
      "Tracked PickFlick CI policy is not aligned with GitHub checks",
    );
    sourceProjects.projects.pickflick!.ci = { enabled: false };
    await writeFile(
      resolve(home, "config/projects.yaml"),
      stringify(sourceProjects),
      "utf8",
    );
    await copyFile(
      resolve(app, "deploy/config/orchestrator.yaml"),
      resolve(home, "config/orchestrator.yaml"),
    );
    runNode(resolve(app, "src/orchestrator/state/init-run-store.ts"), [], home);

    const databasePath = resolve(home, "state/orchestrator.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, payload_json, processing_state
      ) VALUES (
        'event-ci', '2026-08-18T08:00:00.000Z', 'tailortales',
        'item-ci', 'content-ci', 'Issue', 'Shagon1k/TailorTales', 120,
        'Observe CI', 'https://example.invalid/issues/120', '{}', 'processed'
      );
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode,
        created_at, updated_at
      ) VALUES (
        'r_ci', 'event-ci', 'tailortales', 'item-ci', 'content-ci',
        'Shagon1k/TailorTales', 120, 'autonomous', 'waiting_human', 'none',
        'live', '2026-08-18T08:00:00.000Z', '2026-08-18T08:00:00.000Z'
      );
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name, codex_thread_id
      ) VALUES (
        'r_ci', 'provisioned', '/tmp/worktrees/120/TailorTales',
        'TT-120_observe-ci', '01a00b9d-e72b-73f3-af6e-30760c2191c4'
      );
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, payload_json, processing_state
      ) VALUES (
        'event-ci-disabled', '2026-08-18T08:00:00.000Z', 'pickflick',
        'item-ci-disabled', 'content-ci-disabled', 'Issue',
        'Shagon1k/PickFlick', 5, 'Static preview provenance',
        'https://example.invalid/issues/5', '{}', 'processed'
      );
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode,
        created_at, updated_at
      ) VALUES (
        'r_ci_disabled', 'event-ci-disabled', 'pickflick', 'item-ci-disabled',
        'content-ci-disabled', 'Shagon1k/PickFlick', 5, 'autonomous',
        'parked_review', 'none', 'live', '2026-08-18T08:00:00.000Z',
        '2026-08-18T08:00:00.000Z'
      );
      INSERT INTO run_resources (
        run_id, resource_state, worktree_path, branch_name, codex_thread_id
      ) VALUES (
        'r_ci_disabled', 'provisioned', '/tmp/worktrees/5/PickFlick',
        'PF-5_static-preview', '01a00b9d-e72b-73f3-af6e-30760c2191c5'
      );
    `);

    const bin = resolve(home, "bin");
    await mkdir(bin);
    const fakeGh = resolve(bin, "gh");
    await writeFile(
      fakeGh,
      `#!/bin/sh
set -eu
case "$*" in
  *'/pulls'*)
    [ "\${KURAMI_TEST_GH_FAIL:-}" != "pulls" ] || exit 2
    printf '%s\n' "$KURAMI_TEST_PULLS"
    ;;
  *'/check-runs'*)
    [ "\${KURAMI_TEST_GH_FAIL:-}" != "checks" ] || exit 2
    printf '%s\n' "$KURAMI_TEST_CHECK_RUNS"
    ;;
  *'/status'*)
    [ "\${KURAMI_TEST_GH_FAIL:-}" != "statuses" ] || exit 2
    printf '%s\n' "$KURAMI_TEST_STATUSES"
    ;;
  *)
    printf 'unexpected gh invocation: %s\n' "$*" >&2
    exit 2
    ;;
esac
`,
    );
    await chmod(fakeGh, 0o700);
    const observer = resolve(app, "src/orchestrator/projects/ci/observe.ts");
    const path = `${bin}${delimiter}${process.env.PATH ?? ""}`;
    const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const shaC = "cccccccccccccccccccccccccccccccccccccccc";
    const passedEnv = {
      PATH: path,
      KURAMI_TEST_PULLS: JSON.stringify([pull(120, "TT-120_observe-ci", shaA)]),
      KURAMI_TEST_CHECK_RUNS: JSON.stringify({
        check_runs: [
          {
            id: 10,
            name: "Secret scan",
            status: "completed",
            conclusion: "success",
            details_url: "https://example.invalid/checks/10",
            started_at: "2026-08-18T08:01:00.000Z",
            completed_at: "2026-08-18T08:02:00.000Z",
          },
        ],
      }),
      KURAMI_TEST_STATUSES: JSON.stringify({
        statuses: [
          {
            id: 11,
            context: "Lint, type-check, test",
            state: "success",
            target_url: "https://example.invalid/statuses/11",
            updated_at: "2026-08-18T08:03:00.000Z",
          },
        ],
      }),
    };

    const dryRun = runNode(
      observer,
      ["--project", "tailortales"],
      home,
      passedEnv,
    );
    assert(dryRun.apply === false, "CI observer dry-run was not reported");
    assert(
      !database.prepare("SELECT 1 FROM run_ci_snapshots").get(),
      "CI observer dry-run mutated SQLite",
    );

    runNode(
      observer,
      ["--project", "tailortales", "--apply"],
      home,
      passedEnv,
    );
    let snapshot = database
      .prepare(
        `SELECT aggregate_state, head_sha, checks_json
         FROM run_ci_snapshots WHERE run_id='r_ci'`,
      )
      .get() as {
      aggregate_state: string;
      head_sha: string | null;
      checks_json: string;
    };
    assert(
      snapshot.aggregate_state === "passed" && snapshot.head_sha === shaA,
      "Exact-SHA passed CI snapshot was not stored",
    );
    assert(
      (JSON.parse(snapshot.checks_json) as JsonObject[]).length === 2,
      "Check-runs and legacy statuses were not normalized together",
    );

    const missingEnv = {
      ...passedEnv,
      KURAMI_TEST_PULLS: JSON.stringify([pull(120, "TT-120_observe-ci", shaB)]),
      KURAMI_TEST_CHECK_RUNS: JSON.stringify({
        check_runs: [
          {
            id: 20,
            name: "Secret scan",
            status: "completed",
            conclusion: "success",
            details_url: null,
            started_at: "2026-08-18T09:01:00.000Z",
            completed_at: "2026-08-18T09:02:00.000Z",
          },
        ],
      }),
      KURAMI_TEST_STATUSES: JSON.stringify({ statuses: [] }),
    };
    runNode(
      observer,
      ["--project", "tailortales", "--apply"],
      home,
      missingEnv,
    );
    snapshot = database
      .prepare(
        `SELECT aggregate_state, head_sha, checks_json
         FROM run_ci_snapshots WHERE run_id='r_ci'`,
      )
      .get() as typeof snapshot;
    assert(
      snapshot.aggregate_state === "pending" && snapshot.head_sha === shaB,
      "Missing check skipped its grace period",
    );
    database
      .prepare(
        `UPDATE run_ci_snapshots
         SET first_observed_at='2026-08-18T00:00:00.000Z'
         WHERE run_id='r_ci'`,
      )
      .run();
    runNode(
      observer,
      ["--project", "tailortales", "--apply"],
      home,
      missingEnv,
    );
    snapshot = database
      .prepare(
        `SELECT aggregate_state, head_sha, checks_json
         FROM run_ci_snapshots WHERE run_id='r_ci'`,
      )
      .get() as typeof snapshot;
    assert(snapshot.aggregate_state === "missing", "Missing grace did not expire");

    runNode(resolve(app, "src/orchestrator/runtime/controller.ts"), ["--apply"], home);
    runNode(resolve(app, "src/orchestrator/runtime/controller.ts"), ["--apply"], home);
    const ciEvents = database
      .prepare(
        `SELECT event_id, payload_json FROM run_control_events
         WHERE run_id='r_ci' AND event_id LIKE 'ce_r_ci_ci_%'`,
      )
      .all() as Array<{ event_id: string; payload_json: string }>;
    assert(ciEvents.length === 1, "CI attention event was not one-shot");
    const eventPayload = JSON.parse(ciEvents[0]!.payload_json) as JsonObject;
    assert(
      eventPayload.source === "ci" && eventPayload.state === "missing",
      "CI attention event lost its normalized payload",
    );

    runNode(
      observer,
      ["--project", "tailortales", "--apply"],
      home,
      { ...missingEnv, KURAMI_TEST_GH_FAIL: "pulls" },
    );
    const unknown = database
      .prepare(
        `SELECT aggregate_state FROM run_ci_snapshots WHERE run_id='r_ci'`,
      )
      .get() as { aggregate_state: string };
    assert(
      unknown.aggregate_state === "unknown",
      "GitHub API failure was misreported as failed CI",
    );

    runNode(
      observer,
      ["--project", "tailortales", "--apply"],
      home,
      {
        ...passedEnv,
        KURAMI_TEST_PULLS: JSON.stringify([
          pull(121, "TT-120_observe-ci", shaC),
          pull(122, "TT-120_observe-ci", shaC),
        ]),
      },
    );
    const ambiguous = database
      .prepare(
        `SELECT aggregate_state, head_sha, last_error
         FROM run_ci_snapshots WHERE run_id='r_ci'`,
      )
      .get() as {
      aggregate_state: string;
      head_sha: string | null;
      last_error: string | null;
    };
    assert(
      ambiguous.aggregate_state === "unknown" &&
        ambiguous.head_sha === null &&
        Boolean(ambiguous.last_error),
      "Ambiguous PR mapping did not fail closed",
    );

    const disabledSha = "dddddddddddddddddddddddddddddddddddddddd";
    const disabled = runNode(
      observer,
      ["--project", "pickflick", "--apply"],
      home,
      {
        PATH: path,
        KURAMI_TEST_PULLS: JSON.stringify([
          pull(
            5,
            "PF-5_static-preview",
            disabledSha,
            "Shagon1k/PickFlick",
          ),
        ]),
      },
    );
    assert(
      disabled.enabled === false && disabled.runs === 1,
      "Project-level CI disable policy was ignored",
    );
    const disabledSnapshot = database
      .prepare(
        `SELECT pull_request_number, head_sha, aggregate_state, checks_json
         FROM run_ci_snapshots WHERE run_id='r_ci_disabled'`,
      )
      .get() as {
      pull_request_number: number;
      head_sha: string;
      aggregate_state: string;
      checks_json: string;
    };
    assert(
      disabledSnapshot.pull_request_number === 5 &&
        disabledSnapshot.head_sha === disabledSha &&
        disabledSnapshot.aggregate_state === "passed" &&
        disabledSnapshot.checks_json === "[]",
      "CI-disabled project lost exact PR-head provenance",
    );

    const normalizedFailure = normalizeRequiredChecks(
      ["Secret scan"],
      [
        {
          id: 30,
          name: "Secret scan",
          status: "completed",
          conclusion: "failure",
          details_url: null,
          started_at: null,
          completed_at: null,
        },
      ],
      [],
      "2026-08-18T08:00:00.000Z",
      "2026-08-18T08:01:00.000Z",
      10,
    );
    assert(
      normalizedFailure.aggregateState === "failed",
      "Failed required check was not normalized",
    );

    database.close();
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        isolated: true,
        dryRun: true,
        exactSha: true,
        legacyStatuses: true,
        missingGrace: true,
        unknownOnApiFailure: true,
        ambiguousFailClosed: true,
        oneShotEvent: true,
        projectPolicy: true,
        pickFlickCiEnabled: true,
        disabledProjectExactSha: true,
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
