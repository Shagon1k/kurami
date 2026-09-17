import { section, newsBatches } from "./addons/envelopes.ts";
import { completionContext, resumeCompletion, assertCompletion } from "./completion.ts";
import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  briefingPaths,
  cleanupExpired,
  createTelegramCommitPlan,
  finalizeEdition,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
  preparePreview,
  revisePublishedEdition,
  rerenderPublishedPreview,
  recordTelegramValidation,
  topicProfile,
  topicRegistry,
  topicPairProfile,
} from "./store.ts";
import { parseBriefingPayload } from "./model.ts";
import { renderBriefingPage } from "./ui/render-page.ts";
import { buildEditionMediaManifest, importEditionMedia, readMediaManifest } from "./media.ts";
import { validateTelegramBatch } from "./telegram-batch.ts";
import {
  notifyBriefingRelease,
  syncBriefingRunCardFailSoft,
  syncBriefingRunFailureCardFailSoft,
} from "./release-notifier.ts";
import { loadBriefingRuntimeConfig, loadTelegramCaptureConfig } from "./runtime-config.ts";
import { collectEditionLiveSnapshot } from "./live-collector.ts";
import { assertEditorialPayload, assertKuramiNoteContract, loadTopicPolicy } from "./editorial-validation.ts";
import { composeBriefingPayload } from "./composer.ts";
import { applyDeterministicRanking } from "./ranking.ts";
import { cinemaSnapshotForDaily } from "./cinema/promotion.ts";
import { guardBriefingRun } from "./run-guard.ts";
import {
  loadBriefingAttempt,
  recordBriefingRunStage,
  startBriefingAttempt,
  type BriefingRunMode,
  type BriefingRunState,
} from "./run-attempt.ts";

type Command = "completion-context" | "resume-completion" | "assert-complete" | "init" | "start-attempt" | "attempt-status" | "advance-attempt" | "guard-run" | "collect-live" | "rank-preview" | "compose" | "topic-pool" | "prepare-preview" | "render-preview" | "rerender-preview" | "revise-published" | "build-media-manifest" | "media-ready" | "import-media" | "validate-telegram-batch" | "telegram-capture-config" | "telegram-commit-plan" | "finalize" | "notify-release" | "inspect" | "cleanup";

