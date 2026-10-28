import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installRegistration} from '../src/registration.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
function setup(db,user={id:'new',user_metadata:{full_name:'New Owner',new_company_name:'New Company',registration_flow:'company'}}){
 const dom=new JSDOM('<dialog id="auth"><form id="auth-form"></form></dialog>');const doc=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const created=[];const ui=installRegistration(db,{doc,getUser:()=>user,onCreated:async id=>created.push(id)});return {ui,doc,created,user};
}
test('public signup records company intent, requires 12 characters, and offers verification resend without retaining password',async()=>{
 const calls=[];const {ui,doc}=setup({auth:{signUp:async p=>{calls.push(p);return {data:{session:null}};},resend:async p=>{calls.push(p);return {};}}});ui.open(true);
 doc.querySelector('#email').value='new@example.invalid';doc.querySelector('#password').value='long-password';doc.querySelector('#registration-name').value='New Owner';doc.querySelector('#registration-company').value='Company';
 assert.equal(doc.querySelector('#password').minLength,12);doc.querySelector('#auth-form').dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();
 assert.equal(calls[0].options.data.new_company_name,'Company');assert.equal(calls[0].options.data.registration_flow,'company');assert.equal(doc.querySelector('#password').value,'');assert.equal(doc.querySelector('#resend-confirmation').hidden,false);
 doc.querySelector('#resend-confirmation').click();await tick();assert.equal(calls[1].type,'signup');assert.match(doc.querySelector('#auth-error').textContent,/newest link/);
});
test('automatic provisioning runs once, skips invitations and existing accounts, and retries visibly after failure',async()=>{
 const calls=[];let fail=true;const {ui,doc,user,created}=setup({rpc:async(n,p)=>{calls.push([n,p]);return fail?{error:{message:'Temporary connection failure'}}:{data:'new-company'};}});
 const ctx={can_create_company:true,workspaces:[],invitations:[]};assert.equal(await ui.ensureWorkspace({...ctx,invitations:[{id:'inv'}]},user),null);assert.equal(calls.length,0);
 assert.equal(await ui.ensureWorkspace({...ctx,workspaces:[{id:'old'}]},user),null);assert.equal(calls.length,0);
 await ui.ensureWorkspace(ctx,user);assert.equal(calls.length,1);assert.equal(doc.querySelector('#company-onboarding').open,true);assert.match(doc.querySelector('#company-onboarding').textContent,/Temporary connection failure/);
 await ui.ensureWorkspace(ctx,user);assert.equal(calls.length,1);fail=false;doc.querySelector('#company-onboarding form').dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();assert.deepEqual(created,['new-company']);assert.equal(doc.querySelector('#company-onboarding').open,false);
});
test('email sign-in cannot silently create an incomplete account',async()=>{
 let request;const {ui,doc}=setup({auth:{signInWithOtp:async p=>{request=p;return {};}}});ui.open();doc.querySelector('#email').value='existing@example.invalid';doc.querySelector('#email-link').click();await tick();assert.equal(request.options.shouldCreateUser,false);
});
