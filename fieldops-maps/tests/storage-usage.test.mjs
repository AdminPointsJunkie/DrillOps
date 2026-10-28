import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installStorageUsage} from '../src/storage-usage.js';
test('company usage requests only the selected workspace, displays current storage and never invents billing usage',async()=>{
 const dom=new JSDOM(''),doc=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};let company={id:'a',name:'Example company'},fail=false;const calls=[];
 const ui=installStorageUsage({rpc:async(n,p)=>{calls.push([n,p]);return fail?{error:{message:'Unavailable'}}:{data:{file_bytes:2048,file_count:2,vector_bytes:100}};}},{doc,getWorkspace:()=>company});
 await ui.open();assert.deepEqual(calls[0],['workspace_usage',{p_workspace:'a'}]);assert.match(doc.body.textContent,/2.0 KiB/);assert.match(doc.body.textContent,/Not yet metered/);fail=true;await ui.open();assert.match(doc.body.textContent,/Unavailable/);ui.close();assert.equal(doc.querySelector('#storage-usage').textContent,'');company=null;await ui.open();assert.equal(calls.length,2);
});
