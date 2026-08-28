import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import {
  briefingPaths,
  initializeBriefingStore,
  loadEdition,
  markItemRead,
  openBriefingDatabase,
  readEditionHtml,
  setReaction,
  topicProfile,
  type BriefingPaths,
  type EditionRow,
} from "./store.ts";

const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self' data: https://fonts.gstatic.com",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
].join("; ");

const CLIENT_SCRIPT = `(() => {
  const request = async (path, body) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };

  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
    });
  };
  const storedTheme = localStorage.getItem('kurami-theme');
  applyTheme(storedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-theme-toggle], [data-reaction]') : null;
    if (!target) return;
    if (target.hasAttribute('data-theme-toggle')) {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('kurami-theme', next);
      applyTheme(next);
      return;
    }
    const reaction = target.getAttribute('data-reaction');
    const editionId = target.getAttribute('data-edition-id');
    const itemId = target.getAttribute('data-item-id');
    if (!reaction || !editionId || !itemId) return;
    target.setAttribute('aria-busy', 'true');
    try {
      await request('/api/stories/reaction', { editionId, itemId, reaction });
      document.querySelectorAll('[data-reaction][data-edition-id="' + CSS.escape(editionId) + '"][data-item-id="' + CSS.escape(itemId) + '"]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-reaction') === reaction && reaction !== 'clear'));
      });
    } finally {
      target.removeAttribute('aria-busy');
    }
  });

  document.addEventListener('toggle', async (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    const editionId = details.dataset.editionId;
    const itemId = details.dataset.itemId;
    if (!editionId || !itemId || details.dataset.read === 'true') return;
    details.dataset.read = 'true';
    details.classList.add('is-read');
    try {
      await request('/api/items/read', { editionId, itemId });
    } catch {
      details.dataset.read = 'false';
      details.classList.remove('is-read');
    }
  }, true);
})();`;

function sendHeaders(response: ServerResponse, contentType: string): void {
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", CSP);
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  sendHeaders(response, "application/json; charset=utf-8");
  response.statusCode = status;
  response.end(`${JSON.stringify(value)}\n`);
}

function text(response: ServerResponse, status: number, value: string): void {
  sendHeaders(response, "text/plain; charset=utf-8");
  response.statusCode = status;
  response.end(value);
}

function injectRuntime(html: string): string {
  const tag = '<script src="/assets/briefing.js" defer></script>';
  return html.replace(/<\/body>/i, `${tag}</body>`);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16 * 1024) throw new Error("Request body exceeds 16 KiB");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request body must be an object");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function routeEdition(database: DatabaseSync, pathname: string): EditionRow | null {
  if (pathname === "/") return loadEdition(database, { type: "daily", current: true });
  if (pathname === "/cinema") return loadEdition(database, { type: "cinema", current: true });
  let match = pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (match) {
    const edition = loadEdition(database, { type: "daily", date: match[1] });
    return edition && (edition.state === "complete" || edition.state === "partial")
      ? edition
      : null;
  }
  match = pathname.match(/^\/preview\/(daily|cinema)\/(\d{4}-\d{2}-\d{2})$/);
  if (match) {
    const edition = loadEdition(database, {
      type: match[1] as "daily" | "cinema",
      date: match[2],
    });
    return edition?.preview_enabled === 1 ? edition : null;
  }
  return null;
}

function emptyPage(): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kurami Briefing</title><style>body{margin:0;padding:48px;font:16px/1.5 system-ui;background:#faf9f6;color:#111}main{max-width:760px;margin:auto;border:1px solid #ccc;padding:32px}h1{font-size:32px;margin:0 0 12px}</style></head><body><main><h1>Briefing ещё не опубликован</h1><p>Runtime работает. Подготовленный preview будет доступен по своему адресу.</p></main></body></html>`;
}

async function serveEdition(
  response: ServerResponse,
  database: DatabaseSync,
  edition: EditionRow | null,
  paths: BriefingPaths,
  allowEmpty: boolean,
): Promise<void> {
  if (!edition) {
    if (!allowEmpty) {
      text(response, 404, "Briefing edition not found\n");
      return;
    }
    sendHeaders(response, "text/html; charset=utf-8");
    response.statusCode = 200;
    response.end(injectRuntime(emptyPage()));
    return;
  }
  const html = await readEditionHtml(edition, paths);
  sendHeaders(response, "text/html; charset=utf-8");
  response.statusCode = 200;
  response.end(injectRuntime(html));
}

export async function createBriefingServer(
  paths: BriefingPaths = briefingPaths(),
): Promise<Server> {
  await initializeBriefingStore(paths);
  const database = openBriefingDatabase(paths);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        const integrity = database.prepare("PRAGMA integrity_check").get() as {
          integrity_check: string;
        };
        const editions = database.prepare("SELECT COUNT(*) AS count FROM editions").get() as {
          count: number;
        };
        json(response, integrity.integrity_check === "ok" ? 200 : 503, {
          ok: integrity.integrity_check === "ok",
          database: integrity.integrity_check,
          editions: Number(editions.count),
          externalMutations: false,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/assets/briefing.js") {
        sendHeaders(response, "text/javascript; charset=utf-8");
        response.statusCode = 200;
        response.end(CLIENT_SCRIPT);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/profile/topics") {
        json(response, 200, { topics: topicProfile(database) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/items/read") {
        const input = await body(request);
        const editionId = requiredString(input.editionId, "editionId");
        const itemId = requiredString(input.itemId, "itemId");
        json(response, 200, { ok: true, readAt: markItemRead(database, editionId, itemId) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/stories/reaction") {
        const input = await body(request);
        const editionId = requiredString(input.editionId, "editionId");
        const itemId = requiredString(input.itemId, "itemId");
        if (input.reaction !== "like" && input.reaction !== "dislike" && input.reaction !== "clear") {
          throw new Error("Invalid reaction");
        }
        setReaction(database, editionId, itemId, input.reaction);
        json(response, 200, { ok: true, reaction: input.reaction });
        return;
      }
      if (request.method === "GET") {
        const edition = routeEdition(database, url.pathname);
        await serveEdition(response, database, edition, paths, url.pathname === "/");
        return;
      }
      text(response, 404, "Not found\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(response, 400, { ok: false, error: message });
    }
  });
  server.on("close", () => database.close());
  return server;
}

export async function runBriefingServer(): Promise<void> {
  const host = process.env.BRIEFING_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("Runtime MVP may listen only on loopback");
  }
  const port = Number.parseInt(process.env.BRIEFING_PORT ?? "8787", 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("BRIEFING_PORT must be between 1024 and 65535");
  }
  const server = await createBriefingServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolvePromise());
  });
  process.stdout.write(`${JSON.stringify({ ok: true, host, port, externalMutations: false })}\n`);
}

if (import.meta.main) {
  runBriefingServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
