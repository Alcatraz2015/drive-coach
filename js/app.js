/* Drive Coach: app shell. Map, live lesson, views and events.
   Depends on data.js (content), logic.js (pure helpers), store.js (IndexedDB), osm.js (OpenStreetMap), report.js (lesson report). */
'use strict';
const ARRIVE_M=35, ANNOUNCE_M=250;
let S=null;                         // all saved data (see seed())
const pane=document.getElementById('pane'), appEl=document.querySelector('.app');

/* ---------- data model ---------- */
function seed(){
  const routes=TEMPLATES.map(t=>({id:uid(),name:t.name,stage:t.stage,goal:t.goal,cps:[]}));
  return {routes,skills:{},sessions:[],activeRouteId:routes[0].id,onboarded:false};
}
function migrate(x){
  if(!x.profiles){x.profiles=[{id:'p1',name:'Learner',since:'',testDate:'',goalHours:''}];x.profileId='p1';x.pdata={}}
  x.sessions=x.sessions||[];x.skills=x.skills||{};x.pdata=x.pdata||{};
  x.settings=Object.assign({voice:true,speedAlerts:true,autoSpeedMarks:true,checklist:true,autoChecks:true,spotWarnings:true},x.settings||{});
  x.places=x.places||[];x.userStops=x.userStops||[];
  if(x.onboarded==null)x.onboarded=true;
  // Every stage route 1-6 must exist; bring back any that were deleted (empty, ready for pins).
  TEMPLATES.forEach((t,i)=>{if(!x.routes.some(r=>stageNum(r)===i+1))x.routes.push({id:uid(),name:t.name,stage:t.stage,goal:t.goal,cps:[]})});
  x.routes.forEach(r=>{if(r.cps.length&&r.cps.every(c=>c.lat==null))r.cps=[]});
  x.routes.sort((a,b)=>(stageNum(a)||99)-(stageNum(b)||99));
  if(!x.routes.some(r=>r.id===x.activeRouteId))x.activeRouteId=x.routes[0].id;
  return x}
const prof=()=>S.profiles.find(p=>p.id===S.profileId)||S.profiles[0];
const route=()=>S.routes.find(r=>r.id===S.activeRouteId)||S.routes[0];
const allAreas=()=>[...AREAS,...(S.areas||[])];
const curArea=()=>allAreas().find(a=>a.id===S.areaId)||AREAS[0];
function save(){Store.saveState(S)}

/* ---------- toast (with optional Undo) ---------- */
let toastT;
function toast(msg,opt={}){document.querySelector('.toast')?.remove();const d=document.createElement('div');d.className='toast';d.setAttribute('role','status');
  const s=document.createElement('span');s.textContent=msg;d.appendChild(s);
  if(opt.action){const b=document.createElement('button');b.textContent=opt.label||'Undo';b.onclick=()=>{d.remove();opt.action()};d.appendChild(b)}
  document.body.appendChild(d);clearTimeout(toastT);toastT=setTimeout(()=>d.remove(),opt.ms||(opt.action?5000:2600))}

/* ---------- map ---------- */
let map,cpLayer,histLayer,flagLayer,lotLayer,trackLine,carMarker=null,accCircle=null;
const dark=matchMedia('(prefers-color-scheme: dark)');
const isDark=()=>{const t=document.documentElement.dataset.theme;return t?t==='dark':dark.matches};
function initMap(){
  map=L.map('map',{zoomControl:false,attributionControl:true}).setView(curArea().c,curArea().z);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  const theme=()=>document.getElementById('map').classList.toggle('darkmap',isDark());theme();dark.addEventListener?.('change',()=>{theme();drawRoute()});
  cpLayer=L.layerGroup().addTo(map);histLayer=L.layerGroup().addTo(map);flagLayer=L.layerGroup().addTo(map);lotLayer=L.layerGroup().addTo(map);
  trackLine=L.polyline([],{color:'#2F7DE1',weight:5,opacity:.85}).addTo(map);
  map.on('click',onMapClick);
  map.on('zoomend',()=>arrowPath&&drawArrows(arrowPath));
  map.on('dragstart',()=>{userPanAt=Date.now();if(follow){follow=false;document.getElementById('locBtn').setAttribute('aria-pressed','false')}});
}
const carIcon=h=>L.divIcon({className:'',iconSize:[40,40],iconAnchor:[20,20],html:`<div class="car" style="transform:rotate(${h||0}deg)"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="13" fill="#2F7DE1" stroke="#fff" stroke-width="3"/><path d="M20 10l6 14-6-3.5-6 3.5z" fill="#fff"/></svg></div>`});
const flagIcon=good=>L.divIcon({className:'',iconSize:[22,22],iconAnchor:[11,11],html:`<div class="flag" style="${good?'background:var(--ok)':''}">${good?'★':'!'}</div>`});
function drawRoute(){
  cpLayer.clearLayers();signLayer&&signLayer.clearLayers();arrowLayer&&arrowLayer.clearLayers();arrowPath=null;const r=route(),pts=[],nx=sess?nextTarget(r.cps,sess.done):null,skipped=sess?skippedCps(r.cps,sess.done).map(c=>c.id):[];
  r.cps.forEach((c,i)=>{if(c.lat==null)return;pts.push([c.lat,c.lng]);
    const done=sess&&sess.done.includes(c.id);
    const m=L.marker([c.lat,c.lng],{draggable:!sess,icon:L.divIcon({className:'',iconSize:[30,30],iconAnchor:[15,15],
      html:`<div class="pin ${done?'done':''} ${nx&&nx.id===c.id?'next':''}" style="${skipped.includes(c.id)?'opacity:.55':''}">${i+1}${SIGN_KIND[c.kind]?signIcon(SIGN_KIND[c.kind],'badge'):''}</div>`})})
     .bindTooltip(esc(c.name),{direction:'top',offset:[0,-14]}).addTo(cpLayer);
    m.on('dragend',e=>{const p=e.target.getLatLng();c.lat=+p.lat.toFixed(6);c.lng=+p.lng.toFixed(6);save();drawRoute()});
  });
  if(pts.length>1){const col=isDark()?'#F2C53D':'#B88600',k=pathKey(pts);
    if(r.path&&r.path.key===k){L.polyline(r.path.g,{color:'#fff',weight:7,opacity:.7}).addTo(cpLayer);L.polyline(r.path.g,{color:col,weight:4,dashArray:'8 7'}).addTo(cpLayer);drawArrows(r.path.g);
      drawRouteSigns(r);
      if(!r.nav)uTurns(r.path.g).forEach(u=>L.marker(u.ll,{icon:L.divIcon({className:'',iconSize:[28,28],iconAnchor:[14,14],html:'<div class="uturn" title="Turnaround">↶</div>'}),interactive:false}).addTo(cpLayer))}
    else{L.polyline(pts,{color:col,weight:3,dashArray:'2 8',opacity:.8}).addTo(cpLayer);queuePath(r,pts,k)}}
}
/* Road-sign icons for stop signs, traffic lights and playground zones along the route's road line. */
const SIGN_KIND={stop:'stop',allway:'stop',signals:'lights',play:'play'};
function signIcon(k,cls=''){return k==='stop'?`<span class="sg sg-stop ${cls}" title="Stop sign"><b>STOP</b></span>`:k==='lights'?`<span class="sg sg-lights ${cls}" title="Traffic lights"><i></i><i></i><i></i></span>`:`<span class="sg sg-play ${cls}" title="Playground zone"><b>30</b></span>`}
let signLayer=null;const signCache=new Map();
async function drawRouteSigns(r){if(!signLayer)signLayer=L.layerGroup().addTo(map);const key=r.path.key;
  let list=signCache.get(key);
  if(!list){const g=r.path.g,cum=cumDist(g);list=[];
    try{const els=[...await OSM.alongPath(g),...userStopEls()];
      for(const e of els){if(e.type!=='node')continue;const t=e.tags||{},ll=[e.lat,e.lon];
        const k=t.highway==='stop'?'stop':t.highway==='traffic_signals'?'lights':t.leisure==='playground'?'play':null;if(!k)continue;
        const p=projectOnPath(g,cum,ll);if(!p)continue;
        if(k==='play'){if(p.off>100)continue;const at=g[p.i];try{const {ways}=await OSM.roads(at);if(!playZoneRoad((roadAt(ways,at,null)||{}).tags))continue}catch(err){continue}list.push({k,ll:at})}
        else if(p.off<=12)list.push({k,ll})}
      list=list.filter((a,i)=>!list.slice(0,i).some(b=>b.k===a.k&&hav(a.ll,b.ll)<(a.k==='play'?150:40)))}catch(e){return}
    signCache.set(key,list)}
  if(route()!==r||!r.path||r.path.key!==key)return;
  const pins=placedCps(r.cps);signLayer.clearLayers();
  list.filter(sg=>!pins.some(c=>SIGN_KIND[c.kind]===sg.k&&hav([c.lat,c.lng],sg.ll)<40)).forEach(sg=>
    L.marker(sg.ll,{icon:L.divIcon({className:'',iconSize:[22,22],iconAnchor:[11,11],html:signIcon(sg.k)}),interactive:false,keyboard:false}).addTo(signLayer))}

/* Direction arrows along the road path; spacing follows the zoom so they stay readable. */
let arrowLayer=null,arrowPath=null;
const arrowIcon=deg=>L.divIcon({className:'',iconSize:[22,22],iconAnchor:[11,11],html:`<div class="arrow" style="transform:rotate(${Math.round(deg)}deg)"><svg viewBox="0 0 22 22"><path d="M11 3l7 11h-4.5v5h-5v-5H4z"/></svg></div>`});
function drawArrows(g){arrowPath=g;if(!arrowLayer)arrowLayer=L.layerGroup().addTo(map);arrowLayer.clearLayers();if(!g)return;
  const step=Math.max(60,Math.min(3000,140*2**(16-map.getZoom())));
  const pins=placedCps(route().cps).map(c=>[c.lat,c.lng]),clear=Math.max(25,step*0.25);
  pathArrows(g,step).filter(a=>pins.every(p=>hav(p,a.ll)>clear)).slice(0,300).forEach(a=>L.marker(a.ll,{icon:arrowIcon(a.deg),interactive:false,keyboard:false}).addTo(arrowLayer))}
/* Road-following path between pins. Fetched once per pin layout and saved with the route, so it also works offline. */
const pathKey=pts=>'v2|'+pts.map(p=>p[0].toFixed(5)+','+p[1].toFixed(5)).join('|');
const pathFail=new Map();let pathTimer=null;
function queuePath(r,pts,k){if(sess)return;if(pathFail.get(k)>Date.now()-120000)return;clearTimeout(pathTimer);
  pathTimer=setTimeout(async()=>{try{const p=await OSM.drivePath(pts);if(!p)return;r.path={key:k,...p};save();if(route()===r){drawRoute();if(tab==='drive'||tab==='routes')render()}}
    catch(e){pathFail.set(k,Date.now());if(route()===r&&tab==='routes')toast('Couldn\'t get the road route right now, showing straight lines.')}},700)}
function turnaroundNote(r){const pts=placedCps(r.cps).map(c=>[c.lat,c.lng]);if(r.nav||!r.path||r.path.key!==pathKey(pts))return '';const us=uTurns(r.path.g);if(!us.length)return '';
  const near=us.map(u=>{let bi=0,bd=1e9;placedCps(r.cps).forEach((c,i)=>{const d=hav(u.ll,[c.lat,c.lng]);if(d<bd){bd=d;bi=i}});return bi+1});
  return `<div class="card warn small"><b>${us.length===1?'This route has a turnaround':'This route has '+us.length+' turnarounds'} (↶ on the map)</b> near pin ${[...new Set(near)].join(', ')}. That usually means a pin sits on a side street or dead end. Drag it onto the street you'll drive through, or change the order with ↑ ↓.</div>`}
const pathLine=r=>{const pts=placedCps(r.cps).map(c=>[c.lat,c.lng]);return r.path&&pts.length>1&&r.path.key===pathKey(pts)?`${r.path.km} km by road · about ${r.path.min} min`:''};
function fitRoute(){const pts=route().cps.filter(c=>c.lat!=null).map(c=>[c.lat,c.lng]);
  if(sess&&sess.track.length)pts.push(...sess.track);
  if(pts.length===1)map.setView(pts[0],16);else if(pts.length)map.fitBounds(pts,{padding:[40,40]});else{map.setView(curArea().c,curArea().z);toast('No pins yet. Place them in Routes.')}}

let placing=false;
function onMapClick(e){if(pickingDest){pickingDest=false;setPlacing(false);return planDriveTo({name:'Dropped pin',ll:[e.latlng.lat,e.latlng.lng]})}if(!placing)return;const r=route();let c=r.cps.find(c=>c.lat==null);
  if(!c){const tp=(TEMPLATES[stageNum(r)-1]||{cps:[]}).cps[r.cps.length];c={id:uid(),name:tp?tp[0]:'Pin '+(r.cps.length+1),task:tp?tp[1]:'',lat:null,lng:null};r.cps.push(c)}
  c.lat=+e.latlng.lat.toFixed(6);c.lng=+e.latlng.lng.toFixed(6);if(!r.area)r.area=S.areaId||'calgary';save();drawRoute();render();
  toast(`Added pin ${r.cps.indexOf(c)+1}: ${c.name}. Tap again to add another.`)}
