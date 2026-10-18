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
/* Nearest road to ll (within 25 m), preferring one pointing the way we're heading. */
const isOneway=t=>/^(yes|1|true)$/.test(t.oneway||'')||/^(motorway|motorway_link)$/.test(t.highway||'');
/* Nearest road to ll (within 25 m). With a heading: one-way roads pointing the other way are ruled out
   (the other carriageway of Deerfoot, say), and at highway speed the main lanes beat a ramp right beside them. */
function roadAt(ways,ll,heading,kmh){let best=null;
  for(const w of ways){const g=w.g,t=w.tags||{},ow=isOneway(t),link=/_link$/.test(t.highway||'');
    for(let i=0;i<g.length-1;i++){let d=segDist(ll,g[i],g[i+1]);
      if(heading!=null){const b=bearing(g[i],g[i+1]),fwd=angDiff(b,heading),off=ow?fwd:Math.min(fwd,angDiff((b+180)%360,heading));
        if(ow&&fwd>100)continue;if(off>40)d+=15}
      if(link&&kmh>70)d+=8;
      if(d<25&&(!best||d<best.d))best={d,w}}}
  return best&&best.w}
/* Speed limit sign that doesn't flicker: a new value has to show up on 3 fixes in a row before it replaces the current one. */
function stickyLimit(st,cand){
  if(!cand){st.miss=(st.miss||0)+1;if(st.miss>=5)st.cur=null;return st.cur}
  st.miss=0;if(!st.cur||cand.kmh===st.cur.kmh){st.cur=cand;st.n=0;st.next=null;return st.cur}
  if(st.next&&st.next.kmh===cand.kmh)st.n++;else{st.next=cand;st.n=1}
  if(st.n>=3){st.cur=cand;st.n=0;st.next=null}
  return st.cur}
/* Playground zones apply on ordinary streets, not highways, ramps or 70+ roads. */
function playZoneRoad(t){if(!t)return false;if(/^(motorway|trunk)(_link)?$/.test(t.highway||'')||/_link$/.test(t.highway||''))return false;
  const v=parseMaxspeed(t.maxspeed);return v==null||v<70}
