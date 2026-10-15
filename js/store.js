/* Drive Coach: storage. Everything lives in IndexedDB on this device (no size cap like localStorage's ~5 MB).
   Keys: 'state' = app data, 'active' = the lesson in progress (crash recovery), 'osm:*' = cached map lookups. */
const Store=(()=>{
  const LEGACY_KEY='driveCoach.v1',DB='driveCoach',OS='kv';
  let dbp=null,fallback=false;
  function open(){return dbp=dbp||new Promise((res,rej)=>{
    if(!('indexedDB' in self)){fallback=true;return res(null)}
    const rq=indexedDB.open(DB,1);rq.onupgradeneeded=()=>rq.result.createObjectStore(OS);
    rq.onsuccess=()=>res(rq.result);rq.onerror=()=>{fallback=true;res(null)};rq.onblocked=()=>{fallback=true;res(null)}})}
  async function tx(mode,fn){const db=await open();if(!db)throw new Error('no-idb');
    return new Promise((res,rej)=>{const t=db.transaction(OS,mode),os=t.objectStore(OS),rq=fn(os);
      t.oncomplete=()=>res(rq&&rq.result);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})}
  const lsGet=k=>{try{return JSON.parse(localStorage.getItem('dc.'+k))}catch(e){return null}};
  const lsSet=(k,v)=>{try{v==null?localStorage.removeItem('dc.'+k):localStorage.setItem('dc.'+k,JSON.stringify(v));return true}catch(e){return false}};
  async function get(k){try{return await tx('readonly',os=>os.get(k))}catch(e){return lsGet(k)}}
  async function set(k,v){try{await tx('readwrite',os=>os.put(v,k));return true}catch(e){return lsSet(k,v)}}
  async function del(k){try{await tx('readwrite',os=>os.delete(k))}catch(e){lsSet(k,null)}}
  async function keys(){try{return await tx('readonly',os=>os.getAllKeys())}catch(e){return []}}

  /* Load app state; moves data over from the old localStorage version the first time. */
  async function loadState(){let s=await get('state');
    if(!s){try{const old=JSON.parse(localStorage.getItem(LEGACY_KEY));if(old&&Array.isArray(old.routes)){s=old;s.onboarded=true;await set('state',s);localStorage.removeItem(LEGACY_KEY)}}catch(e){}}
    return s}
  let timer=null,pending=null;
  /* Debounced save so typing doesn't write on every keystroke. flush() writes immediately. */
  function saveState(S){pending=S;clearTimeout(timer);timer=setTimeout(flush,250)}
  async function flush(){clearTimeout(timer);if(!pending)return true;const s=pending;pending=null;
    // structuredClone drops nothing we use and protects against the object changing mid-write
    const ok=await set('state',JSON.parse(JSON.stringify(s)));if(!ok&&typeof toast==='function')toast('Could not save on this phone. Storage may be full.');return ok}
  /* Ask the browser not to evict our data under storage pressure. Granted automatically for Home Screen apps on iOS. */
  async function persist(){try{return await navigator.storage?.persist?.()}catch(e){return false}}
  async function usage(){try{const e=await navigator.storage?.estimate?.();return e||null}catch(e){return null}}

  /* OSM cache with a 7-day life; keeps the 30 newest entries. */
  async function osmGet(k){const v=await get('osm:'+k);return v&&Date.now()-v.t<7*864e5?v.data:null}
  async function osmPut(k,data){await set('osm:'+k,{t:Date.now(),data});
    const ks=(await keys()).filter(x=>String(x).startsWith('osm:'));if(ks.length>30){
      const ent=await Promise.all(ks.map(async x=>[x,((await get(x))||{}).t||0]));ent.sort((a,b)=>a[1]-b[1]).slice(0,ks.length-30).forEach(([x])=>del(x))}}

  return {get,set,del,loadState,saveState,flush,persist,usage,osmGet,osmPut,get usingFallback(){return fallback}};
})();
