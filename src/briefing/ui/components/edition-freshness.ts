import type {BriefingPayload} from '../../model.ts';
import {escapeHtml} from '../../../ui-library/foundations/html.ts';
import {formatSiteDate} from '../../../ui-library/foundations/date.ts';
import {digestLanguage,digestText as t} from '../../i18n.ts';

/** Edition and source timestamps have different meanings, including on retained pages. */
export function renderEditionFreshness(payload:BriefingPayload):string {
  const stamp=(value:string)=>Number.isFinite(Date.parse(value))?`<time datetime="${escapeHtml(value)}">${escapeHtml(formatSiteDate(value,digestLanguage(),true))}</time>`:'—';
  const live=payload.live;
  const states:Record<string,string>={ready:t('Обновлены','Updated'),partial:t('Частично','Partial'),stale:t('Устарели','Stale'),failed:t('Обновление не удалось','Refresh failed')};
  return `<div class="edition-freshness" data-edition-freshness><span><strong>${t('Выпуск · сохранённый срез','Edition · saved snapshot')}</strong>${stamp(payload.edition.generatedAt)}</span>${live?`<span data-live-state="${escapeHtml(live.state)}"><strong>${t('Источники','Sources')} · ${states[live.state]??t('Нет данных','Unavailable')}</strong>${live.lastSuccessAt?stamp(live.lastSuccessAt):'—'}<small>${t('Последнее успешное обновление','Last successful refresh')}</small></span>`:''}</div>`;
}

export function refreshEditionFreshness(html:string,payload:BriefingPayload):string {
  const cleaned=html.replace(/<div class="edition-freshness" data-edition-freshness>[\s\S]*?<\/div>/g,'');
  return cleaned.replace(/(<section class="hero"[^>]*>[\s\S]*?<\/section>)/,match=>match+renderEditionFreshness(payload));
}
