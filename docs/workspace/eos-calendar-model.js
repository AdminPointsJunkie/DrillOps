/* Report coverage comes from imported activity records, never from the price of a shift. */
(function(root){
 'use strict';
 const production=typeof module!=='undefined'&&module.exports?require('./eos-production-model.js'):root.EosProduction;
 const charges=typeof module!=='undefined'&&module.exports?require('./eos-shift-charges.js'):root.EosShiftCharges;
 const text=v=>String(v??'').trim();
 function shift(value){const s=text(value).toLowerCase();return /^(day|day shift|dayshift|d|ds)$/.test(s)?'day':/^(night|night shift|nightshift|n|ns)$/.test(s)?'night':'other';}
 function build(rows,materials=[],scope={},contractor=''){
  const normalise=r=>({...r,contractor:r.contractor||contractor,sourceDate:r.date,date:production.date(r.date),drill_rig:text(r.drill_rig),shift:text(r.shift)});
  const source=production.cleanRows(rows.filter(r=>!r.contractor||r.contractor===contractor).map(normalise)).rows;
  const dated=source.filter(r=>r.date),allCharges=charges.summarise(dated,materials.map(normalise)),counts=new Map();
  for(const r of dated){const k=charges.key(r);counts.set(k,(counts.get(k)||0)+1);}
  const scoped=source.filter(r=>production.scopeMatch(r,scope)),groups=new Map();
  for(const row of scoped.filter(r=>r.date)){const k=charges.key(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
  const reports=[...groups].map(([key,entries])=>{
   const row=entries[0],whole=counts.get(key)===entries.length;
   // A program filter must not borrow another program's costs or allocate ambiguous materials.
   const cost=whole?allCharges.get(key):charges.summarise(entries).get(key);
   return {key,row,rig:row.drill_rig||'Rig not recorded',date:row.date,shift:shift(row.shift),rows:entries,cost:{...cost,partial:!!(cost.unpriced||cost.sharedMaterials||cost.excluded||!whole)}};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.rig.localeCompare(b.rig)||a.shift.localeCompare(b.shift));
  const rigs=new Set(scoped.map(r=>r.drill_rig).filter(Boolean));
  // These are the two rigs confirmed by the owner, including when a month has no imports.
  if(contractor==='DEPCO Drilling'){
   if(!scope.program||scope.program==='Exploration')rigs.add('DR17');
   if(!scope.program||scope.program==='Gas Riser')rigs.add('DR28');
  }
  if(scoped.some(r=>!r.drill_rig))rigs.add('Rig not recorded');
  return {reports,rigs:[...rigs].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),undated:scoped.filter(r=>!r.date).length};
 }
 function total(reports){return reports.reduce((s,r)=>({amount:s.amount+r.cost.total,priced:s.priced+r.cost.priced,partial:s.partial||r.cost.partial}),{amount:0,priced:0,partial:false});}
 function monthDays(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return [];
  const [year,m]=month.split('-').map(Number),count=new Date(Date.UTC(year,m,0)).getUTCDate();
  return Array.from({length:count},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));
 }
 const api={shift,build,total,monthDays};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EosCalendar=api;
})(typeof globalThis!=='undefined'?globalThis:this);
