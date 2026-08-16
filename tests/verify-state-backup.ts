import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackup, formatBackupSummary } from "../src/backup-state.ts";

const root = await mkdtemp(resolve(tmpdir(), "kurami-backup-test-"));

try {
  await mkdir(resolve(root, "state"), { recursive: true, mode: 0o700 });
  await mkdir(resolve(root, "config"), { recursive: true, mode: 0o700 });
  await mkdir(resolve(root, "secrets"), { recursive: true, mode: 0o700 });
  await writeFile(resolve(root, "config/orchestrator.yaml"), "version: 1\n");
  await writeFile(resolve(root, "config/projects.yaml"), "version: 1\n");
  await writeFile(resolve(root, "config/Caddyfile"), ":9180 {}\n");
  await writeFile(resolve(root, "secrets/github.env"), "GH_TOKEN=must-not-copy\n");

  const source = new DatabaseSync(resolve(root, "state/orchestrator.db"));
  source.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO evidence (value) VALUES ('durable');
  `);
  source.close();

  await createBackup(root, new Date("2026-08-14T03:15:00Z"), 2);
  await createBackup(root, new Date("2026-08-15T03:15:00Z"), 2);
  const last = await createBackup(root, new Date("2026-08-16T03:15:00Z"), 2);

  const backupNames = (await readdir(resolve(root, "backups"))).sort();
  if (backupNames.length !== 2) throw new Error("Retention did not keep two backups");
  if (last.pruned.length !== 1) throw new Error("Old backup was not pruned exactly once");

  const backupDatabase = new DatabaseSync(
    resolve(last.directory, "orchestrator.db"),
    { readOnly: true },
  );
  const row = backupDatabase.prepare("SELECT value FROM evidence").get() as {
    value: string;
  };
  backupDatabase.close();
  if (row.value !== "durable") throw new Error("Backup content is incomplete");

  const files = await readdir(last.directory);
  if (files.some((name) => name.includes("secret") || name.includes("github.env"))) {
    throw new Error("A secret file was copied into the backup");
  }
  const manifest = JSON.parse(
    await readFile(resolve(last.directory, "manifest.json"), "utf8"),
  ) as { secretsIncluded: boolean; databaseIntegrity: string; files: unknown[] };
  if (manifest.secretsIncluded || manifest.databaseIntegrity !== "ok") {
    throw new Error("Backup manifest safety evidence is invalid");
  }
  const summary = formatBackupSummary(last);
  if (
    !summary.includes("Kurami Orchestrator backup completed") ||
    !summary.includes("SQLite: ok") ||
    !summary.includes("Retained snapshots: 2")
  ) {
    throw new Error(`Unexpected backup summary: ${summary}`);
  }

  await rm(resolve(root, "config/Caddyfile"));
  await symlink(
    resolve(root, "secrets/github.env"),
    resolve(root, "config/Caddyfile"),
  );
  let symlinkRejected = false;
  try {
    await createBackup(root, new Date("2026-08-17T03:15:00Z"), 2);
  } catch {
    symlinkRejected = true;
  }
  if (!symlinkRejected) throw new Error("Symlinked config source was accepted");
  const afterRejection = await readdir(resolve(root, "backups"));
  if (afterRejection.includes("backup-20260817T031500Z")) {
    throw new Error("Failed backup left a misleading partial directory");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      isolated: true,
      retained: backupNames.length,
      pruned: last.pruned.length,
      integrity: manifest.databaseIntegrity,
      files: manifest.files.length,
      secretsExcluded: true,
      symlinkRejected: true,
      partialBackupRemoved: true,
      friendlySummary: true,
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
