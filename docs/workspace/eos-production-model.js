/* Recorded production with an explicit chargeability filter for standby only. */
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
  const c=text(row.code).toUpperCase().replace(/[ -]/g,'_'),notes=text(row.notes).toUpperCase();
  const weatherStop=!(Number(row.total_metres)>0)&&(/^(?:WET WEATHER|RAIN DELAY|RAINED OFF)\b/.test(notes)||/TOO? WET TO (?:WORK|DRILL|MOVE)/.test(notes));
  if(!/STAND_?BY|INACTIVE/.test(c)&&c!=='H_SAFETY_GAS'&&!weatherStop&&!/^\s*(?:STAND[ -]?BY|WAITING\b|ON HOLD\b)/.test(notes))return '';
  const reason=s=>{
   if(/WEAT|RAIN|WET[ _-]/.test(s))return 'Wet weather';
   if(/NO_?GAS_?MON|GAS[ _-]?MONITOR/.test(s))return 'Gas monitor unavailable';
   if(/WITHOUT[ _-]?CREW|NO[ _-]?CREW/.test(s))return 'Without crew';
   if(/FATIGUE/.test(s))return 'Fatigue management';
   if(/CEMENT[ _-]?SET|GROUT.*SET/.test(s))return 'Waiting for grout / cement to set';
   if(/GROUTER|WAITING.*GROUTING UNIT/.test(s))return 'Waiting for grouting unit';
   if(/GROUT/.test(s))return 'Grouting in progress';
   if(/LOGGER|WAITING.*GEOPHYS/.test(s))return 'Waiting for geophysical logger';
   if(/LOGGING|GEOPHYS/.test(s))return 'Geophysical logging in progress';
   if(/WATER[ _-]?CART/.test(s))return 'Water cart standby';
   if(/WATER/.test(s))return 'Water supply';
   if(/BACKHOE/.test(s))return 'Backhoe standby';
   if(/BLAST/.test(s))return 'Mine blasting';
   if(/MINE[ _-]?SHUT/.test(s))return 'Mine shutdown';
   if(/INCIDENT|INVESTIGATION|ICAM/.test(s))return 'Incidents / investigations';
   if(/SITE[ _-]?PREP/.test(s))return 'Site preparation';
   if(/INSP/.test(s))return 'Site inspections';
   if(/VAC(?:UUM)?/.test(s))return 'Vacuum truck';
   if(/SUMP/.test(s))return 'Sump preparation';
   if(/TESTING|PERMEAB|PIEZOMETER/.test(s))return 'Testing / piezometer installation';
   if(/SAFETY_GAS|GAS DETECT/.test(s))return 'Gas safety';
   return '';
  };
  // A specific activity code takes precedence over incidental words in the notes.
  return reason(c)||reason(notes)||(/CONTRACTOR/.test(c)?'Contractor instruction':/AAC|COMPANY/.test(c)?'Company instruction':'Other standby');
 }
 function standbyChargeability(row){
  // Fatigue counts only when the source line actually carries a charge.
  // A rate or a generic chargeability flag is not evidence of a billed amount.
  if(standby(row)==='Fatigue management')return Number(row.line_cost)>0?'chargeable':'non-chargeable';
  const flag=text(row.chargeable??row.is_chargeable).toLowerCase(),basis=text(row.rate_basis);
  const code=text(row.code).toUpperCase();
  if(['false','no','n','0'].includes(flag)||/\b(?:not[ _-]+chargeable|non[ _-]*chargeable|no[ _-]+charge)\b/i.test(basis)||/(?:^|_)NC(?:_|$)/.test(code))return 'non-chargeable';
  const number=v=>v==null||text(v)===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const rate=number(row.unit_rate),cost=number(row.line_cost);
  if(['true','yes','y','1'].includes(flag)||(rate!==null&&rate>0)||(cost!==null&&cost>0))return 'chargeable';
  if(rate===0&&(cost===null||cost===0))return 'non-chargeable';
  // A missing rate or a zero line total alone is not evidence of free standby.
  return 'unconfirmed';
 }
 function standbyIncluded(row,options={}){
  const status=standbyChargeability(row);
  if(standby(row)==='Fatigue management')return status==='chargeable';
  return status==='chargeable'||(options.includeNonChargeable===true&&status==='non-chargeable');
 }
 function cleanRows(rows){
  const seen=new Set(),out=[];let duplicates=0;
  for(const row of rows||[]){const key=row.id==null?null:JSON.stringify([row.contractor,row.id]);if(key&&seen.has(key)){duplicates++;continue;}if(key)seen.add(key);out.push(row);}
  return {rows:out,duplicates};
 }
 function completionEvents(source){
  const events=new Map(),groups=new Map(),marker='(?:end[ -]+of[ -]+hole|eoh|hole[ -]+complet(?:ed|e))';
  const positive=new RegExp('\\b'+marker+'\\b','i');
  const negative=new RegExp('\\b(?:no|not|before|until|planned|expected|target|awaiting)\\b[^.;\\n]{0,45}\\b'+marker+'\\b|\\b'+marker+'\\b\\s+(?:not|pending|tomorrow)','i');
  const order=r=>date(r.date)+'|'+(/night/i.test(text(r.shift))?'1':'0')+'|'+text(r.time_from).padStart(5,'0')+'|'+String(r.id??'').padStart(12,'0');
  for(const row of cleanRows(source).rows){
   const d=date(row.date),hole=text(row.hole_num),notes=text(row.notes);
   if(!d||!hole||/^(?:n\/?a|none|unknown|not recorded|-+)$/i.test(hole)||/[,;/&\n]|\s+(?:and|to)\s+/i.test(hole))continue;
   const key=JSON.stringify([row.contractor,row.project,hole].map(v=>text(v).toUpperCase()));
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
   if(positive.test(notes)&&!negative.test(notes)&&!(/\babandon(?:ed|ment)?\b/i.test(notes))&&(!events.has(key)||order(row)<order(events.get(key))))events.set(key,row);
  }
  // DEPCO exploration logs often close a hole with logging and whole-hole
  // cementing, without writing EOH. Require that sequence for this same hole.
  // A move, pack-up, logging alone, casing cement or an abandoned hole is not completion.
  // Resolve against all available history before date/rig filters are applied.
  for(const [key,history] of groups){
   if(events.has(key))continue;
   const rows=history.slice().sort((a,b)=>order(a).localeCompare(order(b)));
   if(text(rows[0].contractor).toLowerCase()!=='depco drilling')continue;
   if(rows.some(r=>/\babandon(?:ed|ment)?\b/i.test(text(r.notes))))continue;
   const drilled=rows.filter(r=>Number(r.total_metres)>0&&['core','chip'].includes(method(r))).at(-1);
   if(!drilled)continue;
   const logged=rows.find(r=>order(r)>=order(drilled)&&(/_STANDBY_LOGGER_/.test(text(r.code))||/\b(?:logging|loggers?|geophysical)\b/i.test(text(r.notes)))&&!/\b(?:no|not|cancelled|planned|tomorrow)\b/i.test(text(r.notes)));
   if(!logged)continue;
   const closed=rows.find(r=>order(r)>order(logged)&&/^DEPCO_A_RIG_CEMENTING_/.test(text(r.code))&&
    /^(?:cement(?:ing|ed)|grout(?:ing|ed))\s+(?:the\s+)?hole\b|^hole\s+(?:fully\s+)?(?:cemented|grouted)\b/i.test(text(r.notes))&&
    !/\b(?:not|no|planned|tomorrow|partial|partially|casing|collar|plug|repair|lost circulation|awaiting|waiting)\b/i.test(text(r.notes)));
   if(closed)events.set(key,closed);
  }
  return [...events.values()];
 }
 function siteMove(row){
  const code=text(row.code).toUpperCase(),notes=text(row.notes);
  if(standby(row)||/CREW.*TRAVEL/.test(code))return '';
  const explicit=/^H_RIG_MOVE$|_MOB_DEMOB_SITE_TO_SITE_/.test(code);
  const described=/\bsite move\b|\b(?:mov(?:e|ed|ing)|relocat\w*)\b.{0,35}\b(?:next|new|between)\b.{0,15}\b(?:site|pad|hole)s?\b/i.test(notes);
  if(!explicit&&(!described||/\b(?:no|not|waiting|planning|planned|tomorrow|unable|too wet|to wet)\b.{0,45}\b(?:move|moving|relocat)/i.test(notes)))return '';
  return /SETUP|PACKUP|SURFACE_SETUP/.test(code)||/set[ -]?up|pack[ -]?up|rig[ -]?(?:up|down)/i.test(notes)?'combined':'move';
 }
 function otherActivity(row){
  const code=text(row.code).toUpperCase().replace(/[ -]/g,'_').replace(/^DEPCO_[A-Z]_/,'').replace(/_\d{3}$/,'').replace(/^(?:H_|MCC_)/,'');
  const labels={CREW_TRAVEL_ON:'Crew travel to site',CREW_TRAVEL_OFF:'Crew travel from site',CIRCULATION_FLUSH:'Circulation / flushing',CIRCULATION_FLUS:'Circulation / flushing',CIRCULATION_LOST:'Lost circulation',TRIPPING_RODS:'Tripping rods',SAFETY_CONTRACTOR:'Contractor safety / meetings',SAFETY_COMPANY:'Company safety / meetings',SAFETY_PRESTART:'Pre-start checks',ACTIVE:'Other active work',SURFACE_SETUP:'Surface setup / pack-up',SETUP_PACKUP_SITE:'Surface setup / pack-up',MIN_SHIFT:'Minimum-shift top-up',RIG_CEMENTING:'Rig cementing',CASING_INSTALL:'Casing installation',REAMING:'Reaming',REPAIRS:'Repairs',SERVICE_MAINTENANCE:'Servicing / maintenance',MOB_ON:'Mobilisation',MOB_OFF:'Demobilisation',MOB:'Mobilisation',TRAINING:'Training',CANGE_DRILL_MTD:'Changing drilling method'};
  return labels[code]||(code?code.toLowerCase().replace(/_/g,' ').replace(/^./,c=>c.toUpperCase()):'Uncoded activity');
 }
 function summarise(source,options={}){
  const cleaned=cleanRows(source),rows=cleaned.rows,completed=new Set(options.completionEvents||completionEvents(options.completionSource||rows));
  const metric=()=>({timeCategories:{},metres:0,core:0,chip:0,other:0,hours:0,drillingHours:0,coreHours:0,chipHours:0,rateMetres:0,coreRateMetres:0,chipRateMetres:0,untimedDrillingMetres:0,standbyHours:0,movingHours:0,combinedMoveHours:0,otherHours:0,completedHoles:0});
  const total={...metric(),unpaidFatigueHours:0,nonChargeableStandbyHours:0,unconfirmedStandbyHours:0,unconfirmedStandbyRows:0,excludedStandbyHours:0,missingMoveTime:0,missingTime:0,missingStandbyTime:0,invalidMetres:0,invalidDates:0,duplicates:cleaned.duplicates};
  const days=new Map(),projects=new Map(),rigs=new Map(),reasons=new Map(),otherActivities=new Map(),reports=new Set(),holes=new Set(),productionRigDays=new Set(),moves=[];
  const add=(map,key,label,project,contractor)=>{if(!map.has(key))map.set(key,{label,project,contractor,...metric(),rows:0});return map.get(key);};
  for(const r of rows){
   const d=date(r.date),h=hours(r),kind=method(r),reason=standby(r),move=siteMove(r),included=reason&&standbyIncluded(r,options),status=reason?standbyChargeability(r):'',raw=r.total_metres;
   let m=raw==null||text(raw)===''?0:Number(raw);if(!Number.isFinite(m)||m<0){total.invalidMetres++;m=0;}
   if(!d)total.invalidDates++;
   const drilling=!reason&&!move&&(m>0||(kind!=='other'&&text(r.code))||text(r.code).toUpperCase()==='H_DRILLING');
   const timeLabel=reason?(included?'Standby · '+reason:null):move?(move==='combined'?'Site move + setup':'Site move'):drilling?(kind==='core'?'Cored drilling':kind==='chip'?'Chipped / open-hole drilling':'Other drilling'):otherActivity(r);
   const project=text(r.project)||'Unassigned project',contractor=text(r.contractor)||'Not recorded',rig=text(r.drill_rig)||'Not recorded';
   const groups=[total,add(projects,project.toLowerCase(),project,project,contractor),add(rigs,JSON.stringify([contractor,rig]),rig,project,contractor)];
   if(d)groups.push(add(days,d,d));
   for(const g of groups){
    if(timeLabel&&h>0)g.timeCategories[timeLabel]=(g.timeCategories[timeLabel]||0)+h;
    g.metres+=m;g[kind]+=m;g.hours+=h||0;g.standbyHours+=included?(h||0):0;g.completedHoles+=completed.has(r)?1:0;if(g!==total)g.rows++;
    if(drilling){g.drillingHours+=h||0;if(h>0)g.rateMetres+=m;else g.untimedDrillingMetres+=m;
     if(kind==='core'||kind==='chip'){g[kind+'Hours']+=h||0;if(h>0)g[kind+'RateMetres']+=m;}
    }
    if(move){g.movingHours+=h||0;if(move==='combined')g.combinedMoveHours+=h||0;}
    if(!reason&&!move&&!drilling)g.otherHours+=h||0;
   }
   if(!reason&&!move&&!drilling){const label=otherActivity(r),item=add(otherActivities,label,label);item.hours+=h||0;item.rows++;item.missing=(item.missing||0)+(h===null?1:0);}
   if(h===null){total.missingTime++;if(included)total.missingStandbyTime++;if(move)total.missingMoveTime++;}
   if(move)moves.push({...r,moveType:move,moveHours:h});
   if(reason){
    if(status==='non-chargeable'){
     if(reason==='Fatigue management')total.unpaidFatigueHours+=h||0;
     else total.nonChargeableStandbyHours+=h||0;
    }
    if(status==='unconfirmed'){total.unconfirmedStandbyHours+=h||0;total.unconfirmedStandbyRows++;}
    if(!included)total.excludedStandbyHours+=h||0;
    else{
     const item=add(reasons,reason,reason);(item.entries??=[]).push(r);item.hours+=h||0;item.rows++;item.missing=(item.missing||0)+(h===null?1:0);
     const key=status==='chargeable'?'chargeableHours':'nonChargeableHours';item[key]=(item[key]||0)+(h||0);
    }
   }
   reports.add(JSON.stringify([contractor,project,d||r.date,r.source_file||'',r.source_file?'':r.hole_num||'',r.source_file?'':r.shift||'']));
   if(text(r.hole_num)&&m>0)holes.add(JSON.stringify([project,r.hole_num]));
   if(d&&m>0)productionRigDays.add(JSON.stringify([contractor,rig,d]));
  }
  const finish=g=>({...g,penetration:g.drillingHours?g.rateMetres/g.drillingHours:null,corePenetration:g.coreHours?g.coreRateMetres/g.coreHours:null,chipPenetration:g.chipHours?g.chipRateMetres/g.chipHours:null});
  const daily=[...days.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(finish),productionDays=daily.filter(d=>d.metres>0),best=productionDays.reduce((best,d)=>!best||d.metres>best.metres?d:best,null);
  const displayedHours=Math.max(0,total.hours-total.excludedStandbyHours);
  return {...finish(total),displayedHours,includeNonChargeable:options.includeNonChargeable===true,rows,moves,otherActivities:[...otherActivities.values()].sort((a,b)=>b.hours-a.hours),completedRows:rows.filter(r=>completed.has(r)),projects:[...projects.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(finish),rigs:[...rigs.values()].sort((a,b)=>a.contractor.localeCompare(b.contractor)||a.label.localeCompare(b.label)).map(finish),reasons:[...reasons.values()].sort((a,b)=>b.hours-a.hours),daily,recordedDays:daily.length,productionDays:productionDays.length,productionRigDays:productionRigDays.size,average:productionDays.length?total.metres/productionDays.length:0,averageCore:productionDays.length?total.core/productionDays.length:0,averageChip:productionDays.length?total.chip/productionDays.length:0,averagePerRigDay:productionRigDays.size?total.metres/productionRigDays.size:0,standbyPerDay:daily.length?total.standbyHours/daily.length:0,movingPerDay:daily.length?total.movingHours/daily.length:0,best,reportCount:reports.size,holeCount:holes.size,standbyPercent:displayedHours?total.standbyHours/displayedHours*100:null};
 }
 function rigShiftCounts(rows){
  const rigs=new Map();
  for(const r of cleanRows(rows).rows){const rig=text(r.drill_rig)||'Not recorded',contractor=text(r.contractor)||'Not recorded',key=JSON.stringify([contractor,rig]);
   if(!rigs.has(key))rigs.set(key,new Set());
   rigs.get(key).add(JSON.stringify([date(r.date)||text(r.date),text(r.shift)||text(r.source_file)||'Unspecified shift']));
  }
  return rigs;
 }
 function scopeMatch(row,scope){
  const norm=v=>text(v).toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ');
  if(scope.project==='__unassigned__'&&text(row.project))return false;
  if(scope.project&&scope.project!=='__unassigned__'&&norm(row.project)!==norm(scope.project))return false;
  if(scope.program&&!text(row.program).split(',').some(p=>norm(p)===norm(scope.program)))return false;
  return true;
 }
 const api={rigShiftCounts,date,duration,hours,method,standby,standbyChargeability,standbyIncluded,siteMove,otherActivity,completionEvents,cleanRows,summarise,scopeMatch};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EosProduction=api;
})(typeof globalThis!=='undefined'?globalThis:this);
