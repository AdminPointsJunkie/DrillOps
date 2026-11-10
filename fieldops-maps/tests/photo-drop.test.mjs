import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {splitPhotoFiles,routeMapFiles,readPhotoLocation,importPhotoBatch,downscaleLocalPhoto} from '../src/photo-drop.js';
import {createPersonalPinStore} from '../src/photo-location-model.js';

function gpsJPEG(lat=[27,28,12],lon=[153,1,48],latRef='S',lonRef='E'){
 const tiff=Buffer.alloc(128);tiff.write('II');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
 tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x8825,10);tiff.writeUInt16LE(4,12);tiff.writeUInt32LE(1,14);tiff.writeUInt32LE(26,18);
 tiff.writeUInt16LE(4,26);
 for(const [i,tag,type,count,value] of [[0,1,2,2,latRef],[1,2,5,3,80],[2,3,2,2,lonRef],[3,4,5,3,104]]){
  const at=28+i*12;tiff.writeUInt16LE(tag,at);tiff.writeUInt16LE(type,at+2);tiff.writeUInt32LE(count,at+4);
  if(typeof value==='string')tiff.write(value,at+8);else tiff.writeUInt32LE(value,at+8);
 }
 for(const [values,offset] of [[lat,80],[lon,104]])values.forEach((v,i)=>{tiff.writeUInt32LE(v,offset+i*8);tiff.writeUInt32LE(1,offset+i*8+4);});
 const exif=Buffer.concat([Buffer.from('Exif\0\0'),tiff]),head=Buffer.from([255,216,255,225,0,0]);head.writeUInt16BE(exif.length+2,4);
 return new File([head,exif,Buffer.from([255,217])],'field.jpg',{type:'image/jpeg'});
}
const resize=async file=>({id:crypto.randomUUID(),name:file.name,blob:new Blob(['small-photo']),thumbnail:new Blob(['thumb'])});

test('reads real EXIF GPS degrees and southern/western hemispheres',async()=>{
 assert.deepEqual(await readPhotoLocation(gpsJPEG()),{lat:-27.47,lng:153.03});
 assert.deepEqual(await readPhotoLocation(gpsJPEG([27,28,12],[153,1,48],'N','W')),{lat:27.47,lng:-153.03});
});
test('accepts genuine zero coordinates and reports missing or invalid metadata',async()=>{
 assert.deepEqual(await readPhotoLocation(gpsJPEG([0,0,0],[0,0,0])),{lat:-0,lng:0});
 assert.equal(await readPhotoLocation(new File(['no EXIF'],'plain.jpg')),null);
 assert.equal(await readPhotoLocation(gpsJPEG([95,0,0])),null);
});
test('photo drops retain GIS images with world files and GeoTIFFs as raster imports',()=>{
 const files=['photo.jpg','iphone.heic','map.png','map.pgw','aerial.tif','roads.geojson'].map(name=>new File([],name));
 const result=splitPhotoFiles(files);assert.deepEqual(result.photos.map(f=>f.name),['photo.jpg','iphone.heic']);assert.deepEqual(result.other.map(f=>f.name),['map.png','map.pgw','aerial.tif','roads.geojson']);
});
test('mixed drops send only non-photos to the GIS/cloud importer',async()=>{
 const calls=[],files=[gpsJPEG(),new File(['{}'],'roads.geojson')],drop={lat:1,lng:2};
 await routeMapFiles(files,{getScope:()=>1,importPhotos:async photos=>{calls.push(['photos',photos]);return true;},importLayers:async(layers,where)=>calls.push(['layers',layers,where])},drop);
 assert.deepEqual(calls,[['photos',[files[0]]],['layers',[files[1]],drop]]);
});
test('account/project change during photo import stops the remaining GIS import',async()=>{
 let scope='first',gisCalls=0;
 await routeMapFiles([gpsJPEG(),new File([],'roads.geojson')],{getScope:()=>scope,importPhotos:async()=>{scope='second';return true;},importLayers:async()=>gisCalls++});
 assert.equal(gisCalls,0);
});
test('metadata positions survive local resizing and persist only in the original scope',async()=>{
 const storage=createPersonalPinStore(indexedDB),scope=crypto.randomUUID();
 const result=await importPhotoBatch([gpsJPEG()],{scope,isCurrent:()=>true,storage,resize});
 assert.equal(result.saved.length,1);assert.equal(result.saved[0].locationSource,'metadata');
 const [pin]=await storage.list(scope);assert.equal(pin.lat,-27.47);assert.equal(pin.lng,153.03);assert.equal(pin.source,'photo');assert.equal(await pin.photos[0].blob.text(),'small-photo');assert.deepEqual(await storage.list(scope+'other'),[]);
});
test('photos without GPS wait for explicit placement instead of using the drop location',async()=>{
 let saved=0;
 const result=await importPhotoBatch([new File(['no metadata'],'plain.jpg')],{scope:'scope',isCurrent:()=>true,storage:{save:async()=>saved++},resize});
 assert.equal(saved,0);assert.equal(result.unlocated.length,1);assert.equal(result.unlocated[0].lat,undefined);assert.equal(result.unlocated[0].lng,undefined);
});
test('project change during resizing prevents a photo from being saved',async()=>{
 let current=true,saved=0;
 const result=await importPhotoBatch([gpsJPEG()],{scope:'scope',isCurrent:()=>current,storage:{save:async()=>saved++},resize:async file=>{current=false;return resize(file);}});
 assert.equal(result.cancelled,true);assert.equal(saved,0);
});
test('bad photos do not discard other successfully imported locations',async()=>{
 let saved=0;
 const result=await importPhotoBatch([new File(['bad'],'broken.jpg'),gpsJPEG()],{scope:'scope',isCurrent:()=>true,storage:{save:async()=>saved++},resize:async file=>{if(file.name==='broken.jpg')throw Error('Cannot decode');return resize(file);}});
 assert.equal(saved,1);assert.equal(result.errors.length,1);
});
test('resizing bounds both the local photo and thumbnail and releases the bitmap',async()=>{
 const canvases=[];let closed=false;
 const oldBitmap=globalThis.createImageBitmap,oldDocument=globalThis.document;
 globalThis.createImageBitmap=async()=>({width:6000,height:4000,close:()=>{closed=true;}});
 globalThis.document={createElement:()=>{const canvas={getContext:()=>({fillRect(){},drawImage(){}}),toBlob:callback=>callback(new Blob(['jpeg'],{type:'image/jpeg'}))};canvases.push(canvas);return canvas;}};
 try{await downscaleLocalPhoto(new File(['photo'],'field.jpg',{type:'image/jpeg'}));assert.deepEqual(canvases.map(c=>[c.width,c.height]),[[2048,1365],[256,171]]);assert.equal(closed,true);}
 finally{globalThis.createImageBitmap=oldBitmap;globalThis.document=oldDocument;}
});
