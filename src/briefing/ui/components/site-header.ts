import {SITE_HEADER_CSS,renderSiteHeader as renderKuramiHeader,renderSiteNav} from "../../../ui-library/patterns/site-header.ts";
import {kuramiSites} from "../../../ui-library/patterns/kurami-sites.ts";
import {renderThemeSwitch} from "../../../ui-library/components/theme-switch.ts";
import {THEME_SWITCH_CSS} from "../../../ui-library/components/theme-switch.ts";
import {THEME_CSS} from "../../../ui-library/themes/index.ts";
import {FOUNDATION_CSS} from "../../../ui-library/foundations/index.ts";
import {BUTTON_CSS,renderLinkButton} from "../../../ui-library/components/button.ts";
import {FORM_CSS} from "../../../ui-library/components/form.ts";
import {DISCLOSURE_CSS} from "../../../ui-library/components/disclosure.ts";
import {formatSiteDate} from "../../../ui-library/foundations/date.ts";
import {STORY_ACTIONS_LAYOUT_CSS,DIGEST_POLISH_CSS} from "../styles.ts";
import {digestLanguage,digestPath,digestText,localizeDigestLinks,type DigestLanguage} from "../../i18n.ts";

export type SiteSection="daily"|"cinema"|"weekly"|"stocks";
export type SiteLink={section:SiteSection;date?:string};
const destinations:Record<SiteSection,{href:string;label:string}>={
  daily:{href:"/",label:"День"},cinema:{href:"/cinema",label:"Кино"},weekly:{href:"/weekly",label:"Неделя"},
  stocks:{href:"/stocks",label:"Акции"},
};
function navigation(links:readonly SiteLink[],current:SiteSection) {
  const seen=new Set<SiteSection>();
  return {label:digestText("Разделы Kurami","Kurami sections"),attributes:{"data-site-navigation":true as const},hideWhenEmpty:true,links:links.map(link=>{
    const destination=destinations[link.section];
    if(!Object.hasOwn(destinations,link.section) || seen.has(link.section))throw new Error("Invalid site navigation entry");
    seen.add(link.section);
    const date=link.date&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(link.date)?link.date:undefined;
    const label=digestLanguage()==="en"?({daily:"Daily",cinema:"Cinema",weekly:"Weekly",stocks:"Stocks"} as const)[link.section]:destination.label;
    return {href:digestPath(destination.href),label,mobileIcon:({daily:"news",cinema:"cinema",weekly:"calendar",stocks:"chart"} as const)[link.section],current:link.section===current?"location" as const:undefined,title:label+(date?digestText(" · выпуск "," · edition ")+date:"")};
  })};
}
export function renderSiteNavigation(links:readonly SiteLink[],current:SiteSection):string {
  return renderSiteNav(navigation(links,current));
}
export function renderSiteHeader(input:{section:SiteSection;label?:string;date?:string;dateLabel?:string;links?:readonly SiteLink[];path?:string}):string {
  if(!Object.hasOwn(destinations,input.section))throw new Error("Invalid site section");
  const lang=digestLanguage(),other:DigestLanguage=lang==="en"?"ru":"en";
  const path=input.path??destinations[input.section].href;
  const relative=path.replace(/^\/(?:en|ru)(?=\/|$)/,"")||"/";
  return renderKuramiHeader({
    mobile:{app:"digest",lang},
    label:input.label??"Kurami",
    attributes:{"data-site-section":input.section},
    brand:{href:digestPath("/"),suffix:"Digest",ariaLabel:digestText("Kurami — последний дневной выпуск","Kurami — latest Daily edition"),foxSrc:"/assets/kurami-fox.webp",meta:input.date&&input.dateLabel?{label:formatSiteDate(input.date,lang),datetime:input.date}:undefined},
    nav:{...navigation(input.links??[],input.section),scroll:true},
    sites:kuramiSites("digest",lang),
    actions:renderLinkButton({label:other.toUpperCase(),href:digestPath(relative,other),variant:"icon",ariaLabel:digestText("Переключить на английский","Switch to Russian"),attributes:{hreflang:other}})+renderThemeSwitch(lang),
  });
}
/** Refresh shared controls on frozen editions without changing their content. */
function refreshHeaderStyles(html:string):string {
  html=html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi,(_tag,attributes,css:string)=>{
    const updated=css.replace(/\.(?:media-lightbox__close|mail-actions__submit)\s*\{[^}]*\}/g,block=>/\b(?:inline-size:\s*34px|block-size:\s*34px|min-height:\s*40px)/.test(block)?"":block);
    return `<style${attributes}>${updated}</style>`;
  });
  const styles=[THEME_CSS,FOUNDATION_CSS,BUTTON_CSS,FORM_CSS,DISCLOSURE_CSS,SITE_HEADER_CSS,THEME_SWITCH_CSS,STORY_ACTIONS_LAYOUT_CSS,DIGEST_POLISH_CSS];
  if(styles.every(style=>html.includes(style)))return html;
  const updated=html.replace(/<style data-site-header-runtime>[\s\S]*?<\/style>/i,"");
  return updated.replace(/<\/head>/i,`<style data-site-header-runtime>${styles.join("\n")}</style></head>`);
}
/** Availability is injected at request time, never frozen into a Daily snapshot. */
export function injectSiteNavigation(html:string,links:readonly SiteLink[],current:SiteSection,path?:string):string {
  const updated=html.replace(/<nav[^>]*data-site-navigation[^>]*>[\s\S]*?<\/nav>/i,()=>renderSiteNavigation(links,current));
  const legacyHeader=updated.match(/<header class="utility-header"[^>]*>[\s\S]*?<\/header>/i);
  if(legacyHeader){
    const meta=legacyHeader[0].match(/<time class="utility-meta" datetime="(\d{4}-\d{2}-\d{2})">([^<]*)<\/time>/i);
    return refreshHeaderStyles(localizeDigestLinks(updated
      .replace(legacyHeader[0],renderSiteHeader({section:current,date:meta?.[1],dateLabel:meta?.[2],links,path}))
      .replace(/<\/head>/i,`<style>${FOUNDATION_CSS}</style></head>`)));
  }
  const currentHeader=updated.match(/<header class="site-header(?:\s[^"]*)?"[^>]*>[\s\S]*?<\/header>/i);
  if(!currentHeader)return localizeDigestLinks(updated);
  const meta=currentHeader[0].match(/<time class="site-brand__meta" datetime="(\d{4}-\d{2}-\d{2})">([^<]*)<\/time>/i);
  const refreshed=updated.replace(currentHeader[0],renderSiteHeader({section:current,date:meta?.[1],dateLabel:meta?.[2],links,path}));
  return refreshHeaderStyles(localizeDigestLinks(refreshed));
}
