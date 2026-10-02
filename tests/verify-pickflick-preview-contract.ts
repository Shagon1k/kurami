import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
  writeRuntimeFiles,
  type PreviewConfig,
  type RuntimePlan,
} from "../src/orchestrator/projects/previews/adapters/compose.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "Expected YAML object");
  return value as RecordValue;
}

const fixtureSha = "c867bbcc3d16c63130caa89a2f7e76acefdd08b2";
const app = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === "--repository"),
  "Usage: verify-pickflick-preview-contract.ts [--repository <PickFlick path>]");
const repository = args[1] ?? process.env.PICKFLICK_PREVIEW_REPOSITORY;
const pickflick = resolve(repository ?? resolve(import.meta.dirname, "fixtures/pickflick-preview"));

async function main(): Promise<void> {
  const registry = record(parse(await readFile(resolve(app, "deploy/config/projects.yaml"), "utf8")));
  const preview = record(record(record(registry.projects).pickflick).preview) as PreviewConfig;
  assert(preview.adapter === "compose" && preview.compose_file === "compose.preview.yaml", "PickFlick must use its isolated Compose preview file");
  assert(preview.required_secret_keys?.length === 2
    && preview.required_secret_keys.includes("GOOGLE_CLIENT_ID")
    && preview.required_secret_keys.includes("GOOGLE_CLIENT_SECRET"),
  "PickFlick must require dedicated Google OAuth credentials");
  assert(preview.health.frontend.path === "/" && preview.health.backend.path === "/health/ready"
    && preview.health.minio.path === "/minio/health/live", "Allocated-port health paths must match the contract");

  const composeFile = resolve(pickflick, preview.compose_file);
  const composeText = await readFile(composeFile, "utf8");
  const compose = record(parse(composeText, { merge: true }));
  const services = record(compose.services);
  assert(!("name" in compose) && !("networks" in compose), "Preview must use its isolated default network");
  // Rendering must never read a repository's private env files or included config.
  assert(!("include" in compose) && !("secrets" in compose) && !("configs" in compose), "Fixture must be self-contained");
  for (const [name, value] of Object.entries(services)) {
    const service = record(value);
    assert(!("env_file" in service) && !("extends" in service), `${name} must not read external config`);
  }
  for (const name of ["release", "backend", "frontend"]) {
    const build = record(record(services[name]).build);
    assert(build.context === "." && build.dockerfile === "Dockerfile", `${name} must build from Dockerfile`);
  }
  assert(record(record(services.backend).environment).APP_ENV === "uat", "Backend must use APP_ENV=uat");
  assert(record(record(services.release).environment).APP_ENV === "uat", "Release must use APP_ENV=uat");

  const temporary = await mkdtemp(resolve(tmpdir(), "kurami-pickflick-preview-contract-"));
  try {
    const secretsFile = resolve(temporary, "synthetic-credentials.env");
    await writeFile(secretsFile, "GOOGLE_CLIENT_ID=synthetic-client-id\nGOOGLE_CLIENT_SECRET=synthetic-client-secret\n", { mode: 0o600 });
    const runtimeDirectory = resolve(temporary, "runtime");
    const plan: RuntimePlan = {
      runId: "r_contract_fixture", project: "pickflick", issueNumber: 33,
      leaseState: "leased", slotNumber: 1,
      previewUrl: "https://preview-1.example.invalid", assetsUrl: "https://assets-preview-1.example.invalid",
      composeProjectName: "kurami-contract-fixture", worktreePath: pickflick,
      composeFile, runtimeDirectory,
      runtimeEnvPath: resolve(runtimeDirectory, "runtime.env"),
      overridePath: resolve(runtimeDirectory, "compose.preview.yaml"),
      sourceComposePath: resolve(runtimeDirectory, "source.compose.yaml"), sourceRevision: fixtureSha,
      ports: { frontend: 43101, backend: 43201, postgres: 45401, redis: 46301, minioApi: 49101, minioConsole: 49201 },
    };
    // This is the production writer, with only a disposable credential-file substitution.
    await writeRuntimeFiles(plan, { ...preview, secrets_file: secretsFile });
    const envText = await readFile(plan.runtimeEnvPath, "utf8");
    const values: Record<string, string> = Object.fromEntries(envText.trim().split("\n").map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), JSON.parse(line.slice(split + 1)) as string];
    }));
    for (const [key, port] of Object.entries({
      PREVIEW_FRONTEND_PORT: plan.ports.frontend, FRONTEND_PORT: plan.ports.frontend,
      PREVIEW_BACKEND_PORT: plan.ports.backend, BACKEND_PORT: plan.ports.backend,
      POSTGRES_PORT: plan.ports.postgres, REDIS_PORT: plan.ports.redis,
      MINIO_API_PORT: plan.ports.minioApi, MINIO_CONSOLE_PORT: plan.ports.minioConsole,
    })) assert(values[key] === String(port), `${key} must match the allocated slot port`);
    const requiredKeys = [...new Set([...composeText.replace(/\$\$/g, "").matchAll(/\$\{([A-Z][A-Z0-9_]*):?\?/g)].map((match) => match[1]))].sort();
    for (const key of requiredKeys) assert(Boolean(values[key]), `Adapter/config must provide required interpolation key: ${key}`);
    assert(values.SOURCE_REVISION === fixtureSha, "Adapter must preserve exact source revision");
    assert(values.GOOGLE_CLIENT_ID === "synthetic-client-id" && values.GOOGLE_CLIENT_SECRET === "synthetic-client-secret", "Use only synthetic project credentials");
    assert(await readFile(plan.sourceComposePath, "utf8") === composeText, "Cleanup snapshot must preserve the source Compose contract");
    assert(await readFile(plan.overridePath, "utf8") === "services: {}\n", "Self-contained contract needs no exposure override");
    for (const path of [plan.runtimeEnvPath, plan.overridePath, plan.sourceComposePath]) {
      assert(((await stat(path)).mode & 0o777) === 0o600, "Runtime files must retain private permissions");
    }
    assert(((await stat(runtimeDirectory)).mode & 0o777) === 0o700, "Runtime directory must retain private permissions");

    // No inherited interpolation variables, default .env, Docker config, or daemon access.
    const renderEnv = { PATH: process.env.PATH, DOCKER_CONFIG: temporary, COMPOSE_DISABLE_ENV_FILE: "true" };
    function config(file: string, envPath = plan.runtimeEnvPath, quiet = false) {
      return spawnSync("docker", ["compose", "--project-directory", temporary,
        "--env-file", envPath, "-f", file, "-f", plan.overridePath,
        "-p", plan.composeProjectName, "config", ...(quiet ? ["-q"] : ["--format", "json"])],
      { cwd: temporary, env: renderEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
    }
    function rendered(file: string, envPath = plan.runtimeEnvPath): RecordValue {
      const result = config(file, envPath);
      assert(result.status === 0, "docker compose config render failed (output withheld)");
      return record(JSON.parse(result.stdout));
    }
    function exposures(render: RecordValue): string[] {
      return Object.entries(record(render.services)).flatMap(([name, value]) => {
        const ports = record(value).ports ?? [];
        assert(Array.isArray(ports), `${name} ports must be an array`);
        return ports.map((value: unknown) => {
          const port = record(value);
          return `${name}:${port.host_ip}:${port.published}:${port.target}:${port.protocol}`;
        });
      }).sort();
    }
    const expectedExposures = [
      `frontend:127.0.0.1:${plan.ports.frontend}:3000:tcp`,
      `backend:127.0.0.1:${plan.ports.backend}:3001:tcp`,
      `postgres:127.0.0.1:${plan.ports.postgres}:5432:tcp`,
      `minio:127.0.0.1:${plan.ports.minioApi}:9000:tcp`,
      `minio:127.0.0.1:${plan.ports.minioConsole}:9001:tcp`,
    ].sort();
    for (const file of [composeFile, plan.sourceComposePath]) {
      assert(config(file, plan.runtimeEnvPath, true).status === 0, "docker compose config -q must accept adapter-generated env (output withheld)");
      const render = rendered(file);
      assert(JSON.stringify(exposures(render)) === JSON.stringify(expectedExposures), "Published ports must match the slot exactly and remain loopback-only");
      const backend = record(record(record(render.services).backend).environment);
      assert(String(backend.BACKEND_PORT) === "3001", "Backend container port must remain 3001");
      assert(backend.AUTH_BASE_URL === plan.previewUrl, "Configured AUTH_BASE_URL must expand to the preview URL");
    }

    // Prove older Compose consumers still get every allocated port from this same env.
    const legacyFile = resolve(temporary, "legacy.compose.yaml");
    await writeFile(legacyFile, "services:\n  legacy:\n    image: synthetic-unused\n    ports:\n" + Object.keys({ FRONTEND_PORT: 0, BACKEND_PORT: 0, POSTGRES_PORT: 0, REDIS_PORT: 0, MINIO_API_PORT: 0, MINIO_CONSOLE_PORT: 0 }).map((key, index) =>
      `      - '127.0.0.1:\u0024{${key}:?required}:${3000 + index}'`).join("\n") + "\n");
    const legacy = exposures(rendered(legacyFile));
    const legacyPorts = [plan.ports.frontend, plan.ports.backend, plan.ports.postgres, plan.ports.redis, plan.ports.minioApi, plan.ports.minioConsole];
    assert(JSON.stringify(legacy) === JSON.stringify(legacyPorts.map((port, index) => `legacy:127.0.0.1:${port}:${3000 + index}:tcp`).sort()), "Legacy aliases must retain all allocated ports");

    for (const key of ["PREVIEW_FRONTEND_PORT", "PREVIEW_BACKEND_PORT"]) {
      const missingPath = resolve(temporary, `missing-${key}.env`);
      await writeFile(missingPath, envText.split("\n").filter((line) => !line.startsWith(`${key}=`)).join("\n"), { mode: 0o600 });
      const missing = config(composeFile, missingPath, true);
      assert(missing.status !== null && missing.status !== 0 && missing.stderr.includes(key), `Missing ${key} must fail despite the legacy alias`);
      const wrongPath = resolve(temporary, `wrong-${key}.env`);
      await writeFile(wrongPath, envText.replace(`${key}=${JSON.stringify(values[key])}`, `${key}="49999"`), { mode: 0o600 });
      assert(config(composeFile, wrongPath, true).status === 0, "A valid but wrong port demonstrates why config -q alone is insufficient");
      assert(JSON.stringify(exposures(rendered(composeFile, wrongPath))) !== JSON.stringify(expectedExposures), `Exposure check must detect wrong ${key}`);
    }
    // The adapter probes allocated ports/paths; these names are currently metadata only.
    const healthServiceNameDrift = Object.entries(preview.health).filter(([, health]) => !(health.service in services))
      .map(([role, health]) => `${role}:${health.service}`);
    process.stdout.write(`${JSON.stringify({ ok: true, staticOnly: true, composeRender: true,
      source: repository ? "explicit-repository" : "checked-in-fixture", fixtureSha,
      requiredKeys, allocatedPorts: plan.ports, healthServiceNameDrift })}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
