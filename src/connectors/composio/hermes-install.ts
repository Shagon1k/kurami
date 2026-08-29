import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";
import {
  loadRuntime,
  type ComposioRuntimeProfile,
} from "./session-sync.ts";

const READ_TOOLS = [
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
  "GOOGLECALENDAR_EVENTS_LIST",
] as const;

const AUTOMATION_TOOLS = [
  "GMAIL_BATCH_MODIFY_MESSAGES",
] as const;

type RestrictedContour = "read" | "automation";

export type HermesReadInstallOptions = {
  hermesConfigPath: string;
  runtimeDirectory: string;
  systemdDropInPath: string;
};

export type HermesAutomationInstallOptions = HermesReadInstallOptions;

export type HermesReadInstallResult = {
  configChanged: boolean;
  dropInChanged: boolean;
  backupPath: string;
  tools: readonly string[];
};

function fail(message: string): never {
  throw new Error(message);
}

async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

async function writeIfChanged(path: string, content: string, mode: number): Promise<boolean> {
  let current: string | undefined;
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current === content) return false;
  await atomicWrite(path, content, mode);
  return true;
}

function contourSettings(contour: RestrictedContour): {
  serverName: string;
  runtimeProfile: ComposioRuntimeProfile;
  variablePrefix: string;
  trust: "full" | "untrusted";
  tools: readonly string[];
} {
  if (contour === "automation") {
    return {
      serverName: "composio-automation",
      runtimeProfile: "automation",
      variablePrefix: "COMPOSIO_AUTOMATION",
      trust: "full",
      tools: AUTOMATION_TOOLS,
    };
  }
  return {
    serverName: "composio-read",
    runtimeProfile: "read",
    variablePrefix: "COMPOSIO_READ",
    trust: "untrusted",
    tools: READ_TOOLS,
  };
}

function desiredServer(contour: RestrictedContour): Record<string, unknown> {
  const settings = contourSettings(contour);
  return {
    url: `\${${settings.variablePrefix}_MCP_URL}`,
    headers: { "x-api-key": `\${${settings.variablePrefix}_API_KEY}` },
    enabled: true,
    timeout: 300,
    connect_timeout: 60,
    keepalive_interval: 120,
    supports_parallel_tool_calls: false,
    strict_redirect_headers: true,
    trust: settings.trust,
    tools: {
      include: [...settings.tools],
      resources: false,
      prompts: false,
    },
  };
}

async function installHermesRestrictedSession(
  contour: RestrictedContour,
  options: HermesReadInstallOptions,
): Promise<HermesReadInstallResult> {
  const settings = contourSettings(contour);
  const configPath = resolve(options.hermesConfigPath);
  const runtimeDirectory = resolve(options.runtimeDirectory);
  const dropInPath = resolve(options.systemdDropInPath);
  const runtime = await loadRuntime(
    resolve(runtimeDirectory, ".env"),
    settings.runtimeProfile,
  );
  if (!runtime.mcpUrl) {
    fail(`Composio ${contour} Session MCP URL is missing from its runtime`);
  }

  const info = await lstat(configPath);
  if (!info.isFile()) fail("Hermes config must be a regular file");
  const mode = info.mode & 0o777;
  const original = await readFile(configPath, "utf8");
  const document = parseDocument(original);
  if (document.errors.length > 0) fail("Hermes config is not valid YAML");
  if (!document.get("mcp_servers")) fail("Hermes config has no mcp_servers mapping");
  document.setIn(["mcp_servers", settings.serverName], desiredServer(contour));
  const rendered = String(document);

  const backupPath = `${configPath}.before-${settings.serverName}`;
  try {
    await copyFile(configPath, backupPath, constants.COPYFILE_EXCL);
    await chmod(backupPath, mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const configChanged = await writeIfChanged(configPath, rendered, mode);

  const dropIn = [
    "[Service]",
    `EnvironmentFile=${resolve(runtimeDirectory, ".env")}`,
    "",
  ].join("\n");
  const dropInChanged = await writeIfChanged(dropInPath, dropIn, 0o600);

  return {
    configChanged,
    dropInChanged,
    backupPath,
    tools: settings.tools,
  };
}

export async function installHermesReadSession(
  options: HermesReadInstallOptions,
): Promise<HermesReadInstallResult> {
  return installHermesRestrictedSession("read", options);
}

export async function installHermesAutomationSession(
  options: HermesAutomationInstallOptions,
): Promise<HermesReadInstallResult> {
  return installHermesRestrictedSession("automation", options);
}
