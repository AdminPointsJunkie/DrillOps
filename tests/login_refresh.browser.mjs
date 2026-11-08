import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext();let offline=false,invalid=false,renewals=0;
await context.route('https://*.supabase.co/auth/v1/token**',route=>{renewals++;return route.fulfill({status:invalid?400:200,json:invalid?{code:'refresh_token_not_found'}:{access_token:'fresh',refresh_token:'next',expires_in:3600}});});
await context.route('http://localhost:8000/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 const data=path==='/mobile/me'?{name:'Test',role:'System Administrator',management_portal_access:true}:path==='/clients'?[{id:1,name:'Client'}]:path==='/projects'?[{id:1,client_id:1,name:'Example',program:'Exploration',year:'2026'}]:path==='/contractors'?[{name:'Mitchells Drilling',program:'Exploration'}]:path==='/invoice-ledger'?{invoices:[],purchase_orders:[]}:path==='/filters'?{dates:[],holes:[],sites:[],codes:[],total_rows:0}:[];
 await route.fulfill({status:offline&&path==='/mobile/me'?503:200,json:data});
});
try{
 const page=await context.newPage();await page.goto('http://localhost:8766/');
 await page.evaluate(()=>localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'old',refresh_token:'refresh',expires_at:1})));
 for(const app of ['account','eos','project']){
  await page.goto('http://localhost:8766/'+app+'.html');await page.waitForFunction(()=>workspaceStarted);
  await page.reload();await page.waitForFunction(()=>workspaceStarted);
  assert.equal(await page.locator('#login-screen').isVisible(),false,app+' reload stays signed in');
 }
 assert.equal(renewals,1,'navigation and refresh do not rotate a valid session');
 offline=true;await page.reload();await page.waitForFunction(()=>document.getElementById('session-retry-message').textContent.includes('Could not reconnect'));
 assert.equal(await page.locator('#login-panel').isVisible(),false);assert.ok(await page.evaluate(()=>localStorage.getItem('drillops_supabase_session')));
 offline=false;await page.locator('#session-retry-button').click();await page.waitForFunction(()=>workspaceStarted);
 assert.equal(await page.locator('#login-screen').isVisible(),false);
 invalid=true;await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('drillops_supabase_session'));s.expires_at=1;localStorage.setItem('drillops_supabase_session',JSON.stringify(s));});
 await page.reload();await page.waitForFunction(()=>document.getElementById('login-error').textContent.includes('Authentication'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('drillops_supabase_session')),null);
 assert.equal(await page.locator('#login-panel').isVisible(),true);
 console.log('PASS refresh all apps, expired session restoration, startup outage retry without password, genuine expired session sign-in');
}finally{await browser.close();}
