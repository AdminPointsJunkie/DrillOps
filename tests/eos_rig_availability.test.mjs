import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),m=require('../docs/workspace/eos-rig-availability-model.js'),p=require('../docs/workspace/eos-production-model.js');
const row=(extra={})=>({contractor:'Drilling contractor',drill_rig:'Rig 1',date:'2026-11-01',code:'Drill_Core',total_time:'2:00',total_metres:20,...extra});
test('rig availability is weighted from all recorded rig time regardless of standby chargeability',()=>{
 const rows=[row(),row({code:'H_Repairs',total_metres:0,total_time:'1:00'}),row({code:'DEPCO_A_SERVICE_MAINTENANCE_005',total_metres:0,total_time:'0:30'}),row({code:'H_Standby_Insp',total_metres:0,total_time:'0:30',unit_rate:0}),row({code:'H_Standby_Wet_Weath',total_metres:0,total_time:'4:00',unit_rate:0}),row({drill_rig:'Rig 2',total_time:'4:00'})];
 const s=m.summarise(rows);assert.equal(s.hours,12);assert.equal(s.downtime,2);assert.ok(Math.abs(s.availability-100*10/12)<1e-10);assert.equal(s.rigs[0].availability,75);assert.equal(s.rigs[1].availability,100);
 for(const includeNonChargeable of [false,true])assert.deepEqual(m.summarise(p.summarise(rows,{includeNonChargeable}).rows),s);
});
test('billing top-ups and crew travel are excluded, durations are not invented, and duplicate IDs count once',()=>{
 const a=row({id:1,code:'H_Repairs',total_metres:0,total_time:'',time_from:'23:00',time_to:'01:00'});
 const s=m.summarise([a,a,row({id:2,code:'H_Min_Shift',total_time:'8:00'}),row({id:3,code:'H_Crew_Travel_On',total_time:'2:00'}),row({id:4,code:'H_Service',total_time:''})]);
 assert.equal(s.hours,2);assert.equal(s.repairs,2);assert.equal(s.availability,0);assert.equal(s.missing,1);assert.equal(s.entries.length,2);assert.equal(m.summarise([]).availability,null);assert.equal(m.summarise([row({total_time:''})]).availability,null);
});
test('specific activity codes take priority; generic notes require equipment evidence, not future or incidental repairs',()=>{
 assert.equal(m.category(row({code:'H_Repairs'})),'repairs');assert.equal(m.category(row({code:'H_Inspection'})),'inspections');assert.equal(m.category(row({code:'H_Safety_Prestart'})),'');
 for(const notes of ['Rig maintenance planned tomorrow','No rig repairs required','Inspecting borehole','Drilling after rig repairs'])assert.equal(m.category(row({code:'H_Active',notes})),'');
 assert.equal(m.category(row({code:'H_Active',notes:'Repair hydraulic pump',total_metres:0})),'repairs');assert.equal(m.category(row({code:'Drill_Core',notes:'Repair hydraulic pump'})),'');
 assert.equal(m.summarise([row(),row({contractor:'Another contractor'})]).rigs.length,2);
});
test('five consistent time groups preserve every included hour and daily total',()=>{
 const s=p.summarise([row(),row({code:'Drill_Chip_or_Open_hole'}),...['H_Repairs','H_Service_Maintenance','H_Standby_Insp','H_Rig_Move','H_Surface_Setup','H_Standby_Wet_Weath','H_Tripping_Rods'].map((code,i)=>row({code,total_metres:0,unit_rate:650,date:i%2?'2026-11-02':'2026-11-01'}))]);
 const grouped=m.groupedTime(s),sum=o=>Object.values(o).reduce((a,b)=>a+b,0);assert.equal(Object.keys(grouped.timeCategories).length,5);assert.equal(sum(grouped.timeCategories),sum(s.timeCategories));grouped.daily.forEach((d,i)=>assert.equal(sum(d.timeCategories),sum(s.daily[i].timeCategories)));assert.equal(s.timeCategories['Cored drilling'],2);
});
test('report wiring keeps the existing penetration section and always includes rig availability',()=>{
 const html=readFileSync(new URL('../docs/eos.html',import.meta.url),'utf8');assert.equal((html.match(/Penetration &amp; daily averages/g)||[]).length,1);assert.match(html,/id="eos-rig-availability-section"/);assert.match(html,/<details class="eos-other-activities">/);assert.ok(html.indexOf('eos-rig-availability-model.js')<html.indexOf('eos-production.js?'));
 const source=readFileSync(new URL('../docs/workspace/eos-period.js',import.meta.url),'utf8');assert.match(source,/renderEosRigAvailability\(rows,drilling\)/);
});
test('rendered report follows date and rig filters, handles empty data and escapes downtime evidence',()=>{
 const {JSDOM}=createRequire(new URL('../fieldops-maps/package.json',import.meta.url))('jsdom');
 const dom=new JSDOM(readFileSync(new URL('../docs/eos.html',import.meta.url),'utf8'),{url:'http://localhost/eos.html'}),doc=dom.window.document;
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ctx=vm.createContext({document:doc,window:dom.window,console,EosProduction:p,EosRigAvailability:m,esc:escape,attr:escape,productionDisplayDate:v=>v,eosScopeVersion:0,activeContractor:'Drilling contractor',eosScope:{},eosScopeLabel:()=>'',contractorCategory:()=> 'Drilling',contractorByName:()=>({}),isPageActive:()=>true,renderEosStandbyDetails(){},prepareEosWeather(){},clearEosWeather(){},EosShiftCharges:{summarise:()=>new Map(),key:r=>r.drill_rig,periodCost:()=>({perMetre:null})}});
 vm.runInContext(readFileSync(new URL('../docs/workspace/eos-production.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('../docs/workspace/eos-period.js',import.meta.url),'utf8'),ctx);
 ctx.fixture=[row(),row({code:'H_Repairs',total_metres:0,total_time:'2:00',notes:'<img src=x onerror=alert(1)>'}),row({drill_rig:'Rig 2',code:'H_Service_Maintenance',total_metres:0,total_time:'1:00',date:'2026-11-02'})];
 doc.getElementById('eos-period-rig').innerHTML='<option value="">All rigs</option><option>Rig 1</option><option>Rig 2</option>';
 vm.runInContext(readFileSync(new URL('../docs/workspace/eos-sections.js',import.meta.url),'utf8'),ctx);
 vm.runInContext('eosPeriodRows=fixture;eosPeriodSourceRows=fixture;renderEosPeriodReport()',ctx);
 assert.equal(doc.querySelectorAll('#eos-rig-availability-body tr').length,2);assert.equal(doc.querySelector('#eos-rig-events-body img'),null);assert.match(doc.getElementById('eos-rig-availability-body').textContent,/50.0%/);assert.ok(doc.querySelectorAll('.eos-utilisation-detail-legend>span').length<=5);assert.match(doc.getElementById('eos-period-performance').textContent,/Penetration rate/);
 doc.getElementById('eos-period-rig').value='Rig 2';vm.runInContext('renderEosPeriodReport()',ctx);assert.equal(doc.querySelectorAll('#eos-rig-availability-body tr').length,1);assert.match(doc.getElementById('eos-rig-availability-body').textContent,/Rig 2/);assert.match(doc.getElementById('eos-rig-availability-body').textContent,/0.0%/);
 doc.getElementById('eos-period-to').value='2026-11-01';vm.runInContext('renderEosPeriodReport()',ctx);assert.match(doc.getElementById('eos-rig-availability-body').textContent,/No rig activity/);assert.match(doc.getElementById('eos-rig-availability-metrics').textContent,/—/);
 doc.getElementById('eos-rig-availability-section').remove();delete ctx.EosRigAvailability;
 assert.doesNotThrow(()=>vm.runInContext('renderEosPeriodReport()',ctx),'an older cached report layout must still render');
 dom.window.close();
});
