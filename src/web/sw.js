// Never retain private documents, API responses, authentication pages or mutations. The one exception is the
// owner's explicit "Read offline" in Daily: one news-only page (no mail, calendar or images), kept under
// OFFLINE_NEWS and shown when Digest opens without a network. Turning it off deletes it.
const OFFLINE_NEWS='kurami-offline-news';
async function saveOfflineNews(lang){
  const response=await fetch(`/${lang==='en'?'en':'ru'}/digest/offline-news`,{credentials:'include',cache:'no-store'});
  if(!response.ok||!(response.headers.get('content-type')??'').startsWith('text/html'))return false;
  await (await caches.open(OFFLINE_NEWS)).put('/offline-news',response);
  return true;
}
self.addEventListener('message',event=>{
  const data=event.data;
  if(data?.type!=='offline-news')return;
  event.waitUntil((data.enabled?saveOfflineNews(data.lang):caches.delete(OFFLINE_NEWS)).then(ok=>event.source?.postMessage({type:'offline-news',enabled:Boolean(data.enabled),ok:ok!==false})));
});
const OFFLINE_ART='kurami-offline-art',OFFLINE_PICTURE='/assets/kurami-offline.webp';
// Kurami's offline picture is kept at install, so the no-network page can show her without the network.
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(OFFLINE_ART).then(cache=>cache.add(OFFLINE_PICTURE)).catch(()=>{}));});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('kurami-web-'))await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method==='GET'&&url.origin===self.location.origin&&url.pathname===OFFLINE_PICTURE){event.respondWith(fetch(event.request).catch(async()=>(await caches.match(OFFLINE_PICTURE))??Response.error()));return;}
  if(event.request.method!=='GET'||url.origin!==self.location.origin||event.request.mode!=='navigate')return;
  const digest=/^\/(en|ru)\/digest(\/|$)/.exec(url.pathname);
  event.respondWith(fetch(event.request).then(response=>{
    // While on, each Daily visit refreshes the copy, at most every half hour.
    // caches.has comes first: opening the cache would create it and turn offline reading on by itself.
    if(digest&&response.ok)event.waitUntil(caches.has(OFFLINE_NEWS).then(async enabled=>{
      if(!enabled)return;
      const saved=await (await caches.open(OFFLINE_NEWS)).match('/offline-news');
      if(saved&&Date.now()-Date.parse(saved.headers.get('date')??'')<1800000)return;
      await saveOfflineNews(digest[1]);
    }).catch(()=>{}));
    return response;
  }).catch(async()=>(digest&&await caches.has(OFFLINE_NEWS)?await (await caches.open(OFFLINE_NEWS)).match('/offline-news'):null)??new Response(`<!doctype html><html lang="${url.pathname.startsWith('/ru/')?'ru':'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Kurami</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#fbfbf8;color:#1f1d1a"><main style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px;padding:24px"><img src="${OFFLINE_PICTURE}" width="160" height="160" alt=""><div><h1 style="margin:0 0 8px">${url.pathname.startsWith('/ru/')?'Нет связи':'No connection'}</h1><p style="margin:0 0 12px;color:#6b6760">${url.pathname.startsWith('/ru/')?'Kurami ждёт сеть. Страница откроется, как только связь вернётся.':'Kurami is waiting for the network. The page opens as soon as it is back.'}</p><a href="${url.pathname.startsWith('/ru/')?'/ru/':'/en/'}">Kurami</a></div></main></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
// Push: the message carries nothing; the newest notice comes from Hub through the owner's session, in the
// language the device subscribed with. A tap opens the page the notice is about.
self.addEventListener('push',event=>event.waitUntil((async()=>{
  let notice=null;
  try {
    const subscription=await self.registration.pushManager.getSubscription();
    const response=await fetch('/_apps/hub/api/push/latest?endpoint='+encodeURIComponent(subscription?.endpoint??''),{credentials:'include',cache:'no-store'});
    if(response.ok)notice=(await response.json()).notice;
  } catch {}
  // Every push must show something, or the browser stops delivering them.
  await self.registration.showNotification(notice?.title??'Kurami',{body:notice?.body??'',tag:notice?.tag??'kurami',icon:'/assets/kurami-fox.png',data:{url:notice?.url??'/'}});
})()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL(event.notification.data?.url??'/',self.location.origin);
    if(url.origin!==self.location.origin)return;
    for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
      if('navigate' in client){await client.focus();await client.navigate(url.href);return;}
    }
    await self.clients.openWindow(url.href);
  })());
});