function setPlacing(v,text){placing=v&&!text;const b=document.getElementById('placeBanner');b.hidden=!v;b.textContent=text||'Tap the map to drop checkpoint pins'}

/* ---------- voice & sound ---------- */
let actx=null,lastSaid='';
function unlockAudio(){try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();actx.resume?.()}catch(e){}
  try{if(S.settings.voice&&'speechSynthesis' in window){const u=new SpeechSynthesisUtterance(' ');u.volume=0;speechSynthesis.speak(u)}}catch(e){}}
/* Speech queue: nothing is ever cut off mid-sentence. Higher priority jumps the line; stale lines are dropped.
   prio 3 = turn now / arrival, 2 = upcoming turn / speed limit, 1 = spot ahead / info. */
const speech={q:[],busy:false,guard:null};
function say(text,{prio=1,ttl=8000,man=null}={}){if(!S.settings.voice||!('speechSynthesis' in window)||!text)return;
  if(speech.q.some(x=>x.text===text))return;const it={text,prio,t:Date.now(),ttl,man};let i=speech.q.findIndex(x=>x.prio<prio);if(i<0)i=speech.q.length;speech.q.splice(i,0,it);pumpSpeech()}
function pumpSpeech(){if(speech.busy)return;while(speech.q.length&&Date.now()-speech.q[0].t>speech.q[0].ttl)speech.q.shift();const it=speech.q.shift();if(!it)return;
  speech.busy=true;const done=()=>{if(!speech.busy)return;speech.busy=false;clearTimeout(speech.guard);setTimeout(pumpSpeech,120)};
  try{const u=new SpeechSynthesisUtterance(speakable(it.text));u.lang='en-CA';u.rate=1;u.onend=done;u.onerror=done;speechSynthesis.speak(u);lastSaid=it.text}catch(e){done()}
  speech.guard=setTimeout(done,2500+it.text.length*85)}
function hush(){speech.q.length=0;speech.busy=false;clearTimeout(speech.guard);try{speechSynthesis.cancel()}catch(e){}}
function beep(freq=880,dur=.45,times=1){try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();
  for(let i=0;i<times;i++){const t0=actx.currentTime+i*(dur+.08),o=actx.createOscillator(),g=actx.createGain();o.frequency.value=freq;
    g.gain.setValueAtTime(.0001,t0);g.gain.exponentialRampToValueAtTime(.3,t0+.02);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);o.connect(g).connect(actx.destination);o.start(t0);o.stop(t0+dur)}}catch(e){}
  navigator.vibrate?.(times>1?[120,60,120]:[150])}
const cpLine=(c,withTask=true)=>c?`${c.name}.${withTask&&c.task?' '+c.task:''}`:'';

/* ---------- location ---------- */
let userPanAt=0,zoomAt=0;const followZoom=kmh=>kmh<45?17:kmh<80?16:15;
let watchId=null,follow=false,lastFix=null,lastAccepted=null,jumpRun=0;const speedBuf=[];
function ensureWatch(){if(watchId!=null)return true;
  if(!('geolocation' in navigator)){toast('This browser has no GPS access');return false}
  if(!isSecureContext)toast('Location needs an https:// link');
  watchId=navigator.geolocation.watchPosition(onPos,e=>toast(e.code===1?'Location blocked. Allow it in Settings › Safari › Location.':'GPS signal lost, retrying…'),{enableHighAccuracy:true,maximumAge:1000,timeout:20000});
  return true}
function onPos(p){
  const {latitude:lat,longitude:lng,accuracy:acc,speed,heading}=p.coords,ll=[lat,lng],now=p.timestamp||Date.now();
  let kmh=speed!=null&&speed>=0?speed*3.6:null,hd=heading;
  if(lastFix){const d=hav(lastFix.ll,ll),dt=(now-lastFix.t)/1000;if(kmh==null&&dt>0&&acc<=GPS.maxAcc)kmh=d/dt*3.6;if((hd==null||isNaN(hd))&&d>3)hd=bearing(lastFix.ll,ll)}
  if(hd==null||isNaN(hd))hd=lastFix?.hd??0;
  if(!carMarker){carMarker=L.marker(ll,{icon:carIcon(hd),zIndexOffset:1000,interactive:false}).addTo(map);
    accCircle=L.circle(ll,{radius:acc,color:'#2F7DE1',weight:1,fillOpacity:.08,interactive:false}).addTo(map);if(!sess)map.setView(ll,16)}
  else{carMarker.setLatLng(ll);carMarker.setIcon(carIcon(hd));accCircle.setLatLng(ll).setRadius(acc)}
  const sm=smoothSpeed(speedBuf,kmh);lastFix={ll,t:now,hd,acc,kmh:sm};
  if(!follow&&sess&&!ending&&Date.now()-userPanAt>10000){follow=true;document.getElementById('locBtn').setAttribute('aria-pressed','true')}
  if(follow){const z=sess?followZoom(sm):map.getZoom();if(sess&&z!==map.getZoom()&&Date.now()-zoomAt>8000){zoomAt=Date.now();map.setView(ll,z,{animate:true})}else map.panTo(ll,{animate:true,duration:.5})}
  if(sess&&!ending){
    sess.kmh=sm;if(sm>sess.maxKmh&&speedBuf.length>=3)sess.maxKmh=sm;
    // tracking paused (screen locked / another app): start a new track piece and say so
    if(lastAccepted&&now-lastAccepted.t>20000){const gapMs=now-lastAccepted.t;sess.gaps=sess.gaps||[];sess.breaks=sess.breaks||[];
      sess.gaps.push({from:lastAccepted.t,to:now,a:lastAccepted.ll,b:ll});sess.breaks.push(sess.track.length);sess.km+=hav(lastAccepted.ll,ll)/1000;
      L.polyline([lastAccepted.ll,ll],{color:'#8A958E',weight:3,dashArray:'4 8',interactive:false}).addTo(flagLayer);
      sess.track.push([+lat.toFixed(6),+lng.toFixed(6)]);trackLine.setLatLngs(trackSegments(sess.track,sess.breaks));lastAccepted={ll,t:now};
      toast(`Tracking was paused for ${fmtDur(gapMs)} (screen locked or another app open). Keep Drive Coach on screen while driving.`,{ms:7000});persistActive()}
    const a=acceptFix(lastAccepted,{ll,t:now,acc});
    if(a.ok){jumpRun=0;if(lastAccepted)sess.km+=a.dist/1000;sess.track.push([+lat.toFixed(6),+lng.toFixed(6)]);const ls=trackLine.getLatLngs();trackLine.addLatLng(ll,Array.isArray(ls[0])?ls[ls.length-1]:ls);lastAccepted={ll,t:now}}
    else if(a.why==='jump'&&++jumpRun>=4){jumpRun=0;lastAccepted={ll,t:now}}   // 4 jumps in a row agree with each other: the old point was the glitch
    if(acc<=50&&a.why!=='jump'){const r=route();arrivals(r.cps,sess.done,ll,ARRIVE_M).forEach(c=>markDone(c,true));
      const nx=nextTarget(r.cps,sess.done);sess.nextDist=nx?hav(ll,[nx.lat,nx.lng]):null;
      if(nx&&sess.nextDist<=ANNOUNCE_M&&!sess.announced.includes(nx.id)&&nx.kind!=='dest'){sess.announced.push(nx.id);sess.told=sess.told||[];const first=!nx.kind||!sess.told.includes(nx.kind);
        if(!r.nav){say(`In ${Math.round(sess.nextDist/50)*50} metres: ${nx.name.split(' · ')[0]}.`)}
        else if(['stop','allway','signals','play'].includes(nx.kind)&&!nearManeuver(r,nx)){say(SAY[nx.kind]||`${nx.name.split(' · ')[0]} ahead.`)}}}
    if(route().nav)navUpdate(ll,acc,now);
    if(acc<=25&&a.why!=='jump')autoChecks(ll,speed!=null&&speed>=0?speed*3.6:kmh,now);
    checkSpeed(ll,hd,now)}
  if(tab==='drive')updateHud();
}

/* ---------- automatic checks: rolling stops, hard braking, problem spots ---------- */
let brakePrev=null,spotList=[];const spotWarned=new Map(),stopState=new Map();
function autoChecks(ll,raw,now){const r=route(),on=S.settings.autoChecks;
  if(on&&raw!=null){if(hardBrake(brakePrev,{t:now,kmh:raw})&&now-(sess.brakeAt||0)>20000){sess.brakeAt=now;addFlag('Hard brake',{auto:true})}brakePrev={t:now,kmh:raw}}
  if(on)for(const c of r.cps){if(!c.stopAt)continue;const d=hav(ll,c.stopAt);if(d>120)continue;
    const key=c.id;if(!stopState.has(key))stopState.set(key,{});const v=stopCheck(stopState.get(key),d,raw);
    if(v==='rolled'){addFlag('Rolled the stop',{auto:true});say('That was a rolling stop.',{prio:1,ttl:5000})}}
  if(S.settings.spotWarnings)for(const sp of spotList){const d=hav(ll,sp.ll),st=spotWarned.get(sp)||{};
    if(!st.done&&d<=180&&d>40&&st.last!=null&&d<st.last){st.done=true;say(`Heads up, ${HEADS_UP[sp.label]||'take care here'}.`,{prio:1,ttl:6000})}
    st.last=d;spotWarned.set(sp,st)}}

/* ---------- speed limits ---------- */
const lim={st:{},cell:null,ways:[],loading:false,failAt:0,cur:null,over:0,warnAt:0,markAt:0};
async function refreshRoads(ll){if(lim.loading||Date.now()-lim.failAt<60000)return;if(lim.cell&&hav(lim.cell,ll)<700)return;
  lim.loading=true;try{const r=await OSM.roads(ll);lim.cell=r.cell;lim.ways=r.ways}catch(e){lim.failAt=Date.now()}finally{lim.loading=false}}
function checkSpeed(ll,hd,now){if(!S.settings.speedAlerts){lim.cur=null;return}
  refreshRoads(ll);lim.cur=stickyLimit(lim.st,lim.ways.length?limitAt(lim.ways,ll,sess.kmh>8?hd:null,sess.kmh):null);
  if(!lim.cur||sess.kmh<15){lim.over=0;return}
  lim.over=sess.kmh>lim.cur.kmh+5?lim.over+1:0;
  if(lim.over>=3&&(lim.warnedFor!==lim.cur.kmh||now-lim.warnAt>60000)){lim.warnAt=now;lim.warnedFor=lim.cur.kmh;beep(660,.25,2);say(`Speed limit ${lim.cur.kmh}.`,{prio:2,ttl:4000});
    if(S.settings.autoSpeedMarks&&now-lim.markAt>60000){lim.markAt=now;addFlag('Too fast',{auto:true,limit:lim.cur.kmh})}}}

/* ---------- drive A → B ---------- */
let pickingDest=false,destResults=[],planning=false;const navState={hint:null,off:0,rerouteAt:0,said:{}};
const DRIVE_ID='driveto';
async function myPosition(){if(lastFix&&Date.now()-lastFix.t<60000)return lastFix.ll;
  return new Promise(res=>{if(!navigator.geolocation)return res(null);navigator.geolocation.getCurrentPosition(p=>res([p.coords.latitude,p.coords.longitude]),()=>res(null),{enableHighAccuracy:true,timeout:10000})})}
/* Plan a drive through points [A, ...stops, B]; returns nav (path + maneuvers) and checkpoints. */
const userStopEls=()=>S.userStops.map(u=>({type:'node',id:'u'+u.id,lat:u.ll[0],lon:u.ll[1],tags:{highway:'stop',user:true}}));
async function buildNav(points){const nav=await OSM.navRoute(points),raw=[...await OSM.alongPath(nav.g),...userStopEls()],cum=cumDist(nav.g),els=[];
  for(const e of raw){if((e.tags||{}).leisure!=='playground'){els.push(e);continue}
    const p=projectOnPath(nav.g,cum,[e.lat,e.lon]);if(!p||p.off>100)continue;const at=nav.g[p.i];
    try{const {ways}=await OSM.roads(at);if(playZoneRoad((roadAt(ways,at,null)||{}).tags))els.push(e)}catch(err){}}
  const cps=planDrive(nav,els);
  return {nav:{g:nav.g,man:maneuvers(nav.steps,nav.g,cum),km:nav.km,min:nav.min},cps,cum}}
