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
test('standby excludes non-chargeable and unconfirmed entries by default',()=>{
 const rows=[row({code:'H_Standby_Fatigue',total_metres:0,total_time:'2:00',unit_rate:0,line_cost:0}),row({code:'DEPCO_A_WET_WEATHER_STANDBY_029',total_time:'1:30',unit_rate:630.5}),row({code:'Drill_Core',notes:'No standby today',total_time:'4:00',total_metres:20}),row({code:'H_Standby_Logger',unit_rate:650}),row({code:'H_Standby_Water',total_time:'1:00',unit_rate:null,line_cost:null})];
 const s=m.summarise(rows);assert.equal(s.standbyHours,1.5);assert.equal(s.missingStandbyTime,1);assert.equal(s.drillingHours,4);assert.equal(s.reasons.length,2);assert.equal(s.unconfirmedStandbyHours,1);assert.equal(s.nonChargeableStandbyHours,0);assert.equal(s.unpaidFatigueHours,2);assert.equal(s.displayedHours,5.5);
 const all=m.summarise(rows,{includeNonChargeable:true});assert.equal(all.standbyHours,1.5);assert.equal(all.metres,s.metres);assert.equal(all.hours,s.hours);assert.equal(all.displayedHours,5.5);assert.equal(all.unconfirmedStandbyRows,1);
 assert.equal(m.standbyChargeability({unit_rate:650,line_cost:0}),'chargeable');assert.equal(m.standbyChargeability({line_cost:0}),'unconfirmed');assert.equal(m.standbyChargeability({unit_rate:650,rate_basis:'not chargeable'}),'non-chargeable');
});
test('standby reasons distinguish weather, grouting, logging and other delays',()=>{
 for(const [code,label] of [['H_Standby_Wet_Weath','Wet weather'],['H_Standby_Logger','Waiting for geophysical logger'],['H_Standby_Logging','Geophysical logging in progress'],['H_Standby_Cement_Set','Waiting for grout / cement to set'],['H_Standby_Grouter','Waiting for grouting unit'],['H_Standby_Grout','Grouting in progress'],['H_Standby_Blasting','Mine blasting'],['H_Standby_NoGasMon','Gas monitor unavailable']])assert.equal(m.standby({code}),label);
 assert.equal(m.standby({code:'H_Standby_Water',notes:'After wet weather'}),'Water supply');
 assert.equal(m.standby({code:'Drill_Core',notes:'No standby today'}),'');
});
test('completed holes are unique by contractor/project/hole and counted on the first EOH date',()=>{
 const rows=[row({id:1,notes:'End of hole flush',date:'2026-09-30'}),row({id:2,notes:'EOH',date:'2026-10-01'}),row({id:3,project:'Beta',notes:'Hole completed'}),row({id:4,hole_num:'A2',notes:'Not EOH yet'}),row({id:5,hole_num:'A3',notes:'Expected end of hole tomorrow'}),row({id:6,hole_num:'',notes:'EOH'}),row({id:7,hole_num:'A4',notes:'EOH not reached'})];
 assert.equal(m.summarise(rows).completedHoles,2);assert.equal(m.summarise(rows.slice(1),{completionSource:rows}).completedHoles,1);
 assert.equal(m.summarise([rows[0],rows[0]]).completedHoles,1);
});
test('penetration is weighted by drilling time, with no invented time for untimed metres',()=>{
 const rows=[row({code:'Drill_Core',total_metres:30,total_time:'2:00'}),row({code:'Drill_Chip_or_Open_hole',total_metres:60,total_time:'3:00'}),row({date:'2026-10-02',code:'Drill_Core',total_metres:10,total_time:'1:00'}),row({date:'2026-10-02',code:'Drill_Core',total_metres:5,total_time:''})];
 const s=m.summarise(rows);assert.equal(s.metres,105);assert.equal(s.penetration,100/6);assert.equal(s.corePenetration,40/3);assert.equal(s.chipPenetration,20);assert.equal(s.average,52.5);assert.equal(s.untimedDrillingMetres,5);assert.equal(s.daily[0].penetration,18);assert.equal(s.daily[1].penetration,10);
 assert.equal(m.summarise([row({code:'Drill_Core',total_metres:5})]).penetration,null);
});
test('site moves exclude crew travel and weather delays, and identify combined move/setup time',()=>{
 const rows=[row({code:'H_Rig_Move',total_time:'1:30'}),row({code:'DEPCO_A_MOB_DEMOB_SITE_TO_SITE_007',total_time:'0:30'}),row({code:'H_Surface_Setup',notes:'Pack up rig and site move to next hole',total_time:'2:00'}),row({code:'H_Crew_Travel_On',notes:'Travel to drill site',total_time:'1:00'}),row({code:'H_Active',notes:'Wet weather site to wet to move around',total_time:'4:00',unit_rate:650}),row({notes:'No site move today',total_time:'2:00'})];
 const s=m.summarise(rows);assert.equal(s.movingHours,4);assert.equal(s.combinedMoveHours,2);assert.equal(s.moves.length,3);assert.equal(s.standbyHours,4);assert.equal(s.drillingHours,0);
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

test('fatigue requires a positive recorded charge, even when non-chargeable standby is enabled',()=>{
 const rows=[
  row({code:'H_Standby_Fatigue',total_time:'32:45',unit_rate:0,line_cost:0}),
  row({code:'H_Standby_Fatigue',total_time:'1:00',unit_rate:650,line_cost:0,chargeable:true}),
  row({code:'H_Standby_Fatigue',total_time:'1:00',unit_rate:650,line_cost:null}),
  row({code:'H_Standby_Fatigue',total_time:'1:00',line_cost:50,rate_basis:'not chargeable - Mitchells fatigue management'}),
  row({contractor:'DEPCO Drilling',code:'H_Standby',notes:'Fatigue management',total_time:'1:00',line_cost:100}),
  row({code:'H_Standby_Inspection',total_time:'2:00',unit_rate:0,line_cost:0}),
 ];
 const s=m.summarise(rows),all=m.summarise(rows,{includeNonChargeable:true});
 assert.equal(s.standbyHours,2);assert.equal(all.standbyHours,4);assert.equal(all.unpaidFatigueHours,34.75);
 assert.equal(all.reasons.find(r=>r.label==='Fatigue management').hours,2);
 assert.equal(all.displayedHours,4);assert.equal(s.hours,38.75);
 for(const r of rows.slice(0,3))assert.equal(m.standbyIncluded(r,{includeNonChargeable:true}),false);
});
test('other activity categories reconcile to time totals without excluded standby or site moves',()=>{
 const rows=[row({id:1,code:'Drill_Core',total_metres:20,total_time:'2:00'}),row({id:2,code:'H_Crew_Travel_On',total_time:'1:00'}),row({id:3,code:'H_Service_Maintenance',total_time:'0:30'}),row({id:4,code:'DEPCO_A_SETUP_PACKUP_SITE_014',total_time:'2:00'}),row({id:5,code:'H_Rig_Move',total_time:'1:30'}),row({id:6,code:'H_Standby_Fatigue',total_time:'3:00',line_cost:0}),row({id:7,code:'H_Standby_Wet_Weath',total_time:'4:00',line_cost:400}),row({id:8,code:'H_Repairs',total_time:'1:00'}),row({id:9,code:'H_New_Code'})];
 const s=m.summarise(rows,{includeNonChargeable:true});
 assert.equal(s.otherHours,4.5);assert.equal(s.otherActivities.reduce((a,r)=>a+r.hours,0),s.otherHours);
 assert.equal(s.drillingHours+s.standbyHours+s.movingHours+s.otherHours,s.displayedHours);
 assert.deepEqual(s.otherActivities.filter(r=>r.hours>0).map(r=>r.label).sort(),['Crew travel to site','Repairs','Servicing / maintenance','Surface setup / pack-up']);
 assert.equal(s.otherActivities.find(r=>r.label==='New code').missing,1);
});

test('standby detail entries reconcile to included reasons without duplicate or unpaid rows',()=>{
 const wet=row({id:1,code:'H_Standby_Wet_Weath',total_time:'1:15',unit_rate:550,line_cost:687.5});
 const unknown=row({id:2,code:'H_Standby_Wet_Weath',unit_rate:550,line_cost:null});
 const free=row({id:3,code:'H_Standby_Inspection',total_time:'2:00',unit_rate:0,line_cost:0});
 const fatigue=row({id:4,code:'H_Standby_Fatigue',total_time:'32:45',line_cost:0});
 const pending=row({id:5,code:'H_Standby_Water',total_time:'1:00'});
 const s=m.summarise([wet,wet,unknown,free,fatigue,pending]);
 assert.deepEqual(s.reasons[0].entries.map(r=>r.id),[1,2]);assert.equal(s.reasons[0].rows,2);assert.equal(s.reasons[0].missing,1);
 assert.equal(s.reasons.reduce((n,r)=>n+r.hours,0),s.standbyHours);
 const all=m.summarise([wet,unknown,free,fatigue,pending],{includeNonChargeable:true});
 assert.deepEqual(all.reasons.flatMap(r=>r.entries).map(r=>r.id).sort(),[1,2,3]);
});

const depco=(data={})=>row({contractor:'DEPCO Drilling',program:'Exploration',shift:'Day',...data});
const closingSequence=(hole='TEST-A',project='Alpha',rig='Rig 1')=>[
 depco({id:101,hole_num:hole,project,drill_rig:rig,date:'2026-10-01',time_from:'08:00',code:'DEPCO_A_PCD_90_125_006',total_metres:100}),
 depco({id:102,hole_num:hole,project,drill_rig:rig,date:'2026-10-01',time_from:'12:00',code:'DEPCO_A_STANDBY_LOGGER_048',notes:'Stand by logger'}),
 depco({id:103,hole_num:hole,project,drill_rig:rig,date:'2026-10-02',time_from:'08:30',code:'DEPCO_A_RIG_CEMENTING_036',notes:'Cementing hole'}),
];
test('DEPCO closing sequence counts the correct hole once on cementing date across period and rig filters',()=>{
 const a=closingSequence(),b=closingSequence('TEST-B','Beta','Rig 2').map(r=>({...r,id:r.id+10}));
 const rows=[...a,...b,a[2],depco({id:200,hole_num:'TEST-C',code:'DEPCO_A_PCD_90_125_006',total_metres:30})];
 const s=m.summarise(rows);assert.equal(s.completedHoles,2);assert.deepEqual(s.completedRows.map(r=>r.hole_num),['TEST-A','TEST-B']);
 assert.equal(m.summarise([a[2]],{completionSource:rows}).completedHoles,1);
 assert.equal(m.summarise(rows.filter(r=>r.date==='2026-10-01'),{completionSource:rows}).completedHoles,0);
 assert.equal(m.summarise(rows.filter(r=>r.drill_rig==='Rig 2'),{completionSource:rows}).completedHoles,1);
 assert.equal(s.daily.find(d=>d.label==='2026-10-02').completedHoles,2);
 assert.equal(m.summarise(rows.slice().reverse()).completedHoles,2);
});
test('moves, pack-up and logging do not count, and closing a previous hole cannot complete the new hole',()=>{
 const seq=closingSequence();
 for(const notes of ['Site move to next hole','Pack up rig','Stand by logger','Trip in to cement','Standby cement','Planned cementing hole','Cementing hole casing','Cementing hole partially','Cementing hole - abandoned']){
  assert.equal(m.summarise([...seq.slice(0,2),{...seq[2],notes}]).completedHoles,0,notes);
 }
 assert.equal(m.summarise([...seq.slice(0,2),{...seq[2],hole_num:'TEST-B'}]).completedHoles,0);
 assert.equal(m.summarise([seq[0],seq[2]]).completedHoles,0,'requires logging evidence');
 const resumed=depco({id:104,hole_num:'TEST-A',date:'2026-10-03',code:'DEPCO_A_PCD_90_125_006',total_metres:20});
 assert.equal(m.summarise([...seq,resumed]).completedHoles,0,'later drilling contradicts a terminal close');
 assert.equal(m.summarise(seq.map(r=>({...r,contractor:'Another contractor'}))).completedHoles,0);
 assert.equal(m.summarise(seq.map(r=>({...r,code:r.code.replace('DEPCO_A','DEPCO_C')}))).completedHoles,0,'gas-riser cement is not exploration completion');
});
test('explicit completion and final cementing do not double count, placeholders and multi-hole identifiers are excluded',()=>{
 const seq=closingSequence(),explicit={...seq[1],notes:'Source completion note: Hole completed',id:300};
 assert.deepEqual(m.completionEvents([...seq,explicit]).map(r=>r.id),[300]);
 for(const hole_num of ['NA','N/A','Unknown','-','TEST-A, TEST-B','TEST-A / TEST-B'])assert.equal(m.summarise([row({hole_num,notes:'EOH'})]).completedHoles,0,hole_num);
});
