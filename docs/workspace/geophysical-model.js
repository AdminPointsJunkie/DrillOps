/* Geophysical performance uses recorded runs, not drilling metres or approved logs. */
(function(root){
 'use strict';
 const text=v=>String(v??'').trim(),number=v=>v===null||v===undefined||text(v)===''?null:Number.isFinite(Number(v))?Number(v):null;
 function date(v){
  let s=text(v),m=s.match(/^(\d{1,2})[\/-]([A-Za-z]{3})[\/-](\d{4})$/);
  if(m){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase())+1;s=`${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
  const numeric=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(numeric)s=`${numeric[3]}-${numeric[2].padStart(2,'0')}-${numeric[1].padStart(2,'0')}`;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';
  const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s?s:'';
 }
 function hours(r){const m=text(r.total_time).match(/^(\d+):([0-5]\d)$/);return m?Number(m[1])+Number(m[2])/60:null;}
 const description=r=>text(r.notes).split('|')[0].trim();
 function sonde(r){return text((text(r.notes).match(/\bSonde\s+([^|]+)/i)||[])[1]).replace(/\s+/g,'').toUpperCase();}
 function tool(r){const s=sonde(r);if(/^DUM/.test(s))return 'Dummy / clearance';if(/^(ATV|ALT)/.test(s))return 'Acoustic televiewer';if(/^OTV/.test(s))return 'Optical televiewer';return (s.match(/^[A-Z]+\d?/)||[])[0]||'Tool not recorded';}
 function category(r){
  const d=description(r),c=text(r.code).toUpperCase();
  if(c==='P200'||/logging run/i.test(d))return /^DUM/.test(sonde(r))?'Dummy / clearance':'Logging';
  if(/standby|waiting for holes/i.test(d))return 'Standby / waiting';
  if(c==='D100'||/lost time|breakdown|repair/i.test(d))return 'Recorded downtime';
  if(/travel|base to\/from|mobil|demob/i.test(d))return 'Travel / mobilisation';
  if(/setup|packup|rig up|rig down/i.test(d))return 'Setup / pack-up';
  if(/data processing/i.test(d))return 'Data processing';
  if(/training|induction/i.test(d))return 'Training / induction';
  if(/prestart|safety|sign source/i.test(d))return 'Safety / source handling';
  return 'Other recorded activity';
 }
 function interval(r){const a=number(r.metres_from),b=number(r.metres_to);return a!==null&&b!==null&&a>=0&&b>=0&&a!==b?[Math.min(a,b),Math.max(a,b)]:null;}
 function union(intervals){let total=0,end=-Infinity;for(const [a,b] of [...intervals].sort((a,b)=>a[0]-b[0])){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return total;}
 function reportKey(r){const t=(text(r.notes).match(/\bE-ticket ([A-Za-z0-9-]+)/)||[])[1];return [r.workspace_id||'',r.contractor||'',t||[r.source_file||'Manual entry',(text(r.notes).match(/Source page (\d+)/)||[])[1]||r.date||'Undated'].join('|')].join('|');}
 function holeKey(r){return [r.workspace_id,r.campaign_id||r.program+'|'+r.project,text(r.hole_num).toUpperCase()].join('|');}
 function summarise(input,type='Geophysical Logging'){
  const seen=new Set(),rows=[];let duplicates=0;
  for(const r of input||[]){const key=r.id==null?null:[r.workspace_id,r.contractor,r.id].join('|');if(key&&seen.has(key)){duplicates++;continue;}if(key)seen.add(key);rows.push(r);}
  const charges=rows.filter(r=>/^WFD_/.test(text(r.code))),operations=rows.filter(r=>!/^WFD_/.test(text(r.code)));
  const logging=operations.filter(r=>category(r)==='Logging'),dummy=operations.filter(r=>category(r)==='Dummy / clearance');
  const categories=new Map(),tools=new Map(),holes=new Map(),daily=new Map(),reports=new Map(),issues=[];
  let recordedHours=0,loggingHours=0,metres=0,pairedMetres=0,pairedHours=0,missingTimes=0,missingIntervals=0;
  for(const r of operations){
   const h=hours(r),c=category(r),d=date(r.date),key=reportKey(r),iv=interval(r);
   if(!reports.has(key))reports.set(key,{ticket:key.split('|').at(-1),source:r.source_file,date:d,hole:r.hole_num,unit:r.drill_rig,hours:0,runs:0,metres:0});
   const report=reports.get(key);report.hours+=h||0;
   categories.set(c,(categories.get(c)||0)+(h||0));recordedHours+=h||0;
   if(h===null){missingTimes++;issues.push({row:r,issue:'Missing or invalid activity duration'});}
   if(!d)issues.push({row:r,issue:'Missing or invalid date; excluded when a date range is selected'});
   if(!text(r.drill_rig)||text(r.drill_rig).includes('/'))issues.push({row:r,issue:'Unit missing or multiple units listed; unit-days unavailable for this row'});
   if(sonde(r)&&c!=='Logging'&&c!=='Dummy / clearance')issues.push({row:r,issue:'Tool listed against a non-logging activity; source code retained'});
   if(d&&!daily.has(d))daily.set(d,{date:d,hours:0,loggingHours:0,metres:0,runs:0,holes:new Set()});
   const day=daily.get(d);if(day)day.hours+=h||0;
   if(c!=='Logging')continue;
   loggingHours+=h||0;report.runs++;
   const tk=tool(r);if(!tools.has(tk))tools.set(tk,{label:tk,runs:0,hours:0,metres:0,missingIntervals:0});const t=tools.get(tk);t.runs++;t.hours+=h||0;
   let hole=null;if(text(r.hole_num)){const hk=holeKey(r);if(!holes.has(hk))holes.set(hk,{label:r.hole_num,project:r.project||'Unassigned',program:r.program||'',runs:0,hours:0,metres:0,intervals:[],tools:new Set()});hole=holes.get(hk);hole.runs++;hole.hours+=h||0;hole.tools.add(tk);if(day)day.holes.add(hk);}
   else issues.push({row:r,issue:'Logging run has no hole identifier'});
   if(day){day.loggingHours+=h||0;day.runs++;}
   if(iv){const m=iv[1]-iv[0];metres+=m;t.metres+=m;report.metres+=m;if(day)day.metres+=m;if(hole){hole.metres+=m;hole.intervals.push(iv);}if(h>0){pairedMetres+=m;pairedHours+=h;}}
   else{missingIntervals++;t.missingIntervals++;issues.push({row:r,issue:'Logging interval missing, zero-length or invalid; excluded from metres'});}
  }
  const holeRows=[...holes.values()].map(h=>({...h,coverage:union(h.intervals),tools:[...h.tools].sort()}));
  const reviewReports=new Set(operations.filter(r=>/REVIEW:/.test(r.notes||'')).map(reportKey));
  const unitDays=new Set(operations.filter(r=>date(r.date)&&text(r.drill_rig)&&!text(r.drill_rig).includes('/')).map(r=>[r.contractor,date(r.date),text(r.drill_rig).replace(/^WV/i,'')].join('|')));
  const estimate=charges.reduce((s,r)=>s+(number(r.line_cost)||0),0),recordedCharges=operations.reduce((s,r)=>s+(number(r.line_cost)||0),0);
  const withheldReports=new Set(operations.filter(r=>/charge estimate withheld/i.test(r.notes||'')).map(reportKey));
  return {reports:reports.size,holes:holes.size,runs:logging.length,dummyRuns:dummy.length,metres,hours:type==='Geophysical Logging'?loggingHours:recordedHours,recordedHours,loggingHours,
   utilisation:recordedHours>0?loggingHours/recordedHours*100:null,rate:pairedHours>0?pairedMetres/pairedHours:null,pairedRuns:logging.filter(r=>interval(r)&&hours(r)>0).length,
   coverage:holeRows.reduce((s,h)=>s+h.coverage,0),intervalCompleteness:logging.length?(logging.length-missingIntervals)/logging.length*100:null,
   missingIntervals,missingTimes,duplicates,unitDays:unitDays.size,reviewReports:reviewReports.size,withheldReports:withheldReports.size,
   estimate,recordedCharges,charges:estimate+recordedCharges,unpriced:rows.filter(r=>number(r.line_cost)===null).length,
   categories:[...categories].map(([label,hours])=>({label,hours})).sort((a,b)=>b.hours-a.hours),tools:[...tools.values()].sort((a,b)=>b.metres-a.metres),holeRows,
   daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,holes:d.holes.size})),register:[...reports.values()].sort((a,b)=>a.date.localeCompare(b.date)),issues,operations,logging};
 }
 const api={summarise,date,hours,category,interval,union,sonde,tool};root.ServiceProduction=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