function installRoute(id,props,nav,cps){let r=S.routes.find(x=>x.id===id);if(!r){r={id};S.routes.push(r)}
  Object.assign(r,props,{cps,nav,area:S.areaId});r.path={key:pathKey(placedCps(cps).map(c=>[c.lat,c.lng])),g:nav.g,km:nav.km,min:nav.min};
  S.activeRouteId=r.id;save();drawRoute();fitRoute();tab='drive';syncTabs();return r}
async function planDriveTo(dest){if(sess)return toast('End the lesson first');if(planning)return;planning=true;destResults=[];render();toast('Planning the route…',{ms:15000});
  try{let from=await myPosition();if(!from){const c=map.getCenter();from=[c.lat,c.lng];toast('No GPS fix, so the route starts from the map centre')}
    const {nav,cps}=await buildNav([from,dest.ll]);
    installRoute(DRIVE_ID,{name:`To ${dest.name}`,stage:'A → B',goal:`${nav.km} km · about ${nav.min} min · ${spotSummary(cps)||'no marked spots'}`,dest,via:[]},nav,cps);
    toast(`${nav.km} km, about ${nav.min} min. ${cps.length-1} practice spots on the way.`,{ms:5000})}
  catch(e){toast(String(e.message||e).includes('No driving route')?'No driving route to that spot. Pick a point on a road.':'Couldn\'t plan the route right now. Check the connection and try again.',{ms:6000})}
  finally{planning=false;render()}}
async function destSearch(q){q=q.trim();if(!q)return;const box=document.getElementById('destRes');if(box)box.innerHTML='<div class="small muted">Searching…</div>';
  try{destResults=await OSM.search(q,map.getBounds().pad(3));render()}catch(e){const b=document.getElementById('destRes');if(b)b.innerHTML='<div class="small muted">Search failed. Check the connection.</div>'}}
/* Called on every good GPS fix during an A→B lesson: next maneuver, voice, off-route detection. */
const cumCache=new WeakMap();
function navUpdate(ll,acc,now){const r=route(),nv=r.nav;if(!nv||!nv.man)return;if(!cumCache.has(nv))cumCache.set(nv,cumDist(nv.g));
  const p=projectOnPath(nv.g,cumCache.get(nv),ll,navState.hint);if(!p)return;navState.hint=p.i;navState.along=p.along;
  if(acc<=30){navState.off=p.off>50?navState.off+1:0;if(navState.off>=3&&now-navState.rerouteAt>20000){navState.rerouteAt=now;navState.off=0;reroute(ll)}}
  const m=nv.man.find(x=>x.along>p.along+8);navState.next=m?{m,dist:m.along-p.along}:null;if(!m)return;
  const d=m.along-p.along,key=m.along.toFixed(0),said=navState.said[key]||0,fast=(sess.kmh||0)>65,far=fast?700:300;
  if(said<1&&d<=far&&d>(fast?250:60)){navState.said[key]=1;const cp=r.cps.find(c=>c.kind&&c.kind!=='dest'&&!sess.done.includes(c.id)&&hav([c.lat,c.lng],m.ll)<45);
    if(cp)sess.announced.push(cp.id);
    say(`In ${d>=1000?(d/1000).toFixed(1)+' kilometres':Math.round(d/50)*50+' metres'}, ${m.text.charAt(0).toLowerCase()+m.text.slice(1)}.`,{prio:2,ttl:12000,man:key})}
  else if(said<2&&d<=(fast?250:60)){navState.said[key]=2;const far=speech.q.findIndex(x=>x.man===key);if(far>=0)speech.q.splice(far,1);say(m.text,{prio:3})}}
async function reroute(ll){const r=route();if(!r.dest)return;say('Rerouting.',{prio:2,ttl:5000});toast('Off the route. Re-planning…');
  const left=(r.via||[]).filter(v=>v.along==null||v.along>(navState.along||0)+50).map(v=>v.ll);
  try{const {nav,cps,cum}=await buildNav([ll,...left,r.dest.ll]);if(route()!==r||!sess)return;
    r.via=(r.via||[]).filter(v=>left.includes(v.ll)).map(v=>({...v,along:projectOnPath(nav.g,cum,v.ll).along}));
    const done=r.cps.filter(c=>sess.done.includes(c.id)),fresh=cps.filter(c=>!done.some(d=>hav([d.lat,d.lng],[c.lat,c.lng])<40));
    r.cps=[...done,...fresh];r.nav=nav;r.goal=`${nav.km} km · about ${nav.min} min · ${spotSummary(fresh)||'no marked spots'}`;r.path={key:pathKey(placedCps(r.cps).map(c=>[c.lat,c.lng])),g:nav.g,km:nav.km,min:nav.min};
    navState.hint=null;navState.said={};navState.next=nav.man[0]?{m:nav.man[0],dist:nav.man[0].along}:null;save();drawRoute();render();persistActive();
    const m=nav.man[0];toast(`New route: ${nav.km} km, about ${nav.min} min`);if(m)say(m.text+'.',{prio:2})}
  catch(e){toast('Off the route and couldn\'t re-plan. Follow the map back to the yellow line.',{ms:6000})}}
/* Practice loop from start: visits spots matching the weakest skills (or road-test items) and comes back. */
const LOOP_ID='loop',TEST_ID='roadtest';
const KIND_LABEL={round:'roundabouts',signals:'lights and left turns',stop:'stop signs',play:'playground zones',ramp:'highway merges'};
function focusLine(mode,minutes){const w=focusWeights(S.skills,mode);if(minutes<30||w.ramp<2.5)w.ramp=0;return Object.entries(w).filter(([k,v])=>v>0&&KIND_LABEL[k]).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>KIND_LABEL[k]).join(', ')}
async function planLoop({start,startName,minutes,mode}){if(sess)return toast('End the lesson first');if(planning)return;planning=true;render();toast(mode==='test'?'Building a road test loop…':'Building a practice loop…',{ms:20000});
  try{if(!start){start=await myPosition();startName='where you are';if(!start){const c=map.getCenter();start=[c.lat,c.lng];startName='the map centre';toast('No GPS fix, so the loop starts from the map centre')}}
    const R=Math.max(600,minutes*60),w=focusWeights(S.skills,mode),F=await OSM.features(['stop','signals','round','play'],start);S.userStops.forEach(u=>F.stop.push({ll:u.ll,g:[u.ll]}));
    const cands=[...F.round.map(f=>({kind:'round',ll:f.ll})),...F.signals.map(f=>({kind:'signals',ll:f.ll})),...F.stop.map(f=>({kind:'stop',ll:f.ll})),...F.play.map(f=>({kind:'play',ll:f.ll}))];
    let targets=pickLoopTargets(cands,start,R,w,Math.max(2,Math.min(6,Math.round(minutes/7))));
    if(mode!=='test'&&minutes>=30&&w.ramp>=2.5){try{const wr=walkRamp(await OSM.features(['ramp'],start),start);
      if(wr){const b=bearing(start,wr.onRamp),i=targets.findIndex(t=>t.b>b);targets.splice(i<0?targets.length:i,0,{kind:'ramp',ll:wr.onRamp,b},{kind:'ramp',ll:wr.exit,b})}}catch(e){}}
    let park=null;if(mode==='test'){try{const {ways}=await OSM.roads(start);let best=null,bd=1e9;
      for(const x of ways){if(x.tags.highway!=='residential'||x.g.length<2)continue;const m=x.g[Math.floor(x.g.length/2)],d=hav(start,m);if(d>150&&d<700&&d<bd){bd=d;best=m}}
      if(best)park=best}catch(e){}}
    if(!targets.length&&!park)throw new Error('nothing near');
    let res;for(let k=0;k<3;k++){res=await buildNav([start,...targets.map(t=>t.ll),...(park?[park]:[]),start]);
      if(res.nav.min<=minutes*1.4||targets.length<=2)break;targets=targets.filter(t=>t!==targets.reduce((a,b)=>hav(start,b.ll)>hav(start,a.ll)?b:a))}
    const {nav,cps,cum}=res,end=cps[cps.length-1];end.name='Back to start';end.task='Park safely. Debrief: one thing that went well, one to work on.';
    if(park){const pa=projectOnPath(nav.g,cum,park).along;const c={id:uid(),name:SPOTS.park[0],task:SPOTS.park[1],lat:+park[0].toFixed(6),lng:+park[1].toFixed(6),kind:'park'};
      const at=cps.findIndex(x=>projectOnPath(nav.g,cum,[x.lat,x.lng]).along>pa);cps.splice(at<0?cps.length-1:at,0,c)}
    const via=[...targets.map(t=>({ll:t.ll})),...(park?[{ll:park}]:[])].map(v=>({...v,along:projectOnPath(nav.g,cum,v.ll).along}));
    const id=mode==='test'?TEST_ID:LOOP_ID;
    installRoute(id,{name:mode==='test'?`Road test practice · ${startName}`:`${minutes}-min loop from ${startName}`,stage:mode==='test'?'Road test':'Loop',
      goal:`${nav.km} km · about ${nav.min} min · ${spotSummary(cps)||'no marked spots'}`,dest:{name:'the start',ll:start},via},nav,cps);
    toast(`${nav.km} km, about ${nav.min} min, ${cps.length-1} practice spots.${nav.min>minutes*1.4?' Longer than asked: not many spots nearby.':''}`,{ms:6000})}
  catch(e){toast(String(e.message).includes('nothing near')?'Not enough practice spots near there. Try a longer loop or another start.':'Couldn\'t build the loop right now. Check the connection and try again.',{ms:6000})}
  finally{planning=false;render()}}
const nearManeuver=(r,c)=>r.nav&&r.nav.man.some(m=>hav(m.ll,[c.lat,c.lng])<45);
function navBanner(){const r=route();if(!r.nav)return '';
  return `<div class="navbar" id="hNav"><span class="nicon" id="hNavI">↑</span><div class="grow"><div class="nd" id="hNavD">—</div><div class="nt" id="hNavT">Head to the yellow line</div></div></div>`}

/* ---------- lesson ---------- */
let sess=null,ending=false,tick=null,hudTimer=null,wake=null,expanded=false,prestart=false,pendingResume=null;
let endForm={feel:0,notes:''};const flagMarkers=new Map();
function newSession(){brakePrev=null;stopState.clear();spotWarned.clear();spotList=problemSpots(S.sessions);navState.hint=null;navState.off=0;navState.said={};navState.next=null;return {id:uid(),start:Date.now(),routeId:route().id,track:[],breaks:[],gaps:[],km:0,maxKmh:0,kmh:0,done:[],flags:[],announced:[],nextDist:null}}
async function grabWake(){try{if(!wake)wake=await navigator.wakeLock?.request('screen');wake?.addEventListener?.('release',()=>{wake=null})}catch(e){}}
function beginRunning(){ensureWatch();follow=true;userPanAt=0;zoomAt=0;document.getElementById('locBtn').setAttribute('aria-pressed','true');if(lastFix)map.setView(lastFix.ll,17);
  grabWake();clearInterval(tick);tick=setInterval(()=>{if(tab==='drive')updateHud();persistActive()},5000);
  if(!hudTimer)hudTimer=setInterval(()=>sess&&tab==='drive'&&updateHud(),1000);
  document.getElementById('voiceBtn').hidden=false;syncVoiceBtn();drawRoute();render()}
function startSession(){unlockAudio();prestart=false;expanded=false;lim.over=0;
  sess=newSession();lastAccepted=null;speedBuf.length=0;
  trackLine.setLatLngs([]);flagLayer.clearLayers();flagMarkers.clear();histLayer.clearLayers();setPlacing(false);
  const nx=nextTarget(route().cps,[]),rr=route();say(rr.nav?(rr.dest&&rr.dest.name==='the start'?`Let's go. A ${rr.nav.km} kilometre loop, about ${rr.nav.min} minutes.`:`Let's go. ${rr.nav.km} kilometres to ${rr.dest.name}.`):nx?`Let's go. First: ${nx.name.split(' · ')[0]}.`:"Let's go.",{prio:2,ttl:15000});
  persistActive();beginRunning()}
function persistActive(){if(!sess)return;Store.set('active',{sess,endForm,ending,profileId:S.profileId,routeId:sess.routeId,saved:Date.now()})}
function resumeActive(a,thenEnd){pendingResume=null;
  if(a.profileId!==S.profileId&&S.profiles.some(p=>p.id===a.profileId))switchProfile(a.profileId,true);
  if(S.routes.some(r=>r.id===a.routeId))S.activeRouteId=a.routeId;
  sess=Object.assign(newSession(),a.sess);endForm=a.endForm||{feel:0,notes:''};
  const gap=Date.now()-(a.saved||Date.now());if(gap>60000&&!thenEnd)sess.start+=gap;   // don't count time the app was closed
  lastAccepted=sess.track.length?{ll:sess.track[sess.track.length-1],t:Date.now()}:null;
  trackLine.setLatLngs(trackSegments(sess.track,sess.breaks));flagLayer.clearLayers();flagMarkers.clear();
  sess.flags.forEach(f=>flagMarkers.set(f.t,L.marker(f.ll,{icon:flagIcon(FLAGS[f.label]?.good)}).bindTooltip(esc(f.label)).addTo(flagLayer)));
  ending=!!thenEnd||!!a.ending;tab='drive';syncTabs();beginRunning();if(!thenEnd)toast('Lesson resumed')}
