import {createServer,type Server} from "node:http";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {randomBytes,timingSafeEqual} from "node:crypto";
import type {IncomingMessage} from "node:http";
import {HubAccess} from "./access.ts";
import {createHubControls,HubControlError} from "./controls.ts";
import {renderControlView} from "./control-view.ts";
import {readCodexAccount,type CodexAccountSnapshot} from "./codex-account.ts";
import {fontFiles} from "../ui-library/foundations/fonts.ts";
import {THEME_RUNTIME_JS} from "../ui-library/runtime/theme.ts";
import {kuramiTheme} from "../ui-library/themes/index.ts";
import {HUB_STYLES} from "./styles.ts";
import {collectHubSnapshot,type HubSnapshot} from "./snapshot.ts";
import {renderHubDashboard,renderHubOffline,renderHubPage,type HubLanguage} from "./render.ts";

const appRoot=resolve(import.meta.dirname,"../..");
const assetRoot=resolve(appRoot,"src/ui-library/assets");
const hubRoot=resolve(appRoot,"src/hub");
const assets=new Map<string,{body:Buffer|string;type:string;cache:string}>([
  ["/assets/hub.css",{body:HUB_STYLES,type:"text/css; charset=utf-8",cache:"private, max-age=300"}],
  ["/assets/theme.js",{body:THEME_RUNTIME_JS,type:"text/javascript; charset=utf-8",cache:"private, max-age=300"}],
  ["/assets/hub.js",{body:readFileSync(resolve(hubRoot,"client.js")),type:"text/javascript; charset=utf-8",cache:"private, max-age=300"}],
  ["/assets/fox.png",{body:readFileSync(resolve(assetRoot,"brand/kurami-fox-transparent.png")),type:"image/png",cache:"private, max-age=86400"}],
  ["/assets/fox.webp",{body:readFileSync(resolve(assetRoot,"brand/kurami-fox-header.webp")),type:"image/webp",cache:"private, max-age=86400"}],
  ["/assets/favicon.svg",{body:readFileSync(resolve(assetRoot,"brand/kurami-favicon.svg")),type:"image/svg+xml",cache:"private, max-age=86400"}],
  ["/sw.js",{body:readFileSync(resolve(hubRoot,"sw.js")),type:"text/javascript; charset=utf-8",cache:"no-cache"}],
]);
for(const lang of ["ru","en"] as const)assets.set(`/${lang}/manifest.webmanifest`,{body:JSON.stringify({name:"Kurami Hub",short_name:"Kurami",description:lang==="ru"?"Личная главная страница Kurami":"Kurami personal dashboard",lang,start_url:`/${lang}/`,scope:"/",display:"standalone",background_color:kuramiTheme.light.colors["surface-page"],theme_color:kuramiTheme.light.colors["surface-page"],icons:[{src:"/assets/fox.png",sizes:"512x512",type:"image/png",purpose:"any"}]}),type:"application/manifest+json; charset=utf-8",cache:"private, max-age=300"});
for(const font of fontFiles)assets.set(`/assets/${font.file}`,{body:readFileSync(resolve(assetRoot,"fonts",font.file)),type:"font/woff2",cache:"private, max-age=86400"});

const securityHeaders={
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "X-Frame-Options":"DENY",
  "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'",
};

