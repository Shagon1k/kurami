import {escapeHtml as e} from "../ui/html.ts";
import {FIGURE_ATTRIBUTE} from "../../ui-library/components/surface.ts";
import {renderSparkline} from "../ui/charts/index.ts";
import {dayShift} from "./model.ts";
import {delta,shortDate} from "./format.ts";
import {parseDiscoverySnapshot,type DiscoverySnapshot,type DiscoveryCard} from "./discovery-model.ts";
import {renderCompanyAvatar} from "../ui/components/company-avatar.ts";
import type {CompanyLogoDomains} from "./logo-registry.ts";
import {digestLanguage,digestText as t} from "../i18n.ts";

export function renderDiscoveryCard(card:DiscoveryCard,logos?:CompanyLogoDomains):string {
  const amount=new Intl.NumberFormat(digestLanguage()==="en"?"en-US":"ru-RU",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(card.price);
  const ratio=new Intl.NumberFormat(digestLanguage()==="en"?"en-US":"ru-RU",{maximumFractionDigits:2}).format(card.relativeVolume);
  return `<article class="stock-discovery-card" data-stock-discovery-card>
    <header class="stock-discovery-card__identity">${renderCompanyAvatar(card.symbol,logos?.get(card.symbol+":"+card.isin))}<div><span>${e(card.symbol)} · USD</span><h3>${e(card.name)}</h3></div></header>
    <div class="stock-discovery-card__price"><strong${FIGURE_ATTRIBUTE}>${e(amount)}</strong>${delta(card.day)}<small>${t("за сессию","session")} · ${e(shortDate(card.date))}</small></div>
    <p>${card.day>0?t("Рост","Rise"):t("Снижение","Fall")} ${t("на повышенном объёме","on elevated volume")}: <strong>×${e(ratio)}</strong> ${t("к среднему за предыдущие 20 сессий.","versus the previous 20-session average.")}</p>
    ${card.points.length>1?`<div class="stock-discovery-card__trend">${renderSparkline(card.points.map(p=>p.adjusted),card.symbol+t(": скорректированные закрытия за месяц, собственный масштаб",": adjusted closes over one month, independent scale"))}<small>${t("Месяц · собственный масштаб","Month · independent scale")}</small></div>`:""}
    <dl><div><dt>${t("За 7 дней","7 days")}</dt><dd>${delta(card.week)}</dd></div><div><dt>${t("За 30 дней","30 days")}</dt><dd>${delta(card.month)}</dd></div></dl>
    <a href="https://finance.yahoo.com/quote/${encodeURIComponent(card.symbol)}/" target="_blank" rel="noopener noreferrer">${t("Изучить компанию","Research company")} ↗</a>
  </article>`;
}
export function renderStocksDiscovery(value:DiscoverySnapshot|null|undefined,at:string,owned:Set<string>,logos?:CompanyLogoDomains):string {
  if(!value)return "";
  let s:DiscoverySnapshot;try{s=parseDiscoverySnapshot(value);}catch{return "";}
  const old=s.data.sessionDate<dayShift(at.slice(0,10),-4),cards=old?[]:s.data.cards.filter(c=>!owned.has(c.symbol));
  if(s.state==="empty"&&!old||!cards.length&&s.state==="ready"&&!old)return "";
  const warning=old?t("Подборка устарела и скрыта. Новые данные пока недоступны.","The selection is stale and hidden. New data is unavailable."):s.state==="failed"?t("Обновить подборку не удалось. Ниже — последний сохранённый срез с указанной датой.","Could not refresh the selection. The last saved snapshot is shown with its date."):s.state==="partial"?t("Часть кандидатов не удалось проверить; показаны только подтверждённые.","Some candidates could not be checked; only verified ones are shown."):"";
  return `<section class="stocks-discovery" aria-labelledby="stocks-discovery-heading"><header><p class="hero__eyebrow">${t("Заметные движения","Notable moves")} · ${e(shortDate(s.data.sessionDate))}</p><h2 id="stocks-discovery-heading">${t("Вне твоего списка","Outside your watchlist")}</h2><p>${t("До трёх акций для самостоятельного изучения. Это не рекомендации покупать или продавать.","Up to three stocks for independent research. These are not buy or sell recommendations.")}</p></header>
    ${warning?`<p class="callout callout--warning stocks-notice">${e(warning)}</p>`:""}
    ${cards.length?`<div class="stocks-discovery__grid">${cards.map(card=>renderDiscoveryCard(card,logos)).join("")}</div>`:""}
    <details class="disclosure stocks-discovery__method"><summary>${t("Как отобраны","Selection method")}</summary><p>${t("Из дневных списков Alpha Vantage, не всего рынка: обычные акции США вне твоего watchlist, цена от $5, цена × объём от $20 млн (приближение оборота). Движение от 3% до 30% по модулю и объём от 1,5 среднего за 20 сессий. Даты, цены и история сверены с EODHD. Проверяются максимум три кандидата, поэтому подходящих карточек может быть меньше.","From Alpha Vantage daily lists, not the whole market: US common stocks outside your watchlist, price at least $5 and price × volume at least $20 million (an approximate turnover). Absolute moves from 3% to 30%, with volume at least 1.5 times the 20-session average. Dates, prices and history are checked against EODHD. At most three candidates are checked, so fewer cards may qualify.")}</p><p>${t("Повтор в течение трёх дней возможен только при смене направления или заметном усилении движения. Проценты учитывают сплиты и дивиденды. Причина движения цены не установлена этими данными.","A repeat within three days requires a change of direction or a materially stronger move. Percentages account for splits and dividends. These data do not establish the cause of a price move.")}</p><p>${t("Источники","Sources")}: <a href="https://www.alphavantage.co/documentation/#top-gainers-losers" target="_blank" rel="noopener noreferrer">Alpha Vantage</a> · <a href="https://eodhd.com/financial-apis/api-for-historical-data-and-volumes" target="_blank" rel="noopener noreferrer">EODHD</a>.</p></details>
  </section>`;
}
