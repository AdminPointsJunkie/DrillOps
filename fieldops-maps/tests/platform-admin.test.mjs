import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installPlatformAdmin,storageSize} from '../src/platform-admin.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
test('platform dashboard refuses non-admins, shows usage and people, filters and scopes company access changes',async()=>{
 const dom=new JSDOM(''),doc=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};dom.window.confirm=()=>true;
 let platform=false,fail=false;const calls=[],managed=[];const company={id:'company-a',name:'<Company A>',status:'active',created_at:new Date().toISOString(),users:1,active_users:1,projects:2,file_count:2,file_bytes:3072,vector_bytes:100,features:4,pending_invitations:0,people:[{id:'u',name:'Person',email:'person@example.invalid',role:'owner',status:'active',verified:true}],signup_source:'Self-service'};
 const db={rpc:async(n,p)=>{calls.push([n,p]);if(n==='workspace_mutate'){if(fail)return {error:{message:'Access update failed'}};company.status=p.p_payload.status;return {};}return {data:{companies:[company],total_users:1,total_file_bytes:4096,unassigned_file_bytes:1024,generated_at:new Date().toISOString()}};}};
 const ui=installPlatformAdmin(db,{doc,isPlatform:()=>platform,manageCompany:async id=>managed.push(id)});await ui.open();assert.equal(calls.length,0);platform=true;await ui.open();assert.match(doc.body.textContent,/3.0 KiB/);assert.equal(doc.querySelector('company'),null);
 doc.querySelector('[data-detail]').click();doc.querySelector('[data-manage]').click();assert.deepEqual(managed,['company-a']);assert.match(doc.body.textContent,/person@example.invalid/);
 fail=true;doc.querySelector('[data-access]').click();await tick();assert.match(doc.querySelector('[data-status]').textContent,/failed/);assert.equal(company.status,'active');
 fail=false;doc.querySelector('[data-access]').click();await tick();assert.equal(company.status,'suspended');assert.deepEqual(calls.filter(c=>c[0]==='workspace_mutate').at(-1)[1],{p_workspace:'company-a',p_action:'status',p_payload:{status:'suspended'}});
 const search=doc.querySelector('[data-search]');search.value='no match';search.dispatchEvent(new dom.window.Event('input'));assert.match(doc.body.textContent,/No matching companies/);ui.close();assert.equal(doc.querySelector('#platform-dashboard').textContent,'');
 assert.equal(storageSize(1024**3),'1.0 GiB');
});
