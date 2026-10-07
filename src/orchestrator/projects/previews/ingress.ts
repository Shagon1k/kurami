import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { openOrchestratorDatabase } from "../../state/database.ts";
import { parse } from "yaml";
import {
  CODEX_DEEPLINK_HOST,
  CODEX_DEEPLINK_PATH_PREFIX,
  CODEX_THREAD_ID_PATTERN,
} from "../../integrations/codex/deeplink.ts";

process.umask(0o077);

type Command = "reconcile" | "inspect";
type Arguments = { command: Command; apply: boolean };

type OrchestratorConfig = {
  version: number;
  mode: "dry_run" | "live";
};

export type IngressRoute = {
  run_id: string;
  slot_number: number;
  hostname: string;
  assets_hostname: string;
  frontend_port: number;
  backend_port: number;
  minio_api_port: number;
  runtime_adapter: "compose" | "static";
  artifact_root: string | null;
};

const orchestratorHome = resolveKuramiHome(resolve(import.meta.dirname, "../../../../.."));
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const configPath = resolve(orchestratorHome, "config/orchestrator.yaml");
const caddyBinary = resolve(orchestratorHome, "runtime/caddy/bin/caddy");
const caddyConfigPath = resolve(orchestratorHome, "config/Caddyfile");
const caddyStateDirectory = resolve(orchestratorHome, "state/caddy");
const routesPath = resolve(caddyStateDirectory, "routes.caddy");
const previewRuntimeRoot = resolve(orchestratorHome, "state/previews");

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): Arguments {
  const args = process.argv.slice(2);
  const command = args.shift() as Command | undefined;
  if (!command || !["reconcile", "inspect"].includes(command)) {
    fail("Usage: preview-ingress.ts <reconcile|inspect> [--apply]");
  }
  const unknown = args.filter((argument) => argument !== "--apply");
  if (unknown.length > 0) fail(`Unknown argument: ${unknown[0]}`);
  const apply = args.includes("--apply");
  if (command === "inspect" && apply) fail("inspect does not accept --apply");
  return { command, apply };
}

function assertHostname(hostname: string): void {
  if (
    hostname.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      hostname,
    )
  ) {
    fail(`Unsafe preview hostname: ${hostname}`);
  }
}

function assertPort(port: number, label: string): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    fail(`Invalid ${label} port: ${port}`);
  }
}

function validateRoute(route: IngressRoute): void {
  if (!/^r_[a-zA-Z0-9_]+$/.test(route.run_id)) {
    fail(`Unsafe run ID in preview route: ${route.run_id}`);
  }
  if (!Number.isInteger(route.slot_number) || route.slot_number < 1) {
    fail(`Invalid preview slot: ${route.slot_number}`);
  }
  assertHostname(route.hostname);
  assertHostname(route.assets_hostname);
  assertPort(route.frontend_port, "frontend");
  assertPort(route.backend_port, "backend");
  assertPort(route.minio_api_port, "MinIO API");
  if (!["compose", "static"].includes(route.runtime_adapter)) {
    fail(`Unsafe preview adapter: ${route.runtime_adapter}`);
  }
  if (route.runtime_adapter === "compose" && route.artifact_root !== null) {
    fail("Compose route unexpectedly contains a static artifact root");
  }
  if (route.runtime_adapter === "static") {
    if (
      !route.artifact_root ||
      !isAbsolute(route.artifact_root) ||
      route.artifact_root.includes("..") ||
      !/^\/[a-zA-Z0-9._/-]+$/u.test(route.artifact_root)
    ) {
      fail(`Unsafe static artifact root: ${route.artifact_root ?? "missing"}`);
    }
  }
}

export function renderRoutes(routes: IngressRoute[]): string {
  const seenHosts = new Set<string>();
  const sections: string[] = [
    "# Managed by Kurami Preview Manager. Do not edit while the service is active.",
    "",
    ":9180 {",
    "\tbind 127.0.0.1",
    "",
    "\t# Discord accepts only HTTP(S) link buttons. This narrow launcher",
    "\t# redirects a validated Codex UUID to the desktop-app URI scheme.",
    "\t@codex_deeplink {",
    `\t\thost ${CODEX_DEEPLINK_HOST}`,
    `\t\tpath_regexp codex_thread ^${CODEX_DEEPLINK_PATH_PREFIX}/(${CODEX_THREAD_ID_PATTERN})$`,
    "\t}",
    "\thandle @codex_deeplink {",
    "\t\tredir codex://threads/{re.codex_thread.1} 302",
    "\t}",
    "",
  ];

  for (const route of [...routes].sort(
    (left, right) => left.slot_number - right.slot_number,
  )) {
    validateRoute(route);
    for (const hostname of [route.hostname, route.assets_hostname]) {
      if (seenHosts.has(hostname)) fail(`Duplicate preview hostname: ${hostname}`);
      seenHosts.add(hostname);
    }

    const matcher = `preview_${route.slot_number}`;
    if (route.runtime_adapter === "static") {
      sections.push(
        `\t# ${route.run_id} · static artifact`,
        `\t@${matcher}_static host ${route.hostname} ${route.assets_hostname}`,
        `\thandle @${matcher}_static {`,
        `\t\troot * ${JSON.stringify(route.artifact_root)}`,
        "\t\theader {",
        '\t\t\tX-Content-Type-Options "nosniff"',
        '\t\t\tReferrer-Policy "no-referrer"',
        '\t\t\tCache-Control "no-store"',
        "\t\t}",
        "\t\ttry_files {path} /index.html",
        "\t\tfile_server",
        "\t}",
        "",
      );
    } else {
      sections.push(
        `\t# ${route.run_id}`,
        `\t@${matcher}_frontend host ${route.hostname}`,
        `\thandle @${matcher}_frontend {`,
        `\t\treverse_proxy 127.0.0.1:${route.frontend_port}`,
        "\t}",
        `\t@${matcher}_assets host ${route.assets_hostname}`,
        `\thandle @${matcher}_assets {`,
        `\t\treverse_proxy 127.0.0.1:${route.minio_api_port}`,
        "\t}",
        "",
      );
    }
  }

  sections.push(
    '\thandle {',
    '\t\trespond "Kurami preview ingress: no active route" 404',
    "\t}",
    "}",
    "",
  );
  return sections.join("\n");
}

