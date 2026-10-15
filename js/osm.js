/* Drive Coach: OpenStreetMap lookups (Overpass for road features, Nominatim for place search). */
const OSM=(()=>{
  const SERVERS=['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
  let lastErr='';
  /* Ask all servers at once and use whichever answers first. */
  async function overpass(q,timeoutMs=35000){const errs=[],ctls=SERVERS.map(()=>new AbortController());const tm=setTimeout(()=>ctls.forEach(c=>c.abort()),timeoutMs);
    const one=async(ep,i)=>{const host=new URL(ep).host;
      try{const res=await fetch(ep,{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:ctls[i].signal});
        if(!res.ok)throw new Error(host+' '+res.status);const j=await res.json();
        if(j.remark&&/runtime error|timed out|out of memory/i.test(j.remark)&&!(j.elements||[]).length)throw new Error(host+' busy');
        ctls.forEach((c,k)=>k!==i&&c.abort());return j.elements||[]}
      catch(e){const m=e.name==='AbortError'?host+' timeout':(String(e.message).startsWith(host)?e.message:host+' blocked');errs.push(m);throw new Error(m)}};
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
    const key='f:'+kinds.join('+')+'@'+s[0].toFixed(3)+','+s[1].toFixed(3);
    let els=await Store.osmGet(key);
    if(!els){els=await overpass(`[out:json][timeout:30];(${parts.join('')});out geom;`);Store.osmPut(key,els)}
    return parseFeatures(els)}

  /* Roads with their speed tags in a ~1.2 km circle, cached by ~1 km grid cell. */
  async function roads(ll){const cell=[Math.round(ll[0]*100)/100,Math.round(ll[1]*70)/70],key='r:'+cell[0].toFixed(2)+','+cell[1].toFixed(3);
    let ways=await Store.osmGet(key);
    if(!ways){const els=await overpass(`[out:json][timeout:20];way(around:1300,${cell[0]},${cell[1]})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];out geom tags;`,20000);
      ways=els.map(e=>({tags:{highway:e.tags.highway,maxspeed:e.tags.maxspeed,name:e.tags.name},g:(e.geometry||[]).map(p=>[+p.lat.toFixed(5),+p.lon.toFixed(5)])}));
      Store.osmPut(key,ways)}
    return {cell,ways}}

  async function search(q,bounds){const b=bounds;
    const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=ca&q=${encodeURIComponent(q)}&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`;
    const res=await fetch(url,{headers:{'Accept-Language':'en'}});if(!res.ok)throw new Error('search '+res.status);
    return (await res.json()).map(x=>({name:x.name||x.display_name.split(',')[0],addr:x.display_name.split(',').slice(1,3).join(',').trim(),ll:[+x.lat,+x.lon]}))}

  return {overpass,features,roads,search,get lastErr(){return lastErr}};
})();
