import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {JSDOM} from 'jsdom';
import {openLiDAR} from '../src/lidar-ui.js';
import {readFileSync} from 'node:fs';
import {writeArrayBuffer} from 'geotiff';
import proj4 from 'proj4';
import {openDEM} from '../src/lidar-dem.js';
import {openCloudDEM,validateDEMCatalog,elevationColor} from '../src/lidar-cog.js';
import {rasterProjection} from '../src/raster-sample.js';
import {cloudDEMLayer} from '../src/cloud-dem-layer.js';

const tile=(id,x)=>({id,href:id+'.tif',crs:'EPSG:4326',bounds:[x,0,x+1,1],bbox:[x,0,x+1,1],width:256,height:256});
const catalog={type:'fieldmaps-dem-catalog',version:1,name:'Two tiles',bbox:[0,0,2,1],tiles:[tile('a',0),tile('b',1)]};
test('catalog loads no rasters until a sample intersects coverage, caches sources, preserves holes',async()=>{
 const opened=[],disposed=[];
 const dem=await openCloudDEM('https://example.com/dem/catalog.json',{fetcher:async()=>({ok:true,text:async()=>JSON.stringify(catalog)}),loadDEM:async url=>{opened.push(url);return {sample:async p=>p[0]===1.5?null:123,dispose:()=>disposed.push(url)};}});
 assert.equal(opened.length,0);assert.equal(await dem.sample([5,5]),null);assert.equal(opened.length,0);
 assert.equal(await dem.sample([.5,.5]),123);assert.equal(await dem.sample([.6,.5]),123);assert.equal(opened.length,1);
 assert.equal(await dem.sample([1.5,.5]),null);assert.equal(opened.length,2);
 dem.dispose();await Promise.resolve();assert.equal(disposed.length,2);await assert.rejects(dem.sample([.5,.5]),/closed/);
});
test('catalog rejects malformed bounds and credential-bearing tile URLs',()=>{
 assert.throws(()=>validateDEMCatalog({...catalog,tiles:[{...tile('a',0),bounds:[2,0,1,1]}]},'https://example.com/'),/bounds/);
 assert.throws(()=>validateDEMCatalog({...catalog,tiles:[{...tile('a',0),href:'https://user:secret@example.com/a.tif'}]},'https://example.com/'),/credentials/);
 assert.throws(()=>validateDEMCatalog({...catalog,tiles:[]},'https://example.com/'),/collection/);
});
test('AGD84 transform matches the installed EPSG/PROJ reference at Ironbark',()=>{
 const ll=proj4(rasterProjection(20355),'EPSG:4326',[620000,7595000]);
 assert.ok(Math.abs(ll[0]-148.1615249554814)<1e-8);assert.ok(Math.abs(ll[1]+21.74288675139833)<1e-8);
});
test('remote DEM uses bounded HTTP ranges and repeated point reads hit cache',async t=>{
 const bytes=readFileSync(new URL('./fixtures/cloud-dem.tif',import.meta.url));
 const ranges=[];let full=false;
 const server=http.createServer((req,res)=>{
  const match=/bytes=(\d+)-(\d+)/.exec(req.headers.range||'');if(!match){full=true;res.writeHead(400);res.end();return;}
  const start=Number(match[1]),end=Math.min(Number(match[2]),bytes.length-1);ranges.push([start,end]);
  res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});res.end(bytes.subarray(start,end+1));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const dem=await openDEM(`http://127.0.0.1:${server.address().port}/dem.tif`);t.after(()=>dem.dispose());
 assert.ok(Math.abs(await dem.sample(dem.coordinate(100,100))-123.5)<1e-6);const count=ranges.length;
 assert.ok(Math.abs(await dem.sample(dem.coordinate(100,100))-123.5)<1e-6);assert.equal(ranges.length,count);assert.equal(full,false);
 assert.ok(ranges.reduce((s,[a,b])=>s+b-a+1,0)<bytes.length*.8);
});
test('remote DEM refuses a server that sends the entire TIFF',async t=>{
 const bytes=Buffer.from(writeArrayBuffer(new Float32Array(9).fill(2),{width:3,height:3}));
 const server=http.createServer((req,res)=>{res.writeHead(200);res.end(bytes);});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 await assert.rejects(openDEM(`http://127.0.0.1:${server.address().port}/dem.tif`));
});
test('display colours preserve transparent NoData and clamp the chosen elevation range',()=>{
 assert.deepEqual(elevationColor(NaN,0,10),[0,0,0,0]);assert.deepEqual(elevationColor(0,0,10,'grey'),[0,0,0,255]);assert.deepEqual(elevationColor(20,0,10,'grey'),[255,255,255,255]);
});
test('saved layer defers reads while hidden and disposes a source hidden during load',async()=>{
 const handlers=new Map();let opened=0,disposed=0,rendered=0,resolve;
 const group={on(event,fn){handlers.set(event,fn);return this;},_map:{}};
 const module={openCloudDEM:()=>{opened++;return new Promise(r=>resolve=r);},cloudDEMOverlay:()=>{rendered++;return {dispose(){}};}};
 cloudDEMLayer({layerGroup:()=>group,latLngBounds:x=>x},{bounds:[0,0,1,1],metadata:{cloud_dem:{url:'https://example.com/catalog.json'}}},()=>{},{loadModule:async()=>module});
 assert.equal(opened,0);const adding=handlers.get('add')();await Promise.resolve();assert.equal(opened,1);
 handlers.get('remove')();resolve({dispose(){disposed++;}});await adding;assert.equal(disposed,1);assert.equal(rendered,0);
});

