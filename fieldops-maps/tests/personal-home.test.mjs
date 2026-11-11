import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {installProjectHome} from '../src/project-home.js';import {mountSharing} from '../src/project-sharing.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
test('Personal home opens projects, then only the available maps; map-only viewers cannot create or share projects',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://example.test'}),old=globalThis.document;globalThis.document=dom.window.document;
 try{let selected;const project={id:'argo',name:'Argo NR',access:'map',role:'map_viewer'};
 const home=installProjectHome({getState:()=>({user:{id:'viewer'},workspace:project,workspaces:[project],projects:[{id:'map-one',name:'Shared survey'}],canCreate:false,admin:false}),onWorkspace:async id=>{selected=id;},onResume(){}});
 home.open();assert.equal(document.querySelector('h1').textContent,'My workspace');assert.equal(document.querySelectorAll('[data-workspace]').length,1);assert.equal(document.querySelector('[data-project]'),null);
 document.querySelector('[data-workspace]').click();await tick();assert.equal(selected,'argo');assert.equal(document.querySelectorAll('[data-project]').length,1);assert.equal(document.querySelector('[data-new]'),null);assert.equal(document.querySelector('[data-share-project]'),null);assert.match(document.body.textContent,/Shared maps/);
 document.querySelector('[data-section=projects]').click();assert.equal(document.querySelectorAll('[data-workspace]').length,1);
 }finally{globalThis.document=old;}
});
test('Map sharing grants exact email view access and removes the chosen recipient',async()=>{
 const dom=new JSDOM('<section></section>'),container=dom.window.document.querySelector('section'),calls=[];
 await mountSharing(container,{db:{rpc:async(name,args)=>{calls.push({name,args});return {data:args.p_action==='grant'?[{id:'recipient',email:'person@example.test',role:'operator'}]:[]};}},kind:'map',target:'map-one'});
 container.querySelector('[data-share-email]').value='person@example.test';container.querySelector('[data-share-add]').click();await tick();assert.equal(calls[1].args.p_target,'map-one');assert.equal(calls[1].args.p_role,'operator');assert.equal(calls[1].args.p_email,'person@example.test');assert.equal(container.querySelector('[data-share-role]'),null);
 container.querySelector('[data-share-remove]').click();await tick();assert.equal(calls[2].args.p_action,'revoke');assert.equal(calls[2].args.p_recipient,'recipient');
});
test('opening a project immediately removes welcome content and loads the original saved map thumbnails',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://example.test'}),old=globalThis.document;globalThis.document=dom.window.document;
 let release;const changing=new Promise(r=>release=r),preview='data:image/jpeg;base64,YQ==';
 try{const ui=installProjectHome({getState:()=>({user:{id:'owner'},workspace:{id:'argo',name:'Argo NR'},workspaces:[{id:'argo',name:'Argo NR'}],projects:[{id:'map1',name:'Survey'}],previewAccess:true}),previews:{load:async()=>new Map([['map1',preview]])},onWorkspace:()=>changing,onResume(){}});
 ui.open();assert.ok(document.querySelector('.home-welcome'));document.querySelector('[data-workspace=argo]').click();
 assert.equal(document.querySelector('.home-welcome'),null);assert.equal(document.querySelector('.project-home').dataset.homeLevel,'maps');release();await tick();
 assert.equal(document.querySelector('[data-project=map1] img').getAttribute('src'),preview);
 document.querySelector('[data-section=projects]').click();assert.ok(document.querySelector('.home-welcome'));
 }finally{globalThis.document=old;dom.window.close();}
});
