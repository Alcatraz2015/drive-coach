// Run: node --test tests/*.test.js
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../js/logic.js'),D=require('../js/data.js');
const at=(lat,lng)=>[lat,lng];
const cp=(id,lat,lng)=>({id,name:id,task:'',lat,lng});

test('distance and formatting',()=>{
  assert.ok(Math.abs(L.hav(at(51,-114),at(51.001,-114))-111)<1);
  assert.equal(L.fmtDur(3725000),'1:02:05');
  assert.equal(L.fmtDist(234),'230 m');assert.equal(L.fmtDist(1530),'1.5 km');
  assert.equal(L.esc('<a href="x">'),'&lt;a href=&quot;x&quot;&gt;');
});

test('GPS filter drops inaccurate fixes, teleports and jitter',()=>{
  const prev={ll:at(51,-114),t:0};
  assert.equal(L.acceptFix(prev,{ll:at(51.0005,-114),t:5000,acc:60}).ok,false);          // 60 m accuracy
  assert.equal(L.acceptFix(prev,{ll:at(51.02,-114),t:5000,acc:8}).why,'jump');           // 2.2 km in 5 s
  assert.equal(L.acceptFix(prev,{ll:at(51.00001,-114),t:5000,acc:8}).why,'still');       // 1 m
  const ok=L.acceptFix(prev,{ll:at(51.0005,-114),t:5000,acc:8});assert.ok(ok.ok&&ok.dist>50);
});

test('speed smoothing ignores a single spike',()=>{
  const b=[];[48,50,190,49].forEach(v=>L.smoothSpeed(b,v));          // 190 rejected outright
  assert.ok(L.smoothSpeed(b,51)<=51);
  const c=[];[40,41,120].forEach(v=>L.smoothSpeed(c,v));assert.equal(L.smoothSpeed(c,null),41); // median of 40,41,120
});

test('checkpoints count in any order and skipped ones are reported',()=>{
  const cps=[cp('a',51,-114),cp('b',51.01,-114),cp('c',51.02,-114),{id:'u',lat:null,lng:null}];
  assert.equal(L.nextTarget(cps,[]).id,'a');
  assert.deepEqual(L.arrivals(cps,[],at(51.02,-114),35).map(c=>c.id),['c']);
  assert.equal(L.nextTarget(cps,['c']).id,'a');                       // nothing after c, so back to first undone
  assert.deepEqual(L.skippedCps(cps,['c']).map(c=>c.id),['a','b']);
  assert.equal(L.nextTarget(cps,['a']).id,'b');
  assert.equal(L.nextTarget(cps,['a','b','c']),null);
});

test('suggested next lesson starts at stage 1 and moves on when skills are solid',()=>{
  const routes=D.TEMPLATES.map((t,i)=>({id:'r'+(i+1),name:t.name,stage:t.stage}));
  assert.equal(L.suggestNext(routes,[],{}).stage,1);
  const skills={};D.STAGE_SKILLS[1].forEach(k=>skills[k]=2);
  const ss=[{routeId:'r1',stage:'Stage 1'},{routeId:'r1',stage:'Stage 1'}];
  const s=L.suggestNext(routes,ss,skills);assert.equal(s.stage,2);assert.match(s.why,/No lessons/);
});

test('mistake trend and top mistakes',()=>{
  const h=3.6e6,now=Date.now();
  const ss=[{id:1,start:now-2*h,end:now-h,flags:[{label:'Too fast'},{label:'Too fast'},{label:'Nice job'}]},
            {id:2,start:now-60e3,end:now,flags:[{label:'Too fast'}]}];              // 1 minute: too short for the trend
  const ser=L.mistakeSeries(ss);assert.equal(ser.length,1);assert.equal(ser[0].v,2);
  assert.deepEqual(L.topMistakes(ss,30*864e5,now)[0],['Too fast',3]);
});

test('Alberta rules: curfew and road test eligibility',()=>{
  assert.equal(L.curfew(new Date('2026-10-15T00:30')),true);
  assert.equal(L.curfew(new Date('2026-10-15T05:00')),false);
  assert.equal(L.testEligibleFrom('2026-01-10').toISOString().slice(0,10),'2027-01-10');
});

