import { readdir, rm, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { EditionRow } from "./edition-store.ts";
import { resolvedHtmlPath } from "./html-artifacts.ts";
import type { BriefingPaths } from "./paths.ts";
import { DAILY_RETENTION_DAYS } from "./runtime-config.ts";

export function retainedDailyEditions(
  database: DatabaseSync,
  currentTime = new Date().toISOString(),
): EditionRow[] {
  return database.prepare(`
    SELECT * FROM (
      SELECT * FROM editions
      WHERE edition_type = 'daily'
        AND state IN ('complete', 'partial')
        AND retention_until > ?
      ORDER BY local_date DESC, updated_at DESC
      LIMIT ?
    ) retained
    ORDER BY local_date ASC
  `).all(currentTime, DAILY_RETENTION_DAYS) as EditionRow[];
}

type ExpiredEdition = {
  id: string;
  edition_type: "daily" | "cinema";
  local_date: string;
  html_path: string;
};

function expiredDailyEditions(database: DatabaseSync, currentTime: string): ExpiredEdition[] {
  return database.prepare(`
    WITH retained AS (
      SELECT id FROM editions
      WHERE edition_type = 'daily' AND retention_until > ?
      ORDER BY local_date DESC, updated_at DESC
      LIMIT ?
    )
    SELECT id, edition_type, local_date, html_path
    FROM editions
    WHERE edition_type = 'daily'
      AND (retention_until <= ? OR id NOT IN (SELECT id FROM retained))
  `).all(currentTime, DAILY_RETENTION_DAYS, currentTime) as ExpiredEdition[];
}

async function removeEditionArtifacts(database: DatabaseSync, edition: ExpiredEdition, paths: BriefingPaths): Promise<void> {
  await unlink(resolvedHtmlPath(paths, edition.html_path)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rm(resolve(paths.mediaDirectory, edition.edition_type, edition.local_date), {
    recursive: true,
    force: true,
  });
  const attempts = database.prepare(`
    SELECT run_directory FROM briefing_run_attempts WHERE edition_id = ?
  `).all(edition.id) as Array<{ run_directory: string }>;
  for (const attempt of attempts) {
    const directory = resolve(attempt.run_directory);
    if (directory.startsWith(`${resolve(paths.runsDirectory)}/`)) {
      await rm(directory, { recursive: true, force: true });
    }
  }
  for (const root of [paths.runsDirectory, paths.recoveryDirectory, paths.artifactsDirectory, paths.stateArtifactsDirectory]) {
    const children = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const child of children) {
      const legacyName = new RegExp(`^(?:daily|cinema)-${edition.local_date}(?:$|-)`, "u");
      if (!child.isDirectory() || !legacyName.test(child.name)) continue;
      await rm(resolve(root, child.name), { recursive: true, force: true });
    }
  }
}

export async function pruneExpiredDailyEditions(
  database: DatabaseSync,
  currentTime: string,
  paths: BriefingPaths,
): Promise<{ deleted: string[] }> {
  const expired = expiredDailyEditions(database, currentTime);
  for (const edition of expired) {
    await removeEditionArtifacts(database, edition, paths);
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    const removeCard = database.prepare("DELETE FROM briefing_run_cards WHERE edition_id = ?");
    const remove = database.prepare("DELETE FROM editions WHERE id = ?");
    for (const edition of expired) {
      removeCard.run(edition.id);
      remove.run(edition.id);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { deleted: expired.map((edition) => edition.id) };
}
