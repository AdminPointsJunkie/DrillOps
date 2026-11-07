import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),m=require('../docs/workspace/eos-production-model.js');
const row=(data={})=>({contractor:'Mitchells Drilling',project:'Alpha',date:'2026-10-01',source_file:'shift.pdf',drill_rig:'Rig 1',hole_num:'A1',...data});
test('core, chip and unclassified reconcile without guessing uncoded metres',()=>{
 const s=m.summarise([row({id:1,code:'Drill_Core',total_metres:30,total_time:'02:30'}),row({id:2,code:'DEPCO_A_PCD_001',total_metres:50,total_time:'3'}),row({id:3,total_metres:12,total_time:'01:00'})]);
 assert.equal(s.core,30);assert.equal(s.chip,50);assert.equal(s.other,12);assert.equal(s.metres,s.core+s.chip+s.other);assert.equal(s.hours,6.5);
 assert.equal(m.method({code:'H_Move',bit_type:'HQ_HQ3'}),'other');
});
test('standby includes zero metres and non-chargeable fatigue time, not incidental wording',()=>{
 const s=m.summarise([row({code:'H_Standby_Fatigue',total_metres:0,total_time:'2:00',line_cost:0}),row({code:'DEPCO_A_WET_WEATHER_STANDBY_029',total_time:'1:30'}),row({code:'Drill_Core',notes:'No standby today',total_time:'4:00',total_metres:20}),row({code:'H_Standby_Logger'})]);
 assert.equal(s.standbyHours,3.5);assert.equal(s.missingStandbyTime,1);assert.equal(s.drillingHours,4);assert.equal(s.reasons.length,3);assert.equal(s.productionDays,1);
});
test('durations and dates validate input and derive only recorded clock times',()=>{
 assert.equal(m.duration('1:75'),null);assert.equal(m.duration(''),null);assert.equal(m.duration('-2'),null);assert.equal(m.duration('1:30:30'),1.5083333333333333);
 assert.equal(m.hours({time_from:'22:30',time_to:'01:00'}),2.5);assert.equal(m.hours({}),null);
 assert.equal(m.date('31/02/2026'),'');assert.equal(m.date('2026-02-29'),'');assert.equal(m.date('8/10/2026'),'2026-10-08');
});
test('repeated IDs are removed, separate rows and projects remain',()=>{
 const a=row({id:1,total_metres:5}),b=row({id:2,total_metres:5,project:'Beta'});const s=m.summarise([a,a,b]);
 assert.equal(s.metres,10);assert.equal(s.duplicates,1);assert.equal(s.projects.length,2);assert.equal(s.holeCount,2);assert.equal(s.reportCount,2);
 assert.equal(m.summarise([row({contractor:'Mitchells Drilling'}),row({contractor:'DEPCO Drilling'})]).rigs.length,2);
});
test('scope matches only selected project and explicit program, including unassigned',()=>{
 assert.equal(m.scopeMatch(row({program:'Exploration, Gas Riser'}),{project:'Alpha',program:'Gas Riser'}),true);
 assert.equal(m.scopeMatch(row(),{project:'Beta',program:''}),false);
 assert.equal(m.scopeMatch(row(),{project:'',program:'Exploration'}),false);
 assert.equal(m.scopeMatch(row({project:''}),{project:'__unassigned__',program:''}),true);
 assert.equal(m.scopeMatch(row(),{project:'__unassigned__',program:''}),false);
 const s=m.summarise([]);assert.equal(s.metres,0);assert.equal(s.standbyPercent,null);assert.equal(s.best,null);
});
