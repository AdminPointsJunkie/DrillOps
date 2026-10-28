import test from 'node:test';
import assert from 'node:assert/strict';
import {memberReportHTML} from '../src/member-report.js';
import {reportWebDevice} from '../src/device-reporting.js';
test('web reports use a stable random reference and never claim offline sync; failures do not block viewing',async()=>{
 const values=new Map(),calls=[];const env={localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789abc'},navigator:{userAgent:'Windows Edge'}};
 const db={rpc:async(name,args)=>{calls.push({name,args});return {};}};
 assert.equal(await reportWebDevice(db,'company',null,env),true);
 await reportWebDevice(db,'company','release',env);
 assert.equal(calls[0].args.p_device,calls[1].args.p_device);
 assert.equal(calls[1].args.p_release,'release');assert.equal(calls[1].args.p_mode,'viewed');
 assert.equal(await reportWebDevice({rpc:async()=>{throw Error('Offline');}},'company',null,env),false);
});
test('member report distinguishes web views, outdated offline copies, absent reports and escapes client input',()=>{
 const html=memberReportHTML({people:[{name:'<img src=x>',devices:[{details:{model:'<script>'},maps:[{name:'Map',version:1,latest_version:2,mode:'offline'},{name:'Map',version:2,latest_version:2,mode:'viewed'}]}]},{name:'No app',devices:[]}]});
 assert.ok(html.includes('Offline SYNC · Update available'));assert.ok(html.includes('Viewed · Up to date'));assert.ok(html.includes('No device report yet.'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x>'));
});

import {JSDOM} from 'jsdom';
import {installAccounts} from '../src/accounts.js';
test('platform-selected company opens usage tab; refresh errors remain visible',async()=>{
 const dom=new JSDOM('<button id="people">Settings</button>'),doc=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let fail=false;const calls=[];
 const db={rpc:async(name,args)=>{calls.push([name,args]);return name==='workspace_settings'?{data:{workspace:{id:args.p_workspace,name:'Selected company'},people:[],projects:[],invitations:[],events:[]}}:fail?{error:{message:'Access revoked'}}:{data:{people:[],unattributed_file_bytes:0}};}};
 const ui=installAccounts(db,()=>({id:'admin'}),doc,{getWorkspace:()=>({id:'different-company'}),getContext:()=>({platform_admin:true,workspaces:[]})});
 await ui.openWorkspace('selected-company','usage');await new Promise(r=>setTimeout(r,0));
 assert.equal(calls.at(-1)[0],'workspace_member_report');assert.equal(calls.at(-1)[1].p_workspace,'selected-company');assert.match(doc.querySelector('[data-report]').textContent,/No members/);
 fail=true;doc.querySelector('[data-report-refresh]').click();await new Promise(r=>setTimeout(r,0));assert.equal(doc.querySelector('[data-report]').textContent,'Access revoked');
 ui.close();dom.window.close();
});
