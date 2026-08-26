import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

process.umask(0o077);

type BackupFile = {
  name: string;
  bytes: number;
  sha256: string;
};

type BackupManifest = {
  version: 1;
  createdAt: string;
  databaseIntegrity: "ok";
  files: BackupFile[];
  secretsIncluded: false;
};

export type BackupResult = {
  ok: true;
  action: "created";
  directory: string;
  retained: number;
  pruned: string[];
  manifest: BackupManifest;
};

const backupNamePattern = /^backup-\d{8}T\d{6}Z$/;
const defaultRetention = 14;

function fail(message: string): never {
  throw new Error(message);
}

function parseRetention(value: string | undefined): number {
  if (value === undefined) return defaultRetention;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 90) {
    fail("KURAMI_BACKUP_RETENTION must be an integer between 2 and 90");
  }
  return parsed;
}

function backupName(date: Date): string {
  return `backup-${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
}

function formatVilniusTimestamp(value: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vilnius",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "??";
  return `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}`;
}

export function formatBackupSummary(result: BackupResult): string {
  const directoryName = result.directory.split("/").at(-1) ?? result.directory;
  return [
    "💾 Kurami Orchestrator backup completed",
    `- Snapshot: ${directoryName}`,
    `- SQLite: ${result.manifest.databaseIntegrity}`,
    `- Files: ${result.manifest.files.length}`,
    `- Retained snapshots: ${result.retained}`,
    `- Pruned snapshots: ${result.pruned.length}`,
    `- Created: ${formatVilniusTimestamp(result.manifest.createdAt)}`,
  ].join("\n");
}

async function digestFile(path: string, name: string): Promise<BackupFile> {
  const content = await readFile(path);
  return {
    name,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function assertDatabaseIntegrity(database: DatabaseSync): void {
  const row = database.prepare("PRAGMA quick_check").get() as {
    quick_check: string;
  };
  if (row.quick_check !== "ok") {
    fail(`SQLite quick_check failed: ${row.quick_check}`);
  }
}

async function listBackupNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && backupNamePattern.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function pruneBackups(root: string, keep: number): Promise<string[]> {
  const names = await listBackupNames(root);
  const pruned: string[] = [];
  for (const name of names.slice(keep)) {
    const target = resolve(root, name);
    const metadata = await lstat(target);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail(`Refusing unsafe backup retention target: ${target}`);
    }
    await rm(target, { recursive: true, force: false });
    pruned.push(name);
  }
  return pruned;
}

export async function createBackup(
  orchestratorHome: string,
  now = new Date(),
  retention = parseRetention(process.env.KURAMI_BACKUP_RETENTION),
): Promise<BackupResult> {
  const home = resolve(orchestratorHome);
  const databasePath = resolve(home, "state/orchestrator.db");
  const backupRoot = resolve(home, "backups");
  const directoryName = backupName(now);
  const directory = resolve(backupRoot, directoryName);
  const databaseBackupPath = resolve(directory, "orchestrator.db");

  if (!backupNamePattern.test(directoryName)) {
    fail(`Unsafe generated backup name: ${directoryName}`);
  }

  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await mkdir(directory, { recursive: false, mode: 0o700 });
  try {
    const database = new DatabaseSync(databasePath, {
      timeout: 10_000,
      readOnly: true,
    });
    try {
      database.exec("PRAGMA busy_timeout = 10000");
      assertDatabaseIntegrity(database);
      database.prepare("VACUUM INTO ?").run(databaseBackupPath);
    } finally {
      database.close();
    }

    await chmod(databaseBackupPath, 0o600);
    const copiedFiles: string[] = ["orchestrator.db"];
    for (const relativePath of [
      "config/orchestrator.yaml",
      "config/projects.yaml",
      "config/Caddyfile",
    ]) {
      const source = resolve(home, relativePath);
      try {
        const metadata = await lstat(source);
        if (metadata.isSymbolicLink()) {
          fail(`Refusing symlinked backup source: ${source}`);
        }
        if (!metadata.isFile()) continue;
        const destinationName = relativePath.replaceAll("/", "__");
        const destination = resolve(directory, destinationName);
        await copyFile(source, destination);
        await chmod(destination, 0o600);
        copiedFiles.push(destinationName);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    const verified = new DatabaseSync(databaseBackupPath, { readOnly: true });
    try {
      assertDatabaseIntegrity(verified);
    } finally {
      verified.close();
    }

    const files = await Promise.all(
      copiedFiles.map((name) => digestFile(resolve(directory, name), name)),
    );
    const manifest: BackupManifest = {
      version: 1,
      createdAt: now.toISOString(),
      databaseIntegrity: "ok",
      files,
      secretsIncluded: false,
    };
    const manifestPath = resolve(directory, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    const pruned = await pruneBackups(backupRoot, retention);
    return {
      ok: true,
      action: "created",
      directory,
      retained: (await listBackupNames(backupRoot)).length,
      pruned,
      manifest,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function inspectBackups(orchestratorHome: string): Promise<object> {
  const backupRoot = resolve(orchestratorHome, "backups");
  const names = await listBackupNames(backupRoot);
  const latest = names[0] ?? null;
  return {
    ok: true,
    backupRoot,
    count: names.length,
    latest,
    backups: names,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const summaryText = args.includes("--summary-text");
  const positional = args.filter((argument) => argument !== "--summary-text");
  const command = positional[0] ?? "inspect";
  if (positional.length > 1 || (summaryText && command !== "create")) {
    fail("Usage: backup-state.ts <create [--summary-text] | inspect>");
  }
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  if (command === "create") {
    const result = await createBackup(orchestratorHome);
    process.stdout.write(
      summaryText ? `${formatBackupSummary(result)}\n` : `${JSON.stringify(result)}\n`,
    );
    return;
  }
  if (command === "inspect") {
    process.stdout.write(`${JSON.stringify(await inspectBackups(orchestratorHome))}\n`);
    return;
  }
  fail("Usage: backup-state.ts <create [--summary-text] | inspect>");
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
