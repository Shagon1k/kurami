import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectCinemaCandidate } from "./collector.ts";
import type { CinemaCollectionCandidate } from "./collector.ts";
import { composeCinemaEnvelope, composeCinemaFallbackEnvelope, type CinemaMediaMap } from "./composer.ts";
import { cacheCinemaMedia } from "./media-cache.ts";
import {
  addonEnvelopeDigest,
  briefingPaths,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
  preparePreview,
  replacePublishedAddonEdition,
  validateRenderedHtml,
} from "../store.ts";
import { loadCinemaRuntimeConfig } from "../runtime-config.ts";
import { parseCinemaEnvelope } from "./model.ts";
import { cinemaEnvelopeToBriefingPayload } from "./payload.ts";
import { loadCinemaSnapshot, promoteCinemaEdition } from "./promotion.ts";
import { renderBriefingPage } from "../ui/render-page.ts";
import {
  composioReadConnectionFromEnvironment,
  createComposioReadToolCaller,
  type ComposioToolCaller,
} from "../providers/composio-mcp.ts";

type Arguments = {
  command: "collect" | "cache-media" | "compose" | "fallback" | "prepare" | "promote";
  date?: string;
  output: string;
  publicOnly: boolean;
  candidate?: string;
  draft?: string;
  media?: string;
  envelope?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(argv: string[]): Arguments {
  const command = argv.shift();
  if (command !== "collect" && command !== "cache-media" && command !== "compose" && command !== "fallback" && command !== "prepare" && command !== "promote") {
    fail("Usage: cinema-cli <collect|cache-media|compose|fallback|prepare|promote> [options]");
  }
  let date = "";
  let output = "";
  let candidate = "";
  let draft = "";
  let media = "";
  let envelope = "";
  let publicOnly = false;
  while (argv.length) {
    const option = argv.shift();
    if (option === "--public-only") {
      publicOnly = true;
      continue;
    }
    const value = argv.shift();
    if (!value) fail(`Missing value for ${option ?? "option"}`);
    if (option === "--date") date = value;
    else if (option === "--output") output = resolve(value);
    else if (option === "--candidate") candidate = resolve(value);
    else if (option === "--draft") draft = resolve(value);
    else if (option === "--media") media = resolve(value);
    else if (option === "--envelope") envelope = resolve(value);
    else fail(`Unknown option ${option}`);
  }
  if (["collect", "cache-media", "compose", "fallback"].includes(command) && !output) {
    fail(`cinema-cli ${command} requires --output PATH`);
  }
  if (command === "collect" && !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    fail("cinema-cli collect requires --date YYYY-MM-DD and --output PATH");
  }
  if ((command === "cache-media" || command === "compose" || command === "fallback") && !candidate) {
    fail(`cinema-cli ${command} requires --candidate PATH and --output PATH`);
  }
  if ((command === "cache-media" || command === "compose") && !draft) fail(`cinema-cli ${command} requires --draft PATH`);
  if ((command === "prepare" || command === "promote") && !envelope) {
    fail(`cinema-cli ${command} requires --envelope PATH`);
  }
  return {
    command,
    output,
    publicOnly,
    ...(date ? { date } : {}),
    ...(candidate ? { candidate } : {}),
    ...(draft ? { draft } : {}),
    ...(media ? { media } : {}),
    ...(envelope ? { envelope } : {}),
  };
}

async function atomicJson(path: string, value: unknown): Promise<string> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const encoded = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = resolve(dirname(path), `.${createHash("sha256").update(`${path}:${Date.now()}`).digest("hex").slice(0, 12)}.tmp`);
  await writeFile(temporary, encoded, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  return createHash("sha256").update(encoded).digest("hex");
}

function optionalComposioCaller(environment: NodeJS.ProcessEnv, publicOnly: boolean): ComposioToolCaller | undefined {
  if (publicOnly) return undefined;
  if (!environment.COMPOSIO_READ_MCP_URL?.trim() || !environment.COMPOSIO_READ_API_KEY?.trim()) return undefined;
  return createComposioReadToolCaller(composioReadConnectionFromEnvironment(environment));
}

export async function runCinemaCli(argv = process.argv.slice(2), environment = process.env): Promise<Record<string, unknown>> {
  const args = parseArguments([...argv]);
  const paths = briefingPaths(environment);
  const config = await loadCinemaRuntimeConfig(paths, environment);
  if (args.command === "prepare" || args.command === "promote") {
    const envelope = parseCinemaEnvelope(JSON.parse(await readFile(args.envelope!, "utf8")) as unknown);
    const payload = cinemaEnvelopeToBriefingPayload(envelope);
    const html = renderBriefingPage(payload);
    await initializeBriefingStore(paths);
    if (args.command === "prepare") {
      const database = openBriefingDatabase(paths);
      let alreadyPublished = false;
      try {
        const edition = loadEdition(database, { id: payload.edition.id });
        alreadyPublished = edition?.state === "complete" || edition?.state === "partial";
      } finally {
        database.close();
      }
      if (alreadyPublished) {
        validateRenderedHtml(html, payload);
        const digest = createHash("sha256").update(JSON.stringify(payload)).update("\0").update(html).digest("hex");
        return {
          ok: true,
          action: "cinema-prepare",
          renderer: "kurami-ui-components-v1",
          externalMutations: false,
          editionId: payload.edition.id,
          previewPath: "/cinema",
          digest,
          state: "prepared",
          publishedRevision: true,
        };
      }
      const prepared = await preparePreview(payload, html, paths);
      return {
        ok: true,
        action: "cinema-prepare",
        renderer: "kurami-ui-components-v1",
        externalMutations: false,
        ...prepared,
      };
    }
    const database = openBriefingDatabase(paths);
    let alreadyPublished = false;
    try {
      const edition = loadEdition(database, { id: payload.edition.id });
      alreadyPublished = edition?.state === "complete" || edition?.state === "partial";
      if (alreadyPublished) {
        const current = loadCinemaSnapshot(database);
        if (current && Date.parse(envelope.capturedAt) < Date.parse(current.capturedAt)) {
          fail("Cinema rerun is older than the current same-day snapshot");
        }
      }
      if (alreadyPublished) {
        database.close();
        const replaced = await replacePublishedAddonEdition(payload, html, "cinema", paths);
        return {
          ok: true,
          action: "cinema-promote",
          externalMutations: false,
          editionId: payload.edition.id,
          status: "promoted",
          localDate: envelope.data.localDate,
          contentDigest: addonEnvelopeDigest(envelope),
          publicationPath: replaced.publicationPath,
          publishedRevision: true,
        };
      }
      const promoted = promoteCinemaEdition(database, payload.edition.id, envelope);
      if (promoted.status === "rejected") fail(promoted.reason);
      return {
        ok: true,
        action: "cinema-promote",
        externalMutations: false,
        editionId: payload.edition.id,
        ...promoted,
      };
    } finally {
      if (database.isOpen) database.close();
    }
  }
  if (args.command === "cache-media") {
    const candidate = JSON.parse(await readFile(args.candidate!, "utf8")) as CinemaCollectionCandidate;
    const draft = JSON.parse(await readFile(args.draft!, "utf8")) as unknown;
    const cached = await cacheCinemaMedia({
      candidate,
      draft,
      config,
      mediaRoot: paths.mediaDirectory,
      retry: { attempts: 3, timeoutMs: 12_000, initialDelayMs: 300, maximumDelayMs: 2_000 },
    });
    const digest = await atomicJson(args.output, cached.media);
    return { ok: true, action: "cinema-cache-media", externalMutations: false, outputPath: args.output, digest, ...cached };
  }
  if (args.command === "compose" || args.command === "fallback") {
    const candidate = JSON.parse(await readFile(args.candidate!, "utf8")) as CinemaCollectionCandidate;
    const media = args.media
      ? JSON.parse(await readFile(args.media, "utf8")) as CinemaMediaMap
      : undefined;
    const envelope = args.command === "compose"
      ? composeCinemaEnvelope({
        candidate,
        draft: JSON.parse(await readFile(args.draft!, "utf8")) as unknown,
        config,
        media,
      })
      : composeCinemaFallbackEnvelope({ candidate, config, media });
    const digest = await atomicJson(args.output, envelope);
    return {
      ok: true,
      action: `cinema-${args.command}`,
      externalMutations: false,
      outputPath: args.output,
      digest,
      state: envelope.state,
      counts: {
        trailers: envelope.data.trailers.items.length,
        premieres: envelope.data.premieres.items.length,
        news: envelope.data.news.items.length,
      },
    };
  }
  const candidate = await collectCinemaCandidate({
    localDate: args.date!,
    config,
    caller: optionalComposioCaller(environment, args.publicOnly),
    retry: { attempts: 3, timeoutMs: 12_000, initialDelayMs: 300, maximumDelayMs: 2_000 },
  });
  const digest = await atomicJson(args.output, candidate);
  return {
    ok: true,
    action: "cinema-collect",
    externalMutations: false,
    outputPath: args.output,
    digest,
    states: {
      boxOffice: candidate.boxOffice.state,
      trailers: candidate.trailers.state,
      premieres: candidate.premieres.state,
      news: candidate.news.state,
    },
    counts: {
      trailers: candidate.trailers.candidates.length,
      premieres: candidate.premieres.candidates.length,
      news: candidate.news.candidates.length,
    },
    diagnostics: candidate.diagnostics,
  };
}

if (import.meta.main) {
  runCinemaCli().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  });
}
