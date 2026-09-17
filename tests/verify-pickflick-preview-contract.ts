import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

async function resolvePickflickRepository(): Promise<string> {
  if (process.env.PICKFLICK_PREVIEW_REPOSITORY) {
    return resolve(process.env.PICKFLICK_PREVIEW_REPOSITORY);
  }
  const canonical = "/home/shagon1k/_projects/PickFlick";
  const candidates = [canonical];
  try {
    const worktrees = execFileSync("git", ["-C", canonical, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    candidates.push(
      ...worktrees
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length)),
    );
  } catch {
    // The canonical checkout remains the final candidate and produces a clear error below.
  }
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    try {
      await access(resolve(resolved, "compose.preview.yaml"));
      return resolved;
    } catch {
      // Continue to the next managed worktree candidate.
    }
  }
  throw new Error("PickFlick compose.preview.yaml was not found; set PICKFLICK_PREVIEW_REPOSITORY");
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  const pickflick = await resolvePickflickRepository();
  const [registryText, composeText, adapterText] = await Promise.all([
    readFile(resolve(app, "deploy/config/projects.yaml"), "utf8"),
    readFile(resolve(pickflick, "compose.preview.yaml"), "utf8"),
    readFile(resolve(app, "src/orchestrator/projects/previews/adapters/compose.ts"), "utf8"),
  ]);
  const registry = record(parse(registryText));
  const preview = record(record(record(registry.projects).pickflick).preview);
  assert(preview.adapter === "compose" && preview.compose_file === "compose.preview.yaml", "PickFlick must use its isolated Compose preview file");
  assert(
    preview.secrets_file === "/home/shagon1k/_hermes/_kurami/secrets/pickflick-preview.env",
    "PickFlick preview must load its dedicated private Google OAuth credential file",
  );
  assert(
    Array.isArray(preview.required_secret_keys)
      && preview.required_secret_keys.length === 2
      && preview.required_secret_keys.includes("GOOGLE_CLIENT_ID")
      && preview.required_secret_keys.includes("GOOGLE_CLIENT_SECRET"),
    "PickFlick preview must require its dedicated Google OAuth credentials",
  );
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
  assert(composeText.includes("DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}"), "Preview runtime must require generated DATABASE_URL");
  for (const variable of ["AUTH_BASE_URL", "AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
    assert(composeText.includes(`${variable}: ${"${"}${variable}:?${variable} is required}`), `Preview runtime must require ${variable}`);
  }
  assert(composeText.includes("redis://redis:6379") && composeText.includes("http://minio:9000"), "Private Redis and object-storage URLs must use Compose aliases");
  assert(composeText.includes("RESEND_API_KEY: preview-disabled") && composeText.includes("CONTACT_DELIVERY_TO: contact@example.invalid"), "Preview mail placeholder must be harmless and valid");
  assert(adapterText.includes("SOURCE_REVISION: plan.sourceRevision"), "Adapter must pass exact CI SHA as SOURCE_REVISION");
  assert(adapterText.includes("DATABASE_URL: `postgresql://pickflick:"), "Adapter must generate DATABASE_URL for Compose interpolation");
  assert(adapterText.includes("AUTH_SECRET: randomBytes(48).toString(\"base64url\")"), "Adapter must generate a private preview auth secret");
  assert(!adapterText.includes("GOOGLE_CLIENT_ID: secretValues.GOOGLE_CLIENT_ID"), "Adapter must not inject TailorTales Google credentials generically");
  assert(!adapterText.includes('["leased", "failed"].includes(fresh.lease_state)'), "Failed preview leases must be terminal");

  const temporary = await mkdtemp(resolve(tmpdir(), "kurami-pickflick-preview-contract-"));
  const envPath = resolve(temporary, "runtime.env");
  try {
    await writeFile(
      envPath,
      [
        "SOURCE_REVISION=0123456789abcdef0123456789abcdef01234567",
        "PREVIEW_URL=https://preview-1.shagon1k.win",
        "DATABASE_URL=postgresql://pickflick:***@postgres:5432/pickflick",
        "AUTH_BASE_URL=${PREVIEW_URL}",
        "AUTH_SECRET=preview-auth-secret",
        "GOOGLE_CLIENT_ID=preview-synthetic-google-client-id",
        "GOOGLE_CLIENT_SECRET=preview-synthetic-google-client-secret",
        "POSTGRES_PASSWORD=encoded-password",
        "JWT_SECRET=preview-jwt",
        "E2E_TEST_SECRET=preview-e2e",
        "MINIO_ROOT_USER=preview-minio",
        "MINIO_ROOT_PASSWORD=preview-minio-password",
        "FRONTEND_PORT=43102",
        "BACKEND_PORT=43202",
        "POSTGRES_PORT=45402",
        "REDIS_PORT=46302",
        "MINIO_API_PORT=49102",
        "MINIO_CONSOLE_PORT=49202",
      ].join("\n") + "\n",
      { mode: 0o600 },
    );
    execFileSync("docker", ["compose", "--env-file", envPath, "-f", resolve(pickflick, "compose.preview.yaml"), "config", "-q"], {
      cwd: pickflick,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, staticOnly: true, composeRender: true, services: Object.keys(composeServices).sort() })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
