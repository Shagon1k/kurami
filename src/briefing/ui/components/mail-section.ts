import type { BriefingPayload } from "../../model.ts";
import { displayString, escapeHtml, externalUrl } from "../html.ts";

function mailClass(item: Record<string, unknown>): "ACTION" | "IMPORTANT" | "GENERAL" {
  const value = displayString(item.class).toUpperCase();
  if (value === "ACTION" || value === "IMPORTANT") return value;
  return "GENERAL";
}

function receivedTime(item: Record<string, unknown>, timeZone: string): string {
  const value = displayString(item.receivedAt);
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(parsed);
}

export function renderMailSection(payload: BriefingPayload): string {
  const items = payload.mail.items as Array<Record<string, unknown>>;
  const actionCount = items.filter((item) => mailClass(item) === "ACTION").length;
  const demoCount = items.filter((item) => item.demo === true).length;
  const rows = items.length
    ? items.map((item) => {
      const classification = mailClass(item);
      const url = externalUrl(item.externalUrl);
      const time = receivedTime(item, payload.edition.timezone);
      const heading = escapeHtml(displayString(item.subject, "Без темы"));
      const demo = item.demo === true;
      const actionable = item.provider === "gmail" && Boolean(displayString(item.providerItemId));
      const selection = actionable
        ? `<label class="mail-row__select"><input type="checkbox" data-mail-select value="${escapeHtml(item.id)}"><span aria-hidden="true">✓</span><span class="sr-only">Выбрать письмо «${heading}»</span></label>`
        : `<span class="mail-row__select-placeholder" aria-hidden="true"></span>`;
      return `<article class="mail-row${demo ? " is-demo" : ""}" data-mail-class="${classification.toLowerCase()}" data-mail-item="${escapeHtml(item.id)}">
        ${selection}
        <div class="mail-row__content">
          <div class="mail-row__top"><div class="mail-row__badges"><span class="mail-row__class">${classification}</span>${demo ? '<span class="mail-row__demo">DEMO</span>' : ""}</div><strong>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${heading}</a>` : heading}</strong></div>
          <div class="mail-row__copy"><span>${escapeHtml(displayString(item.sender, "Неизвестный отправитель"))}${time ? ` · ${escapeHtml(time)}` : ""}</span>${displayString(item.summary) ? `<p>${escapeHtml(displayString(item.summary))}</p>` : ""}</div>
        </div>
      </article>`;
    }).join("")
    : `<div class="section-empty"><strong>${payload.mail.state === "empty" ? "Primary inbox чист" : "Почта пока недоступна"}</strong><span>${payload.mail.state === "empty" ? "Новых писем для утренней гигиены нет." : "Секция обновится после следующего успешного чтения."}</span></div>`;

  const actionableCount = items.filter((item) => item.provider === "gmail" && Boolean(displayString(item.providerItemId))).length;
  return `<section class="briefing-panel briefing-panel--mail" aria-labelledby="mail-heading" data-mail-section data-edition-id="${escapeHtml(payload.edition.id)}">
    <header class="briefing-panel__header"><div><p class="section-kicker">Primary · unread</p><h2 id="mail-heading">Почта</h2></div><span>${items.length} новых${actionCount ? ` · ${actionCount} action` : ""}${demoCount ? ` · ${demoCount} demo` : ""}</span></header>
    <div class="mail-list briefing-panel__scroll"${items.length > 4 ? ' data-overflow="true" role="region" tabindex="0" aria-label="Все непрочитанные письма"' : ""}>${rows}</div>
    ${items.length ? `<footer class="mail-actions"><label class="${actionableCount ? "" : "is-disabled"}"><input type="checkbox" data-mail-select-all${actionableCount ? "" : " disabled"}> Выбрать все</label><span data-mail-selection>${actionableCount ? "0 выбрано" : "Нет доступных Gmail-писем"}</span><button class="action-button" type="button" data-mail-archive disabled>Прочитать и архивировать</button><span class="mail-actions__status" data-mail-status role="status" aria-live="polite">${actionableCount ? "" : "Демо-письма не изменяют Gmail."}</span></footer>` : ""}
  </section>`;
}
