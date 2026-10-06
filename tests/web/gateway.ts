import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer,request as httpRequest,type Server} from "node:http";
import {createWebServer,appearanceCookie} from "../../src/web/server.ts";
import {createHubServer} from "../../src/hub/server.ts";
import {createProjectsServer} from "../../src/projects-site/server.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";
import {mountResponse} from "../../src/web/presentation.ts";
import {PWA_BACKGROUND,PWA_LEGACY_ICON_ASSETS,PWA_MANIFEST_ICONS,PWA_NEON_BACKGROUND,PWA_NEON_MANIFEST_ICONS} from "../../src/web/icons.ts";
import {neonTheme} from "../../src/ui-library/themes/neon.ts";
import {syntheticProjectsSnapshot} from "../projects-site/fixture.ts";
import {AccessVerificationUnavailableError} from "../../src/web/access-keys.ts";
import {VIEWPORT_META} from "../../src/ui-library/patterns/page-shell.ts";

const servers:Server[]=[];
async function listen(server:Server,port=0){servers.push(server);server.listen(port,"127.0.0.1");await once(server,"listening");const address=server.address();assert(address&&typeof address!=="string");return `http://127.0.0.1:${address.port}`;}
async function gatewayServer(options:Parameters<typeof createWebServer>[0]){
  const allocator=createServer();allocator.listen(0,"127.0.0.1");await once(allocator,"listening");const address=allocator.address();assert(address&&typeof address!=="string");const port=address.port;allocator.close();await once(allocator,"close");
  return listen(createWebServer({...options,origin:`http://127.0.0.1:${port}`}),port);
}
try{
  const hub=await listen(createHubServer({snapshot:syntheticHubSnapshot,authorize:async()=>"fixture-owner"}));
  const projects=await listen(createProjectsServer({snapshot:syntheticProjectsSnapshot,authorize:async()=>"fixture-owner"}));
  const docs=await listen(createServer((request,response)=>{
    mountResponse(request,response,"docs");response.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});response.end('<html><head></head><body><a href="/en/projects/">Docs page</a></body></html>');
  }));
  const digest=await listen(createServer((request,response)=>{
    mountResponse(request,response,"digest");
    if(request.url==="/en/cinema"){response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Content-Length":64});response.end('<html><head></head><body><a href="/en/weekly">Weekly</a></body></html>');}
    else {response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({path:request.url,app:request.headers["x-kurami-web-app"]}));}
  }));
  let appearanceDefault:string|null="neon.dark";
  const gateway=await gatewayServer({appearance:()=>appearanceDefault,upstreams:{hub,projects,docs,digest},authorize:async(request,app)=>request.headers["x-test-identity"]==="owner"?{actor:"owner",scope:"owner"}:request.headers["x-test-identity"]==="reader"?{actor:"reader",scope:"docs-reader"}:null});
  const get=(path:string,identity="owner",extra:RequestInit={})=>fetch(gateway+path,{headers:{host:"kurami.shagon1k.win","x-test-identity":identity},redirect:"manual",...extra});
  assert.equal((await get("/en/","anonymous")).status,403);
  // The Hub default theme rides on every page as a readable cookie; non-HTML responses do not carry it.
  const themed=await get("/en/docs/");
  assert.equal(themed.status,200);
  assert.deepEqual(themed.headers.getSetCookie().filter(cookie=>cookie.startsWith("kurami-theme-default=")),["kurami-theme-default=neon.dark; Max-Age=31536000; Path=/; SameSite=Lax"]);
  assert.deepEqual((await get("/en/digest/api/state")).headers.getSetCookie().filter(cookie=>cookie.startsWith("kurami-theme-default=")),[],"JSON keeps no theme cookie");
  appearanceDefault=null;
  assert.deepEqual((await get("/en/docs/")).headers.getSetCookie().filter(cookie=>cookie.startsWith("kurami-theme-default=")),["kurami-theme-default=; Max-Age=0; Path=/; SameSite=Lax"],"no default clears the cookie");
  appearanceDefault="paper.light";
  assert.equal(appearanceCookie("x; Domain=evil",true),"kurami-theme-default=; Max-Age=0; Path=/; SameSite=Lax; Secure","malformed values never reach the header");
  assert.equal((await get("/en/","reader")).status,403);
  assert.equal((await get("/_apps/projects/api/fragment","reader")).status,403);
  assert.equal((await get("/manifest.webmanifest","reader")).status,403);
  const font=await get("/assets/onest-latin.woff2");
  assert.equal(font.status,200);assert.equal(font.headers.get("content-type"),"font/woff2");
  assert.equal(font.headers.get("cache-control"),"private, max-age=86400");
  assert.equal((await get("/assets/onest-latin.woff2","anonymous")).status,403);
  assert.equal((await get("/assets/onest-latin.woff2","reader")).status,200,"Docs readers can load shared public-design fonts, but not private app data");
  assert.equal((await get("/en/docs/","reader")).status,200);
  assert.equal((await get("/en/docs/","reader",{method:"POST"})).status,403);
  const root=await get("/");assert.equal(root.status,302);assert.equal(root.headers.get("location"),"/en/");
  const home=await get("/en/");assert.equal(home.status,200);const html=await home.text();assert(html.includes('id="kurami-web-context"'));assert(html.includes('href="/_apps/hub/assets/hub.css?'));assert(html.includes('href="/en/docs/"'));assert(home.headers.get("cache-control")?.includes("no-store"));
  const ru=await get("/ru/");assert((await ru.text()).includes('"language":"ru"'));
  const taskPage=await get("/ru/projects/?project=pickflick");assert.equal(taskPage.status,200);assert((await taskPage.text()).includes('"language":"ru"'));
  const archive=await get("/en/digest/cinema/");assert.equal(archive.status,200);assert((await archive.text()).includes('href="/en/digest/weekly"'));
  const docPage=await get("/en/docs/projects/");assert((await docPage.text()).includes('href="/en/docs/projects/"'));
  const api=await get("/_apps/digest/api/profile/topics?x=1");assert.deepEqual(await api.json(),{path:"/api/profile/topics?x=1",app:"digest"});
  const stylesheet=await get("/_apps/hub/assets/hub.css");assert.equal(stylesheet.status,200);assert((await stylesheet.text()).includes('/assets/onest-'));
  const manifest=await get("/manifest.webmanifest");const data=await manifest.json();assert.equal(data.name,"Kurami");assert.equal(data.scope,"/");assert.equal(data.id,"/");assert.deepEqual(data.icons,PWA_MANIFEST_ICONS);
  assert.equal(data.background_color,PWA_BACKGROUND);assert.equal(data.theme_color,PWA_BACKGROUND);
  // The installed app follows the Hub default: Neon gets the neon fox and its own ground.
  appearanceDefault="neon.dark";
  const neon=await (await get("/manifest.webmanifest")).json();
  assert.deepEqual(neon.icons,PWA_NEON_MANIFEST_ICONS);assert.equal(neon.background_color,PWA_NEON_BACKGROUND);assert.equal(neon.theme_color,PWA_NEON_BACKGROUND);
  appearanceDefault="neon.light";
  const neonLight=await (await get("/manifest.webmanifest")).json();
  assert.deepEqual(neonLight.icons,PWA_NEON_MANIFEST_ICONS);assert.equal(neonLight.background_color,neonTheme.modes.light!.colors["surface-page"],"Neon light opens on the daylight ground");
  for(const expected of PWA_NEON_MANIFEST_ICONS){
    const icon=await get(expected.src);assert.equal(icon.status,200,expected.src);
    const png=Buffer.from(await icon.arrayBuffer());assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,expected.sizes);
  }
  appearanceDefault="paper.light";
  assert.equal(data.display,"standalone","PWA keeps its normal system bars instead of hiding them in fullscreen");
  for(const path of ["/en/","/ru/projects/","/en/digest/cinema/","/en/docs/projects/","/en/offline.html","/ru/offline.html"]){
    const page=await get(path);assert.equal(page.status,200,path);
    const source=await page.text();assert.ok(source.includes(VIEWPORT_META),`${path}: shared viewport applies to browser tabs and PWA navigations`);
    assert.equal(source.split(VIEWPORT_META).length,2,"one viewport per mounted or offline document");
  }
  assert(PWA_MANIFEST_ICONS.every(icon=>icon.src.endsWith('-v3.png')),'new installs use versioned vector exports');
  for(const expected of PWA_MANIFEST_ICONS){
    const icon=await get(expected.src);assert.equal(icon.status,200);assert.equal(icon.headers.get("content-type"),"image/png");
    assert(icon.headers.get("cache-control")?.includes("no-store"));
    const png=Buffer.from(await icon.arrayBuffer());assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,expected.sizes,"manifest size matches the actual export");
    assert.equal((await get(expected.src,"anonymous")).status,403,"icons remain behind Access");
    assert.equal((await get(expected.src,"reader")).status,403,"Docs credentials cannot access PWA assets");
    assert.equal((await get(expected.src,"owner",{method:"HEAD"})).status,200);
    assert.equal((await get(expected.src,"owner",{method:"POST",headers:{"x-test-identity":"owner",origin:gateway}})).status,405);
  }
  assert.equal((await get("/assets/kurami-fox.png")).status,200,"legacy icon bookmarks remain available");
  for(const icon of PWA_LEGACY_ICON_ASSETS){assert.equal((await get(icon.src)).status,200,'previous installed manifest URLs remain available');assert.equal((await get(icon.src,'anonymous')).status,403);assert.equal((await get(icon.src,'reader')).status,403);}
  const worker=await get("/sw.js");assert.equal(worker.headers.get("service-worker-allowed"),"/");const workerSource=await worker.text();assert(!workerSource.includes("cache.put"));assert.ok(workerSource.includes(VIEWPORT_META),"service-worker offline page also keeps the edge-to-edge viewport");
  assert.equal((await get("/en/projects/","owner",{method:"DELETE"})).status,405);
  assert.equal((await get("/_apps/docs/build.json")).status,404);
  assert.equal((await get("/_apps/digest/api/items/read","owner",{method:"POST"})).status,403,"mutations require same-origin browser requests");
  const forwarded=await get("/_apps/digest/api/fixture","owner",{method:"POST",headers:{"x-test-identity":"owner",origin:gateway,"content-type":"application/json"},body:"{}"});
  assert.equal(forwarded.status,200);assert.equal((await forwarded.json()).path,"/api/fixture","permitted writes retain app namespace");
  const wrongHost=await new Promise<number>((done,reject)=>{const request=httpRequest(gateway+"/en/",{headers:{host:"wrong.example","x-test-identity":"owner"}},response=>{response.resume();done(response.statusCode!);});request.on("error",reject);request.end();});assert.equal(wrongHost,421);
  const closed=await listen(createWebServer({upstreams:{hub,projects,docs,digest}}));assert.equal((await fetch(closed+"/en/",{headers:{host:"kurami.shagon1k.win"}})).status,403);
  const unavailable=await listen(createWebServer({upstreams:{hub,projects,docs,digest},authorize:async()=>{throw new AccessVerificationUnavailableError();}}));
  for(const path of ["/en/","/ru/projects/","/_apps/digest/api/profile/topics?lang=ru"]){
    const result=await fetch(unavailable+path);assert.equal(result.status,503);
    assert.equal(result.headers.get("retry-after"),"10");assert(result.headers.get("cache-control")?.includes("no-store"));
    const text=await result.text();assert(text.includes(path.includes("ru")?"Проверка входа временно недоступна":"Sign-in verification is temporarily unavailable"));
    assert(!text.includes("Access denied"));assert(!text.includes("fixture-owner"));
  }
  const head=await fetch(unavailable+"/en/",{method:"HEAD"});assert.equal(head.status,503);assert.equal(await head.text(),"");
  const unexpected=await listen(createWebServer({upstreams:{hub,projects,docs,digest},authorize:async()=>{throw new Error("fixture private detail");}}));
  const denied=await fetch(unexpected+"/en/");assert.equal(denied.status,403);assert.equal(await denied.text(),"Access denied");
  let snapshots=0,actions=0;
  const unavailableProjects=await listen(createProjectsServer({authorize:async()=>{throw new AccessVerificationUnavailableError();},snapshot:()=>{snapshots++;return syntheticProjectsSnapshot();}}));
  const projectFailure=await fetch(unavailableProjects+"/?lang=ru");assert.equal(projectFailure.status,503);assert((await projectFailure.text()).includes("Проверка входа временно недоступна"));assert.equal(snapshots,0);
  const unavailableHub=await listen(createHubServer({authorize:async()=>{throw new AccessVerificationUnavailableError();},controls:{execute:async()=>{actions++;return {};}} as any}));
  const hubFailure=await fetch(unavailableHub+"/api/controls?action=settings");assert.equal(hubFailure.status,503);assert.equal(hubFailure.headers.get("retry-after"),"10");assert.equal((await hubFailure.json()).ok,false);assert.equal(actions,0);
  // The existing origin is not silently converted into a unified site.
  assert(!(await (await fetch(hub+"/en/")).text()).includes('id="kurami-web-context"'));
  console.log("Unified gateway: mounted pages/APIs/resources, PWA, private cache policy, reader isolation and fail-closed entry verified");
}finally{for(const server of servers.reverse()){server.close();server.closeAllConnections();await once(server,"close");}}