function markDone(c,auto){if(!sess||!c||sess.done.includes(c.id))return;sess.done.push(c.id);sess.nextDist=null;beep(880,.45,2);
  const r=route(),nx=nextTarget(r.cps,sess.done);
  if(r.nav){if(c.kind==='dest')say('You have arrived.',{prio:3,ttl:20000})}
  else say(nx?`Done. Next: ${nx.name.split(' · ')[0]}.`:'All checkpoints done. Head back.',{prio:2});
  toast((auto?'Reached ':'Done: ')+c.name,{action:()=>{sess&&(sess.done=sess.done.filter(x=>x!==c.id),sess.announced=sess.announced.filter(x=>x!==c.id));drawRoute();render();persistActive()}});
  persistActive();drawRoute();render()}
function addFlag(label,extra={}){if(!sess)return;if(!lastFix)return toast('Waiting for GPS…');
  const f={ll:[+lastFix.ll[0].toFixed(5),+lastFix.ll[1].toFixed(5)],label,t:Date.now(),...extra};sess.flags.push(f);
  flagMarkers.set(f.t,L.marker(f.ll,{icon:flagIcon(FLAGS[label]?.good)}).bindTooltip(esc(label)).addTo(flagLayer));
  toast((extra.auto?'Auto-marked: ':'Marked: ')+label+(extra.limit?` (limit ${extra.limit})`:''),{action:()=>{if(!sess)return;sess.flags=sess.flags.filter(x=>x!==f);
    const m=flagMarkers.get(f.t);m&&flagLayer.removeLayer(m);flagMarkers.delete(f.t);persistActive();render()}});
  navigator.vibrate?.(40);persistActive();if(expanded||tab!=='drive')return;updateHud()}
function finishSession(keep){
  if(keep){const r=route();
    S.sessions.unshift({id:sess.id,start:sess.start,end:Date.now(),routeId:r.id,routeName:r.name,stage:r.stage,km:+sess.km.toFixed(2),maxKmh:Math.round(sess.maxKmh),
      done:sess.done.length,total:placedCps(r.cps).length,feel:endForm.feel,notes:endForm.notes.trim(),
      ...(()=>{const segs=trackSegments(sess.track,sess.breaks),k=Math.max(1,Math.ceil(sess.track.length/1500)),track=[],breaks=[];
        segs.forEach((sg,i)=>{if(i)breaks.push(track.length);sg.forEach((p,j)=>{if(j%k===0||j===sg.length-1)track.push([+p[0].toFixed(5),+p[1].toFixed(5)])})});
        return {track,breaks,gaps:(sess.gaps||[]).map(g=>({ms:g.to-g.from,a:g.a.map(v=>+v.toFixed(5)),b:g.b.map(v=>+v.toFixed(5))}))}})(),flags:sess.flags.map(f=>({ll:f.ll,label:f.label,t:f.t,...(f.auto?{auto:true,limit:f.limit}:{})})),
      plan:r.path&&r.path.key===pathKey(placedCps(r.cps).map(c=>[c.lat,c.lng]))?thinTrack(r.path.g,600):null,
      cps:r.cps.map((c,i)=>({n:i+1,name:c.name,task:c.task,done:sess.done.includes(c.id),ll:c.lat!=null?[+c.lat.toFixed(5),+c.lng.toFixed(5)]:null})).filter(c=>c.ll)});
    reportView=sess.id;save();Store.flush();toast('Lesson saved to the log')}
  clearInterval(tick);try{wake?.release()}catch(e){}wake=null;sess=null;ending=false;expanded=false;endForm={feel:0,notes:''};
  Store.del('active');hush();
  document.getElementById('voiceBtn').hidden=true;trackLine.setLatLngs([]);flagLayer.clearLayers();flagMarkers.clear();drawRoute();render()}

/* ---------- profiles ---------- */
function switchProfile(id,quiet){if(id===S.profileId)return;if(sess&&!quiet)return toast('End the lesson before switching learner');
  S.pdata[S.profileId]={sessions:S.sessions,skills:S.skills};
  const d=S.pdata[id]||{sessions:[],skills:{}};S.sessions=d.sessions;S.skills=d.skills;delete S.pdata[id];S.profileId=id;
  Object.keys(reportCache).forEach(k=>delete reportCache[k]);histLayer.clearLayers();logFilter='all';save();if(!quiet){render();toast('Now tracking '+prof().name)}}
function profStats(p){const hrs=S.sessions.reduce((a,s)=>a+hours(s),0);
  const days=p.testDate?Math.ceil((new Date(p.testDate+'T12:00')-Date.now())/864e5):null;return{hrs,pct:skillPct(S.skills),days,n:S.sessions.length}}
const fmtDate=d=>d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
function eligibilityLine(p){const el=testEligibleFrom(p.since);if(!el)return '';
  if(p.testDate&&new Date(p.testDate+'T12:00')<el)return `<div class="small"><b>Heads up:</b> the road test date is before ${fmtDate(el)}, after one year on Class 7.</div>`;
  return el<=new Date()?'<div class="g">Eligible for the Class 5 road test (1 year on Class 7 done)</div>':`<div class="g">Road test eligible from ${fmtDate(el)}</div>`}
