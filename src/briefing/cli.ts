import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  briefingPaths,
  cleanupExpired,
  createTelegramCommitPlan,
  finalizeEdition,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
  preparePreview,
  recordTelegramValidation,
  topicProfile,
} from "./store.ts";
import { parseBriefingPayload } from "./model.ts";
import { renderBriefingPage } from "./ui/render-page.ts";
import { importEditionMedia, readMediaManifest } from "./media.ts";
import { validateTelegramBatch } from "./telegram-batch.ts";
import { notifyBriefingRelease } from "./release-notifier.ts";

type Command = "init" | "prepare-preview" | "render-preview" | "rerender-preview" | "import-media" | "validate-telegram-batch" | "telegram-commit-plan" | "finalize" | "notify-release" | "inspect" | "cleanup";

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
  at?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(argv = process.argv.slice(2)): Arguments {
  const command = argv.shift() as Command | undefined;
  if (!command || !["init", "prepare-preview", "render-preview", "rerender-preview", "import-media", "validate-telegram-batch", "telegram-commit-plan", "finalize", "notify-release", "inspect", "cleanup"].includes(command)) {
    fail("Usage: briefing <init|prepare-preview|render-preview|rerender-preview|import-media|validate-telegram-batch|telegram-commit-plan|finalize|notify-release|inspect|cleanup> [options]");
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
    else if (option === "--at") result.at = value;
    else fail(`Unknown option ${option}`);
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
  if (command === "import-media" && !result.manifestPath) {
    fail("import-media requires --manifest");
  }
  if (command === "validate-telegram-batch" && (!result.configPath || !result.rawPath || !result.normalizedPath)) {
    fail("validate-telegram-batch requires --config, --raw, and --normalized");
  }
  if (command === "telegram-commit-plan" && !result.editionId) {
    fail("telegram-commit-plan requires --id");
  }
  if (command === "finalize" && (!result.editionId || !result.receiptsPath)) {
    fail("finalize requires --id and --receipts");
  }
  if (command === "notify-release" && !result.editionId) {
    fail("notify-release requires --id");
  }
  if (command !== "cleanup" && result.at) fail("--at is valid only for cleanup");
  return result;
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
  if (args.command === "init") {
    return { ok: true, action: "init", ...(await initializeBriefingStore(paths)) };
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
    const payload = parseBriefingPayload(await readPayload(args.payloadPath!));
    return {
      ok: true,
      action: "render-preview",
      renderer: "kurami-ui-components-v1",
      externalMutations: false,
      ...(await preparePreview(payload, renderBriefingPage(payload), paths)),
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
      payload.news.items = payload.news.items.map((story) => {
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
      ...(await preparePreview(payload, renderBriefingPage(payload), paths)),
    };
  }
  if (args.command === "import-media") {
    return {
      ok: true,
      action: "import-media",
      externalMutations: false,
      ...(await importEditionMedia(await readMediaManifest(args.manifestPath!), paths)),
    };
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
    return {
      ok: true,
      action: "validate-telegram-batch",
      externalMutations: false,
      persisted: Boolean(args.editionId),
      ...report,
    };
  }
  if (args.command === "telegram-commit-plan") {
    await initializeBriefingStore(paths);
    const database = openBriefingDatabase(paths);
    try {
      return {
        ok: true,
        action: "telegram-commit-plan",
        externalMutations: false,
        ...createTelegramCommitPlan(database, args.editionId!),
      };
    } finally {
      database.close();
    }
  }
  if (args.command === "finalize") {
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
      return {
        ok: true,
        action: "finalize",
        externalMutations: true,
        ...finalizeEdition(
          database,
          args.editionId!,
          results,
          typeof root.planDigest === "string" ? root.planDigest : undefined,
        ),
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
    return {
      ok: true,
      action: "notify-release",
      externalMutations: true,
      ...(await notifyBriefingRelease(args.editionId!)),
    };
  }

  await initializeBriefingStore(paths);
  const database = openBriefingDatabase(paths);
  try {
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
    };
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  runBriefingCli()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
      process.exitCode = 1;
    });
}
