import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {openAnalysis} from '../src/analysis-ui.js';
const fc={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[151,-33]},properties:{v:1}}]};
test('analysis preview is temporary, invalidates on parameter changes and adds only on explicit acceptance',async()=>{
 const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new dom.window.Event('close'));};
 let worker,added=0,previews=0,cleared=0;globalThis.Worker=class{constructor(){worker=this;}postMessage(data){this.input=data;}terminate(){this.stopped=true;}};
 const layer={id:'source',name:'Survey',fc};const d=openAnalysis('buffer',{getLayers:()=>[layer],canCreate:()=>true,onPreview:()=>{previews++;return ()=>cleared++;},onResult:async(result,name,options)=>{added++;assert.equal(result,fc);assert.equal(options.metadata.analysis.operation,'buffer');assert.deepEqual(options.metadata.analysis.source_ids,['source']);}});
 const submit=()=>d.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));submit();worker.onmessage({data:{result:fc}});assert.equal(previews,1);assert.equal(added,0);assert.equal(d.querySelector('[type=submit]').textContent,'Add result layer');
 d.querySelector('[name=distance]').dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(cleared,1);assert.equal(d.querySelector('[type=submit]').textContent,'Preview result');
 submit();worker.onmessage({data:{result:fc}});submit();await Promise.resolve();await Promise.resolve();assert.equal(added,1);assert.equal(cleared,2);
 const c=openAnalysis('bounds',{getLayers:()=>[layer],canCreate:()=>true,onResult:()=>added++});c.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));const old=worker;c.close();old.onmessage({data:{result:fc}});assert.equal(added,1);assert.equal(old.stopped,true);
 dom.window.close();delete globalThis.document;delete globalThis.Worker;
});
