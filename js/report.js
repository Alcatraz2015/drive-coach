/* Drive Coach: lesson report drawn on a canvas, shared as PNG or PDF. Uses globals from app.js (S, prof, pane, toast). */
let reportView=null; const reportCache={};
const RC={bg:'#F6F8F6',ink:'#14211A',muted:'#5B6B61',line:'#D5DED7',sign:'#0E6B3F',caution:'#E8A900',stop:'#C8102E',ok:'#1F8A4C',track:'#2F7DE1',panel:'#FFFFFF'};
const fnt=(w,s,f)=>`${w} ${s}px ${f==='d'?'Overpass, Arial Narrow, sans-serif':f==='m'?'"Overpass Mono", Menlo, monospace':'"Atkinson Hyperlegible", Arial, sans-serif'}`;
function loadImg(src){return new Promise((res,rej)=>{const i=new Image();i.crossOrigin='anonymous';i.onload=()=>res(i);i.onerror=rej;i.src=src})}
function wpx(ll,z){const n=256*2**z,s=Math.sin(ll[0]*Math.PI/180);return[(ll[1]+180)/360*n,(0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n]}
function wrap(ctx,text,x,y,maxW,lh){const words=String(text).split(/\s+/);let line='';
  for(const w of words){const t=line?line+' '+w:w;if(ctx.measureText(t).width>maxW&&line){ctx.fillText(line,x,y);y+=lh;line=w}else line=t}
  if(line){ctx.fillText(line,x,y);y+=lh}return y}
function rrect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):ctx.rect(x,y,w,h)}
function pinDot(ctx,x,y,label,fill,ink,r=17){ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fillStyle=fill;ctx.fill();ctx.lineWidth=4;ctx.strokeStyle='#fff';ctx.stroke();
  ctx.fillStyle=ink;ctx.font=fnt(700,16,'m');ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x,y+1);ctx.textAlign='left';ctx.textBaseline='alphabetic'}

