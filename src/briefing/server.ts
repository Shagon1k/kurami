import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { nodeHttpFetch } from "./providers/node-http-fetch.ts";
import {
  briefingPaths,
  finishMailReadAndArchive,
  initializeBriefingStore,
  loadEdition,
  markItemRead,
  openBriefingDatabase,
  prepareMailReadAndArchive,
  readEditionHtml,
  setReaction,
  topicProfile,
  type BriefingPaths,
  type EditionRow,
} from "./store.ts";

export type MailActionExecutor = (input: {
  actionId: string;
  messageIds: string[];
}) => Promise<{ receipt: unknown }>;

export const MAIL_AUTOMATION_MAX_ATTEMPTS = 3;
const MAIL_AUTOMATION_RETRY_DELAYS_MS = [300, 900] as const;
const DEFAULT_MAIL_AUTOMATION_TIMEOUT_MS = 10_000;

export type MailAutomationFailureKind =
  | "fetch_failed"
  | "timeout"
  | "connection"
  | "rate_limited"
  | "upstream_unavailable"
  | "provider_rejected"
  | "unknown";

function errorDetails(error: unknown, seen = new Set<unknown>()): string[] {
  if (error === null || error === undefined || seen.has(error)) return [];
  seen.add(error);
  const details: string[] = [];
  if (error instanceof Error) {
    details.push(error.name, error.message);
    const enrichedError = error as Error & { cause?: unknown; code?: unknown };
    if (typeof enrichedError.code === "string") details.push(enrichedError.code);
    const cause = enrichedError.cause;
    if (cause !== undefined) details.push(...errorDetails(cause, seen));
  } else if (typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; errors?: unknown };
    if (typeof candidate.code === "string") details.push(candidate.code);
    if (typeof candidate.message === "string") details.push(candidate.message);
    if (Array.isArray(candidate.errors)) {
      for (const nested of candidate.errors) details.push(...errorDetails(nested, seen));
    }
  } else {
    details.push(String(error));
  }
  return details;
}

export function mailAutomationFailureKind(error: unknown): MailAutomationFailureKind {
  const details = errorDetails(error).join(" ").toLowerCase();
  if (details.includes("gmail provider rejected")) return "provider_rejected";
  if (details.includes("fetch failed")) return "fetch_failed";
  if (/abort|timeout|timed out|etimedout/.test(details)) return "timeout";
  if (/econnreset|econnrefused|enotfound|eai_again|socket hang up|network/.test(details)) {
    return "connection";
  }
  if (/\b429\b|rate.?limit|resource exhausted/.test(details)) return "rate_limited";
  if (/\b5\d{2}\b|bad gateway|service unavailable|gateway timeout/.test(details)) {
    return "upstream_unavailable";
  }
  return "unknown";
}

function transientMailAutomationFailure(kind: MailAutomationFailureKind): boolean {
  return kind !== "provider_rejected" && kind !== "unknown";
}

