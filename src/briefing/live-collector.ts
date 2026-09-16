import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { briefingPaths } from "./store.ts";
import { initializeBriefingStore, openBriefingDatabase } from "./store.ts";
import { loadBriefingAttempt, recordBriefingRunStage } from "./run-attempt.ts";
import { loadBriefingRuntimeConfig } from "./runtime-config.ts";
import { collectDynamicBriefingSnapshot } from "./providers/dynamic-snapshot.ts";
import {
  composioReadConnectionFromEnvironment,
  createComposioReadToolCaller,
} from "./providers/composio-mcp.ts";

const DAILY_EDITION = /^daily:(\d{4}-\d{2}-\d{2})$/;

function currentLocalDate(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function collectEditionLiveSnapshot(
  editionId: string,
  attemptId?: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const match = DAILY_EDITION.exec(editionId);
  if (!match) throw new Error("collect-live requires a daily edition ID");
  const paths = briefingPaths(environment);
  const config = await loadBriefingRuntimeConfig(paths, environment);
  const localDate = match[1]!;
  if (localDate !== currentLocalDate(config.timeZone)) {
    throw new Error("collect-live is allowed only for today's local edition");
  }
  const snapshot = await collectDynamicBriefingSnapshot({
    getCaller: () => createComposioReadToolCaller(composioReadConnectionFromEnvironment(environment)),
    enabled: config.addons,
    gmailPageSize: config.gmailPageSize,
    gmailQuery: config.gmailQuery,
    calendars: config.calendars,
    localDate,
    timeZone: config.timeZone,
    weatherLocation: config.weatherLocation,
    retry: { attempts: 3, timeoutMs: 12_000, initialDelayMs: 300, maximumDelayMs: 2_000 },
  });
  const runsRoot = resolve(paths.home, "state", "briefing", "runs");
  let runDirectory: string;
  if (attemptId) {
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    try {
      const attempt = loadBriefingAttempt(database, attemptId);
      if (!attempt || attempt.editionId !== editionId || attempt.state !== "created") {
        throw new Error("collect-live requires the matching created briefing attempt");
      }
      runDirectory = attempt.runDirectory;
    } finally {
      database.close();
    }
  } else {
    runDirectory = resolve(runsRoot, editionId.replace(":", "-"));
  }
  if (!runDirectory.startsWith(`${runsRoot}/`)) throw new Error("Invalid live snapshot path");
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  const outputPath = join(runDirectory, "live-snapshot.json");
  const temporaryPath = join(runDirectory, `.live-snapshot.${randomUUID()}.tmp`);
  const encoded = `${JSON.stringify(snapshot, null, 2)}\n`;
  await writeFile(temporaryPath, encoded, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, outputPath);
  if (attemptId) {
    const database = openBriefingDatabase(paths);
    try {
      recordBriefingRunStage(database, {
        attemptId,
        stage: "live-collected",
        outputDigest: createHash("sha256").update(encoded).digest("hex"),
        metadata: { outputPath, state: snapshot.state },
      });
    } finally {
      database.close();
    }
  }
  return {
    ok: true,
    action: "collect-live",
    externalMutations: false,
    outputPath,
    state: snapshot.state,
    refreshedAt: snapshot.refreshedAt,
    mailState: snapshot.gmail.state,
    mailCount: snapshot.gmail.value?.items.length ?? 0,
    calendarState: snapshot.calendar.state,
    calendarCount: snapshot.calendar.value?.items.length ?? 0,
    weatherState: snapshot.weather.state,
  };
}