function limitAt(ways,ll,heading,kmh){const w=roadAt(ways,ll,heading,kmh);
  if(!w)return null;const t=w.tags||{};let v=parseMaxspeed(t.maxspeed),assumed=false;
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
/* Stage 1 is a practice list, not pins: a parking lot is full of parked cars that move, so pins inside it get in the way. */
function drillList(mkId=uid){return D.TEMPLATES[0].cps.map(([name,task])=>({id:mkId(),name,task,lat:null,lng:null,drill:true}))}
/* Items a lesson counts: pins on the map plus practice-list items ticked by hand. */
function trackable(cps){return cps.filter(c=>c.lat!=null||c.drill)}
function buildStage(n,F,s,lot,mkId=uid){
  const tpl=D.TEMPLATES[n-1],used=[];
  const take=(list,from,min=150)=>{const f=list.filter(x=>!used.includes(x)&&used.every(u=>hav(u.ll,x.ll)>=min)&&hav(s,x.ll)>=80).sort((a,b)=>hav(from,a.ll)-hav(from,b.ll))[0];if(f)used.push(f);return f};
  const mk=(name,task,ll,place,onLot)=>({id:mkId(),name,task:place?`${task} (${place})`:task,lat:ll?+ll[0].toFixed(6):null,lng:ll?+ll[1].toFixed(6):null,...(onLot?{onLot:true}:{})});
  if(n===1)return drillList(mkId);
  if(n===2){let cur=s;const slots=['stop','stop','stop','play','allway','start'];
    return tpl.cps.map(([nm,tk],i)=>{const k=slots[i];if(k==='start')return mk(nm,tk,s);
      const f=k==='allway'?take(F.allway.length?F.allway:F.stop,cur):k==='play'?take(F.play,cur,100):take(F.stop,cur);
      if(f)cur=f.ll;const c=mk(nm,tk,f&&f.ll,f&&f.name);if(f&&(k==='stop'||k==='allway')){c.kind=k;c.stopAt=[+f.ll[0].toFixed(6),+f.ll[1].toFixed(6)]}return c})}
  if(n===3){let cur=s;return tpl.cps.map(([nm,tk])=>{const f=take(F.signals,cur,300);if(f)cur=f.ll;return mk(nm,tk,f&&f.ll)})}
  if(n===4){let cur=s;return [1,2,3].map(i=>{const f=take(F.round,cur,250);if(f)cur=f.ll;
    return mk('Roundabout '+i,'Slow early and pick your lane, yield to traffic already inside, signal right before your exit.',f&&f.ll,f&&f.name)})}
  if(n===5){const w=walkRamp(F,s);const pts=w?[w.onRamp,w.merge,w.cruise,w.exit]:[];return tpl.cps.map(([nm,tk],i)=>mk(nm,tk,pts[i]))}
  if(n===6){let cur=s;if(lot){used.push(lot);cur=lot.ll}
    const st=take(F.stop,cur);if(st)cur=st.ll;const sg=take(F.signals,cur,300);if(sg)cur=sg.ll;const rd=take(F.round,cur,250);
    return [mk('Pre-trip check','Explain the controls out loud before moving.',s),mk('Parking','Stall park forward and reverse, then a three-point turn.',lot&&lot.ll,lot&&lot.name,true),
      Object.assign(mk('Stop sign','Full stop behind the line, look left, right, left.',st&&st.ll),st?{kind:'stop',stopAt:[+st.ll[0].toFixed(6),+st.ll[1].toFixed(6)]}:{}),mk('Traffic signals','Approach a stale green ready to stop. Smooth left on green.',sg&&sg.ll),
      mk('Roundabout','Pick the lane early, yield, signal out.',rd&&rd.ll,rd&&rd.name),mk('Back to start','Park at the curb, wheels within 30 cm.',s)]}
  return []}

/* Direction arrows along a path: one every `step` metres, each with the heading of travel. */
function pathArrows(g,step){const out=[];if(!g||g.length<2)return out;let carry=step/2;
  for(let i=0;i<g.length-1;i++){const a=g[i],b=g[i+1],d=hav(a,b);if(d<=0)continue;let t=carry;
    while(t<=d){const f=t/d;out.push({ll:[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f],deg:bearing(a,b)});t+=step}carry=t-d}
  return out}

/* ---------- A → B drives ---------- */
/* Cumulative distance (m) at each vertex of a path. */
function cumDist(g){const c=[0];for(let i=1;i<g.length;i++)c.push(c[i-1]+hav(g[i-1],g[i]));return c}
/* Closest point on the path to ll: {i (segment), along (m from start), off (m from path)}. hint = last segment index, searched first. */
function projectOnPath(g,cum,ll,hint,only){let best=null;
  const scan=(a,b)=>{for(let i=Math.max(0,a);i<Math.min(g.length-1,b);i++){const p=g[i],q=g[i+1],k=Math.cos(ll[0]*RAD),
      ax=(p[1]-ll[1])*k,ay=p[0]-ll[0],bx=(q[1]-ll[1])*k,by=q[0]-ll[0],dx=bx-ax,dy=by-ay,L2=dx*dx+dy*dy,t=L2?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/L2)):0,
      off=Math.hypot(ax+t*dx,ay+t*dy)*111320;if(!best||off<best.off)best={i,off,along:cum[i]+t*(cum[i+1]-cum[i])}}};
  if(only!=null){scan(only,only+1);return best}
  if(hint!=null){scan(hint-3,hint+60);if(best&&best.off<40)return best}
  scan(0,g.length);return best}
