import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";

type PreviewAdapter = "compose" | "static";

type ProjectsRegistry = {
  version: number;
  projects: Record<string, { preview?: { adapter?: PreviewAdapter } }>;
};

const orchestratorHome = resolve(
  process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);

function fail(message: string): never {
  throw new Error(message);
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1]?.trim() : undefined;
}

export function selectAdapter(runId: string): PreviewAdapter {
  const database = new DatabaseSync(
    resolve(orchestratorHome, "state/orchestrator.db"),
    { readOnly: true, timeout: 5_000 },
  );
  const row = database
    .prepare(`
      SELECT r.project, pl.state AS lease_state, pl.runtime_adapter
      FROM runs r
      JOIN preview_leases pl ON pl.run_id=r.run_id AND pl.state <> 'released'
      WHERE r.run_id=?
    `)
    .get(runId) as
    | { project: string; lease_state: string; runtime_adapter: PreviewAdapter }
    | undefined;
  database.close();
  if (!row) fail(`Active preview lease not found for run: ${runId}`);
  if (row.lease_state !== "leased") return row.runtime_adapter;

  const registry = parse(
    readFileSync(resolve(orchestratorHome, "config/projects.yaml"), "utf8"),
  ) as ProjectsRegistry;
  if (registry.version !== 1) fail("Unsupported projects registry version");
  const adapter = registry.projects[row.project]?.preview?.adapter;
  if (!adapter || !["compose", "static"].includes(adapter)) {
    fail(`Preview adapter is not configured for project: ${row.project}`);
  }
  return adapter;
}

function main(): void {
  const args = process.argv.slice(2);
  const runId = valueAfter(args, "--run-id");
  if (!runId || !/^r_[a-zA-Z0-9_]+$/u.test(runId)) {
    fail("preview-runtime requires a valid --run-id");
  }
  const adapter = selectAdapter(runId);
  const runtime = resolve(
    import.meta.dirname,
    adapter === "compose"
      ? "preview-compose-runtime.ts"
      : "preview-static-runtime.ts",
  );
  const child = spawnSync(process.execPath, [runtime, ...args], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error) throw child.error;
  if (child.status !== 0) process.exitCode = child.status ?? 1;
}

if (process.argv[1]?.endsWith("preview-runtime.ts")) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  }
}
