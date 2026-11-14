import test from 'node:test';
import assert from 'node:assert/strict';
import {profileData,saveProfile,marketingLabel} from '../src/account-profile.js';
const user={id:'person',email:'old@example.com',user_metadata:{}};
const fields={name:' Ryan ',email:'new@example.com',phone:'',title:'',marketing:false};
function fixture({fail=false,current='person'}={}){const calls=[];const bucket={upload:async(path)=>{calls.push(['upload',path]);return{};},remove:async paths=>{calls.push(['remove',paths]);return{};}};return {calls,db:{storage:{from:()=>bucket},auth:{getUser:async()=>({data:{user:{id:current}}}),updateUser:async payload=>{calls.push(['update',payload]);return fail?{error:Error('Save failed')}:{data:{user:{...user,user_metadata:payload.data,new_email:'new@example.com'}}};}}}};}
test('marketing defaults off and records explicit consent or withdrawal',()=>{const p=profileData(user,fields,'now');assert.equal(p.marketing_opt_in,false);assert.equal(p.full_name,'Ryan');const yes=profileData(user,{...fields,marketing:true},'now');assert.equal(yes.marketing_consent_text,marketingLabel);assert.equal(yes.marketing_preference_updated_at,'now');assert.equal(profileData({...user,user_metadata:{marketing_opt_in:true}},fields).marketing_opt_in,false);});
test('profile save requests verified email change and uploads photo in own folder',async()=>{globalThis.location={href:'https://www.drillops.com.au/maps/'};const {db,calls}=fixture();const result=await saveProfile(db,user,fields,{photo:new Blob(['test'])});assert.equal(result.emailPending,true);assert.match(calls[0][1],/^person\//);assert.equal(calls[1][1].email,'new@example.com');assert.equal(calls[1][1].data.marketing_opt_in,false);assert.equal(calls[1][1].app_metadata,undefined);});
test('failed save cleans up newly uploaded photo and retains original',async()=>{const {db,calls}=fixture({fail:true});await assert.rejects(saveProfile(db,{...user,user_metadata:{avatar_path:'person/old.jpg'}},fields,{photo:new Blob(['test'])}),/Save failed/);assert.equal(calls.at(-1)[0],'remove');assert.notEqual(calls.at(-1)[1][0],'person/old.jpg');});
test('account switch cannot save details to a different user',async()=>{const {db,calls}=fixture({current:'other'});await assert.rejects(saveProfile(db,user,fields),/sign-in changed/);assert.equal(calls.length,0);});
test('removing photo clears metadata and removes only owned photo',async()=>{const {db,calls}=fixture();await saveProfile(db,{...user,user_metadata:{avatar_path:'person/old.jpg'}},fields,{removePhoto:true});assert.equal(calls[0][1].data.avatar_path,null);assert.deepEqual(calls[1],['remove',['person/old.jpg']]);});

import {JSDOM} from 'jsdom';
import {installAccountProfile} from '../src/account-profile.js';
import {installPanelStack} from '../src/panel-stack.js';
test('account settings is a full page and restores the map and home when leaving',async()=>{
 const dom=new JSDOM('<body class="project-home-open"><div id="app" inert><section class="attribute-table">Map table</section></div><section class="project-home">Home</section></body>',{url:'https://example.test/maps/'});globalThis.document=dom.window.document;
 try{
  installPanelStack(document);const ui=installAccountProfile({db:fixture().db,getUser:()=>user});
  const d=ui.open();await Promise.resolve();assert.equal(d.tagName,'SECTION');assert.equal(d.id,'account-settings-page');assert.equal(d.hasAttribute('popover'),false);assert.equal(document.querySelector('dialog'),null);
  assert.equal(document.querySelector('.project-home').hasAttribute('inert'),true);assert.ok(document.body.classList.contains('account-settings-open'));assert.equal(dom.window.location.hash,'#account/profile');
  let mapKeys=0;document.addEventListener('keydown',()=>mapKeys++);d.querySelector('[data-dismiss]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Delete',bubbles:true}));assert.equal(mapKeys,0);assert.equal(d.querySelector('[name=email]').value,user.email);ui.close();assert.equal(d.isConnected,false);
  assert.equal(document.querySelector('.project-home').hasAttribute('inert'),false);assert.equal(document.querySelector('#app').hasAttribute('inert'),true,'preserve home ownership of map inert state');assert.equal(dom.window.location.hash,'');
  const next=ui.open();assert.equal(next.isConnected,true);next.querySelector('[data-dismiss]').click();await new Promise(r=>setTimeout(r,30));assert.equal(next.isConnected,false);assert.equal(dom.window.location.hash,'');
 }finally{dom.window.close();delete globalThis.document;}
});

test('Billing and Usage live in Account settings and preserve unsaved profile details',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://example.test/maps/'});globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const calls=[];const db=fixture().db;db.rpc=async name=>{calls.push(name);return {data:{projects:[],file_bytes:0,file_count:0,upload_bytes:0}};};
 try{
  const ui=installAccountProfile({db,getUser:()=>user}),d=ui.open();d.querySelector('[name=full_name]').value='Unsaved name';
  d.querySelector('[data-account-tab=billing]').click();assert.equal(d.querySelector('[data-account-page=billing]').hidden,false);assert.match(d.textContent,/Payments are not active yet/);assert.equal(d.querySelector('[type=submit]').hidden,true);
  d.querySelector('[data-account-tab=usage]').click();await new Promise(r=>setTimeout(r,0));assert.deepEqual(calls,['account_usage']);assert.match(d.textContent,/do not own any projects/);
  d.querySelector('[data-account-tab=profile]').click();assert.equal(d.querySelector('[name=full_name]').value,'Unsaved name');assert.equal(d.querySelector('[type=submit]').hidden,false);ui.close();
 }finally{dom.window.close();delete globalThis.document;}
});


test('account URLs restore the page, browser Back leaves and Forward reopens it',async()=>{
 const dom=new JSDOM('<body><div id="app">Map with unsaved changes</div></body>',{url:'https://example.test/maps/'});globalThis.document=dom.window.document;
 try{
  const ui=installAccountProfile({db:fixture().db,getUser:()=>user}),d=ui.open('billing');
  assert.equal(dom.window.location.hash,'#account/billing');assert.equal(d.querySelector('[data-account-page=billing]').hidden,false);
  dom.window.history.back();await new Promise(r=>setTimeout(r,30));assert.equal(document.querySelector('#account-settings-page'),null);assert.equal(document.querySelector('#app').hasAttribute('inert'),false);assert.match(document.querySelector('#app').textContent,/unsaved changes/);
  dom.window.history.forward();await new Promise(r=>setTimeout(r,30));assert.equal(document.querySelector('[data-account-page=billing]').hidden,false);ui.close();
  dom.window.history.replaceState(null,'','#account/profile');ui.restore();assert.equal(document.querySelector('[data-account-page=profile]').hidden,false);ui.close();
 }finally{dom.window.close();delete globalThis.document;}
});
