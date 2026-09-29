import { CHART_CLIENT_SCRIPT } from "./ui/charts/client.ts";
import {STOCKS_CLIENT_SCRIPT} from "./stocks/client.ts";
import {renderStocksPage} from "./stocks/render.ts";
import {renderStockDetails} from "./stocks/components.ts";
import {loadDiscovery} from "./stocks/discovery.ts";
import {loadCompanyLogoDomains} from "./stocks/logos.ts";
import {COMPANY_AVATAR_CLIENT_SCRIPT} from "./ui/components/company-avatar.ts";
import {loadStocksCache} from "./stocks/collector.ts";
import {loadReview,type StoredReview} from "./investment-review/store.ts";
import {publishedSiteLinks} from "./site-navigation.ts";
import {injectSiteNavigation} from "./ui/components/site-header.ts";
import {renderPageShell} from "./ui/page-shell.ts";
import {renderWeeklyPage} from "./weekly/render.ts";
import {loadWeeklyReview} from "./weekly/lifecycle.ts";
import {buildWeeklyReview} from "./weekly/build.ts";
import {localDate as weeklyLocalDate} from "./weekly/model.ts";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
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
  topicPairProfile,
  topicRegistry,
  type BriefingPaths,
  type EditionRow,
} from "./store.ts";
import { loadBriefingRuntimeConfig } from "./runtime-config.ts";
import { latestBriefingAttempt } from "./run-attempt.ts";
import { parseBriefingPayload } from "./model.ts";
import { section } from "./addons/envelopes.ts";
import { FONT_FACES, fontFiles } from "../ui-library/foundations/fonts.ts";
import { THEME_RUNTIME_JS, THEME_SCRIPT_TAG } from "../ui-library/runtime/theme.ts";
import { buildInterestProfile, personalizedNewsOrder } from "./interest-profile.ts";
import { loadTopicPolicy } from "./editorial-validation.ts";

const FAVICON_PATH = new URL(
  "../../integrations/hermes/skills/kurami-ui-preview-language/assets/kurami-favicon.svg",
  import.meta.url,
);
const FOX_LOGO_PATH = new URL(
  "../../integrations/hermes/skills/kurami-ui-preview-language/assets/kurami-fox-transparent.png",
  import.meta.url,
);
const FONT_DIRECTORY = new URL("../../src/ui-library/assets/fonts/", import.meta.url);
const GOOGLE_FONTS = /<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*/gi;

export { removeArchivedMailFromRetainedEditions } from "./addons/mail/actions.ts";
import { removeArchivedMailFromRetainedEditions } from "./addons/mail/actions.ts";
export { MAIL_AUTOMATION_MAX_ATTEMPTS, mailAutomationFailureKind, assertComposioMailActionSucceeded, type MailActionExecutor, type MailAutomationFailureKind } from "./addons/mail/executor.ts";
import { composioMailActionExecutor, type MailActionExecutor } from "./addons/mail/executor.ts";

