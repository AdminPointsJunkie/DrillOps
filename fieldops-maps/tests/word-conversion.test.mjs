import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function session({blocked=false}={}){
 const channels=[],timers=new Map(),opened=[];let next=0;
 const source=(await readFile(new URL('../src/word-conversion.js',import.meta.url),'utf8')).replaceAll('export ','').replace("import.meta.env?.BASE_URL","'/maps/'");
 const context={crypto:{randomUUID:()=> 'test-session'},URL,File,Uint8Array,location:{origin:'https://example.invalid'},window:{open:(url)=>{opened.push(url);return blocked?null:{};}},setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),setInterval:fn=>{timers.set(++next,fn);return next;},clearInterval:id=>timers.delete(id),BroadcastChannel:class {constructor(){this.messages=[];channels.push(this);}postMessage(data){assert.ok(!this.closed);this.messages.push(data);}close(){this.closed=true;}}};
 const start=runInNewContext(source+';startWordConversion',context),progress=[],conversion=start({progress:(...args)=>progress.push(args)}),channel=channels[0];
 return {conversion,channel,timers,opened,progress,send:data=>channel.onmessage({data})};
}

test('popup handshake converts sequential Word files and forwards progress without uploading originals',async()=>{
 const s=await session();s.send({type:'ready'});
 for(const name of ['old.doc','new.docx']){
  const result=s.conversion.convert(new File(['word'],name));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.channel.messages.at(-1).type,'convert');assert.equal(s.channel.messages.at(-1).name,name);
  s.send({type:'progress',message:'Converting to PDF',value:75});s.send({type:'result',name:name+'.pdf',bytes:new Uint8Array([37,80,68,70,45])});
  const file=await result;assert.equal(file.type,'application/pdf');assert.equal(await file.text(),'%PDF-');
 }
 assert.equal(s.progress.length,2);s.conversion.finish();assert.equal(s.channel.closed,true);assert.equal(s.timers.size,0);
});

test('blocked popup can be reopened and cancellation rejects a file waiting for readiness',async()=>{
 const s=await session({blocked:true});assert.equal(s.conversion.popup,null);s.conversion.open();assert.equal(s.opened.length,2);
 const promise=s.conversion.convert(new File(['x'],'a.docx'));s.conversion.cancel();await assert.rejects(promise,/cancelled/);assert.equal(s.timers.size,0);
});

test('cancel while reading file never dispatches bytes to the closed converter',async()=>{
 const s=await session();s.send({type:'ready'});let resolveRead;
 const promise=s.conversion.convert({name:'a.docx',arrayBuffer:()=>new Promise(resolve=>resolveRead=resolve)});
 await new Promise(resolve=>setImmediate(resolve));s.conversion.cancel();resolveRead(new ArrayBuffer(1));await assert.rejects(promise,/cancelled/);assert.ok(!s.channel.messages.some(m=>m.type==='convert'));
});

test('engine errors and stalled initialization release the session instead of leaving a pending upload',async()=>{
 for(const error of [true,false]){
  const s=await session();const promise=s.conversion.convert(new File(['x'],'a.docx'));
  if(error)s.send({type:'error',message:'Engine failed'});else [...s.timers.values()][0]();
  await assert.rejects(promise,error?/Engine failed/:/did not respond/);assert.equal(s.channel.closed,true);assert.equal(s.timers.size,0);
 }
});

test('build patches the pinned upstream browser startup and worker pool without changing WASM',async()=>{
 const script=await readFile(new URL('../scripts/prepare-office.mjs',import.meta.url),'utf8');
 const worker=await readFile(new URL('../node_modules/@matbee/libreoffice-converter/dist/browser.worker.global.js',import.meta.url),'utf8');
 const glue=await readFile(new URL('../node_modules/@matbee/libreoffice-converter/wasm/soffice.js',import.meta.url),'utf8');
 assert.equal(worker.split('self.Module={mainScriptUrlOrBlob:').length,2);assert.equal(glue.split('var pthreadPoolSize=4;').length,2);
 assert.match(script,/noInitialRun:true/);assert.match(script,/var pthreadPoolSize=8;/);
 const entry=await readFile(new URL('../public/office/convert.js',import.meta.url),'utf8');const sw=await readFile(new URL('../public/office/isolation-sw.js',import.meta.url),'utf8');
 assert.match(entry,/runtime-2\.7\.2-fm3/);assert.match(sw,/runtime-2\.7\.2-fm3/);
});
