/* Charges are attached once to the recorded plod/project/rig/shift, never apportioned by guesswork. */
(function(root){
 'use strict';
 const text=v=>String(v??'').trim();
 const key=row=>JSON.stringify([row.contractor,row.project||'',row.date,row.source_file||'',row.drill_rig||'',row.shift||'']);
 const amount=v=>v==null||text(v)===''||!Number.isFinite(Number(v))?null:Number(v);
 function summarise(rows,consumables=[]){
  const groups=new Map(),dates=new Map(),seen=new Set();
  for(const row of rows){
   const id=row.id==null?null:JSON.stringify([row.contractor,row.id]);if(id&&seen.has(id))continue;if(id)seen.add(id);
   const k=key(row);
   if(!groups.has(k)){
    const g={row,holes:new Set(),programs:new Set(),total:0,priced:0,unpriced:0,excluded:0,sharedMaterials:0};groups.set(k,g);
    const d=text(row.date);if(!dates.has(d))dates.set(d,[]);dates.get(d).push(g);
   }
   const g=groups.get(k);g.holes.add(text(row.hole_num));g.programs.add(text(row.program));
   if(row.is_cost_source===false||row.is_cost_source==='false'){g.excluded++;continue;}
   const value=amount(row.line_cost);if(value===null){g.unpriced++;continue;}
   const allocation=amount(row.allocation_percent),factor=row.contractor==='MCC Group'&&allocation!==null?Math.min(100,Math.max(0,allocation))/100:1;
   g.total+=value*factor;g.priced++;
  }
  const seenMaterials=new Set();
  for(const row of consumables){
   const id=row.id==null?null:JSON.stringify([row.contractor,row.id]);if(id&&seenMaterials.has(id))continue;if(id)seenMaterials.add(id);
   const candidates=(dates.get(text(row.date))||[]).filter(g=>{
    const r=g.row;
    return (!row.contractor||row.contractor===r.contractor)&&(!row.project||row.project===r.project)&&(!row.program||g.programs.has(text(row.program)))
     &&(!row.source_file||row.source_file===r.source_file)&&(!row.hole_num||g.holes.has(text(row.hole_num)))
     &&(!row.drill_rig||row.drill_rig===r.drill_rig)&&(!row.shift||row.shift===r.shift);
   });
   if(candidates.length!==1){for(const g of candidates)g.sharedMaterials++;continue;}
   const g=candidates[0],value=amount(row.line_cost);if(value===null)g.unpriced++;else{g.total+=value;g.priced++;}
  }
  return groups;
 }
 function periodCost(rows,groups,metres){
  let total=0,partial=false,priced=0;
  for(const k of new Set(rows.map(key))){const g=groups.get(k);if(!g){partial=true;continue;}total+=g.total;priced+=g.priced;partial=partial||!!(g.unpriced||g.sharedMaterials||g.excluded);}
  return {total,partial,perMetre:metres>0&&priced?total/metres:null};
 }
 const api={key,summarise,periodCost};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EosShiftCharges=api;
})(typeof globalThis!=='undefined'?globalThis:this);
