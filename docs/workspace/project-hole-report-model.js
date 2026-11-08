/* Reconcile original plans, recorded EOS work and invoice actuals without adding the two cost sources. */
(function(root){
 const req=typeof module!=='undefined'&&module.exports?require:null;
 const E=req?req('./eos-production-model.js'):root.EosProduction;
 const A=req?req('./accounts-overview-model.js'):root.AccountsOverview;
 const B=req?req('./project-budget-ledger-model.js'):root.ProjectBudgetLedger;
 const text=v=>String(v??'').trim(),norm=v=>text(v).toLowerCase(),number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 const cents=v=>Math.round(v*100),sum=values=>values.reduce((s,v)=>s+cents(v||0),0)/100;
 const scoped=(r,s)=>norm(r.project)===norm(s.project)&&norm(r.program)===norm(s.program);
 const planScoped=(r,s)=>scoped(r,s)&&String(r.planned_year??r.year)===String(s.year)&&(!r.client_id||!s.clientId||String(r.client_id)===String(s.clientId));
 const identity=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
 const singleHole=v=>!!text(v)&&!(/^(?:n\/?a|none|unknown|not recorded|no hole|-+)$/i.test(text(v))||/[,;/&\n]|\s+(?:and|to)\s+/i.test(text(v)));
 const ids=r=>[r.hole_id,r.site_id,...(r.activity_hole_ids||[])].map(identity).filter(Boolean);
 function findHole(row,holes){
  if(text(row.hole_num)&&!singleHole(row.hole_num))return null;
  const id=identity(row.hole_num),site=identity(row.site_name||row.site_id);
  if(id){const exact=holes.filter(h=>[h.id,h.sourceId].map(identity).includes(id));if(exact.length===1)return exact[0];if(exact.length>1)return null;const aliases=holes.filter(h=>h.aliases.includes(id));if(aliases.length===1)return aliases[0];if(aliases.length>1)return null;}
  if(!site)return null;const matches=holes.filter(h=>h.aliases.includes(site));return matches.length===1?matches[0]:null;
 }
 function drillingOverrun(actual,budget){
  actual=number(actual);budget=number(budget);
  if(actual===null||budget===null||budget<0)return {color:'#94a3a0',label:'Budget comparison unavailable'};
  const a=cents(actual),b=cents(budget);
  if(a<=b)return {color:'#237a65',label:'Within drilling budget'};
  if(b===0)return {color:'#dc2626',label:'Over zero drilling budget'};
  const percent=(a-b)/b*100;
  return {color:percent<=10?'#eab308':percent<=25?'#f97316':'#dc2626',label:percent.toFixed(1)+'% over drilling budget'};
 }
 function build({source,planner=[],evidence={},allocations=[]},scope,range){
  const issues=[],from=range.from||scope.year+'-01-01',to=range.to||scope.year+'-12-31';
  const withinDate=d=>d&&d>=from&&d<=to&&d.slice(0,4)===String(scope.year);
  const live=planner.filter(r=>planScoped(r,scope)),budget=source?B.build(source,{plannerRows:live,scope}):null;
  const holes=(budget?budget.rows:live).map((r,i)=>{
   const p=budget?live.find(p=>p.hole_id===r.planner_hole):r;
   const original=budget?r.total:number(r.budget_total),status=budget?r.planner_status:r.status;
   return {id:p?.hole_id||r.hole_id,sourceId:r.hole_id,aliases:[...new Set([...ids(r),...ids(p||{})])],borehole:{...r,...p,status},status,originalBudget:original,plannedBudget:status==='Cancelled'?0:original,drillBudget:number(r.drilling_budget_total),plannedMetres:number(r.eoh_depth??r.chip_depth),rows:[],materials:[],invoiceAmounts:[],invoiceCount:0,order:i};
  });
  const history=E.cleanRows((evidence.activities||[]).filter(r=>scoped(r,scope))).rows;
  const rows=history.filter(r=>withinDate(E.date(r.date))),materials=(evidence.consumables||[]).filter(r=>scoped(r,scope)&&withinDate(E.date(r.date)));
  // Explicitly identified operational holes outside the saved plan remain visible, with no invented budget.
  for(const row of rows){if(findHole(row,holes)||!singleHole(row.hole_num))continue;
   const id=text(row.hole_num);if(holes.some(h=>h.aliases.includes(identity(id))))continue;
   const p=live.filter(p=>ids(p).includes(identity(id)));
   if(p.length>1)continue;
   holes.push({id,sourceId:'',aliases:[identity(id),...(p.length===1?ids(p[0]):[])],borehole:p[0]||{hole_id:id},status:p[0]?.status||'Not in plan',originalBudget:null,plannedBudget:null,drillBudget:null,plannedMetres:p.length===1?number(p[0].eoh_depth):null,rows:[],materials:[],invoiceAmounts:[],invoiceCount:0,order:holes.length});
  }
  const unassignedRows=[],unassignedMaterials=[];
  for(const r of rows){const h=findHole(r,holes);(h?h.rows:unassignedRows).push(r);}
  for(const r of materials){const h=findHole(r,holes);(h?h.materials:unassignedMaterials).push(r);}
  const invoices=(evidence.invoices||[]).filter(r=>scoped(r,scope));
  const linesByInvoice=new Map();for(const line of evidence.invoice_lines||[]){const key=String(line.invoice_id);if(!linesByInvoice.has(key))linesByInvoice.set(key,[]);linesByInvoice.get(key).push(line);}
  let linkedInvoiceCents=0,unreconciledInvoices=0;
  const invoiceRows=invoices.map(inv=>{
   const value=number(inv.subtotal),lines=linesByInvoice.get(String(inv.id))||[],amounts=lines.map(l=>number(l.amount));
   const reconciled=value!==null&&lines.length>0&&amounts.every(v=>v!==null)&&Math.abs(cents(sum(amounts))-cents(value))<=1;
   let allocated=0;
   if(reconciled){for(const line of lines){const hole=findHole(line,holes);if(!hole)continue;hole.invoiceAmounts.push(Number(line.amount));hole.invoiceCount++;allocated+=cents(Number(line.amount));}linkedInvoiceCents+=allocated;}
   else if(lines.length)unreconciledInvoices++;
   return {...inv,value,month:A.period(inv),linked:allocated/100,unallocated:value===null?null:(cents(value)-allocated)/100};
  });
  const production=E.summarise(rows,{completionSource:history}),priced=rows.concat(materials),eosTotal=sum(priced.map(r=>number(r.line_cost))),unpriced=priced.filter(r=>number(r.line_cost)===null).length;
  // Attribute consumables to a rig only when recorded evidence identifies one rig.
  const rigKey=(contractor,rig)=>JSON.stringify([text(contractor)||'Not recorded',text(rig)||'Not recorded']);
  const rigCosts=production.rigs.map(r=>({key:rigKey(r.contractor,r.label),contractor:r.contractor,rig:r.label,metres:r.metres,total:0,priced:0,partial:false})),rigMap=new Map(rigCosts.map(r=>[r.key,r]));
  const addRigCost=(rig,row)=>{const value=number(row.line_cost);if(value===null)rig.partial=true;else{rig.total=sum([rig.total,value]);rig.priced++;}};
  for(const r of rows)addRigCost(rigMap.get(rigKey(r.contractor,r.drill_rig)),r);
  let unallocatedRigMaterials=0;
  for(const material of materials){
   const candidates=text(material.drill_rig)?[rigKey(material.contractor,material.drill_rig)].filter(k=>rigMap.has(k)):[...new Set(rows.filter(r=>text(r.contractor)===text(material.contractor)&&E.date(r.date)===E.date(material.date)&&text(material.source_file)&&text(r.source_file)===text(material.source_file)&&(!text(material.hole_num)||norm(r.hole_num)===norm(material.hole_num))).map(r=>rigKey(r.contractor,r.drill_rig)))];
   if(candidates.length===1)addRigCost(rigMap.get(candidates[0]),material);
   else{unallocatedRigMaterials++;for(const rig of rigCosts)if(candidates.includes(rig.key)||!candidates.length&&text(rig.contractor)===text(material.contractor))rig.partial=true;}
  }
  for(const rig of rigCosts)rig.perMetre=rig.metres>0&&rig.priced>0?rig.total/rig.metres:null;
  const invoiced=sum(invoiceRows.map(r=>r.value)),invoiceMissing=invoiceRows.filter(r=>r.value===null).length;
  const plannedBudget=budget?budget.plannedBudget:holes.some(h=>h.plannedBudget===null)?null:sum(holes.map(h=>h.plannedBudget));
  const approvedBudget=source?number(source.approvedBudget):null;
  const remainingBudget=approvedBudget===null||plannedBudget===null?null:(cents(approvedBudget)-cents(plannedBudget))/100;
  const metrics=holes.map(h=>{
   const prod=E.summarise(h.rows,{completionSource:history}),costs=h.rows.concat(h.materials),eos=costs.length?sum(costs.map(r=>number(r.line_cost))):null,missing=costs.filter(r=>number(r.line_cost)===null).length;
   const drillingRows=h.rows.filter(r=>!(/^D[ _-]/i.test(text(r.code))&&/water\s*cart|backhoe|loader|excavat|earthworks|earth works/i.test(text(r.code))));
   const drillCosts=drillingRows.concat(h.materials),drillingActual=drillCosts.length?sum(drillCosts.map(r=>number(r.line_cost))):null;
   const invoiced=h.invoiceCount?sum(h.invoiceAmounts):null;
   return {...h,production:prod,eos,drillingActual,unpriced:missing,invoiced,planLessEos:h.plannedBudget===null||eos===null?null:(cents(h.plannedBudget)-cents(eos))/100,planLessInvoices:h.plannedBudget===null||invoiced===null?null:(cents(h.plannedBudget)-cents(invoiced))/100};
  });
  const suppliers=new Map(),family=name=>{const key=A.family(name);return ({weatherford:'geophysics',epiroc:'geophysics',weatherfordsepiroc:'geophysics',environmentfscesc:'impactenvironmental',impactenvironmentalptyltd:'impactenvironmental',b3:'sponcomtesting',sponcom:'sponcomtesting'})[key]||key;};
  const add=name=>{const key=family(name);if(!suppliers.has(key))suppliers.set(key,{key,name:key==='geophysics'?'Weatherford / Precision / Epiroc':name,budget:null,eos:null,invoiced:null,unpriced:0,invoiceCount:0});return suppliers.get(key);};
  if(budget?.hasContractors){for(let i=0;i<budget.columns.length;i++){const values=budget.rows.filter(r=>r.planner_status!=='Cancelled').map(r=>r.values[i]),supplier=add(budget.columns[i].label);if(values.every(v=>v!==null))supplier.budget=sum([supplier.budget,sum(values)]);}}
  else for(const a of allocations.filter(a=>scoped(a,scope))){const supplier=add(a.vendor||a.section||'Unallocated budget');supplier.budget=sum([supplier.budget,number(a.budget_amount)]);}
  if(budget?.hasContractors&&budget.missing===0&&plannedBudget!==null){const rounding=(cents(plannedBudget)-contractorsBudgetCents())/100;if(rounding)add('Budget rounding').budget=rounding;}
  function contractorsBudgetCents(){return [...suppliers.values()].reduce((total,s)=>total+cents(s.budget||0),0);}
  for(const r of priced){const s=add(r.contractor);s.eos=sum([s.eos,number(r.line_cost)]);if(number(r.line_cost)===null)s.unpriced++;}
  for(const r of invoiceRows){const s=add(r.contractor);s.invoiced=sum([s.invoiced,r.value]);s.invoiceCount++;}
  const contractors=[...suppliers.values()].map(s=>({...s,planLessInvoices:s.budget===null||s.invoiced===null?null:(cents(s.budget)-cents(s.invoiced))/100,invoiceLessEos:s.eos===null||s.invoiced===null?null:(cents(s.invoiced)-cents(s.eos))/100}));
  if(budget?.missing)issues.push(budget.missing+' holes have missing contractor budget amounts; contractor comparisons may be incomplete.');
  if(!source)issues.push('No saved workbook budget is available for this project; original planner budgets are shown where recorded.');
  if(budget?.unlinked)issues.push(budget.unlinked+' budget holes do not have a confirmed BH Planner status; their allocations remain included.');
  if(production.invalidMetres)issues.push(production.invalidMetres+' EOS lines have invalid metres and are excluded from production totals.');
  if(unpriced)issues.push(unpriced+' EOS lines have no recorded price. EOS totals include priced lines only.');
  if(invoiceMissing)issues.push(invoiceMissing+' invoices have no subtotal and are excluded from monetary totals.');
  if(unreconciledInvoices)issues.push(unreconciledInvoices+' invoices have line totals that cannot be reconciled to their subtotal; these remain at project level.');
  const unallocatedInvoices=(cents(invoiced)-linkedInvoiceCents)/100,unallocatedEos=sum(unassignedRows.concat(unassignedMaterials).map(r=>number(r.line_cost)));
  const ambiguous=(evidence.ambiguous_consumables||[]).filter(r=>withinDate(E.date(r.date))).length;
  if(ambiguous)issues.push(ambiguous+' consumable lines match more than one project/program and are excluded until allocated.');
  const undated=(evidence.invoices||[]).filter(r=>scoped(r,scope)&&!A.period(r)).length;
  const unscoped=(evidence.invoices||[]).filter(r=>norm(r.project)===norm(scope.project)&&!text(r.program)).length;
  if(undated)issues.push(undated+' project invoices have no usable billing month or invoice date and cannot be placed on the monthly chart.');
  if(unscoped)issues.push(unscoped+' invoices have no program and are excluded until assigned.');
  const invalidDates=history.filter(r=>!E.date(r.date)).length;if(invalidDates)issues.push(invalidDates+' EOS lines have no usable date and are excluded from the period.');
  const monthly=Array.from({length:12},(_,i)=>`${scope.year}-${String(i+1).padStart(2,'0')}`).filter(m=>m>=from.slice(0,7)&&m<=to.slice(0,7)).map(month=>({month,eos:sum(priced.filter(r=>E.date(r.date).startsWith(month)).map(r=>number(r.line_cost))),invoices:sum(invoiceRows.filter(r=>r.month===month).map(r=>r.value))}));
  return {scope,from,to,rigCosts,unallocatedRigMaterials,metrics,contractors,invoiceRows,production,eosTotal,unpriced,invoiced,invoiceMissing,plannedBudget,approvedBudget,remainingBudget,planLessInvoices:plannedBudget===null?null:(cents(plannedBudget)-cents(invoiced))/100,linkedInvoices:linkedInvoiceCents/100,unallocatedInvoices,unallocatedEos,unassignedRows:unassignedRows.length+unassignedMaterials.length,issues,monthly,source:source?.source||'Borehole planning'};
 }
 const api={build,findHole,scoped,drillingOverrun};if(req)module.exports=api;else root.ProjectHoleReport=api;
})(typeof globalThis!=='undefined'?globalThis:this);
