import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const base={project:'Example',program:'Exploration',contractor:'Mitchells Drilling',month:'2026-10'};
const data={eos:[{...base,rig:'R1',eos_total:100,report_count:2,unpriced:0},{...base,rig:'R2',eos_total:50,report_count:1,unpriced:0},{...base,month:'2026-11',rig:'R1',eos_total:null,report_count:1,unpriced:1}],invoices:[{...base,invoice_total:120,invoice_count:2,missing_amounts:0,date_fallbacks:1}]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});let failure=false;
 await context.addInitScript(()=>localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999})));
 await context.route('http://localhost:8000/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  const payload=p==='/mobile/me'?{name:'Sample',role:'System Administrator',management_portal_access:true}:p==='/clients'?[{id:1,name:'Client',status:'Active'}]:p==='/projects'?[{id:1,client_id:1,name:'Example',year:'2026',program:'Exploration',status:'Active'}]:p==='/contractors'?[{name:'Mitchells Drilling',program:'Exploration',active:true}]:p==='/reconciliation/monthly'?data:p==='/stats'?{}:[];
  await route.fulfill({status:failure&&p==='/reconciliation/monthly'?500:200,contentType:'application/json',body:JSON.stringify(payload)});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8766/account.html?view=reconciliation');await page.waitForSelector('.recon-card');
 assert.equal(await page.locator('#workspace-gate').isVisible(),false);assert.equal(await page.locator('.recon-card').count(),2);
 await page.locator('#recon-month').selectOption('2026-10');assert.equal(await page.locator('.recon-card').count(),1);
 assert.match(await page.locator('.recon-card').innerText(),/-\$30.00 difference/);
 await page.locator('.recon-card summary').click();assert.equal(await page.locator('.recon-card tbody tr').count(),2);
 assert.match(await page.locator('.recon-card').innerText(),/Example · 2026 · Exploration/);
 assert.equal(await page.locator('#po-notes').count(),0);assert.equal(await page.locator('#po-table th').filter({hasText:/^Notes$/}).count(),0);
 data.eos.push({...base,contractor:'Fortem',rig:'Nuwan Jayasinghe',eos_total:1600,report_count:1,unpriced:0});await page.evaluate(()=>loadMonthlyReconciliation());await page.locator('#recon-contractor').selectOption('Fortem');assert.equal(await page.locator('.recon-card').count(),1);assert.match(await page.locator('.recon-card').innerText(),/1,600.00/);await page.locator('.recon-card summary').click();assert.match(await page.locator('.recon-card').innerText(),/Nuwan Jayasinghe/);
 await page.screenshot({path:'../reconciliation-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 failure=true;await page.evaluate(()=>loadMonthlyReconciliation());assert.equal(await page.locator('.recon-card').count(),0);assert.match(await page.locator('#recon-message').innerText(),/could not load/);
 failure=false;await page.evaluate(()=>loadMonthlyReconciliation());assert.equal(await page.locator('.recon-card').count(),1);
 assert.deepEqual(errors,[]);console.log('PASS monthly reconciliation navigation, project labels, filters, rig details, missing rates, mobile and error recovery');
}finally{await browser.close();}
