import type {SiteSwitcherInput} from "./site-header.ts";

export type KuramiSite="hub"|"digest"|"docs"|"projects";

export function kuramiSites(current:KuramiSite,lang:"ru"|"en"="ru"):SiteSwitcherInput {
  return {
    label:lang==="ru"?"Приложения":"Apps",
    summary:lang==="ru"?"Приложения":"Apps",
    links:[
      {href:`https://hub.shagon1k.win/${lang}/`,label:"Hub",current:current==="hub"?"location":undefined},
      {href:`https://digest.shagon1k.win/${lang}/`,label:"Digest",current:current==="digest"?"location":undefined},
      {href:`https://docs.shagon1k.win/${lang}/`,label:"Docs",current:current==="docs"?"location":undefined},
      {href:`https://projects.shagon1k.win/${lang==="ru"?"?lang=ru":""}`,label:"Projects",current:current==="projects"?"location":undefined},
      {href:"https://hermes.shagon1k.win/",label:"Hermes",external:true},
      {href:"https://dokploy.shagon1k.win/",label:"Dokploy",external:true},
    ],
  };
}
