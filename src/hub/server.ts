import {createServer,type Server} from "node:http";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {fontFiles} from "../ui-library/foundations/fonts.ts";
import {THEME_RUNTIME_JS} from "../ui-library/runtime/theme.ts";
import {kuramiTheme} from "../ui-library/themes/index.ts";
import {HUB_STYLES} from "./styles.ts";
import {collectHubSnapshot,type HubSnapshot} from "./snapshot.ts";
import {renderHubDashboard,renderHubOffline,renderHubPage} from "./render.ts";

const appRoot=resolve(import.meta.dirname,"../..");
const assetRoot=resolve(appRoot,"src/ui-library/assets");
const hubRoot=resolve(appRoot,"src/hub");
const assets=new Map<string,{body:Buffer|string;type:string;cache:string}>([
  ["/assets/hub.css",{body:HUB_STYLES,type:"text/css; charset=utf-8",cache:"private, max-age=300"}],
  ["/assets/theme.js",{body:THEME_RUNTIME_JS,type:"text/javascript; charset=utf-8",cache:"private, max-age=300"}],
  ["/assets/hub.js",{body:readFileSync(resolve(hubRoot,"client.js")),type:"text/javascript; charset=utf-8",cache:"private, max-age=300"}],
  ["/assets/fox.png",{body:readFileSync(resolve(assetRoot,"brand/kurami-fox-transparent.png")),type:"image/png",cache:"private, max-age=86400"}],
  ["/assets/favicon.svg",{body:readFileSync(resolve(assetRoot,"brand/kurami-favicon.svg")),type:"image/svg+xml",cache:"private, max-age=86400"}],
  ["/sw.js",{body:readFileSync(resolve(hubRoot,"sw.js")),type:"text/javascript; charset=utf-8",cache:"no-cache"}],
  ["/manifest.webmanifest",{body:JSON.stringify({name:"Kurami Hub",short_name:"Kurami",description:"Личная главная страница Kurami",lang:"ru",start_url:"/",scope:"/",display:"standalone",background_color:kuramiTheme.light.colors["surface-page"],theme_color:kuramiTheme.light.colors["surface-page"],icons:[{src:"/assets/fox.png",sizes:"1254x1254",type:"image/png",purpose:"any"}]}),type:"application/manifest+json; charset=utf-8",cache:"private, max-age=300"}],
]);
for(const font of fontFiles)assets.set(`/assets/${font.file}`,{body:readFileSync(resolve(assetRoot,"fonts",font.file)),type:"font/woff2",cache:"private, max-age=86400"});

const securityHeaders={
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "X-Frame-Options":"DENY",
  "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'",
};

export function createHubServer(options:{snapshot?:()=>HubSnapshot}={}):Server {
  const snapshot=options.snapshot??collectHubSnapshot;
  let cached:{at:number;value:HubSnapshot}|null=null;
  function current():HubSnapshot {
    const now=Date.now();
    if(cached&&now-cached.at<45_000)return cached.value;
    const value=snapshot();cached={at:now,value};return value;
  }
  return createServer((request,response)=>{
    for(const [name,value] of Object.entries(securityHeaders))response.setHeader(name,value);
    if(request.method!=="GET"&&request.method!=="HEAD"){
      response.writeHead(405,{Allow:"GET, HEAD","Cache-Control":"no-store"}).end();return;
    }
    let path:string;
    try {path=new URL(request.url??"/","http://localhost").pathname;}
    catch {response.writeHead(400,{"Cache-Control":"no-store"}).end();return;}
    let body:Buffer|string;
    let type:string;
    let cache:string;
    try {
      if(path==="/"||path==="/index.html"){
        body=renderHubPage(current());type="text/html; charset=utf-8";cache="no-store";
      } else if(path==="/api/fragment"){
        body=renderHubDashboard(current());type="text/html; charset=utf-8";cache="no-store";
      } else if(path==="/offline.html"){
        body=renderHubOffline();type="text/html; charset=utf-8";cache="private, max-age=300";
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
