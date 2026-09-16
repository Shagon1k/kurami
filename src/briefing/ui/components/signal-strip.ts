import { escapeHtml } from "../html.ts";
import type { SignalItem as SignalData, SignalsEnvelope } from "../../addons/signals/model.ts";

export function renderSignalItem(item: SignalData): string {
  return `<article class="signal-item signal-item--${item.severity}" data-signal-item="${escapeHtml(item.id)}"${item.expiresAt ? ` data-signal-expires="${escapeHtml(item.expiresAt)}"` : ""}>
    <span class="signal-item__icon" aria-hidden="true">${item.severity==="attention"?"!":"↗"}</span>
    <div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p>
      ${item.href ? `<a href="${item.href}">${item.href==="#mail-heading"?"К почте":"К расписанию"} →</a>` : ""}
    </div></article>`;
}

export function renderSignalStrip(envelope: SignalsEnvelope | null): string {
  if(!envelope?.data.items.length) return "";
  const data=envelope.data;
  const time = new Intl.DateTimeFormat("ru-RU",{timeZone:data.timezone,hour:"2-digit",minute:"2-digit"}).format(new Date(data.evaluatedAt));
  // Runtime reveals only fresh, same-local-day signals. No-JS/old cached pages cannot show stale alerts.
  return `<section class="signal-strip" aria-labelledby="signals-heading" data-signal-strip data-signal-date="${escapeHtml(data.localDate)}" data-signal-timezone="${escapeHtml(data.timezone)}" data-signal-until="${escapeHtml(data.validUntil)}" hidden>
    <header><h2 id="signals-heading">На заметку</h2><span>По данным на ${escapeHtml(time)}</span></header>
    <div class="signal-strip__items">${data.items.map(renderSignalItem).join("")}</div>
  </section>`;
}