test('speed limits from OSM tags, with Calgary residential default',()=>{
  assert.equal(L.parseMaxspeed('50'),50);assert.equal(L.parseMaxspeed('30 mph'),48);assert.equal(L.parseMaxspeed('CA:urban'),50);
  const ways=[{tags:{highway:'residential'},g:[at(51.05,-114.07),at(51.05,-114.06)]},
              {tags:{highway:'primary',maxspeed:'60',name:'Big Rd'},g:[at(51.06,-114.07),at(51.06,-114.06)]}];
  assert.deepEqual(L.limitAt(ways,at(51.0501,-114.065),90),{kmh:40,assumed:true,road:''});
  assert.equal(L.limitAt(ways,at(51.0601,-114.065),90).kmh,60);
  assert.equal(L.limitAt(ways,at(51.055,-114.065),90),null);           // 500 m from either road
});

test('car lot filter rejects RV and truck parking',()=>{
  assert.equal(L.carLot({name:'Mahogany RV Parking'}),false);
  assert.equal(L.carLot({hgv:'designated'}),false);
  assert.equal(L.carLot({access:'private'}),false);
  assert.equal(L.carLot({name:'Shopping Centre'}),true);
});

test('auto-build places a full stage 2 route from features',()=>{
  const s=at(51.05,-114.07),els=[];let id=1;
  for(let i=0;i<8;i++)els.push({type:'node',id:id++,lat:51.05+0.003*(i+1),lon:-114.07,tags:{highway:'stop',stop:i===5?'all':undefined}});
  els.push({type:'node',id:id++,lat:51.051,lon:-114.072,tags:{leisure:'playground'}});
  const cps=L.buildStage(2,L.parseFeatures(els),s,null);
  assert.equal(cps.length,6);assert.ok(cps.every(c=>c.lat!=null));
});

test('direction arrows follow the path heading',()=>{
  const g=[[51,-114],[51.01,-114],[51.01,-113.98]];                    // north 1.1 km, then east 1.4 km
  const a=L.pathArrows(g,500);
  assert.ok(a.length>=4);assert.ok(Math.abs(a[0].deg-0)<1);assert.ok(Math.abs(a[a.length-1].deg-90)<2);
});
test('lot pins are marked so they are not moved onto roads',()=>{
  const lot={ll:[51,-114],g:[[51,-114],[51.001,-114],[51.001,-113.998],[51,-113.998]],area:20000};
  assert.ok(L.buildStage(1,{lot:[]},[51.01,-114],lot).every(c=>c.onLot));
});

test('A to B: turns, controls on the route only, playgrounds, destination, in order',()=>{
  const g=[[51,-114],[51.005,-114],[51.005,-113.99],[51.010,-113.99]];
  const steps=[{type:'depart',loc:g[0]},{type:'turn',modifier:'right',name:'Mahogany Blvd SE',loc:g[1]},{type:'turn',modifier:'left',name:'Mahogany Dr SE',loc:g[2]},{type:'arrive',loc:g[3]}];
  const els=[{type:'node',id:7,lat:51.0049,lon:-114,tags:{highway:'traffic_signals'}},
             {type:'node',id:8,lat:51.0049,lon:-114.0001,tags:{highway:'stop'}},          // side-street stop, not on the route
             {type:'node',id:9,lat:51.0051,lon:-113.995,tags:{highway:'stop'}},
             {type:'node',id:10,lat:51.0052,lon:-113.996,tags:{leisure:'playground'}}];
  const cps=L.planDrive({g,steps,nodes:[7,9]},els);
  assert.deepEqual(cps.map(c=>c.kind),['signals','play','stop','left','dest']);
  assert.equal(cps[0].name,'Right turn at lights · Mahogany Blvd SE');
  assert.equal(L.spotSummary(cps),'1 set of lights, 1 playground zone, 1 stop sign, 1 left turn');
  const m=L.maneuvers(steps,g,L.cumDist(g));
  assert.equal(m[0].text,'Turn right onto Mahogany Blvd SE');assert.ok(m[1].along>m[0].along);
  assert.equal(L.instruction({type:'roundabout',exit:2,name:'Seton Blvd'}),'At the roundabout, take the 2nd exit onto Seton Blvd');
  const p=L.projectOnPath(g,L.cumDist(g),[51.0025,-114.0007]);assert.ok(p.off>40&&p.off<60&&p.i===0);
});

