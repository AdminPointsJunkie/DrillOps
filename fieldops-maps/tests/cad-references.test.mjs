import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {matchCADReference,readDWGReferences} from '../src/cad-references.js';
import {createReferenceResolver} from '../src/cad-reference-dialog.js';
const file=name=>new File(['AC1032 test'],name),ref={key:'["Survey"]',name:'Survey',path:'C:\\Mine\\CAD\\survey.dwg',included:false};
test('reference matching uses stored paths and refuses ambiguous filenames',()=>{
 const a=file('survey.dwg'),b=file('survey.dwg');Object.defineProperty(a,'webkitRelativePath',{value:'Mine/CAD/survey.dwg'});Object.defineProperty(b,'webkitRelativePath',{value:'Old/survey.dwg'});
 assert.equal(matchCADReference(ref,[a,b]),a);assert.equal(matchCADReference({...ref,path:'survey.dwg'},[a,b]),null);assert.equal(matchCADReference(ref,[b]),b);assert.equal(matchCADReference(ref,[file('other.dwg')]),null);
});
test('nested references prompt once and keep original bytes and source indices for rebuilding',async()=>{
 const root=file('host.dwg'),child=file('survey.dwg'),nested=file('survey.dwg'),sub={key:'["Survey","Nested"]',name:'Nested',path:'other/survey.dwg'};let prompts=0;
 const dwg=async(_file,_progress,{references})=>({file:file('combined.dxf'),references:[{...ref,included:references.some(r=>r.key===ref.key)},...(references.length?[{...sub,included:references.some(r=>r.key===sub.key)}]:[])]});
 const result=await readDWGReferences(root,()=>{},{dwg,resolveReferences:async({references})=>{prompts++;return references.map(r=>({key:r.key,file:r.key===ref.key?child:nested,origin:'Library'}));}});
 assert.equal(prompts,2);assert.equal(result.originals.length,3);assert.notEqual(result.originals[1].name,result.originals[2].name);assert.equal(await result.originals[1].text(),await child.text());assert.deepEqual(result.references.map(r=>r.fileIndex),[1,2]);
 const again=await readDWGReferences(root,()=>{},{dwg,saved:result,sourceFiles:result.originals,resolveReferences:()=>{throw Error('Should not prompt again');}});assert.ok(again.references.every(r=>r.included));
 await assert.rejects(readDWGReferences(root,()=>{},{dwg,saved:result,sourceFiles:[root]}),/missing/);
});
test('cancel aborts the drawing and skipped files never enter the reference bundle',async()=>{
 const root=file('host.dwg'),dwg=async()=>({references:[ref]});
 await assert.rejects(readDWGReferences(root,()=>{},{dwg,resolveReferences:async()=>null}),/cancelled/);
 const result=await readDWGReferences(root,()=>{},{dwg,resolveReferences:async()=>[]});assert.equal(result.originals.length,1);assert.equal(result.references[0].included,false);
});
test('reference dialog shows stored path, library matches, inclusion and cancel without auto-reading files',async()=>{
 const dom=new JSDOM('<body></body>'),w=dom.window;globalThis.document=w.document;globalThis.window=w;
 w.HTMLDialogElement.prototype.show=w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 const row={id:'one',name:'Current survey',presentation:{drawing:{filename:'survey.dwg'}}};let loads=0;
 const resolve=createReferenceResolver({library:{listDrawings:async()=>[row],loadDrawing:async()=>{loads++;return file('survey.dwg');}}});
 const pending=resolve({drawing:'host.dwg',references:[ref]});await new Promise(r=>setTimeout(r,0));const d=w.document.querySelector('dialog');assert.equal(d.querySelector('[readonly]').value,ref.path);assert.match(d.textContent,/matching drawing/);assert.equal(loads,0);assert.equal(d.querySelector('[data-include]').disabled,true);
 const select=d.querySelector('select');select.value='one';select.dispatchEvent(new w.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0));assert.equal(loads,1);assert.equal(d.querySelector('[data-include]').checked,true);d.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));const choices=await pending;assert.equal(choices[0].origin,'Library · Current survey');
 const cancel=resolve({drawing:'host.dwg',references:[ref]});w.document.querySelector('dialog').close();assert.equal(await cancel,null);dom.window.close();delete globalThis.document;delete globalThis.window;
});
