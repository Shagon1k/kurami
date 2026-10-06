import {createServer,request as upstreamRequest,type IncomingMessage,type Server} from "node:http";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {WebAccess,type WebIdentity} from "./access.ts";
import {AccessVerificationUnavailableError,accessUnavailableMessage} from "./access-keys.ts";
import {resolveWebRoute,WEB_ORIGIN,type WebApp} from "./routes.ts";
import {readAppearanceDefault} from "../system/appearance/appearance-settings.ts";
import {fontFiles} from "../ui-library/foundations/fonts.ts";
import {VIEWPORT_META} from "../ui-library/patterns/page-shell.ts";
import {PWA_BACKGROUND,PWA_ICON_ASSETS,PWA_LEGACY_ICON_ASSETS,PWA_MANIFEST_ICONS} from "./icons.ts";

type Options={upstreams?:Record<WebApp,string>;authorize?:(request:IncomingMessage,app:WebApp)=>Promise<WebIdentity|null>;origin?:string;appearance?:()=>string|null};

/** The Hub default theme travels as a readable cookie on every page, so the theme runtime applies it before first paint. */
export function appearanceCookie(value:string|null,secure:boolean):string {
  const flags=`Path=/; SameSite=Lax${secure?"; Secure":""}`;
  return value&&/^[a-z]+\.(?:light|dark)$/.test(value)?`kurami-theme-default=${value}; Max-Age=31536000; ${flags}`:`kurami-theme-default=; Max-Age=0; ${flags}`;
}
const hopHeaders=new Set(["connection","keep-alive","proxy-authenticate","proxy-authorization","te","trailer","transfer-encoding","upgrade"]);

