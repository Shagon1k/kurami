import { resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { installHermesReadSession } from "./hermes-install.ts";
import {
  createSiblingSession,
  redactComposioText,
  runSessionSync,
  type RunSessionSyncResult,
  type SessionDiffEntry,
} from "./session-sync.ts";

type CliOptions = {
  command: "check" | "apply" | "create" | "install-hermes-read";
  json: boolean;
  config?: string;
  runtimeDirectory?: string;
  sourceRuntimeDirectory?: string;
  hermesConfig?: string;
  systemdDropIn?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(arguments_: string[]): CliOptions {
  const options: CliOptions = { command: "check", json: false };
  const values = [...arguments_];
  const command = values.shift();
  if (command === "apply" || command === "--apply") options.command = "apply";
  else if (command === "create") options.command = "create";
  else if (command === "install-hermes-read") options.command = "install-hermes-read";
  else if (command !== "check" && command !== undefined) {
    fail("Usage: composio-session-sync [check|apply|create|install-hermes-read] [--config PATH] [--runtime-dir PATH] [--source-runtime-dir PATH] [--hermes-config PATH] [--systemd-drop-in PATH] [--json]");
  }
  while (values.length > 0) {
    const argument = values.shift();
    if (argument === "--json") options.json = true;
    else if (argument === "--apply") options.command = "apply";
    else if (argument === "--config") options.config = values.shift() ?? fail("--config requires a path");
    else if (argument === "--runtime-dir") {
      options.runtimeDirectory = values.shift() ?? fail("--runtime-dir requires a path");
    } else if (argument === "--source-runtime-dir") {
      options.sourceRuntimeDirectory = values.shift() ??
        fail("--source-runtime-dir requires a path");
    } else if (argument === "--hermes-config") {
      options.hermesConfig = values.shift() ?? fail("--hermes-config requires a path");
    } else if (argument === "--systemd-drop-in") {
      options.systemdDropIn = values.shift() ?? fail("--systemd-drop-in requires a path");
    } else fail(`Unknown argument: ${argument}`);
  }
  return options;
}

function diffLine(entry: SessionDiffEntry): string {
  if (entry.kind === "add") return `+ ${entry.field}: ${entry.after}`;
  if (entry.kind === "remove") return `- ${entry.field}: ${entry.before}`;
  return `~ ${entry.field}: ${entry.before} -> ${entry.after}`;
}

function printableResult(
  result: RunSessionSyncResult,
  command: Exclude<CliOptions["command"], "install-hermes-read">,
): Record<string, unknown> {
  return {
    ok: true,
    mode: command,
    changed: result.changed,
    configVersion: result.session.config_version ?? null,
    diff: result.plan.diff,
    activeAccountCounts: result.plan.activeAccountCounts,
    selectedAccountCounts: result.plan.selectedAccountCounts,
    warnings: result.plan.warnings,
  };
}

function printHuman(
  result: RunSessionSyncResult,
  command: Exclude<CliOptions["command"], "install-hermes-read">,
): void {
  if (command === "create") {
    process.stdout.write("Created and verified a restricted Composio Session.\n");
    return;
  }
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
  const applicationRoot = resolve(import.meta.dirname, "../../..");
  const kuramiHome = resolveKuramiHome(resolve(import.meta.dirname, "../../../.."));
  const defaultSourceRuntime = resolve(kuramiHome, "connectors/external/composio-session");
  if (options.command === "install-hermes-read") {
    const installed = await installHermesReadSession({
      hermesConfigPath: resolve(
        options.hermesConfig ?? resolve(kuramiHome, "../_core/config.yaml"),
      ),
      runtimeDirectory: resolve(
        options.runtimeDirectory ??
          resolve(kuramiHome, "connectors/external/composio-read-session"),
      ),
      systemdDropInPath: resolve(
        options.systemdDropIn ??
          resolve(
            kuramiHome,
            "../../.config/systemd/user/hermes-gateway.service.d/composio-read.conf",
          ),
      ),
    });
    if (options.json) process.stdout.write(`${JSON.stringify({ ok: true, ...installed })}\n`);
    else process.stdout.write("Installed the restricted composio-read MCP entry for Hermes.\n");
    return;
  }
  const result = options.command === "create"
    ? await createSiblingSession({
      desiredStatePath: resolve(
        options.config ??
          resolve(applicationRoot, "deploy/config/connectors/composio-read-session.yaml"),
      ),
      sourceRuntimeDirectory: resolve(
        options.sourceRuntimeDirectory ?? defaultSourceRuntime,
      ),
      targetRuntimeDirectory: resolve(
        options.runtimeDirectory ??
          resolve(kuramiHome, "connectors/external/composio-read-session"),
      ),
    })
    : await runSessionSync({
      apply: options.command === "apply",
      desiredStatePath: resolve(
        options.config ?? resolve(applicationRoot, "deploy/config/connectors/composio-session.yaml"),
      ),
      runtimeDirectory: resolve(
        options.runtimeDirectory ?? defaultSourceRuntime,
      ),
    });
  if (options.json) process.stdout.write(`${JSON.stringify(printableResult(result, options.command))}\n`);
  else printHuman(result, options.command);
  if (options.command === "check" && result.changed) process.exitCode = 2;
}

if (import.meta.main) {
  runComposioSessionCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: redactComposioText(message) })}\n`);
    process.exitCode = 1;
  });
}
