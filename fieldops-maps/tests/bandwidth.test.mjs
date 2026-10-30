import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createReleaseCache} from '../src/release-cache.js';
import {publishedLayers} from '../src/published-projects.js';
import {isLocalGeoTIFF,assertCloudFile,cloudLayout} from '../src/data-policy.js';
import {addLocationFiles,attachmentPaths} from '../src/location-files.js';

test('GeoTIFF policy covers drivers, renamed TIFF content, originals and cloud layout',async()=>{
 assert.ok(isLocalGeoTIFF({kind:'raster',metadata:{format:'GTiff'}}));
 assert.ok(isLocalGeoTIFF({kind:'raster',original_paths:['a/IMAGE.TIFF']}));
 assert.ok(!isLocalGeoTIFF({kind:'raster',metadata:{xyz:{}}}));
 const f=new File([new Uint8Array([73,73,42,0])],'renamed.bin');await assert.rejects(assertCloudFile(f),/local-only/);
 await assertCloudFile(new File(['abc'],'survey.csv'));
 assert.deepEqual(cloudLayout(['a',{id:'g',children:['b','a']}],[{id:'a',kind:'raster',metadata:{format:'GTiff'}}]),[{id:'g',children:['b']}]);
});
test('reopening uses cached layers, new publication fetches only changed layers; revoked access denies cache',async()=>{
 const cache=createReleaseCache(new IDBFactory()),calls=[];let version=1,denied=false;
 const db={rpc:async(n,p)=>{calls.push([n,p]);if(denied)return {error:Error('Access denied')};if(n==='maps_release_manifest')return {data:{id:'r'+version,version,project:{id:'map'},layer_layout:['a','b'],layers:[{id:'a',hash:'stable'},{id:'b',hash:'b'+version}]}};return {data:{id:p.p_layer,kind:'vector',fc:{type:'FeatureCollection',features:[]},metadata:{}}};}};
 await publishedLayers(db,{id:'map'},{userId:'u',cache});assert.equal(calls.filter(c=>c[0]==='maps_release_layer').length,2);
 calls.length=0;await publishedLayers(db,{id:'map'},{userId:'u',cache});assert.equal(calls.length,1);
 version=2;calls.length=0;await publishedLayers(db,{id:'map'},{userId:'u',cache});assert.deepEqual(calls.filter(c=>c[0]==='maps_release_layer').map(c=>c[1].p_layer),['b']);
 denied=true;await assert.rejects(publishedLayers(db,{id:'map'},{userId:'u',cache}),/Access denied/);assert.equal(await cache.get('u:map'),undefined);
});
test('hidden raster waits until explicitly loaded; caches are scoped to account',async()=>{
 const cache=createReleaseCache(new IDBFactory());let downloads=0,layerReads=0;
 const db={rpc:async n=>n==='maps_release_manifest'?{data:{id:'r',project:{id:'m'},layers:[{id:'a',hash:'h'}]}}:(layerReads++,{data:{id:'a',kind:'raster',visible:false,raster_path:'p',metadata:{}}}),storage:{from:()=>({download:async()=>{downloads++;return {data:new Blob(['png'])};}})}};
 const result=await publishedLayers(db,{id:'m'},{userId:'u',cache});assert.equal(downloads,0);await result.layers[0]._load();assert.equal(downloads,1);URL.revokeObjectURL(result.layers[0].url);
 await publishedLayers(db,{id:'m'},{userId:'other',cache});assert.equal(layerReads,2);
 await cache.clear();assert.equal(await cache.get('u:m'),undefined);
});
test('photo optimisation uploads thumbnail references and rejects TIFF before any write',async()=>{
 const writes=[];const db={rpc:async()=>({}),storage:{from:()=>({upload:async(path,file)=>{writes.push([path,file.size]);return {};}})}};
 const feature={type:'Feature',properties:{}},layer={id:'l',fc:{features:[feature]}};let saved;
 await addLocationFiles({db,layer,feature,userId:'u',mapId:'m',files:[new File(['123456'],'photo.jpg',{type:'image/jpeg'})],save:async n=>saved=n,optimise:async()=>({file:new File(['12'],'photo.jpg',{type:'image/jpeg'}),thumbnail:new File(['1'],'thumbnail.jpg',{type:'image/jpeg'})})});
 assert.deepEqual(writes.map(w=>w[1]),[2,1]);assert.equal(attachmentPaths(saved.fc).length,2);
 await assert.rejects(addLocationFiles({db,layer,feature,userId:'u',mapId:'m',files:[new File(['tiff'],'map.tif')],save:async()=>{}}),/local-only/);assert.equal(writes.length,2);
});
