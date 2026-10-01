const CACHE="kurami-hub-static-v8";
const STATIC=["/ru/offline.html","/en/offline.html","/assets/hub.css","/assets/theme.js","/assets/fox.webp","/assets/favicon.svg"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC.map(url=>new Request(url,{cache:"reload"})))).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("kurami-hub-static-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=="GET")return;
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request).catch(()=>caches.match(url.pathname.startsWith("/ru/")?"/ru/offline.html":"/en/offline.html")));
    return;
  }
  if(STATIC.includes(url.pathname))event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try {
      const response=await fetch(new Request(event.request,{cache:"reload"}));
      const type=response.headers.get("content-type")??"";
      const expected=url.pathname.endsWith(".css")?"text/css":url.pathname.endsWith(".js")?"javascript":url.pathname.endsWith(".html")?"text/html":"image/";
      if(response.ok&&!response.redirected&&type.includes(expected))await cache.put(event.request,response.clone()).catch(()=>{});
      return response;
    } catch(error) {
      const hit=await cache.match(event.request)??await cache.match(url.pathname);
      if(hit)return hit;
      throw error;
    }
  })());
});