async function buildReport(s,tilesOn=true){
  try{await document.fonts?.ready}catch(e){}
  const W=1080,P=48,cv=document.createElement('canvas');cv.width=W;cv.height=4200;const c=cv.getContext('2d');
  c.fillStyle=RC.bg;c.fillRect(0,0,W,cv.height);
  const cps=s.cps||[], flags=(s.flags||[]).map((f,i)=>({...f,i:i+1})), bad=flags.filter(f=>!FLAGS[f.label]?.good), good=flags.filter(f=>FLAGS[f.label]?.good);
  // header
  c.fillStyle=RC.sign;c.fillRect(0,0,W,210);c.strokeStyle='#fff';c.lineWidth=4;rrect(c,14,14,W-28,182,14);c.stroke();
  c.fillStyle='#fff';c.font=fnt(800,20,'d');c.fillText(('DRIVE COACH · LESSON REPORT · '+(prof().name||'')).toUpperCase(),P,64);
  c.font=fnt(900,52,'d');c.fillText(s.routeName||'Lesson',P,128);
  const d=new Date(s.start);c.font=fnt(400,24,'b');
  c.fillText(`${d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'})} · ${d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`,P,172);
  let y=244;
  // stats
  const st=[[fmtDur(s.end-s.start),'TIME'],[s.km.toFixed(1)+' km','DISTANCE'],[s.maxKmh+' km/h','TOP SPEED'],[`${s.done}/${s.total}`,'CHECKPOINTS'],[FEEL[s.feel]||'—','FELT']];
  const bw=(W-2*P-4*12)/5;st.forEach(([v,k],i)=>{const x=P+i*(bw+12);c.fillStyle=RC.panel;rrect(c,x,y,bw,104,12);c.fill();c.strokeStyle=RC.line;c.lineWidth=2;c.stroke();
    c.fillStyle=RC.ink;c.font=fnt(700,30,'m');c.fillText(v,x+16,y+52);c.fillStyle=RC.muted;c.font=fnt(800,14,'d');c.fillText(k,x+16,y+84)});
  y+=136;
  // map
  const mx=P,my=y,mw=W-2*P,mh=640;
  c.save();rrect(c,mx,my,mw,mh,16);c.clip();c.fillStyle='#E9EEEA';c.fillRect(mx,my,mw,mh);
  const pts=[...(s.track||[]),...(s.plan||[]),...cps.map(p=>p.ll),...flags.map(f=>f.ll)].filter(Boolean);
  if(pts.length){
    let la0=Math.min(...pts.map(p=>p[0])),la1=Math.max(...pts.map(p=>p[0])),lo0=Math.min(...pts.map(p=>p[1])),lo1=Math.max(...pts.map(p=>p[1]));
    let z=17;for(;z>3;z--){const a=wpx([la1,lo0],z),b=wpx([la0,lo1],z);if(b[0]-a[0]<=mw-120&&b[1]-a[1]<=mh-120)break}
    const a=wpx([la1,lo0],z),b=wpx([la0,lo1],z),cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2,ox=cx-mw/2,oy=cy-mh/2;
    const toC=ll=>{const p=wpx(ll,z);return[mx+p[0]-ox,my+p[1]-oy]};
    if(tilesOn){const jobs=[];
      for(let tx=Math.floor(ox/256);tx<=Math.floor((ox+mw)/256);tx++)for(let ty=Math.floor(oy/256);ty<=Math.floor((oy+mh)/256);ty++){
        jobs.push(loadImg(`https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`).then(im=>c.drawImage(im,mx+tx*256-ox,my+ty*256-oy,256,256)).catch(()=>{}))}
      await Promise.all(jobs)}
    else{c.strokeStyle='#D9E1DB';c.lineWidth=1;for(let gx=mx;gx<mx+mw;gx+=60){c.beginPath();c.moveTo(gx,my);c.lineTo(gx,my+mh);c.stroke()}for(let gy=my;gy<my+mh;gy+=60){c.beginPath();c.moveTo(mx,gy);c.lineTo(mx+mw,gy);c.stroke()}}
    const plan=s.plan&&s.plan.length>1?s.plan:cps.length>1?cps.map(p=>p.ll):null;if(plan){c.setLineDash([10,10]);c.strokeStyle=RC.caution;c.lineWidth=4;c.beginPath();plan.forEach((p,i)=>{const q=toC(p);i?c.lineTo(...q):c.moveTo(...q)});c.stroke();c.setLineDash([])}
    if(s.track?.length>1){c.lineJoin=c.lineCap='round';c.strokeStyle='#fff';c.lineWidth=11;c.beginPath();s.track.forEach((p,i)=>{const q=toC(p);i?c.lineTo(...q):c.moveTo(...q)});c.stroke();
      c.strokeStyle=RC.track;c.lineWidth=6;c.stroke();const st0=toC(s.track[0]),en=toC(s.track[s.track.length-1]);
      pinDot(c,...st0,'S',RC.ink,'#fff',13);pinDot(c,...en,'F',RC.ink,'#fff',13)}
    cps.forEach(p=>pinDot(c,...toC(p.ll),p.n,p.done?RC.ok:RC.caution,p.done?'#fff':'#1D1600'));
    flags.forEach(f=>{const [x,y2]=toC(f.ll),g=FLAGS[f.label]?.good;c.fillStyle=g?RC.ok:RC.stop;rrect(c,x-15,y2-15,30,30,6);c.fill();c.lineWidth=3;c.strokeStyle='#fff';c.stroke();
      c.fillStyle='#fff';c.font=fnt(800,15,'m');c.textAlign='center';c.textBaseline='middle';c.fillText(g?'★':f.i,x,y2+1);c.textAlign='left';c.textBaseline='alphabetic'});
    if(tilesOn){c.fillStyle='rgba(255,255,255,.8)';c.fillRect(mx+mw-200,my+mh-26,200,26);c.fillStyle=RC.muted;c.font=fnt(400,13,'b');c.fillText('© OpenStreetMap contributors',mx+mw-190,my+mh-9)}
  }else{c.fillStyle=RC.muted;c.font=fnt(400,24,'b');c.textAlign='center';c.fillText('No GPS track was recorded for this lesson',W/2,my+mh/2);c.textAlign='left'}
  c.restore();c.strokeStyle=RC.line;c.lineWidth=2;rrect(c,mx,my,mw,mh,16);c.stroke();
  y=my+mh+30;
  // legend
  c.font=fnt(400,18,'b');let lx=P;
  [[RC.track,'Route driven'],[RC.ok,'Checkpoint reached'],[RC.caution,'Planned route / missed pin'],[RC.stop,'Mistake mark']].forEach(([col,t])=>{c.fillStyle=col;rrect(c,lx,y-14,18,18,4);c.fill();c.fillStyle=RC.muted;c.fillText(t,lx+26,y);lx+=c.measureText(t).width+60});
  y+=50;
  const H=t=>{c.fillStyle=RC.sign;c.font=fnt(900,30,'d');c.fillText(t,P,y);y+=14;c.fillStyle=RC.line;c.fillRect(P,y,W-2*P,3);y+=36};
  // mistakes
  H('Mistakes marked');
  const groups={};bad.forEach(f=>(groups[f.label]=groups[f.label]||[]).push(f));const gl=Object.entries(groups).sort((a,b)=>b[1].length-a[1].length);
  if(!gl.length){c.fillStyle=RC.ink;c.font=fnt(400,24,'b');c.fillText('No mistakes marked. Clean drive.',P,y);y+=40}
  const maxN=Math.max(1,...gl.map(g=>g[1].length));
  gl.forEach(([lab,arr])=>{c.fillStyle=RC.ink;c.font=fnt(700,24,'b');c.fillText(lab,P,y);c.font=fnt(700,24,'m');c.textAlign='right';c.fillText('×'+arr.length,W-P,y);c.textAlign='left';
    y+=14;c.fillStyle='#E3EAE4';rrect(c,P,y,W-2*P,12,6);c.fill();c.fillStyle=RC.stop;rrect(c,P,y,(W-2*P)*arr.length/maxN,12,6);c.fill();y+=34;
    c.fillStyle=RC.muted;c.font=fnt(400,18,'m');y=wrap(c,'Marks '+arr.map(f=>`#${f.i} at ${fmtDur((f.t||s.start)-s.start)}${f.auto?` (auto${f.limit?', limit '+f.limit:''})`:''}`).join(', '),P,y,W-2*P,26)+14});
  if(good.length){c.fillStyle=RC.ok;c.font=fnt(700,24,'b');c.fillText(`★ Nice job marked ${good.length}×`,P,y);y+=44}
  y+=10;
  // checkpoints
  if(cps.length){H('Checkpoints');cps.forEach(p=>{pinDot(c,P+17,y-8,p.n,p.done?RC.ok:RC.caution,p.done?'#fff':'#1D1600',16);
    c.fillStyle=RC.ink;c.font=fnt(700,24,'b');c.fillText(p.name+(p.done?'':'  (missed)'),P+48,y);y+=30;
    if(p.task){c.fillStyle=RC.muted;c.font=fnt(400,20,'b');y=wrap(c,p.task,P+48,y,W-2*P-48,28)}y+=14});y+=10}
  // reminders
  H('Reminders for next time');const rem=[];
  gl.slice(0,3).forEach(([lab])=>FLAGS[lab]?.tip&&rem.push([lab,FLAGS[lab].tip]));
  const missed=cps.filter(p=>!p.done);if(missed.length)rem.push(['Retry',`Go back to ${missed.map(p=>p.name).join(', ')} next lesson.`]);
  if(!gl.length&&!missed.length&&s.feel>=4)rem.push(['Level up','Everything went well. Try the next stage next time.']);
  if(!rem.length)rem.push(['Keep going','Repeat this route once more to build confidence before moving on.']);
  rem.forEach(([k,t],i)=>{c.fillStyle=RC.caution;rrect(c,P,y-26,36,36,8);c.fill();c.fillStyle='#1D1600';c.font=fnt(800,20,'m');c.textAlign='center';c.fillText(i+1,P+18,y-1);c.textAlign='left';
    c.fillStyle=RC.ink;c.font=fnt(700,24,'b');c.fillText(k,P+52,y);y+=32;c.font=fnt(400,22,'b');y=wrap(c,t,P+52,y,W-2*P-52,30)+16});
  // notes
  if(s.notes){y+=6;H('Notes');c.fillStyle=RC.ink;c.font=fnt(400,22,'b');y=wrap(c,s.notes,P,y,W-2*P,32)+10}
  // footer
  const pct=skillPct(S.skills);
  y+=20;c.fillStyle=RC.line;c.fillRect(P,y,W-2*P,2);y+=36;c.fillStyle=RC.muted;c.font=fnt(400,20,'b');
  c.fillText(`Skill board: ${pct}% road-test ready · Lesson ${S.sessions.length-S.sessions.findIndex(x=>x.id===s.id)} of ${S.sessions.length}`,P,y);y+=P;
  const out=document.createElement('canvas');out.width=W;out.height=y;const o=out.getContext('2d');o.drawImage(cv,0,0);
  return out}

