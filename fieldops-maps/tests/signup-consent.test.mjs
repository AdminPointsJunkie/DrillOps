import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installSignupConsent,TERMS_VERSION,validPhone} from '../src/signup-consent.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
function setup(state={complete:false}){const dom=new JSDOM('<body></body>',{url:'https://www.drillops.com.au/maps/'}),doc=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};let user={id:'test',email:'person@example.test',user_metadata:{full_name:'Test Person'}};const calls=[];const db={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='fieldmaps_signup_status'?state:{complete:true,...args}};}};const ui=installSignupConsent({db,doc,getUser:()=>user});return {ui,doc,calls,user,changeUser:()=>user=null};}
test('onboarding requires explicit terms and phone, defaults marketing off, preserves verified email',async()=>{const {ui,doc,calls,user}=setup();await ui.check(user);const f=doc.querySelector('form');assert.equal(f.elements.email.readOnly,true);assert.equal(f.elements.terms.required,true);assert.equal(f.elements.terms.checked,false);assert.equal(f.elements.marketing.checked,false);assert.equal(f.elements.phone.required,true);f.dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();assert.equal(calls.length,1);f.elements.phone.value='+61 400 123 456';f.elements.terms.checked=true;f.dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();assert.deepEqual(calls[1],['complete_fieldmaps_signup',{p_name:'Test Person',p_phone:'+61 400 123 456',p_terms_version:TERMS_VERSION,p_marketing:false}]);assert.equal(doc.querySelector('dialog'),null);});
test('workspace off preserves individual opt-in but suppresses marketing separately',async()=>{const {ui,doc,calls}=setup({complete:true,marketing_opt_in:true,marketing_enabled:true});await ui.openSettings();const f=doc.querySelector('form');f.elements.enabled.checked=false;f.dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();assert.deepEqual(calls[1],['set_fieldmaps_marketing',{p_opt_in:true,p_enabled:false}]);});
test('account changes cannot submit another person’s details',async()=>{const {ui,doc,calls,user,changeUser}=setup();await ui.check(user);const f=doc.querySelector('form');f.elements.phone.value='0400123456';f.elements.terms.checked=true;changeUser();f.dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();assert.equal(calls.length,1);});
test('phone validation accepts formatted international numbers and rejects incomplete numbers',()=>{assert.equal(validPhone('+61 (0) 400 123 456'),true);assert.equal(validPhone('123'),false);assert.equal(validPhone('1234567890123456'),false);});
test('completed accounts never open onboarding during a slow check or a fresh page load',async()=>{
 for(let load=0;load<2;load++){
  const {doc,user}=setup();let resolve,calls=0,opened=0;
  doc.defaultView.HTMLDialogElement.prototype.showModal=function(){opened++;this.open=true;};
  const ui=installSignupConsent({doc,getUser:()=>user,db:{rpc:()=>{calls++;return new Promise(r=>resolve=r);}}});
  const first=ui.check(user),second=ui.check(user);
  assert.equal(doc.querySelector('dialog'),null);assert.equal(calls,1);
  resolve({data:{complete:true}});assert.equal(await first,true);assert.equal(await second,true);
  assert.equal(opened,0);assert.equal(await ui.check(user),true);assert.equal(calls,1);
 }
});
test('overlapping sign-in checks still show the form for an incomplete account',async()=>{
 const {doc,user}=setup();let resolve;
 const ui=installSignupConsent({doc,getUser:()=>user,db:{rpc:()=>new Promise(r=>resolve=r)}});
 const a=ui.check(user),b=ui.check(user);resolve({data:{complete:false}});await Promise.all([a,b]);
 assert.equal(doc.querySelector('h2').textContent,'Your DrillOps account');assert.ok(doc.querySelector('input[name=terms]'));
});
test('a response arriving after sign-out cannot reopen onboarding',async()=>{
 const {doc,user,changeUser}=setup();let resolve;
 const ui=installSignupConsent({doc,getUser:()=>user,db:{rpc:()=>new Promise(r=>resolve=r)}});
 const a=ui.check(user);changeUser();await ui.check(null);resolve({data:{complete:false}});await a;assert.equal(doc.querySelector('dialog'),null);
});
