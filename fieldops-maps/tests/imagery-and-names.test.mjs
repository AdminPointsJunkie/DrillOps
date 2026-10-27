import test from 'node:test';
import assert from 'node:assert/strict';
import {availableImagery} from '../src/imagery.js';
import {fileLayerName} from '../src/layer-name.js';
test('missing detailed imagery uses the correctly cropped parent tile',async()=>{
 const calls=[],image={width:256,height:256};
 const tile=await availableImagery({z:19,x:11,y:14},async(z,x,y)=>{calls.push([z,x,y]);return z===18?image:null;});
 assert.deepEqual(calls,[[19,11,14],[18,5,7]]);
 assert.equal(tile.sx,128);assert.equal(tile.sy,0);assert.equal(tile.width,128);
});
test('available imagery is preserved; network failures do not trigger a request cascade',async()=>{
 const image={width:256,height:256};let calls=0;
 const tile=await availableImagery({z:17,x:11,y:14},async()=>{calls++;return image;});
 assert.equal(tile.width,256);assert.equal(calls,1);
 await assert.rejects(availableImagery({z:19,x:11,y:14},async()=>{throw Error('offline');}),/offline/);
});
test('names come from source files rather than generic GDAL layer names',()=>{
 assert.equal(fileLayerName([{name:'CQ Holes.dxf'}],'/tmp/123.dxf','entities'),'CQ Holes');
 assert.equal(fileLayerName([{name:'survey.tif'}],'/tmp/123.tif'),'survey');
 assert.equal(fileLayerName([{name:'survey.dbf'},{name:'survey.shp'}],'/tmp/survey.shp','entities'),'survey');
 assert.equal(fileLayerName([{name:'lease.zip'}],'/vsizip/lease.zip/a.shp','a',true),'lease — a');
 assert.equal(fileLayerName([{name:'a.dxf'},{name:'b.dxf'}],'/tmp/b.dxf','entities'),'b');
});
