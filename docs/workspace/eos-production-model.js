/* Recorded production, independent of prices and chargeability. */
(function(root){
 'use strict';
 const text=v=>String(v??'').trim();
 function date(value){
  const s=text(value);let m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if(!m){const d=s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);if(d)m=[s,d[3],d[2].padStart(2,'0'),d[1].padStart(2,'0')];}
  if(!m)return '';const iso=[m[1],m[2],m[3]].join('-'),parsed=new Date(iso+'T00:00:00Z');
  return !Number.isNaN(+parsed)&&parsed.toISOString().slice(0,10)===iso?iso:'';
 }
 function duration(value){
  const s=text(value);if(!s)return null;
  const clock=s.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if(clock)return Number(clock[1])+Number(clock[2])/60+Number(clock[3]||0)/3600;
  return /^\d+(?:\.\d+)?$/.test(s)&&Number.isFinite(Number(s))?Number(s):null;
 }
 function hours(row){
  const recorded=duration(row.total_time);if(recorded!==null)return recorded;
  const clock=v=>{const m=text(v).match(/^([01]?\d|2[0-3]):([0-5]\d)$/);return m?Number(m[1])*60+Number(m[2]):null;};
  const from=clock(row.time_from),to=clock(row.time_to);
  return from===null||to===null?null:((to-from+1440)%1440)/60;
 }
 function method(row){
  const c=text(row.code).toUpperCase().replace(/[ -]/g,'_'),b=text(row.bit_type).toUpperCase();
  if(/^H_|STANDBY|INACTIVE|RETRIEV|REAM|REDRILL|TRAVEL|MOVE|SETUP|BREAK|SERVICE|MAINT|MOBIL|CLEAN|CEMENT|CASING|GROUT|SURVEY|TRIP/.test(c))return 'other';
  if(/^DRILL_?CORE(?:$|_)|^DEPCO_[A-Z]_CORE_|^CORE(?:_|$)/.test(c))return 'core';
  if(/DRILL_?CHIP|OPEN_?HOLE|(?:^|_)PCD(?:_|$)|(?:^|_)HAMMER(?:_|$)/.test(c))return 'chip';
  if(/\b[HNPBT]Q(?:3)?\b|\b4C\b|CORE|DIAMOND/.test(b.replace(/_/g,' ')))return 'core';
  if(/PCD|BLADE|HAMMER|CHIP|OPEN.?HOLE/.test(b))return 'chip';
  return 'other';
 }
 function standby(row){
  const c=text(row.code).toUpperCase(),notes=text(row.notes).toUpperCase();
  if(!/STAND[ _-]?BY|INACTIVE/.test(c)&&!/^\s*(?:STAND[ -]?BY|WAITING\b|ON HOLD\b)/.test(notes))return '';
  const s=c+' '+notes;
  if(/WEAT|RAIN/.test(s))return 'Weather';
  if(/WATER/.test(s))return 'Water supply';
  if(/LOGGER|GEOPHYS/.test(s))return 'Geophysical logger';
  if(/FATIGUE/.test(s))return 'Fatigue management';
  if(/NO.?CREW|WITHOUT.?CREW/.test(s))return 'Without crew';
  if(/INSP/.test(s))return 'Site inspections';
  if(/AAC|COMPANY/.test(s))return 'Company instruction';
  return 'Other standby';
 }
 function cleanRows(rows){
  const seen=new Set(),out=[];let duplicates=0;
  for(const row of rows||[]){const key=row.id==null?null:JSON.stringify([row.contractor,row.id]);if(key&&seen.has(key)){duplicates++;continue;}if(key)seen.add(key);out.push(row);}
  return {rows:out,duplicates};
 }
 function summarise(source){
  const cleaned=cleanRows(source),rows=cleaned.rows;
  const total={metres:0,core:0,chip:0,other:0,hours:0,drillingHours:0,standbyHours:0,missingTime:0,missingStandbyTime:0,invalidMetres:0,invalidDates:0,duplicates:cleaned.duplicates};
  const days=new Map(),projects=new Map(),rigs=new Map(),reasons=new Map(),reports=new Set(),holes=new Set();
  const add=(map,key,label,project,contractor)=>{if(!map.has(key))map.set(key,{label,project,contractor,core:0,chip:0,other:0,metres:0,hours:0,standbyHours:0,rows:0});return map.get(key);};
  for(const r of rows){
   const d=date(r.date),h=hours(r),kind=method(r),reason=standby(r),raw=r.total_metres;
   let m=raw==null||text(raw)===''?0:Number(raw);if(!Number.isFinite(m)||m<0){total.invalidMetres++;m=0;}
   if(!d)total.invalidDates++;
   const project=text(r.project)||'Unassigned project',contractor=text(r.contractor)||'Not recorded',rig=text(r.drill_rig)||'Not recorded';
   const groups=[total,add(projects,project.toLowerCase(),project,project,contractor),add(rigs,JSON.stringify([contractor,rig]),rig,project,contractor)];
   if(d)groups.push(add(days,d,d));
   for(const g of groups){g.metres+=m;g[kind]+=m;g.hours+=h||0;g.standbyHours+=reason?(h||0):0;if(g!==total)g.rows++;}
   if(h===null){total.missingTime++;if(reason)total.missingStandbyTime++;}
   if(!reason&&(m>0||(kind!=='other'&&text(r.code))))total.drillingHours+=h||0;
   if(reason){const item=add(reasons,reason,reason);item.hours+=h||0;item.rows++;item.missing=(item.missing||0)+(h===null?1:0);}
   reports.add(JSON.stringify([contractor,project,d||r.date,r.source_file||'',r.source_file?'':r.hole_num||'',r.source_file?'':r.shift||'']));
   if(text(r.hole_num)&&m>0)holes.add(JSON.stringify([project,r.hole_num]));
  }
  const daily=[...days.values()].sort((a,b)=>a.label.localeCompare(b.label)),productionDays=daily.filter(d=>d.metres>0),best=productionDays.reduce((best,d)=>!best||d.metres>best.metres?d:best,null);
  return {...total,rows,projects:[...projects.values()].sort((a,b)=>a.label.localeCompare(b.label)),rigs:[...rigs.values()].sort((a,b)=>a.contractor.localeCompare(b.contractor)||a.label.localeCompare(b.label)),reasons:[...reasons.values()].sort((a,b)=>b.hours-a.hours),daily,productionDays:productionDays.length,average:productionDays.length?total.metres/productionDays.length:0,best,reportCount:reports.size,holeCount:holes.size,standbyPercent:total.hours?total.standbyHours/total.hours*100:null};
 }
 function scopeMatch(row,scope){
  const norm=v=>text(v).toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ');
  if(scope.project==='__unassigned__'&&text(row.project))return false;
  if(scope.project&&scope.project!=='__unassigned__'&&norm(row.project)!==norm(scope.project))return false;
  if(scope.program&&!text(row.program).split(',').some(p=>norm(p)===norm(scope.program)))return false;
  return true;
 }
 const api={date,duration,hours,method,standby,cleanRows,summarise,scopeMatch};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EosProduction=api;
})(typeof globalThis!=='undefined'?globalThis:this);
