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
await context.route('http://localhost:8000/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 const data=path==='/mobile/me'?{name:'Test User',email:'test@example.invalid',role:'System Administrator',management_portal_access:true}
 :path==='/clients'?[{id:1,name:'Test Client',status:'Active'}]
 :path==='/projects'?[{id:1,client_id:1,name:'Test Project',program:'Exploration',year:2026,status:'Active'}]
 :path==='/contractors'?[{id:1,name:'Test Supplier',program:'Exploration',sites:'Test Project',active:true}]
 :path==='/invoices'?[{id:1,contractor:'Test Supplier',project:'Test Project',program:'Exploration',invoice_number:'TEST-1',subtotal:100}]
 :path==='/activity-report-data'?{activities:[{id:1,contractor:'Test Supplier',project:'Test Project',program:'Exploration',date:'2026-11-07',shift:'Day',drill_rig:'Rig 1',hole_num:'TEST-01',source_file:'test-shift.pdf',total_metres:24,total_time:'12:00',line_cost:2000,code:'DRILL',category:'active'}],consumables:[],crew:[],report_approvals:[],activity_sheet_locks:[]}:path==='/stats'?{}:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage();let errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))errors.push(m.text())});
for(const [app,views] of Object.entries({index:[''],eos:['','reports','activities','production','costing','rates','cost-contracts','importer'],account:['','invoices','purchase-orders','contractors','importer'],project:['','project-budgets','budget','boreholes','admin']})){
 for(const view of views){errors=[];await page.goto(base+app+'.html'+(view?'?view='+view:''));await page.waitForTimeout(650);
 assert.equal(await page.locator('.page.active').getAttribute('id'),view?'page-'+view:({account:'page-invoices',project:'page-project-budgets'}[app]||'page-app-home'));
 assert.deepEqual(errors,[],app+' '+view);
 assert.equal(await page.locator('#login-screen').isVisible(),false);
 assert.equal(await page.locator('.app-chooser,.app-choice,.app-tasks,.app-switch').count(),0);
 if(app==='eos')assert.equal(await page.locator('#drawer a[href="./training.html"]').count(),0);
 if(app==='project')assert.equal(await page.locator('#drawer a[href="./training.html"]').count(),1);
 if(app==='account')assert.equal(await page.locator('#page-activities').count(),0);
 if(app==='eos')assert.equal(await page.locator('#page-invoices').count(),0);
 if(app==='eos'&&!view){await page.waitForFunction(()=>document.getElementById('eos-total').textContent==='1');assert.equal(await page.locator('#eos-metres').innerText(),'24 m');}
 if(app==='eos'&&view==='activities'){await page.locator('#eos-plod-status').selectOption('approved');assert.equal(await page.locator('#report-body tr.report-row:visible').count(),0);await page.locator('#eos-plod-status').selectOption('pending');assert.equal(await page.locator('#report-body tr.report-row:visible').count(),1);}
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
await page.setViewportSize({width:390,height:844});
for(const app of ['index','eos','account','project']){
 await page.goto(base+app+'.html');
 await page.waitForFunction(()=>document.getElementById('login-screen')?.style.display==='none');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,app+' mobile overflow');
}
const anonymous=await browser.newPage();
await anonymous.goto(base+'account.html?view=invoices');
assert.equal(await anonymous.locator('#login-screen').isVisible(),true);
assert.equal(await anonymous.locator('#ledger-count').innerText(),'Ledger not loaded');
await anonymous.close();
if(process.env.CAPTURE_APPS){await page.setViewportSize({width:1440,height:1000});for(const app of ['index','eos','account','project']){await page.goto(base+app+'.html');await page.waitForFunction(()=>document.getElementById('login-screen')?.style.display==='none');await page.waitForTimeout(500);await page.screenshot({path:process.env.CAPTURE_APPS+'/'+app+'-app.png'});}}
console.log('PASS shared session, project context, invoice ledger, mobile and anonymous sign-in gate');
await browser.close();
