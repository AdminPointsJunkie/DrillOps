import test from 'node:test';
import assert from 'node:assert/strict';
import {startSocialAuth,providerOptions} from '../src/social-auth.js';
test('existing users link identities without replacing their user or memberships',async()=>{
 const calls=[];const db={auth:{getUser:async()=>({data:{user:{id:'existing-user'}}}),linkIdentity:async value=>{calls.push(value);return {data:{}};},signInWithOAuth:()=>assert.fail('Linking must not sign in as another user')}};
 await startSocialAuth(db,'github',{userId:'existing-user',redirectTo:'https://example.test/maps/?auth_flow=link'});
 assert.equal(calls.length,1);assert.equal(calls[0].provider,'github');assert.equal(calls[0].options.scopes,'read:user user:email');
});
test('linking is blocked if the signed-in user changed',async()=>{
 const db={auth:{getUser:async()=>({data:{user:{id:'different'}}}),linkIdentity:()=>assert.fail('Must not link to a different user')}};
 await assert.rejects(startSocialAuth(db,'google',{userId:'original'}),/sign-in changed/);
});
test('normal provider login uses OAuth and never modifies workspace permissions',async()=>{
 let request;const db={auth:{signInWithOAuth:async value=>{request=value;return {data:{}};}}};
 await startSocialAuth(db,'azure',{redirectTo:'https://example.test/maps/'});
 assert.equal(request.provider,'azure');assert.equal(request.options.scopes,'email');assert.equal(request.options.queryParams.prompt,'select_account');
});
test('provider failures are surfaced and unsupported providers rejected',async()=>{
 assert.throws(()=>providerOptions('unknown','https://example.test'),/Unknown/);
 await assert.rejects(startSocialAuth({auth:{signInWithOAuth:async()=>({error:Error('disabled')})}},'google',{}),/disabled/);
});
import {JSDOM} from 'jsdom';
import {installSocialAuth} from '../src/social-auth.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
test('callback verifies original user and linked provider; does not accept switched accounts',async()=>{
 for(const same of [true,false]){
  const dom=new JSDOM('<section></section>',{url:'https://example.test/maps/?auth_flow=link'}),win=dom.window,notes=[];let opened=0;
  win.sessionStorage.setItem('fieldmaps.identity-link',JSON.stringify({userId:'owner',provider:'google',at:Date.now()}));
  const user={id:same?'owner':'other',identities:[{provider:'google'}]};
  const ui=installSocialAuth({db:{auth:{getUser:async()=>({data:{user}})}},url:'https://auth.example.test',key:'public',doc:win.document,notify:m=>notes.push(m),openAccount:()=>opened++});
  await ui.finish(user);await ui.finish(user);
  assert.equal(opened,same?1:0);assert.equal(notes.length,1);assert.equal(win.sessionStorage.getItem('fieldmaps.identity-link'),null);assert.equal(win.location.search,'');
  assert.match(notes[0],same?/account linked/:/original account/);dom.window.close();
 }
});
test('unconfigured and already linked providers cannot start OAuth',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({external:{google:true,github:false,azure:false}})});
 try{const dom=new JSDOM('<section></section>',{url:'https://example.test/maps/'}),container=dom.window.document.querySelector('section');
 const ui=installSocialAuth({db:{auth:{}},url:'https://auth.example.test',key:'public',doc:dom.window.document});ui.mount(container,{id:'owner',identities:[{provider:'google'}]});await tick();
 assert.equal([...container.querySelectorAll('button')].every(b=>b.disabled),true);assert.match(container.textContent,/Google · Linked/);assert.match(container.textContent,/GitHub · Coming soon/);dom.window.close();
 }finally{globalThis.fetch=original;}
});
test('cancelled linking reports failure without claiming project changes',async()=>{
 const dom=new JSDOM('<section></section>',{url:'https://example.test/maps/?auth_flow=link#error=access_denied&error_description=Cancelled'}),notes=[];
 const ui=installSocialAuth({db:{auth:{getUser:()=>assert.fail('No verification on denied callback')}},url:'https://auth.example.test',key:'public',doc:dom.window.document,notify:m=>notes.push(m)});await ui.finish({id:'owner'});assert.match(notes[0],/not linked.*Cancelled/);dom.window.close();
});
