import type { BriefingPayload } from "../../model.ts";
import { displayString, escapeHtml, externalUrl } from "../html.ts";
import { renderButton } from "./button.ts";
import { renderSelectionControl } from "./selection-control.ts";
import { renderKuramiNote } from "./kurami-note.ts";

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
      const subject = displayString(item.subject, "Без темы");
      const heading = escapeHtml(subject);
      const demo = item.demo === true;
      const actionable = item.provider === "gmail" && Boolean(displayString(item.providerItemId));
      const itemNote = payload.notes?.find((note) => note.target === `mail-item:${displayString(item.id)}`);
      const selection = actionable
        ? renderSelectionControl({
          label: `Выбрать письмо «${subject}»`,
          className: "mail-row__select",
          attributes: { "data-mail-select": true, value: displayString(item.id) },
        })
        : `<span class="mail-row__select-placeholder" aria-hidden="true"></span>`;
      return `<article class="mail-row${demo ? " is-demo" : ""}" data-mail-class="${classification.toLowerCase()}" data-mail-item="${escapeHtml(item.id)}">
        ${selection}
        <div class="mail-row__content">
          <div class="mail-row__top"><strong>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${heading}</a>` : heading}</strong></div>
          <div class="mail-row__copy"><span>${escapeHtml(displayString(item.sender, "Неизвестный отправитель"))}${time ? ` · ${escapeHtml(time)}` : ""}</span>${displayString(item.summary) ? `<p>${escapeHtml(displayString(item.summary))}</p>` : ""}${renderKuramiNote(itemNote, "mail-row__note")}</div>
        </div>
        <div class="mail-row__badges"><span class="mail-row__class">${classification}</span>${demo ? '<span class="mail-row__demo">DEMO</span>' : ""}</div>
      </article>`;
    }).join("")
    : `<div class="section-empty"><strong>${payload.mail.state === "empty" ? "Primary inbox чист" : "Почта пока недоступна"}</strong><span>${payload.mail.state === "empty" ? "Новых писем для утренней гигиены нет." : "Секция обновится после следующего успешного чтения."}</span></div>`;

  const actionableCount = items.filter((item) => item.provider === "gmail" && Boolean(displayString(item.providerItemId))).length;
  const selectAll = renderSelectionControl({
    label: "Выбрать все",
    className: "mail-actions__select-all",
    visibleLabel: true,
    disabled: actionableCount === 0,
    attributes: { "data-mail-select-all": true },
  });
  const archiveButton = renderButton({
    label: "Прочитать и архивировать",
    variant: "primary",
    className: "mail-actions__submit",
    busyLabel: "Обрабатываю…",
    disabled: true,
    attributes: { "data-mail-archive": true },
  });
  const sectionNote = payload.notes?.find((note) => note.target === "mail");
  return `<section class="briefing-panel briefing-panel--mail" aria-labelledby="mail-heading" data-mail-section data-edition-id="${escapeHtml(payload.edition.id)}">
    ${renderKuramiNote(sectionNote, "briefing-panel__note")}
    <header class="briefing-panel__header"><div><p class="section-kicker">Primary · unread</p><h2 id="mail-heading">Почта</h2></div><span>${items.length} новых${actionCount ? ` · ${actionCount} action` : ""}${demoCount ? ` · ${demoCount} demo` : ""}</span></header>
    <div class="mail-list briefing-panel__scroll"${items.length > 4 ? ' data-overflow="true" role="region" tabindex="0" aria-label="Все непрочитанные письма"' : ""}>${rows}</div>
    ${items.length ? `<footer class="mail-actions">${selectAll}<span data-mail-selection>${actionableCount ? "0 выбрано" : "Нет доступных Gmail-писем"}</span>${archiveButton}<span class="mail-actions__status" data-mail-status role="status" aria-live="polite">${actionableCount ? "" : "Демо-письма не изменяют Gmail."}</span></footer>` : ""}
  </section>`;
}
