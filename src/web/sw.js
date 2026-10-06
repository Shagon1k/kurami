// Never retain private documents, API responses, authentication pages or mutations.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('kurami-web-'))await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||event.request.mode!=='navigate')return;
  event.respondWith(fetch(event.request).catch(()=>new Response(`<!doctype html><html lang="${url.pathname.startsWith('/ru/')?'ru':'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Kurami</title><h1>${url.pathname.startsWith('/ru/')?'Нет связи':'No connection'}</h1><a href="${url.pathname.startsWith('/ru/')?'/ru/':'/en/'}">Kurami</a></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
