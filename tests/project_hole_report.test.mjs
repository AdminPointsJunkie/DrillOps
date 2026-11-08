import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {build}=createRequire(import.meta.url)('../docs/workspace/project-hole-report-model.js');
const scope={project:'Example',program:'Exploration',year:2026,clientId:1},range={from:'2026-01-01',to:'2026-12-31'};
const baseHole={project:'Example',program:'Exploration',planned_year:2026,drilling_budget_total:600,earthworks_budget_total:100,geophysical_budget_total:100,geological_support_budget_total:100,misc_budget_total:100,budget_total:1000,eoh_depth:100,status:'Planned'};
const planner=[{...baseHole,hole_id:'HOLE-A',site_id:'SITE-A',activity_hole_ids:['SITE-A','HOLE-A']},{...baseHole,hole_id:'HOLE-B',site_id:'SITE-B',status:'Cancelled'}];
const source={project:'Example',year:2026,total:2000,approvedBudget:1800,contractors:[{key:'mitchells',name:'Mitchells Drilling'},{key:'fortem',name:'Fortem'}],holes:[[1,'SITE-A',1,600,400],[2,'SITE-B',1,600,400]],boreholes:[{...baseHole,hole_id:'SITE-A',site_id:'SITE-A'},{...baseHole,hole_id:'SITE-B',site_id:'SITE-B'}]};
const row={id:1,contractor:'Mitchells Drilling',project:'Example',program:'Exploration',date:'2026-03-01',hole_num:'HOLE-A',source_file:'a.pdf',code:'Drill_Core',total_metres:40,total_time:'02:00',line_cost:400};
const invoice={id:1,contractor:'Mitchells Drilling',project:'Example',program:'Exploration',invoice_number:'TEST-1',invoice_date:'2026-04-10',billing_month:'2026-03',subtotal:350,total_aud:385};
const evidence={activities:[row],consumables:[{...row,id:2,line_cost:50}],invoices:[invoice],invoice_lines:[{invoice_id:1,hole_num:'HOLE-A',amount:300},{invoice_id:1,amount:50}],ambiguous_consumables:[]};
const run=(changes={},filters=range)=>build({source,planner,evidence,...changes},scope,filters);
test('reconciles original active plan, EOS work and net invoice actuals independently',()=>{
 const m=run();assert.equal(m.plannedBudget,1000);assert.equal(m.approvedBudget,1800);assert.equal(m.remainingBudget,800);assert.equal(m.eosTotal,450);assert.equal(m.invoiced,350);assert.equal(m.planLessInvoices,650);assert.equal(m.production.core,40);assert.equal(m.production.penetration,20);
 const h=m.metrics[0];assert.equal(h.id,'HOLE-A');assert.equal(h.originalBudget,1000);assert.equal(h.invoiced,300);assert.equal(m.unallocatedInvoices,50);assert.equal(m.linkedInvoices,300);assert.equal(m.metrics[1].plannedBudget,0);assert.equal(m.metrics[1].originalBudget,1000);
 const c=m.contractors.find(r=>r.name==='Mitchells Drilling');assert.equal(c.budget,600);assert.equal(c.eos,450);assert.equal(c.invoiced,350);assert.equal(c.invoiceLessEos,-100);
});
test('reinstatement restores the original hole allocation without changing actuals',()=>{const m=run({planner:planner.map(p=>({...p,status:'Planned',budget_total:99999}))});assert.equal(m.plannedBudget,2000);assert.equal(m.remainingBudget,-200);assert.equal(m.invoiced,350);});
test('project invoice totals include older billing periods while EOS dates stay scoped',()=>{
 const m=run({evidence:{...evidence,activities:[row,{...row,id:3,project:'Other'},{...row,id:4,program:'Gas Riser'},{...row,id:5,date:'2025-03-01'}],invoices:[invoice,{...invoice,id:2,program:'Gas Riser'},{...invoice,id:3,project:'Other'},{...invoice,id:4,billing_month:'2025-12'}]}},{from:'2026-03-01',to:'2026-03-31'});
 assert.equal(m.eosTotal,450);assert.equal(m.invoiced,700);assert.equal(m.production.metres,40);assert.equal(run({}, {from:'2026-04-01',to:'2026-04-30'}).invoiced,350);
});
test('unreconciled invoice lines stay project-wide and credits reduce actuals',()=>{
 const m=run({evidence:{...evidence,invoices:[invoice,{...invoice,id:2,subtotal:-50}],invoice_lines:[{invoice_id:1,hole_num:'HOLE-A',amount:9999},{invoice_id:2,hole_num:'HOLE-A',amount:-50}]}});
 assert.equal(m.invoiced,300);assert.equal(m.metrics[0].invoiced,-50);assert.equal(m.unallocatedInvoices,350);assert.equal(m.linkedInvoices,-50);assert.match(m.issues.join(' '),/line totals/);
});
test('unmapped and ambiguous hole evidence is never duplicated or allocated by guesswork',()=>{
 const m=run({evidence:{...evidence,activities:[row,{...row,id:3,hole_num:'',site_name:'',line_cost:100}],invoice_lines:[]}});assert.equal(m.eosTotal,550);assert.equal(m.unallocatedEos,100);assert.equal(m.metrics[0].eos,450);assert.equal(m.metrics[0].invoiced,null);assert.equal(m.unallocatedInvoices,350);
});
test('missing prices, missing invoice dates, and unknown program are visible',()=>{
 const m=run({evidence:{...evidence,activities:[{...row,line_cost:null}],invoices:[{...invoice,subtotal:null},{...invoice,id:2,invoice_date:'',billing_month:''},{...invoice,id:3,program:''}]}});
 assert.equal(m.unpriced,1);assert.equal(m.eosTotal,50);assert.equal(m.invoiceMissing,1);assert.equal(m.invoiced,350);assert.match(m.issues.join(' '),/no subtotal/);assert.match(m.issues.join(' '),/no usable billing month/);assert.match(m.issues.join(' '),/no program/);
});
test('source amounts and input records are not mutated',()=>{const data={source,planner,evidence},before=JSON.stringify(data);run();assert.equal(JSON.stringify(data),before);});
test('identifier formatting is normalized, and a multi-hole line remains unallocated',()=>{
 const m=run({evidence:{...evidence,activities:[{...row,hole_num:'HOLE A'},{...row,id:3,hole_num:'HOLE-A / HOLE-B',line_cost:200}],invoice_lines:[{invoice_id:1,hole_num:'HOLE-A / HOLE-B',amount:350}]}});
 assert.equal(m.metrics.length,2);assert.equal(m.metrics[0].eos,450);assert.equal(m.unallocatedEos,200);assert.equal(m.unallocatedInvoices,350);assert.equal(m.linkedInvoices,0);
});
test('contractor budgets reconcile to the active hole plan including cents rounding',()=>{
 const m=run({source:{...source,holes:[[1,'SITE-A',1,600,399.99],[2,'SITE-B',1,600,400]]}});
 assert.equal(m.contractors.find(r=>r.name==='Budget rounding').budget,.01);assert.equal(Math.round(m.contractors.reduce((s,r)=>s+(r.budget||0),0)*100),Math.round(m.plannedBudget*100));
});
test('drilling bars exclude separately coded earthworks while total EOS retains them',()=>{
 const m=run({evidence:{...evidence,activities:[row,{...row,id:9,code:'D_Backhoe',total_metres:0,line_cost:100}]}});
 assert.equal(m.metrics[0].drillBudget,600);assert.equal(m.metrics[0].drillingActual,450);assert.equal(m.metrics[0].eos,550);
});
