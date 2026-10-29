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
test('existing testers can sign in and legacy signup mode exposes no registration controls',async()=>{
 const calls=[];const {ui,doc}=setup({auth:{signInWithPassword:async p=>{calls.push(p);return {data:{session:{}}};},signUp:()=>assert.fail('Public registration must not be called')}});ui.open(true);
 assert.equal(doc.querySelector('#signup'),null);assert.equal(doc.querySelector('#registration-fields'),null);assert.equal(doc.querySelector('#company-onboarding'),null);
 assert.match(doc.body.textContent,/Coming soon/);
 doc.querySelector('#email').value='tester@example.invalid';doc.querySelector('#password').value='test-password';
 doc.querySelector('#auth-form').dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();
 assert.deepEqual(calls,[{email:'tester@example.invalid',password:'test-password'}]);assert.equal(doc.querySelector('#password').value,'');assert.equal(doc.querySelector('#auth').open,false);
});
test('email sign-in cannot silently create an incomplete account',async()=>{
 let request;const {ui,doc}=setup({auth:{signInWithOtp:async p=>{request=p;return {};}}});ui.open();doc.querySelector('#email').value='existing@example.invalid';doc.querySelector('#email-link').click();await tick();assert.equal(request.options.shouldCreateUser,false);
});