const ORD=n=>n+(['th','st','nd','rd'][(n%100>10&&n%100<14)?0:Math.min(n%10,4)%4]||'th');
/* Spoken/display text for an OSRM maneuver. */
function instruction(st){const m=st.modifier||'',onto=st.name?` onto ${st.name}`:'',side=m.includes('left')?'left':'right';
  switch(st.type){
    case 'turn':case 'end of road':return m==='uturn'?'Make a U-turn':m==='straight'?`Continue straight${onto}`:`Turn ${m}${onto}`;
    case 'fork':return `Keep ${side}${onto}`;
    case 'merge':return `Merge${st.name?' onto '+st.name:' onto the highway'}`;
    case 'on ramp':return `Take the ramp on the ${side}${onto}`;
    case 'off ramp':return `Take the exit on the ${side}${st.name?' toward '+st.name:''}`;
    case 'roundabout':case 'rotary':case 'roundabout turn':return `At the roundabout, take the ${ORD(st.exit||1)} exit${onto}`;
    case 'arrive':return 'You have arrived';
    default:return st.name?`Continue onto ${st.name}`:'Continue'}}
const NAV_TYPES=new Set(['turn','end of road','fork','merge','on ramp','off ramp','roundabout','rotary','roundabout turn','arrive']);
const navIcon=st=>{const m=st.modifier||'';if(st.type==='arrive')return '◎';if(/roundabout|rotary/.test(st.type))return '⟳';if(m==='uturn')return '↶';
  if(m.includes('left'))return m.includes('slight')?'↖':'↰';if(m.includes('right'))return m.includes('slight')?'↗':'↱';return '↑'};
/* Maneuvers to announce, with their distance along the path. */
function maneuvers(steps,g,cum){let lastI=0;return steps.filter(st=>NAV_TYPES.has(st.type)&&!(st.type==='turn'&&st.modifier==='straight'))
  .map(st=>{const ps=pathPasses(g,cum,st.loc),p=ps.find(x=>x.i>=lastI-1)||ps[ps.length-1]||projectOnPath(g,cum,st.loc);lastI=p.i;
    return {along:p.along,ll:st.loc,text:instruction(st),icon:navIcon(st)}})}

const SPOTS={
  stop:['Stop sign','Full stop behind the line, count 2, look left, right, left.'],
  allway:['4-way stop','First to stop goes first. Arrive together: yield to the right.'],
  signals:['Traffic lights','Cover the brake on a stale green. Stop on amber if you safely can.'],
  left:['Left turn','Signal early, check oncoming, turn into the nearest lane.'],
  right:['Right turn','Signal, slow before the turn, watch for bikes and people, stay close to the curb.'],
  uturn:['U-turn','Only where allowed. Signal, check all around, one smooth turn.'],
  roundabout:['Roundabout','Slow early, pick the lane, yield to traffic inside, signal right before the exit.'],
  merge:['Highway merge','Get up to speed on the ramp, signal, shoulder check, find the gap.'],
  exit:['Highway exit','Signal early, move into the exit lane, slow down on the ramp, not the highway.'],
  play:['Playground zone','30 km/h, 7:30 a.m. to 9 p.m. Watch between parked cars.'],
  dest:['Destination','Park safely at the curb or in a stall.'],
  park:['Parking practice','Parallel park within 30 cm of the curb, then a hill park and a three-point turn.']};
const CONTROL={stop:'a stop sign',allway:'a 4-way stop',signals:'lights'};
/* What the voice says to the driver as a spot comes up (tips stay on screen for the supervisor). */
const SAY={stop:'Stop sign ahead. Full stop at the line.',allway:'Four-way stop ahead.',signals:'Traffic lights ahead.',play:'Playground zone. Slow to 30.',park:'Parking practice coming up.',
  left:'Left turn ahead.',right:'Right turn ahead.',uturn:'U-turn ahead.',roundabout:'Roundabout ahead.',merge:'Highway merge ahead.',exit:'Highway exit ahead.',dest:'You have arrived.'};
/* Turn a planned drive into checkpoints, in driving order.
   nav = {g, steps:[{type,modifier,exit,name,loc}], nodes:[OSM node ids on the route]}; els = OSM elements near the path. */
