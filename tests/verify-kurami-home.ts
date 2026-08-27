import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const canonicalHome = "/home/shagon1k/_hermes/_kurami";
const legacyHome = "/home/shagon1k/_hermes/_orchestrator";

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const runtimeFiles = [
  ...await filesBelow(resolve(root, "src")),
  ...await filesBelow(resolve(root, "bin")),
  ...await filesBelow(resolve(root, "deploy")),
  ...await filesBelow(resolve(root, "integrations/hermes/scripts")),
  resolve(root, "run-project-poller.sh"),
  resolve(root, "run-projects-digest.sh"),
].filter((path) => [".ts", ".sh", ".yaml", ".yml", ".service", ""].includes(extname(path)));

const entrypointConsumerFiles = [
  resolve(root, "package.json"),
  resolve(root, "run-project-poller.sh"),
  resolve(root, "run-projects-digest.sh"),
  ...await filesBelow(resolve(root, "deploy")),
  ...await filesBelow(resolve(root, "integrations/hermes/scripts")),
  ...await filesBelow(resolve(root, "integrations/hermes/plugins")),
  ...await filesBelow(resolve(root, "integrations/hermes/skills")),
].filter((path) =>
  [".json", ".sh", ".py", ".md", ".yaml", ".yml", ".service", ""].includes(
    extname(path),
  )
);

for (const path of entrypointConsumerFiles) {
  const content = await readFile(path, "utf8");
  const legacyEntrypoints = content.match(/(?:app\/)?src\/[a-z0-9-]+\.ts/gu) ?? [];
  assert.deepEqual(
    legacyEntrypoints,
    [],
    `Runtime consumer still uses a root compatibility entrypoint: ${path}`,
  );
}

const legacyEnvironmentTestFiles = new Set([
  resolve(root, "tests/verify-discord-plugin.py"),
  resolve(root, "tests/verify-kurami-home.ts"),
  resolve(root, "tests/verify-worktree-provision.ts"),
]);
const testFiles = (await filesBelow(resolve(root, "tests"))).filter((path) =>
  [".ts", ".py"].includes(extname(path))
);
for (const path of testFiles) {
  if (legacyEnvironmentTestFiles.has(path)) continue;
  const content = await readFile(path, "utf8");
  assert(
    !content.includes("ORCHESTRATOR_HOME"),
    `Ordinary regression test still uses the legacy environment: ${path}`,
  );
}

const canonicalOperatorFiles = [
  resolve(root, "docs/technical-reference.md"),
  resolve(root, "docs/recovery.md"),
  resolve(root, "integrations/hermes/skills/kurami-run-control/SKILL.md"),
  resolve(root, "integrations/hermes/skills/kurami-project-readiness/SKILL.md"),
];
for (const path of canonicalOperatorFiles) {
  const content = await readFile(path, "utf8");
  assert(
    !content.includes("ORCHESTRATOR_HOME"),
    `Operator documentation still recommends the legacy environment: ${path}`,
  );
  const legacyCommands = content.match(/node src\/[a-z0-9-]+\.ts/gu) ?? [];
  assert.deepEqual(
    legacyCommands,
    [],
    `Operator documentation still recommends a root compatibility CLI: ${path}`,
  );
}

for (const path of runtimeFiles) {
  const content = await readFile(path, "utf8");
  assert(
    !content.includes(legacyHome),
    `Active runtime file still hardcodes the legacy home: ${path}`,
  );
}

const sourceFiles = (await filesBelow(resolve(root, "src"))).filter(
  (path) => extname(path) === ".ts",
);
const compatibilitySources: string[] = [];
const directEntries: string[] = [];
for (const path of sourceFiles) {
  const content = await readFile(path, "utf8");
  if (content.includes("import.meta.main")) directEntries.push(path);
  assert(
    !/if\s*\([^)]*import\.meta\.url/u.test(content),
    `Symlink-sensitive direct-entry guard remains: ${path}`,
  );
  if (!content.includes("process.env.ORCHESTRATOR_HOME")) continue;
  assert(
    content.includes("process.env.KURAMI_HOME"),
    `TypeScript source lost KURAMI_HOME precedence: ${path}`,
  );
  compatibilitySources.push(path);
}

for (const relative of [
  "run-project-poller.sh",
  "run-projects-digest.sh",
  "integrations/hermes/scripts/kurami-runtime-health.sh",
  "integrations/hermes/scripts/kurami-network-speed.sh",
  "integrations/hermes/scripts/kurami-orchestrator-state-backup.sh",
]) {
  const content = await readFile(resolve(root, relative), "utf8");
  assert(content.includes(`KURAMI_HOME="${canonicalHome}"`));
  assert(content.includes('export ORCHESTRATOR_HOME="${KURAMI_HOME}"'));
}

const service = await readFile(
  resolve(root, "deploy/systemd/kurami-preview-ingress.service"),
  "utf8",
);
assert(service.includes(canonicalHome));
assert(!service.includes(legacyHome));

const smokeRoot = await mkdtemp(join(tmpdir(), "kurami-home-smoke-"));
const appAlias = resolve(smokeRoot, "app");
try {
  await symlink(root, appAlias, "dir");
  const smoke = spawnSync(
    process.execPath,
    [
      resolve(appAlias, "src/project-readiness.ts"),
      "--config-dir",
      resolve(appAlias, "deploy/config"),
      "--project",
      "tailortales",
      "--json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(smoke.status, 0, smoke.stderr);
  const result = JSON.parse(smoke.stdout) as { ok?: unknown; summary?: { fail?: unknown } };
  assert.equal(result.ok, true);
  assert.equal(result.summary?.fail, 0);
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    canonicalHome,
    legacyFallbackRetained: true,
    activeRuntimeFiles: runtimeFiles.length,
    compatibilitySources: compatibilitySources.length,
    symlinkSafeDirectEntries: directEntries.length,
    canonicalEntrypointConsumers: entrypointConsumerFiles.length,
    canonicalOperatorFiles: canonicalOperatorFiles.length,
    canonicalEnvironmentTests: testFiles.length - legacyEnvironmentTestFiles.size,
    symlinkCliSmoke: true,
  })}\n`,
);
