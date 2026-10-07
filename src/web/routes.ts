import {fontFiles} from "../ui-library/foundations/fonts.ts";
import {KURAMI_WEB_ORIGIN} from "../ui-library/patterns/kurami-sites.ts";

export const WEB_ORIGIN=KURAMI_WEB_ORIGIN;
export const WEB_APPS=["hub","digest","projects","docs"] as const;
export type WebApp=typeof WEB_APPS[number];
export type WebLanguage="en"|"ru";
export type WebRoute={app:WebApp;language:WebLanguage;upstream:string}|{redirect:string}|null;
const oldHosts:Record<string,WebApp>={"hub.shagon1k.win":"hub","digest.shagon1k.win":"digest","projects.shagon1k.win":"projects","docs.shagon1k.win":"docs"};

/** Where each PWA shortcut (long press on the app icon) leads, below the language prefix. */
export const SHORTCUT_TARGETS:Record<string,string>={digest:"digest/",alerts:"#alerts-title",projects:"projects/",capture:"projects/?capture=1"};
export const PWA_SHORTCUTS=[
  {open:"digest",ru:["Дайджест","Дайджест"],en:["Digest","Digest"]},
  {open:"alerts",ru:["Требует внимания","Внимание"],en:["Needs attention","Alerts"]},
  {open:"projects",ru:["Задачи","Задачи"],en:["Tasks","Tasks"]},
  {open:"capture",ru:["Быстрая задача","Задача"],en:["Quick task","Task"]},
] as const;

/** Namespace infrastructure separately from translated document routes. */
export function appPath(app:WebApp,language:WebLanguage,path="/"):string {
  if(!path.startsWith("/")||path.startsWith("//"))throw new Error("Expected a local app path");
  return `/${language}${app==="hub"?"":"/"+app}${path}`;
}

function safeRequestTarget(raw:string):boolean {
  if(raw.length>4096||!raw.startsWith("/")||raw.startsWith("//")||/[\\\r\n\0#]/.test(raw))return false;
  try {
    const path=raw.split("?")[0]!;
    // Never let URL normalization or a downstream decoder change the selected app.
    if(/%(?:2f|5c|25)/i.test(path))return false;
    const decoded=decodeURIComponent(path);
    return !decoded.split("/").some(segment=>segment==="."||segment==="..")&&!/[\\\r\n\0]/.test(decoded)&&!decoded.includes("//");
  }catch{return false;}
}

export function resolveWebRoute(raw:string):WebRoute {
  if(!safeRequestTarget(raw))return null;
  const url=new URL(raw,WEB_ORIGIN),path=url.pathname;
  if(path==="/"||path==="/index.html"){
    // Home-screen shortcuts open `/?open=…`; the gateway swaps /en/ for the preferred language.
    const shortcut=Object.hasOwn(SHORTCUT_TARGETS,url.searchParams.get("open")??"")?SHORTCUT_TARGETS[url.searchParams.get("open")!]:undefined;
    return {redirect:shortcut?`/en/${shortcut}`:"/en/"+url.search};
  }
  // Android's Share → Kurami (manifest share_target): the shared title, text and link prefill the capture form.
  if(path==="/share"){
    const shared=new URLSearchParams({capture:"1"});
    for(const key of ["title","text","url"]){const value=url.searchParams.get(key)?.slice(0,1000);if(value)shared.set(key,value);}
    return {redirect:`/en/projects/?${shared}`};
  }
  if(/^\/(en|ru)$/.test(path))return {redirect:path+"/"+url.search};
  const infrastructure=path.match(/^\/_apps\/(hub|digest|projects|docs)(\/.*)$/);
  if(infrastructure){
    const app=infrastructure[1] as WebApp,upstream=infrastructure[2]!;
    if(!/^\/(?:assets\/[a-z0-9_.-]+|api\/[a-z0-9/-]+|media\/[a-zA-Z0-9_./-]+|favicon\.svg)$/.test(upstream))return null;
    return {app,language:url.searchParams.get("lang")==="ru"?"ru":"en",upstream:upstream+url.search};
  }
  const page=path.match(/^\/(en|ru)\/(?:((?:digest|projects|docs))(?=\/|$))?(.*)$/);
  if(!page)return null;
  const language=page[1] as WebLanguage,app=(page[2]??"hub") as WebApp;
  const remainder=page[2]?(page[3]||"/"):"/"+page[3];
  if(app!=="hub"&&!remainder.startsWith("/"))return null;
  if(app!=="hub"&&path===`/${language}/${app}`)return {redirect:path+"/"+url.search};
  if(app==="projects"){
    if(remainder!=="/")return null;
    url.searchParams.delete("lang");
    if(language==="ru")url.searchParams.set("lang","ru");
    return {app,language,upstream:"/"+url.search};
  }
  // Existing Digest routes have no trailing slash except their home page.
  const native=app==="digest"&&remainder!=="/"?remainder.replace(/\/$/,""):remainder;
  return {app,language,upstream:`/${language}${native}`+url.search};
}

/** Convert only local or known Kurami document URLs; external source URLs stay intact. */
export function publicAppUrl(value:string,app:WebApp,language:WebLanguage):string {
  if(value.startsWith("#")||!value)return value;
  if(/^https:\/\//.test(value)){
    const url=new URL(value),target=oldHosts[url.hostname];
    if(url.origin===WEB_ORIGIN)return url.pathname+url.search+url.hash;
    if(!target||url.port)return value;
    return publicAppUrl(url.pathname+url.search+url.hash,target,language);
  }
  if(!value.startsWith("/")||value.startsWith("//"))return value;
  if(value.startsWith("/_apps/"))return value;
  const url=new URL(value,WEB_ORIGIN);
  if(fontFiles.some(font=>url.pathname===`/assets/${font.file}`))return value;
  if(/^\/(?:api|media|assets)\//.test(url.pathname)||url.pathname==="/favicon.svg")return `/_apps/${app}${value}`;
  if(["/sw.js","/manifest.webmanifest"].includes(url.pathname)||/^\/(en|ru)\/manifest\.webmanifest$/.test(url.pathname))return url.pathname==="/sw.js"?"/sw.js":"/manifest.webmanifest";
  const locale=url.pathname.match(/^\/(en|ru)(?=\/|$)/);
  const lang=(locale?.[1]??(app==="projects"&&url.searchParams.get("lang")==="ru"?"ru":language)) as WebLanguage;
  const path=locale?url.pathname.slice(3)||"/":url.pathname;
  if(app==="projects")url.searchParams.delete("lang");
  return appPath(app,lang,path)+url.search+url.hash;
}