/* Every time the path passes within maxOff metres of ll: the closest point of each pass, in driving order.
   A road driven out and back gives two passes, so a spot can be placed on the pass it really belongs to. */
function pathPasses(g,cum,ll,maxOff=30){const out=[];let run=null;
  for(let i=0;i<g.length-1;i++){const p=projectOnPath(g,cum,ll,null,i);
    if(p.off<=maxOff){if(!run||p.off<run.off)run=p}else if(run){out.push(run);run=null}}
  if(run)out.push(run);return out}
function planDrive(nav,els,mkId=uid){
  const g=nav.g,cum=cumDist(g),nodes=(nav.nodes||[]).map(String),onRoute=new Set(nodes),items=[];
  const pick=(ll,want)=>{const ps=pathPasses(g,cum,ll);if(!ps.length)return projectOnPath(g,cum,ll);
    if(want==null)return ps[0];return ps.reduce((a,b)=>Math.abs(b.i-want)<Math.abs(a.i-want)?b:a)};
  let lastI=0;   // turns come from the router in driving order: each one is placed after the previous
  nav.steps.forEach((st,i)=>{if(i===0||st.type==='depart'||st.type==='arrive')return;const m=st.modifier||'';let k=null;
    if(/roundabout|rotary/.test(st.type)&&st.type!=='exit roundabout')k='roundabout';
    else if(st.type==='merge'||st.type==='on ramp')k='merge';else if(st.type==='off ramp')k='exit';
    else if(st.type==='turn'||st.type==='end of road'){if(m==='uturn')k='uturn';else if(m==='left'||m==='sharp left')k='left';else if(m==='right'||m==='sharp right')k='right'}
    if(!k)return;const ps=pathPasses(g,cum,st.loc),p=ps.find(x=>x.i>=lastI-1)||ps[ps.length-1]||projectOnPath(g,cum,st.loc);lastI=p.i;
    items.push({k,ll:st.loc,street:st.name||'',along:p.along})});
  for(const e of els){const t=e.tags||{};if(e.type!=='node')continue;const ll=[e.lat,e.lon];
    if((t.highway==='stop'||t.highway==='traffic_signals')&&(onRoute.has(String(e.id))||t.user&&(projectOnPath(g,cum,ll)||{}).off<=15)){
      const ni=nodes.indexOf(String(e.id)),p=pick(ll,ni>=0&&nodes.length>1?ni/(nodes.length-1)*(g.length-1):null);items.push({k:t.highway==='traffic_signals'?'signals':t.stop==='all'?'allway':'stop',ll,street:'',along:p.along})}
    else if(t.leisure==='playground'){const ps=pathPasses(g,cum,ll,100),p=ps[0];if(p)items.push({k:'play',ll:g[p.i],street:'',along:p.along})}}
  items.sort((a,b)=>a.along-b.along);
  // merge spots at the same place: a turn plus the stop/lights it happens at becomes one checkpoint
  const out=[];for(const it of items){const prev=out[out.length-1];
    if(prev&&it.along-prev.along<45){const ctl=CONTROL[it.k]?it:CONTROL[prev.k]?prev:null,turn=['left','right','uturn'].includes(it.k)?it:['left','right','uturn'].includes(prev.k)?prev:null;
      if(ctl&&turn&&ctl!==turn){const ck=ctl.k,cl=ctl.ll,tk=turn.k,tl=turn.ll,ts=turn.street;prev.k=tk;prev.ctl=ck;prev.ctlAt=cl;prev.ll=tl;prev.street=ts||prev.street}
      else if(it.k===prev.k||CONTROL[it.k]&&CONTROL[prev.k]){if(it.k==='allway')prev.k='allway'}
      else out.push(it);continue}
    out.push(it)}
  const cps=out.map(it=>{const [nm,tk]=SPOTS[it.k],ctl=it.ctl?SPOTS[it.ctl]:null;
    const name=(ctl?`${nm} at ${CONTROL[it.ctl]}`:nm)+(it.street?` · ${it.street}`:'');
    const kind=it.ctl||it.k,stopLL=(kind==='stop'||kind==='allway')?(it.ctl?it.ctlAt:it.ll):null;
    return {id:mkId(),name,task:ctl?`${ctl[1]} Then: ${tk.charAt(0).toLowerCase()+tk.slice(1)}`:tk,lat:+it.ll[0].toFixed(6),lng:+it.ll[1].toFixed(6),kind,
      ...(stopLL?{stopAt:[+stopLL[0].toFixed(6),+stopLL[1].toFixed(6)]}:{})}});
  const end=g[g.length-1];cps.push({id:mkId(),name:SPOTS.dest[0],task:SPOTS.dest[1],lat:+end[0].toFixed(6),lng:+end[1].toFixed(6),kind:'dest'});
  return cps}