test('playground zones only count on ordinary streets',()=>{
  assert.equal(L.playZoneRoad({highway:'residential'}),true);
  assert.equal(L.playZoneRoad({highway:'primary',maxspeed:'50'}),true);
  assert.equal(L.playZoneRoad({highway:'motorway'}),false);
  assert.equal(L.playZoneRoad({highway:'trunk',maxspeed:'100'}),false);
  assert.equal(L.playZoneRoad({highway:'primary',maxspeed:'80'}),false);
  assert.equal(L.playZoneRoad({highway:'motorway_link'}),false);
  assert.equal(L.playZoneRoad(undefined),false);
});
test('voice lines talk to the driver, not about her',()=>{
  Object.values(L.SAY).forEach(t=>assert.ok(!/\bshe\b|\bher\b/i.test(t),t));
});

test('street names are read out in full',()=>{
  const cases={'Turn left onto Mahogany Blvd SE.':'Turn left onto Mahogany Boulevard South East.',
    'Turn right onto Silver Springs Gate NW':'Turn right onto Silver Springs Gate North West',
    'Turn right onto Edmonton Trail N.E.':'Turn right onto Edmonton Trail North East',
    'Turn right onto St Albert Trail':'Turn right onto Saint Albert Trail',
    'Turn left onto Main St SE':'Turn left onto Main Street South East',
    'Turn left onto 16 Ave N':'Turn left onto 16 Avenue North',
    'Merge onto Queen Elizabeth II Highway.':'Merge onto Queen Elizabeth the Second Highway.',
    'East Lake Cres NE':'East Lake Crescent North East','Speed limit 50.':'Speed limit 50.','Stop sign ahead. Full stop at the line.':'Stop sign ahead. Full stop at the line.'};
  for(const [a,b] of Object.entries(cases))assert.equal(L.speakable(a),b);
});

test('rolling stop vs full stop',()=>{
  const run=samples=>{const st={};let v=null;for(const [d,k] of samples){const r=L.stopCheck(st,d,k);if(r)v=r}return v};
  assert.equal(run([[60,40],[30,25],[15,12],[5,9],[20,15],[45,25]]),'rolled');   // never below 9 km/h
  assert.equal(run([[60,40],[30,20],[10,3],[2,0],[20,12],[45,25]]),'ok');
  assert.equal(run([[60,40],[35,30],[25,20],[50,30]]),null);                     // never reached the line (turned off)
});
test('hard braking from GPS speed',()=>{
  assert.equal(L.hardBrake({t:0,kmh:50},{t:1000,kmh:35}),true);                  // -4.2 m/s²
  assert.equal(L.hardBrake({t:0,kmh:50},{t:1000,kmh:42}),false);                 // -2.2 m/s², normal
  assert.equal(L.hardBrake({t:0,kmh:15},{t:1000,kmh:0}),false);                  // too slow to count
  assert.equal(L.hardBrake({t:0,kmh:60},{t:6000,kmh:0}),false);                  // readings too far apart
});
test('problem spots need the same mistake at the same place in 2+ lessons',()=>{
  const a=[51,-114],b=[51.0002,-114.0001],far=[51.01,-114];
  const ss=[{id:1,flags:[{label:'Rolled the stop',ll:a},{label:'Too fast',ll:far}]},{id:2,flags:[{label:'Rolled the stop',ll:b},{label:'Nice job',ll:a}]},{id:3,flags:[{label:'Rolled the stop',ll:far}]}];
  const ps=L.problemSpots(ss);assert.equal(ps.length,1);assert.equal(ps[0].label,'Rolled the stop');assert.equal(ps[0].lessons,2);
});
test('loop targets spread around the start and favour weak skills',()=>{
  const start=[51,-114],c=[];
  for(let i=0;i<24;i++){const ang=i*15*Math.PI/180;c.push({kind:i%3===0?'round':i%3===1?'stop':'signals',ll:[51+0.011*Math.cos(ang),-114+0.017*Math.sin(ang)]})}
  const w=L.focusWeights({round:0,stops:3,fourway:3,amber:3,unprot:3,lturn:3});
  assert.ok(w.round>w.stop&&w.round>w.signals);
  const t=L.pickLoopTargets(c,start,1200,w,4,()=>0.5);
  assert.equal(t.length,4);assert.ok(t.filter(x=>x.kind==='round').length>=2);
  for(let i=1;i<t.length;i++)assert.ok(t[i].b>=t[i-1].b);
});
test('track splits at GPS gaps',()=>{
  assert.deepEqual(L.trackSegments([[1,1],[2,2],[3,3],[4,4]],[2]),[[[1,1],[2,2]],[[3,3],[4,4]]]);
  assert.deepEqual(L.trackSegments([[1,1]],[]),[[[1,1]]]);
});
test('A to B stop checkpoints keep the stop line position',()=>{
  const g=[[51,-114],[51.005,-114],[51.005,-113.99]];
  const steps=[{type:'depart',loc:g[0]},{type:'turn',modifier:'right',name:'X',loc:g[1]},{type:'arrive',loc:g[2]}];
  const cps=L.planDrive({g,steps,nodes:[5]},[{type:'node',id:5,lat:51.0049,lon:-114,tags:{highway:'stop'}}]);
  assert.equal(cps[0].kind,'stop');assert.deepEqual(cps[0].stopAt,[51.0049,-114]);
});

