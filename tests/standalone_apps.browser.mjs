import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.DRILLOPS_TEST_URL||'http://localhost:8766/';
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>{
 if(!localStorage.getItem('drillops_supabase_session')){
 localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test-session',expires_at:9999999999}));
 localStorage.setItem('drillops_client_id','1');localStorage.setItem('drillops_project','Test Project');localStorage.setItem('drillops_program','Exploration');
 }
});
let privateRequests=0;
await context.route('https://*.supabase.co/auth/**',route=>{privateRequests++;return route.abort();});
await context.route('http://localhost:8000/**',async route=>{
 privateRequests++;
 const path=new URL(route.request().url()).pathname;
 const data=path==='/mobile/me'?{name:'Test User',email:'test@example.invalid',role:'System Administrator',management_portal_access:true}
 :path==='/clients'?[{id:1,name:'Test Client',status:'Active'}]
 :path==='/projects'?[{id:1,client_id:1,name:'Test Project',program:'Exploration',year:2026,status:'Active'}]
 :path==='/contractors'?['Mitchells Drilling','DEPCO Drilling','MCC Group','Test Supplier','Allianz Drilling'].map((name,index)=>({id:index+1,name,category:name==='MCC Group'?'Labour':'Drilling',program:'Exploration',sites:'Test Project',active:true}))
 :path==='/project-contractors'?['Mitchells Drilling','DEPCO Drilling','MCC Group','Test Supplier','Allianz Drilling'].map(contractor=>({contractor,category:contractor==='MCC Group'?'Labour':'Drilling',activity_rows:contractor==='Allianz Drilling'?999:1}))
 :path==='/invoices'?[{id:1,contractor:'Test Supplier',project:'Test Project',program:'Exploration',invoice_number:'TEST-1',subtotal:100}]
 :path==='/training/state'?{revision:1,contractors:['Test Supplier'],people:[],roles:{},columns:[],sections:[]}
 :path==='/activity-report-data'?{activities:[{id:1,contractor:'Mitchells Drilling',project:'Test Project',program:'Exploration',date:'2026-11-07',shift:'Day',drill_rig:'Rig 1',hole_num:'TEST-01',source_file:'test-shift.pdf',total_metres:24,total_time:'12:00',line_cost:2000,code:'DRILL',category:'active'}],consumables:[],crew:[],report_approvals:[],activity_sheet_locks:[]}:path==='/stats'?{}:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage();let errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))errors.push(m.text())});
// A homepage visit must not restore or refresh a session, even with a stale return route.
for(const route of ['', 'index.html', 'index.html#ecosystem']){
 privateRequests=0;await page.goto(base+route);await page.waitForTimeout(300);
 assert.equal(await page.locator('#login-screen').isVisible(),true);
 assert.equal(await page.locator('#login-screen').evaluate(el=>el.classList.contains('signin-mode')),false);
 assert.equal(await page.locator('.page.active').count(),0);
 assert.equal(privateRequests,0,'homepage must not request private data');
}
await page.evaluate(()=>{
 const saved=JSON.parse(localStorage.getItem('drillops_supabase_session'));saved.expires_at=1;
 localStorage.setItem('drillops_supabase_session',JSON.stringify(saved));
 sessionStorage.setItem('drillops_return_to','./training.html');
});
privateRequests=0;await page.goto(base);await page.waitForTimeout(300);
assert.equal(await page.locator('#login-screen').isVisible(),true);
assert.equal(privateRequests,0,'expired sessions do not refresh on the public home');
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('drillops_supabase_session')).expires_at),1);
await page.evaluate(()=>{
 const saved=JSON.parse(localStorage.getItem('drillops_supabase_session'));saved.expires_at=9999999999;
 localStorage.setItem('drillops_supabase_session',JSON.stringify(saved));sessionStorage.removeItem('drillops_return_to');
});
await page.goto(base+'index.html?signin=activities#portal-login');
await page.waitForFunction(()=>document.getElementById('login-screen')?.style.display==='none');
assert.equal(await page.locator('.page.active').getAttribute('id'),'page-app-home');
await page.goto(base+'index.html?return_to=.%2Faccount.html');
await page.waitForURL('**/account.html');
await page.waitForFunction(()=>document.getElementById('login-screen')?.style.display==='none');
assert.equal(await page.locator('.page.active').getAttribute('id'),'page-invoices');
console.log('PASS public homepage, expired session, explicit sign-in and app return link');
for(const [app,views] of Object.entries({eos:['','reports','activities','settings','production','costing','rates','cost-contracts','importer'],account:['','invoices','purchase-orders','contractors','importer'],project:['','project-dashboard','project-budgets','budget','boreholes','admin']})){
 for(const view of views){errors=[];await page.goto(base+app+'.html'+(view?'?view='+view:''));await page.waitForTimeout(650);
 assert.equal(await page.locator('.page.active').getAttribute('id'),view?'page-'+(app==='eos'&&view==='activities'?'settings':app==='eos'&&view==='production'?'reports':view):({account:'page-invoices',project:'page-project-dashboard'}[app]||'page-app-home'));
 assert.deepEqual(errors,[],app+' '+view);
 assert.equal(await page.locator('#login-screen').isVisible(),false);
 assert.equal(await page.locator('.app-chooser,.app-choice,.app-tasks,.app-switch').count(),0);
 if(app==='eos')assert.equal(await page.locator('#drawer a[href="./training.html"]').count(),0);
 if(app==='project')assert.equal(await page.locator('#drawer a[href="./training.html"]').count(),1);
 if(app==='account')assert.equal(await page.locator('#page-activities').count(),0);
 if(app==='eos'&&!view){
  assert.deepEqual(await page.locator('#eos-contractor-filter option').allTextContents(),['Mitchells Drilling','DEPCO Drilling','MCC Group']);
  assert.equal(await page.evaluate(()=>reportDrillingContractor()==='Allianz Drilling'),false);
  assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('drillops_contractors')).some(c=>c.name==='Test Supplier')),true);
 }
 if(app==='account'&&!view)assert.equal(await page.evaluate(()=>CONTRACTORS.some(c=>c.name==='Test Supplier')&&CONTRACTORS.some(c=>c.name==='Allianz Drilling')),true);
 if(app==='eos')assert.equal(await page.locator('#page-invoices').count(),0);
 if(app==='eos'&&!view){await page.waitForFunction(()=>document.getElementById('eos-total').textContent==='1');assert.equal(await page.locator('#eos-metres').innerText(),'24 m');}
 if(app==='eos'&&view==='activities'){assert.equal(await page.locator('#report-body tr.report-row').count(),0);await page.locator('#eos-load-raw').click();await page.waitForFunction(()=>document.querySelectorAll('#report-body tr.report-row').length===1);await page.locator('#eos-plod-status').selectOption('approved');assert.equal(await page.locator('#report-body tr.report-row:visible').count(),0);await page.locator('#eos-plod-status').selectOption('pending');assert.equal(await page.locator('#report-body tr.report-row:visible').count(),1);}
 console.log('PASS',app,view||'home');
 }
}
await page.goto(base+'index.html');
await page.goto(base+'account.html');
await page.waitForFunction(()=>document.getElementById('login-screen')?.style.display==='none');
assert.equal(await page.evaluate(()=>localStorage.getItem('drillops_project')),'Test Project');
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('drillops_supabase_session')).access_token),'test-session');