const PLURAL={'Stop sign':'stop signs','4-way stop':'4-way stops','Traffic lights':'sets of lights','Left turn':'left turns','Right turn':'right turns','U-turn':'U-turns',
  'Roundabout':'roundabouts','Highway merge':'highway merges','Highway exit':'highway exits','Playground zone':'playground zones','Parking practice':'parking stops'};
function spotSummary(cps){const c={};cps.forEach(x=>{if(x.kind&&x.kind!=='dest'){const n=SPOTS[x.kind][0];c[n]=(c[n]||0)+1}});
  return Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,n])=>n===1?(k==='Traffic lights'?'1 set of lights':`1 ${k.toLowerCase()}`):`${n} ${PLURAL[k]}`).join(', ')}

/* Make street names sound right when read aloud: "Mahogany Blvd SE" → "Mahogany Boulevard South East". Only used for the voice. */
const QUAD={NE:'North East',NW:'North West',SE:'South East',SW:'South West',N:'North',S:'South',E:'East',W:'West'};
const ABBR={Blvd:'Boulevard',Bv:'Boulevard',Ave:'Avenue',Av:'Avenue',St:'Street',Dr:'Drive',Rd:'Road',Cres:'Crescent',Cr:'Crescent',Tr:'Trail',Trl:'Trail',
  Hwy:'Highway',Pkwy:'Parkway',Pl:'Place',Ct:'Court',Cir:'Circle',Ln:'Lane',Gdns:'Gardens',Gt:'Gate',Hts:'Heights',Mews:'Mews',Pt:'Point',Rdg:'Ridge',Terr:'Terrace',Way:'Way',Sq:'Square',Lk:'Lake',Pk:'Park',Mt:'Mount',Ft:'Fort'};
