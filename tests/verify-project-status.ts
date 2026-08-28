import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as legacyProjectStatus from "../src/orchestrator/projects/project-status.ts";
import * as canonicalProjectStatus from "../src/orchestrator/projects/project-status.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  legacyProjectStatus.runProjectStatusCli === canonicalProjectStatus.runProjectStatusCli,
  "Legacy project-status CLI does not delegate to the canonical implementation",
);

function runNode(
  path: string,
  args: string[],
  home: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Record<string, unknown> {
  return JSON.parse(
    execFileSync(process.execPath, [path, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...extraEnv, KURAMI_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const home = await mkdtemp(resolve(tmpdir(), "kurami-project-status-test-"));
  try {
    await mkdir(resolve(home, "config"), { recursive: true });
    await writeFile(
      resolve(home, "config/projects.yaml"),
      `version: 1\nprojects:\n  tailortales:\n    owner: Shagon1k\n    project_number: 2\n    status_field: Status\n    statuses:\n      backlog: Backlog\n`,
    );
    runNode(resolve(app, "src/orchestrator/state/init-run-store.ts"), [], home);
    const database = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    database.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, payload_json, processing_state
      ) VALUES ('event-1', '2026-08-17T00:00:00.000Z', 'tailortales',
                'PVTI_item', 'content-1', 'Issue', 'Shagon1k/TailorTales', 1,
                'Backlog test', 'https://example.invalid', '{}', 'processed');
      INSERT INTO project_items (
        project, item_id, content_id, content_type, repository, issue_number,
        title, url, status, first_seen_at, last_seen_at
      ) VALUES ('tailortales', 'PVTI_item', 'content-1', 'Issue',
                'Shagon1k/TailorTales', 1, 'Backlog test',
                'https://example.invalid', 'Human Review',
                '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z');
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, stop_reason,
        execution_mode
      ) VALUES ('r_backlog', 'event-1', 'tailortales', 'PVTI_item', 'content-1',
                'Shagon1k/TailorTales', 1, 'autonomous', 'cancelled', 'none',
                'cancelled', 'live');
      INSERT INTO run_resources (run_id, resource_state)
      VALUES ('r_backlog', 'released');
    `);

    const bin = resolve(home, "bin");
    const calls = resolve(home, "gh-calls.txt");
    await mkdir(bin);
    const fakeGh = resolve(bin, "gh");
    await writeFile(
      fakeGh,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\ncase "$*" in\n  *'user(login:'* ) printf '%s\\n' '{"data":{"user":{"projectV2":{"id":"PVT_project","field":{"id":"PVTSSF_status","options":[{"id":"BACKLOG","name":"Backlog"}]}}}}}' ;;\n  * ) printf '%s\\n' '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_item"}}}}' ;;\nesac\n`,
    );
    await chmod(fakeGh, 0o700);

    const script = resolve(app, "src/orchestrator/projects/project-status.ts");
    const canonicalScript = resolve(
      app,
      "src/orchestrator/projects/project-status.ts",
    );
    const plan = runNode(script, ["backlog", "--run-id", "r_backlog"], home);
    const canonicalPlan = runNode(
      canonicalScript,
      ["backlog", "--run-id", "r_backlog"],
      home,
    );
    assert(plan.action === "move_to_backlog", "Backlog move was not planned");
    assert(
      canonicalPlan.action === plan.action,
      "Canonical and legacy project-status plans differ",
    );
    const applied = runNode(
      script,
      ["backlog", "--run-id", "r_backlog", "--apply"],
      home,
      { PATH: `${bin}:${process.env.PATH ?? ""}` },
    );
    assert(applied.action === "moved_to_backlog", "Backlog move was not applied");
    const status = database
      .prepare(`SELECT status FROM project_items WHERE item_id = 'PVTI_item'`)
      .get() as { status: string };
    assert(status.status === "Backlog", "Local project snapshot was not aligned");
    const history = Number(
      (
        database
          .prepare(`
            SELECT COUNT(*) AS count FROM run_state_history
            WHERE run_id = 'r_backlog'
              AND reason = 'cancelled_item_returned_to_backlog'
          `)
          .get() as { count: number }
      ).count,
    );
    assert(history === 1, "Backlog transition was not audited");
    const ghCalls = await readFile(calls, "utf8");
    assert(ghCalls.includes("PVTI_item"), "Mutation did not target exact project item");
    database.exec(`
      UPDATE project_items
      SET status = 'In progress'
      WHERE project = 'tailortales' AND item_id = 'PVTI_item';
    `);
    const alreadySatisfied = runNode(
      script,
      ["backlog", "--run-id", "r_backlog", "--apply"],
      home,
      { PATH: `${bin}:${process.env.PATH ?? ""}` },
    );
    assert(
      alreadySatisfied.action === "backlog_already_satisfied",
      "A completed Backlog reconciliation was allowed to reassert itself",
    );
    assert(
      (await readFile(calls, "utf8")) === ghCalls,
      "A satisfied historical cancellation unexpectedly called GitHub",
    );
    database.exec(`
      INSERT INTO project_events (
        event_id, observed_at, project, item_id, content_id, content_type,
        repository, issue_number, title, url, payload_json, processing_state
      ) VALUES ('event-2', '2026-08-17T00:01:00.000Z', 'tailortales',
                'PVTI_item', 'content-1', 'Issue', 'Shagon1k/TailorTales', 1,
                'Backlog test retry', 'https://example.invalid', '{}', 'processed');
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state, execution_mode
      ) VALUES ('r_retry', 'event-2', 'tailortales', 'PVTI_item', 'content-1',
                'Shagon1k/TailorTales', 1, 'autonomous', 'running', 'cli', 'live');
      INSERT INTO run_resources (run_id, resource_state)
      VALUES ('r_retry', 'provisioned');
    `);
    const superseded = runNode(
      script,
      ["backlog", "--run-id", "r_backlog", "--apply"],
      home,
      { PATH: `${bin}:${process.env.PATH ?? ""}` },
    );
    assert(
      superseded.action === "superseded_by_newer_run",
      "Historical cancellation was allowed to override a newer run",
    );
    assert(
      (await readFile(calls, "utf8")) === ghCalls,
      "Superseded cancellation unexpectedly called GitHub",
    );
    database.close();
    process.stdout.write(
      `${JSON.stringify({ ok: true, isolated: true, terminalGuard: true, movedToBacklog: true, localSnapshotAligned: true, audited: true, oneShotBacklog: true, newerRunProtected: true })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
