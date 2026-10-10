import type {SiteSwitcherInput} from "./site-header.ts";

export type KuramiSite="hub"|"digest"|"docs"|"projects";
export const KURAMI_WEB_ORIGIN="https://kurami.shagon1k.win";
export function kuramiEntryHref(app:KuramiSite,lang:"ru"|"en"):string {
  return `${KURAMI_WEB_ORIGIN}/${lang}/${app==="hub"?"":app+"/"}`;
}

export function kuramiSites(current:KuramiSite,lang:"ru"|"en"="ru"):SiteSwitcherInput {
  return {
    label:lang==="ru"?"Приложения":"Apps",
    summary:lang==="ru"?"Приложения":"Apps",
    links:[
      {href:kuramiEntryHref("hub",lang),label:"Hub",mobileIcon:"home",current:current==="hub"?"location":undefined},
      {href:kuramiEntryHref("digest",lang),label:"Digest",mobileIcon:"news",current:current==="digest"?"location":undefined},
      {href:kuramiEntryHref("projects",lang),label:"Projects",mobileIcon:"projects",current:current==="projects"?"location":undefined},
      {href:kuramiEntryHref("docs",lang),label:"Docs",mobileIcon:"book",current:current==="docs"?"location":undefined},
      {href:"https://hermes.shagon1k.win/",label:"Hermes",mobileIcon:"bot",external:true},
      {href:"https://dokploy.shagon1k.win/",label:"Dokploy",mobileIcon:"box",external:true},
    ],
  };
}
