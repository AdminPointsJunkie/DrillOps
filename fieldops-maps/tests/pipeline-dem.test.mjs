import test from 'node:test';
import assert from 'node:assert/strict';
import {writeArrayBuffer} from 'geotiff';
import {openDEM} from '../src/pipeline-dem.js';
test('original GeoTIFF sampling uses georeferencing, interpolation, units and missing coverage',async()=>{
 globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>this.onload({target:{result}}),e=>this.onerror(e));}};
 const bytes=writeArrayBuffer(new Float32Array([10,20,30,40]),{width:2,height:2,ModelPixelScale:[.001,.001,0],ModelTiepoint:[0,0,0,149,-22,0],GeographicTypeGeoKey:4326,GTModelTypeGeoKey:2,GTRasterTypeGeoKey:1});
 const file=new Blob([bytes]);file.name='test-elevation.tif';const dem=await openDEM(file);
 assert.ok(Math.abs(await dem.sample([149.001,-22.001])-25)<.0001);assert.equal(await dem.sample([150,-22]),null);dem.dispose();
 const feet=await openDEM(file,{units:'feet'});assert.ok(Math.abs(await feet.sample([149.001,-22.001])-7.62)<.0001);feet.dispose();await assert.rejects(openDEM(file,{band:2}),/band/);delete globalThis.FileReader;
});
