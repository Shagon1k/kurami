const CACHE="kurami-hub-static-v7";
const STATIC=["/ru/offline.html","/en/offline.html","/assets/hub.css","/assets/theme.js","/assets/fox.webp","/assets/favicon.svg"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC.map(url=>new Request(url,{cache:"reload"})))).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=="GET")return;
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request).catch(()=>caches.match(url.pathname.startsWith("/ru/")?"/ru/offline.html":"/en/offline.html")));
    return;
  }
  if(STATIC.includes(url.pathname))event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));
});
