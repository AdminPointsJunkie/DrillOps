import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
test('planner drawing, incomplete shape guard, worker cancellation, result save and cleanup',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://example.test'});globalThis.document=dom.window.document;
 globalThis.__dialog=(title,body)=>{const d=document.createElement('dialog');d.innerHTML=`<form>${body}<p class="error"></p><button type="submit">Apply</button></form>`;d.close=()=>d.dispatchEvent(new dom.window.Event('close'));document.body.append(d);return d;};
 let worker,handler,saved,removed=0;globalThis.Worker=class{constructor(){worker=this;}postMessage(v){this.input=v;}terminate(){this.terminated=true;}};
 const group=()=>({addTo(){return this;},clearLayers(){}}),shape=()=>({addTo(){return this;},bindTooltip(){return this;},on(){return this;}}),L={layerGroup:group,marker:shape,polygon:shape,polyline:shape,geoJSON:shape,circleMarker:shape},map={on(k,fn){handler=fn;},off(){handler=null;},removeLayer(){removed++;}};
 let code=await fs.readFile(new URL('../src/pipeline-ui.js',import.meta.url),'utf8');code=code.replace("import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';","const toolDialog=globalThis.__dialog,esc=s=>String(s);").replace("import './pipeline.css';",'').replace("new URL('./pipeline-worker.js',import.meta.url)","'worker.js'");
 const {openPipeline}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));const d=openPipeline({map,L,canCreate:()=>true,onResult:async(...v)=>saved=v}),q=s=>d.querySelector(s),click=(x,y)=>handler({latlng:{lng:x,lat:y}});
 click(149,-22);click(149.001,-22);assert.equal(q('[data-mode=allowed]').getAttribute('aria-pressed'),'true');click(148.99,-22.01);q('[data-mode=cleared]').click();assert.match(q('.error').textContent,/Finish/);click(149.01,-22.01);click(149.01,-21.99);q('[data-finish]').click();
 Object.defineProperty(q('[name=dem]'),'files',{value:[{name:'terrain.tif',size:10,lastModified:1}]});q('[data-calculate]').click();assert.equal(worker.input.input.allowed.length,3);assert.equal(worker.input.input.maxGrade,0);q('[data-stop]').click();assert.ok(worker.terminated);
 q('[data-calculate]').click();worker.onmessage({data:{results:[{name:'Balanced',fc:{type:'FeatureCollection',features:[]},metrics:{length:100,newArea:1000,ascent:1,descent:2,maxUphill:2,maxGrade:3,lows:[],profile:[{distance:0,elevation:10},{distance:100,elevation:9}]}}]}});assert.equal(q('[type=submit]').disabled,false);assert.match(q('[data-results]').textContent,/100 m pipe/);q('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,0));assert.equal(saved[2].metadata.pipeline.dem.name,'terrain.tif');assert.equal(removed,2);assert.equal(handler,null);dom.window.close();delete globalThis.document;delete globalThis.Worker;delete globalThis.__dialog;
});