await page.waitForFunction(()=>document.getElementById('ledger-count')?.textContent.startsWith('1 of 1'));
assert.equal(await page.locator('#inv-kpi-total').innerText(),'$100.00');
assert.equal(await page.locator('#inv-status-filter').count(),0);
// The retained portal stays usable, with its own old navigation and shared login.
errors=[];
await page.goto(base+'OLD/');
await page.waitForFunction(()=>document.getElementById('login-screen')?.style.display==='none');
assert.equal(await page.locator('#page-invoices').count(),1);
assert.equal(await page.locator('#page-activities').count(),1);
assert.equal(await page.locator('#page-project-budgets').count(),1);
await page.locator('#hamburger-btn').click();
await page.locator('.drawer-nav-item[data-page="invoices"]').click();
await page.waitForFunction(()=>document.getElementById('ledger-count')?.textContent.startsWith('1 of 1'));
assert.equal(await page.locator('#inv-kpi-total').innerText(),'$100.00');
assert.deepEqual(errors,[],'old portal runtime');
await page.goto(base+'OLD/training.html?contractor=Test%20Supplier');
await page.waitForFunction(()=>document.querySelector('#people-count')?.textContent==='0');
assert.equal(await page.locator('.site-tag').evaluate(link=>new URL(link.href).pathname),'/OLD/index.html');
await page.locator('.site-tag').click();
await page.waitForFunction(()=>document.getElementById('login-screen')?.style.display==='none');
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('drillops_supabase_session')).access_token),'test-session');
console.log('PASS retained OLD portal, invoice ledger, training return and shared session');
await page.setViewportSize({width:390,height:844});
for(const app of ['eos','account','project']){
 await page.goto(base+app+'.html');
 await page.waitForFunction(()=>document.getElementById('login-screen')?.style.display==='none');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,app+' mobile overflow');
}
const anonymous=await browser.newPage();
await anonymous.goto(base+'index.html');
assert.equal(await anonymous.locator('#login-screen').isVisible(),true);
assert.equal(await anonymous.locator('#login-screen').evaluate(el=>el.classList.contains('signin-mode')),false);
await anonymous.setViewportSize({width:390,height:844});
assert.equal(await anonymous.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'public homepage mobile overflow');
await anonymous.goto('about:blank');
await anonymous.goto(base+'index.html#access_token=test-recovery&refresh_token=test-refresh&type=recovery&expires_in=3600');
assert.equal(await anonymous.locator('#password-reset-panel').isVisible(),true);
assert.equal(await anonymous.locator('#login-screen').isVisible(),true);
await anonymous.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
await anonymous.goto(base+'account.html?view=invoices');
assert.equal(await anonymous.locator('#login-screen').isVisible(),true);
assert.equal(await anonymous.locator('#ledger-count').innerText(),'Ledger not loaded');
await anonymous.close();
if(process.env.CAPTURE_APPS){await page.setViewportSize({width:1440,height:1000});for(const app of ['eos','account','project']){await page.goto(base+app+'.html');await page.waitForFunction(()=>document.getElementById('login-screen')?.style.display==='none');await page.waitForTimeout(500);await page.screenshot({path:process.env.CAPTURE_APPS+'/'+app+'-app.png'});}}
console.log('PASS shared session, project context, invoice ledger, mobile and anonymous sign-in gate');
await browser.close();
