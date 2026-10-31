import test from 'node:test';import assert from 'node:assert/strict';
import {selectionInBounds} from '../src/map-selection.js';import {extractedFeature} from '../src/feature-extract.js';
const f=(geometry,properties={name:'Original'})=>({type:'Feature',properties,geometry});
const layer=(id,features)=>({id,kind:'vector',fc:{type:'FeatureCollection',features}});
test('drag selection finds points and crossing lines across visible layers',()=>{const a=layer('a',[f({type:'Point',coordinates:[1,1]}),f({type:'Point',coordinates:[5,5]})]),b=layer('b',[f({type:'LineString',coordinates:[[-1,1],[4,1]]})]),hidden=layer('hidden',[f({type:'Point',coordinates:[1,1]})]);assert.deepEqual(selectionInBounds([a,b,hidden],[0,0,2,2],l=>l.id!=='hidden').map(s=>[s.layer.id,s.index]),[['a',0],['b',0]]);});
test('selection does not hit empty polygon holes or just overlapping bounding boxes',()=>{const polygon=f({type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[2,8],[8,8],[8,2],[2,2]]]}),diagonal=f({type:'LineString',coordinates:[[0,0],[10,10]]});assert.equal(selectionInBounds([layer('hole',[polygon])],[3,3,4,4]).length,0);assert.equal(selectionInBounds([layer('diagonal',[diagonal])],[0,8,2,10]).length,0);});
test('image selection uses bounds, excludes tile services and invisible imagery',()=>{const raster={id:'r',kind:'raster',bounds:[0,0,3,3]},tiles={...raster,id:'tiles',metadata:{xyz:{}}};assert.deepEqual(selectionInBounds([raster,tiles],[1,1,2,2]).map(s=>[s.layer.id,s.index]),[['r',null]]);});
test('Extract keeps polygon holes, altitude and attributes independently of its source',()=>{const source=f({type:'Polygon',coordinates:[[[0,0,3],[10,0,3],[10,10,3],[0,10,3],[0,0,3]],[[2,2,3],[2,8,3],[8,8,3],[8,2,3],[2,2,3]]]}, {name:'Original',count:8,_fieldmaps_files:[{path:'existing'}]});source.id='source';const copy=extractedFeature(source);assert.equal(copy.id,undefined);assert.deepEqual(copy.geometry,source.geometry);copy.properties.name='Copy';copy.geometry.coordinates[0][0][2]=7;assert.equal(source.properties.name,'Original');assert.equal(source.geometry.coordinates[0][0][2],3);assert.deepEqual(copy.properties._fieldmaps_files,source.properties._fieldmaps_files);});
test('drag selection respects the same feature filter as the map',()=>{const l=layer('filtered',[f({type:'Point',coordinates:[1,1]},{show:false}),f({type:'Point',coordinates:[1.1,1]},{show:true})]);assert.deepEqual(selectionInBounds([l],[0,0,2,2],()=>true,(_l,f)=>f.properties.show).map(s=>s.index),[1]);});

test('selection reset preserves other tools and refresh drops hidden features',async()=>{
 const {JSDOM}=await import('jsdom');const {installMapSelection}=await import('../src/map-selection.js');
 const dom=new JSDOM('<div class="map-area"><div class="map-tools"></div><div id="map"></div></div>');const previous=globalThis.document;globalThis.document=dom.window.document;
 try{
  let dragging=true,boxZoom=true,visible=true;const paneOptions=[];
  const rendered=options=>({addTo(){paneOptions.push(options);return this;},clearLayers(){}});
  const L={layerGroup:()=>rendered({}),geoJSON:(_f,options)=>rendered(options),rectangle:(_b,options)=>rendered(options)};
  const map={createPane:()=>({style:{}}),getContainer:()=>document.querySelector('#map'),dragging:{enabled:()=>dragging,enable:()=>dragging=true,disable:()=>dragging=false},boxZoom:{enabled:()=>boxZoom,enable:()=>boxZoom=true,disable:()=>boxZoom=false}};
  const l=layer('a',[f({type:'Point',coordinates:[1,1]})]);
  const selection=installMapSelection({L,map,getLayers:()=>[l],isVisible:()=>visible,canEdit:()=>true,notify(){}});
  document.querySelector('#map-select-tool').click();assert.equal(dragging,false);assert.equal(boxZoom,false);
  selection.select(l,0);assert.equal(document.querySelector('[data-count]').textContent,'1 selected');assert.equal(paneOptions.at(-1).pane,'map-selection');
  visible=false;selection.refresh();assert.equal(document.querySelector('[data-count]').textContent,'Select features');
  selection.reset();assert.equal(dragging,true);assert.equal(boxZoom,true);
  dragging=false;selection.reset();assert.equal(dragging,false,'inactive selector must not enable panning over another tool');
 }finally{globalThis.document=previous;dom.window.close();}
});
