// Run: node --test tests/
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
