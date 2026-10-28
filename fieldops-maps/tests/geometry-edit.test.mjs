import test from 'node:test';
import assert from 'node:assert/strict';
import {drawGeometry,editOperation,moveVertex,snapCoordinate,validateGeometry} from '../src/geometry-edit.js';
import {measureDistance} from '../src/explore-data.js';
const feature=geometry=>({type:'Feature',properties:{name:'Original'},geometry});
const square=(x=0)=>drawGeometry('polygon',[[x,0],[x+2,0],[x+2,2],[x,2]]);
test('drawing validates topology and circles retain a geographic radius',()=>{
 assert.throws(()=>drawGeometry('polygon',[[0,0],[2,2],[0,2],[2,0]]));
 const circle=drawGeometry('circle',[[148,-22],[148.001,-22]]);
 assert.equal(circle.coordinates[0].length,97);
 const radius=measureDistance([[148,-22],[148.001,-22]]);
 circle.coordinates[0].forEach(c=>assert.ok(Math.abs(measureDistance([[148,-22],c])-radius)<.001));
 assert.throws(()=>drawGeometry('line',[[1,1],[1,1]]));
});
test('cut splits polygons and lines; clipping and merge preserve attributes and originals',()=>{
 const original=feature(square()),before=structuredClone(original),cut=drawGeometry('line',[[-1,1],[3,1]]);
 const split=editOperation('cut',[original],cut);assert.equal(split.length,2);split.forEach(f=>validateGeometry(f.geometry));assert.deepEqual(original,before);
 assert.equal(editOperation('cut',[feature(drawGeometry('line',[[1,-1],[1,3]]))],cut).length,2);
 const clipped=editOperation('inside',[original],square(1));assert.deepEqual(clipped[0].properties,original.properties);
 const hole=editOperation('outside',[original],drawGeometry('polygon',[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5]]));assert.equal(hole[0].geometry.coordinates.length,2);
 assert.equal(editOperation('merge',split)[0].geometry.type,'Polygon');
 assert.throws(()=>editOperation('merge',[original,feature(drawGeometry('point',[[0,0]]))]));
});
test('vertex movement closes rings and snapping is limited to screen tolerance',()=>{
 assert.deepEqual(moveVertex({type:'Point',coordinates:[148,-22,325]},[],[149,-23]).coordinates,[149,-23,325]);
 const g=square(),moved=moveVertex(g,[0,0],[-1,0]);assert.deepEqual(moved.coordinates[0][0],moved.coordinates[0].at(-1));assert.deepEqual(g.coordinates[0][0],[0,0]);
 const project=c=>({x:c[0],y:c[1]});assert.deepEqual(snapCoordinate([0,0],[[3,4],[20,0]],project),[3,4]);assert.deepEqual(snapCoordinate([0,0],[[20,0]],project),[0,0]);
});
