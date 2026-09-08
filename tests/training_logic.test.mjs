import test from 'node:test';
import assert from 'node:assert/strict';
import {evidence,recordStatus,readiness} from '../docs/training/logic.mjs';
const today='2026-09-09';
const record=(overrides={})=>({name:'Training.A',assignment:'Complete',reportedStatus:'Current',issued:'2025-01-01',expires:'2030-01-01',...overrides});
const column={id:'a',aliases:['Training.A']};
test('current renewal wins over expired history regardless of row order',()=>{
  for(const records of [[record({reportedStatus:'Expired',expires:'2024-01-01'}),record()],[record(),record({reportedStatus:'Expired',expires:'2024-01-01'})]]){
    const e=evidence({records},column,today);assert.equal(e.status,'current');assert.equal(e.best.expires,'2030-01-01');assert.equal(e.records.length,2);
  }
});
test('expiry overrides stale Current status and same-day expiry remains valid',()=>{
  assert.equal(recordStatus(record({expires:'2026-09-08'}),today),'expired');
  assert.equal(recordStatus(record({expires:today}),today),'soon');
  assert.equal(recordStatus(record({expires:'2026-12-08'}),today,90),'soon');
  assert.equal(recordStatus(record({expires:'2026-12-09'}),today,90),'current');
});
test('blank expiry is preserved; reported Expired still counts as expired',()=>{
  const e=evidence({records:[record({expires:null})]},column,today);assert.equal(e.status,'current');assert.equal(e.best.expires,null);
  assert.equal(recordStatus(record({reportedStatus:'Expired',expires:null}),today),'expired');
});
test('future issues, unknown statuses and incomplete assignments require review',()=>{
  assert.equal(recordStatus(record({issued:'2027-01-01'}),today),'review');
  assert.equal(recordStatus(record({reportedStatus:'Suspended'}),today),'review');
  assert.equal(recordStatus(record({assignment:'Pending'}),today),'review');
});
test('no fuzzy competency matching and unmapped differs from missing',()=>{
  assert.equal(evidence({records:[record({name:'Training.A Advanced'})]},column,today).status,'missing');
  assert.equal(evidence({records:[record()]},{...column,aliases:[]},today).status,'unmapped');
});
test('optional and not applicable gaps do not reduce readiness',()=>{
  const state={columns:[column,{id:'b',aliases:['B']},{id:'c',aliases:[]}],roles:{Driller:{a:'minimum',b:'optional',c:'na'}}};
  const person={role:'Driller',records:[record()]};assert.equal(readiness(state,person,today).label,'Minimum met');
  state.roles.Driller.c='minimum';assert.equal(readiness(state,person,today).gaps.length,1);
});
test('unassigned and unconfigured roles never show Minimum met',()=>{
  const state={columns:[column],roles:{Driller:{}}};
  assert.equal(readiness(state,{role:'Unassigned',records:[]},today).label,'Assign role');
  assert.equal(readiness(state,{role:'Driller',records:[]},today).label,'Set requirements');
});
