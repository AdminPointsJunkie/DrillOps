import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {mapCoordinates,locationLinks} from '../src/map-coordinates.js';
import {pastedFeatures} from '../src/map-paste.js';
const catalogue=JSON.parse(await readFile(new URL('../public/crs.json',import.meta.url),'utf8'));
test('coordinate display uses CRS axis format and transforms the position, while links retain WGS84',async()=>{
 assert.equal((await mapCoordinates({lat:-27.24936,lng:153.01415})).text,'-27.24936, 153.01415');
 let args;const engine=async()=>({gdaltransform:async(...a)=>{args=a;return [[501400.12345,6986000.4567]];}});
 const result=await mapCoordinates({lat:-27,lng:153},'EPSG:7856',catalogue,engine);
 assert.equal(result.text,'501400.123, 6986000.457');assert.match(result.axes,/metre/);assert.deepEqual(args,[[[153,-27]],['-s_srs','EPSG:4326','-t_srs','EPSG:7856','-output_xy']]);
 const geographic=await mapCoordinates({lat:-27,lng:153},'EPSG:4283',catalogue,async()=>({gdaltransform:async()=>[[153,-27]]}));assert.equal(geographic.text,'-27.00000, 153.00000');
 assert.match(locationLinks({lat:-27,lng:513},15)[0][1],/query=-27,153$/);
 await assert.rejects(mapCoordinates({lat:-27,lng:153},'EPSG:7856',catalogue,async()=>({gdaltransform:async()=>[[NaN,Infinity]]})),/unavailable/);
});
test('Paste here preserves relative geometry, attributes and elevations and rejects invalid coordinates',()=>{
 const fc={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Example'},geometry:{type:'LineString',coordinates:[[150,-20,5],[152,-22,6]]}}]};
 const result=pastedFeatures(JSON.stringify(fc),{lat:-27,lng:153});assert.deepEqual(result.fc.features[0].geometry.coordinates,[[152,-26,5],[154,-28,6]]);assert.equal(result.fc.features[0].properties.name,'Example');assert.deepEqual(result.bounds,[152,-28,154,-26]);assert.deepEqual(fc.features[0].geometry.coordinates,[[150,-20,5],[152,-22,6]]);
 assert.equal(pastedFeatures('A comment',{lat:0,lng:0}),null);assert.throws(()=>pastedFeatures(JSON.stringify(fc),{lat:90,lng:153}),/outside/);
});
test('menu actions use right-click position, permissions, external links and dismiss stale requests',async()=>{
 const dom=new JSDOM('<div id="map"></div>',{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,handlers={},calls=[];
 const source=(await readFile(new URL('../src/map-context.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function','function');
 Object.assign(w,{locationLinks,canEdit:true});w.eval(source+';window.install=installMapContext;');
 let resolve;const map={on:(event,fn)=>{handlers[event]=fn;},getContainer:()=>w.document.querySelector('#map'),getZoom:()=>14};
 const menu=w.install({map,coordinates:()=>new Promise(r=>resolve=r),canEdit:()=>w.canEdit,comment:at=>calls.push(['comment',at]),measure:(kind,at)=>calls.push([kind,at]),compare:()=>calls.push(['compare']),paste:(text,at)=>calls.push([text,at]),notify:()=>{}});
 const event={latlng:{lat:-27,lng:153},containerPoint:{x:40,y:40},originalEvent:{clientX:40,clientY:40}};
 const pending=handlers.contextmenu(event);resolve({text:'123, 456',label:'EPSG:7856',axes:'X, Y'});await pending;
 assert.equal(w.document.querySelector('[data-copy]').textContent,'123, 456');assert.match(w.document.querySelector('[data-links] a').href,/query=-27,153/);
 w.document.querySelector('[data-measure=area]').click();assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['area',{lat:-27,lng:153}]]);assert.equal(w.document.querySelector('.map-context').hidden,true);
 const stale=handlers.contextmenu(event);menu.close();resolve({text:'stale',label:'bad',axes:''});await stale;assert.notEqual(w.document.querySelector('[data-copy]').textContent,'stale');
 w.canEdit=false;const readonly=handlers.contextmenu(event);resolve({text:'ok',label:'ok',axes:''});await readonly;assert.ok(w.document.querySelector('[data-paste]').disabled);assert.ok(w.document.querySelector('[data-comment]').disabled);dom.window.close();
});
