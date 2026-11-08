import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {group}=createRequire(import.meta.url)('../docs/workspace/reconciliation-model.js');
const base={project:'Sample',program:'Exploration',contractor:'Mitchells Drilling',month:'2026-10'};
test('rigs combine once; credits reduce actuals and programs remain separate',()=>{
 const rows=group({eos:[{...base,rig:'R1',eos_total:100.01,unpriced:0},{...base,rig:'R2',eos_total:50.02,unpriced:0},{...base,program:'Gas Riser',rig:'R3',eos_total:999}],invoices:[{...base,invoice_total:200,invoice_count:1},{...base,invoice_total:-20,invoice_count:1}]});
 const r=rows.find(r=>r.program==='Exploration');assert.equal(r.eos,150.03);assert.equal(r.invoiced,180);assert.equal(r.variance,29.97);assert.equal(r.rigs.length,2);assert.equal(rows.length,2);
});
test('missing rates and unmatched invoices are never a conclusive variance',()=>{
 assert.equal(group({eos:[{...base,eos_total:100,unpriced:1}],invoices:[{...base,invoice_total:100,invoice_count:1}]})[0].variance,null);
 assert.equal(group({eos:[],invoices:[{...base,invoice_total:100,invoice_count:1}]})[0].variance,null);
 assert.equal(group({eos:[{...base,eos_total:100}],invoices:[]})[0].variance,null);
});
