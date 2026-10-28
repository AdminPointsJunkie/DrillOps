import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installAccounts} from '../src/accounts.js';
import {inviteHandler} from '../supabase/functions/maps-invite/handler.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
test('workspace settings scope writes, protect owner and platform accounts, and preserve errors',async()=>{
 const dom=new JSDOM('<button id="people">People</button>'),doc=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const calls=[];let fail=false;
 const state={workspace:{id:'w',name:'Company'},role:'owner',people:[{id:'self',email:'admin@test',name:'Admin',role:'owner',status:'active',projects:[],platform_admin:true},{id:'other',email:'<img src=x>',name:'Test',role:'operator',status:'active',projects:['p']}],projects:[{id:'p',name:'Project'}],invitations:[],events:[]};
 const db={rpc:async(name,args)=>{calls.push([name,args]);if(name==='workspace_settings')return {data:state};return fail?{error:{message:'Denied'}}:{data:{}};}};
 installAccounts(db,()=>({id:'self'}),doc,{getWorkspace:()=>state.workspace,getContext:()=>({platform_admin:true,workspaces:[{id:'w',name:'Company',status:'active'}]})});await doc.querySelector('#people').onclick();doc.querySelector('[data-tab=people]').click();
 assert.equal(doc.querySelector('img'),null);assert.equal(doc.querySelector('[data-member=self] button').disabled,true);
 let form=doc.querySelector('[data-member=other]');form.onsubmit({preventDefault(){}});await tick();
 const write=calls.find(c=>c[0]==='workspace_mutate')[1];assert.equal(write.p_workspace,'w');assert.equal(write.p_action,'member');assert.deepEqual(write.p_payload.projects,['p']);
 fail=true;form=doc.querySelector('[data-member=other]');form.onsubmit({preventDefault(){}});await tick();assert.match(doc.querySelector('[data-message]').textContent,/Denied/);assert.equal(form.querySelector('button').disabled,false);
 doc.querySelector('[data-tab=projects]').click();assert.ok(doc.querySelector('[data-project=p]'));assert.equal(doc.querySelector('[data-tab=companies]'),null);
 dom.window.close();
});
test('invitation endpoint authorizes the stored company invitation and never trusts a submitted recipient',async()=>{
 let invited=0,magic=0,admin=false,authenticated=true,existing=false,delivery=[];
 const factory=(_url,key)=>key==='service'?{auth:{admin:{inviteUserByEmail:async email=>{assert.equal(email,'stored@example.test');invited++;return {data:{user:{id:'b'}}};}},signInWithOtp:async args=>{assert.equal(args.email,'stored@example.test');assert.equal(args.options.shouldCreateUser,false);magic++;return {data:{}};}},rpc:async(_name,args)=>{delivery.push(args);return {data:null};}}:{auth:{getUser:async()=>({data:{user:authenticated?{id:'a'}:null}})},rpc:async()=>admin?{data:{email:'stored@example.test',name:'Stored',attempt:'attempt',existing}}:{error:{message:'Workspace admin required'}}};
 const handler=inviteHandler(factory,{SUPABASE_SERVICE_ROLE_KEY:'service'}),request=()=>new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({invitation_id:'eeb0cc03-b303-4a01-a101-000000000001',email:'attacker@example.test'})});
 assert.equal((await handler(request())).status,403);assert.equal(invited,0);
 admin=true;authenticated=false;assert.equal((await handler(request())).status,401);assert.equal(invited,0);
 authenticated=true;assert.equal((await handler(request())).status,200);assert.equal(invited,1);assert.equal(delivery[0].p_ok,true);
 existing=true;assert.equal((await handler(request())).status,200);assert.equal(magic,1);assert.equal(invited,1);
});
test('company admin cannot see platform tools and recipient acceptance uses only invitation ID',async()=>{
 const dom=new JSDOM('<button id="people">Settings</button>'),doc=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const calls=[],state={workspace:{id:'w',name:'Company'},role:'admin',people:[{id:'owner',name:'Owner',email:'owner@test',role:'owner',status:'active',projects:[]}],projects:[],invitations:[],events:[]};
 const db={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='workspace_settings'?state:{id:'w'}};}};
 const ui=installAccounts(db,()=>({id:'admin'}),doc,{getWorkspace:()=>state.workspace,getContext:()=>({platform_admin:false})});await doc.querySelector('#people').onclick();doc.querySelector('[data-tab=people]').click();assert.equal(doc.querySelector('[data-tab=companies]'),null);assert.equal(doc.querySelector('[data-member=owner] button').disabled,true);
 await ui.openInvitations([{id:'invite',workspace:'Company',role:'operator',expires_at:'2030-01-01'}]);doc.querySelector('[data-accept]').click();await tick();assert.deepEqual(calls.at(-1)[1],{p_workspace:null,p_action:'accept',p_payload:{id:'invite'}});dom.window.close();
});