function speakable(t){if(!t)return t;
  t=t.replace(/\b([NS])\.\s?([EW])\.?(?=[\s,.;]|$)/g,'$1$2');                                   // N.E. → NE
  t=t.replace(/\bSt\.?\s+(?=[A-Z][a-z])/g,'Saint ');                                           // St Albert → Saint Albert (Main St SE stays Street below)
  t=t.replace(/\b(NE|NW|SE|SW)\b/g,m=>QUAD[m]);
  t=t.replace(/\b(Street|Avenue|Trail|Road|Drive|Boulevard|Way|Gate|Crescent|Highway|St|Ave|Tr|Rd|Dr|Blvd)\.?\s+([NSEW])\b(?!['’])/g,(m,a,b)=>a+' '+QUAD[b]);
  t=t.replace(/\b([A-Z][a-z]{1,4})\.?(?=\s|$|,|\.)/g,(m,w)=>ABBR[w]&&w!=='Way'&&w!=='Mews'?ABBR[w]:m);
  t=t.replace(/\b(Queen Elizabeth) II\b/g,'$1 the Second').replace(/\bQE ?II\b|\bQE2\b/g,'Q E 2');
  return t}

/* ---------- automatic coaching checks ---------- */
/* Rolling stop: feed distance to the stop line (m) and raw GPS speed (km/h) on every fix.
   Returns 'ok' or 'rolled' once, after the car has reached the line and driven 40 m past it; otherwise null. */
const STOP_OK_KMH=6;
function stopCheck(st,d,kmh){if(st.done)return null;
  if(d<=30&&kmh!=null)st.min=Math.min(st.min??Infinity,kmh);
  if(d<=15)st.near=true;
  if(st.near&&d>40){st.done=true;return (st.min??Infinity)<=STOP_OK_KMH?'ok':'rolled'}
  return null}
/* Hard braking from two raw GPS speed readings: losing 3.5+ m/s every second (about a third of g) from 20+ km/h. */
function hardBrake(prev,cur){if(!prev||prev.kmh==null||cur.kmh==null)return false;const dt=(cur.t-prev.t)/1000;
  if(dt<0.8||dt>3||prev.kmh<20)return false;return (prev.kmh-cur.kmh)/3.6/dt>=3.5}

/* Problem spots: the same mistake at the same place (within 40 m) in 2+ different lessons. */
function problemSpots(sessions,minLessons=2){const groups=[];
  for(const s of sessions)for(const f of (s.flags||[])){if(!f.ll||(D.FLAGS[f.label]||{}).good)continue;
    const g=groups.find(x=>x.label===f.label&&hav(x.ll,f.ll)<=40);
    if(g){g.pts.push(f.ll);g.ses.add(s.id);g.ll=[g.pts.reduce((a,p)=>a+p[0],0)/g.pts.length,g.pts.reduce((a,p)=>a+p[1],0)/g.pts.length]}
    else groups.push({label:f.label,ll:f.ll,pts:[f.ll],ses:new Set([s.id])})}
  return groups.filter(g=>g.ses.size>=minLessons).map(g=>({label:g.label,ll:[+g.ll[0].toFixed(6),+g.ll[1].toFixed(6)],count:g.pts.length,lessons:g.ses.size}))
    .sort((a,b)=>b.lessons-a.lessons||b.count-a.count)}
const HEADS_UP={'Hard brake':'brake early here','Late signal':'signal early here','Missed shoulder check':'shoulder check here','Too fast':'watch your speed here',
  'Rolled the stop':'full stop here','Wide turn':'keep the turn tight here','Drifting in lane':'stay centred in your lane here'};

/* ---------- practice loops ---------- */
/* How much each kind of spot is worth practising, from the skill board (weaker skill = higher weight). */
const LOOP_SKILLS={round:['round'],signals:['amber','unprot','lturn'],stop:['stops','fourway'],play:['zones','speed'],ramp:['merge','exit']};
function focusWeights(skills,mode){if(mode==='test')return {stop:3,signals:3,play:3,round:2,ramp:0};
  const w={};for(const [k,ks] of Object.entries(LOOP_SKILLS))w[k]=1+ks.reduce((a,x)=>a+(3-(skills[x]||0)),0)/ks.length;return w}
/* Pick n spots around start to visit as a loop: about r metres out, spread around the compass, weighted by w. rnd = random 0..1 source. */
function pickLoopTargets(cands,start,r,w,n,rnd=Math.random){
  const pool=cands.filter(c=>(w[c.kind]||0)>0).map(c=>{const d=hav(start,c.ll);return {...c,d,b:bearing(start,c.ll)}}).filter(c=>c.d>=0.35*r&&c.d<=1.6*r);
  const picked=[],gap=300/(n+1);
  for(let i=0;i<n;i++){let best=null,bs=-1e9;
    for(const c of pool){if(picked.includes(c)||picked.some(p=>hav(p.ll,c.ll)<250||angDiff(p.b,c.b)<gap))continue;
      const sc=(w[c.kind]||0)*(picked.some(p=>p.kind===c.kind)?0.6:1)-Math.abs(c.d-r)/r+rnd()*0.8;if(sc>bs){bs=sc;best=c}}
    if(best)picked.push(best)}
  return picked.sort((a,b)=>a.b-b.b)}

/* ---------- GPS gaps ---------- */
/* Split a track into drawable pieces at the recorded break indexes (where tracking paused). */
function trackSegments(track,breaks){if(!track||!track.length)return [];const bs=[...(breaks||[])].sort((a,b)=>a-b),out=[];let s=0;
  for(const b of bs){if(b>s&&b<track.length){out.push(track.slice(s,b));s=b}}out.push(track.slice(s));return out.filter(x=>x.length)}

/* Places where a path doubles back on itself (a U-turn): heading flips by 150°+ within ~30 m. */
function uTurns(g){const out=[];if(!g||g.length<3)return out;
  for(let i=1;i<g.length-1;i++){let a=i-1,b=i+1;while(a>0&&hav(g[a],g[i])<12)a--;while(b<g.length-1&&hav(g[i],g[b])<12)b++;
    if(hav(g[a],g[i])<4||hav(g[i],g[b])<4)continue;
    if(angDiff(bearing(g[a],g[i]),bearing(g[i],g[b]))>=150&&!out.some(o=>hav(o.ll,g[i])<40))out.push({i,ll:g[i]})}
  return out}

/* Which points of a path sit on a stretch that the path also drives the other way (out and back on the same road).
   Uses a coarse grid so long routes stay fast. */
function overlapMask(g,near=15){const n=g.length,mask=new Array(n).fill(false);if(n<4)return mask;
  const C=0.0003,cell=p=>Math.floor(p[0]/C)+'_'+Math.floor(p[1]/C),grid=new Map(),seg=[];
  for(let i=0;i<n-1;i++){const m=[(g[i][0]+g[i+1][0])/2,(g[i][1]+g[i+1][1])/2];seg.push({m,b:bearing(g[i],g[i+1]),len:hav(g[i],g[i+1])});
    const k=cell(m);(grid.get(k)||grid.set(k,[]).get(k)).push(i)}
  for(let i=0;i<n-1;i++){if(seg[i].len<1)continue;const [a,b]=[Math.floor(seg[i].m[0]/C),Math.floor(seg[i].m[1]/C)];
    for(let da=-1;da<=1&&!mask[i+1];da++)for(let db=-1;db<=1;db++){for(const j of grid.get((a+da)+'_'+(b+db))||[]){
      if(Math.abs(i-j)<3||seg[j].len<1)continue;if(angDiff(seg[i].b,seg[j].b)>150&&hav(seg[i].m,seg[j].m)<=near){mask[i]=mask[i+1]=true;break}}}}
  return mask}
/* Shift points (screen pixels [x,y]) sideways to the right of travel by mags[i] px; Canada drives on the right. */
function offsetPoints(pts,mags){return pts.map((p,i)=>{const m=mags[i];if(!m)return p;
  const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];let dx=b[0]-a[0],dy=b[1]-a[1];const L2=Math.hypot(dx,dy)||1;dx/=L2;dy/=L2;
  return [p[0]-dy*m,p[1]+dx*m]})}

const API={drillList,trackable,uid,esc,hav,bearing,angDiff,fmtDur,fmtDist,stageNum,median,GPS,acceptFix,smoothSpeed,thinTrack,placedCps,arrivals,nextTarget,skippedCps,
  skillPct,hours,badFlags,mistakeSeries,topMistakes,suggestNext,curfew,testEligibleFrom,parseMaxspeed,inBox,segDist,limitAt,
  overlapMask,offsetPoints,uTurns,roadAt,stickyLimit,isOneway,playZoneRoad,SAY,speakable,stopCheck,hardBrake,problemSpots,HEADS_UP,focusWeights,pickLoopTargets,trackSegments,LOOP_SKILLS,pathArrows,cumDist,projectOnPath,instruction,maneuvers,planDrive,spotSummary,SPOTS,polyArea,cluster,carLot,parseFeatures,rankLots,lotPins,walkRamp,buildStage};
if(typeof module!=='undefined')module.exports=API;else Object.assign(root,API);
})(typeof window!=='undefined'?window:globalThis);
