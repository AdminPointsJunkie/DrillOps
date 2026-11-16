import test from 'node:test';
import assert from 'node:assert/strict';
import {flattenTree,findNode,parentGroup,ancestorGroups,moveNode,removeNode,ungroupNode,groupLayers,normaliseTree,serialiseTree} from '../src/layer-tree.js';
import {cloudLayout} from '../src/data-policy.js';
const group=(id,children,visible=true)=>({id,name:id,visible,collapsed:false,children});
const fixture=()=>['a',group('parent',['b',group('child',['c',group('deep',['d'],false)]),'e'],false),'f'];

test('nested groups round-trip with exact order, collapse and individual visibility',()=>{
 const tree=fixture();findNode(tree,'child').collapsed=true;
 const wire=serialiseTree(tree),ids=flattenTree(tree);
 assert.deepEqual(normaliseTree(JSON.parse(JSON.stringify(wire)),ids),tree);
 assert.ok(wire.every(n=>typeof n==='string'||n.children.every(id=>typeof id==='string')),'legacy publisher receives only layer IDs in children');
 assert.deepEqual(new Set(flattenTree(wire)),new Set(ids),'all descendant layers reach the existing publisher');
 assert.equal(wire.find(g=>g.id==='child').visible,false,'legacy clients respect hidden ancestors');
 assert.equal(findNode(normaliseTree(wire,ids),'child').visible,true,'desktop retains child visibility preference');
 assert.deepEqual(normaliseTree(serialiseTree(normaliseTree(wire,ids)),ids),tree);
});
test('move groups into groups, reorder siblings, move out, and reject descendant cycles atomically',()=>{
 const tree=fixture();assert.equal(moveNode(tree,'child','parent','before'),true);assert.equal(parentGroup(tree,'child'),undefined);
 assert.equal(moveNode(tree,'child','parent','inside'),true);assert.equal(parentGroup(tree,'child').id,'parent');
 assert.deepEqual(ancestorGroups(tree,'d').map(g=>g.id),['parent','child','deep']);
 const before=structuredClone(tree);for(const [id,target,position] of [['parent','deep','inside'],['child','d','before'],['parent','parent','inside'],['child','missing','inside']])assert.equal(moveNode(tree,id,target,position),false);
 assert.deepEqual(tree,before);assert.equal(moveNode(tree,'deep',null),true);assert.equal(parentGroup(tree,'deep'),undefined);
});
test('ungroup and delete nested groups preserve unrelated siblings',()=>{
 const tree=fixture();assert.equal(ungroupNode(tree,'child'),true);assert.deepEqual(findNode(tree,'parent').children.map(n=>typeof n==='string'?n:n.id),['b','c','deep','e']);
 removeNode(tree,'d');assert.equal(findNode(tree,'deep'),undefined);assert.deepEqual(flattenTree(tree),['a','b','c','e','f']);
});
test('group selected groups and layers at their shared parent, preserving order',()=>{
 const tree=fixture(),g=groupLayers(tree,['child','e'],'new');assert.equal(parentGroup(tree,g.id).id,'parent');assert.deepEqual(g.children.map(n=>typeof n==='string'?n:n.id),['child','e']);assert.deepEqual(flattenTree(tree),['a','b','c','d','e','f']);
});
test('nested cloud layout excludes local TIFFs and survives deleted layer references',()=>{
 const tree=fixture(),wire=cloudLayout(tree,[{id:'d',kind:'raster',localOnly:true}]);
 assert.ok(!flattenTree(wire).includes('d'));const loaded=normaliseTree(wire,['a','b','c','e','f']);
 assert.equal(parentGroup(loaded,'c').id,'child');assert.equal(findNode(loaded,'deep'),undefined);
});
test('malformed persisted parent cycles and duplicate order references cannot create cycles or lose layers',()=>{
 const raw=[{id:'g',children:['a'],desktop_group:{parent:'h',order:['h','a','a']}},{id:'h',children:['b'],desktop_group:{parent:'g',order:['g','b']}}];
 assert.deepEqual(new Set(flattenTree(normaliseTree(raw,['a','b']))),new Set(['a','b']));
});
