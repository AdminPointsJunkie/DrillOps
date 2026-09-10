import test from 'node:test';
import assert from 'node:assert/strict';
import {trainingSections,orderedTrainingColumns} from '../docs/training/sections.mjs';
test('legacy settings retain section colours and empty saved sections survive',()=>{
  const columns=[{id:'a',group:'Core / Site'},{id:'b',group:'Drilling'}];
  assert.deepEqual(trainingSections({columns}),[{name:'Core / Site',colour:'teal'},{name:'Drilling',colour:'blue'}]);
  const state={columns,sections:[{name:'Emergency response',colour:'green'}]};
  assert.equal(trainingSections(state)[0].name,'Emergency response');
  assert.equal(state.sections.length,1);
});
test('moving or adding columns keeps each section contiguous without changing mappings',()=>{
  const columns=[{id:'a',group:'A',aliases:['Award'],evidenceType:'qualification'},{id:'b',group:'B',aliases:[]},{id:'c',group:'A',aliases:['Authority'],evidenceType:'site_authorisation'}];
  const before=structuredClone(columns);
  assert.deepEqual(orderedTrainingColumns({columns,sections:[{name:'B',colour:'teal'},{name:'Empty',colour:'green'},{name:'A',colour:'clay'}]}).map(c=>c.id),['b','a','c']);
  assert.deepEqual(columns,before);
});