/** Loopback-only gateway: route and stream; product servers own presentation and actions. */
export function createWebServer(options:Options={}):Server {
  const access=new WebAccess(),authorize=options.authorize??((request,app)=>access.authorize(request,app));
  const appearance=options.appearance??(()=>readAppearanceDefault());
  const origin=new URL(options.origin??WEB_ORIGIN);
  const upstreams=options.upstreams??{hub:"http://127.0.0.1:8800",digest:"http://127.0.0.1:8787",projects:"http://127.0.0.1:8777",docs:"http://127.0.0.1:8799"};
  for(const target of Object.values(upstreams)){
    const url=new URL(target);
    if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw new Error("Web upstreams must be loopback HTTP origins");
  }
  return createServer(async(request,response)=>{
    response.setHeader("Cache-Control","private, no-store");
    response.setHeader("X-Content-Type-Options","nosniff");
    response.setHeader("Referrer-Policy","no-referrer");
    response.setHeader("X-Robots-Tag","noindex, nofollow");
    const send=(code:number,body:string,type="text/plain; charset=utf-8")=>{response.writeHead(code,{"Content-Type":type});response.end(request.method==="HEAD"?undefined:body);};
    if(request.url==="/health"&&["GET","HEAD"].includes(request.method??"")){send(200,'{"ok":true}',"application/json; charset=utf-8");return;}
    const raw=request.url??"/",route=resolveWebRoute(raw);
    const resource=raw.split("?")[0]!;
    const font=fontFiles.find(font=>resource===`/assets/${font.file}`);
    const icon=[...PWA_ICON_ASSETS,...PWA_LEGACY_ICON_ASSETS].find(icon=>resource===icon.src);
    const pwa=Boolean(font||icon)||["/manifest.webmanifest","/sw.js","/en/offline.html","/ru/offline.html","/assets/kurami-fox.png","/assets/kurami-fox.webp"].includes(resource);
    const app=font?"docs":route&&"app" in route?route.app:"hub";
    let identity:WebIdentity|null;
    try{identity=await authorize(request,app);}catch(error){
      if(error instanceof AccessVerificationUnavailableError){
        response.setHeader("Retry-After","10");
        const language=route&&"language" in route?route.language:/^\/ru(?:\/|$)/.test(resource)||request.headers["accept-language"]?.toLowerCase().startsWith("ru")?"ru":"en";
        send(503,accessUnavailableMessage(language));return;
      }
      identity=null;
    }
    if(!identity){send(403,"Access denied");return;}
    if(identity.scope!=="owner"&&(app!=="docs"||!["GET","HEAD"].includes(request.method??""))){send(403,"Access denied");return;}
    if(request.headers.host!==origin.host){send(421,"Unexpected host");return;}
    if(request.method==="POST"&&request.headers.origin!==origin.origin){send(403,"Unexpected origin");return;}
    if(route&&"redirect" in route){
      if(!["GET","HEAD"].includes(request.method??"")){send(405,"Method not allowed");return;}
      response.writeHead(302,{Location:route.redirect});response.end();return;
    }
    if(pwa){
      if(!["GET","HEAD"].includes(request.method??"")){send(405,"Method not allowed");return;}
      if(font){
        const body=readFileSync(new URL(`../ui-library/assets/fonts/${font.file}`,import.meta.url));
        response.setHeader("Cache-Control","private, max-age=86400");
        response.writeHead(200,{"Content-Type":"font/woff2"});response.end(request.method==="HEAD"?undefined:body);return;
      }
      if(resource==="/manifest.webmanifest"){
        send(200,JSON.stringify({id:"/",name:"Kurami",short_name:"Kurami",start_url:"/en/",scope:"/",display:"standalone",background_color:PWA_BACKGROUND,theme_color:PWA_BACKGROUND,icons:PWA_MANIFEST_ICONS}),"application/manifest+json");return;
      }
      if(icon){
        const body=readFileSync(new URL(`../ui-library/assets/brand/${icon.file}`,import.meta.url));
        response.writeHead(200,{"Content-Type":"image/png"});response.end(request.method==="HEAD"?undefined:body);return;
      }
      if(resource==="/sw.js"){
        response.setHeader("Service-Worker-Allowed","/");send(200,readFileSync(new URL("./sw.js",import.meta.url),"utf8"),"text/javascript; charset=utf-8");return;
      }
      if(resource.endsWith("offline.html")){
        const ru=resource.startsWith("/ru/");send(200,`<!doctype html><html lang="${ru?"ru":"en"}"><meta charset="utf-8">${VIEWPORT_META}<title>Kurami</title><h1>${ru?"Нет связи":"No connection"}</h1><a href="/${ru?"ru":"en"}/">Kurami</a></html>`,"text/html; charset=utf-8");return;
      }
      const png=resource.endsWith(".png"),body=readFileSync(new URL(`../ui-library/assets/brand/${png?"kurami-fox-transparent.png":"kurami-fox-header.webp"}`,import.meta.url));
      response.writeHead(200,{"Content-Type":png?"image/png":"image/webp"});response.end(request.method==="HEAD"?undefined:body);return;
    }
    if(!route||!("app" in route)){send(404,"Not found");return;}
    if(!["GET","HEAD","POST"].includes(request.method??"")||request.method==="POST"&&!route.upstream.startsWith("/api/")){send(405,"Method not allowed");return;}
    const headers:Record<string,string|string[]|undefined>={};
    const connectionHeaders=new Set(String(request.headers.connection??"").toLowerCase().split(",").map(value=>value.trim()));
    for(const [name,value] of Object.entries(request.headers))if(!hopHeaders.has(name)&&!connectionHeaders.has(name)&&!name.startsWith("x-kurami-")&&!name.startsWith("x-forwarded-"))headers[name]=value;
    headers.host=origin.host;headers["x-kurami-web-app"]=route.app;headers["x-kurami-web-lang"]=route.language;
    const target=new URL(route.upstream,upstreams[route.app]);
    const upstream=upstreamRequest(target,{method:request.method,headers},incoming=>{
      const nominated=new Set(String(incoming.headers.connection??"").toLowerCase().split(",").map(value=>value.trim()));
      for(const [name,value] of Object.entries(incoming.headers))if(value!==undefined&&!hopHeaders.has(name)&&!nominated.has(name))response.setHeader(name,value);
      response.setHeader("Cache-Control","private, no-store");
      if(String(incoming.headers["content-type"]??"").startsWith("text/html")){
        const existing=response.getHeader("set-cookie"),cookies=existing===undefined?[]:Array.isArray(existing)?existing.map(String):[String(existing)];
        response.setHeader("Set-Cookie",[...cookies,appearanceCookie(appearance(),origin.protocol==="https:")]);
      }
      response.writeHead(incoming.statusCode??502);
      incoming.on("error",()=>response.destroy());incoming.pipe(response);
    });
    const timeout=request.method==="POST"||route.app==="hub"&&route.upstream.startsWith("/api/controls")?90_000:15_000;
    upstream.setTimeout(timeout,()=>upstream.destroy(new Error("Upstream timeout")));
    upstream.on("error",()=>{if(!response.headersSent)send(502,"Application unavailable");else response.destroy();});
    request.on("aborted",()=>upstream.destroy());response.on("close",()=>{if(!response.writableEnded)upstream.destroy();});
    request.pipe(upstream);
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.KURAMI_WEB_PORT??8888);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid KURAMI_WEB_PORT");
  createWebServer().listen(port,"127.0.0.1",()=>console.log(`Kurami web gateway on 127.0.0.1:${port}`));
}
