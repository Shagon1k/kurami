import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { captureIdea } from "../src/system/ideas/ideas.ts";
import { DatabaseSync } from "node:sqlite";
import { createBackup, formatBackupSummary } from "../src/system/recovery/backup-state.ts";

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
  await mkdir(resolve(root, "state/briefing"), { recursive: true, mode: 0o700 });
  await writeFile(resolve(root, "config/briefing.yaml"), "version: 1\n");
  await writeFile(resolve(root, "config/briefing-topics.yaml"), "topics: []\n");
  const briefing = new DatabaseSync(resolve(root, "state/briefing/briefing.db"));
  briefing.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE editions (value TEXT);
    CREATE TABLE weekly_daily_observations (value TEXT);
    CREATE TABLE reaction_events (value TEXT);
    INSERT INTO editions VALUES ('published-digest');
    INSERT INTO weekly_daily_observations VALUES ('weekly-observation');
    INSERT INTO reaction_events VALUES ('for-me-reaction');
  `);
  const health = new DatabaseSync(resolve(root, "state/system-health.db"));
  health.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE cycles(value TEXT); INSERT INTO cycles VALUES('committed-in-wal')");
  captureIdea(root, { summary: "Keep ideas in the backup" }, "owner");
  await createBackup(root, new Date("2026-08-15T03:15:00Z"), 2);
  const last = await createBackup(root, new Date("2026-08-16T03:15:00Z"), 2);
  // Keep the writer open until after the snapshot so committed WAL data is required.
  const briefingCopy = new DatabaseSync(resolve(last.directory, "briefing.db"), { readOnly: true });
  for (const [table, value] of [
    ["editions", "published-digest"],
    ["weekly_daily_observations", "weekly-observation"],
    ["reaction_events", "for-me-reaction"],
  ]) {
    if ((briefingCopy.prepare(`SELECT value FROM ${table}`).get() as { value: string }).value !== value) {
      throw new Error(`Digest backup missed committed WAL data: ${table}`);
    }
  }
  briefingCopy.close();
  briefing.close();
  if (((await stat(resolve(last.directory, "briefing.db"))).mode & 0o777) !== 0o600) {
    throw new Error("Digest snapshot is not private");
  }
  const ideasCopy = new DatabaseSync(resolve(last.directory, "ideas.db"), { readOnly: true });
  if ((ideasCopy.prepare("SELECT summary FROM ideas").get() as { summary: string }).summary !== "Keep ideas in the backup") throw new Error("Ideas backup missed the pool");
  ideasCopy.close();
  for (const name of ["briefing.db", "config__briefing.yaml", "config__briefing-topics.yaml"]) {
    const file = last.manifest.files.find(file => file.name === name);
    if (!file || file.bytes === 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`Digest backup missing manifest evidence: ${name}`);
    }
  }
  if ((await readdir(last.directory)).some(name => /-(wal|shm)$/.test(name))) {
    throw new Error("Backup contains live SQLite sidecars");
  }
  health.close();
  const healthCopy = new DatabaseSync(resolve(last.directory, "system-health.db"), {readOnly: true});
  if ((healthCopy.prepare("SELECT value FROM cycles").get() as {value:string}).value !== "committed-in-wal") throw new Error("Health backup missed committed WAL data");
  healthCopy.close();
  if (((await stat(resolve(last.directory, "system-health.db"))).mode & 0o777) !== 0o600) throw new Error("Health snapshot is not private");
  if (!last.manifest.files.some(file=>file.name==="system-health.db")) throw new Error("Health snapshot missing from manifest");

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
    !summary.includes("Kurami backup completed") ||
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
  await rm(resolve(root, "config/Caddyfile"));
  const briefingPath = resolve(root, "state/briefing/briefing.db");
  await rm(briefingPath);
  await symlink(resolve(root, "secrets/github.env"), briefingPath);
  let briefingSymlinkRejected = false;
  try { await createBackup(root, new Date("2026-08-18T02:15:00Z"), 2); }
  catch { briefingSymlinkRejected = true; }
  if (!briefingSymlinkRejected) throw new Error("Symlinked Digest database accepted");
  await rm(briefingPath);
  await writeFile(briefingPath, "not a database");
  let corruptBriefingRejected = false;
  try { await createBackup(root, new Date("2026-08-18T02:30:00Z"), 2); }
  catch { corruptBriefingRejected = true; }
  if (!corruptBriefingRejected) throw new Error("Corrupt Digest database accepted");
  if ((await readdir(resolve(root, "backups"))).some(name => name.startsWith("backup-20260818T02"))) {
    throw new Error("Rejected Digest snapshot left a partial backup");
  }
  await rm(briefingPath);
  await rm(resolve(root, "state/system-health.db"));
  await symlink(resolve(root, "secrets/github.env"), resolve(root, "state/system-health.db"));
  let healthSymlinkRejected = false;
  try {await createBackup(root, new Date("2026-08-18T03:15:00Z"), 2);} catch {healthSymlinkRejected = true;}
  if (!healthSymlinkRejected) throw new Error("Symlinked Health database accepted");
  await rm(resolve(root, "state/system-health.db"));
  await writeFile(resolve(root, "state/system-health.db"), "not a database");
  let corruptHealthRejected = false;
  try {await createBackup(root, new Date("2026-08-19T03:15:00Z"), 2);} catch {corruptHealthRejected = true;}
  if (!corruptHealthRejected) throw new Error("Corrupt Health database accepted");
  if ((await readdir(resolve(root, "backups"))).some(name=>/2026081[89]/.test(name))) throw new Error("Rejected Health snapshot left a partial backup");

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
