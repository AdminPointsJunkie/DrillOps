import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const model=require('../docs/workspace/project-dashboard-model.js');
const scope={project:'Test Project',program:'Exploration',year:2026,clientId:1,projectId:10};
const row={project:'Test Project',program:'Exploration',planned_year:2026};
test('dashboard isolates client, project, program, year and current borehole plan',()=>{
 const result=model.build([{...row,budget_amount:200},{...row,program:'SIS',budget_amount:9000},{...row,client_id:2,budget_amount:9000}],
 [{...row,status:'Complete'},{...row,project:'Another Project'},{...row,program:'SIS'},{...row,planned_year:2025},{...row,planned_year:null},{...row,status:'Cancelled'},{...row,current_budget_scope:false},{...row,client_id:2}],scope);
 assert.equal(result.budget,200);assert.equal(result.holes.length,1);assert.equal(result.groups.Complete,1);
});
test('missing values and API failures never masquerade as a zero budget or empty plan',()=>{
 assert.equal(model.build(null,null,scope).holes,null);
 assert.equal(model.build(null,null,scope).budgets,null);
 assert.equal(model.build([],[],scope).budget,null);
 assert.equal(model.build([{...row,budget_amount:0}],[],scope).budget,0);
 assert.equal(model.build([{...row,budget_amount:100},{...row,budget_amount:null}],[],scope).budget,null);
 assert.equal(model.build([{...row,budget_amount:'invalid'}],[],scope).budget,null);
});
test('schedule uses complete valid dates without inventing durations',()=>{
 const result=model.build([], [{...row,hole_id:'A',scheduled_start:'2026-11-01',scheduled_end:'2026-11-03'},
 {...row,hole_id:'B',scheduled_start:'2026-11-03',scheduled_end:'2026-11-01'},
 {...row,hole_id:'C',scheduled_start:'2026-11-01'},
 {...row,hole_id:'D',scheduled_start:'2026-02-30',scheduled_end:'2026-03-05'}],scope);
 assert.deepEqual(result.schedule.map(row=>row.hole_id),['A']);
 assert.equal(model.date('2026-02-30'),null);
 assert.equal(model.date('3/11/2026'),model.date('2026-11-03'));
 assert.equal(model.date('30/02/2026'),null);
});
test('budget categories reconcile and unknown borehole status stays separate',()=>{
 const result=model.build([{...row,section:'DRILLING',budget_amount:'$1,200.00'},{...row,section:'SUPPORT',budget_amount:300}],
 [{...row,status:'In Progress',lat:-23,lng:148},{...row,status:null,lat:null,lng:null},{...row,status:'Planned',lat:0,lng:0}],scope);
 assert.equal(result.budget,1500);assert.equal(Object.values(result.categories).reduce((a,b)=>a+b,0),1500);
 assert.equal(result.groups.Other,1);assert.equal(result.located,1);
});
const workbookScope={project:'Ironbark',program:'Exploration',year:2026};
const workbookSource={project:'Ironbark',year:2026,source:'Example budget.xlsx',total:1500,comparison_total:1200,boreholes:[{hole_id:'TEST',drilling_budget_total:1000,earthworks_budget_total:200,geophysical_budget_total:100,geological_support_budget_total:150,misc_budget_total:50,budget_total:1500}]};
test('saved workbook supplies the budget without adding duplicate manual allocations',()=>{
 const result=model.build([{...workbookScope,budget_amount:1500}],[],workbookScope,workbookSource);
 assert.equal(result.budget,1500);assert.equal(result.categories.Drilling,1000);assert.equal(result.imported.comparison_total,1200);
 for(const scope of [{...workbookScope,program:'Gas Riser'},{...workbookScope,year:2027},{...workbookScope,project:'Another Project'}])assert.equal(model.build([],[],scope,workbookSource).budget,null);
 assert.throws(()=>model.workbook({...workbookSource,total:1700},workbookScope),/reconcile/);
 assert.throws(()=>model.workbook({...workbookSource,boreholes:[{}]},workbookScope),/Missing/);
});
