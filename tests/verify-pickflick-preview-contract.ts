import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "Expected YAML object");
  return value as RecordValue;
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const pickflick = resolve(
    process.env.PICKFLICK_PREVIEW_REPOSITORY ??
      "/home/shagon1k/_projects/.worktrees/pickflick/PF-17_2-1-implement-projector-noir-tokens/PickFlick",
  );
  const [registryText, composeText, adapterText] = await Promise.all([
    readFile(resolve(app, "deploy/config/projects.yaml"), "utf8"),
    readFile(resolve(pickflick, "compose.preview.yaml"), "utf8"),
    readFile(resolve(app, "src/orchestrator/projects/previews/adapters/compose.ts"), "utf8"),
  ]);
  const registry = record(parse(registryText));
  const preview = record(record(record(registry.projects).pickflick).preview);
  assert(preview.adapter === "compose" && preview.compose_file === "compose.preview.yaml", "PickFlick must use its isolated Compose preview file");
  assert(Array.isArray(preview.required_secret_keys) && preview.required_secret_keys.length === 0, "PickFlick preview must not require TailorTales credentials");
  const services = record(preview.services);
  for (const service of ["postgres", "redis", "minio", "minio_init", "release", "api", "worker", "web"]) {
    assert(typeof services[service] === "string", `Missing declarative PickFlick service role: ${service}`);
  }
  const health = record(preview.health);
  assert(record(health.backend).path === "/health/ready", "PickFlick API readiness must be /health/ready");
  assert(record(health.frontend).path === "/", "PickFlick web readiness must be /");
  assert(record(health.minio).path === "/minio/health/live", "PickFlick MinIO readiness must be declared");

  const compose = record(parse(composeText));
  assert(!("name" in compose) && !("networks" in compose), "Preview Compose must use its isolated default network");
  const composeServices = record(compose.services);
  for (const service of ["postgres", "redis", "minio", "minio-init", "release", "api", "worker", "web"]) {
    assert(service in composeServices, `Missing preview Compose service: ${service}`);
  }
  for (const service of ["release", "api", "worker", "web"]) {
    const build = record(record(composeServices[service]).build);
    assert((build.context === "." && build.dockerfile === "Dockerfile") || composeText.includes("x-build: &build\n  context: .\n  dockerfile: Dockerfile"), `${service} must build from Dockerfile`);
  }
  assert(composeText.includes("SOURCE_REVISION: ${SOURCE_REVISION:?SOURCE_REVISION must be the exact CI SHA}"), "Preview build must require SOURCE_REVISION");
  assert(composeText.includes("x-runtime-environment: &runtime-environment\n  APP_ENV: uat"), "API and worker runtime environment must use APP_ENV=uat");
  assert(record(record(composeServices.release).environment).APP_ENV === "uat", "release must run with APP_ENV=uat");
  for (const variable of ["FRONTEND_PORT", "BACKEND_PORT", "POSTGRES_PORT", "REDIS_PORT", "MINIO_API_PORT", "MINIO_CONSOLE_PORT"]) {
    assert(composeText.includes(`127.0.0.1:${"${"}${variable}`), `Preview port must be loopback-mapped from ${variable}`);
  }
  assert(composeText.includes("@postgres:5432") && composeText.includes("redis://redis:6379") && composeText.includes("http://minio:9000"), "Private dependency URLs must use Compose aliases");
  assert(composeText.includes("preview-not-a-secret") && composeText.includes("preview@example.invalid"), "Preview mail placeholder must be harmless and valid");
  assert(adapterText.includes("SOURCE_REVISION: plan.sourceRevision"), "Adapter must pass exact CI SHA as SOURCE_REVISION");
  assert(!adapterText.includes("GOOGLE_CLIENT_ID: secretValues.GOOGLE_CLIENT_ID"), "Adapter must not inject TailorTales Google credentials generically");
  assert(!adapterText.includes('["leased", "failed"].includes(fresh.lease_state)'), "Failed preview leases must be terminal");
  process.stdout.write(`${JSON.stringify({ ok: true, staticOnly: true, services: Object.keys(composeServices).sort() })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