function activeRoutes(database: DatabaseSync): IngressRoute[] {
  const routes = database
    .prepare(`
      SELECT pl.run_id, ps.slot_number, ps.hostname, ps.assets_hostname,
             ps.frontend_port, ps.backend_port, ps.minio_api_port,
             pl.runtime_adapter, pl.artifact_root
      FROM preview_leases pl
      JOIN preview_slots ps USING (slot_number)
      WHERE pl.state = 'running' AND ps.enabled = 1
      ORDER BY ps.slot_number
    `)
    .all() as IngressRoute[];
  for (const route of routes) {
    if (route.runtime_adapter !== "static") continue;
    const root = resolve(route.artifact_root ?? "");
    const child = relative(previewRuntimeRoot, root);
    if (!child || child.startsWith("..") || resolve(previewRuntimeRoot, child) !== root) {
      fail(`Static artifact root escapes managed runtime: ${route.run_id}`);
    }
  }
  return routes;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function runCaddy(args: string[]): void {
  execFileSync(caddyBinary, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
}

function assertCaddyServiceActive(): void {
  const state = execFileSync(
    "systemctl",
    ["--user", "is-active", "kurami-preview-ingress.service"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 },
  ).trim();
  if (state !== "active") fail(`Caddy preview ingress is not active: ${state}`);
}

async function applyRoutes(rendered: string): Promise<"changed" | "unchanged"> {
  await mkdir(caddyStateDirectory, { recursive: true, mode: 0o700 });
  const previous = await readOptional(routesPath);
  if (previous === rendered) return "unchanged";

  assertCaddyServiceActive();
  const token = randomUUID().replaceAll("-", "");
  const candidatePath = resolve(caddyStateDirectory, `routes.${token}.candidate`);
  const validationPath = resolve(caddyStateDirectory, `validate.${token}.Caddyfile`);
  const rollbackPath = resolve(caddyStateDirectory, `routes.${token}.rollback`);
  const validationConfig = `{
\tadmin 127.0.0.1:2019
\tauto_https off
}

import ${candidatePath}
`;

  try {
    await writeFile(candidatePath, rendered, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await writeFile(validationPath, validationConfig, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    runCaddy(["validate", "--config", validationPath, "--adapter", "caddyfile"]);
    await rename(candidatePath, routesPath);
    await chmod(routesPath, 0o600);
    try {
      runCaddy([
        "reload",
        "--config",
        caddyConfigPath,
        "--adapter",
        "caddyfile",
        "--force",
      ]);
    } catch (reloadError) {
      if (previous === null) {
        await rm(routesPath, { force: true });
      } else {
        await writeFile(rollbackPath, previous, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
        await rename(rollbackPath, routesPath);
        await chmod(routesPath, 0o600);
        try {
          runCaddy([
            "reload",
            "--config",
            caddyConfigPath,
            "--adapter",
            "caddyfile",
            "--force",
          ]);
        } catch (rollbackError) {
          const original = reloadError instanceof Error ? reloadError.message : String(reloadError);
          const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          fail(`Caddy reload failed and rollback reload also failed: ${original}; rollback: ${rollback}`);
        }
      }
      throw reloadError;
    }
    return "changed";
  } finally {
    await rm(candidatePath, { force: true });
    await rm(validationPath, { force: true });
    await rm(rollbackPath, { force: true });
  }
}

export async function runPreviewIngressCli(): Promise<void> {
  const args = parseArguments();
  const config = parse(await readFile(configPath, "utf8")) as OrchestratorConfig;
  if (config.version !== 1) fail("Unsupported orchestrator config version");
  if (args.apply && config.mode !== "live") {
    fail(`Refusing ingress mutation in mode=${config.mode}`);
  }

  const database = openOrchestratorDatabase(databasePath);
  try {
    const routes = activeRoutes(database);
    const rendered = renderRoutes(routes);
    const current = await readOptional(routesPath);
    const view = {
      activeRoutes: routes.length,
      slots: routes.map((route) => route.slot_number),
      hostnames: routes.flatMap((route) => [route.hostname, route.assets_hostname]),
      desiredDigest: digest(rendered),
      currentDigest: current === null ? null : digest(current),
      synchronized: current === rendered,
    };

    if (args.command === "inspect") {
      process.stdout.write(`${JSON.stringify({ ok: true, ...view })}\n`);
      return;
    }
    if (!args.apply) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: false, action: "reconcile", plan: view })}\n`,
      );
      return;
    }
    const action = await applyRoutes(rendered);
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: true, action, ...view, synchronized: true })}\n`,
    );
  } finally {
    database.close();
  }
}

const directEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.main) {
  runPreviewIngressCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