let editingProfile=false;
function profileCard(){const p=prof(),st=profStats(p),goal=+p.goalHours||0;
  const since=p.since?Math.floor((Date.now()-new Date(p.since+'T12:00'))/864e5):null;
  if(editingProfile)return `<div class="card"><h3>Learner profile</h3>
    <label class="small">Name<input type="text" id="pfName" value="${esc(p.name)}" autocomplete="off"></label>
    <label class="small">Learner's licence (Class 7) since<input type="date" id="pfSince" value="${esc(p.since)}"></label>
    <label class="small">Road test date, if booked<input type="date" id="pfTest" value="${esc(p.testDate)}"></label>
    <label class="small">Practice hours goal<input type="text" inputmode="numeric" id="pfGoal" value="${esc(p.goalHours)}" placeholder="e.g. 40"></label>
    <div class="row"><button class="btn primary" id="pfDone">Done</button>${S.profiles.length>1?'<button class="btn danger" id="pfDel" style="margin-left:auto">Delete profile</button>':''}</div></div>`;
  return `<div class="plate" style="display:grid;gap:8px">
    <div class="row nowrap" style="justify-content:space-between"><div style="min-width:0"><div class="k">Learner</div><div class="n">${esc(p.name)}</div></div><button class="btn small" id="pfEdit">Edit</button></div>
    <div class="g">${st.n} lesson${st.n===1?'':'s'} · ${st.hrs.toFixed(1)}${goal?' / '+goal:''} h · skills ${st.pct}%${st.days!=null?` · road test ${st.days>0?'in '+st.days+' days':st.days===0?'today':'date passed'}`:''}${since!=null&&since>=0?` · learning ${since} days`:''}</div>
    ${goal?`<div class="progressbar" style="background:rgb(255 255 255/.25)"><i style="width:${Math.min(100,st.hrs/goal*100)}%;background:var(--sign-ink)"></i></div>`:''}
    ${eligibilityLine(p)}</div>
   <div class="row nowrap">${S.profiles.length>1?`<select id="pfSel" aria-label="Learner">${S.profiles.map(x=>`<option value="${x.id}" ${x.id===p.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`:''}<button class="btn" id="pfNew" style="white-space:nowrap">New profile</button></div>`}
function backupNudge(){const last=S.lastBackup||0,n=S.sessions.length+Object.values(S.pdata).reduce((a,d)=>a+(d.sessions||[]).length,0);
  if(!n)return '';const days=Math.floor((Date.now()-last)/864e5);
  return days>=14?`<div class="card warn" style="grid-template-columns:1fr auto;align-items:center"><div class="small">${last?`Last backup ${days} days ago.`:'No backup yet.'} Lessons live only on this phone.</div><button class="btn small" id="exportBtn">Back up</button></div>`:''}

/* ---------- areas ---------- */
let savingArea=false;
function areaBar(){const a=curArea(),custom=!AREAS.some(x=>x.id===a.id);
  return `<div class="stack"><h3>Area</h3><div class="row nowrap"><select id="areaSel" aria-label="Area">${allAreas().map(x=>`<option value="${x.id}" ${x.id===a.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>
   <button class="btn" id="nearMe" style="white-space:nowrap">Near me</button></div>
   ${savingArea?`<div class="row nowrap"><input type="text" id="areaName" placeholder="Name, e.g. Seton" aria-label="New area name"><button class="btn primary" id="areaSave">Save</button></div><div class="small muted">Saves the current map view as an area.</div>`
   :`<div class="row"><button class="btn small" id="areaAdd">Save this map view as an area</button>${custom?'<button class="btn small danger" id="areaDel">Remove area</button>':''}</div>`}</div>`}
function goArea(id){S.areaId=id;save();const a=curArea();map.setView(a.c,a.z);render()}
function nearMe(){if(!navigator.geolocation)return toast('This browser has no GPS access');toast('Finding you…');
  navigator.geolocation.getCurrentPosition(p=>{const ll=[p.coords.latitude,p.coords.longitude];
    let best=null,bd=1e12;allAreas().forEach(a=>{const d=hav(ll,a.c);if(d<bd){bd=d;best=a}});
    if(best&&bd<15000){S.areaId=best.id;save();toast('Area: '+best.name)}else toast('No saved area here. Save this view to add one.');
    map.setView(ll,15);ensureWatch();render()},e=>toast(e.code===1?'Location blocked. Allow it in Settings › Safari › Location.':'Could not get a GPS fix'),{enableHighAccuracy:true,timeout:15000})}

/* ---------- auto-build & lot picker ---------- */
let busy=false,placeResults=[],lotPick=null;
const NEED={1:['lot'],2:['stop','play'],3:['signals'],4:['round'],5:['ramp'],6:['lot','stop','signals','round']};
async function autoBuild(){const r=route(),n=stageNum(r);
  if(!n||n>6)return toast('Auto-build works on the 6 stage routes. Use search or tap the map for custom routes.');
  if(busy)return;const c=map.getCenter(),s=[c.lat,c.lng];busy=true;render();toast('Finding spots near the map centre…');
  try{const F=await OSM.features(NEED[n],s);if(NEED[n].includes('stop'))S.userStops.forEach(u=>{if(hav(s,u.ll)<2500)F.stop.push({ll:u.ll,g:[u.ll],name:''})});
    if(n===1||n===6){const lots=rankLots(F,s);if(lots.length){busy=false;return showLotPicker({n,F,s,lots,routeId:r.id})}}
    applyBuild(r,buildStage(n,F,s,null))}
  catch(e){toast(OSM.lastErr?`This spot is outside the saved Calgary-area map data, and the live OpenStreetMap servers didn't answer (${OSM.lastErr}). Try again later, or use search or tap the map.`:'Something went wrong reading the map data: '+e.message,{ms:8000})}
  finally{busy=false;render()}}
async function snapToRoads(cps){const todo=cps.filter(c=>c.lat!=null&&!c.onLot);if(!todo.length)return 0;
  const res=await OSM.snap(todo.map(c=>[c.lat,c.lng]));let n=0;res.forEach((p,i)=>{if(p){todo[i].lat=p[0];todo[i].lng=p[1];n++}});return n}
async function applyBuild(r,cps){const found=cps.filter(c=>c.lat!=null).length;
  if(found){toast('Moving pins onto the nearest roads…');await snapToRoads(cps)}
  if(!found)return toast('Nothing suitable found here. Move the map or tap Near me, then try again.');
  const before=JSON.parse(JSON.stringify(r.cps));r.cps=cps;r.area=r.area||S.areaId;save();drawRoute();fitRoute();
  toast(found===cps.length?`Placed ${found} pins. Check them and drag any that look off.`:`Placed ${found} of ${cps.length}. Tap the map or search for the rest.`,
    {action:()=>{r.cps=before;save();drawRoute();render()},ms:7000})}
function showLotPicker(p){lotPick=p;lotLayer.clearLayers();setPlacing(false);
  p.lots.forEach((l,i)=>{const poly=L.polygon(l.g,{color:'#B88600',weight:3,fillColor:'#F2C53D',fillOpacity:.35}).addTo(lotLayer);
    const lab=L.marker(l.ll,{icon:L.divIcon({className:'',iconSize:[34,34],iconAnchor:[17,17],html:`<div class="pin" style="width:34px;height:34px;font-size:16px">${i+1}</div>`})}).addTo(lotLayer);
    [poly,lab].forEach(x=>x.on('click',()=>chooseLot(i)))});
  map.fitBounds(L.latLngBounds([p.s,...p.lots.map(l=>l.ll)]),{padding:[40,40]});
  toast(`Found ${p.lots.length} car lots. Tap one on the map or in the list.`);render()}
function chooseLot(i){const p=lotPick;if(!p)return;lotLayer.clearLayers();lotPick=null;
  if(route().id!==p.routeId)S.activeRouteId=p.routeId;applyBuild(route(),buildStage(p.n,p.F,p.s,p.lots[i]));render()}
function cancelLotPick(){lotPick=null;lotLayer.clearLayers();render()}
function renderLotPick(){const p=lotPick;const lab=l=>`${l.area>=10000?(l.area/10000).toFixed(1)+' ha':Math.round(l.area/100)*100+' m²'} · ${fmtDist(hav(p.s,l.ll))} away`;
  return `<div class="row" style="justify-content:space-between"><h2>Pick a parking lot</h2><button class="btn" id="lotCancel">Cancel</button></div>
   <div class="small muted">Highlighted in yellow on the map, biggest and closest first. Pick one you know is open and empty at the time you'll go.</div>
   ${p.lots.map((l,i)=>`<button class="entry" data-lot="${i}"><div class="top"><span><span class="num placed" style="display:inline-grid;vertical-align:middle;margin-right:8px">${i+1}</span>${esc(l.name||'Unnamed lot')}</span></div><div class="meta">${lab(l)}</div></button>`).join('')}`}
async function placeSearch(q){q=q.trim();if(!q)return;const box=document.getElementById('placeRes');if(box)box.innerHTML='<div class="small muted">Searching…</div>';
  try{placeResults=await OSM.search(q,map.getBounds().pad(1.5));render()}
  catch(e){const b=document.getElementById('placeRes');if(b)b.innerHTML='<div class="small muted">Search failed. Check the connection.</div>'}}
function pinPlace(i){const p=placeResults[i],r=route();if(!p)return;let c=r.cps.find(c=>c.lat==null);
  if(!c){c={id:uid(),name:p.name,task:'',lat:null,lng:null};r.cps.push(c)}
  c.lat=+p.ll[0].toFixed(6);c.lng=+p.ll[1].toFixed(6);if(!r.area)r.area=S.areaId;save();drawRoute();map.setView(p.ll,16);
  toast(`Pinned “${c.name}” at ${p.name}`);placeResults=[];render()}

/* ---------- big map: hide the panel, keep a slim strip while driving ---------- */
let mapBig=false;
function toggleBig(v){mapBig=v==null?!mapBig:v;appEl.classList.toggle('mapbig',mapBig);const b=document.getElementById('bigBtn');b.setAttribute('aria-pressed',mapBig);
  b.title=b.ariaLabel=mapBig?'Show the panel':'Bigger map';b.innerHTML=mapBig?BIG_OFF:BIG_ON;render();setTimeout(()=>map.invalidateSize(),60)}
const BIG_ON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const BIG_OFF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
function renderMini(){if(!sess||ending)return `<button class="btn primary" id="miniBack">Show the panel</button>`;
  const r=route();return `${r.nav?navBanner():''}<div class="row nowrap" style="gap:10px"><div class="spd" id="hSpd" style="min-width:70px"><b id="hSpeed" style="font-size:34px">0</b><span>km/h</span></div>
   <div class="limit" id="hLimit" hidden style="width:46px;height:46px;font-size:18px;border-width:5px"></div><div class="dmeta grow" id="hMeta" style="text-align:left"></div><button class="btn" id="miniBack">Panel</button></div>
   <div class="markrow" role="group" aria-label="Mark a moment">${Object.keys(FLAGS).map(t=>`<button class="chip ${FLAGS[t].good?'good':''}" data-flag="${esc(t)}">${t}</button>`).join('')}<button class="chip addstop" id="addStop">+ Stop sign</button></div>`}

/* ---------- views ---------- */
let tab='drive',logFilter='all',chartSel=null;
const gauge=(v,u)=>`<div class="gauge"><div class="v" style="font-size:24px">${v}</div><div class="u">${u}</div></div>`;
function mapsLink(r){const p=placedCps(r.cps).map(c=>`${c.lat.toFixed(6)},${c.lng.toFixed(6)}`);if(!p.length)return null;
  const dest=p[p.length-1],way=p.slice(0,-1).slice(0,9);
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}${way.length?'&waypoints='+encodeURIComponent(way.join('|')):''}&travelmode=driving`}
function routeSelect(){return `<select id="routeSel" aria-label="Lesson route">${S.routes.map(r=>`<option value="${r.id}" ${r.id===route().id?'selected':''}>${esc(r.stage)} · ${esc(r.name)}${r.area?' · '+esc((allAreas().find(x=>x.id===r.area)||{}).name||''):''}</option>`).join('')}</select>`}
function cpList(r){const skipped=sess?skippedCps(r.cps,sess.done).map(c=>c.id):[];
  return `<ul class="cps">${r.cps.map((c,i)=>{const done=sess&&sess.done.includes(c.id),cls=done?'done':c.lat!=null?'placed':'';
  return `<li><span class="num ${cls}">${i+1}</span><div><div class="cp-name">${esc(c.name)}${skipped.includes(c.id)?' <span class="small muted">(skipped)</span>':''}</div><div class="cp-task">${esc(c.task)}</div></div>${sess&&c.lat!=null&&!done?`<button class="btn small" data-done="${c.id}">Done</button>`:'<span></span>'}</li>`}).join('')}</ul>`}

function settingsBlock(){const t=(id,label,on,sub='')=>`<label class="toggle"><span>${label}${sub?`<br><span class="small muted">${sub}</span>`:''}</span><input type="checkbox" id="${id}" ${on?'checked':''}></label>`;
  return `<details class="settings"><summary>Lesson settings</summary><div>
    ${t('setVoice','Voice prompts',S.settings.voice,'Reads out the next checkpoint and its task')}
    ${t('setSpeed','Speed limit warnings',S.settings.speedAlerts,'Beeps and says the limit when 6+ km/h over')}
    ${t('setAutoMark','Auto-mark speeding',S.settings.autoSpeedMarks,'Adds "Too fast" to the report, once a minute at most')}
    ${t('setAutoChecks','Auto-detect rolling stops and hard braking',S.settings.autoChecks,'Marks them on the report by itself')}
    ${t('setSpots','Problem spot heads-up',S.settings.spotWarnings,'Voice warning near places where the same mistake happened before')}
    ${t('setChecklist','Pre-drive checklist',S.settings.checklist,'Alberta Class 7 reminders before each lesson')}</div></details>`}

function renderOnboard(){const p=prof();
  return `<div class="hero"><h3>Welcome</h3><h2>Set up Drive Coach</h2><div class="muted">Takes 30 seconds. You can change all of this later in the Log tab.</div></div>
   <label class="small">Learner's name<input type="text" id="pfName" value="${p.name==='Learner'?'':esc(p.name)}" placeholder="e.g. Anna" autocomplete="off"></label>
   <label class="small">Learner's licence (Class 7) since<input type="date" id="pfSince" value="${esc(p.since)}"></label>
   <label class="small">Road test date, if booked<input type="date" id="pfTest" value="${esc(p.testDate)}"></label>
   ${areaBar()}
   <label class="toggle"><span>Voice prompts while driving</span><input type="checkbox" id="setVoice" ${S.settings.voice?'checked':''}></label>
   <button class="btn primary big" id="onbDone">Let's go</button>
   <div class="small muted">Everything stays on this phone. Add the app to your Home Screen so iOS keeps your data.</div>`}

function resumeCard(a){const s=a.sess,el=(a.saved||Date.now())-s.start,r=S.routes.find(x=>x.id===a.routeId);
  return `<div class="card alert"><h3>Unfinished lesson</h3>
   <div><b>${esc(r?r.name:'Lesson')}</b><div class="small muted">Started ${new Date(s.start).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})} · ${fmtDur(el)} · ${(s.km||0).toFixed(1)} km · ${s.flags.length} marks</div></div>
   <div class="row"><button class="btn primary" id="resResume">Resume</button><button class="btn" id="resSave">Finish and save</button><button class="btn danger" id="resDiscard" style="margin-left:auto">Discard</button></div></div>`}

function coachCard(){const sug=suggestNext(S.routes,S.sessions,S.skills),top=topMistakes(S.sessions)[0],r=route();
  if(!sug&&!top)return '';
  return `<div class="card"><h3>Coach notes</h3>
   ${sug?(sug.routeId===r.id?`<div class="small">✓ This is the suggested next lesson. ${esc(sug.why)}.</div>`
     :`<div class="row nowrap" style="justify-content:space-between"><div class="small"><b>Suggested: Stage ${sug.stage} · ${esc(sug.name)}</b><br>${esc(sug.why)}.</div><button class="btn small" data-goroute="${sug.routeId}">Switch</button></div>`):''}
   ${top?`<div class="small">Watch for: <b>${esc(top[0])}</b> (${top[1]}× in the last 30 days). ${esc(FLAGS[top[0]]?.tip||'')}</div>`:''}</div>`}

function renderPrestart(){const late=curfew(new Date());
  return `<h2>Before you go</h2>
   ${late?`<div class="card alert"><b>Class 7 learners can't drive between midnight and 5 a.m.</b><div class="small">Alberta graduated licensing rule. Start anyway only if the driver now holds a licence without this restriction.</div></div>`:''}
   <div class="card">${RULES.checklist.map((t,i)=>`<label class="check"><input type="checkbox" id="ck${i}"><span>${esc(t)}</span></label>`).join('')}</div>
   <button class="btn ${late?'danger':'primary'} big" id="goBtn">${late?'Start anyway':'Start lesson'}</button>
   <div class="row" style="justify-content:space-between"><button class="btn" id="preCancel">Cancel</button><label class="check"><input type="checkbox" id="preSkip"><span class="small">Don't show this again</span></label></div>`}

function renderDrive(){const r=route(),placed=placedCps(r.cps).length;
  if(!S.onboarded)return renderOnboard();
  if(ending){const el=Date.now()-sess.start;
    return `<h2>How did it go?</h2>
     <div class="sum">${gauge(fmtDur(el),'Time')}${gauge(sess.km.toFixed(1),'Km')}${gauge(sess.done.length+'/'+placed,'Checkpoints')}</div>
     <h3>How did it feel?</h3>
     <div class="chips">${FEEL.slice(1).map((t,i)=>`<button class="chip" data-feel="${i+1}" aria-pressed="${endForm.feel===i+1}">${t}</button>`).join('')}</div>
     <h3>Notes for next time</h3>
     <textarea id="endNotes" placeholder="e.g. Brakes late before stop signs. Lane changes much better.">${esc(endForm.notes)}</textarea>
     <div class="small muted">Tip: open Skills and update anything that moved today.</div>
     <button class="btn primary big" id="saveSess">Save lesson</button>
     <div class="row" style="justify-content:space-between"><button class="btn" id="backDrive">Back to the drive</button><button class="btn danger" id="discardSess">Discard this lesson</button></div>`}
  if(sess)return expanded?renderLessonFull():renderDriving();
  if(prestart)return renderPrestart();
  return `${pendingResume?resumeCard(pendingResume):''}
     <div class="small muted">Learner: <b>${esc(prof().name)}</b>${S.profiles.length>1?' · switch in the Log tab':''}</div>
     ${coachCard()}${destCard()}${areaBar()}${routeSelect()}
     <div class="plate"><div class="k">${esc(r.stage)}</div><div class="n">${esc(r.name)}</div><div class="g">${esc(r.goal)}</div>${pathLine(r)?`<div class="g" style="margin-top:6px"><b>${pathLine(r)}</b></div>`:''}</div>
     ${placed?'':`<div class="empty">This route has no pins yet.<br><div class="row" style="justify-content:center;margin-top:10px"><button class="btn primary" id="autoBuild" ${busy?'disabled':''}>${busy?'Searching…':'Auto-build pins nearby'}</button><button class="btn" id="goPlace">Place them myself</button></div></div>`}
     <button class="btn primary big" id="startBtn">Start lesson</button>
     <div class="row">${mapsLink(r)?`<a class="btn" href="${mapsLink(r)}" target="_blank" rel="noopener">Open route in Google Maps</a>`:''}</div>
     <h3>Checkpoints</h3>${cpList(r)}
     <div class="small muted">Pins tick off by themselves within ${ARRIVE_M} m, in any order. The supervisor navigates; the driver just drives.</div>
     ${settingsBlock()}`}

let planMode='go',loopMin=20,testMin=30,loopStart=null,testStart=null,editPlaces=false;
const placeChips=(act,sel)=>editPlaces&&S.places.length?`<div class="stack">${S.places.map(p=>`<div class="row nowrap"><input type="text" id="pl_${p.id}" data-placename="${p.id}" value="${esc(p.name)}" aria-label="Place name"><button class="btn small danger" data-delplace="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button></div>`).join('')}</div>`:S.places.length?`<div class="chips">${S.places.map(p=>`<span class="chip place ${sel&&sel.id===p.id?'on':''}"><button data-${act}="${p.id}">★ ${esc(p.name)}</button>${editPlaces?`<button class="x" data-delplace="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>`:''}</span>`).join('')}</div>`:'';
function destCard(){const mode=b=>`<button class="chip" data-pm="${b}" aria-pressed="${planMode===b}">${{go:'Go to a place',loop:'Practice loop',test:'Road test'}[b]}</button>`;
  const lens=(cur,key,opts)=>`<div class="chips">${opts.map(m=>`<button class="chip" data-${key}="${m}" aria-pressed="${cur===m}">${m} min</button>`).join('')}</div>`;
  const results=destResults.length?`<div class="stack">${destResults.map((p,i)=>`<div class="entry row nowrap" style="justify-content:space-between"><button class="grow" style="all:unset;cursor:pointer;min-width:0" data-dest="${i}"><div class="top"><span>${esc(p.name)}</span></div><div class="meta">${esc(p.addr)}</div></button><button class="btn small" data-saveres="${i}" aria-label="Save ${esc(p.name)}">☆ Save</button></div>`).join('')}</div>`:'';
  const placesRow=act=>`${placeChips(act,act==='loopfrom'?loopStart:act==='testfrom'?testStart:null)}<div class="row"><button class="btn small" id="saveHere">☆ Save where I am</button>${S.places.length?`<button class="btn small" id="editPlaces">${editPlaces?'Done':'Edit places'}</button>`:''}</div>`;
  let body='';
  if(planMode==='go')body=`${placesRow('goplace')}
    <div class="row nowrap"><input type="text" id="destQ" placeholder="Address or place" aria-label="Destination" enterkeyhint="search" autocomplete="off"><button class="btn" id="destGo" ${planning?'disabled':''}>${planning?'Planning…':'Find'}</button></div>${results}
    <div class="row" style="justify-content:space-between"><button class="btn small" id="destPick">Pick on the map</button>${S.routes.some(x=>x.id===DRIVE_ID)&&route().id!==DRIVE_ID?`<button class="btn small" data-goroute="${DRIVE_ID}">Last A → B route</button>`:''}</div>
    <div class="small muted">Fastest route from where you are. Every stop sign, set of lights, turn, roundabout, merge and playground zone on the way becomes a checkpoint, with turn-by-turn voice.</div>`;
  else if(planMode==='loop')body=`<div class="small"><b>Start:</b> ${loopStart?esc(loopStart.name):'where you are'}${loopStart?' <button class="btn small" id="loopHere">Use my location</button>':''}</div>${placesRow('loopfrom')}
    ${lens(loopMin,'loopmin',[10,20,30,45])}<div class="small">Focus from the skill board: <b>${esc(focusLine('loop',loopMin))}</b></div>
    <button class="btn primary" id="buildLoop" ${planning?'disabled':''}>${planning?'Building…':'Build loop'}</button>
    <div class="small muted">A round trip past the spots that need the most practice. Tap again for a different loop.</div>`;
  else body=`<div class="small"><b>Test location:</b> ${testStart?esc(testStart.name):'pick a registry or address'}</div>${placesRow('testfrom')}
    <div class="row nowrap"><input type="text" id="testQ" placeholder="Registry name or address" aria-label="Road test location" enterkeyhint="search" autocomplete="off"><button class="btn" id="testGo">Find</button></div>
    ${testResults.length?`<div class="stack">${testResults.map((p,i)=>`<button class="entry" data-testres="${i}"><div class="top"><span>${esc(p.name)}</span></div><div class="meta">${esc(p.addr)}</div></button>`).join('')}</div>`:''}
    ${lens(testMin,'testmin',[20,30,45])}
    <button class="btn primary" id="buildTest" ${planning||!testStart?'disabled':''}>${planning?'Building…':'Build test loop'}</button>
    <div class="small muted">Starts and ends at the test location and mixes what examiners look for: stop signs, lights and left turns, playground zones, a roundabout if there's one, and parallel and hill parking on a quiet street.</div>`;
  return `<div class="card"><h3>Plan a drive</h3><div class="chips">${mode('go')}${mode('loop')}${mode('test')}</div>${body}</div>`}
