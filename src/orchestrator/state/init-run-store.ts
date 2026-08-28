import { chmod, mkdir, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { DatabaseSync } from "node:sqlite";

process.umask(0o077);

const orchestratorHome = resolveKuramiHome(
  resolve(import.meta.dirname, "../../../.."),
);
const migrationsDirectory = resolve(
  process.env.ORCHESTRATOR_MIGRATIONS_DIR ??
    resolve(import.meta.dirname, "../../../migrations"),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");

export async function runRunStoreInitializerCli(): Promise<void> {
  await mkdir(resolve(orchestratorHome, "state"), {
    recursive: true,
    mode: 0o700,
  });

  const database = new DatabaseSync(databasePath, {
    timeout: 5_000,
  });

  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
      ) STRICT;
    `);

    const appliedStatement = database.prepare(
      "SELECT 1 FROM schema_migrations WHERE migration = ?",
    );
    const recordStatement = database.prepare(
      "INSERT INTO schema_migrations (migration) VALUES (?)",
    );
    const migrations = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();

    if (migrations.length === 0) {
      throw new Error(`No migrations found in ${migrationsDirectory}`);
    }

    const newlyApplied: string[] = [];

    for (const migration of migrations) {
      if (appliedStatement.get(migration)) {
        continue;
      }

      const sql = await readFile(resolve(migrationsDirectory, migration), "utf8");
      database.exec("BEGIN IMMEDIATE");

      try {
        database.exec(sql);
        recordStatement.run(migration);
        database.exec("COMMIT");
        newlyApplied.push(migration);
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }

    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    const schemaVersion = database
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get() as { count: number };

    if (integrity.integrity_check !== "ok") {
      throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
    }

    await chmod(databasePath, 0o600);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        database: databasePath,
        journalMode: "wal",
        schemaVersion: schemaVersion.count,
        applied: newlyApplied,
        integrity: integrity.integrity_check,
      })}\n`,
    );
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  runRunStoreInitializerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
