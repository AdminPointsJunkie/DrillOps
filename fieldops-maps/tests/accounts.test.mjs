import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installAccounts} from '../src/accounts.js';
import {inviteHandler} from '../supabase/functions/maps-invite/handler.js';
test('account editor saves operator assignments, protects self and reports failures',async()=>{
 const dom=new JSDOM('<button id="people">People</button>'),doc=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const calls=[];let fail=false;
 const db={rpc:async(name,args)=>{calls.push([name,args]);if(name==='maps_accounts')return {data:{people:[{id:'self',email:'admin@test',role:'admin'},{id:'other',email:'<img src=x>',name:'Test',role:'operator',projects:['p']}],projects:[{id:'p',name:'Project'}]}};return fail?{error:{message:'Denied'}}:{data:null};}};
 installAccounts(db,()=>({id:'self'}),doc);await doc.querySelector('#people').onclick();
 assert.equal(doc.querySelector('img'),null);assert.equal(doc.querySelector('[data-person=self] button').disabled,true);
 let form=doc.querySelector('[data-person=other]');form.onsubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls.find(c=>c[0]==='maps_update_account')[1].p_projects,['p']);
 fail=true;form=doc.querySelector('[data-person=other]');form.onsubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,0));assert.match(doc.querySelector('#people-message').textContent,/Denied/);assert.equal(form.querySelector('button').disabled,false);
});
test('invitation endpoint requires authenticated live admin before using service credentials',async()=>{
 let invited=0,admin=false,authenticated=true;
 const factory=()=>({auth:{getUser:async()=>({data:{user:authenticated?{id:'a'}:null}}),admin:{inviteUserByEmail:async()=>{invited++;return {data:{user:{id:'b'}}};}}},rpc:async()=>({data:admin})});
 const handler=inviteHandler(factory,{}),request=()=>new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({email:'person@example.test',name:'Person'})});
 assert.equal((await handler(request())).status,403);assert.equal(invited,0);
 admin=true;authenticated=false;assert.equal((await handler(request())).status,401);assert.equal(invited,0);
 authenticated=true;assert.equal((await handler(request())).status,200);assert.equal(invited,1);
});
