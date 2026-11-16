import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {installPasswordVisibility,installResetRequest,PASSWORD_RESET_REDIRECT} from '../src/password-controls.js';
import {installRegistration} from '../src/registration.js';
import {installAccounts} from '../src/accounts.js';
import {installSetupPage} from '../src/setup-page.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
const dialogs=win=>{win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};win.HTMLDialogElement.prototype.close=function(){this.open=false;};};
test('eye toggles the chosen password without changing it or submitting, and reset hides it',()=>{
 const win=new JSDOM('<form><input type="password" value="secret"><input type="password"></form>').window,form=win.document.querySelector('form');installPasswordVisibility(form);installPasswordVisibility(form);
 const input=form.querySelector('input'),button=form.querySelector('button');assert.equal(form.querySelectorAll('button').length,2);assert.equal(button.type,'button');button.click();assert.equal(input.type,'text');assert.equal(input.value,'secret');assert.equal(button.getAttribute('aria-label'),'Hide password');assert.equal(form.querySelectorAll('input')[1].type,'password');form.reset();assert.equal(input.type,'password');assert.equal(button.getAttribute('aria-pressed'),'false');win.close();
});
test('forgot password only needs a valid email and reports failures without claiming success',async()=>{
 const win=new JSDOM('<dialog id="auth"><form id="auth-form"></form></dialog>',{url:'https://example.test/maps/'}).window;dialogs(win);let calls=[];
 installRegistration({auth:{resetPasswordForEmail:async(...args)=>{calls.push(args);return {error:{message:'Please wait before requesting another email.'}};}}},{doc:win.document});
 win.document.querySelector('#forgot-password').click();await tick();assert.equal(calls.length,0);
 win.document.querySelector('#email').value='operator@example.test';win.document.querySelector('#forgot-password').click();await tick();assert.deepEqual(calls,[['operator@example.test',{redirectTo:PASSWORD_RESET_REDIRECT}]]);assert.match(win.document.querySelector('#auth-error').textContent,/Please wait/);assert.equal(win.document.querySelector('#password').value,'');win.close();
});
test('standalone reset blocks duplicate requests and permits retry',async()=>{
 const win=new JSDOM(await readFile(new URL('../reset.html',import.meta.url),'utf8')).window;let release,calls=0;
 installResetRequest({auth:{resetPasswordForEmail:()=>{calls++;return new Promise(r=>release=r);}}},win.document);const form=win.document.querySelector('form');form.elements.email.value='operator@example.test';const event={preventDefault(){}};
 const pending=form.onsubmit(event);await form.onsubmit(event);assert.equal(calls,1);assert.equal(form.querySelector('button').disabled,true);release({error:null});await pending;assert.match(win.document.querySelector('#reset-status').textContent,/If an account exists/);assert.equal(form.querySelector('button').disabled,false);win.close();
});
test('admin reset uses stored member email, leaves settings edits and own session alone, and excludes viewers',async()=>{
 for(const role of ['owner','admin','operator']){
  const win=new JSDOM('<button id="people"></button>').window;dialogs(win);let calls=[];
  const state={workspace:{id:'w',name:'Project'},role,people:[{id:'operator',email:'stored@example.test',name:'Operator',role:'operator',status:'active',projects:[]}],projects:[],invitations:[],events:[]};
  const db={rpc:async name=>({data:name==='workspace_settings'?state:[]}),auth:{resetPasswordForEmail:async(...args)=>{calls.push(args);return {};}}};
  const ui=installAccounts(db,()=>({id:'admin'}),win.document,{getWorkspace:()=>state.workspace});await ui.openWorkspace('w','people');
  const button=win.document.querySelector('[data-reset-password]');if(role==='operator'){assert.equal(button,null);win.close();continue;}
  win.document.querySelector('[name=name]').value='Unsaved edit';await button.onclick();assert.deepEqual(calls,[['stored@example.test',{redirectTo:PASSWORD_RESET_REDIRECT}]]);assert.equal(win.document.querySelector('[name=name]').value,'Unsaved edit');assert.match(win.document.querySelector('[data-message]').textContent,/stored@example.test/);win.close();
 }
});
test('recovery link establishes recipient session on another device before changing password',async()=>{
 const win=new JSDOM(await readFile(new URL('../setup.html',import.meta.url),'utf8'),{url:'https://example.test/maps/setup.html#type=recovery&access_token=test&refresh_token=test-refresh'}).window;
 let current={id:'admin'},updates=[];const operator={id:'operator',email:'operator@example.test',app_metadata:{fieldmaps_app_only:true}};
 const db={auth:{setSession:async args=>{assert.equal(args.access_token,'test');current=operator;return {data:{user:operator}};},getUser:async()=>({data:{user:current}}),updateUser:async args=>{updates.push([current.id,args]);return {};}}};
 await installSetupPage(db,win);const doc=win.document;assert.equal(win.location.hash,'');assert.match(doc.querySelector('h1').textContent,/Reset/);doc.querySelector('#setup-password').value='new-long-password';doc.querySelector('#setup-confirm').value='different-password';await doc.querySelector('form').onsubmit({preventDefault(){}});assert.equal(updates.length,0);
 doc.querySelector('#setup-confirm').value='new-long-password';await doc.querySelector('form').onsubmit({preventDefault(){}});assert.deepEqual(updates,[['operator',{password:'new-long-password'}]]);assert.match(doc.querySelector('#setup-continue').href,/6796881116/);win.close();
});
