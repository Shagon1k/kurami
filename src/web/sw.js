// Never retain private documents, API responses, authentication pages or mutations.
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
  event.respondWith(fetch(event.request).catch(()=>new Response(`<!doctype html><html lang="${url.pathname.startsWith('/ru/')?'ru':'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Kurami</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#fbfbf8;color:#1f1d1a"><main style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px;padding:24px"><img src="${OFFLINE_PICTURE}" width="160" height="160" alt=""><div><h1 style="margin:0 0 8px">${url.pathname.startsWith('/ru/')?'Нет связи':'No connection'}</h1><p style="margin:0 0 12px;color:#6b6760">${url.pathname.startsWith('/ru/')?'Kurami ждёт сеть. Страница откроется, как только связь вернётся.':'Kurami is waiting for the network. The page opens as soon as it is back.'}</p><a href="${url.pathname.startsWith('/ru/')?'/ru/':'/en/'}">Kurami</a></div></main></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
