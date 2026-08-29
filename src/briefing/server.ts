import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
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
  "media-src 'self'",
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
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      const label = button.querySelector('[data-theme-label]');
      if (label) label.textContent = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
      const icon = button.querySelector('[data-theme-icon]');
      if (icon) icon.textContent = theme === 'dark' ? '☀' : '◐';
    });
  };
  const storedTheme = localStorage.getItem('kurami-theme');
  applyTheme(storedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  const applyPersistedState = () => {
    const source = document.getElementById('briefing-state');
    if (!source) return;
    let state;
    try {
      state = JSON.parse(source.textContent || '{}');
    } catch {
      return;
    }
    if (!Array.isArray(state.items)) return;
    state.items.forEach((itemState) => {
      if (!itemState || typeof itemState.itemId !== 'string') return;
      document.querySelectorAll('[data-feed-item][data-item-id="' + CSS.escape(itemState.itemId) + '"]').forEach((story) => {
        story.classList.toggle('is-read', itemState.read === true);
        const panel = story.querySelector('[data-story-details]');
        if (panel) {
          panel.dataset.read = String(itemState.read === true);
          panel.classList.toggle('is-read', itemState.read === true);
        }
      });
      if (itemState.reaction !== 'like' && itemState.reaction !== 'dislike') return;
      document.querySelectorAll('[data-reaction][data-item-id="' + CSS.escape(itemState.itemId) + '"]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-reaction') === itemState.reaction));
      });
    });
  };
  applyPersistedState();

  const stickyHeader = document.querySelector('[data-utility-header]');
  const updateStickyHeader = () => stickyHeader?.classList.toggle('is-scrolled', window.scrollY > 4);
  updateStickyHeader();
  addEventListener('scroll', updateStickyHeader, { passive: true });

  const initializePaginatedFeeds = () => {
    document.querySelectorAll('[data-paginated-feed]').forEach((feed) => {
      const items = Array.from(feed.querySelectorAll('[data-feed-item]'));
      const requestedPageSize = Number.parseInt(feed.getAttribute('data-page-size') || '10', 10);
      const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : 10;
      const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
      const parameter = feed.getAttribute('data-page-param') || 'newsPage';
      const query = new URLSearchParams(location.search);
      let page = Math.min(totalPages, Math.max(1, Number.parseInt(query.get(parameter) || '1', 10) || 1));

      const renderPage = (moveFocus = false) => {
        const first = (page - 1) * pageSize;
        const last = first + pageSize;
        items.forEach((item, index) => {
          item.hidden = index < first || index >= last;
          item.setAttribute('aria-hidden', String(item.hidden));
          if (item.hidden) {
            const panel = item.querySelector('[data-story-details]');
            const toggle = item.querySelector('[data-story-toggle]');
            if (panel) panel.hidden = true;
            if (toggle) {
              toggle.setAttribute('aria-expanded', 'false');
              const label = toggle.querySelector('[data-disclosure-label]');
              if (label) label.textContent = 'Читать';
            }
            item.classList.remove('is-expanded');
          }
        });
        feed.querySelectorAll('[data-page-status]').forEach((status) => {
          status.textContent = 'Страница ' + page + ' из ' + totalPages;
        });
        feed.querySelectorAll('[data-page-range]').forEach((range) => {
          range.textContent = (first + 1) + '–' + Math.min(last, items.length) + ' из ' + items.length;
        });
        feed.querySelectorAll('[data-page-prev]').forEach((button) => {
          button.disabled = page <= 1;
        });
        feed.querySelectorAll('[data-page-next]').forEach((button) => {
          button.disabled = page >= totalPages;
        });
        feed.querySelectorAll('[data-page]').forEach((button) => {
          const selected = Number.parseInt(button.getAttribute('data-page') || '', 10) === page;
          button.setAttribute('aria-current', selected ? 'page' : 'false');
        });
        const nextQuery = new URLSearchParams(location.search);
        if (page === 1) nextQuery.delete(parameter);
        else nextQuery.set(parameter, String(page));
        const search = nextQuery.toString();
        history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + location.hash);
        if (moveFocus) {
          const heading = feed.querySelector('[data-feed-heading]') || feed;
          if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };

      feed.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-page-prev], [data-page-next], [data-page]') : null;
        if (!target || target.disabled) return;
        if (target.hasAttribute('data-page-prev')) page = Math.max(1, page - 1);
        else if (target.hasAttribute('data-page-next')) page = Math.min(totalPages, page + 1);
        else page = Math.min(totalPages, Math.max(1, Number.parseInt(target.getAttribute('data-page') || '1', 10) || 1));
        renderPage(true);
      });

      renderPage(false);
    });
  };
  initializePaginatedFeeds();

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-theme-toggle], [data-story-toggle], [data-reaction], [data-media-lightbox], [data-media-close]') : null;
    if (!target) return;
    if (target.hasAttribute('data-media-lightbox')) {
      event.preventDefault();
      const dialog = document.querySelector('[data-media-dialog]');
      const image = dialog?.querySelector('[data-media-dialog-image]');
      if (!(dialog instanceof HTMLDialogElement) || !(image instanceof HTMLImageElement)) return;
      image.src = target.getAttribute('data-media-src') || target.getAttribute('href') || '';
      image.alt = target.getAttribute('data-media-alt') || '';
      dialog.showModal();
      return;
    }
    if (target.hasAttribute('data-media-close')) {
      const dialog = target.closest('[data-media-dialog]');
      if (dialog instanceof HTMLDialogElement) dialog.close();
      return;
    }
    if (target.hasAttribute('data-theme-toggle')) {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('kurami-theme', next);
      applyTheme(next);
      return;
    }
    if (target.hasAttribute('data-story-toggle')) {
      const controls = target.getAttribute('aria-controls');
      const panel = controls ? document.getElementById(controls) : null;
      if (!panel) return;
      const willOpen = panel.hidden;
      const feed = target.closest('[data-paginated-feed]');
      if (feed) {
        feed.querySelectorAll('[data-story-details]:not([hidden])').forEach((other) => {
          if (other === panel) return;
          other.hidden = true;
          const otherToggle = feed.querySelector('[aria-controls="' + CSS.escape(other.id) + '"]');
          if (otherToggle) {
            otherToggle.setAttribute('aria-expanded', 'false');
            const otherLabel = otherToggle.querySelector('[data-disclosure-label]');
            if (otherLabel) otherLabel.textContent = 'Читать';
          }
          other.closest('[data-feed-item]')?.classList.remove('is-expanded');
        });
      }
      panel.hidden = !willOpen;
      target.setAttribute('aria-expanded', String(willOpen));
      const label = target.querySelector('[data-disclosure-label]');
      if (label) label.textContent = willOpen ? 'Свернуть' : 'Читать';
      target.closest('[data-feed-item]')?.classList.toggle('is-expanded', willOpen);
      if (!willOpen) return;
      const editionId = panel.dataset.editionId;
      const itemId = panel.dataset.itemId;
      if (!editionId || !itemId || panel.dataset.read === 'true') return;
      panel.dataset.read = 'true';
      panel.classList.add('is-read');
      const story = target.closest('[data-feed-item]');
      story?.classList.add('is-read');
      try {
        await request('/api/items/read', { editionId, itemId });
      } catch {
        panel.dataset.read = 'false';
        panel.classList.remove('is-read');
        story?.classList.remove('is-read');
      }
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

  document.querySelectorAll('[data-media-dialog]').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && dialog instanceof HTMLDialogElement) dialog.close();
    });
    dialog.addEventListener('close', () => {
      const image = dialog.querySelector('[data-media-dialog-image]');
      if (image instanceof HTMLImageElement) image.removeAttribute('src');
    });
  });

  document.addEventListener('toggle', async (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    const feed = details.closest('[data-paginated-feed]');
    if (feed) {
      feed.querySelectorAll('details[data-story-details][open]').forEach((other) => {
        if (other !== details) other.open = false;
      });
    }
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

type ClientItemState = {
  itemId: string;
  read: boolean;
  reaction: "like" | "dislike" | null;
};

function editionClientState(database: DatabaseSync, editionId: string): ClientItemState[] {
  const rows = database
    .prepare("SELECT item_id, read_at, reaction FROM edition_items WHERE edition_id = ?")
    .all(editionId) as Array<{
    item_id: string;
    read_at: string | null;
    reaction: "like" | "dislike" | null;
  }>;
  return rows.map((row) => ({
    itemId: row.item_id,
    read: row.read_at !== null,
    reaction: row.reaction,
  }));
}

function stateTag(items: ClientItemState[]): string {
  const json = JSON.stringify({ items })
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  return `<script id="briefing-state" type="application/json">${json}</script>`;
}

function injectRuntime(html: string, items: ClientItemState[] = []): string {
  const tag = '<script src="/assets/briefing.js" defer></script>';
  return html.replace(/<\/body>/i, `${stateTag(items)}${tag}</body>`);
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

const MEDIA_TYPES = new Map<string, string>([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
]);

function resolvedMediaPath(paths: BriefingPaths, pathname: string): string {
  const raw = decodeURIComponent(pathname.slice("/media/".length));
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(raw) || raw.includes("..")) {
    throw new Error("Unsafe media path");
  }
  const candidate = resolve(paths.mediaDirectory, raw);
  const child = relative(paths.mediaDirectory, candidate);
  if (child.startsWith("..") || resolve(paths.mediaDirectory, child) !== candidate) {
    throw new Error("Media path escapes edition cache");
  }
  if (!MEDIA_TYPES.has(extname(candidate).toLowerCase())) throw new Error("Unsupported media type");
  return candidate;
}

async function serveMedia(
  request: IncomingMessage,
  response: ServerResponse,
  paths: BriefingPaths,
  pathname: string,
): Promise<void> {
  const path = resolvedMediaPath(paths, pathname);
  const file = await stat(path);
  if (!file.isFile()) throw new Error("Media path is not a file");
  const contentType = MEDIA_TYPES.get(extname(path).toLowerCase())!;
  response.setHeader("content-type", contentType);
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("cache-control", "private, max-age=3600");
  response.setHeader("x-content-type-options", "nosniff");
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = file.size - 1;
  if (range) {
    if (!range[1] && range[2]) {
      const suffix = Number.parseInt(range[2], 10);
      start = Math.max(0, file.size - suffix);
    } else {
      if (range[1]) start = Number.parseInt(range[1], 10);
      if (range[2]) end = Number.parseInt(range[2], 10);
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= file.size) {
      response.statusCode = 416;
      response.setHeader("content-range", `bytes */${file.size}`);
      response.end();
      return;
    }
    response.statusCode = 206;
    response.setHeader("content-range", `bytes ${start}-${end}/${file.size}`);
  } else {
    response.statusCode = 200;
  }
  response.setHeader("content-length", String(end - start + 1));
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path, { start, end });
    stream.once("error", reject);
    response.once("finish", resolvePromise);
    stream.pipe(response);
  });
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
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kurami Briefing</title><style>:root{color-scheme:light dark}body{margin:0;padding:48px;font:16px/1.5 system-ui;background:#faf9f6;color:#111}html[data-theme=dark] body{background:#0a0a0a;color:#f7f4ec}main{max-width:760px;margin:auto;border:1px solid #888;padding:32px}h1{font-size:32px;margin:0 0 12px}button{min-height:44px;padding:8px 14px;float:right}</style></head><body><button type="button" data-theme-toggle><span data-theme-icon aria-hidden="true">◐</span> <span data-theme-label>Тёмная тема</span></button><main><h1>Briefing ещё не опубликован</h1><p>Runtime работает. Подготовленный preview будет доступен по своему адресу.</p></main></body></html>`;
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
  response.end(injectRuntime(html, editionClientState(database, edition.id)));
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
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/media/")) {
        await serveMedia(request, response, paths, url.pathname);
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
