import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as canonicalProvision from "../src/orchestrator/projects/worktrees/provision.ts";
import * as legacyProvision from "../src/orchestrator/projects/worktrees/provision.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  legacyProvision.runProvisionWorktreeCli ===
    canonicalProvision.runProvisionWorktreeCli,
  "Legacy provision-worktree is not a transparent compatibility wrapper",
);

function git(directory: string, args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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

const app = resolve(import.meta.dirname, "..");
const home = await mkdtemp(resolve(tmpdir(), "kurami-worktree-provision-"));
const canonicalRepository = resolve(home, "repositories/TailorTales");
const worktreeRoot = resolve(home, "worktrees/tailortales");
const worktreePath = resolve(
  worktreeRoot,
  "TT-9100_provision-boundary/TailorTales",
);
const runId = "r_provision_boundary";

try {
  await mkdir(resolve(home, "config"), { recursive: true, mode: 0o700 });
  await mkdir(canonicalRepository, { recursive: true, mode: 0o700 });
  await copyFile(
    resolve(app, "deploy/config/projects.yaml"),
    resolve(home, "config/projects.yaml"),
  );
  const projectsPath = resolve(home, "config/projects.yaml");
  const projects = (await readFile(projectsPath, "utf8"))
    .replace("/home/shagon1k/_projects/TailorTales", canonicalRepository)
    .replace(
      "/home/shagon1k/_projects/.worktrees/tailortales",
      worktreeRoot,
    );
  await writeFile(projectsPath, projects, { mode: 0o600 });

  git(canonicalRepository, ["init", "-b", "main"]);
  git(canonicalRepository, ["config", "user.email", "provision@example.invalid"]);
  git(canonicalRepository, ["config", "user.name", "Provision Test"]);
  await writeFile(resolve(canonicalRepository, "README.md"), "fixture\n");
  git(canonicalRepository, ["add", "README.md"]);
  git(canonicalRepository, ["commit", "-m", "fixture"]);
  git(canonicalRepository, [
    "remote",
    "add",
    "origin",
    "https://github.com/Shagon1k/TailorTales.git",
  ]);

  const env = {
    ...process.env,
    KURAMI_HOME: home,
    ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations"),
  };
  execFileSync(process.execPath, [resolve(app, "src/orchestrator/state/init-run-store.ts")], {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });

  const databasePath = resolve(home, "state/orchestrator.db");
  const database = new DatabaseSync(databasePath);
  database
    .prepare(
      `INSERT INTO project_events (
         event_id, observed_at, project, item_id, content_id, content_type,
         repository, issue_number, title, url, from_status, to_status,
         payload_json, processing_state
       ) VALUES (
         'event-provision', '2026-08-27T00:00:00.000Z', 'tailortales',
         'item-provision', 'content-provision', 'Issue',
         'Shagon1k/TailorTales', 9100, '[Test]: Provision boundary',
         'https://example.invalid/issues/9100', 'Backlog', 'In progress',
         '{}', 'processed'
       )`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO runs (
         run_id, trigger_event_id, project, item_id, content_id, repository,
         issue_number, interaction_policy, state, owner_state, execution_mode
       ) VALUES (?, 'event-provision', 'tailortales', 'item-provision',
         'content-provision', 'Shagon1k/TailorTales', 9100, 'autonomous',
         'admission_pending', 'none', 'dry_run')`,
    )
    .run(runId);
  database
    .prepare(
      `INSERT INTO run_resources (
         run_id, resource_state, worktree_path, branch_name
       ) VALUES (?, 'planned', ?, 'TT-9100_provision-boundary')`,
    )
    .run(runId, worktreePath);
  database.close();

  const run = (script: string): Record<string, unknown> =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [resolve(app, script), "--run-id", runId],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      ),
    ) as Record<string, unknown>;
  const plan = run("src/orchestrator/projects/worktrees/provision.ts");
  assert(
    plan.ok === true && plan.apply === false,
    "Provision plan did not remain read-only",
  );
  assert(!(await exists(worktreePath)), "Plan-only provision created a worktree");

  const verification = new DatabaseSync(databasePath, { readOnly: true });
  const state = verification
    .prepare(
      `SELECT r.state, rr.resource_state
       FROM runs r JOIN run_resources rr USING (run_id) WHERE r.run_id=?`,
    )
    .get(runId) as { state: string; resource_state: string };
  verification.close();
  assert(
    state.state === "admission_pending" && state.resource_state === "planned",
    "Plan-only provision mutated durable state",
  );

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      isolated: true,
      canonicalCli: true,
      planOnly: true,
      durableStateUnchanged: true,
      worktreeCreated: false,
    })}\n`,
  );
} finally {
  await rm(home, { recursive: true, force: true });
}
