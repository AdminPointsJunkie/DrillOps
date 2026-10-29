import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {annotationFeature,annotationURL,annotationLayer,installFieldTools,editAnnotation} from '../src/field-tools.js';

test('annotation types keep geometry and safe media URLs through serialization',()=>{
 for(const type of ['text','note','link','video']){
  const f=annotationFeature(type,[[153,-27]],'A <label>',{url:'https://example.com/video.mp4'});
  assert.equal(JSON.parse(JSON.stringify(f)).geometry.type,'Point');
  if(['link','video'].includes(type))assert.equal(f.properties.url,'https://example.com/video.mp4');
 }
 for(const type of ['marker','highlighter']){
  assert.equal(annotationFeature(type,[[153,-27],[153.01,-27.01]],'Stroke').geometry.type,'LineString');
  assert.throws(()=>annotationFeature(type,[[153,-27],[153,-27]],'Stroke'),/distinct/);
 }
 for(const url of ['javascript:alert(1)','data:text/html,test','file:///tmp/test','https://user:secret@example.com','no address'])assert.throws(()=>annotationURL(url));
});

test('media renderer uses safe DOM content, direct video controls and a new-tab link',()=>{
 const dom=new JSDOM();globalThis.document=dom.window.document;
 try{let options,popup,tooltip;const l={bindTooltip(t){tooltip=t;},bindPopup(p){popup=p;},on(){}};
  const L={geoJSON(fc,o){options=o;o.onEachFeature(fc.features[0],l);return {};},marker(){},divIcon(){}};
  const feature=annotationFeature('video',[[153,-27]],'<img src=x onerror=alert(1)>',{url:'https://example.com/clip.mp4'});
  annotationLayer(L,{name:'Video',color:'#315d49',metadata:{annotation:{type:'video'}},fc:{features:[feature]}});
  assert.equal(tooltip.querySelector('img'),null);assert.match(tooltip.textContent,/<img/);
  assert.equal(popup.querySelector('video').preload,'none');assert.equal(popup.querySelector('video').controls,true);
  assert.equal(popup.querySelector('a').rel,'noopener noreferrer');assert.equal(popup.querySelector('a').target,'_blank');
  feature.properties.url='javascript:alert(1)';annotationLayer(L,{name:'Bad link',metadata:{annotation:{type:'link'}},fc:{features:[feature]}});assert.equal(popup.querySelector('a'),null);
 }finally{dom.window.close();delete globalThis.document;}
});

test('freehand stroke saves, restores map dragging and link validation does not save bad URLs',async()=>{
 const dom=new JSDOM('<div class="map-area"><div id="map"></div></div>');globalThis.document=dom.window.document;
 const q=s=>document.querySelector(s),canvas=q('#map');let dragging=true,saved=[];const handlers={};
 const map={on:(n,f)=>handlers[n]=f,getContainer:()=>canvas,mouseEventToLatLng:e=>({lng:e.clientX/10,lat:e.clientY/10}),dragging:{enabled:()=>dragging,disable:()=>dragging=false,enable:()=>dragging=true},removeLayer(){}};
 const make=()=>({addTo(){return this;}}),L={layerGroup:make,circleMarker:make,polyline:make,polygon:make};
 const tools=installFieldTools({L,map,canAnnotate:()=>true,hasProject:()=>true,onAnnotation:async x=>saved.push(x),notify(){}});
 try{
  tools.open('annotation','highlighter');q('[data-annotation-name]').value='Highlight';q('[data-annotation-note]').value='Access corridor';
  canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown',{clientX:10,clientY:10,button:0}));assert.equal(dragging,false);
  canvas.dispatchEvent(new dom.window.MouseEvent('pointermove',{clientX:20,clientY:20}));canvas.dispatchEvent(new dom.window.MouseEvent('pointerup'));assert.equal(dragging,true);
  q('[data-tool-finish]').click();await new Promise(r=>setTimeout(r,0));assert.equal(saved.length,1);assert.deepEqual(saved[0].feature.geometry.coordinates,[[1,1],[2,2]]);
  tools.open('annotation','link');q('[data-annotation-name]').value='Site';q('[data-annotation-note]').value='Read site instructions';q('[data-annotation-url]').value='javascript:alert(1)';handlers.click({latlng:{lng:153,lat:-27}});
  q('[data-tool-finish]').click();await new Promise(r=>setTimeout(r,0));assert.equal(saved.length,1);assert.match(q('[data-tool-error]').textContent,/http/);
  q('[data-annotation-url]').value='https://example.com/instructions';q('[data-tool-finish]').click();await new Promise(r=>setTimeout(r,0));assert.equal(saved[1].feature.properties.url,'https://example.com/instructions');
  tools.open('annotation','marker');canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown',{clientX:10,clientY:10,button:0}));tools.reset();assert.equal(dragging,true);
 }finally{dom.window.close();delete globalThis.document;}
});