function mailAutomationTimeout(environment: NodeJS.ProcessEnv): number {
  const configured = Number.parseInt(environment.COMPOSIO_AUTOMATION_TIMEOUT_MS ?? "", 10);
  if (!Number.isInteger(configured)) return DEFAULT_MAIL_AUTOMATION_TIMEOUT_MS;
  return Math.min(30_000, Math.max(1_000, configured));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

type MailAutomationProviderDecision = "accepted" | "rejected" | "unknown";

function mailAutomationRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mailAutomationErrorPresent(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function mailAutomationProviderDecision(
  value: unknown,
  depth = 0,
): MailAutomationProviderDecision {
  const payload = mailAutomationRecord(value);
  if (!payload) return "unknown";
  if (payload.successful === false || payload.ok === false || mailAutomationErrorPresent(payload.error)) {
    return "rejected";
  }
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  if (["error", "failed", "failure", "rejected"].includes(status)) return "rejected";
  const nested: MailAutomationProviderDecision[] = [];
  if (depth < 1) {
    for (const wrapper of ["result", "data"] as const) {
      if (payload[wrapper] === undefined) continue;
      nested.push(mailAutomationProviderDecision(payload[wrapper], depth + 1));
    }
  }
  if (nested.includes("rejected")) return "rejected";
  if (payload.successful === true || payload.ok === true
    || ["ok", "success", "successful", "complete", "completed"].includes(status)) {
    return "accepted";
  }
  if (nested.includes("accepted")) return "accepted";
  return "unknown";
}

function mailAutomationTextPayload(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Mutation responses must include an explicit positive provider acknowledgement.
 * Provider payloads are deliberately never included in thrown errors or receipts.
 */
export function assertComposioMailActionSucceeded(value: unknown): void {
  const response = mailAutomationRecord(value);
  if (!response || response.isError === true) {
    throw new Error("Gmail provider rejected the batch action");
  }
  const decisions: MailAutomationProviderDecision[] = [mailAutomationProviderDecision(response)];
  if (response.structuredContent !== undefined) {
    decisions.push(mailAutomationProviderDecision(response.structuredContent));
  }
  if (Array.isArray(response.content)) {
    for (const entry of response.content) {
      const block = mailAutomationRecord(entry);
      if (block?.type !== "text") continue;
      decisions.push(mailAutomationProviderDecision(mailAutomationTextPayload(block.text)));
    }
  }
  if (decisions.includes("rejected") || !decisions.includes("accepted")) {
    throw new Error("Gmail provider rejected the batch action");
  }
}

function composioMailActionExecutor(environment: NodeJS.ProcessEnv): MailActionExecutor | null {
  const url = environment.COMPOSIO_AUTOMATION_MCP_URL?.trim();
  const apiKey = environment.COMPOSIO_AUTOMATION_API_KEY?.trim();
  if (!url || !apiKey) return null;
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return null;
  const timeoutMs = mailAutomationTimeout(environment);
  const restrictedFetch: typeof fetch = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== endpoint.origin) throw new Error("Composio automation cross-origin request denied");
    return nodeHttpFetch(input, { ...init, redirect: "error" });
  };
  return async ({ actionId, messageIds }) => {
    let lastError: unknown = new Error("Gmail automation failed before execution");
    for (let attempt = 1; attempt <= MAIL_AUTOMATION_MAX_ATTEMPTS; attempt += 1) {
      const client = new Client({ name: "kurami-briefing", version: "1.0.0" });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const transport = new StreamableHTTPClientTransport(endpoint, {
        requestInit: {
          headers: { "x-api-key": apiKey },
          signal: controller.signal,
        },
        fetch: restrictedFetch,
      });
      let phase: "connect" | "callTool" = "connect";
      try {
        await client.connect(transport);
        phase = "callTool";
        const response = await client.callTool({
          name: "GMAIL_BATCH_MODIFY_MESSAGES",
          arguments: {
            userId: "me",
            messageIds,
            addLabelIds: [],
            removeLabelIds: ["INBOX", "UNREAD"],
          },
        });
        assertComposioMailActionSucceeded(response);
        if (attempt > 1) {
          console.info(JSON.stringify({
            event: "briefing.mail_action_recovered",
            actionId,
            attempt,
            phase,
          }));
        }
        return {
          receipt: {
            actionId,
            provider: "composio-gmail",
            messageCount: messageIds.length,
            attempts: attempt,
            completedAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        lastError = error;
        const kind = mailAutomationFailureKind(error);
        const willRetry = transientMailAutomationFailure(kind) && attempt < MAIL_AUTOMATION_MAX_ATTEMPTS;
        console.warn(JSON.stringify({
          event: "briefing.mail_action_attempt_failed",
          actionId,
          attempt,
          maxAttempts: MAIL_AUTOMATION_MAX_ATTEMPTS,
          phase,
          kind,
          willRetry,
        }));
        if (!willRetry) throw error;
      } finally {
        clearTimeout(timeout);
        await client.close().catch(() => undefined);
      }
      await wait(MAIL_AUTOMATION_RETRY_DELAYS_MS[attempt - 1] ?? 0);
    }
    throw lastError;
  };
}

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

  const updateLiveClocks = () => {
    const instant = new Date();
    document.querySelectorAll('[data-live-clock]').forEach((clock) => {
      const timeZone = clock.getAttribute('data-timezone') || 'Europe/Vilnius';
      try {
        clock.textContent = new Intl.DateTimeFormat('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone,
        }).format(instant);
      } catch {
        clock.textContent = '--:--';
      }
    });
  };
  updateLiveClocks();
  setInterval(updateLiveClocks, 30_000);

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

  document.querySelectorAll('[data-overflow="true"]').forEach((region) => {
    region.addEventListener('keydown', (event) => {
      if (event.target !== region) return;
      const steps = {
        ArrowDown: 48,
        ArrowUp: -48,
        PageDown: Math.max(120, Math.round(region.clientHeight * 0.8)),
        PageUp: -Math.max(120, Math.round(region.clientHeight * 0.8)),
        Home: -region.scrollHeight,
        End: region.scrollHeight,
      };
      const amount = steps[event.key];
      if (amount === undefined) return;
      event.preventDefault();
      region.scrollBy({ top: amount, behavior: 'smooth' });
    });
  });

  const refreshMailSelection = (section) => {
    const choices = Array.from(section.querySelectorAll('[data-mail-select]:not(:disabled)'));
    const selected = choices.filter((input) => input.checked);
    const selectAll = section.querySelector('[data-mail-select-all]');
    if (selectAll) {
      selectAll.checked = choices.length > 0 && selected.length === choices.length;
      selectAll.indeterminate = selected.length > 0 && selected.length < choices.length;
      selectAll.disabled = choices.length === 0;
      selectAll.closest('[data-selection-control]')?.classList.toggle('is-disabled', choices.length === 0);
    }
    const count = section.querySelector('[data-mail-selection]');
    if (count) count.textContent = selected.length + ' выбрано';
    const action = section.querySelector('[data-mail-archive]');
    if (action) action.disabled = selected.length === 0;
  };
  document.querySelectorAll('[data-mail-section]').forEach((section) => {
    section.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.hasAttribute('data-mail-select-all')) {
        section.querySelectorAll('[data-mail-select]:not(:disabled)').forEach((choice) => {
          choice.checked = target.checked;
        });
      }
      refreshMailSelection(section);
    });
    refreshMailSelection(section);
  });

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-theme-toggle], [data-story-toggle], [data-reaction], [data-media-lightbox], [data-media-close], [data-mail-archive]') : null;
    if (!target) return;
    if (target.hasAttribute('data-mail-archive')) {
      const section = target.closest('[data-mail-section]');
      if (!section) return;
      const editionId = section.getAttribute('data-edition-id');
      const itemIds = Array.from(section.querySelectorAll('[data-mail-select]:checked')).map((input) => input.value);
      if (!editionId || itemIds.length === 0) return;
      const status = section.querySelector('[data-mail-status]');
      target.disabled = true;
      target.setAttribute('aria-busy', 'true');
      if (status) status.textContent = 'Обрабатываю…';
      try {
        const result = await request('/api/mail/read-and-archive', { editionId, itemIds });
        itemIds.forEach((itemId) => {
          const row = section.querySelector('[data-mail-item="' + CSS.escape(itemId) + '"]');
          const choice = row?.querySelector('[data-mail-select]');
          if (choice instanceof HTMLInputElement) {
            choice.checked = false;
            choice.disabled = true;
          }
          row?.classList.add('is-archived');
        });
        if (status) status.textContent = result.alreadyComplete ? 'Уже обработано' : 'Прочитано и отправлено в архив';
        refreshMailSelection(section);
      } catch {
        if (status) status.textContent = 'Не удалось обработать. Письма оставлены без изменений.';
        target.disabled = false;
      } finally {
        target.removeAttribute('aria-busy');
      }
      return;
    }
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
  // Legacy read path only. The importer rejects new video assets.
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
  options: { mailActionExecutor?: MailActionExecutor | null } = {},
): Promise<Server> {
  await initializeBriefingStore(paths);
  const database = openBriefingDatabase(paths);
  const mailActionExecutor = options.mailActionExecutor === undefined
    ? composioMailActionExecutor(process.env)
    : options.mailActionExecutor;
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
          externalMutations: mailActionExecutor !== null,
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
      if (request.method === "POST" && url.pathname === "/api/mail/read-and-archive") {
        if (!mailActionExecutor) throw new Error("Gmail automation is not configured");
        const input = await body(request);
        const editionId = requiredString(input.editionId, "editionId");
        if (!Array.isArray(input.itemIds)) throw new Error("Invalid itemIds");
        const itemIds = input.itemIds.map((itemId, index) => requiredString(itemId, `itemIds[${index}]`));
        const action = prepareMailReadAndArchive(database, editionId, itemIds);
        if (action.alreadyComplete) {
          json(response, 200, { ok: true, alreadyComplete: true, itemIds: action.itemIds });
          return;
        }
        try {
          const executed = await mailActionExecutor({
            actionId: action.actionId,
            messageIds: action.providerMessageIds,
          });
          finishMailReadAndArchive(database, action, { ok: true, receipt: executed.receipt });
          json(response, 200, { ok: true, alreadyComplete: false, itemIds: action.itemIds });
        } catch (error) {
          finishMailReadAndArchive(database, action, {
            ok: false,
            receipt: { error: error instanceof Error ? error.message : "Gmail automation failed" },
          });
          throw error;
        }
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
  const externalMutations = Boolean(
    process.env.COMPOSIO_AUTOMATION_MCP_URL?.trim()
      && process.env.COMPOSIO_AUTOMATION_API_KEY?.trim(),
  );
  process.stdout.write(`${JSON.stringify({ ok: true, host, port, externalMutations })}\n`);
}

if (import.meta.main) {
  runBriefingServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
