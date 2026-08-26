import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

process.umask(0o077);

type BackupManifestFile = {
  name: string;
  bytes: number;
  sha256: string;
};

type BackupManifest = {
  version: 1;
  createdAt: string;
  databaseIntegrity: "ok";
  files: BackupManifestFile[];
  secretsIncluded: false;
};

type RecoveryFile = {
  path: string;
  bytes: number;
  sha256: string;
};

type RecoveryManifest = {
  version: 1;
  createdAt: string;
  sourceBackup: string;
  encryption: "age-x25519";
  files: RecoveryFile[];
};

export type RecoveryBundleResult = {
  ok: true;
  action: "created";
  bundle: string;
  checksum: string;
  sourceBackup: string;
  files: number;
  retained: number;
  pruned: string[];
};

export type RecoveryBundleVerification = {
  ok: true;
  action: "verified";
  bundle: string;
  sourceBackup: string;
  databaseIntegrity: "ok";
  files: number;
};

export type RecoveryBundleOptions = {
  orchestratorHome: string;
  hermesHome: string;
  recipient: string;
  ageBinary?: string;
  outputRoot?: string;
  now?: Date;
  retention?: number;
};

const backupNamePattern = /^backup-\d{8}T\d{6}Z$/;
const bundleNamePattern = /^kurami-recovery-\d{8}T\d{6}Z\.tar\.zst\.age$/;
const ageRecipientPattern = /^age1[023456789acdefghjklmnpqrstuvwxyz]{20,}$/;
const defaultRetention = 3;

function fail(message: string): never {
  throw new Error(message);
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail(
      result.stderr?.trim() ||
        result.stdout?.trim() ||
        `${command} failed with status ${result.status}`,
    );
  }
  return result.stdout;
}

function parseRetention(value: number | undefined): number {
  const retention = value ?? defaultRetention;
  if (!Number.isInteger(retention) || retention < 2 || retention > 30) {
    fail("Recovery bundle retention must be an integer between 2 and 30");
  }
  return retention;
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function fileDigest(path: string, archivePath: string): Promise<RecoveryFile> {
  const content = await readFile(path);
  return {
    path: archivePath,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function requirePrivateFile(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`Recovery source must be a regular non-symlink file: ${path}`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    fail(`Recovery source permissions are too broad: ${path}`);
  }
}

async function copyPrivateFile(
  source: string,
  destination: string,
  archivePath: string,
): Promise<RecoveryFile> {
  await requirePrivateFile(source);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  await chmod(destination, 0o600);
  return fileDigest(destination, archivePath);
}

function parseBackupManifest(content: string, source: string): BackupManifest {
  let candidate: unknown;
  try {
    candidate = JSON.parse(content);
  } catch {
    fail(`Backup manifest is not valid JSON: ${source}`);
  }
  if (!candidate || typeof candidate !== "object") {
    fail(`Backup manifest is invalid: ${source}`);
  }
  const manifest = candidate as Partial<BackupManifest>;
  if (
    manifest.version !== 1 ||
    manifest.databaseIntegrity !== "ok" ||
    manifest.secretsIncluded !== false ||
    !Array.isArray(manifest.files) ||
    manifest.files.length < 1
  ) {
    fail(`Backup manifest safety evidence is invalid: ${source}`);
  }
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.name !== "string" ||
      basename(file.name) !== file.name ||
      !/^[A-Za-z0-9_.-]+$/.test(file.name) ||
      !Number.isInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      fail(`Backup manifest contains an unsafe file entry: ${source}`);
    }
  }
  return manifest as BackupManifest;
}

function assertDatabaseIntegrity(path: string): void {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database.prepare("PRAGMA quick_check").get() as {
      quick_check: string;
    };
    if (row.quick_check !== "ok") {
      fail(`Recovery snapshot SQLite quick_check failed: ${row.quick_check}`);
    }
  } finally {
    database.close();
  }
}

