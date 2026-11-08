import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url),labs=require('../docs/workspace/labs-model.js'),days=require('../docs/workspace/day-rates-model.js');
const roster={id:1,project_id:1,contractor:'Fortem',person:'Geo A',effective_from:'2026-11-01',effective_to:null,anchor_date:'2026-11-01',days_on:7,days_off:7,day_rate:1600};
test('lab totals exclude cancellation and flag pending overdue and unpriced',()=>{assert.deepEqual(labs.summary([{status:'Testing',projected_cost:100,due_on:'2026-11-01'},{status:'Collected',projected_cost:null},{status:'Results received',projected_cost:50,due_on:'2026-11-01'},{status:'Cancelled',projected_cost:999}],'2026-11-08'),{count:3,pending:2,overdue:1,unpriced:1,projected:150});});
test('7:7 remains planned until confirmed, day overrides preserve saved rate',()=>{const m=days.build([roster],[{...roster,work_date:'2026-11-01',status:'Worked',units:0.5,day_rate:1500},{...roster,work_date:'2026-11-02',status:'Not working',units:0,day_rate:1600}],'2026-11','Fortem','');assert.equal(m.people[0].cells[7].status,'Off');assert.equal(m.worked,750);assert.equal(m.workedDays,.5);assert.equal(m.plannedDays,14);assert.equal(m.planned,22400);});
test('effective dated changes retain earlier days and ended latest rule does not revive older roster',()=>{const m=days.build([roster,{...roster,id:2,effective_from:'2026-11-08',anchor_date:'2026-11-08',effective_to:'2026-11-12',days_on:3,days_off:1,day_rate:1800}],[],'2026-11','Fortem',1);assert.equal(m.people[0].cells[0].rate,1600);assert.equal(m.people[0].cells[7].rate,1800);assert.equal(m.people[0].cells[10].status,'Off');assert.equal(m.people[0].cells[12].status,'Off');});
test('filter contractor/project and flag duplicate person assignments',()=>{const r2={...roster,id:2,project_id:2};assert.ok(days.build([roster,r2],[],'2026-11','Fortem','').conflicts>0);assert.equal(days.build([roster,r2],[],'2026-11','Fortem',1).people.length,1);assert.equal(days.build([roster],[],'2026-11','Other','').people.length,0);});
test('rig-linked project filters use each dated allocation, not roster home project',()=>{
 const r={...roster,follow_contractor:'Mitchells Drilling',follow_rig:'1218'};
 const locations=[{date:'2026-11-01',contractor:'Mitchells Drilling',drill_rig:'1218',project_id:2,site:'SITE-A'},{date:'2026-11-01',contractor:'Mitchells Drilling',drill_rig:'1218',project_id:2,site:'SITE-B'},{date:'2026-11-02',contractor:'Mitchells Drilling',drill_rig:'1218',project_id:3,site:'SITE-C'}];
 const all=days.build([r],[],'2026-11','Fortem','',locations);assert.equal(all.people[0].cells[0].allocation,2);assert.equal(all.people[0].cells[0].sites,'SITE-A, SITE-B');assert.equal(all.people[0].cells[2].allocation,null);
 assert.equal(days.build([r],[],'2026-11','Fortem',1,locations).planned,0);assert.equal(days.build([r],[],'2026-11','Fortem',2,locations).planned,1600);
 assert.equal(days.build([r],[],'2026-11','Fortem','unallocated',locations).planned,all.planned-3200);
 locations.push({...locations[0],project_id:3});assert.equal(days.build([r],[],'2026-11','Fortem','',locations).people[0].cells[0].allocation,null);
});
test('backdated alternating swings have one person on daily from May 19 and preserve current swing',()=>{
 const a={...roster,effective_from:'2026-05-19',anchor_date:'2026-11-05'},b={...a,id:2,person:'Geo B',anchor_date:'2026-11-12'};
 for(const month of ['2026-05','2026-06','2026-11']){const m=days.build([a,b],[],month,'Fortem','');for(let i=0;i<m.dates.length;i++)assert.equal(m.people.reduce((sum,p)=>sum+p.cells[i].units,0),m.dates[i]<'2026-05-19'?0:1);}
});
test('historical allocations stay saved when rig records change and future days remain unallocated',()=>{
 const r={...roster,allocation_default:'unallocated',follow_contractor:'',follow_rig:''};
 const entry={...r,work_date:'2026-11-01',status:'Planned',units:1,allocation_locked:true,allocated_project_id:2,allocation_site:'Saved site'};
 const m=days.build([r],[entry],'2026-11','Fortem','',[{date:'2026-11-01',contractor:'Mitchells Drilling',drill_rig:'1218',project_id:3,site:'Changed site'}]);
 assert.equal(m.people[0].cells[0].allocation,2);assert.equal(m.people[0].cells[0].sites,'Saved site');assert.equal(m.people[0].cells[1].allocation,null);
 assert.equal(days.build([r],[entry],'2026-11','Fortem',2).planned,1600);
});