let testResults=[];
async function testSearch(q){q=q.trim();if(!q)return;try{testResults=await OSM.search(q,map.getBounds().pad(3));if(!testResults.length)toast('No matches. Try the street address.');render()}catch(e){toast('Search failed. Check the connection.')}}
function renderDriving(){const r=route(),nx=nextTarget(r.cps,sess.done),placed=placedCps(r.cps).length;
  return `${navBanner()}<div class="dhud"><div class="spd" id="hSpd"><b id="hSpeed">0</b><span>km/h</span></div>
     <div class="limit" id="hLimit" hidden aria-label="Speed limit"></div>
     <div class="dnext">${nx?`<div class="small muted">Next · ${r.cps.indexOf(nx)+1} of ${r.cps.length}</div><div class="nm">${esc(nx.name)}</div><div class="ds" id="hNext">—</div>`
       :placed?'<div class="nm">All checkpoints done</div><div class="small muted">Head back and end the lesson</div>':'<div class="nm">Free drive</div><div class="small muted">No pins on this route</div>'}</div></div>
   ${nx&&nx.task?`<div class="small" style="margin-top:-4px">${esc(nx.task)}</div>`:''}
   <div class="markrow" role="group" aria-label="Mark a moment">${Object.keys(FLAGS).map(t=>`<button class="chip ${FLAGS[t].good?'good':''}" data-flag="${esc(t)}">${t}</button>`).join('')}<button class="chip addstop" id="addStop">+ Stop sign</button></div>
   <div class="dbar">${nx?`<button class="btn" data-done="${nx.id}">✓ ${esc(nx.name.length>16?'Done':nx.name)}</button>`:'<span></span>'}<button class="btn" id="moreBtn">More</button><button class="btn stopbtn" id="endBtn">End</button></div>
   <div class="dmeta" id="hMeta"></div>`}

function renderLessonFull(){const r=route(),nx=nextTarget(r.cps,sess.done),placed=placedCps(r.cps).length,pct=placed?Math.round(sess.done.length/placed*100):0;
  return `<button class="btn primary" id="lessBtn">Back to driving view</button>
     <div class="hud"><div class="gauge speed"><div class="v" id="hSpeed">0</div><div class="u">km/h</div></div>
     <div class="gauge"><div class="v" id="hTime">0:00</div><div class="u">Time</div></div>
     <div class="gauge"><div class="v" id="hKm">0.0</div><div class="u">Km</div></div></div>
     ${nx?`<div class="next"><div><h3>Next · ${r.cps.indexOf(nx)+1}</h3><div class="cp-name">${esc(nx.name)}</div></div><div class="d" id="hNext">—</div><div class="t">${esc(nx.task)}</div></div>`:''}
     <div class="progressbar" aria-label="Route progress"><i style="width:${pct}%"></i></div>
     <h3>Marks this lesson</h3><div class="small">${sess.flags.length?sess.flags.map(f=>`${esc(f.label)}${f.auto?' (auto)':''}`).join(' · '):'None yet'}</div>
     <h3>Checkpoints</h3>${cpList(r)}
     ${settingsBlock()}
     <button class="btn stopbtn big" id="endBtn">End lesson</button>`}

function updateHud(){if(!sess||ending)return;const q=id=>document.getElementById(id),r=route(),placed=placedCps(r.cps).length;
  const kmh=Math.round(sess.kmh||0);q('hSpeed')&&(q('hSpeed').textContent=kmh);
  q('hTime')&&(q('hTime').textContent=fmtDur(Date.now()-sess.start));q('hKm')&&(q('hKm').textContent=sess.km.toFixed(1));
  q('hNext')&&(q('hNext').textContent=sess.nextDist!=null?fmtDist(sess.nextDist):'—');
  const lm=q('hLimit');if(lm){lm.hidden=!lim.cur;if(lim.cur){lm.textContent=lim.cur.kmh;lm.classList.toggle('assumed',lim.cur.assumed);lm.title=lim.cur.assumed?'Calgary default for residential streets (no sign in map data)':'Posted limit from map data'}}
  q('hSpd')?.classList.toggle('over',!!lim.cur&&kmh>lim.cur.kmh+5);
  if(q('hNav')&&navState.next){const {m,dist}=navState.next;q('hNavI').textContent=m.icon;q('hNavD').textContent=fmtDist(dist);q('hNavT').textContent=m.text}
  else if(q('hNav')){q('hNavD').textContent='';q('hNavT').textContent=lastFix?'Head to the yellow line':'Waiting for GPS…'}
  const bad=sess.flags.filter(f=>!FLAGS[f.label]?.good).length;
  q('hMeta')&&(q('hMeta').textContent=`${fmtDur(Date.now()-sess.start)} · ${sess.km.toFixed(1)} km · ${sess.done.length}/${placed} pins · ${bad} mark${bad===1?'':'s'}`)}

function renderRoutes(){const r=route(),n=stageNum(r),pins=placedCps(r.cps);
  const what=['','parking lots','stop signs and playgrounds','traffic lights','roundabouts','highway ramps','mixed test spots'][n]||'';
  return `${routeSelect()}
   <div class="plate"><div class="k">${esc(r.stage)}</div><div class="n">${esc(r.name)}</div>${pathLine(r)?`<div class="g">${pathLine(r)}</div>`:''}</div>
   <div class="card"><h3>Add pins</h3>
    ${n&&n<=6?`<button class="btn primary" id="autoBuild" ${busy?'disabled':''}>${busy?'Searching…':`Auto-build: find ${what} near the map centre`}</button>`:''}
    <div class="row nowrap"><input type="text" id="placeQ" placeholder="Search a place or address" aria-label="Find a place" enterkeyhint="search"><button class="btn" id="placeGo">Find</button></div>
    <div id="placeRes" class="stack">${placeResults.map((p,i)=>`<button class="entry" data-place="${i}"><div class="top"><span>${esc(p.name)}</span></div><div class="meta">${esc(p.addr)}</div></button>`).join('')}</div>
    <button class="btn ${placing?'primary':''}" id="placeBtn">${placing?'Done tapping the map':'Tap the map to add pins'}</button>
    ${areaBar()}</div>
   ${turnaroundNote(r)}<div class="card"><div class="row" style="justify-content:space-between"><h3>Pins · ${pins.length}</h3>${pins.length?'<button class="btn small danger" id="clearPins">Clear route</button>':''}</div>
    ${r.cps.length?`<div class="small muted">Tap a name to see it on the map. Drag a pin on the map to move it. ✕ removes it.</div>${pinList(r)}`
      :`<div class="empty">No pins yet. Use Auto-build, search, or tap the map.</div>`}</div>
   <details class="settings"><summary>Route details</summary><div class="stack" style="margin-top:8px">
    <label class="small">Name<input type="text" id="rName" value="${esc(r.name)}"></label>
    <div class="row nowrap"><label class="small" style="max-width:120px">Stage<input type="text" id="rStage" value="${esc(r.stage)}"></label><label class="small grow">Goal<input type="text" id="rGoal" value="${esc(r.goal)}" placeholder="Goal for this route"></label></div>
    <div class="row"><button class="btn" id="newRoute">New route</button>${n?'':'<button class="btn danger" id="delRoute">Delete this route</button>'}</div></div></details>
   ${S.userStops.length?`<details class="settings"><summary>Stop signs you added · ${S.userStops.length}</summary><div class="stack" style="margin-top:8px"><div class="small muted">Added with "+ Stop sign" during a lesson, for signs the map data was missing. They're used in new routes and rolling-stop checks.</div>
    ${S.userStops.map((u,i)=>`<div class="row nowrap" style="justify-content:space-between"><span class="small">Stop sign ${i+1} · added ${new Date(u.t).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span><span class="row nowrap"><button class="btn small" data-showstop="${u.id}">Show</button><button class="btn small danger" data-delstop="${u.id}">✕</button></span></div>`).join('')}</div></details>`:''}
   <details class="settings"><summary>Backup</summary><div class="stack" style="margin-top:8px"><div class="row"><button class="btn" id="exportBtn">Back up all data</button><button class="btn" id="importBtn">Restore from backup</button></div>
    <div class="small muted" id="storageLine"></div></div></details>`}
/* Editable pin list: name + task, move up/down, delete (pin and row together). */
function pinList(r){return `<ul class="cps">${r.cps.map((c,i)=>`<li><span class="num ${c.lat!=null?'placed':''}">${i+1}</span>
   <div class="cp-edit"><input type="text" id="n_${c.id}" data-cp="${c.id}" data-f="name" value="${esc(c.name)}" aria-label="Pin name">
   <input type="text" id="t_${c.id}" data-cp="${c.id}" data-f="task" value="${esc(c.task)}" placeholder="What to practise here" aria-label="Task">
   ${c.lat!=null?`<button class="linkbtn" data-goto="${c.id}">Show on map</button>`:'<span class="small muted">Not on the map: tap the map to place it</span>'}</div>
   <div class="stack"><button class="iconbtn" data-up="${c.id}" aria-label="Move up" ${i?'':'disabled'}>↑</button><button class="iconbtn" data-down="${c.id}" aria-label="Move down" ${i<r.cps.length-1?'':'disabled'}>↓</button><button class="iconbtn del" data-del="${c.id}" aria-label="Delete pin">✕</button></div></li>`).join('')}</ul>`}