test('turnarounds are found where a path doubles back',()=>{
  const out=[[51,-114],[51.001,-114],[51.002,-114],[51.001,-114.00005],[51,-114.00005]];           // north 220 m, then straight back
  assert.equal(L.uTurns(out).length,1);
  const corner=[[51,-114],[51.002,-114],[51.002,-113.997]];                                         // a normal right-angle turn
  assert.equal(L.uTurns(corner).length,0);
});

test('no "she" or "her" anywhere in the app text',()=>{
  const fs=require('fs'),path=require('path');
  for(const f of ['js/data.js','js/app.js','js/logic.js','js/report.js','index.html']){
    const t=fs.readFileSync(path.join(__dirname,'..',f),'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,'');
    const m=t.match(/\b(she|her|hers|herself)\b/i);assert.equal(m,null,`${f}: "${m&&t.slice(Math.max(0,m.index-30),m.index+30)}"`)}
});
test('user-added stop signs count when the route passes within 15 m',()=>{
  const g=[[51,-114],[51.005,-114],[51.005,-113.99]];
  const steps=[{type:'depart',loc:g[0]},{type:'arrive',loc:g[2]}];
  const els=[{type:'node',id:'u1',lat:51.0025,lon:-114.0001,tags:{highway:'stop',user:true}},{type:'node',id:'u2',lat:51.0025,lon:-114.003,tags:{highway:'stop',user:true}}];
  const cps=L.planDrive({g,steps,nodes:[]},els);assert.equal(cps.filter(c=>c.kind==='stop').length,1);
});

test('speed limit: the other carriageway and ramps beside the highway are ignored',()=>{
  // Two one-way carriageways 20 m apart (northbound 110, southbound 100) plus a northbound ramp at 60
  const nb={tags:{highway:'motorway',maxspeed:'110',oneway:'yes'},g:[[51,-114],[51.02,-114]]};
  const sb={tags:{highway:'motorway',maxspeed:'100',oneway:'yes'},g:[[51.02,-114.0003],[51,-114.0003]]};
  const ramp={tags:{highway:'motorway_link',maxspeed:'60'},g:[[51,-113.99985],[51.02,-113.99985]]};
  const here=[51.01,-114.0002];                                         // GPS drifted closer to the southbound lanes
  assert.equal(L.limitAt([nb,sb,ramp],here,0,105).kmh,110);
  assert.equal(L.limitAt([nb,sb,ramp],here,180,105).kmh,100);
});
test('speed limit sign only changes after 3 fixes agree',()=>{
  const st={},a={kmh:110},b={kmh:100};
  assert.equal(L.stickyLimit(st,a).kmh,110);
  assert.equal(L.stickyLimit(st,b).kmh,110);assert.equal(L.stickyLimit(st,a).kmh,110);   // one stray reading
  L.stickyLimit(st,b);L.stickyLimit(st,b);assert.equal(L.stickyLimit(st,b).kmh,100);
});
