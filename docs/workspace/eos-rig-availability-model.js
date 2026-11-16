/* Availability is based on recorded rig activity, not assumed calendar hours. */
(function(root){
 'use strict';
 const production=typeof module!=='undefined'&&module.exports?require('./eos-production-model.js'):root.EosProduction;
 const text=v=>String(v??'').trim();
 const code=row=>text(row.code).toUpperCase().replace(/[ -]/g,'_').replace(/^DEPCO_[A-Z]_/,'').replace(/_\d{3}$/,'').replace(/^(?:H_|MCC_)/,'');
 function category(row){
  const c=code(row);
  if(/(?:^|_)(?:REPAIR\w*|BREAKDOWN|BREAK_DOWN)(?:_|$)/.test(c))return 'repairs';
  if(/(?:^|_)(?:MAINT\w*|SERVICE|SERVICING)(?:_|$)/.test(c))return 'maintenance';
  if(production.inspection(row)==='rig')return 'inspections';
  // Notes only classify otherwise generic downtime/work; don't turn productive
  // drilling into downtime because its notes mention a past or future repair.
  if(Number(row.total_metres)>0||c&&!/^(?:ACTIVE|INACTIVE|STAND_?BY(?:_OTHER)?|OTHER)$/.test(c))return '';
  const notes=text(row.notes);
  if(/\b(?:no|not|planned|tomorrow|scheduled|completed earlier)\b/i.test(notes))return '';
  if(/\b(?:rig|drill|hydraulic|engine|pump|mast|compressor)\b/i.test(notes)){
   if(/\brepair\w*\b|\bbreak[ -]?down\b|\bbroken\b/i.test(notes))return 'repairs';
   if(/\bmaintenance\b|\bservic(?:e|ing)\b/i.test(notes))return 'maintenance';
  }
  return '';
 }
 function excluded(row){return /(?:^|_)(?:MIN_SHIFT|MINIMUM_SHIFT|TOP_UP|CREW_TRAVEL)(?:_|$)/.test(code(row));}
 function summarise(source){
  const rigs=new Map(),entries=[];
  for(const row of production.cleanRows(source).rows){
   if(excluded(row))continue;
   const contractor=text(row.contractor)||'Not recorded',rig=text(row.drill_rig)||'Not recorded',key=JSON.stringify([contractor,rig]);
   if(!rigs.has(key))rigs.set(key,{contractor,rig,hours:0,repairs:0,maintenance:0,inspections:0,missing:0});
   const group=rigs.get(key),hours=production.hours(row),kind=category(row);
   if(hours===null)group.missing++;else group.hours+=hours;
   if(kind){group[kind]+=hours||0;entries.push({row,category:kind,hours});}
  }
  const finish=g=>{const downtime=g.repairs+g.maintenance+g.inspections;return {...g,downtime,availableHours:Math.max(0,g.hours-downtime),availability:g.hours>0?(g.hours-downtime)/g.hours*100:null};};
  const rows=[...rigs.values()].sort((a,b)=>a.contractor.localeCompare(b.contractor)||a.rig.localeCompare(b.rig)).map(finish);
  const total=rows.reduce((s,r)=>{for(const k of ['hours','repairs','maintenance','inspections','missing'])s[k]+=r[k];return s;},{hours:0,repairs:0,maintenance:0,inspections:0,missing:0});
  return {...finish(total),rigs:rows,entries};
 }
 const groups=[['Drilling','#315d49'],['Rig moves / setup','#7892a3'],['Repairs / maintenance / rig inspections','#ad7e70'],['Standby','#b8a679'],['Other work','#b9c2bd']];
 function groupLabel(label){
  if(/drilling$/i.test(label))return 'Drilling';
  if(/repair|breakdown|servic|maintenance|rig inspections/i.test(label))return groups[2][0];
  if(label.startsWith('Standby · '))return 'Standby';
  if(/site move|surface setup|setup.*pack/i.test(label))return groups[1][0];
  return 'Other work';
 }
 function groupedTime(summary){
  const combine=categories=>{const result={};for(const [label,hours] of Object.entries(categories||{})){const key=groupLabel(label);result[key]=(result[key]||0)+hours;}return result;};
  return {...summary,timeCategories:combine(summary.timeCategories),daily:summary.daily.map(d=>({...d,timeCategories:combine(d.timeCategories)}))};
 }
 const api={category,excluded,summarise,groups,groupedTime};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EosRigAvailability=api;
})(typeof globalThis!=='undefined'?globalThis:this);
