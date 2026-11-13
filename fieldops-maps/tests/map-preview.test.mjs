import test from 'node:test';
import assert from 'node:assert/strict';
import {captureMapPreview} from '../src/map-preview.js';
test('preview waits for tiles, captures full viewport and preserves aspect ratio',async()=>{
 let pending=true,options;const node={clientWidth:1600,clientHeight:900};
 const map={getContainer:()=>node,eachLayer:fn=>fn({isLoading:()=>pending})};
 const image=await captureMapPreview(map,{wait:async()=>{pending=false;},render:async(n,o)=>{assert.equal(n,node);options=o;return 'image';}});
 assert.equal(image,'image');assert.equal(options.width,1600);assert.equal(options.height,900);assert.equal(options.canvasHeight,225);assert.equal(options.style.position,'relative');assert.equal(options.style.transform,'none');
});
test('unfinished tiles never overwrite a saved preview',async()=>{
 const map={getContainer:()=>({clientWidth:100,clientHeight:100}),eachLayer:fn=>fn({isLoading:()=>true})};
 assert.equal(await captureMapPreview(map,{wait:async()=>{},render:()=>{throw Error('must not capture');}}),null);
});
