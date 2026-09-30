import { escapeHtml } from "../html.ts";
import type { SignalItem as SignalData, SignalsEnvelope } from "../../addons/signals/model.ts";
import {digestLanguage,digestText as t} from "../../i18n.ts";

export function renderSignalItem(item: SignalData): string {
  return `<article class="signal-item signal-item--${item.severity}" data-signal-item="${escapeHtml(item.id)}"${item.expiresAt ? ` data-signal-expires="${escapeHtml(item.expiresAt)}"` : ""}>
    <span class="signal-item__icon" aria-hidden="true">${item.severity==="attention"?"!":"↗"}</span>
    <div><h3>${escapeHtml(digestLanguage()==="en"?item.enTitle??item.title:item.title)}</h3><p>${escapeHtml(digestLanguage()==="en"?item.enDetail??item.detail:item.detail)}</p>
      ${item.href ? `<a href="${item.href}">${item.href==="#mail-heading"?t("К почте","Mail"):t("К расписанию","Schedule")} →</a>` : ""}
    </div></article>`;
}

export function renderSignalStrip(envelope: SignalsEnvelope | null): string {
  if(!envelope?.data.items.length) return "";
  const data=envelope.data;
  const time = new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU",{timeZone:data.timezone,hour:"2-digit",minute:"2-digit"}).format(new Date(data.evaluatedAt));
  // Runtime reveals only fresh, same-local-day signals. No-JS/old cached pages cannot show stale alerts.
  return `<section class="signal-strip" aria-labelledby="signals-heading" data-signal-strip data-signal-date="${escapeHtml(data.localDate)}" data-signal-timezone="${escapeHtml(data.timezone)}" data-signal-until="${escapeHtml(data.validUntil)}" hidden>
    <header><h2 id="signals-heading">${t("На заметку","Heads up")}</h2><span>${t("По данным на","As of")} ${escapeHtml(time)}</span></header>
    <div class="signal-strip__items">${data.items.map(renderSignalItem).join("")}</div>
  </section>`;
}
