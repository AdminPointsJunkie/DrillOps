import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),m=require('../docs/workspace/eos-calendar-model.js'),contractor='DEPCO Drilling';
const row=(x={})=>({contractor,project:'Alpha',program:'Exploration',date:'01/10/2026',source_file:'DR17.pdf',drill_rig:'DR17',shift:'Day',hole_num:'A1',...x});
const build=(rows,materials=[],scope={})=>m.build(rows,materials,scope,contractor);
test('calendar groups activity lines into rig shifts, keeps unpaid reports and de-duplicates IDs',()=>{
 const a=row({id:1,line_cost:100}),b=row({id:2,line_cost:-20}),night=row({id:3,shift:'Night',line_cost:0}),other=row({id:4,date:'02/10/2026',shift:'',line_cost:null});
 const result=build([a,a,b,night,other]);assert.equal(result.reports.length,3);assert.deepEqual(result.rigs,['DR17','DR28']);
 assert.equal(result.reports[0].date,'2026-10-01');assert.equal(result.reports[0].row.sourceDate,'01/10/2026');
 assert.equal(result.reports[0].cost.total,80);assert.equal(result.reports[1].cost.priced,1);assert.equal(result.reports[2].shift,'other');assert.equal(result.reports[2].cost.priced,0);
 assert.equal(m.total(result.reports).amount,80);assert.equal(m.total(result.reports).partial,true);
});
test('materials count once, ambiguous materials are not assigned after rig/program filtering',()=>{
 const a=row({id:1,line_cost:100}),b=row({id:2,line_cost:200,drill_rig:'DR28',program:'Gas Riser'}),material=row({id:3,line_cost:30,drill_rig:'',program:''}),unique=row({id:4,line_cost:25});
 const all=build([a,b],[material,unique,unique]);assert.equal(m.total(all.reports).amount,325);assert.equal(m.total(all.reports).partial,true);
 const scoped=build([a,b],[material,unique],{program:'Exploration'});assert.equal(scoped.reports.length,1);assert.equal(scoped.reports[0].cost.total,125);assert.equal(scoped.reports[0].cost.sharedMaterials,1);assert.deepEqual(scoped.rigs,['DR17']);
});
test('scope excludes other contractors and projects, while a mixed-program report retains only selected costs',()=>{
 const rows=[row({id:1,line_cost:100}),row({id:2,line_cost:200,program:'Gas Riser'}),row({id:3,line_cost:900,contractor:'Mitchells Drilling'}),row({id:4,line_cost:500,project:'Beta'})];
 const scoped=build(rows,[row({id:5,line_cost:20,program:''})],{project:'Alpha',program:'Exploration'});
 assert.equal(scoped.reports.length,1);assert.equal(m.total(scoped.reports).amount,100);assert.equal(scoped.reports[0].cost.partial,true);
});
test('invalid dates are flagged, genuine zero and unknown costs differ, full calendar includes off days and leap days',()=>{
 const result=build([row({id:1,date:'31/02/2026',line_cost:50}),row({id:2,line_cost:0}),row({id:3,date:'02/10/2026',line_cost:''})]);
 assert.equal(result.undated,1);assert.equal(result.reports.length,2);assert.equal(result.reports[0].cost.priced,1);assert.equal(result.reports[1].cost.priced,0);
 assert.equal(m.monthDays('2024-02').length,29);assert.equal(m.monthDays('2026-02').length,28);assert.equal(m.monthDays('2026-10').at(-1),'2026-10-31');assert.deepEqual(m.monthDays('2026-13'),[]);
 assert.deepEqual(build([]).rigs,['DR17','DR28']);
});
test('shift labels are classified without treating unknown shifts as a completed day and night',()=>{
 for(const s of ['Day','DS','D','Day Shift'])assert.equal(m.shift(s),'day');
 for(const s of ['Night','NS','N','Nightshift'])assert.equal(m.shift(s),'night');
 for(const s of ['',null,'Both','24 hours'])assert.equal(m.shift(s),'other');
});
