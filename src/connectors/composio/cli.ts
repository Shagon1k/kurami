import { resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import {
  redactComposioText,
  runSessionSync,
  type RunSessionSyncResult,
  type SessionDiffEntry,
} from "./session-sync.ts";

type CliOptions = {
  apply: boolean;
  json: boolean;
  config?: string;
  runtimeDirectory?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(arguments_: string[]): CliOptions {
  const options: CliOptions = { apply: false, json: false };
  const values = [...arguments_];
  const command = values.shift();
  if (command === "apply" || command === "--apply") options.apply = true;
  else if (command !== "check" && command !== undefined) {
    fail("Usage: composio-session-sync [check|apply] [--config PATH] [--runtime-dir PATH] [--json]");
  }
  while (values.length > 0) {
    const argument = values.shift();
    if (argument === "--json") options.json = true;
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--config") options.config = values.shift() ?? fail("--config requires a path");
    else if (argument === "--runtime-dir") {
      options.runtimeDirectory = values.shift() ?? fail("--runtime-dir requires a path");
    } else fail(`Unknown argument: ${argument}`);
  }
  return options;
}

function diffLine(entry: SessionDiffEntry): string {
  if (entry.kind === "add") return `+ ${entry.field}: ${entry.after}`;
  if (entry.kind === "remove") return `- ${entry.field}: ${entry.before}`;
  return `~ ${entry.field}: ${entry.before} -> ${entry.after}`;
}

function printableResult(result: RunSessionSyncResult): Record<string, unknown> {
  return {
    ok: true,
    mode: result.applied ? "apply" : "check",
    changed: result.changed,
    configVersion: result.session.config_version ?? null,
    diff: result.plan.diff,
    activeAccountCounts: result.plan.activeAccountCounts,
    selectedAccountCounts: result.plan.selectedAccountCounts,
    warnings: result.plan.warnings,
  };
}

function printHuman(result: RunSessionSyncResult): void {
  process.stdout.write("Composio Session diff\n");
  if (result.plan.diff.length === 0) process.stdout.write("No changes. Session matches desired state.\n");
  else for (const entry of result.plan.diff) process.stdout.write(`${diffLine(entry)}\n`);
  for (const warning of result.plan.warnings) process.stdout.write(`! ${warning}\n`);
  if (!result.applied && result.changed) {
    process.stdout.write("\nDry run only. Re-run with apply to update the existing Session.\n");
  } else if (result.applied && result.changed) {
    process.stdout.write("\nApplied and verified. Session ID and MCP URL were preserved.\n");
  } else if (result.applied) {
    process.stdout.write("\nVerified. No remote update was required.\n");
  }
}

export async function runComposioSessionCli(arguments_ = process.argv.slice(2)): Promise<void> {
  const options = parseArguments(arguments_);
  const kuramiHome = resolveKuramiHome(resolve(import.meta.dirname, "../../.."));
  const result = await runSessionSync({
    apply: options.apply,
    desiredStatePath: resolve(
      options.config ?? resolve(kuramiHome, "deploy/config/connectors/composio-session.yaml"),
    ),
    runtimeDirectory: resolve(
      options.runtimeDirectory ??
        resolve(kuramiHome, "connectors/external/composio-session"),
    ),
  });
  if (options.json) process.stdout.write(`${JSON.stringify(printableResult(result))}\n`);
  else printHuman(result);
  if (!options.apply && result.changed) process.exitCode = 2;
}

if (import.meta.main) {
  runComposioSessionCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: redactComposioText(message) })}\n`);
    process.exitCode = 1;
  });
}