test('editing a cloud collection returns its current footprint without adding a duplicate',async()=>{
 const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.show=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const group={addTo(){return this;},clearLayers(){}};let saved,added=0,disposed=0;
 const source={name:'Replacement',url:'https://example.com/new.json',cloud:true,bounds:[10,20,11,21],width:64,height:64,code:4326,datum:'AHD',catalog:{tiles:[{}]},coordinate:(x,y)=>[10+x/63,21-y/63],dispose(){disposed++;}};
 const d=openLiDAR({L:{layerGroup:()=>group},map:{on(){},off(){},getContainer:()=>({style:{}}),removeLayer(){},fitBounds(){}},getLayers:()=>[],canCreate:()=>true,onResult:()=>{added++;},initialCloud:{url:source.url,mode:'grey',opacity:.5},loadCloudDEM:async()=>source,onSaveCloud:async(...args)=>{saved=args;}});
 d.querySelector('[name=showDEM]').checked=false;
 try{
  await new Promise(r=>setTimeout(r,0));await d.querySelector('[data-add-cloud]').onclick();
  assert.equal(added,0);assert.equal(saved[0].url,source.url);assert.equal(saved[0].mode,'grey');assert.deepEqual(saved[1].bounds,source.bounds);
  assert.deepEqual(saved[1].fc.features[0].geometry.coordinates[0],[[10,20],[11,20],[11,21],[10,21],[10,20]]);assert.equal(disposed,1);
 }finally{if(d.open)d.close();dom.window.close();}
});
test('a cold full-file response is cancelled and retried as a bounded range',async t=>{
 const bytes=readFileSync(new URL('./fixtures/cloud-dem.tif',import.meta.url));let requests=0,sent=0,cancelled=false;
 const server=http.createServer((req,res)=>{
  if(++requests===1){res.writeHead(200,{'Content-Length':bytes.length});res.flushHeaders();const timer=setInterval(()=>{const next=bytes.subarray(sent,sent+4096);sent+=next.length;res.write(next);if(sent>=bytes.length){clearInterval(timer);res.end();}},5);res.on('close',()=>{clearInterval(timer);cancelled=true;});return;}
  const match=/bytes=(\d+)-(\d+)/.exec(req.headers.range),start=Number(match[1]),end=Math.min(Number(match[2]),bytes.length-1);
  res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});res.end(bytes.subarray(start,end+1));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const dem=await openDEM(`http://127.0.0.1:${server.address().port}/dem.tif`);t.after(()=>dem.dispose());
 assert.ok(Math.abs(await dem.sample(dem.coordinate(100,100))-123.5)<1e-6);assert.ok(requests>=2);assert.ok(cancelled);assert.ok(sent<bytes.length/2);
});
test('incorrect partial-response offsets are rejected before decoding',async t=>{
 const server=http.createServer((req,res)=>{res.writeHead(206,{'Content-Range':'bytes 10-20/100','Content-Length':11});res.end(Buffer.alloc(11));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 await assert.rejects(openDEM(`http://127.0.0.1:${server.address().port}/dem.tif`));
});
