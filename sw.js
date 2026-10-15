/* Drive Coach service worker: makes the app open without signal after the first visit.
   App files: network first (so updates arrive right away), cached copy when offline.
   Libraries and fonts: cache first. Map tiles: cached as you view them, newest 2000 kept. */
const V='dc-v3', SHELL=['./','index.html','css/app.css','js/data.js','js/logic.js','js/store.js','js/osm.js','js/report.js','js/app.js','manifest.webmanifest','icons/icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V&&k!=='dc-tiles').map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
async function trimTiles(c){const ks=await c.keys();if(ks.length>2000)await Promise.all(ks.slice(0,ks.length-2000).map(k=>c.delete(k)))}
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
  if(/overpass|nominatim/.test(u.host))return;                                    // live lookups: app has its own cache
  if(u.host==='tile.openstreetmap.org'){e.respondWith(caches.open('dc-tiles').then(async c=>{const hit=await c.match(e.request);
    const net=fetch(e.request).then(r=>{if(r.ok||r.type==='opaque'){c.put(e.request,r.clone());trimTiles(c)}return r}).catch(()=>hit);return hit||net}));return}
  if(/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(u.host)){e.respondWith(caches.open(V).then(async c=>{const hit=await c.match(e.request);
    return hit||fetch(e.request).then(r=>{c.put(e.request,r.clone());return r})}));return}
  if(u.origin===location.origin&&u.pathname.includes('/data/osm/')){e.respondWith(caches.open('dc-tiles').then(async c=>{const hit=await c.match(e.request);
    const net=fetch(e.request).then(r=>{if(r.ok)c.put(e.request,r.clone());return r}).catch(()=>hit);return u.pathname.endsWith('index.json')?(net||hit):(hit||net)}));return}
  if(u.origin===location.origin){e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(V).then(c=>c.put(e.request,cp))}return r})
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(h=>h||caches.match('index.html'))))}
});
