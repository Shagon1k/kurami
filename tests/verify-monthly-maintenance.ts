import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  findOldLogFiles,
  builderCachePruneArgs,
  formatMaintenanceSummary,
  parseBuilderCacheMaxUsedGib,
} from "../src/system/maintenance/monthly-maintenance.ts";

const root = await mkdtemp(resolve(tmpdir(), "kurami-maintenance-test-"));
const now = new Date("2026-08-16T04:15:00Z");

try {
  const nested = resolve(root, "session-handoffs");
  await mkdir(nested, { recursive: true });
  const oldLog = resolve(root, "controller-errors.log");
  const oldJsonl = resolve(nested, "run.jsonl");
  const recentLog = resolve(root, "recent.log");
  const ignoredFile = resolve(root, "keep.db");
  const symlinkPath = resolve(root, "linked.log");

  await writeFile(oldLog, "old\n");
  await writeFile(oldJsonl, "old-json\n");
  await writeFile(recentLog, "recent\n");
  await writeFile(ignoredFile, "database\n");
  await symlink(oldLog, symlinkPath);

  const oldTime = new Date(now.getTime() - 120 * 86_400_000);
  const recentTime = new Date(now.getTime() - 10 * 86_400_000);
  await utimes(oldLog, oldTime, oldTime);
  await utimes(oldJsonl, oldTime, oldTime);
  await utimes(recentLog, recentTime, recentTime);
  await utimes(ignoredFile, oldTime, oldTime);

  const candidates = await findOldLogFiles(root, now.getTime(), 90);
  const paths = candidates.map((candidate) => candidate.path).sort();
  const expected = [oldLog, oldJsonl].sort();
  if (JSON.stringify(paths) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected cleanup scope: ${JSON.stringify(paths)}`);
  }
  const summary = formatMaintenanceSummary({
    removedLogFiles: 2,
    removedLogBytes: 1536,
    docker: [
      {
        command: ["docker", "image", "prune"],
        stdout: "Total reclaimed space: 12.3MB",
      },
      {
        command: ["docker", "builder", "prune"],
        stdout: "Total reclaimed space: 4.5MB",
      },
    ],
    builderCacheMaxUsedGib: 8,
  });
  if (
    !summary.includes("monthly maintenance completed") ||
    !summary.includes("Removed logs: 2 (1.5 KiB)") ||
    !summary.includes("12.3MB") ||
    !summary.includes("4.5MB")
  ) {
    throw new Error(`Unexpected maintenance summary: ${summary}`);
  }
  const cacheArgs = builderCachePruneArgs(8);
  if (
    parseBuilderCacheMaxUsedGib(8) !== 8 ||
    !cacheArgs.includes("--max-used-space") ||
    cacheArgs.at(-1) !== String(8 * 1024 ** 3)
  )
    throw new Error(`Unexpected builder cache policy: ${JSON.stringify(cacheArgs)}`);

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      isolated: true,
      oldLogsSelected: candidates.length,
      recentLogsPreserved: true,
      nonLogsPreserved: true,
      symlinksPreserved: true,
      retentionDays: 90,
      dockerSafetyBoundary: "images-and-builder-cache-only",
      builderCacheMaxUsedGib: 8,
      friendlySummary: true,
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
