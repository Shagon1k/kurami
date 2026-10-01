import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {setTimeout as delay} from "node:timers/promises";
import {createHubServer} from "../../src/hub/server.ts";
import {renderHubPage} from "../../src/hub/render.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";
import {findBrowser,launchBrowser} from "../../src/ui-library/testing/devtools.ts";

const legacyWorker=`const CACHE="kurami-hub-static-v7";const STATIC=["/assets/hub.css"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("fetch",event=>{const url=new URL(event.request.url);if(STATIC.includes(url.pathname))event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));});`;
const hub=createHubServer({snapshot:syntheticHubSnapshot});
let released=false,upgradeWorker=false,networkDown=false;
const server=createServer((request,response)=>{
  if(networkDown){request.socket.destroy();return;}
  const path=new URL(request.url!,"http://localhost").pathname;
  if(path==="/sw.js"){
    response.writeHead(200,{"content-type":"text/javascript","cache-control":"no-cache"}).end(upgradeWorker?readFileSync(new URL("../../src/hub/sw.js",import.meta.url)):legacyWorker);return;
  }
  if(!released&&path==="/assets/hub.css"){
    response.writeHead(200,{"content-type":"text/css","cache-control":"private, max-age=300"}).end(".ui-icon {width:180px;height:180px;fill:black} .site-header {display:none}");return;
  }
  if(!released&&path==="/en/"){
    response.writeHead(200,{"content-type":"text/html","cache-control":"no-store"}).end(renderHubPage(syntheticHubSnapshot()).replace(/\?v=[a-f0-9]{16}/g,""));return;
  }
  hub.emit("request",request,response);
});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser=await launchBrowser(findBrowser());
const {devtools}=browser;
async function wait(expression:string){for(let i=0;i<200;i++){if(await devtools.evaluate<boolean>(expression))return;await delay(100);}throw new Error("Timed out: "+expression);}
async function navigate(path="/en/"){
  await devtools.evaluate("document.documentElement.dataset.cacheNavigation='previous'");
  await devtools.call("Page.navigate",{url:base+path});
  await wait("document.documentElement.dataset.cacheNavigation!=='previous' && document.readyState==='complete' && !!document.querySelector('header')");
  await devtools.evaluate("document.fonts.ready");
}
try {
  await navigate();
  await wait("!!navigator.serviceWorker.controller");
  assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.ui-icon')).width"),"180px");
  await devtools.evaluate("caches.open('unrelated-cache').then(c=>c.put('/other',new Response('keep')))" );
  released=true;
  for(let reload=0;reload<3;reload++){
    await navigate();
    assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.ui-icon')).width"),"18px","ordinary revisit bypasses the old worker's stale stylesheet");
    assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.ui-icon')).fill"),"none");
  }
  assert.equal(await devtools.evaluate("caches.open('kurami-hub-static-v7').then(c=>c.match('/assets/hub.css')).then(r=>r.text()).then(css=>css.includes('180px'))"),true,"old cache was present throughout the upgrade check");
  upgradeWorker=true;
  await devtools.evaluate("navigator.serviceWorker.getRegistration().then(r=>r.update())");
  await wait("caches.keys().then(keys=>keys.includes('kurami-hub-static-v8')&&!keys.includes('kurami-hub-static-v7'))");
  assert.equal(await devtools.evaluate("caches.keys().then(keys=>keys.includes('unrelated-cache'))"),true);
  await navigate();
  await devtools.evaluate("caches.open('kurami-hub-static-v8').then(c=>c.put(document.querySelector('link[rel=stylesheet]').href,new Response('.ui-icon {width:180px;fill:black}',{headers:{'content-type':'text/css'}})))");
  await navigate();
  assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.ui-icon')).width"),"18px","new worker fetches current CSS even if its cache is stale");
  networkDown=true;
  await navigate("/en/");
  assert.equal(await devtools.evaluate("document.title"),"Offline · Kurami Hub");
  assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.site-header__inner')).display"),"grid","offline shell keeps current styling");
  assert.equal(await devtools.evaluate("!!document.querySelector('#hub-dashboard')"),false,"private dashboard HTML is not cached");
  console.log("Hub real-browser v7 cache upgrade, ordinary reloads, v8 recovery and offline shell verified");
} finally {
  await browser.close();
  await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));
}
