import { resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import {
  installHermesAutomationSession,
  installHermesReadSession,
} from "./hermes-install.ts";
import {
  createSiblingSession,
  redactComposioText,
  runSessionSync,
  type RunSessionSyncResult,
  type SessionDiffEntry,
  type ComposioRuntimeProfile,
} from "./session-sync.ts";

type Contour = ComposioRuntimeProfile;

type CliOptions = {
  command: "check" | "apply" | "create" | "install-hermes";
  contour: Contour;
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
  const options: CliOptions = { command: "check", contour: "broad", json: false };
  const values = [...arguments_];
  const command = values.shift();
  if (command === "apply" || command === "--apply") options.command = "apply";
  else if (command === "create" || command === "create-read") {
    options.command = "create";
    options.contour = "read";
  } else if (command === "create-automation") {
    options.command = "create";
    options.contour = "automation";
  } else if (command === "install-hermes-read") {
    options.command = "install-hermes";
    options.contour = "read";
  } else if (command === "install-hermes-automation") {
    options.command = "install-hermes";
    options.contour = "automation";
  }
  else if (command !== "check" && command !== undefined) {
    fail("Usage: composio-session-sync [check|apply|create-read|create-automation|install-hermes-read|install-hermes-automation] [--contour broad|read|automation] [--config PATH] [--runtime-dir PATH] [--source-runtime-dir PATH] [--hermes-config PATH] [--systemd-drop-in PATH] [--json]");
  }
  while (values.length > 0) {
    const argument = values.shift();
    if (argument === "--json") options.json = true;
    else if (argument === "--apply") options.command = "apply";
    else if (argument === "--contour") {
      const contour = values.shift();
      if (contour !== "broad" && contour !== "read" && contour !== "automation") {
        fail("--contour requires broad, read, or automation");
      }
      options.contour = contour;
    }
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
  if (options.command === "create" && options.contour === "broad") {
    fail("create requires the read or automation contour");
  }
  if (options.command === "install-hermes" && options.contour === "broad") {
    fail("install-hermes requires the read or automation contour");
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
  command: Exclude<CliOptions["command"], "install-hermes">,
  contour: Contour,
): Record<string, unknown> {
  return {
    ok: true,
    mode: command,
    contour,
    changed: result.changed,
    configVersion: result.session.config_version ?? null,
    tools: [...(result.session.tool_router_tools ?? [])].sort(),
    diff: result.plan.diff,
    activeAccountCounts: result.plan.activeAccountCounts,
    selectedAccountCounts: result.plan.selectedAccountCounts,
    warnings: result.plan.warnings,
  };
}

function printHuman(
  result: RunSessionSyncResult,
  command: Exclude<CliOptions["command"], "install-hermes">,
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
  const contourName = options.contour === "broad" ? "composio" : `composio-${options.contour}`;
  const contourRuntime = resolve(kuramiHome, `connectors/external/${contourName}-session`);
  const contourConfig = resolve(
    applicationRoot,
    `deploy/config/connectors/${contourName}-session.yaml`,
  );
  if (options.command === "install-hermes") {
    const install = options.contour === "automation"
      ? installHermesAutomationSession
      : installHermesReadSession;
    const installed = await install({
      hermesConfigPath: resolve(
        options.hermesConfig ?? resolve(kuramiHome, "../_core/config.yaml"),
      ),
      runtimeDirectory: resolve(
        options.runtimeDirectory ?? contourRuntime,
      ),
      systemdDropInPath: resolve(
        options.systemdDropIn ??
          resolve(
            kuramiHome,
            `../../.config/systemd/user/hermes-gateway.service.d/${contourName}.conf`,
          ),
      ),
    });
    if (options.json) process.stdout.write(`${JSON.stringify({ ok: true, ...installed })}\n`);
    else process.stdout.write(`Installed the restricted ${contourName} MCP entry for Hermes.\n`);
    return;
  }
  const restrictedContour = options.contour === "automation" ? "automation" : "read";
  const result = options.command === "create"
    ? await createSiblingSession({
      desiredStatePath: resolve(
        options.config ?? contourConfig,
      ),
      sourceRuntimeDirectory: resolve(
        options.sourceRuntimeDirectory ?? defaultSourceRuntime,
      ),
      targetRuntimeDirectory: resolve(
        options.runtimeDirectory ?? contourRuntime,
      ),
      sourceRuntimeProfile: "broad",
      targetRuntimeProfile: restrictedContour,
    })
    : await runSessionSync({
      apply: options.command === "apply",
      desiredStatePath: resolve(
        options.config ?? contourConfig,
      ),
      runtimeDirectory: resolve(
        options.runtimeDirectory ?? contourRuntime,
      ),
      runtimeProfile: options.contour,
    });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(printableResult(result, options.command, options.contour))}\n`);
  }
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
