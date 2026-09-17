import {escapeHtml} from "../html.ts";
import {renderThemeToggle} from "./theme-toggle.ts";

export type SiteSection="daily"|"cinema"|"weekly";
export type SiteLink={section:SiteSection;date?:string};
const destinations:Record<SiteSection,{href:string;label:string}>={
  daily:{href:"/",label:"День"},cinema:{href:"/cinema",label:"Кино"},weekly:{href:"/weekly",label:"Неделя"},
};
export function renderSiteNavigation(links:readonly SiteLink[],current:SiteSection):string {
  const seen=new Set<SiteSection>();
  const items=links.map(link=>{
    const destination=destinations[link.section];
    if(!Object.hasOwn(destinations,link.section) || seen.has(link.section))throw new Error("Invalid site navigation entry");
    seen.add(link.section);
    const date=link.date&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(link.date)?link.date:undefined;
    return `<a class="site-nav__link" href="${destination.href}"${link.section===current?' aria-current="location"':""} title="${escapeHtml(destination.label+(date?" · выпуск "+date:""))}">${destination.label}</a>`;
  }).join("");
  return `<nav class="site-nav" data-site-navigation aria-label="Разделы Kurami"${items?"":" hidden"}>${items}</nav>`;
}
export function renderSiteHeader(input:{section:SiteSection;label?:string;date:string;dateLabel:string;links?:readonly SiteLink[]}):string {
  if(!Object.hasOwn(destinations,input.section))throw new Error("Invalid site section");
  return `<header class="utility-header" data-utility-header data-site-section="${input.section}" aria-label="${escapeHtml(input.label??"Kurami")}">
    <div class="utility-header__inner page-shell">
      <a class="utility-brand" href="/" aria-label="Kurami — последний дневной выпуск">
        <img class="utility-brand__fox" src="/assets/kurami-fox.png" width="48" height="48" alt="" decoding="async">
        <span class="utility-brand__copy"><span class="utility-brand__name">Kurami<span class="utility-brand__dot" aria-hidden="true">.</span></span>
        <time class="utility-meta" datetime="${escapeHtml(input.date)}">${escapeHtml(input.dateLabel)}</time></span>
      </a>
      ${renderSiteNavigation(input.links??[],input.section)}
      <div class="utility-actions">${renderThemeToggle()}</div>
    </div>
  </header>`;
}
/** Availability is injected at request time, never frozen into a Daily snapshot. */
export function injectSiteNavigation(html:string,links:readonly SiteLink[],current:SiteSection):string {
  return html.replace(/<nav[^>]*data-site-navigation[^>]*>[\s\S]*?<\/nav>/i,()=>renderSiteNavigation(links,current));
}
