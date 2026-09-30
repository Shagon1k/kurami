import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {HUB_CSS_URL,HUB_CLIENT_URL,versionedAsset} from "../../src/hub/assets.ts";

assert.match(HUB_CSS_URL,/^\/assets\/hub\.css\?v=[a-f0-9]{16}$/);
assert.match(HUB_CLIENT_URL,/^\/assets\/hub\.js\?v=[a-f0-9]{16}$/);
assert.equal(versionedAsset("/asset","same"),versionedAsset("/asset","same"));
assert.notEqual(versionedAsset("/asset","old"),versionedAsset("/asset","new"));

const origin="https://hub.example";
type WorkerEvent={request:Request;respondWith:(response:Promise<Response>)=>void;waitUntil:(task:Promise<unknown>)=>void};
const listeners=new Map<string,(event:WorkerEvent)=>void>();
const stores=new Map<string,Map<string,Response>>();
const current="kurami-hub-static-v8";
const key=(value:Request|string)=>new URL(typeof value==="string"?value:value.url,origin).href;
let online=true,body="fresh",type="text/css",status=200,failWrite=false,fetchCache:string|undefined;
const cache={
  match:async(value:Request|string)=>stores.get(current)?.get(key(value))?.clone(),
  put:async(value:Request|string,response:Response)=>{if(failWrite)throw new Error("quota");stores.get(current)!.set(key(value),response);},
};
stores.set(current,new Map([[key("/assets/hub.css"),new Response("stale")]]));
stores.set("kurami-hub-static-v7",new Map());
stores.set("unrelated-cache",new Map());
runInNewContext(readFileSync(new URL("../../src/hub/sw.js",import.meta.url),"utf8"),{
  URL,Request,Response,
  self:{location:{origin},addEventListener:(name:string,listener:(event:WorkerEvent)=>void)=>listeners.set(name,listener),clients:{claim:async()=>{}},skipWaiting:async()=>{}},
  caches:{open:async()=>cache,keys:async()=>[...stores.keys()],delete:async(name:string)=>stores.delete(name)},
  fetch:async(request:Request)=>{fetchCache=request.cache;if(!online)throw new Error("offline");return new Response(body,{status,headers:{"content-type":type}});},
});
async function fetchAsset(path:string):Promise<Response> {
  let result:Promise<Response>|undefined;
  listeners.get("fetch")!({request:new Request(origin+path),respondWith:response=>result=response,waitUntil:()=>{}});
  assert(result);return result;
}
assert.equal(await (await fetchAsset("/assets/hub.css")).text(),"fresh","network wins over stale cached styles");
assert.equal(fetchCache,"reload","HTTP cache cannot resurrect old styles");
assert.equal(await (await cache.match("/assets/hub.css"))!.text(),"fresh");
body="versioned";
assert.equal(await (await fetchAsset(HUB_CSS_URL)).text(),"versioned");
online=false;
assert.equal(await (await fetchAsset(HUB_CSS_URL)).text(),"versioned","offline exact-version fallback");
assert.equal(await (await fetchAsset("/assets/hub.css?v=missing")).text(),"fresh","pre-cached offline stylesheet fallback");
online=true;body="login page";type="text/html";
assert.equal(await (await fetchAsset("/assets/hub.css")).text(),"login page");
assert.equal(await (await cache.match("/assets/hub.css"))!.text(),"fresh","Access login HTML is never cached as CSS");
type="text/css";status=404;
await fetchAsset("/assets/hub.css");
assert.equal(await (await cache.match("/assets/hub.css"))!.text(),"fresh","failed responses do not poison the cache");
status=200;body="fresh despite quota";failWrite=true;
assert.equal(await (await fetchAsset("/assets/hub.css")).text(),body,"cache write failure still returns the new network stylesheet");
let activation:Promise<unknown>|undefined;
listeners.get("activate")!({request:new Request(origin),respondWith:()=>{},waitUntil:task=>activation=task});
await activation;
assert(!stores.has("kurami-hub-static-v7"));
assert(stores.has(current));
assert(stores.has("unrelated-cache"));
console.log("Hub asset fingerprints, network-first cache, offline fallback and scoped cleanup verified");