const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "media-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
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

  const updateLiveClocks = () => {
    const instant = new Date();
    document.querySelectorAll('[data-signal-strip]').forEach(strip => {
      try {
        const date = new Intl.DateTimeFormat('en-CA', {timeZone:strip.dataset.signalTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);
        strip.querySelectorAll('[data-signal-item]').forEach(item => {
          item.hidden = Boolean(item.dataset.signalExpires) && !(instant.getTime() < Date.parse(item.dataset.signalExpires));
        });
        strip.hidden = date !== strip.dataset.signalDate || !(instant.getTime() < Date.parse(strip.dataset.signalUntil))
          || !Array.from(strip.querySelectorAll('[data-signal-item]')).some(item => !item.hidden);
      } catch { strip.hidden = true; }
    });
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
      document.querySelectorAll('[data-reaction][data-item-id="' + CSS.escape(itemState.itemId) + '"]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-reaction') === itemState.reaction));
      });
    });
  };
  applyPersistedState();

  const stickyHeader = document.querySelector('[data-utility-header]');
  const updateStickyHeader = () => stickyHeader?.classList.toggle('is-scrolled', window.scrollY > 0);
  if (stickyHeader && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => document.documentElement.style.setProperty('--header-offset', Math.ceil(stickyHeader.getBoundingClientRect().height + 16) + 'px')).observe(stickyHeader);
  }
  updateStickyHeader();
  addEventListener('scroll', updateStickyHeader, { passive: true });

  const initializePaginatedFeeds = () => {
    document.querySelectorAll('[data-paginated-feed]').forEach((feed) => {
      const editorialItems = Array.from(feed.querySelectorAll('[data-feed-item]'));
      let items = [...editorialItems];
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
        feed.querySelectorAll('[data-page-input]').forEach((input) => {
          input.value = String(page);
          input.setAttribute('aria-label', 'Номер страницы ' + page + ' из ' + totalPages);
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

      const commitPageInput = (input) => {
        const requested = Number.parseInt(input.value || '', 10);
        if (!Number.isInteger(requested)) {
          input.value = String(page);
          return;
        }
        page = Math.min(totalPages, Math.max(1, requested));
        renderPage(true);
      };
      feed.querySelectorAll('[data-page-input]').forEach((input) => {
        input.addEventListener('change', () => commitPageInput(input));
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commitPageInput(input);
        });
      });

      const orderButtons = Array.from(feed.querySelectorAll('[data-news-order]'));
      const interestStatus = feed.querySelector('[data-interest-status]');
      const evidence = feed.querySelector('[data-interest-weights]');
      const applyOrder = async (requested, resetPage = true) => {
        orderButtons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
        if (interestStatus) interestStatus.textContent = 'Загружаю профиль интересов…';
        try {
          const editionId = feed.getAttribute('data-edition-id');
          const response = await fetch('/api/news/order?editionId=' + encodeURIComponent(editionId || '') + '&mode=' + encodeURIComponent(requested));
          if (!response.ok) throw new Error('Order unavailable');
          const result = await response.json();
          const byId = new Map(editorialItems.map(item => [item.getAttribute('data-item-id'), item]));
          if (!Array.isArray(result.order) || result.order.length !== editorialItems.length
            || new Set(result.order).size !== editorialItems.length || result.order.some(id => !byId.has(id))) throw new Error('Edition changed');
          items = result.order.map(id => byId.get(id));
          feed.querySelector('.digest-feed__items')?.append(...items);
          items.forEach((item, index) => {
            const ordinal = item.querySelector('.news-story__index');
            if (ordinal) ordinal.textContent = String(index + 1).padStart(2, '0');
            const reason = item.querySelector('[data-interest-reason]');
            const detail = result.details.find(detail => detail.id === item.getAttribute('data-item-id'));
            if (reason) {
              reason.hidden = result.mode !== 'for-you' || (!detail?.protected && !detail?.reasons.length);
              const main = detail?.reasons[0];
              reason.textContent = detail?.protected ? 'Важное — приоритет сохранён'
                : main ? (main.points > 0 ? 'Больше такого: ' : 'Меньше такого: ') + main.label : '';
            }
          });
          orderButtons.forEach(button => button.setAttribute('aria-pressed', String(button.getAttribute('data-news-order') === result.mode)));
          const nextQuery = new URLSearchParams(location.search);
          if (result.mode === 'for-you') nextQuery.set('newsOrder', 'for-you'); else nextQuery.delete('newsOrder');
          const search = nextQuery.toString();
          history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + location.hash);
          if (resetPage) page = 1;
          renderPage(false);
          const count = result.profile.reactions;
          const coverage = feed.querySelector('[data-interest-coverage]');
          if (coverage) coverage.textContent = 'Источник известен для ' + result.profile.withSourceContext + ' из ' + count + ' реакций. Остальные учитываются по сохранённым темам.';
          if (interestStatus) interestStatus.textContent = !result.profile.ready
            ? 'Пока обычный обзор: ' + count + ' из ' + result.profile.policy.minimumReactions + ' реакций для персонализации. Все сюжеты доступны.'
            : (result.mode === 'for-you' ? 'Порядок для вас' : 'Утренний порядок') + ' · учтено реакций: ' + count + '. Все сюжеты доступны.';
          if (evidence) {
            evidence.replaceChildren();
            result.profile.weights.filter(value => value.weight !== 0).slice(0, 8).forEach(value => {
              const row = document.createElement('li');
              row.textContent = value.label + ': ' + (value.weight > 0 ? '+' : '') + value.weight.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' · реакций: ' + value.evidence;
              evidence.append(row);
            });
          }
        } catch {
          if (interestStatus) interestStatus.textContent = 'Не удалось обновить профиль. Текущий порядок сохранён; можно повторить.';
        } finally {
          orderButtons.forEach(button => { button.disabled = false; button.removeAttribute('aria-busy'); });
        }
      };
      orderButtons.forEach(button => button.addEventListener('click', () => applyOrder(button.getAttribute('data-news-order'))));
      feed.addEventListener('kurami:reaction-saved', () => {
        if (interestStatus) interestStatus.textContent = 'Реакция сохранена. Нажмите «Для меня», чтобы обновить порядок.';
      });
      renderPage(false);
      if (orderButtons.length) applyOrder(query.get('newsOrder') === 'for-you' ? 'for-you' : 'briefing', false);
    });
  };
  initializePaginatedFeeds();

