/* Drive Coach: OpenStreetMap lookups (Overpass for road features, Nominatim for place search). */
const OSM=(()=>{
  let lastSource='';
  const SERVERS=['https://overpass-api.de/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass.kumi.systems/api/interpreter'];

  /* ---- Local copy: data/osm/ is refreshed weekly by a GitHub Action and served from this site, so no outside server is needed. ---- */
  let idxP=null;const tiles=new Map();
  function index(){return idxP=idxP||fetch('data/osm/index.json').then(r=>r.ok?r.json():null).then(j=>j&&{...j,f:new Set(j.f),r:new Set(j.r)}).catch(()=>{idxP=null;return null})}
  const tkey=(lat,lng,T)=>`${Math.floor(lat/T)}_${Math.floor(lng/T)}`;
  function keysAround(s,rM,T){const dLa=rM/111320,dLo=rM/(111320*Math.cos(s[0]*Math.PI/180)),out=[];
    for(let a=Math.floor((s[0]-dLa)/T);a<=Math.floor((s[0]+dLa)/T);a++)for(let b=Math.floor((s[1]-dLo)/T);b<=Math.floor((s[1]+dLo)/T);b++)out.push(a+'_'+b);return out}
  function tile(kind,k){const id=kind+'/'+k;if(!tiles.has(id))tiles.set(id,fetch(`data/osm/${kind}/${k}.json`).then(r=>r.ok?r.json():[]).catch(()=>{tiles.delete(id);return []}));return tiles.get(id)}
  async function localEls(kind,s,rM){const ix=await index();if(!ix||!inBox(s,ix.bbox))return null;
    const ks=keysAround(s,rM,ix.tile).filter(k=>ix[kind].has(k)),seen=new Set(),out=[];
    for(const arr of await Promise.all(ks.map(k=>tile(kind,k))))for(const e of arr){const id=(e.type||'w')+e.id;if(!seen.has(id)){seen.add(id);out.push(e)}}
    return out}
  const near=(e,s,r)=>e.type==='node'?hav(s,[e.lat,e.lon])<=r:(e.geometry||[]).some(p=>hav(s,[p.lat,p.lon])<=r);
  function kindOf(t){if(t.amenity==='parking')return 'lot';if(t.highway==='stop')return 'stop';if(t.highway==='traffic_signals')return 'signals';
    if(t.junction)return 'round';if(t.leisure==='playground')return 'play';if(/^(motorway|trunk)(_link)?$/.test(t.highway||''))return 'ramp';return null}
  const RADIUS={lot:2500,stop:2500,signals:3500,round:5000,play:2500,ramp:5000};
  async function dataInfo(){const ix=await index();return ix?{generated:ix.generated,bbox:ix.bbox}:null}
  let lastErr='';
  /* Ask all servers at once and use whichever answers first. */
  async function overpass(q,timeoutMs=35000){const errs=[],ctls=SERVERS.map(()=>new AbortController());const tm=setTimeout(()=>ctls.forEach(c=>c.abort()),timeoutMs);
    const one=async(ep,i)=>{const host=new URL(ep).host;
      try{const res=await fetch(ep,{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:ctls[i].signal});
        if(!res.ok)throw new Error(host+' '+res.status);const j=await res.json();
        if(j.remark&&/runtime error|timed out|out of memory/i.test(j.remark)&&!(j.elements||[]).length)throw new Error(host+' busy');
        ctls.forEach((c,k)=>k!==i&&c.abort());return j.elements||[]}
      catch(e){const m=e.name==='AbortError'?host+' too slow':(String(e.message).startsWith(host)?e.message:host+' refused');errs.push(m);throw new Error(m)}};
    try{lastErr='';return await Promise.any(SERVERS.map(one))}
    catch(e){lastErr=errs.join(', ');throw new Error(lastErr)}finally{clearTimeout(tm)}}

  /* Road features for auto-build around point s. kinds: lot, stop, signals, round, play, ramp. */
  async function features(kinds,s){
    const A=r=>`(around:${r},${s[0].toFixed(5)},${s[1].toFixed(5)})`,parts=[];
    if(kinds.includes('lot'))parts.push(`way["amenity"="parking"]${A(2500)};`);
    if(kinds.includes('stop'))parts.push(`node["highway"="stop"]${A(2500)};`);
    if(kinds.includes('signals'))parts.push(`node["highway"="traffic_signals"]${A(3500)};`);
    if(kinds.includes('round'))parts.push(`way["junction"~"^(roundabout|circular)$"]${A(5000)};`);
    if(kinds.includes('play'))parts.push(`node["leisure"="playground"]${A(2500)};way["leisure"="playground"]${A(2500)};`);
    if(kinds.includes('ramp'))parts.push(`way["highway"~"^(motorway|trunk|motorway_link|trunk_link)$"]${A(5000)};`);
    const loc=await localEls('f',s,Math.max(...kinds.map(k=>RADIUS[k])));
    if(loc){lastSource='local';return parseFeatures(loc.filter(e=>{const k=kindOf(e.tags||{});return k&&kinds.includes(k)&&near(e,s,RADIUS[k])}))}
    lastSource='live';
    const key='f:'+kinds.join('+')+'@'+s[0].toFixed(3)+','+s[1].toFixed(3);
    let els=await Store.osmGet(key);
    if(!els){els=await overpass(`[out:json][timeout:30];(${parts.join('')});out geom;`);Store.osmPut(key,els)}
    return parseFeatures(els)}

  /* Roads with their speed tags in a ~1.2 km circle, cached by ~1 km grid cell. */
  async function roads(ll){
    const loc=await localEls('r',ll,1300);
    if(loc)return {cell:ll,ways:loc.map(w=>({tags:{highway:w.h,maxspeed:w.m,name:w.n},g:w.g}))};
    const cell=[Math.round(ll[0]*100)/100,Math.round(ll[1]*70)/70],key='r:'+cell[0].toFixed(2)+','+cell[1].toFixed(3);
    let ways=await Store.osmGet(key);
    if(!ways){const els=await overpass(`[out:json][timeout:20];way(around:1300,${cell[0]},${cell[1]})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];out geom tags;`,20000);
      ways=els.map(e=>({tags:{highway:e.tags.highway,maxspeed:e.tags.maxspeed,name:e.tags.name},g:(e.geometry||[]).map(p=>[+p.lat.toFixed(5),+p.lon.toFixed(5)])}));
      Store.osmPut(key,ways)}
    return {cell,ways}}

  /* Driving route along real roads through the pins, from the public OSRM router. Returns {g:[[lat,lng]...], km, min}. */
  async function drivePath(pts){if(pts.length<2)return null;
    const url=`https://router.project-osrm.org/route/v1/driving/${pts.slice(0,25).map(p=>p[1].toFixed(6)+','+p[0].toFixed(6)).join(';')}?overview=full&geometries=geojson&continue_straight=false`;
    const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),15000);
    try{const res=await fetch(url,{signal:ctl.signal});if(!res.ok)throw new Error('router '+res.status);const j=await res.json();
      if(j.code!=='Ok'||!j.routes||!j.routes[0])throw new Error('no route');const r=j.routes[0];
      return {g:r.geometry.coordinates.map(c=>[+c[1].toFixed(5),+c[0].toFixed(5)]),km:+(r.distance/1000).toFixed(1),min:Math.round(r.duration/60)}}
    finally{clearTimeout(tm)}}

  async function search(q,bounds){const b=bounds;
    const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=ca&q=${encodeURIComponent(q)}&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`;
    const res=await fetch(url,{headers:{'Accept-Language':'en'}});if(!res.ok)throw new Error('search '+res.status);
    return (await res.json()).map(x=>({name:x.name||x.display_name.split(',')[0],addr:x.display_name.split(',').slice(1,3).join(',').trim(),ll:[+x.lat,+x.lon]}))}

  return {overpass,features,roads,search,drivePath,dataInfo,get lastErr(){return lastErr},get lastSource(){return lastSource}};
})();
