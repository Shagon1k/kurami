import {escapeHtml} from "../foundations/html.ts";
import {kuramiEntryHref} from "./kurami-sites.ts";

/** Shared footer; callers supply only real snapshot/edition metadata and required credits. */
export function renderSiteFooter(input:{lang:"en"|"ru";app:string;updated?:string;credit?:{label:string;href:string}}):string {
  const {lang,credit}=input;
  if(credit&&!/^https:\/\//.test(credit.href))throw new Error("Invalid footer credit");
  return `<footer class="site-footer container"><span>Kurami · ${escapeHtml(input.app)}</span><div class="site-footer__meta">${input.updated?`<span>${lang==="ru"?"Обновлено":"Updated"} · ${escapeHtml(input.updated)}</span>`:""}<a href="${kuramiEntryHref("docs",lang)}">${lang==="ru"?"Документация":"Documentation"}</a>${credit?`<a href="${escapeHtml(credit.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(credit.label)}</a>`:""}</div></footer>`;
}

export const SITE_FOOTER_CSS=`
.site-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3) var(--space-6); padding-block: var(--space-5); border-top: 1px solid var(--border-subtle); color: var(--text-muted); font: .75rem/1.5 var(--font-sans); }
.site-footer__meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
.site-footer a { display: inline-flex; align-items: center; min-height: var(--control-height); color: inherit; text-underline-offset: .2em; }
.site-footer a:hover { color: var(--text-accent); }
`;
