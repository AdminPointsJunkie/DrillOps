import test from 'node:test';import assert from 'node:assert/strict';
import {mergeableType,mergeSelectedFeatures} from '../src/layer-merge.js';
const layer=(type)=>({kind:'vector',fc:{type:'FeatureCollection',features:[{type:'Feature',id:1,geometry:{type,coordinates:[]},properties:{name:'A',depth:4}}]}});
test('merge accepts matching geometry families only',()=>{
 for(const [a,b,f] of [['Point','MultiPoint','point'],['LineString','MultiLineString','line'],['Polygon','MultiPolygon','polygon']])assert.equal(mergeableType([layer(a),layer(b)]),f);
 for(const items of [[layer('Point')],[layer('Point'),layer('LineString')],[layer('Polygon'),{kind:'raster'}],[layer('Point'),layer('GeometryCollection')],[layer('Point'),{kind:'vector',fc:{features:[]}}]])assert.equal(mergeableType(items),null);
 const mixed=layer('LineString');mixed.fc.features.push(layer('Point').fc.features[0]);assert.equal(mergeableType([mixed,layer('LineString')]),null);
});
test('merge preserves geometry and attributes without mutating sources or retaining duplicate feature IDs',()=>{
 const sources=[layer('LineString'),layer('MultiLineString'),layer('LineString')],before=structuredClone(sources),result=mergeSelectedFeatures(sources);
 assert.equal(result.features.length,3);assert.equal(result.features[1].properties.depth,4);assert.equal(result.features[1].geometry.type,'MultiLineString');assert.equal(result.features[0].id,undefined);assert.deepEqual(sources,before);
 result.features[0].properties.name='Changed';assert.equal(sources[0].fc.features[0].properties.name,'A');
 assert.throws(()=>mergeSelectedFeatures([layer('Point'),layer('Polygon')]));
});