type Arguments = {
  command: Command;
  payloadPath?: string;
  htmlPath?: string;
  editionId?: string;
  manifestPath?: string;
  configPath?: string;
  rawPath?: string;
  normalizedPath?: string;
  receiptsPath?: string;
  draftPath?: string;
  livePath?: string;
  outputPath?: string;
  downloadsPath?: string;
  attemptId?: string;
  mode?: BriefingRunMode;
  stage?: BriefingRunState;
  errorCode?: string;
  at?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(argv = process.argv.slice(2)): Arguments {
  const command = argv.shift() as Command | undefined;
  if (!command || !["completion-context", "resume-completion", "assert-complete", "init", "start-attempt", "attempt-status", "advance-attempt", "guard-run", "collect-live", "rank-preview", "compose", "topic-pool", "prepare-preview", "render-preview", "rerender-preview", "revise-published", "build-media-manifest", "media-ready", "import-media", "validate-telegram-batch", "telegram-capture-config", "telegram-commit-plan", "finalize", "notify-release", "inspect", "cleanup"].includes(command)) {
    fail("Unknown briefing command");
  }
  const result: Arguments = { command };
  while (argv.length > 0) {
    const option = argv.shift();
    const value = argv.shift();
    if (!value) fail(`Missing value for ${option ?? "option"}`);
    if (option === "--payload") result.payloadPath = resolve(value);
    else if (option === "--html") result.htmlPath = resolve(value);
    else if (option === "--id") result.editionId = value;
    else if (option === "--manifest") result.manifestPath = resolve(value);
    else if (option === "--config") result.configPath = resolve(value);
    else if (option === "--raw") result.rawPath = resolve(value);
    else if (option === "--normalized") result.normalizedPath = resolve(value);
    else if (option === "--receipts") result.receiptsPath = resolve(value);
    else if (option === "--draft") result.draftPath = resolve(value);
    else if (option === "--live") result.livePath = resolve(value);
    else if (option === "--output") result.outputPath = resolve(value);
    else if (option === "--downloads") result.downloadsPath = resolve(value);
    else if (option === "--attempt") result.attemptId = value;
    else if (option === "--mode" && ["scheduled", "manual", "recovery", "dry-run"].includes(value)) result.mode = value as BriefingRunMode;
    else if (option === "--stage") result.stage = value as BriefingRunState;
    else if (option === "--error-code") result.errorCode = value;
    else if (option === "--at") result.at = value;
    else fail(`Unknown option ${option}`);
  }
  if (["completion-context", "resume-completion", "assert-complete"].includes(command) && (!result.editionId || !result.attemptId)) {
    fail("Completion commands require --id and --attempt");
  }
  if (command === "prepare-preview" && (!result.payloadPath || !result.htmlPath)) {
    fail("prepare-preview requires --payload and --html");
  }
  if (command === "render-preview" && !result.payloadPath) {
    fail("render-preview requires --payload");
  }
  if (command === "rerender-preview" && !result.editionId) {
    fail("rerender-preview requires --id");
  }
  if (command === "revise-published" && (!result.editionId || !result.payloadPath)) {
    fail("revise-published requires --id and --payload");
  }
  if (command === "collect-live" && (!result.editionId || !result.attemptId)) {
    fail("collect-live requires --id and --attempt");
  }
  if (command === "start-attempt" && (!result.editionId || !result.mode)) fail("start-attempt requires --id and --mode");
  if ((command === "attempt-status" || command === "advance-attempt") && !result.attemptId) fail(`${command} requires --attempt`);
  if (command === "advance-attempt" && !result.stage) fail("advance-attempt requires --stage");
  if (result.errorCode && (command !== "advance-attempt" || result.stage !== "failed")) {
    fail("--error-code is valid only for a failed advance-attempt");
  }
  if (result.errorCode && !/^[a-z][a-z0-9_]{0,79}$/u.test(result.errorCode)) {
    fail("--error-code must be a bounded machine-safe code");
  }
  if (command === "compose" && (!result.attemptId || !result.draftPath || !result.livePath || !result.configPath || !result.rawPath || !result.normalizedPath || !result.outputPath)) {
    fail("compose requires --attempt, --draft, --live, --config, --raw, --normalized and --output");
  }
  if (command === "rank-preview" && (!result.draftPath || !result.livePath || !result.configPath || !result.rawPath || !result.normalizedPath || !result.outputPath)) {
    fail("rank-preview requires --draft, --live, --config, --raw, --normalized and --output");
  }
  if (command === "build-media-manifest" && (!result.editionId || !result.downloadsPath || !result.outputPath)) {
    fail("build-media-manifest requires --id, --downloads and --output");
  }
  if (command === "media-ready" && !result.attemptId) fail("media-ready requires --attempt");
  if (command === "import-media" && (!result.manifestPath || !result.attemptId)) {
    fail("import-media requires --manifest and --attempt");
  }
  if (command === "validate-telegram-batch" && (!result.configPath || !result.rawPath || !result.normalizedPath)) {
    fail("validate-telegram-batch requires --config, --raw, and --normalized");
  }
  if (command === "telegram-commit-plan" && (!result.editionId || !result.attemptId)) {
    fail("telegram-commit-plan requires --id and --attempt");
  }
  if (command === "finalize" && (!result.editionId || !result.receiptsPath || !result.attemptId)) {
    fail("finalize requires --id, --receipts and --attempt");
  }
  if (command === "notify-release" && (!result.editionId || !result.attemptId)) {
    fail("notify-release requires --id and --attempt");
  }
  if (command === "validate-telegram-batch" && result.editionId && !result.attemptId) {
    fail("persisted Telegram validation requires --attempt");
  }
  if (command !== "cleanup" && result.at) fail("--at is valid only for cleanup");
  return result;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = resolve(dirname(path), `.${createHash("sha256").update(`${path}:${Date.now()}`).digest("hex").slice(0, 12)}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function requireProductionMutations(paths: ReturnType<typeof briefingPaths>): Promise<void> {
  const config = await loadBriefingRuntimeConfig(paths);
  if (!config.safety.productionMutationsEnabled) fail("Production mutations are disabled by runtime config");
  if (!config.safety.requireBoundedTelegramCommit) fail("Bounded Telegram commit is required");
  if (!config.safety.initialChannelCleanupConfirmed) fail("Initial Telegram channel cleanup is not confirmed");
}

async function readPayload(path: string): Promise<unknown> {
  const payloadText = await readFile(path, "utf8");
  if (Buffer.byteLength(payloadText, "utf8") > 2 * 1024 * 1024) {
    fail("Payload exceeds 2 MiB");
  }
  return JSON.parse(payloadText) as unknown;
}

export async function runBriefingCli(argv = process.argv.slice(2)): Promise<unknown> {
  const args = parseArguments([...argv]);
  const paths = briefingPaths();
  if (["completion-context", "resume-completion", "assert-complete"].includes(args.command)) {
    if (args.command !== "assert-complete") await requireProductionMutations(paths);
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    try {
      const result = args.command === "completion-context"
        ? await completionContext(database, paths, args.editionId!, args.attemptId!)
        : args.command === "resume-completion"
          ? {attempt: resumeCompletion(database, args.editionId!, args.attemptId!)}
          : assertCompletion(database, args.editionId!, args.attemptId!);
      return {ok:true, action:args.command, externalMutations:false, ...result};
    } finally { database.close(); }
  }
  if (args.command === "init") {
    return { ok: true, action: "init", ...(await initializeBriefingStore(paths)) };
  }
  if (args.command === "guard-run") {
    return { ok: true, action: "guard-run", externalMutations: true, ...(await guardBriefingRun()) };
  }
  if (args.command === "start-attempt") {
    await initializeBriefingStore(paths);
    const config = await loadBriefingRuntimeConfig(paths);
    const database = openBriefingDatabase(paths);
    try {
      return {
        ok: true,
        action: "start-attempt",
        externalMutations: false,
        ...(await startBriefingAttempt(database, paths, {
          editionId: args.editionId!,
          mode: args.mode!,
          timeZone: config.timeZone,
        })),
      };
    } finally {
      database.close();
    }
  }
  if (args.command === "attempt-status") {
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    try {
      const attempt = loadBriefingAttempt(database, args.attemptId!);
      if (!attempt) fail(`Unknown briefing attempt ${args.attemptId}`);
      return { ok: true, action: "attempt-status", externalMutations: false, attempt };
    } finally {
      database.close();
    }
  }
  if (args.command === "advance-attempt" || args.command === "media-ready") {
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    try {
      const stage = args.command === "media-ready" ? "media-ready" : args.stage!;
      return {
        ok: true,
        action: args.command,
        externalMutations: false,
        attempt: recordBriefingRunStage(database, {
          attemptId: args.attemptId!,
          stage,
          ...(args.errorCode ? { errorCode: args.errorCode } : {}),
        }),
      };
    } finally {
      database.close();
    }
  }
  if (args.command === "collect-live") {
    return collectEditionLiveSnapshot(args.editionId!, args.attemptId);
  }
  if (args.command === "rank-preview") {
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    try {
      const composed = await composeBriefingPayload({
        draftPath: args.draftPath!,
        livePath: args.livePath!,
        configPath: args.configPath!,
        rawPath: args.rawPath!,
        normalizedPath: args.normalizedPath!,
        outputPath: args.outputPath!,
      });
      const policy = await loadTopicPolicy(paths.home, process.env, topicRegistry(database));
      assertEditorialPayload(composed.payload, policy);
      return {
        ok: true,
        action: "rank-preview",
        externalMutations: false,
        outputPath: args.outputPath!,
        stories: section(composed.payload, "news").items.map((story, index) => ({
          rank: index + 1,
          storyId: story.id,
          headline: story.headline,
        })),
      };
    } finally {
      database.close();
    }
  }
  if (args.command === "compose") {
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    try {
      const attempt = loadBriefingAttempt(database, args.attemptId!);
      if (!attempt || attempt.state !== "capture-validated") fail("compose requires a capture-validated attempt");
      const localDate = attempt.editionId.startsWith("daily:") ? attempt.editionId.slice(6) : "";
      const cinema = cinemaSnapshotForDaily(database, localDate);
      const composed = await composeBriefingPayload({
        draftPath: args.draftPath!,
        livePath: args.livePath!,
        configPath: args.configPath!,
        rawPath: args.rawPath!,
        normalizedPath: args.normalizedPath!,
        outputPath: args.outputPath!,
        ...(cinema ? { addonSnapshots: { cinema } } : {}),
      });
      try {
        const policy = await loadTopicPolicy(paths.home, process.env, topicRegistry(database));
        assertEditorialPayload(composed.payload, policy);
        assertKuramiNoteContract(composed.payload);
      } catch (error) {
        await unlink(args.outputPath!).catch(() => undefined);
        throw error;
      }
      const outputDigest = createHash("sha256").update(await readFile(args.outputPath!)).digest("hex");
      recordBriefingRunStage(database, {
        attemptId: args.attemptId!,
        stage: "editorialized",
        outputDigest,
        metadata: { outputPath: args.outputPath, stories: section(composed.payload, "news").items.length },
      });
      return { ok: true, action: "compose", externalMutations: false, outputPath: args.outputPath, outputDigest, stories: section(composed.payload, "news").items.length };
    } finally {
      database.close();
    }
  }
  if (args.command === "topic-pool") {
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    let runtimeTopics;
    try {
      runtimeTopics = topicRegistry(database);
    } finally {
      database.close();
    }
    const policy = await loadTopicPolicy(paths.home, process.env, runtimeTopics);
    return {
      ok: true,
      action: "topic-pool",
      externalMutations: false,
      topics: [...policy.topics.values()].sort((left, right) => left.id.localeCompare(right.id)),
    };
  }
  if (args.command === "prepare-preview") {
    const payload = await readPayload(args.payloadPath!);
    const html = await readFile(args.htmlPath!, "utf8");
    return {
      ok: true,
      action: "prepare-preview",
      externalMutations: false,
      ...(await preparePreview(payload, html, paths)),
    };
  }
  if (args.command === "render-preview") {
    const payload = parseBriefingPayload(applyDeterministicRanking(parseBriefingPayload(await readPayload(args.payloadPath!))));
    if (payload.schemaVersion >= 2 && payload.edition.type === "daily" && !args.attemptId) {
      fail("Production daily render requires --attempt");
    }
    if (args.attemptId) {
      await initializeBriefingStore(paths);
      const database = openBriefingDatabase(paths);
      try {
        const attempt = loadBriefingAttempt(database, args.attemptId);
        if (!attempt || attempt.editionId !== payload.edition.id || attempt.state !== "editorialized") {
          fail("render-preview requires the matching editorialized attempt");
        }
      } finally {
        database.close();
      }
    }
    const prepared = await preparePreview(payload, renderBriefingPage(payload), paths);
    if (args.attemptId) {
      const database = openBriefingDatabase(paths);
      try {
        recordBriefingRunStage(database, {
          attemptId: args.attemptId,
          stage: "prepared",
          outputDigest: prepared.digest,
          metadata: { previewPath: prepared.previewPath },
        });
      } finally {
        database.close();
      }
    }
    return {
      ok: true,
      action: "render-preview",
      renderer: "kurami-ui-components-v1",
      externalMutations: false,
      ...prepared,
    };
  }
  if (args.command === "rerender-preview") {
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    let payload;
    try {
      const edition = loadEdition(database, { id: args.editionId });
      if (!edition) fail(`Edition ${args.editionId} not found`);
      payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
      const states = database
        .prepare("SELECT item_id, read_at, reaction FROM edition_items WHERE edition_id = ?")
        .all(edition.id) as Array<{
        item_id: string;
        read_at: string | null;
        reaction: "like" | "dislike" | null;
      }>;
      const byId = new Map(states.map((state) => [state.item_id, state]));
      section(payload, "news").items = section(payload, "news").items.map((story) => {
        const state = byId.get(story.id);
        return {
          ...story,
          readState: state?.read_at ? "read" : story.readState,
          reaction: state?.reaction ?? story.reaction,
        };
      });
    } finally {
      database.close();
    }
    return {
      ok: true,
      action: "rerender-preview",
      renderer: "kurami-ui-components-v1",
      externalMutations: false,
      ...(await rerenderPublishedPreview(payload, renderBriefingPage(payload), paths)),
    };
  }
  if (args.command === "revise-published") {
    const payload = await readPayload(args.payloadPath!);
    if ((payload as { edition?: { id?: unknown } }).edition?.id !== args.editionId) {
      fail("revise-published edition ID differs from payload");
    }
    return {
      ok: true,
      action: "revise-published",
      renderer: "kurami-ui-components-v1",
      externalMutations: false,
      ...(await revisePublishedEdition(payload, renderBriefingPage, paths)),
    };
  }
  if (args.command === "import-media") {
    if (args.attemptId) {
      await initializeBriefingStore(paths);
      const database = openBriefingDatabase(paths);
      try {
        const attempt = loadBriefingAttempt(database, args.attemptId);
        if (!attempt || attempt.state !== "prepared") fail("import-media requires a prepared attempt");
      } finally {
        database.close();
      }
    }
    const imported = await importEditionMedia(await readMediaManifest(args.manifestPath!), paths);
    if (args.attemptId) {
      const database = openBriefingDatabase(paths);
      try {
        recordBriefingRunStage(database, {
          attemptId: args.attemptId,
          stage: "media-ready",
          metadata: { imported: imported.imported, bytes: imported.bytes },
        });
      } finally {
        database.close();
      }
    }
    return {
      ok: true,
      action: "import-media",
      externalMutations: false,
      ...imported,
    };
  }
  if (args.command === "build-media-manifest") {
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    let payload;
    try {
      const edition = loadEdition(database, { id: args.editionId! });
      if (!edition) fail(`Edition ${args.editionId} not found`);
      payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
    } finally {
      database.close();
    }
    const manifest = buildEditionMediaManifest(payload, await readPayload(args.downloadsPath!));
    if (manifest) await writeJson(args.outputPath!, manifest);
    return { ok: true, action: "build-media-manifest", externalMutations: false, outputPath: manifest ? args.outputPath : null, stories: manifest?.stories.length ?? 0 };
  }
  if (args.command === "validate-telegram-batch") {
    const report = await validateTelegramBatch(args.configPath!, args.rawPath!, args.normalizedPath!);
    if (args.editionId) {
      await initializeBriefingStore(paths);
      const database = openBriefingDatabase(paths);
      try {
        const digest = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
        recordTelegramValidation(database, args.editionId, report, {
          raw: await digest(args.rawPath!),
          normalized: await digest(args.normalizedPath!),
        });
      } finally {
        database.close();
      }
    }
    if (args.attemptId) {
      await initializeBriefingStore(paths);
      const database = openBriefingDatabase(paths);
      try {
        const attempt = loadBriefingAttempt(database, args.attemptId);
        if (attempt?.state === "telegram-captured" && report.complete) {
          recordBriefingRunStage(database, {
            attemptId: args.attemptId,
            stage: "capture-validated",
            metadata: { complete: report.complete, capturedUnread: report.capturedUnread },
          });
        }
      } finally {
        database.close();
      }
    }
    return {
      ok: true,
      action: "validate-telegram-batch",
      externalMutations: false,
      persisted: Boolean(args.editionId),
      ...report,
    };
  }
  if (args.command === "telegram-capture-config") {
    return {
      ok: true,
      action: "telegram-capture-config",
      externalMutations: false,
      ...(await loadTelegramCaptureConfig(paths)),
    };
  }
  if (args.command === "telegram-commit-plan") {
    await requireProductionMutations(paths);
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    try {
      const plan = createTelegramCommitPlan(database, args.editionId!);
      if (args.attemptId) {
        recordBriefingRunStage(database, {
          attemptId: args.attemptId,
          stage: "commit-planned",
          outputDigest: plan.planDigest,
          metadata: { sources: plan.sources.length },
        });
      }
      return {
        ok: true,
        action: "telegram-commit-plan",
        externalMutations: false,
        ...plan,
      };
    } finally {
      database.close();
    }
  }
  if (args.command === "finalize") {
    await requireProductionMutations(paths);
    const receipt = await readPayload(args.receiptsPath!);
    if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt)) {
      fail("Finalize receipt must be an object");
    }
    const root = receipt as Record<string, unknown>;
    if (root.editionId !== args.editionId || !Array.isArray(root.results)) {
      fail("Finalize receipt edition or results are invalid");
    }
    const results = root.results.map((raw, index) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        fail(`Finalize result ${index} is invalid`);
      }
      const item = raw as Record<string, unknown>;
      if (typeof item.sourceKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(item.sourceKey)) {
        fail(`Finalize result ${index} sourceKey is invalid`);
      }
      if (item.status !== "committed" && item.status !== "failed") {
        fail(`Finalize result ${index} status is invalid`);
      }
      if (item.errorCode !== undefined && typeof item.errorCode !== "string") {
        fail(`Finalize result ${index} errorCode is invalid`);
      }
      return {
        sourceKey: item.sourceKey,
        status: item.status as "committed" | "failed",
        ...(typeof item.errorCode === "string" ? { errorCode: item.errorCode } : {}),
      };
    });
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    try {
      const finalized = finalizeEdition(
        database,
        args.editionId!,
        results,
        typeof root.planDigest === "string" ? root.planDigest : undefined,
      );
      if (args.attemptId) {
        recordBriefingRunStage(database, { attemptId: args.attemptId, stage: "telegram-committed", inputDigest: typeof root.planDigest === "string" ? root.planDigest : undefined });
        recordBriefingRunStage(database, { attemptId: args.attemptId, stage: "published", metadata: { state: finalized.state } });
      }
      return {
        ok: true,
        action: "finalize",
        externalMutations: true,
        ...finalized,
      };
    } finally {
      database.close();
    }
  }
  if (args.command === "cleanup") {
    const at = args.at ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(at))) fail("--at must be RFC3339-compatible");
    return {
      ok: true,
      action: "cleanup",
      ...(await cleanupExpired(new Date(at).toISOString(), paths)),
    };
  }
  if (args.command === "notify-release") {
    await requireProductionMutations(paths);
    const notified = await notifyBriefingRelease(args.editionId!, process.env, {
      attemptId: args.attemptId,
    });
    if (args.attemptId) {
      const database = openBriefingDatabase(paths);
      try {
        recordBriefingRunStage(database, { attemptId: args.attemptId, stage: "notified", metadata: { alreadyComplete: notified.alreadyComplete } });
      } finally {
        database.close();
      }
    }
    return {
      ok: true,
      action: "notify-release",
      externalMutations: true,
      ...notified,
    };
  }

  await initializeBriefingStore(paths);
  const database = openBriefingDatabase(paths);
  try {
    if (args.editionId) {
      const edition = loadEdition(database, { id: args.editionId });
      if (!edition) fail(`Edition ${args.editionId} not found`);
      const payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
      const sourceItems = new Set((newsBatches(payload) ?? []).flatMap((batch) => batch.itemIds));
      const ownedItems = new Set<string>();
      for (const story of section(payload, "news").items) {
        for (const sourceValue of Array.isArray(story.sources) ? story.sources : []) {
          if (typeof sourceValue !== "object" || sourceValue === null || Array.isArray(sourceValue)) continue;
          const source = sourceValue as Record<string, unknown>;
          for (const itemId of Array.isArray(source.itemIds) ? source.itemIds : []) {
            if (typeof itemId === "string") ownedItems.add(itemId);
          }
        }
      }
      for (const exclusion of section(payload, "news").exclusions ?? []) ownedItems.add(exclusion.itemId);
      const media = section(payload, "news").items.flatMap((story) => story.media ?? []);
      const validation = database.prepare(`
        SELECT report_json, commit_plan_digest FROM telegram_validation_receipts WHERE edition_id = ?
      `).get(edition.id) as { report_json: string; commit_plan_digest: string | null } | undefined;
      let validationSummary: Record<string, unknown> | null = null;
      if (validation) {
        const report = JSON.parse(validation.report_json) as Record<string, unknown>;
        validationSummary = {
          complete: report.complete === true,
          configuredChannels: Number(report.configuredChannels ?? 0),
          capturedUnread: Number(report.capturedUnread ?? 0),
          fetched: Number(report.fetched ?? 0),
          normalized: Number(report.normalized ?? 0),
          mediaMessages: Number(report.mediaMessages ?? 0),
          planPresent: Boolean(validation.commit_plan_digest),
        };
      }
      const batches = database.prepare(`
        SELECT state, COUNT(*) AS count FROM source_batches WHERE edition_id = ? GROUP BY state
      `).all(edition.id) as Array<{ state: string; count: number }>;
      const notification = database.prepare(`
        SELECT destination, state FROM release_notification_receipts WHERE edition_id = ?
      `).get(edition.id) as { destination: string; state: string } | undefined;
      return {
        ok: true,
        action: "inspect-summary",
        externalMutations: false,
        edition: {
          id: edition.id,
          type: edition.edition_type,
          localDate: edition.local_date,
          state: edition.state,
          schemaVersion: payload.schemaVersion,
          current: edition.is_current === 1,
          retentionUntil: edition.retention_until,
        },
        counts: {
          stories: section(payload, "news").items.length,
          exclusions: section(payload, "news").exclusions?.length ?? 0,
          sourceBatches: newsBatches(payload)?.length ?? 0,
          sourceItems: sourceItems.size,
          ownedItems: ownedItems.size,
          sourceLinks: section(payload, "news").items.filter((story) =>
            Array.isArray(story.sources) && story.sources.some((source) =>
              typeof source === "object" && source !== null && !Array.isArray(source)
              && typeof (source as Record<string, unknown>).url === "string"
            )
          ).length,
          images: media.filter((asset) => asset.kind === "image").length,
          legacyVideos: media.filter((asset) => asset.kind === "video").length,
          mail: section(payload, "mail").items.length,
          calendar: (Array.isArray(section(payload, "calendar").events) ? (section(payload, "calendar").events as unknown[]).length : 0)
            + (Array.isArray(section(payload, "calendar").allDayEvents) ? (section(payload, "calendar").allDayEvents as unknown[]).length : 0),
        },
        sourceBatchStates: Object.fromEntries(batches.map((batch) => [batch.state, Number(batch.count)])),
        telegramValidation: validationSummary,
        notification: notification ?? null,
      };
    }
    const editions = database
      .prepare(`
        SELECT id, edition_type AS type, local_date AS localDate, state,
               preview_enabled AS previewEnabled, is_current AS isCurrent,
               prepared_at AS preparedAt, published_at AS publishedAt,
               retention_until AS retentionUntil
        FROM editions
        ORDER BY local_date DESC, edition_type ASC
      `)
      .all();
    const recentNotes = (database
      .prepare(`
        SELECT id, local_date AS localDate, payload_json AS payloadJson
        FROM editions
        ORDER BY local_date DESC, edition_type ASC
        LIMIT 5
      `)
      .all() as Array<{ id: string; localDate: string; payloadJson: string }>)
      .map((edition) => {
        let notes: unknown = [];
        try {
          const payload = JSON.parse(edition.payloadJson) as { notes?: unknown };
          notes = Array.isArray(payload.notes) ? payload.notes : [];
        } catch {
          notes = [];
        }
        return { editionId: edition.id, localDate: edition.localDate, notes };
      })
      .filter((edition) => Array.isArray(edition.notes) && edition.notes.length > 0);
    return {
      ok: true,
      action: "inspect",
      externalMutations: false,
      database: paths.databasePath,
      editions,
      recentNotes,
      topicProfile: topicProfile(database),
      topicPairs: topicPairProfile(database),
    };
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  const invocation = process.argv.slice(2);
  const invocationAttemptIndex = invocation.indexOf("--attempt");
  const invocationAttemptId = invocationAttemptIndex >= 0
    && typeof invocation[invocationAttemptIndex + 1] === "string"
    ? invocation[invocationAttemptIndex + 1]!
    : null;
  runBriefingCli(invocation)
    .then(async (result) => {
      const record = result && typeof result === "object" && !Array.isArray(result)
        ? result as Record<string, unknown>
        : {};
      const nestedAttempt = record.attempt && typeof record.attempt === "object" && !Array.isArray(record.attempt)
        ? record.attempt as Record<string, unknown>
        : null;
      const attemptId = typeof nestedAttempt?.attemptId === "string"
        ? nestedAttempt.attemptId
        : invocationAttemptId;
      if (attemptId && record.action !== "attempt-status") {
        await syncBriefingRunCardFailSoft(attemptId);
      }
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch(async (error: unknown) => {
      if (invocationAttemptId) {
        await syncBriefingRunFailureCardFailSoft(
          invocationAttemptId,
          invocation[0] ?? "runtime",
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
      process.exitCode = 1;
    });
}
