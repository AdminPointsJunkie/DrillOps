import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {createLocalWorkspace} from '../src/local-workspace.js';
import {xyzSettings,xyzLayer} from '../src/xyz.js';
import {importCRS,projectCRS} from '../src/project.js';
import {installBasemaps} from '../src/basemaps.js';
import {vectorStyle,pointMarker,styleControls,visibilityIcon} from '../src/layer-style.js';

test('XYZ validates templates, transport and zoom; escapes provider attribution',()=>{
 const url='https://{s}.example.com/{z}/{x}/{y}{r}.png?key=browser-key';
 assert.equal(xyzSettings({url}).url,url);
 for(const bad of ['http://example.com/{z}/{x}/{y}', 'javascript:alert(1)', 'https://example.com/{z}/{x}', 'https://user:pass@example.com/{z}/{x}/{y}', 'https://example.com/{z}/{x}/{y}?key={secret}'])assert.throws(()=>xyzSettings({url:bad}));
 assert.throws(()=>xyzSettings({url,minZoom:5,maxZoom:4}));
 assert.throws(()=>xyzSettings({url,maxZoom:23}));
 let options;
 xyzLayer({tileLayer:(u,o)=>{options=o;return {once(){}};}},{name:'Test',opacity:.4,metadata:{xyz:{url,attribution:'<img onerror=bad>',maxZoom:18}}});
 assert.equal(options.opacity,.4);assert.equal(options.maxNativeZoom,18);
 assert.equal(options.attribution,'&lt;img onerror=bad&gt;');
});

test('XYZ add, save, edit, visibility, target, opacity and project reload never download a raster',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://example.test/maps/',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const db=createLocalWorkspace(new IDBFactory());
 db.storage.from=()=>{throw Error('XYZ must not upload or download raster blobs');};
 const project=(await db.from('maps').insert({name:'XYZ project'}).single()).data;
 const calls=[],views=[];
 const layer=()=>({addTo(){return this;},once(){return this;},getBounds(){return {};}});
 const map={setView(center,zoom){views.push({center,zoom});return this;},on(){},removeLayer(){},fitBounds(){},getCenter:()=>({lat:-22,lng:148}),getZoom:()=>12,
  getBounds:()=>({getWest:()=>147,getSouth:()=>-23,getEast:()=>149,getNorth:()=>-21})};
 const L={GridLayer:{extend:()=>function(){return layer();}},map:()=>map,tileLayer:(url,options)=>{calls.push({url,options});return layer();},layerGroup:layer,
  control:{zoom:layer,scale:layer},latLngBounds:()=>({extend(){},isValid:()=>false})};
 Object.assign(w,{L,LOCAL_TESTING:true,createLocalWorkspace:()=>db,xyzSettings,xyzLayer,importCRS,projectCRS,installBasemaps,
  vectorStyle,pointMarker,styleControls,visibilityIcon,errorText:e=>e.message,fetch:async()=>({json:async()=>[]})});
 const source=(await readFile(new URL('../src/main.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.env.BASE_URL',"'/maps/'");
 w.eval(source);
 const $=s=>w.document.querySelector(s),tick=()=>new Promise(r=>setTimeout(r,30));
 const submit=()=>$('#xyz-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 try{
  await tick();$('#add-xyz').click();$('#xyz-name').value='Site imagery';$('#xyz-url').value='https://tiles.example.com/{z}/{x}/{y}.png';submit();await tick();
  assert.equal($('#xyz-dialog').open,false);assert.match($('#layers').textContent,/XYZ tiles/);
  let saved=(await db.from('layers').select().eq('map_id',project.id).order()).data[0];
  assert.equal(saved.metadata.xyz.url,'https://tiles.example.com/{z}/{x}/{y}.png');assert.equal(saved.opacity,1);
  assert.equal($('#layers [data-action=export]'),null);
  $('#layers [data-action=visibility]').click();await tick();
  assert.equal($('#layers [data-action=visibility]').getAttribute('aria-pressed'),'false');
  $('#layers [data-action=zoom]').click();await tick();assert.deepEqual(Array.from(views.at(-1).center),[-22,148]);assert.equal(views.at(-1).zoom,12);
  const opacity=$('#layers [data-action=opacity]');opacity.value='.35';opacity.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
  $('#layers [data-action=edit-xyz]').click();$('#xyz-url').value='https://tiles.example.com/missing';submit();await tick();assert.match($('#xyz-error').textContent,/Include/);
  $('#xyz-url').value='https://tiles.example.com/new/{z}/{x}/{y}.png';$('#xyz-name').value='Updated imagery';submit();await tick();
  $('#refresh').click();await tick();
  assert.match($('#layers').textContent,/Updated imagery/);assert.equal($('#layers [data-action=opacity]').value,'0.35');
  assert.equal(calls.at(-1).url,'https://tiles.example.com/new/{z}/{x}/{y}.png');assert.equal(calls.at(-1).options.opacity,.35);
 }finally{w.close();}
});
