import { section } from "../../addons/envelopes.ts";
import type { BriefingPayload } from "../../model.ts";
import { displayString, escapeHtml, externalUrl } from "../html.ts";
import { renderButton } from "../../../ui-library/components/button.ts";
import { renderSelectionControl } from "./selection-control.ts";
import { renderKuramiNote } from "./kurami-note.ts";
import {digestLanguage,digestText} from "../../i18n.ts";

function mailClass(item: Record<string, unknown>): "ACTION" | "IMPORTANT" | "GENERAL" {
  const value = displayString(item.class).toUpperCase();
  if (value === "ACTION" || value === "IMPORTANT") return value;
  return "GENERAL";
}

function receivedTime(item: Record<string, unknown>, timeZone: string): string {
  const value = displayString(item.receivedAt);
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(parsed);
}

export function renderMailSection(payload: BriefingPayload): string {
  const items = section(payload, "mail").items as Array<Record<string, unknown>>;
  const actionCount = items.filter((item) => mailClass(item) === "ACTION").length;
  const demoCount = items.filter((item) => item.demo === true).length;
  const rows = items.length
    ? items.map((item) => {
      const classification = mailClass(item);
      const url = externalUrl(item.externalUrl);
      const time = receivedTime(item, payload.edition.timezone);
      const subject = displayString(item.subject, digestText("Без темы","No subject"));
      const heading = escapeHtml(subject);
      const demo = item.demo === true;
      const actionable = item.provider === "gmail" && Boolean(displayString(item.providerItemId));
      const itemNote = payload.notes?.find((note) => note.target === `mail-item:${displayString(item.id)}`);
      const selection = actionable
        ? renderSelectionControl({
          label: `${digestText("Выбрать письмо","Select email")} «${subject}»`,
          className: "mail-row__select",
          attributes: { "data-mail-select": true, value: displayString(item.id) },
        })
        : `<span class="mail-row__select-placeholder" aria-hidden="true"></span>`;
      return `<article class="mail-row${demo ? " is-demo" : ""}" data-mail-class="${classification.toLowerCase()}" data-mail-item="${escapeHtml(item.id)}">
        ${selection}
        <div class="mail-row__content">
          <div class="mail-row__top"><strong>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${heading}</a>` : heading}</strong></div>
          <div class="mail-row__copy"><span>${escapeHtml(displayString(item.sender, digestText("Неизвестный отправитель","Unknown sender")))}${time ? ` · ${escapeHtml(time)}` : ""}</span>${displayString(item.summary) ? `<p>${escapeHtml(displayString(item.summary))}</p>` : ""}${renderKuramiNote(itemNote, "mail-row__note")}</div>
        </div>
        <div class="mail-row__badges"><span class="mail-row__class">${classification}</span>${demo ? '<span class="mail-row__demo">DEMO</span>' : ""}</div>
      </article>`;
    }).join("")
    : `<div class="section-empty"><strong>${section(payload, "mail").state === "empty" ? digestText("Primary inbox чист","Primary inbox clear") : digestText("Почта пока недоступна","Mail unavailable")}</strong><span>${section(payload, "mail").state === "empty" ? digestText("Новых писем для утренней гигиены нет.","No new mail to process.") : digestText("Секция обновится после следующего успешного чтения.","This section will update after the next successful refresh.")}</span></div>`;

  const actionableCount = items.filter((item) => item.provider === "gmail" && Boolean(displayString(item.providerItemId))).length;
  const selectAll = renderSelectionControl({
    label: digestText("Выбрать все","Select all"),
    className: "mail-actions__select-all",
    visibleLabel: true,
    disabled: actionableCount === 0,
    attributes: { "data-mail-select-all": true },
  });
  const archiveButton = renderButton({
    label: digestText("Прочитать и архивировать","Read and archive"),
    variant: "success",
    className: "mail-actions__submit",
    busyLabel: digestText("Обрабатываю…","Processing…"),
    disabled: true,
    attributes: { "data-mail-archive": true },
  });
  const sectionNote = payload.notes?.find((note) => note.target === "mail");
  return `<section class="briefing-panel briefing-panel--mail" aria-labelledby="mail-heading" data-mail-section data-edition-id="${escapeHtml(payload.edition.id)}">
    ${renderKuramiNote(sectionNote, "briefing-panel__note")}
    <header class="briefing-panel__header"><div><p class="section-kicker">Primary · unread</p><h2 id="mail-heading">${digestText("Почта","Mail")}</h2></div><span>${items.length} ${digestText("новых","new")}${actionCount ? ` · ${actionCount} action` : ""}${demoCount ? ` · ${demoCount} demo` : ""}</span></header>
    <div class="mail-list briefing-panel__scroll"${items.length > 4 ? ` data-overflow="true" role="region" tabindex="0" aria-label="${digestText("Все непрочитанные письма","All unread mail")}"` : ""}>${rows}</div>
    ${items.length ? `<footer class="mail-actions">${selectAll}<span data-mail-selection>${actionableCount ? digestText("0 выбрано","0 selected") : digestText("Нет доступных Gmail-писем","No actionable Gmail messages")}</span>${archiveButton}<span class="mail-actions__status" data-mail-status role="status" aria-live="polite">${actionableCount ? "" : digestText("Демо-письма не изменяют Gmail.","Demo mail does not change Gmail.")}</span></footer>` : ""}
  </section>`;
}
