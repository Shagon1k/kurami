import type {SiteSwitcherInput} from "./site-header.ts";

export type KuramiSite="hub"|"digest"|"docs";

export function kuramiSites(current:KuramiSite,lang:"ru"|"en"="ru"):SiteSwitcherInput {
  return {
    label:lang==="ru"?"Сайты":"Sites",
    summary:lang==="ru"?"Сайты":"Sites",
    links:[
      {href:"https://hub.shagon1k.win/",label:"Hub",current:current==="hub"?"location":undefined},
      {href:"https://digest.shagon1k.win/",label:"Digest",current:current==="digest"?"location":undefined},
      {href:`https://docs.shagon1k.win/${lang}/`,label:"Docs",current:current==="docs"?"location":undefined},
      {href:"https://projects.shagon1k.win/",label:"Projects",disabled:true,hint:lang==="ru"?"скоро":"soon"},
      {href:"https://hermes.shagon1k.win/",label:"Hermes"},
      {href:"https://dokploy.shagon1k.win/",label:"Dokploy"},
    ],
  };
}
