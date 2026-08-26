import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

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
for (const path of sourceFiles) {
  const content = await readFile(path, "utf8");
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

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    canonicalHome,
    legacyFallbackRetained: true,
    activeRuntimeFiles: runtimeFiles.length,
    compatibilitySources: compatibilitySources.length,
  })}\n`,
);
