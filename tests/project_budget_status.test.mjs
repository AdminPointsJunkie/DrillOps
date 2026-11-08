import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {build}=createRequire(import.meta.url)('../docs/workspace/project-budget-ledger-model.js');
const source={project:'Example',year:2026,approvedBudget:200,boreholes:[{hole_id:'SITE-1',site_id:'SITE-1',source_status:'Planned',budget_total:123.45,drilling_budget_total:123.45,earthworks_budget_total:0,geophysical_budget_total:0,geological_support_budget_total:0,misc_budget_total:0}]};
const planner={project:'Example',program:'Exploration',planned_year:'2026',hole_id:'HOLE-1',site_id:'SITE-1',activity_hole_ids:['SITE-1','HOLE-1'],status:'Cancelled'};
test('cancellation and reinstatement update planned holes and remaining budget without changing original amounts',()=>{
 const before=JSON.stringify(source),m=build(source,{plannerRows:[planner]});
 assert.equal(m.rows[0].planner_status,'Cancelled');assert.equal(m.rows[0].source_status,'Planned');assert.equal(m.rows[0].total,123.45);assert.equal(m.plannedBudget,0);assert.equal(m.remainingBudget,200);assert.equal(m.cancelledCount,1);assert.equal(JSON.stringify(source),before);
 const reinstated=build(source,{plannerRows:[{...planner,status:'Planned'}]});assert.equal(reinstated.plannedBudget,123.45);assert.equal(reinstated.remainingBudget,76.55);
});
test('other projects, programs and years cannot release a budget allocation',()=>{for(const other of [{project:'Other'},{program:'Gas Riser'},{planned_year:'2025'},{planning_source_fallback:true}]){const m=build(source,{plannerRows:[{...planner,...other}]});assert.equal(m.rows[0].planner_status,'Not linked');assert.equal(m.cancelledCount,0);assert.equal(m.unlinked,1);assert.equal(m.plannedBudget,123.45);assert.equal(m.remainingBudget,76.55);}});
test('failed planner reads leave cards unavailable and ambiguous matches do not release allocations',()=>{
 const failed=build(source);assert.equal(failed.plannedBudget,null);assert.equal(failed.remainingBudget,null);assert.equal(failed.rows[0].planner_status,'Unavailable');
 const m=build(source,{plannerRows:[planner,{...planner,hole_id:'HOLE-2'}]});assert.equal(m.rows[0].planner_status,'Ambiguous match');assert.equal(m.plannedBudget,123.45);assert.equal(m.remainingBudget,76.55);
});
test('ledger filters retain original row totals without changing project-level cards',()=>{
 const data={...source,boreholes:[...source.boreholes,{...source.boreholes[0],hole_id:'SITE-2',site_id:'SITE-2',budget_total:250.55}]};
 const plannerRows=[planner,{...planner,hole_id:'SITE-2',site_id:'SITE-2',activity_hole_ids:[],status:'Complete'}];
 const m=build(data,{plannerRows,status:'Cancelled'});assert.equal(m.rows.length,1);assert.equal(m.totals.total,123.45);assert.equal(m.plannedBudget,250.55);assert.equal(m.remainingBudget,-50.55);
 const hidden=build(data,{plannerRows,search:'absent'});assert.equal(hidden.rows.length,0);assert.equal(hidden.plannedBudget,250.55);assert.equal(hidden.remainingBudget,-50.55);
});
test('all non-cancelled statuses count and missing amounts stay unknown',()=>{
 for(const status of ['Planned','In Progress','Complete'])assert.equal(build(source,{plannerRows:[{...planner,status}]}).plannedBudget,123.45);
 const missing={...source,boreholes:[{...source.boreholes[0],budget_total:null}]};assert.equal(build(missing,{plannerRows:[{...planner,status:'Planned'}]}).plannedBudget,null);
 assert.equal(build(missing,{plannerRows:[planner]}).plannedBudget,0);assert.equal(build({...source,approvedBudget:null},{plannerRows:[planner]}).remainingBudget,null);
});