async function latestBackup(orchestratorHome: string): Promise<string> {
  const backupRoot = resolve(orchestratorHome, "backups");
  const names = (await readdir(backupRoot, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        backupNamePattern.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (!names[0]) fail("No verified state backup is available");
  return resolve(backupRoot, names[0]);
}

async function copyVerifiedSnapshot(
  backupDirectory: string,
  stageDirectory: string,
): Promise<RecoveryFile[]> {
  const manifestPath = resolve(backupDirectory, "manifest.json");
  await requirePrivateFile(manifestPath);
  const manifest = parseBackupManifest(
    await readFile(manifestPath, "utf8"),
    manifestPath,
  );
  const copied: RecoveryFile[] = [];
  for (const expected of manifest.files) {
    const source = resolve(backupDirectory, expected.name);
    const archivePath = `snapshot/${expected.name}`;
    const destination = resolve(stageDirectory, archivePath);
    const evidence = await copyPrivateFile(source, destination, archivePath);
    if (evidence.bytes !== expected.bytes || evidence.sha256 !== expected.sha256) {
      fail(`Backup file does not match its manifest: ${expected.name}`);
    }
    copied.push(evidence);
  }
  const database = copied.find((file) => file.path === "snapshot/orchestrator.db");
  if (!database) fail("Backup manifest does not contain orchestrator.db");
  assertDatabaseIntegrity(resolve(stageDirectory, database.path));
  copied.push(
    await copyPrivateFile(
      manifestPath,
      resolve(stageDirectory, "snapshot/manifest.json"),
      "snapshot/manifest.json",
    ),
  );
  return copied;
}

async function createPlaintextStage(
  orchestratorHome: string,
  hermesHome: string,
  backupDirectory: string,
  stageDirectory: string,
  now: Date,
): Promise<RecoveryManifest> {
  await mkdir(stageDirectory, { recursive: false, mode: 0o700 });
  const files = await copyVerifiedSnapshot(backupDirectory, stageDirectory);
  const sources = [
    { source: resolve(hermesHome, ".env"), archivePath: "secrets/hermes.env" },
    {
      source: resolve(orchestratorHome, "secrets/github.env"),
      archivePath: "secrets/github.env",
    },
    {
      source: resolve(orchestratorHome, "secrets/tailortales-preview.env"),
      archivePath: "secrets/tailortales-preview.env",
    },
    {
      source: resolve(hermesHome, "cron/jobs.json"),
      archivePath: "hermes/cron/jobs.json",
    },
  ];
  for (const source of sources) {
    files.push(
      await copyPrivateFile(
        source.source,
        resolve(stageDirectory, source.archivePath),
        source.archivePath,
      ),
    );
  }
  const manifest: RecoveryManifest = {
    version: 1,
    createdAt: now.toISOString(),
    sourceBackup: basename(backupDirectory),
    encryption: "age-x25519",
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
  await writeFile(
    resolve(stageDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  return manifest;
}

async function pruneBundles(outputRoot: string, keep: number): Promise<string[]> {
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const names = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        bundleNamePattern.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const pruned: string[] = [];
  for (const name of names.slice(keep)) {
    const bundle = resolve(outputRoot, name);
    const checksum = `${bundle}.sha256`;
    await requirePrivateFile(bundle);
    await rm(bundle, { force: false });
    try {
      await requirePrivateFile(checksum);
      await rm(checksum, { force: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    pruned.push(name);
  }
  return pruned;
}

export async function createRecoveryBundle(
  options: RecoveryBundleOptions,
): Promise<RecoveryBundleResult> {
  if (!ageRecipientPattern.test(options.recipient)) {
    fail("KURAMI_RECOVERY_RECIPIENT must be a valid age X25519 recipient");
  }
  const orchestratorHome = resolve(options.orchestratorHome);
  const hermesHome = resolve(options.hermesHome);
  const outputRoot = resolve(
    options.outputRoot ?? resolve(orchestratorHome, "recovery"),
  );
  const ageBinary = resolve(
    options.ageBinary ?? resolve(orchestratorHome, "runtime/age/bin/age"),
  );
  const now = options.now ?? new Date();
  const retention = parseRetention(options.retention);
  const backupDirectory = await latestBackup(orchestratorHome);
  const name = `kurami-recovery-${timestamp(now)}`;
  const bundleName = `${name}.tar.zst.age`;
  if (!bundleNamePattern.test(bundleName)) fail(`Unsafe bundle name: ${bundleName}`);

  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "kurami-recovery-"));
  const stageDirectory = resolve(temporaryRoot, name);
  const plaintextArchive = resolve(temporaryRoot, `${name}.tar.zst`);
  const encryptedTemporary = resolve(temporaryRoot, bundleName);
  const finalBundle = resolve(outputRoot, bundleName);
  const finalChecksum = `${finalBundle}.sha256`;

  for (const destination of [finalBundle, finalChecksum]) {
    try {
      await lstat(destination);
      fail(`Refusing to overwrite existing recovery output: ${destination}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  try {
    const manifest = await createPlaintextStage(
      orchestratorHome,
      hermesHome,
      backupDirectory,
      stageDirectory,
      now,
    );
    run("tar", ["--zstd", "-C", temporaryRoot, "-cf", plaintextArchive, name]);
    run(ageBinary, [
      "--encrypt",
      "--recipient",
      options.recipient,
      "--output",
      encryptedTemporary,
      plaintextArchive,
    ]);
    await chmod(encryptedTemporary, 0o600);
    const checksum = createHash("sha256")
      .update(await readFile(encryptedTemporary))
      .digest("hex");
    const checksumTemporary = resolve(temporaryRoot, `${bundleName}.sha256`);
    await writeFile(checksumTemporary, `${checksum}  ${bundleName}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(encryptedTemporary, finalBundle);
    await rename(checksumTemporary, finalChecksum);
    const pruned = await pruneBundles(outputRoot, retention);
    const retained = (await readdir(outputRoot)).filter((entry) =>
      bundleNamePattern.test(entry),
    ).length;
    return {
      ok: true,
      action: "created",
      bundle: finalBundle,
      checksum,
      sourceBackup: manifest.sourceBackup,
      files: manifest.files.length,
      retained,
      pruned,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function archiveEntries(archive: string): Promise<string[]> {
  const entries = run("tar", ["--zstd", "-tf", archive])
    .split("\n")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (entries.length === 0) fail("Recovery archive is empty");
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      fail(`Recovery archive contains an unsafe path: ${entry}`);
    }
  }
  return entries;
}

async function actualFiles(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    if (entry.isSymbolicLink()) fail(`Recovery archive contains a symlink: ${path}`);
    if (entry.isDirectory()) {
      result.push(...(await actualFiles(root, path)));
    } else if (entry.isFile()) {
      result.push(relative(root, path));
    } else {
      fail(`Recovery archive contains a non-regular entry: ${path}`);
    }
  }
  return result.sort();
}

function parseRecoveryManifest(content: string): RecoveryManifest {
  let candidate: unknown;
  try {
    candidate = JSON.parse(content);
  } catch {
    fail("Recovery manifest is not valid JSON");
  }
  const manifest = candidate as Partial<RecoveryManifest>;
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.encryption !== "age-x25519" ||
    typeof manifest.sourceBackup !== "string" ||
    !backupNamePattern.test(manifest.sourceBackup) ||
    !Array.isArray(manifest.files)
  ) {
    fail("Recovery manifest is invalid");
  }
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      file.path.startsWith("/") ||
      file.path.split("/").includes("..") ||
      !Number.isInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      fail("Recovery manifest contains an unsafe file entry");
    }
  }
  return manifest as RecoveryManifest;
}

export async function verifyRecoveryBundle(
  bundlePath: string,
  identityPath: string,
  ageBinary: string,
): Promise<RecoveryBundleVerification> {
  const bundle = resolve(bundlePath);
  const identity = resolve(identityPath);
  await requirePrivateFile(bundle);
  await requirePrivateFile(identity);
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "kurami-restore-drill-"));
  const archive = resolve(temporaryRoot, "recovery.tar.zst");
  const extracted = resolve(temporaryRoot, "extracted");
  try {
    run(resolve(ageBinary), [
      "--decrypt",
      "--identity",
      identity,
      "--output",
      archive,
      bundle,
    ]);
    const entries = await archiveEntries(archive);
    const rootNames = new Set(entries.map((entry) => entry.split("/")[0]));
    if (rootNames.size !== 1) fail("Recovery archive must contain exactly one root");
    const rootName = [...rootNames][0]!;
    if (!/^kurami-recovery-\d{8}T\d{6}Z$/.test(rootName)) {
      fail(`Recovery archive root is invalid: ${rootName}`);
    }
    await mkdir(extracted, { recursive: false, mode: 0o700 });
    run("tar", ["--zstd", "-C", extracted, "-xf", archive]);
    const root = resolve(extracted, rootName);
    const manifest = parseRecoveryManifest(
      await readFile(resolve(root, "manifest.json"), "utf8"),
    );
    const expectedFiles = [
      ...manifest.files.map((file) => file.path),
      "manifest.json",
    ].sort();
    const presentFiles = await actualFiles(root);
    if (JSON.stringify(expectedFiles) !== JSON.stringify(presentFiles)) {
      fail("Recovery archive contents do not exactly match its manifest");
    }
    for (const expected of manifest.files) {
      const evidence = await fileDigest(resolve(root, expected.path), expected.path);
      if (evidence.bytes !== expected.bytes || evidence.sha256 !== expected.sha256) {
        fail(`Recovery file does not match its manifest: ${expected.path}`);
      }
    }
    assertDatabaseIntegrity(resolve(root, "snapshot/orchestrator.db"));
    return {
      ok: true,
      action: "verified",
      bundle,
      sourceBackup: manifest.sourceBackup,
      databaseIntegrity: "ok",
      files: manifest.files.length,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function formatSummary(result: RecoveryBundleResult): string {
  return [
    "🔐 Kurami recovery bundle ready (encrypted, local)",
    `- Bundle: ${basename(result.bundle)}`,
    `- Source snapshot: ${result.sourceBackup}`,
    `- Files: ${result.files}`,
    `- Retained bundles: ${result.retained}`,
    `- Pruned bundles: ${result.pruned.length}`,
    "- Local encrypted copy: ready",
  ].join("\n");
}

function valueAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) fail(`Missing ${flag}`);
  return args[index + 1]!;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const hermesHome = resolve(
    process.env.HERMES_HOME ?? "/home/shagon1k/_hermes/_core",
  );
  const ageBinary = resolve(
    process.env.KURAMI_AGE_BIN ?? resolve(orchestratorHome, "runtime/age/bin/age"),
  );
  if (command === "create") {
    const recipient = process.env.KURAMI_RECOVERY_RECIPIENT;
    if (!recipient) fail("KURAMI_RECOVERY_RECIPIENT is required");
    const result = await createRecoveryBundle({
      orchestratorHome,
      hermesHome,
      recipient,
      ageBinary,
      retention: process.env.KURAMI_RECOVERY_RETENTION
        ? Number(process.env.KURAMI_RECOVERY_RETENTION)
        : undefined,
    });
    process.stdout.write(
      args.includes("--summary-text")
        ? `${formatSummary(result)}\n`
        : `${JSON.stringify(result)}\n`,
    );
    return;
  }
  if (command === "verify") {
    const result = await verifyRecoveryBundle(
      valueAfter(args, "--bundle"),
      valueAfter(args, "--identity"),
      ageBinary,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  fail(
    "Usage: recovery-bundle.ts <create [--summary-text] | verify --bundle PATH --identity PATH>",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