export function createHubServer(options:{snapshot?:()=>HubSnapshot;account?:()=>Promise<CodexAccountSnapshot>;controls?:ReturnType<typeof createHubControls>;authorize?:(request:IncomingMessage)=>Promise<string|null>;controlOrigin?:string}={}):Server {
  const snapshot=options.snapshot??collectHubSnapshot;
  const account=options.account??(options.snapshot?null:readCodexAccount);
  const controls=options.controls??(process.env.HUB_CONTROLS_ENABLED==="true"?createHubControls():null);
  const access=new HubAccess();
  const authorize=options.authorize??((request)=>access.authorize(request));
  const origin=options.controlOrigin??process.env.HUB_CONTROL_ORIGIN??"https://hub.shagon1k.win";
  const cookieName="__Host-kurami-control";
  let cached:{at:number;value:HubSnapshot}|null=null;
  let collecting:Promise<HubSnapshot>|null=null;
  let mutating=false;
  async function current():Promise<HubSnapshot> {
    const now=Date.now();
    if(cached&&now-cached.at<45_000)return cached.value;
    if(collecting)return collecting;
    collecting=(async()=>{
      const base=snapshot();const live=account?await account():null;
      const value={...base,codex:{...base.codex,...(live?{account:live,limits:live.state==="live"?live.limits:base.codex.limits}:{})}};
      cached={at:Date.now(),value};return value;
    })();
    try{return await collecting;}finally{collecting=null;}
  }
  return createServer(async(request,response)=>{
    for(const [name,value] of Object.entries(securityHeaders))response.setHeader(name,value);
    let path:string;
    let lang:HubLanguage;
    try {const url=new URL(request.url??"/","http://localhost");path=url.pathname;lang=(path.startsWith("/ru/")||path==="/ru"||path==="/api/fragment"&&url.searchParams.get("lang")==="ru")?"ru":"en";}
    catch {response.writeHead(400,{"Cache-Control":"no-store"}).end();return;}
    if(path==="/api/controls"){
      const json=(status:number,value:unknown)=>{response.writeHead(status,{"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8"}).end(JSON.stringify(value));};
      if(!controls){json(503,{ok:false,error:"controls_unavailable"});return;}
      if(request.method!=="GET"&&request.method!=="POST"){json(405,{ok:false,error:"method_not_allowed"});return;}
      const identity=await authorize(request).catch(()=>null);
      if(!identity){json(403,{ok:false,error:"unauthorized"});return;}
      try{
        const url=new URL(request.url!,origin);lang=url.searchParams.get("lang")==="ru"?"ru":"en";
        if(request.method==="GET"){
          const action=url.searchParams.get("action")??"";
          if(!["models","settings","composio-check"].includes(action)){json(400,{ok:false,error:"invalid_request"});return;}
          const result=await controls.execute(action,{},identity);
          json(200,{ok:true,html:renderControlView(action,result,lang)});return;
        }
        const cookie=request.headers.cookie?.split(/;\s*/).find(value=>value.startsWith(cookieName+"="))?.slice(cookieName.length+1);
        const token=request.headers["x-hub-control-token"];
        if(request.headers.origin!==origin||!cookie||typeof token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(cookie)||token.length!==cookie.length||!timingSafeEqual(Buffer.from(cookie),Buffer.from(token))){json(403,{ok:false,error:"invalid_origin"});return;}
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"]??"")){json(415,{ok:false,error:"invalid_request"});return;}
        let body="";for await(const chunk of request){body+=chunk.toString();if(Buffer.byteLength(body)>32_768){json(413,{ok:false,error:"invalid_request"});return;}}
        let payload:any;try{payload=JSON.parse(body);}catch{json(400,{ok:false,error:"invalid_request"});return;}
        if(!payload||typeof payload!=="object"||payload.confirm!==true||typeof payload.action!=="string"||["models","settings","composio-check"].includes(payload.action)){json(400,{ok:false,error:"confirmation_required"});return;}
        if(mutating){json(409,{ok:false,error:"action_in_progress"});return;}
        mutating=true;
        try{const result=await controls.execute(payload.action,payload,identity);cached=null;json(200,{ok:true,action:result?.action,outcome:result?.outcome,auditWarning:result?.auditWarning===true});}
        finally{mutating=false;}
      }catch(error){json(error instanceof HubControlError&&error.code==="invalid_request"?400:409,{ok:false,error:error instanceof HubControlError?error.code:"action_failed"});}
      return;
    }
    if(request.method!=="GET"&&request.method!=="HEAD"){
      response.writeHead(405,{Allow:"GET, HEAD","Cache-Control":"no-store"}).end();return;
    }
    let body:Buffer|string;
    let type:string;
    let cache:string;
    try {
      if(path==="/"||path==="/index.html"||path==="/offline.html"||path==="/manifest.webmanifest"){
        const suffix=path==="/"||path==="/index.html"?"/":path;
        response.writeHead(302,{Location:`/en${suffix}`,"Cache-Control":"no-store"}).end();return;
      } else if(path==="/en"||path==="/ru"){
        response.writeHead(302,{Location:`/${lang}/`,"Cache-Control":"no-store"}).end();return;
      } else if(path==="/ru/"||path==="/en/"){
        const previous=request.headers.cookie?.split(/;\s*/).find(value=>value.startsWith(cookieName+"="))?.slice(cookieName.length+1);
        const token=previous&&/^[A-Za-z0-9_-]{43}$/.test(previous)?previous:randomBytes(32).toString("base64url");
        response.setHeader("Set-Cookie",`${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict`);
        body=renderHubPage(await current(),lang,token);type="text/html; charset=utf-8";cache="no-store";
      } else if(path==="/api/fragment"){
        body=renderHubDashboard(await current(),lang);type="text/html; charset=utf-8";cache="no-store";
      } else if(path==="/ru/offline.html"||path==="/en/offline.html"){
        body=renderHubOffline(lang);type="text/html; charset=utf-8";cache="private, max-age=300";
      } else if(path==="/health"){
        body=JSON.stringify({ok:true});type="application/json; charset=utf-8";cache="no-store";
      } else {
        const asset=assets.get(path);
        if(!asset){response.writeHead(404,{"Cache-Control":"no-store"}).end();return;}
        ({body,type,cache}=asset);
      }
      response.writeHead(200,{"Content-Type":type,"Content-Length":Buffer.byteLength(body),"Cache-Control":cache});
      response.end(request.method==="HEAD"?undefined:body);
    } catch {
      response.writeHead(503,{"Cache-Control":"no-store","Content-Type":"text/plain; charset=utf-8"}).end(request.method==="HEAD"?undefined:"Hub data unavailable");
    }
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.HUB_PORT??8800);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid HUB_PORT");
  createHubServer().listen(port,"127.0.0.1",()=>console.log(`Kurami Hub listening on 127.0.0.1:${port}`));
}
