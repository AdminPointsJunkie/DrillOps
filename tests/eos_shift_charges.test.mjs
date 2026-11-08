import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),m=require('../docs/workspace/eos-shift-charges.js');
const row=(x={})=>({contractor:'Mitchells Drilling',project:'Alpha',program:'Exploration',date:'2026-10-01',source_file:'plod.pdf',drill_rig:'Rig 1',shift:'Day',hole_num:'A1',...x});
test('shift charges include each activity and uniquely matched material once',()=>{
 const a=row({id:1,line_cost:100}),b=row({id:2,line_cost:0}),material=row({id:1,line_cost:25});
 const c=m.summarise([a,a,b],[material,material]).get(m.key(a));assert.equal(c.total,125);assert.equal(c.priced,3);assert.equal(c.unpriced,0);
});
test('unknown prices, credits and MCC allocation retain their meaning',()=>{
 const rows=[row({id:1,line_cost:null}),row({id:2,line_cost:-10}),row({id:3,line_cost:'',contractor:'MCC Group'}),row({id:4,line_cost:200,contractor:'MCC Group',allocation_percent:25}),row({id:5,line_cost:700,contractor:'MCC Group',is_cost_source:false})];
 const c=m.summarise(rows);assert.equal(c.get(m.key(rows[0])).total,-10);assert.equal(c.get(m.key(rows[0])).unpriced,1);
 const mcc=c.get(m.key(rows[3]));assert.equal(mcc.total,50);assert.equal(mcc.unpriced,1);assert.equal(mcc.excluded,1);
});
test('materials shared across rigs are flagged instead of duplicated or guessed',()=>{
 const a=row({id:1,line_cost:100}),b=row({id:2,line_cost:200,drill_rig:'Rig 2'}),other=row({id:3,line_cost:300,project:'Beta'});
 const c=m.summarise([a,b,other],[row({id:1,drill_rig:'',line_cost:20}),row({id:2,drill_rig:'Rig 2',line_cost:10})]);
 assert.equal(c.get(m.key(a)).total,100);assert.equal(c.get(m.key(b)).total,210);assert.equal(c.get(m.key(other)).total,300);
 assert.equal(c.get(m.key(a)).sharedMaterials,1);assert.equal(c.get(m.key(other)).sharedMaterials,0);
});
