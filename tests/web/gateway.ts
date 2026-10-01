import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer,request as httpRequest,type Server} from "node:http";
import {createWebServer} from "../../src/web/server.ts";
import {createHubServer} from "../../src/hub/server.ts";
import {createProjectsServer} from "../../src/projects-site/server.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";
import {mountResponse} from "../../src/web/presentation.ts";
import {PWA_MANIFEST_ICONS} from "../../src/web/icons.ts";
import {syntheticProjectsSnapshot} from "../projects-site/fixture.ts";

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
  const gateway=await gatewayServer({upstreams:{hub,projects,docs,digest},authorize:async(request,app)=>request.headers["x-test-identity"]==="owner"?{actor:"owner",scope:"owner"}:request.headers["x-test-identity"]==="reader"?{actor:"reader",scope:"docs-reader"}:null});
  const get=(path:string,identity="owner",extra:RequestInit={})=>fetch(gateway+path,{headers:{host:"kurami.shagon1k.win","x-test-identity":identity},redirect:"manual",...extra});
  assert.equal((await get("/en/","anonymous")).status,403);
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
  const worker=await get("/sw.js");assert.equal(worker.headers.get("service-worker-allowed"),"/");assert(!(await worker.text()).includes("cache.put"));
  assert.equal((await get("/en/projects/","owner",{method:"DELETE"})).status,405);
  assert.equal((await get("/_apps/docs/build.json")).status,404);
  assert.equal((await get("/_apps/digest/api/items/read","owner",{method:"POST"})).status,403,"mutations require same-origin browser requests");
  const forwarded=await get("/_apps/digest/api/fixture","owner",{method:"POST",headers:{"x-test-identity":"owner",origin:gateway,"content-type":"application/json"},body:"{}"});
  assert.equal(forwarded.status,200);assert.equal((await forwarded.json()).path,"/api/fixture","permitted writes retain app namespace");
  const wrongHost=await new Promise<number>((done,reject)=>{const request=httpRequest(gateway+"/en/",{headers:{host:"wrong.example","x-test-identity":"owner"}},response=>{response.resume();done(response.statusCode!);});request.on("error",reject);request.end();});assert.equal(wrongHost,421);
  const closed=await listen(createWebServer({upstreams:{hub,projects,docs,digest}}));assert.equal((await fetch(closed+"/en/",{headers:{host:"kurami.shagon1k.win"}})).status,403);
  // The existing origin is not silently converted into a unified site.
  assert(!(await (await fetch(hub+"/en/")).text()).includes('id="kurami-web-context"'));
  console.log("Unified gateway: mounted pages/APIs/resources, PWA, private cache policy, reader isolation and fail-closed entry verified");
}finally{for(const server of servers.reverse()){server.close();server.closeAllConnections();await once(server,"close");}}