function canvasBlob(cv,type='image/png',q){return new Promise((res,rej)=>{try{cv.toBlob(b=>b?res(b):rej(new Error('blob')),type,q)}catch(e){rej(e)}})}
async function reportCanvas(s){if(reportCache[s.id])return reportCache[s.id];let cv=await buildReport(s,true);
  try{await canvasBlob(cv)}catch(e){cv=await buildReport(s,false)}return reportCache[s.id]=cv}
async function deliver(blob,name){const file=new File([blob],name,{type:blob.type});
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:'Lesson report'});return}catch(e){if(e.name==='AbortError')return}}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}
let jspdfP=null;function loadJsPDF(){return jspdfP=jspdfP||new Promise((res,rej)=>{if(window.jspdf)return res(window.jspdf);const sc=document.createElement('script');
  sc.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';sc.onload=()=>res(window.jspdf);sc.onerror=()=>{jspdfP=null;rej()};document.head.appendChild(sc)})}
const repName=(s,ext)=>`lesson-${new Date(s.start).toISOString().slice(0,10)}-${(s.routeName||'drive').toLowerCase().replace(/[^a-z0-9]+/g,'-')}.${ext}`;
function renderReport(){const s=S.sessions.find(x=>x.id===reportView);if(!s){reportView=null;return render()}
  pane.innerHTML=`<div class="row" style="justify-content:space-between"><h2>Lesson report</h2><button class="btn" id="repClose">Close</button></div>
   <div class="row"><button class="btn primary" id="repPng">Share PNG</button><button class="btn primary" id="repPdf">Share PDF</button></div>
   <div id="repBox" class="empty">Drawing the report…</div>`;
  reportCanvas(s).then(cv=>{const box=document.getElementById('repBox');if(!box||reportView!==s.id)return;
    box.className='';box.innerHTML='';const img=new Image();img.alt='Lesson report';img.style.cssText='width:100%;border-radius:10px;border:1px solid var(--line)';
    try{img.src=cv.toDataURL('image/png')}catch(e){}box.appendChild(img)})}
async function sharePng(){const s=S.sessions.find(x=>x.id===reportView);const cv=await reportCanvas(s);deliver(await canvasBlob(cv),repName(s,'png'))}
async function sharePdf(){const s=S.sessions.find(x=>x.id===reportView);const cv=await reportCanvas(s);
  try{const {jsPDF}=await loadJsPDF();const w=cv.width*.5,h=cv.height*.5;const pdf=new jsPDF({orientation:'p',unit:'pt',format:[w,h]});
    pdf.addImage(cv.toDataURL('image/jpeg',.9),'JPEG',0,0,w,h);deliver(pdf.output('blob'),repName(s,'pdf'))}catch(e){toast('PDF needs an internet connection. Try PNG.')}}

