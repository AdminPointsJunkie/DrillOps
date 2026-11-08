import test from 'node:test';
import assert from 'node:assert/strict';
import {readSavedVector} from '../src/saved-vector.js';
test('committed import readback retries without importing or duplicating features',async()=>{
 let fail=true,metadataFail=false;const calls=[],fc={type:'FeatureCollection',features:[{id:19,geometry:{type:'GeometryCollection',geometries:[{type:'GeometryCollection',geometries:[{type:'Point',coordinates:[148,-22,300]}]}]}}]},metadata={data_revision:'server'};
 const db={rpc:async(name,args)=>{assert.equal(name,'layer_geojson');assert.equal(args.p_layer_id,'saved-id');calls.push(name);return fail?{error:Error('GeoJson: geometry not supported.')}:{data:fc};},from(table){assert.equal(table,'layers');return {select(){return this;},eq(_,id){assert.equal(id,'saved-id');return this;},single:async()=>metadataFail?{error:Error('Offline')}:{data:{metadata}}};}};
 const initial={type:'FeatureCollection',features:[{id:'local'}]},layer={id:'saved-id',saved:true,fc:initial,saveError:Error('Readback failed')};
 await assert.rejects(readSavedVector(db,layer),/not supported/);assert.equal(layer.fc,initial);assert.ok(layer.saved);
 fail=false;metadataFail=true;await assert.rejects(readSavedVector(db,layer),/Offline/);assert.equal(layer.fc,initial,'Do not partially replace features without their revision');
 metadataFail=false;await readSavedVector(db,layer);assert.equal(layer.id,'saved-id');assert.equal(layer.fc,fc);assert.equal(layer.metadata,metadata);assert.equal(layer.saveError,null);assert.equal(calls.length,3);
});
