import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {readAuthLink,installPasswordSetup} from '../src/password-setup.js';
function setup(context={},needs=true){
 const dom=new JSDOM('<button id="set-password" hidden></button><dialog id="password-dialog"><h2></h2><p class="field-note"></p><form id="password-form"><input id="new-password"><input id="confirm-password"><div id="password-error"></div><button id="save-password"></button></form></dialog><dialog id="auth"><div id="auth-error"></div></dialog>');
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const doc=dom.window.document,state={user:{id:'u',email:'invite@example.test'},needs,updates:0,error:null};
 const db={rpc:async()=>({data:state.needs}),auth:{updateUser:async()=>{state.updates++;return {error:state.error};}}};
 return {doc,state,flow:installPasswordSetup(db,context,()=>state.user,()=>{},doc)};
}
test('valid invite opens create password and refresh without URL still resumes unfinished setup',async()=>{
 for(const context of [readAuthLink('https://example.test/maps/#access_token=test&type=invite'),{}]){
  const {doc,state,flow}=setup(context);await flow.onSession('INITIAL_SESSION',{user:state.user});assert.equal(doc.querySelector('#password-dialog').open,true);assert.match(doc.querySelector('h2').textContent,/Create/);assert.equal(doc.querySelector('#set-password').hidden,false);
 }
});
test('expired invite shows actionable error without opening password for an existing admin session',async()=>{
 const context=readAuthLink('https://example.test/maps/#error=access_denied&error_code=otp_expired&type=invite');const {doc,state,flow}=setup(context,false);
 await flow.onSession('INITIAL_SESSION',{user:state.user});assert.equal(doc.querySelector('#auth-link-error').open,true);assert.equal(doc.querySelector('#password-dialog').open,false);assert.equal(state.updates,0);
});
test('password mismatch and server failure stay visible; successful save clears credentials and setup button',async()=>{
 const {doc,state,flow}=setup();await flow.onSession('SIGNED_IN',{user:state.user});const submit=()=>doc.querySelector('form').onsubmit({preventDefault(){}});
 doc.querySelector('#new-password').value='long-secret-password';doc.querySelector('#confirm-password').value='different';await submit();assert.equal(state.updates,0);
 doc.querySelector('#confirm-password').value='long-secret-password';state.error={message:'Try again'};await submit();assert.equal(doc.querySelector('#password-dialog').open,true);assert.equal(doc.querySelector('#save-password').disabled,false);
 state.error=null;await submit();assert.equal(doc.querySelector('#password-dialog').open,false);assert.equal(doc.querySelector('#new-password').value,'');assert.equal(doc.querySelector('#set-password').hidden,true);
});
test('recovery opens reset UI; sign out clears password fields',async()=>{
 const {doc,state,flow}=setup({},false);await flow.onSession('PASSWORD_RECOVERY',{user:state.user});assert.match(doc.querySelector('h2').textContent,/Reset/);doc.querySelector('#new-password').value='secret';state.user=null;await flow.onSession('SIGNED_OUT',null);assert.equal(doc.querySelector('#password-dialog').open,false);assert.equal(doc.querySelector('#new-password').value,'');
});