function renderSkills(){const pct=skillPct(S.skills);
  return `<div class="stack"><div class="row" style="justify-content:space-between"><h2>Skill board · ${esc(prof().name)}</h2><span class="muted small">${pct}% to road-test ready</span></div><div class="small muted">Tap a skill for what to check and how to teach it.</div>
   <div class="progressbar"><i style="width:${pct}%"></i></div></div>
   ${SKILLS.map(([g,items])=>`<div class="skillgroup"><h3>${g}</h3>${items.map(([k,n])=>{const v=S.skills[k]||0,co=COACH[k];
     return `<div class="skill"><details class="coach" data-k="${k}"><summary>${n}</summary>${co?`<div class="coachbody"><div class="ck">Check</div><ul>${co.check.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><div class="ck">Teach</div><p>${esc(co.teach)}</p></div>`:''}</details><div><div class="lvl" role="group" aria-label="${esc(n)}">${[1,2,3].map(l=>`<button data-sk="${k}" data-l="${l}" class="${v>=l?'on':''}" aria-label="${LEVELS[l]}" aria-pressed="${v>=l}"></button>`).join('')}</div><div class="lvlname">${LEVELS[v]}</div></div></div>`}).join('')}</div>`).join('')}
   <button class="btn danger" id="resetSkills">Reset skill board</button>`}

/* Mistakes-per-hour trend: one series, so no legend; the heading names it. */
function trendChart(){const ser=mistakeSeries(S.sessions).slice(-12);if(ser.length<2)return '';
  const W=320,H=130,pl=26,pr=30,pt=12,pb=22,max=Math.max(2,Math.ceil(Math.max(...ser.map(p=>p.v))/2)*2);
  const x=i=>pl+(ser.length===1?0:i*(W-pl-pr)/(ser.length-1)),y=v=>pt+(H-pt-pb)*(1-v/max);
  const ticks=[0,max/2,max],first=ser[0].v,last=ser[ser.length-1].v,sel=chartSel!=null&&ser[chartSel]?ser[chartSel]:null;
  const trend=last<first?`down from ${first} to ${last}`:last>first?`up from ${first} to ${last}`:`steady at ${last}`;
  return `<div class="card"><h3>Mistakes per hour</h3>
   <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mistakes per hour over the last ${ser.length} lessons, ${trend}">
    ${ticks.map(t=>`<line class="grid" x1="${pl}" x2="${W-pr}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${pl-6}" y="${y(t)+3}" text-anchor="end">${t}</text>`).join('')}
    <polyline class="ln" points="${ser.map((p,i)=>`${x(i)},${y(p.v)}`).join(' ')}"/>
    ${ser.map((p,i)=>`<circle class="${chartSel===i?'sel':'dot'}" cx="${x(i)}" cy="${y(p.v)}" r="${chartSel===i?6:4}"/><rect class="hit" data-pt="${i}" x="${x(i)-14}" y="${pt}" width="28" height="${H-pt-pb}"><title>${new Date(p.t).toLocaleDateString()}: ${p.v}/h</title></rect>`).join('')}
    <text class="lbl" x="${x(ser.length-1)+8}" y="${y(last)+4}">${last}</text>
    <text class="axis" x="${pl}" y="${H-4}">${new Date(ser[0].t).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</text>
    <text class="axis" x="${W-pr}" y="${H-4}" text-anchor="end">${new Date(ser[ser.length-1].t).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</text>
   </svg>
   <div class="small">${sel?`${new Date(sel.t).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}: <b>${sel.v} per hour</b> (${sel.n} mark${sel.n===1?'':'s'} in ${fmtDur(sel.h*3.6e6)})`:`Last ${ser.length} lessons, ${trend}. Lower is better. Tap a point for details.`}</div>
   ${(()=>{const tm=topMistakes(S.sessions).slice(0,3);return tm.length?`<div class="small muted">Most common in the last 30 days: ${tm.map(([k,n])=>`${esc(k)} ×${n}`).join(' · ')}</div>`:''})()}</div>`}

const stageOf=s=>s.stage||(S.routes.find(r=>r.id===s.routeId)||{}).stage||'Custom';
function renderLog(){const stages=[...new Set(S.sessions.map(stageOf))].sort();if(logFilter!=='all'&&!stages.includes(logFilter))logFilter='all';
  const ss=S.sessions.filter(s=>logFilter==='all'||stageOf(s)===logFilter),hrs=ss.reduce((a,s)=>a+hours(s),0),km=ss.reduce((a,s)=>a+s.km,0);
  return `${profileCard()}${backupNudge()}${trendChart()}${spotsCard()}
   ${stages.length>1?`<div class="chips">${['all',...stages].map(x=>`<button class="chip" data-lf="${esc(x)}" aria-pressed="${logFilter===x}">${x==='all'?'All':esc(x)}</button>`).join('')}</div>`:''}
   <div class="sum">${gauge(ss.length,'Lessons')}${gauge(hrs.toFixed(1),'Hours')}${gauge(km.toFixed(0),'Km')}</div>
   ${ss.length?ss.map(s=>`<div class="entry"><div class="top"><span>${esc(s.routeName)}</span><span>${FEEL[s.feel]||''}</span></div>
     <div class="meta">${esc(stageOf(s))} · ${new Date(s.start).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})} · ${fmtDur(s.end-s.start)} · ${s.km} km · top ${s.maxKmh} km/h · ${s.done}/${s.total} pins${s.flags?.length?` · ${badFlags(s).length} marks`:''}</div>
     ${s.notes?`<div class="note">${esc(s.notes)}</div>`:''}<div class="row" style="margin-top:10px"><button class="btn small" data-sess="${s.id}">Show on map</button><button class="btn small primary" data-rep="${s.id}">Report</button><button class="btn small danger" data-delsess="${s.id}" style="margin-left:auto">Delete</button></div></div>`).join('')
    :`<div class="empty">No lessons yet. Finished lessons land here with time, distance, the track you drove and your notes.</div>`}
   ${ss.length?`<button class="btn danger" id="clearLog">Delete all ${ss.length} lesson${ss.length>1?'s':''}${logFilter==='all'?'':' in '+esc(logFilter)}</button>`:''}
   <div class="small muted">Just testing the app? Use "Discard this lesson" at the end of a drive so it never lands here.</div>`}
function dropSessions(ids){const gone=S.sessions.filter(s=>ids.includes(s.id));S.sessions=S.sessions.filter(s=>!ids.includes(s.id));histLayer.clearLayers();save();render();
  toast(`Deleted ${ids.length} lesson${ids.length>1?'s':''}`,{action:()=>{S.sessions=[...S.sessions,...gone].sort((a,b)=>b.start-a.start);save();render()}})}

/* render() keeps scroll position and open skill cards between redraws */
const scrollMem={};let lastKey=null;const openCards=new Set();
function viewKey(){return mapBig?'mini':reportView?'report':lotPick?'lots':tab+(tab==='drive'?(sess?(ending?':end':expanded?':full':':drv'):prestart?':pre':''):'')}
let spotLayer=null;
function drawSpots(){if(!map)return;if(!spotLayer)spotLayer=L.layerGroup().addTo(map);spotLayer.clearLayers();
  problemSpots(S.sessions).forEach(sp=>L.marker(sp.ll,{icon:L.divIcon({className:'',iconSize:[26,26],iconAnchor:[13,13],html:'<div class="spot"><span>!</span></div>'}),keyboard:false})
    .bindTooltip(`${esc(sp.label)} · ${sp.count}× in ${sp.lessons} lessons`,{direction:'top',offset:[0,-12]}).addTo(spotLayer))}
function spotsCard(){const ps=problemSpots(S.sessions);if(!ps.length)return '';
  return `<div class="card"><h3>Problem spots</h3><div class="small muted">Same mistake at the same place in 2+ lessons. Shown on the map with an orange marker; the voice gives a heads-up on the way there.</div>
   ${ps.slice(0,6).map((sp,i)=>`<div class="row nowrap" style="justify-content:space-between"><div class="small"><b>${esc(sp.label)}</b> · ${sp.count}× in ${sp.lessons} lessons</div><button class="btn small" data-showspot="${i}">Show</button></div>`).join('')}</div>`}
function render(){if(!S)return;drawSpots();
  if(lastKey){scrollMem[lastKey]=pane.scrollTop;if(lastKey==='skills')pane.querySelectorAll('details.coach').forEach(d=>d.open?openCards.add(d.dataset.k):openCards.delete(d.dataset.k))}
  const key=viewKey();
  appEl.classList.toggle('driving',!!sess&&!ending&&!expanded&&tab==='drive'&&!reportView);
  if(reportView&&!mapBig){renderReport();lastKey=key;return}
  pane.innerHTML=mapBig?renderMini():lotPick?renderLotPick():({drive:renderDrive,routes:renderRoutes,skills:renderSkills,log:renderLog})[tab]();
  if(key==='skills')pane.querySelectorAll('details.coach').forEach(d=>{if(openCards.has(d.dataset.k))d.open=true});
  pane.scrollTop=scrollMem[key]||0;lastKey=key;
  if(tab==='drive'&&sess)updateHud();
  if(tab==='routes')storageLine()}
async function storageLine(){const el=document.getElementById('storageLine');const [u,d]=await Promise.all([Store.usage(),OSM.dataInfo()]);if(!el)return;
  const parts=[];if(d)parts.push(`Map data for the Calgary area saved ${d.generated}; auto-build and speed limits work there without outside servers.`);
  if(u&&u.usage!=null)parts.push(`Using ${(u.usage/1048576).toFixed(1)} MB on this phone.`);el.textContent=parts.join(' ')}
