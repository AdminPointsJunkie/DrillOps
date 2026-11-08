import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext();
const key='drillops_supabase_session';
let renewals=0,mode='ok',delay=20,requests=[];
await context.route('https://session-test.invalid/**',async route=>{
 renewals++;await new Promise(r=>setTimeout(r,delay));
 if(mode==='network')return route.abort();
 if(mode==='invalid')return route.fulfill({status:400,json:{code:'refresh_token_not_found'}});
 if(mode==='server')return route.fulfill({status:503,json:{message:'Unavailable'}});
 await route.fulfill({json:{access_token:'new-'+renewals,refresh_token:'refresh-'+renewals,expires_in:3600}});
});
await context.route('http://localhost:8000/test',async route=>{
 requests.push({token:route.request().headers().authorization,body:route.request().postData()});
 await route.fulfill({status:route.request().headers().authorization==='Bearer rejected'?401:200,json:{ok:true}});
});
async function makePage(){
 const p=await context.newPage();await p.goto('http://localhost:8766/support.html');await p.setContent('<p>Session test</p>');
 await p.evaluate(()=>window.DRILLOPS_CONFIG={supabaseUrl:'https://session-test.invalid',supabasePublishableKey:'public-test'});
 await p.addScriptTag({url:'http://localhost:8766/auth-session.js'});return p;
}
async function seed(p,values={}){await p.evaluate(v=>DrillOpsSession.save({access_token:'old',refresh_token:'old-refresh',expires_at:1,...v}),values);}
try{
 const page=await makePage(),other=await makePage();
 await seed(page);
 const tokens=await page.evaluate(()=>Promise.all(Array.from({length:20},()=>DrillOpsSession.token())));
 assert.equal(new Set(tokens).size,1);assert.equal(renewals,1,'parallel reads refresh once');
 assert.ok(await page.evaluate(()=>DrillOpsSession.load().expires_at>Date.now()/1000),'REST expires_in becomes persistent absolute expiry');
 await seed(page);const before=renewals;
 await Promise.all([page.evaluate(()=>DrillOpsSession.token()),other.evaluate(()=>DrillOpsSession.token())]);
 assert.equal(renewals,before+1,'tabs share the refresh lock');
 await seed(page,{access_token:'rejected',expires_at:9999999999});requests=[];
 const status=await page.evaluate(async()=> (await DrillOpsSession.fetch(new Request('http://localhost:8000/test',{method:'POST',body:'payload'}))).status);
 assert.equal(status,200);assert.equal(requests.length,2);assert.deepEqual(requests.map(r=>r.body),['payload','payload']);
 for(const failure of ['server','network']){
  await seed(page);mode=failure;
  assert.equal(await page.evaluate(()=>DrillOpsSession.token().then(()=>false,()=>!!DrillOpsSession.load())),true,'temporary failures keep session');
 }
 mode='invalid';await seed(page);assert.equal(await page.evaluate(()=>DrillOpsSession.token().then(()=>false,e=>e.sessionExpired&&!DrillOpsSession.load())),true);
 mode='ok';delay=150;await seed(page);
 assert.equal(await page.evaluate(async()=>{const pending=DrillOpsSession.token().catch(()=>null);setTimeout(()=>DrillOpsSession.save(null),30);await pending;return DrillOpsSession.load();}),null,'sign out wins over in-flight refresh');
 // An older tab must read another tab's latest session instead of reusing its own token.
 await seed(page,{access_token:'current',expires_at:9999999999});const n=renewals;
 assert.equal(await other.evaluate(()=>DrillOpsSession.token()),'current');assert.equal(renewals,n);
 // JWT expiry is respected when a legacy stored session lacks expires_at.
 await seed(page,{access_token:'x.'+Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.x',expires_at:undefined});
 await page.evaluate(()=>DrillOpsSession.token());assert.equal(renewals,n+1);
 // Blocked localStorage must preserve the working sessionStorage fallback without recursion.
 await page.evaluate(()=>{DrillOpsSession.save(null);Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}});DrillOpsSession.save({access_token:'fallback',expires_at:9999999999});});
 assert.equal(await page.evaluate(()=>DrillOpsSession.load().access_token),'fallback');
 console.log('PASS session persistence, expiry, parallel and cross-tab renewal, 401 retry, temporary failures, invalid refresh and sign-out');
}finally{await browser.close();}
