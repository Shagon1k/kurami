import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  briefingPaths,
  cleanupExpired,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
  preparePreview,
  topicProfile,
} from "./store.ts";
import { parseBriefingPayload } from "./model.ts";
import { renderBriefingPage } from "./ui/render-page.ts";

type Command = "init" | "prepare-preview" | "render-preview" | "rerender-preview" | "inspect" | "cleanup";

type Arguments = {
  command: Command;
  payloadPath?: string;
  htmlPath?: string;
  editionId?: string;
  at?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(argv = process.argv.slice(2)): Arguments {
  const command = argv.shift() as Command | undefined;
  if (!command || !["init", "prepare-preview", "render-preview", "rerender-preview", "inspect", "cleanup"].includes(command)) {
    fail("Usage: briefing <init|prepare-preview|render-preview|rerender-preview|inspect|cleanup> [options]");
  }
  const result: Arguments = { command };
  while (argv.length > 0) {
    const option = argv.shift();
    const value = argv.shift();
    if (!value) fail(`Missing value for ${option ?? "option"}`);
    if (option === "--payload") result.payloadPath = resolve(value);
    else if (option === "--html") result.htmlPath = resolve(value);
    else if (option === "--id") result.editionId = value;
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
  if (args.command === "cleanup") {
    const at = args.at ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(at))) fail("--at must be RFC3339-compatible");
    return {
      ok: true,
      action: "cleanup",
      ...(await cleanupExpired(new Date(at).toISOString(), paths)),
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
    return {
      ok: true,
      action: "inspect",
      externalMutations: false,
      database: paths.databasePath,
      editions,
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