${CHART_CLIENT_SCRIPT}
${STOCKS_CLIENT_SCRIPT}
${COMPANY_AVATAR_CLIENT_SCRIPT}

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
    const target = event.target instanceof Element ? event.target.closest('[data-story-toggle], [data-reaction], [data-media-lightbox], [data-media-close], [data-mail-archive]') : null;
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
    const requestedReaction = target.getAttribute('data-reaction');
    const reaction = target.getAttribute('aria-pressed') === 'true' ? 'clear' : requestedReaction;
    const editionId = target.getAttribute('data-edition-id');
    const itemId = target.getAttribute('data-item-id');
    if (!reaction || !editionId || !itemId) return;
    const group = Array.from(target.closest('.reaction-group')?.querySelectorAll('button') || []);
    if (target.disabled) return;
    group.forEach(button => { button.disabled = true; });
    target.setAttribute('aria-busy', 'true');
    try {
      await request('/api/stories/reaction', { editionId, itemId, reaction });
      document.querySelectorAll('[data-reaction][data-edition-id="' + CSS.escape(editionId) + '"][data-item-id="' + CSS.escape(itemId) + '"]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-reaction') === reaction && reaction !== 'clear'));
      });
      target.closest('[data-paginated-feed]')?.dispatchEvent(new CustomEvent('kurami:reaction-saved'));
    } catch {
      const status = target.closest('[data-paginated-feed]')?.querySelector('[data-interest-status]');
      if (status) status.textContent = 'Не удалось сохранить реакцию. Попробуйте ещё раз.';
    } finally {
      target.removeAttribute('aria-busy');
      group.forEach(button => { button.disabled = false; });
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

export function injectRuntime(html: string, items: ClientItemState[] = []): string {
  // Editions frozen before self-hosted fonts still link Google Fonts; serve the same faces locally.
  if (html.includes("fonts.googleapis.com")) html = html.replace(GOOGLE_FONTS, "").replace(/<\/head>/i, `<style>${FONT_FACES}</style></head>`);
  // Every served page, including frozen editions, gets the shared theme runtime before first paint.
  if (!html.includes(THEME_SCRIPT_TAG)) html = html.replace(/<\/head>/i, `${THEME_SCRIPT_TAG}</head>`);
  const favicon = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
  const themeColor = '<meta name="theme-color" content="#fbfbf8">';
  const branded = html.includes('href="/favicon.svg"')
    ? html
    : html.replace(/<\/head>/i, `${themeColor}${favicon}</head>`);
  const tag = '<script src="/assets/briefing.js" defer></script>';
  return branded.replace(/<\/body>/i, `${stateTag(items)}${tag}</body>`);
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

function errorResponse(error: unknown): { status: number; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (/not found|unknown briefing edition|unknown briefing attempt/.test(lower)) return { status: 404, message: raw };
  if (/transition|already|stale|conflict|not prepared|does not match/.test(lower)) return { status: 409, message: raw };
  if (/not configured|unavailable|disabled/.test(lower)) return { status: 503, message: raw };
  if (/provider|fetch|network|timeout|rate.?limit|upstream/.test(lower)) return { status: 502, message: "Upstream provider request failed" };
  if (/invalid|required|must |exceeds|unsafe|unsupported|request body/.test(lower)) return { status: 400, message: raw };
  return { status: 500, message: "Internal briefing error" };
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
  return renderPageShell({title:"Briefing ещё не опубликован",brand:"Kurami",section:"daily",
    date:new Date().toISOString().slice(0,10),dateLabel:"Дневной обзор",generated:"—",timezone:"Europe/Vilnius",
    content:'<section class="hero"><div><p class="hero__eyebrow">Daily Briefing</p><h1>Briefing ещё не опубликован</h1><p class="hero__subtitle">Здесь появится следующий готовый выпуск. Доступные обзоры можно открыть через навигацию.</p></div></section>'});
}

async function serveEdition(
  response: ServerResponse,
  database: DatabaseSync,
  edition: EditionRow | null,
  paths: BriefingPaths,
  allowEmpty: boolean,
  weeklyEnabled = false,
  stocksEnabled = false,
): Promise<void> {
  if (!edition) {
    if (!allowEmpty) {
      text(response, 404, "Briefing edition not found\n");
      return;
    }
    sendHeaders(response, "text/html; charset=utf-8");
    response.statusCode = 200;
    response.end(injectRuntime(injectSiteNavigation(emptyPage(),publishedSiteLinks(database,weeklyEnabled,new Date().toISOString(),stocksEnabled),"daily")));
    return;
  }
  const html = await readEditionHtml(edition, paths);
  sendHeaders(response, "text/html; charset=utf-8");
  response.statusCode = 200;
  response.end(injectRuntime(injectSiteNavigation(html,publishedSiteLinks(database,weeklyEnabled,new Date().toISOString(),stocksEnabled),edition.edition_type), editionClientState(database, edition.id)));
}

export async function createBriefingServer(
  paths: BriefingPaths = briefingPaths(),
  options: { mailActionExecutor?: MailActionExecutor | null; weekly?:boolean; stocks?:boolean; stocksDiscovery?:boolean; stocksLogos?:boolean; investmentReview?:boolean } = {},
): Promise<Server> {
  await initializeBriefingStore(paths);
  const favicon = await readFile(FAVICON_PATH, "utf8");
  const foxLogo = await readFile(FOX_LOGO_PATH);
  const fonts = new Map<string, Buffer>(await Promise.all(fontFiles.map(async font => [`/assets/${font.file}`, await readFile(new URL(font.file, FONT_DIRECTORY))] as const)));
  const database = openBriefingDatabase(paths);
  const runtimeConfig = options.mailActionExecutor === undefined
    ? await loadBriefingRuntimeConfig(paths)
    : null;
  const mailActionExecutor = options.mailActionExecutor === undefined
    ? runtimeConfig!.safety.productionMutationsEnabled && runtimeConfig!.addons.mail
      ? composioMailActionExecutor(process.env)
      : null
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
        const current = loadEdition(database, { type: "daily", current: true });
        let live: Record<string, unknown> | null = null;
        if (current) {
          try {
            const payload = parseBriefingPayload(JSON.parse(current.payload_json) as unknown);
            live = payload.live ? {
              state: payload.live.state,
              refreshedAt: payload.live.refreshedAt,
              lastSuccessAt: payload.live.lastSuccessAt ?? null,
            } : null;
          } catch {
            live = { state: "invalid" };
          }
        }
        const latestAttempt = latestBriefingAttempt(database);
        json(response, integrity.integrity_check === "ok" ? 200 : 503, {
          ok: integrity.integrity_check === "ok",
          database: integrity.integrity_check,
          editions: Number(editions.count),
          externalMutations: mailActionExecutor !== null,
          currentEdition: current ? { id: current.id, state: current.state, localDate: current.local_date } : null,
          latestAttempt: latestAttempt ? {
            id: latestAttempt.attemptId,
            editionId: latestAttempt.editionId,
            mode: latestAttempt.mode,
            state: latestAttempt.state,
            updatedAt: latestAttempt.updatedAt,
            errorCode: latestAttempt.errorCode,
          } : null,
          live,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/assets/theme.js") {
        sendHeaders(response, "text/javascript; charset=utf-8");
        response.statusCode = 200;
        response.end(THEME_RUNTIME_JS);
        return;
      }
      if (request.method === "GET" && url.pathname === "/assets/briefing.js") {
        sendHeaders(response, "text/javascript; charset=utf-8");
        response.statusCode = 200;
        response.end(CLIENT_SCRIPT);
        return;
      }
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/favicon.svg") {
        response.statusCode = 200;
        response.setHeader("content-type", "image/svg+xml; charset=utf-8");
        response.setHeader("cache-control", "public, max-age=3600");
        response.setHeader("x-content-type-options", "nosniff");
        response.setHeader("content-length", String(Buffer.byteLength(favicon)));
        response.end(request.method === "HEAD" ? undefined : favicon);
        return;
      }
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/assets/kurami-fox.png") {
        response.statusCode=200;
        response.setHeader("content-type","image/png");
        response.setHeader("cache-control","public, max-age=86400");
        response.setHeader("x-content-type-options","nosniff");
        response.setHeader("content-length",String(foxLogo.length));
        response.end(request.method==="HEAD"?undefined:foxLogo);
        return;
      }
      if ((request.method === "GET" || request.method === "HEAD") && fonts.has(url.pathname)) {
        const font = fonts.get(url.pathname)!;
        response.statusCode = 200;
        response.setHeader("content-type", "font/woff2");
        response.setHeader("cache-control", "public, max-age=86400");
        response.setHeader("x-content-type-options", "nosniff");
        response.setHeader("content-length", String(font.length));
        response.end(request.method === "HEAD" ? undefined : font);
        return;
      }
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/media/")) {
        await serveMedia(request, response, paths, url.pathname);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/profile/topics") {
        json(response, 200, { topics: topicProfile(database), pairs: topicPairProfile(database) });
        return;
      }
      if (request.method === "GET" && (url.pathname === "/api/profile/interests" || url.pathname === "/api/news/order")) {
        const policy = await loadTopicPolicy(paths.home, process.env, topicRegistry(database));
        const profile = buildInterestProfile(database, policy);
        if (url.pathname === "/api/profile/interests") {
          json(response, 200, profile);
          return;
        }
        const id = requiredString(url.searchParams.get("editionId"), "editionId");
        const requested = url.searchParams.get("mode") ?? "briefing";
        if (requested !== "briefing" && requested !== "for-you") throw new Error("Invalid news order");
        const edition = loadEdition(database, { id });
        if (!edition || edition.edition_type !== "daily" || edition.state === "aborted") throw new Error("Unknown briefing edition");
        const payload = parseBriefingPayload(JSON.parse(edition.payload_json));
        const stories = section(payload, "news").items;
        const result = personalizedNewsOrder(stories, profile, policy);
        const mode = requested === "for-you" && profile.ready ? "for-you" : "briefing";
        json(response, 200, { ...result, mode, order: mode === "for-you" ? result.order : stories.map(story => story.id) });
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
          let refreshedEditions: string[] = [];
          let refreshWarning: string | undefined;
          try {
            refreshedEditions = await removeArchivedMailFromRetainedEditions(
              database,
              paths,
              action.providerMessageIds,
            );
          } catch (error) {
            refreshWarning = error instanceof Error ? error.message : "Published mail refresh failed";
          }
          json(response, 200, {
            ok: true,
            alreadyComplete: true,
            itemIds: action.itemIds,
            refreshedEditions,
            ...(refreshWarning ? { refreshWarning } : {}),
          });
          return;
        }
        try {
          const executed = await mailActionExecutor({
            actionId: action.actionId,
            messageIds: action.providerMessageIds,
          });
          finishMailReadAndArchive(database, action, { ok: true, receipt: executed.receipt });
          let refreshedEditions: string[] = [];
          let refreshWarning: string | undefined;
          try {
            refreshedEditions = await removeArchivedMailFromRetainedEditions(
              database,
              paths,
              action.providerMessageIds,
            );
          } catch (error) {
            refreshWarning = error instanceof Error ? error.message : "Published mail refresh failed";
          }
          json(response, 200, {
            ok: true,
            alreadyComplete: false,
            itemIds: action.itemIds,
            refreshedEditions,
            ...(refreshWarning ? { refreshWarning } : {}),
          });
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
        if(url.pathname==="/api/stocks/details") {
          if(!(options.stocks??runtimeConfig?.stocks.enabled??false)){text(response,404,"Not found\n");return;}
          const snapshot=loadStocksCache(database);
          if(!snapshot){text(response,503,"Stocks cache unavailable\n");return;}
          const html=renderStockDetails(snapshot,url.searchParams);
          sendHeaders(response,"text/html; charset=utf-8");response.statusCode=200;response.end(html);return;
        }
        if(url.pathname==="/stocks") {
          if(!(options.stocks??runtimeConfig?.stocks.enabled??false)){text(response,404,"Not found\n");return;}
          let reviews:Array<StoredReview|null>=[];
          if(options.investmentReview??runtimeConfig?.investmentReview??false){
            // A corrupt/missing review must never break quotes or the other slot.
            reviews=await Promise.all((["weekly","monthly"] as const).map(slot=>loadReview(resolve(paths.stateDirectory,"portfolio/reviews"),slot).catch(()=>null)));
          }
          const html=renderStocksPage(loadStocksCache(database),url.searchParams,new Date().toISOString(),
            (options.stocksDiscovery??runtimeConfig?.stocksDiscovery??false)?loadDiscovery(database):null,
            (options.stocksLogos??runtimeConfig?.stocksLogos??false)?loadCompanyLogoDomains(database):undefined,reviews);
          sendHeaders(response,"text/html; charset=utf-8");response.statusCode=200;
          response.end(injectRuntime(injectSiteNavigation(html,publishedSiteLinks(database,options.weekly??runtimeConfig?.weekly.enabled??false,new Date().toISOString(),true),"stocks")));
          return;
        }
        if(url.pathname==="/weekly" || url.pathname==="/preview/weekly") {
          if(!(options.weekly??runtimeConfig?.weekly.enabled??false)) {text(response,404,"Not found\n");return;}
          const timezone=runtimeConfig?.timeZone??"Europe/Vilnius";
          const preview=url.pathname==="/preview/weekly";
          const review=preview?buildWeeklyReview(database,weeklyLocalDate(new Date().toISOString(),timezone),timezone):loadWeeklyReview(database);
          sendHeaders(response,"text/html; charset=utf-8");
          response.statusCode=200;
          response.end(injectRuntime(injectSiteNavigation(renderWeeklyPage(review,preview),publishedSiteLinks(database,true,new Date().toISOString(),options.stocks??runtimeConfig?.stocks.enabled??false),"weekly")));
          return;
        }
        const edition = routeEdition(database, url.pathname);
        await serveEdition(response, database, edition, paths, url.pathname === "/",options.weekly??runtimeConfig?.weekly.enabled??false,options.stocks??runtimeConfig?.stocks.enabled??false);
        return;
      }
      text(response, 404, "Not found\n");
    } catch (error) {
      const failure = errorResponse(error);
      json(response, failure.status, { ok: false, error: failure.message });
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
