import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://localhost:8767';
const host='https://dzthwvxrltkltfvubvld.supabase.co';
const ownerId='c636e8ab-01d4-458e-a455-6f329dae6bf1';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const ctx=await browser.newContext();let owner=true,rev=1,lastSave=null,newUser=null;
const makeSession=()=>({access_token:[{alg:'HS256',typ:'JWT'},{iss:host+'/auth/v1',sub:ownerId,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'},'signature'].map((v,i)=>i===2?v:Buffer.from(JSON.stringify(v)).toString('base64url')).join('.'),refresh_token:'mock-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:ownerId,email:'owner@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}});
const user={id:'member',email:'person@example.invalid',name:'Test Person',apps:['fieldmaps'],active:true,revision:1,owner:false};
await ctx.route(host+'/**',async route=>{const url=new URL(route.request().url());let data={};
 if(url.pathname.endsWith('/drillops-create-user')){newUser=route.request().postDataJSON();data={id:'new',email:newUser.email};}
 else if(url.pathname.endsWith('/token'))data=makeSession();
 else if(url.pathname.endsWith('/user'))data=makeSession().user;
 else if(url.pathname.endsWith('/drillops_access'))data={owner,active:true,apps:['eos'],email:'test@example.invalid'};
 else if(url.pathname.endsWith('/drillops_admin_users'))data=[{...user,id:ownerId,name:'Owner',owner:true}, {...user,revision:rev}];
 else if(url.pathname.endsWith('/drillops_admin_access')){lastSave=route.request().postDataJSON();rev++;data={...user,...lastSave,revision:rev};}
 await route.fulfill({json:data});});
try{
 const page=await ctx.newPage();await page.goto(base+'/drillops-admin.html');await page.locator('#login [name=email]').fill('owner@example.invalid');await page.locator('#login [name=password]').fill('test-password');await page.locator('#login button').click();await page.waitForSelector('#admin:not([hidden])');assert.equal(await page.locator('[data-edit]').count(),1);
 await page.locator('[data-edit]').click();await page.locator('#edit [name=apps][value=eos]').check();await page.locator('#edit [name=apps][value=fieldmaps]').uncheck();await page.locator('#save').click();await page.waitForFunction(()=>!document.querySelector('#edit').open);assert.deepEqual(lastSave.apps,['eos']);assert.equal(lastSave.revision,1);
 await page.screenshot({path:'/Users/johnoleary/Documents/Codex/2026-11-08/af/work/unified-admin-test.png',fullPage:true});
 await page.locator('#new-user').click();await page.locator('#create [name=name]').fill('New Person');await page.locator('#create [name=email]').fill('new@example.invalid');await page.locator('#create [name=password]').fill('test-password-123');await page.locator('#create-save').click();await page.waitForFunction(()=>document.getElementById('create-error').textContent.includes('Choose at least one'));assert.equal(newUser,null);
 await page.locator('#create [value=eos]').check();await page.locator('#create [value=project]').check();await page.locator('#create-save').click();await page.waitForFunction(()=>!document.getElementById('create').open);assert.deepEqual(newUser.apps,['eos','project']);assert.equal(await page.locator('#create [name=password]').inputValue(),'');
 const other=await ctx.newPage();await other.goto(base+'/support.html');await other.addScriptTag({url:base+'/config.js'});await other.addScriptTag({url:base+'/auth/unified-client.bundle.js'});await other.addScriptTag({url:base+'/auth-session.js'});
 assert.ok(await other.evaluate(async()=>!!await DrillOpsSession.token()),'shared SDK session available in another app');
 owner=false;await page.reload();await page.waitForFunction(()=>document.getElementById('message').textContent.includes('restricted'));assert.equal(await page.locator('#admin').isVisible(),false);
 await other.evaluate(()=>DrillOpsSession.save(null));await page.reload();await page.waitForSelector('#signin:not([hidden])');assert.equal(await page.locator('#admin').isVisible(),false);
 console.log('PASS owner-only UI, editing grants, shared session across apps, shared sign-out');
}finally{await browser.close();}
