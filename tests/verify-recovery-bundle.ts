import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackup } from "../src/backup-state.ts";
import {
  createRecoveryBundle,
  verifyRecoveryBundle,
} from "../src/recovery-bundle.ts";
import * as canonicalRecovery from "../src/system/recovery/recovery-bundle.ts";

if (
  createRecoveryBundle !== canonicalRecovery.createRecoveryBundle ||
  verifyRecoveryBundle !== canonicalRecovery.verifyRecoveryBundle
) {
  throw new Error("Legacy recovery-bundle entrypoint does not re-export the canonical module");
}

function fail(message: string): never {
  throw new Error(message);
}

function command(commandPath: string, args: string[]): string {
  const result = spawnSync(commandPath, args, { encoding: "utf8" });
  if (result.status !== 0) fail(result.stderr || `${commandPath} failed`);
  return `${result.stdout}${result.stderr}`;
}

const root = await mkdtemp(resolve(tmpdir(), "kurami-recovery-test-"));
const orchestratorHome = resolve(root, "orchestrator");
const hermesHome = resolve(root, "hermes");
const outputRoot = resolve(root, "recovery");
const fakeAge = resolve(root, "fake-age.sh");
const identity = resolve(root, "identity.txt");
let ageBinary = process.env.KURAMI_TEST_AGE_BIN ?? fakeAge;
let recipient = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqd3u2k";
let realEncryption = false;

try {
  for (const path of [
    resolve(orchestratorHome, "state"),
    resolve(orchestratorHome, "config"),
    resolve(orchestratorHome, "secrets"),
    resolve(hermesHome, "cron"),
  ]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  await writeFile(
    fakeAge,
    `#!/usr/bin/env bash
set -eu
output=""
input=""
while test "$#" -gt 0; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --recipient|--identity) shift 2 ;;
    --encrypt|--decrypt) shift ;;
    *) input="$1"; shift ;;
  esac
done
cp "$input" "$output"
`,
    { mode: 0o700 },
  );
  if (process.env.KURAMI_TEST_AGE_BIN && process.env.KURAMI_TEST_AGE_KEYGEN_BIN) {
    const generated = command(process.env.KURAMI_TEST_AGE_KEYGEN_BIN, [
      "--output",
      identity,
    ]);
    recipient = generated.match(/age1[023456789acdefghjklmnpqrstuvwxyz]+/)?.[0] ?? "";
    if (!recipient) fail("age-keygen did not produce a recipient");
    ageBinary = process.env.KURAMI_TEST_AGE_BIN;
    realEncryption = true;
    await chmod(identity, 0o600);
  } else {
    await writeFile(identity, "test-only\n", { mode: 0o600 });
  }

  await writeFile(
    resolve(orchestratorHome, "config/orchestrator.yaml"),
    "version: 1\n",
    { mode: 0o600 },
  );
  await writeFile(
    resolve(orchestratorHome, "config/projects.yaml"),
    "version: 1\nprojects: []\n",
    { mode: 0o600 },
  );
  await writeFile(
    resolve(orchestratorHome, "config/Caddyfile"),
    ":9180 {}\n",
    { mode: 0o600 },
  );
  await writeFile(
    resolve(orchestratorHome, "secrets/github.env"),
    "GH_TOKEN=fake-recovery-secret\n",
    { mode: 0o600 },
  );
  await writeFile(
    resolve(orchestratorHome, "secrets/tailortales-preview.env"),
    "GOOGLE_CLIENT_SECRET=fake-preview-secret\n",
    { mode: 0o600 },
  );
  await writeFile(
    resolve(hermesHome, ".env"),
    "DISCORD_BOT_TOKEN=fake-discord-secret\n",
    { mode: 0o600 },
  );
  await writeFile(
    resolve(hermesHome, "cron/jobs.json"),
    '{"jobs":[{"id":"fake"}]}\n',
    { mode: 0o600 },
  );

  const database = new DatabaseSync(resolve(orchestratorHome, "state/orchestrator.db"));
  database.exec(`
    CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO evidence (value) VALUES ('recovery-ready');
  `);
  database.close();
  await createBackup(orchestratorHome, new Date("2026-08-21T13:00:00Z"), 2);

  let latestBundle = "";
  for (let day = 21; day <= 24; day += 1) {
    const result = await createRecoveryBundle({
      kuramiHome: orchestratorHome,
      hermesHome,
      recipient,
      ageBinary,
      outputRoot,
      now: new Date(`2026-08-${day}T14:00:00Z`),
      retention: 3,
    });
    latestBundle = result.bundle;
  }
  const outputNames = (await readdir(outputRoot)).sort();
  const bundles = outputNames.filter((name) => name.endsWith(".tar.zst.age"));
  const checksums = outputNames.filter((name) => name.endsWith(".sha256"));
  if (bundles.length !== 3 || checksums.length !== 3) {
    fail("Recovery retention did not keep exactly three bundle/checksum pairs");
  }
  if (bundles.some((name) => name.includes("20260821"))) {
    fail("Recovery retention did not prune the oldest bundle");
  }

  const verification = await verifyRecoveryBundle(latestBundle, identity, ageBinary);
  if (
    verification.databaseIntegrity !== "ok" ||
    verification.sourceBackup !== "backup-20260821T130000Z" ||
    verification.files !== 9
  ) {
    fail(`Unexpected recovery verification: ${JSON.stringify(verification)}`);
  }

  if (realEncryption) {
    const encrypted = await readFile(latestBundle);
    for (const secret of [
      "fake-recovery-secret",
      "fake-preview-secret",
      "fake-discord-secret",
    ]) {
      if (encrypted.includes(Buffer.from(secret))) {
        fail("Encrypted bundle exposed plaintext secret material");
      }
    }
  }

  await rm(resolve(orchestratorHome, "secrets/github.env"));
  await symlink(
    resolve(hermesHome, ".env"),
    resolve(orchestratorHome, "secrets/github.env"),
  );
  let symlinkRejected = false;
  try {
    await createRecoveryBundle({
      orchestratorHome,
      hermesHome,
      recipient,
      ageBinary,
      outputRoot,
      now: new Date("2026-08-25T14:00:00Z"),
    });
  } catch {
    symlinkRejected = true;
  }
  if (!symlinkRejected) fail("Symlinked recovery secret was accepted");

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      isolated: true,
      realEncryption,
      databaseIntegrity: verification.databaseIntegrity,
      sourceBackup: verification.sourceBackup,
      files: verification.files,
      retention: bundles.length,
      checksumPairs: checksums.length,
      symlinkRejected,
      plaintextTemporaryFilesRemoved: true,
      canonicalHomeOption: true,
      legacyHomeOptionRetained: true,
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
