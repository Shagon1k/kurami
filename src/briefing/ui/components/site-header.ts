import {SITE_HEADER_CSS,renderSiteHeader as renderKuramiHeader,renderSiteNav,renderSiteSwitcher} from "../../../ui-library/patterns/site-header.ts";
import {kuramiSites} from "../../../ui-library/patterns/kurami-sites.ts";
import {renderThemeSwitch} from "../../../ui-library/components/theme-switch.ts";

export type SiteSection="daily"|"cinema"|"weekly"|"stocks";
export type SiteLink={section:SiteSection;date?:string};
const destinations:Record<SiteSection,{href:string;label:string}>={
  daily:{href:"/",label:"День"},cinema:{href:"/cinema",label:"Кино"},weekly:{href:"/weekly",label:"Неделя"},
  stocks:{href:"/stocks",label:"Акции"},
};
function navigation(links:readonly SiteLink[],current:SiteSection) {
  const seen=new Set<SiteSection>();
  return {label:"Разделы Kurami",attributes:{"data-site-navigation":true as const},hideWhenEmpty:true,links:links.map(link=>{
    const destination=destinations[link.section];
    if(!Object.hasOwn(destinations,link.section) || seen.has(link.section))throw new Error("Invalid site navigation entry");
    seen.add(link.section);
    const date=link.date&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(link.date)?link.date:undefined;
    return {href:destination.href,label:destination.label,current:link.section===current?"location" as const:undefined,title:destination.label+(date?" · выпуск "+date:"")};
  })};
}
export function renderSiteNavigation(links:readonly SiteLink[],current:SiteSection):string {
  return renderSiteNav(navigation(links,current));
}
export function renderSiteHeader(input:{section:SiteSection;label?:string;date:string;dateLabel:string;links?:readonly SiteLink[]}):string {
  if(!Object.hasOwn(destinations,input.section))throw new Error("Invalid site section");
  return renderKuramiHeader({
    label:input.label??"Kurami",
    attributes:{"data-site-section":input.section},
    brand:{href:"/",ariaLabel:"Kurami — последний дневной выпуск",foxSrc:"/assets/kurami-fox.webp",meta:{label:input.dateLabel,datetime:input.date}},
    nav:navigation(input.links??[],input.section),
    sites:kuramiSites("digest"),
    actions:renderThemeSwitch("ru"),
  });
}
/** Availability is injected at request time, never frozen into a Daily snapshot. */
export function injectSiteNavigation(html:string,links:readonly SiteLink[],current:SiteSection):string {
  const updated=html.replace(/<nav[^>]*data-site-navigation[^>]*>[\s\S]*?<\/nav>/i,()=>renderSiteNavigation(links,current));
  if(updated.includes('class="site-switcher"'))return updated;
  // Published editions keep their HTML snapshot; upgrade the shared header at response time.
  if(!updated.includes('<div class="site-actions">'))return updated;
  return updated
    .replace('<div class="site-actions">',`<div class="site-actions">${renderSiteSwitcher(kuramiSites("digest"))}`)
    .replace(/(<img class="site-brand__fox" src=")\/assets\/kurami-fox\.png(?=")/,'$1/assets/kurami-fox.webp')
    .replace(/<\/head>/i,`<style>${SITE_HEADER_CSS}</style></head>`);
}
