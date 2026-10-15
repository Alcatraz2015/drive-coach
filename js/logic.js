/* Drive Coach: pure logic. No DOM, no map, no storage, so it can be unit tested in Node (tests/logic.test.js). */
(function(root){
// data.js's top-level consts are global lexical bindings in the browser (not window properties), so name them directly.
const D = typeof module!=='undefined' ? require('./data.js')
  : {COACH,LEVELS,SKILLS,TEMPLATES,FLAGS,FEEL,MISTAKES,AREAS,STAGE_SKILLS,RULES,CALGARY_BOX,CALGARY_RES_LIMIT};

const uid=()=>Math.random().toString(36).slice(2,9);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const RAD=Math.PI/180;
function hav(a,b){const dLa=(b[0]-a[0])*RAD,dLo=(b[1]-a[1])*RAD;
  const h=Math.sin(dLa/2)**2+Math.cos(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.sin(dLo/2)**2;return 2*6371000*Math.asin(Math.min(1,Math.sqrt(h)))}
function bearing(a,b){const y=Math.sin((b[1]-a[1])*RAD)*Math.cos(b[0]*RAD),x=Math.cos(a[0]*RAD)*Math.sin(b[0]*RAD)-Math.sin(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.cos((b[1]-a[1])*RAD);return(Math.atan2(y,x)/RAD+360)%360}
const angDiff=(a,b)=>{const d=Math.abs(a-b)%360;return d>180?360-d:d};
function fmtDur(ms){const s=Math.max(0,Math.floor(ms/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`:`${m}:${String(x).padStart(2,'0')}`}
function fmtDist(m){return m<1000?Math.round(m/10)*10+' m':(m/1000).toFixed(1)+' km'}
const stageNum=r=>+((/Stage\s*(\d)/i.exec(r&&r.stage||'')||[])[1]||0);
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};

/* ---------- GPS ---------- */
const GPS={maxAcc:30,maxKmh:180,minStep:4};
/* Decide whether a new fix should extend the lesson track. prev = last accepted {ll,t}. */
function acceptFix(prev,fix){
  if(fix.acc==null||fix.acc>GPS.maxAcc)return {ok:false,why:'inaccurate'};
  if(!prev)return {ok:true,dist:0};
  const d=hav(prev.ll,fix.ll),dt=(fix.t-prev.t)/1000;
  if(dt<=0)return {ok:false,why:'stale'};
  if(d/dt*3.6>GPS.maxKmh)return {ok:false,why:'jump'};
  if(d<Math.max(GPS.minStep,fix.acc*0.3))return {ok:false,why:'still',dist:d};
  return {ok:true,dist:d};
}
/* Speed shown and recorded = median of the last few readings, so one bad reading can't spike the top speed. */
function smoothSpeed(buf,kmh,n=3){if(kmh!=null&&isFinite(kmh)&&kmh>=0&&kmh<GPS.maxKmh){buf.push(kmh);if(buf.length>n)buf.shift()}return median(buf)}
function thinTrack(tr,max=1500){if(tr.length<=max)return tr;const k=Math.ceil(tr.length/max);return tr.filter((_,i)=>i%k===0||i===tr.length-1)}

/* ---------- checkpoints (any order) ---------- */
function placedCps(cps){return cps.filter(c=>c.lat!=null)}
/* Checkpoints within radius of ll that aren't done yet. */
function arrivals(cps,done,ll,radius){return placedCps(cps).filter(c=>!done.includes(c.id)&&hav(ll,[c.lat,c.lng])<=radius)}
/* Next target: first undone pin after the furthest one reached; if none, the first undone pin overall. */
function nextTarget(cps,done){const p=placedCps(cps);let hi=-1;p.forEach((c,i)=>{if(done.includes(c.id))hi=i});
  return p.slice(hi+1).find(c=>!done.includes(c.id))||p.find(c=>!done.includes(c.id))||null}
/* Pins passed over: undone pins that come before the furthest one reached. */
function skippedCps(cps,done){const p=placedCps(cps);let hi=-1;p.forEach((c,i)=>{if(done.includes(c.id))hi=i});return p.slice(0,hi).filter(c=>!done.includes(c.id))}

/* ---------- progress & coaching ---------- */
function skillPct(skills){const all=D.SKILLS.flatMap(g=>g[1]);return Math.round(all.reduce((a,[k])=>a+(skills[k]||0),0)/(all.length*3)*100)}
const hours=s=>Math.max(0,(s.end-s.start)/3.6e6);
const badFlags=s=>(s.flags||[]).filter(f=>!(D.FLAGS[f.label]||{}).good);
/* Mistakes per hour for each lesson, oldest first. Lessons under 5 minutes are skipped (too short to compare). */
function mistakeSeries(sessions){return [...sessions].sort((a,b)=>a.start-b.start).filter(s=>hours(s)>=5/60)
  .map(s=>({t:s.start,id:s.id,v:+(badFlags(s).length/hours(s)).toFixed(1),n:badFlags(s).length,h:hours(s)}))}
function topMistakes(sessions,sinceMs=30*864e5,now=Date.now()){const c={};
  sessions.filter(s=>now-s.start<=sinceMs).forEach(s=>badFlags(s).forEach(f=>c[f.label]=(c[f.label]||0)+1));
  return Object.entries(c).sort((a,b)=>b[1]-a[1])}
/* Suggest the next stage: the lowest stage whose skills aren't "With help" yet, or that has fewer than 2 lessons. */
function suggestNext(routes,sessions,skills){
  const lessonsIn=n=>sessions.filter(s=>stageNum(s)===n||stageNum(routes.find(r=>r.id===s.routeId))===n).length;
  for(let n=1;n<=6;n++){const ks=D.STAGE_SKILLS[n],weak=ks.filter(k=>(skills[k]||0)<2),cnt=lessonsIn(n);
    if(weak.length||cnt<2){const r=routes.find(x=>stageNum(x)===n);if(!r)continue;
      const names=weak.map(k=>D.SKILLS.flatMap(g=>g[1]).find(x=>x[0]===k)[1].toLowerCase());
      const why=cnt<2?`${cnt?'Only 1 lesson':'No lessons'} on this stage yet`:`${names.slice(0,2).join(' and ')}${names.length>2?` and ${names.length-2} more`:''} not at "With help" yet`;
      return {routeId:r.id,stage:n,name:r.name,why}}}
  const r=routes.find(x=>stageNum(x)===6);return r?{routeId:r.id,stage:6,name:r.name,why:'Every skill is at "With help" or better. Keep doing full test runs.'}:null}

/* ---------- Alberta learner rules ---------- */
function curfew(date){const h=date.getHours();return h>=D.RULES.noDriveFrom&&h<D.RULES.noDriveTo}
function testEligibleFrom(since){if(!since)return null;const d=new Date(since+'T12:00');if(isNaN(d))return null;d.setDate(d.getDate()+D.RULES.minLearnerDays);return d}

/* ---------- speed limits ---------- */
function parseMaxspeed(v){if(!v)return null;v=String(v).trim().toLowerCase();
  const m=/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?/.exec(v);if(m)return Math.round(+m[1]*(m[2]==='mph'?1.609:1));
  if(/urban/.test(v))return 50;if(/rural/.test(v))return 80;return null}
const inBox=(ll,b)=>ll[0]>=b[0]&&ll[0]<=b[2]&&ll[1]>=b[1]&&ll[1]<=b[3];
function segDist(p,a,b){const k=Math.cos(p[0]*RAD),ax=(a[1]-p[1])*k,ay=a[0]-p[0],bx=(b[1]-p[1])*k,by=b[0]-p[0],dx=bx-ax,dy=by-ay;
  const t=dx||dy?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy))):0;return Math.hypot(ax+t*dx,ay+t*dy)*111320}
/* Limit for the road the car is on: nearest way within 25 m, preferring one that points the way we're heading. */
function limitAt(ways,ll,heading){let best=null;
  for(const w of ways){const g=w.g;for(let i=0;i<g.length-1;i++){let d=segDist(ll,g[i],g[i+1]);
    if(heading!=null){const b=bearing(g[i],g[i+1]),off=Math.min(angDiff(b,heading),angDiff((b+180)%360,heading));if(off>40)d+=15}
    if(d<25&&(!best||d<best.d))best={d,w}}}
  if(!best)return null;const t=best.w.tags||{};let v=parseMaxspeed(t.maxspeed),assumed=false;
  if(v==null&&/^(residential|living_street)$/.test(t.highway||'')&&inBox(ll,D.CALGARY_BOX)){v=D.CALGARY_RES_LIMIT;assumed=true}
  return v==null?null:{kmh:v,assumed,road:t.name||''}}

/* ---------- OpenStreetMap feature helpers (auto-build) ---------- */
function polyArea(g){if(g.length<3)return 0;const la=g[0][0],k=Math.cos(la*RAD);let a=0;
  for(let i=0;i<g.length;i++){const p=g[i],q=g[(i+1)%g.length];a+=((p[1]-g[0][1])*111320*k)*((q[0]-la)*110540)-((q[1]-g[0][1])*111320*k)*((p[0]-la)*110540)}return Math.abs(a/2)}
function cluster(list,m){const out=[];list.forEach(f=>{if(!out.some(o=>hav(o.ll,f.ll)<m))out.push(f)});return out}
const ck=p=>p[0].toFixed(7)+','+p[1].toFixed(7);
const NOT_CAR=/\b(rv|r\.v\.|recreational|truck|trucks|semi|trailer|trailers|bus|buses|transit|boat|storage|motorhome|caravan|camper|staff|employee|permit|fleet|equipment|towing|impound|loading|dealer)\b/i;
function carLot(t){const des=v=>/^(designated|only)$/.test(v||'');
  if(NOT_CAR.test([t.name,t.description,t.operator,t.note].filter(Boolean).join(' ')))return false;
  if(des(t.hgv)||des(t.motorhome)||des(t.caravan)||des(t.bus)||des(t.coach)||t['parking:hgv']||t.motorcar==='no'||t.motor_vehicle==='no')return false;
  if(/^(private|no|permit|delivery|employees|staff)$/.test(t.access||''))return false;
  if(/^(underground|multi-storey|rooftop|street_side|lane|on_street)$/.test(t.parking||''))return false;
  return true}
function parseFeatures(els){
  const F={lot:[],stop:[],allway:[],signals:[],round:[],play:[],main:[],link:[]};
  for(const e of els){const t=e.tags||{};const g=e.type==='node'?[[e.lat,e.lon]]:(e.geometry||[]).map(p=>[p.lat,p.lon]);if(!g.length)continue;
    const ll=[g.reduce((a,p)=>a+p[0],0)/g.length,g.reduce((a,p)=>a+p[1],0)/g.length];const f={ll,g,name:t.name};
    if(t.highway==='stop')(t.stop==='all'?F.allway:F.stop).push(f);
    else if(t.highway==='traffic_signals')F.signals.push(f);
    else if(t.junction)F.round.push(f);
    else if(t.amenity==='parking'){f.area=polyArea(g);if(f.area>=6000&&carLot(t))F.lot.push(f)}
    else if(t.leisure==='playground')F.play.push(f);
    else if(/_link$/.test(t.highway||''))F.link.push(f);
    else if(/^(motorway|trunk)$/.test(t.highway||''))F.main.push(f)}
  F.signals=cluster(F.signals,45);F.round=cluster(F.round,90);F.stop=cluster(F.stop,25);F.allway=cluster(F.allway,40);
  F.stop=F.stop.concat(F.allway);return F}
function rankLots(F,s,n=8){return F.lot.map(l=>({l,sc:l.area*Math.exp(-hav(s,l.ll)/2500)})).sort((a,b)=>b.sc-a.sc).slice(0,n).map(x=>x.l)}
function lotPins(lot,start){const la=lot.g.map(p=>p[0]),lo=lot.g.map(p=>p[1]);const b=[Math.min(...la),Math.max(...la),Math.min(...lo),Math.max(...lo)];
  const c=lot.ll,ins=p=>[c[0]+(p[0]-c[0])*.55,c[1]+(p[1]-c[1])*.55];
  const corners=[[b[1],b[2]],[b[1],b[3]],[b[0],b[3]],[b[0],b[2]]].map(ins).sort((p,q)=>hav(start,p)-hav(start,q));
  return [corners[0],c,corners[1],corners[2],corners[3]]}
function walkRamp(F,s){
  const mainSet=new Set();F.main.forEach(w=>w.g.forEach(p=>mainSet.add(ck(p))));
  const on=F.link.filter(l=>mainSet.has(ck(l.g[l.g.length-1]))&&!mainSet.has(ck(l.g[0])));
  const offStart=new Map();F.link.forEach(l=>{if(mainSet.has(ck(l.g[0]))&&!mainSet.has(ck(l.g[l.g.length-1])))offStart.set(ck(l.g[0]),l)});
  const startIdx=new Map();F.main.forEach(w=>{const k=ck(w.g[0]);(startIdx.get(k)||startIdx.set(k,[]).get(k)).push(w)});
  const turn=(w,prev)=>angDiff(bearing(w.g[0],w.g[1]),bearing(prev,w.g[0]));
  for(const ramp of on.sort((a,b)=>hav(s,a.g[0])-hav(s,b.g[0])).slice(0,4)){const merge=ramp.g[ramp.g.length-1],mk=ck(merge);
    let way=null,i=0;for(const w of F.main){const j=w.g.findIndex(p=>ck(p)===mk);if(j>=0&&j<w.g.length-1){way=w;i=j;break}}
    if(!way)continue;let dist=0,prev=merge,steps=0;const path=[merge],seen=new Set([way]);
    while(steps++<6000){i++;if(i>=way.g.length){const nx=(startIdx.get(ck(way.g[way.g.length-1]))||[]).filter(w=>!seen.has(w)).sort((a,b)=>turn(a,prev)-turn(b,prev))[0];
        if(!nx)break;way=nx;seen.add(nx);i=0;continue}
      const p=way.g[i];dist+=hav(prev,p);prev=p;path.push(p);
      const off=offStart.get(ck(p));if(off&&dist>=1200)return{onRamp:ramp.g[0],merge,cruise:path[Math.floor(path.length/2)],exit:off.g[Math.min(off.g.length-1,Math.floor(off.g.length/2))]};
      if(dist>9000)break}}
  return null}
/* Build checkpoints for a stage from parsed features. pick.lot = the parking lot the user chose (stages 1 and 6). */
function buildStage(n,F,s,lot,mkId=uid){
  const tpl=D.TEMPLATES[n-1],used=[];
  const take=(list,from,min=150)=>{const f=list.filter(x=>!used.includes(x)&&used.every(u=>hav(u.ll,x.ll)>=min)&&hav(s,x.ll)>=80).sort((a,b)=>hav(from,a.ll)-hav(from,b.ll))[0];if(f)used.push(f);return f};
  const mk=(name,task,ll,place)=>({id:mkId(),name,task:place?`${task} (${place})`:task,lat:ll?+ll[0].toFixed(6):null,lng:ll?+ll[1].toFixed(6):null});
  if(n===1){const pins=lot?lotPins(lot,s):[];return tpl.cps.map(([nm,tk],i)=>mk(nm,tk,pins[i],i===0&&lot&&lot.name))}
  if(n===2){let cur=s;const slots=['stop','stop','stop','play','allway','start'];
    return tpl.cps.map(([nm,tk],i)=>{const k=slots[i];if(k==='start')return mk(nm,tk,s);
      const f=k==='allway'?take(F.allway.length?F.allway:F.stop,cur):k==='play'?take(F.play,cur,100):take(F.stop,cur);
      if(f)cur=f.ll;return mk(nm,tk,f&&f.ll,f&&f.name)})}
  if(n===3){let cur=s;return tpl.cps.map(([nm,tk])=>{const f=take(F.signals,cur,300);if(f)cur=f.ll;return mk(nm,tk,f&&f.ll)})}
  if(n===4){let cur=s;return [1,2,3].map(i=>{const f=take(F.round,cur,250);if(f)cur=f.ll;
    return mk('Roundabout '+i,'Slow early and pick your lane, yield to traffic already inside, signal right before your exit.',f&&f.ll,f&&f.name)})}
  if(n===5){const w=walkRamp(F,s);const pts=w?[w.onRamp,w.merge,w.cruise,w.exit]:[];return tpl.cps.map(([nm,tk],i)=>mk(nm,tk,pts[i]))}
  if(n===6){let cur=s;if(lot){used.push(lot);cur=lot.ll}
    const st=take(F.stop,cur);if(st)cur=st.ll;const sg=take(F.signals,cur,300);if(sg)cur=sg.ll;const rd=take(F.round,cur,250);
    return [mk('Pre-trip check','Explain the controls out loud before moving.',s),mk('Parking','Stall park forward and reverse, then a three-point turn.',lot&&lot.ll,lot&&lot.name),
      mk('Stop sign','Full stop behind the line, look left, right, left.',st&&st.ll),mk('Traffic signals','Approach a stale green ready to stop. Smooth left on green.',sg&&sg.ll),
      mk('Roundabout','Pick the lane early, yield, signal out.',rd&&rd.ll,rd&&rd.name),mk('Back to start','Park at the curb, wheels within 30 cm.',s)]}
  return []}

const API={uid,esc,hav,bearing,angDiff,fmtDur,fmtDist,stageNum,median,GPS,acceptFix,smoothSpeed,thinTrack,placedCps,arrivals,nextTarget,skippedCps,
  skillPct,hours,badFlags,mistakeSeries,topMistakes,suggestNext,curfew,testEligibleFrom,parseMaxspeed,inBox,segDist,limitAt,
  polyArea,cluster,carLot,parseFeatures,rankLots,lotPins,walkRamp,buildStage};
if(typeof module!=='undefined')module.exports=API;else Object.assign(root,API);
})(typeof window!=='undefined'?window:globalThis);