function syncTabs(){document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x.dataset.tab===tab))}
function syncVoiceBtn(){const b=document.getElementById('voiceBtn');b.setAttribute('aria-pressed',S.settings.voice);b.title=b.ariaLabel=S.settings.voice?'Voice on':'Voice off';
  b.innerHTML=S.settings.voice?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>'
    :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>'}

/* ---------- backup ---------- */
async function backup(){S.lastBackup=Date.now();save();await Store.flush();
  const b=new Blob([JSON.stringify(S,null,1)],{type:'application/json'});deliver(b,`drive-coach-backup-${new Date().toISOString().slice(0,10)}.json`);setTimeout(render,600)}
function restore(file){const rd=new FileReader();
  rd.onload=()=>{try{const j=JSON.parse(rd.result);if(!Array.isArray(j.routes))throw 0;S=migrate(j);S.onboarded=true;save();Store.flush();drawRoute();render();toast('Backup restored')}
    catch(err){toast('That file is not a Drive Coach backup')}};rd.readAsText(file)}

/* ---------- events ---------- */
function confirmTap(t,label){if(t.dataset.sure)return true;t.dataset.sure=1;t.textContent=label;setTimeout(()=>{if(t.isConnected){delete t.dataset.sure;render()}},4000);return false}
pane.addEventListener('click',async e=>{const pt=e.target.closest('[data-pt]');if(pt){chartSel=+pt.dataset.pt===chartSel?null:+pt.dataset.pt;return render()}
  const t=e.target.closest('button');if(!t)return;const r=route(),d=t.dataset,id=t.id;
  // lesson
  if(d.pm){planMode=d.pm;destResults=[];return render()}
  if(d.loopmin){loopMin=+d.loopmin;return render()}
  if(d.testmin){testMin=+d.testmin;return render()}
  if(d.goplace){const p=S.places.find(x=>x.id===d.goplace);return p&&planDriveTo({name:p.name,ll:p.ll})}
  if(d.loopfrom){const p=S.places.find(x=>x.id===d.loopfrom);loopStart=loopStart&&loopStart.id===p.id?null:p;return render()}
  if(d.testfrom){testStart=S.places.find(x=>x.id===d.testfrom);testResults=[];return render()}
  if(id==='loopHere'){loopStart=null;return render()}
  if(id==='buildLoop')return planLoop({start:loopStart&&loopStart.ll,startName:loopStart&&loopStart.name,minutes:loopMin,mode:'loop'});
  if(id==='buildTest')return testStart&&planLoop({start:testStart.ll,startName:testStart.name,minutes:testMin,mode:'test'});
  if(id==='testGo')return testSearch(document.getElementById('testQ').value);
  if(d.testres!=null){const p=testResults[+d.testres];testStart={id:'tmp',name:p.name,ll:p.ll};testResults=[];return render()}
  if(d.saveres!=null){const p=destResults[+d.saveres];S.places.push({id:uid(),name:p.name,ll:p.ll});save();toast(`Saved “${p.name}” to your places`);return render()}
  if(id==='saveHere'){const ll=await myPosition();if(!ll)return toast('No GPS fix yet');S.places.push({id:uid(),name:S.places.length?'Place '+(S.places.length+1):'Home',ll});editPlaces=true;save();toast('Saved. Rename it below.');return render()}
  if(id==='editPlaces'){editPlaces=!editPlaces;return render()}
  if(d.delplace){const i=S.places.findIndex(x=>x.id===d.delplace),p=S.places[i];S.places.splice(i,1);save();render();return toast(`Removed ${p.name}`,{action:()=>{S.places.splice(i,0,p);save();render()}})}
  if(d.showspot){const sp=problemSpots(S.sessions)[+d.showspot];if(sp){map.setView(sp.ll,17);toast(`${sp.label}: ${sp.count}× in ${sp.lessons} lessons`)}return}
  if(id==='miniBack')return toggleBig(false);
  if(id==='destGo')return destSearch(document.getElementById('destQ').value);
  if(d.dest!=null)return planDriveTo(destResults[+d.dest]);
  if(id==='destPick'){pickingDest=true;setPlacing(true,'Tap the map where you want to drive to');return toast('Tap the destination on the map')}
  if(id==='startBtn'){if(S.settings.checklist||curfew(new Date())){prestart=true;return render()}return startSession()}
  if(id==='goBtn'){if(document.getElementById('preSkip')?.checked){S.settings.checklist=false;save()}return startSession()}
  if(id==='preCancel'){prestart=false;return render()}
  if(id==='moreBtn'){expanded=true;return render()}
  if(id==='lessBtn'){expanded=false;return render()}
  if(id==='endBtn'){ending=true;persistActive();return render()}
  if(id==='backDrive'){ending=false;persistActive();return render()}
  if(id==='saveSess')return finishSession(true);
  if(id==='discardSess'){if(confirmTap(t,'Tap again to discard'))finishSession(false);return}
  if(d.feel){endForm.feel=+d.feel;persistActive();return render()}
  if(d.done)return markDone(r.cps.find(c=>c.id===d.done),false);
  if(d.flag)return addFlag(d.flag);
  if(id==='addStop'){if(!lastFix)return toast('Waiting for GPS…');const u={id:uid(),ll:[+lastFix.ll[0].toFixed(6),+lastFix.ll[1].toFixed(6)],t:Date.now()};S.userStops.push(u);save();
    const m=L.marker(u.ll,{icon:L.divIcon({className:'',iconSize:[24,24],iconAnchor:[12,12],html:'<div class="ustop">STOP</div>'})}).addTo(flagLayer);
    return toast('Stop sign saved here. Future routes will include it.',{action:()=>{S.userStops=S.userStops.filter(x=>x!==u);flagLayer.removeLayer(m);save()},ms:6000})}
  if(d.delstop){const i=S.userStops.findIndex(x=>x.id===d.delstop),u=S.userStops[i];S.userStops.splice(i,1);save();render();return toast('Stop sign removed',{action:()=>{S.userStops.splice(i,0,u);save();render()}})}
  if(d.showstop){const u=S.userStops.find(x=>x.id===d.showstop);if(u){map.setView(u.ll,18);L.marker(u.ll,{icon:L.divIcon({className:'',iconSize:[24,24],iconAnchor:[12,12],html:'<div class="ustop">STOP</div>'})}).addTo(histLayer)}return}
  if(id==='resResume')return resumeActive(pendingResume,false);
  if(id==='resSave')return resumeActive(pendingResume,true);
  if(id==='resDiscard'){if(confirmTap(t,'Tap again to discard')){pendingResume=null;Store.del('active');render()}return}
  if(d.goroute){S.activeRouteId=d.goroute;save();drawRoute();fitRoute();return render()}
  if(id==='onbDone'){S.onboarded=true;if(!prof().name.trim())prof().name='Learner';save();Store.persist();return render()}
  // areas & routes
  if(id==='nearMe')return nearMe();
  if(id==='autoBuild')return autoBuild();
  if(id==='lotCancel')return cancelLotPick();
  if(d.lot!=null)return chooseLot(+d.lot);
  if(id==='placeGo')return placeSearch(document.getElementById('placeQ').value);
  if(d.place!=null)return pinPlace(+d.place);
  if(id==='goPlace'){tab='routes';syncTabs();setPlacing(true);return render()}
  if(id==='areaAdd'){savingArea=true;render();document.getElementById('areaName')?.focus();return}
  if(id==='areaSave'){const n=document.getElementById('areaName').value.trim();if(!n)return toast('Give the area a name');
    const c=map.getCenter();const a={id:'a_'+uid(),name:n,c:[+c.lat.toFixed(5),+c.lng.toFixed(5)],z:map.getZoom()};
    (S.areas=S.areas||[]).push(a);S.areaId=a.id;savingArea=false;save();toast('Saved area '+n);return render()}
  if(id==='areaDel'){if(confirmTap(t,'Tap again to remove')){S.areas=(S.areas||[]).filter(x=>x.id!==S.areaId);save();goArea('calgary')}return}
  if(id==='placeBtn'){setPlacing(!placing);if(placing)toast('Tap the map where each checkpoint is');return render()}
  if(d.up){const i=r.cps.findIndex(c=>c.id===d.up);if(i>0){[r.cps[i-1],r.cps[i]]=[r.cps[i],r.cps[i-1]];save();drawRoute();render()}return}
  if(d.down){const i=r.cps.findIndex(c=>c.id===d.down);if(i>=0&&i<r.cps.length-1){[r.cps[i+1],r.cps[i]]=[r.cps[i],r.cps[i+1]];save();drawRoute();render()}return}
  if(d.goto){const c=r.cps.find(x=>x.id===d.goto);if(c){map.setView([c.lat,c.lng],17);if(mapBig)toggleBig(false)}return}
  if(d.del){const i=r.cps.findIndex(c=>c.id===d.del),c=r.cps[i];r.cps.splice(i,1);save();drawRoute();render();
    return toast('Pin deleted',{action:()=>{r.cps.splice(i,0,c);save();drawRoute();render()}})}
  if(id==='newRoute'){const n={id:uid(),name:'My route',stage:'Custom',goal:'',cps:[],area:S.areaId||'calgary'};S.routes.push(n);S.activeRouteId=n.id;save();setPlacing(true);drawRoute();return render()}
  if(id==='clearPins'){if(!confirmTap(t,'Tap again to clear'))return;const before=JSON.parse(JSON.stringify(r.cps));r.cps=[];delete r.path;save();drawRoute();render();
    return toast('Route cleared',{action:()=>{r.cps=before;save();drawRoute();render()}})}
  if(id==='delRoute'){if(stageNum(r))return toast('Stage routes can be cleared but not deleted');if(!confirmTap(t,'Tap again to delete'))return;
    const i=S.routes.indexOf(r);S.routes.splice(i,1);S.activeRouteId=S.routes[0].id;save();drawRoute();render();
    return toast(`Deleted “${r.name}”`,{action:()=>{S.routes.splice(i,0,r);S.activeRouteId=r.id;save();drawRoute();render()}})}
  // skills
  if(d.sk){const l=+d.l;S.skills[d.sk]=S.skills[d.sk]===l?l-1:l;save();return render()}
  if(id==='resetSkills'){if(confirmTap(t,'Tap again to reset all skills')){const old={...S.skills};S.skills={};save();render();toast('Skill board reset',{action:()=>{S.skills=old;save();render()}})}return}
  // log & profiles
  if(d.lf){logFilter=d.lf;return render()}
  if(id==='pfEdit'){editingProfile=true;return render()}
  if(id==='pfDone'){editingProfile=false;return render()}
  if(id==='pfNew'){if(sess)return toast('End the lesson first');S.pdata[S.profileId]={sessions:S.sessions,skills:S.skills};const np={id:'p'+uid(),name:'New learner',since:'',testDate:'',goalHours:''};
    S.profiles.push(np);S.sessions=[];S.skills={};S.profileId=np.id;logFilter='all';histLayer.clearLayers();editingProfile=true;save();return render()}
  if(id==='pfDel'){if(!confirmTap(t,'Tap again: deletes their lessons too'))return;
    const gone=S.profileId;S.profiles=S.profiles.filter(x=>x.id!==gone);const nx=S.profiles[0].id,dd=S.pdata[nx]||{sessions:[],skills:{}};
    S.sessions=dd.sessions;S.skills=dd.skills;delete S.pdata[nx];S.profileId=nx;editingProfile=false;save();toast('Profile deleted');return render()}
  if(d.delsess){if(confirmTap(t,'Tap again'))dropSessions([d.delsess]);return}
  if(id==='clearLog'){if(confirmTap(t,'Tap again to delete them all')){const ids=S.sessions.filter(s=>logFilter==='all'||stageOf(s)===logFilter).map(s=>s.id);logFilter='all';dropSessions(ids)}return}
  if(d.sess){const s=S.sessions.find(s=>s.id===d.sess);histLayer.clearLayers();if(s.track?.length){const pl=L.polyline(trackSegments(s.track,s.breaks),{color:'#7A4FD6',weight:5,opacity:.85}).addTo(histLayer);(s.gaps||[]).forEach(g=>L.polyline([g.a,g.b],{color:'#8A958E',weight:3,dashArray:'4 8'}).addTo(histLayer));
    (s.flags||[]).forEach(f=>L.marker(f.ll,{icon:flagIcon(FLAGS[f.label]?.good)}).bindTooltip(esc(f.label)).addTo(histLayer));
    map.fitBounds(pl.getBounds(),{padding:[30,30]})}else toast('No GPS track saved for this lesson');return}
  // report
  if(id==='repClose'){reportView=null;return render()}
  if(id==='repPng')return sharePng();
  if(id==='repPdf')return sharePdf();
  if(d.rep){reportView=d.rep;return render()}
  // backup
  if(id==='exportBtn')return backup();
  if(id==='importBtn')return document.getElementById('importFile').click();
});
pane.addEventListener('change',e=>{const t=e.target;
  if(t.id==='areaSel')return goArea(t.value);
  if(t.id==='pfSel')return switchProfile(t.value);
  if(t.id==='routeSel'){if(sess)return toast('End the lesson before switching routes'),render();S.activeRouteId=t.value;save();histLayer.clearLayers();drawRoute();fitRoute();return render()}
  const set={setVoice:'voice',setSpeed:'speedAlerts',setAutoMark:'autoSpeedMarks',setChecklist:'checklist',setAutoChecks:'autoChecks',setSpots:'spotWarnings'}[t.id];
  if(set){S.settings[set]=t.checked;save();if(set==='voice'){syncVoiceBtn();if(t.checked){unlockAudio();say('Voice prompts on')}}if(set==='speedAlerts'&&!t.checked)lim.cur=null}
});
pane.addEventListener('input',e=>{const t=e.target,r=route();
  if(t.id==='endNotes'){endForm.notes=t.value;return}
  const pf={pfName:'name',pfSince:'since',pfTest:'testDate',pfGoal:'goalHours'}[t.id];if(pf){prof()[pf]=t.value;save();return}
  if(t.dataset.placename){const p=S.places.find(x=>x.id===t.dataset.placename);if(p){p.name=t.value;save()}return}
  if(t.id==='rName'){r.name=t.value;save();return}
  if(t.id==='rStage'){r.stage=t.value;save();return}
  if(t.id==='rGoal'){r.goal=t.value;save();return}
  if(t.dataset.cp){const c=r.cps.find(c=>c.id===t.dataset.cp);c[t.dataset.f]=t.value;save();drawRoute()}
});
pane.addEventListener('keydown',e=>{if(e.key!=='Enter')return;if(e.target.id==='placeQ'){e.preventDefault();placeSearch(e.target.value)}if(e.target.id==='destQ'){e.preventDefault();destSearch(e.target.value)}if(e.target.id==='testQ'){e.preventDefault();testSearch(e.target.value)}});
document.getElementById('importFile').onchange=e=>{const f=e.target.files[0];if(f)restore(f);e.target.value=''};
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;reportView=null;prestart=false;if(lotPick)cancelLotPick();syncTabs();if(tab!=='routes')setPlacing(false);render()});
document.getElementById('locBtn').onclick=e=>{if(!ensureWatch())return;follow=!follow;e.currentTarget.setAttribute('aria-pressed',follow);if(follow&&lastFix)map.setView(lastFix.ll,17)};
document.getElementById('fitBtn').onclick=()=>fitRoute();
document.getElementById('bigBtn').onclick=()=>toggleBig();
document.getElementById('voiceBtn').onclick=()=>{S.settings.voice=!S.settings.voice;save();syncVoiceBtn();if(S.settings.voice){unlockAudio();say('Voice on')}else hush();toast(S.settings.voice?'Voice prompts on':'Voice prompts off')};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){persistActive();Store.flush()}else if(sess)grabWake()});
window.addEventListener('pagehide',()=>{persistActive();Store.flush()});

/* ---------- start up ---------- */
(async function boot(){
  S=migrate((await Store.loadState())||seed());
  const a=await Store.get('active');if(a&&a.sess)pendingResume=a;
  initMap();drawRoute();syncTabs();render();
  if(S.onboarded)Store.persist();
  if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
