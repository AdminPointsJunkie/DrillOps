import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 const context=await browser.newContext();let eosFail=false;const errors=[];
 await context.addInitScript(()=>localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999})));
 await context.route('http://localhost:8000/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/reconciliation/monthly'&&eosFail)return route.fulfill({status:500,json:{}});
  const data=p==='/mobile/me'?{name:'Test',role:'System Administrator',management_portal_access:true}:p==='/projects'?[{id:1,name:'Example',client_id:1,program:'Exploration',year:'2026'}]:p==='/clients'?[{id:1,name:'Client'}]:p==='/contractors'?[]:p==='/invoice-ledger'?{invoices:[{id:1,contractor:'Mitchells Drilling',invoice_number:'TEST-1',billing_month:'2026-09',invoice_date:'2026-10-01',subtotal:1000,project:'Example',program:'Exploration'}],purchase_orders:[]}:p==='/reconciliation/monthly'?{eos:[{contractor:'DEPCO Drilling',month:'2026-10',eos_total:500,report_count:1,project:'Example',program:'Exploration'}]}:[];
  await route.fulfill({json:data});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:8766/account.html');await page.locator('#ao-print').waitFor();await page.waitForFunction(()=>!document.querySelector('#ao-print').disabled);
 assert.match(await page.locator('#ao-kpis').innerText(),/\$1,000/);assert.equal(await page.locator('#ao-contractors article').count(),4);
 await page.locator('#ao-calendar [data-ao-family=depco][data-ao-month="2026-10"]').click();assert.match(await page.locator('#ao-detail').innerText(),/Priced EOS/);
 const popupPromise=context.waitForEvent('page');await page.locator('#ao-print').click();const report=await popupPromise;await report.waitForLoadState();assert.equal(await report.locator('.sheet').count(),3);assert.equal(await report.locator('header').count(),3);assert.match(await report.locator('.totals tfoot').innerText(),/1,000.00/);
 await report.emulateMedia({media:'print'});
 assert.equal(await report.evaluate(()=>{const first=document.querySelector('.sheet'),row=first.querySelector('.ao-supplier');for(let i=0;i<7;i++)row.after(row.cloneNode(true));return [...document.querySelectorAll('.sheet')].every(s=>s.querySelector('footer').getBoundingClientRect().top>=s.querySelector('footer').previousElementSibling.getBoundingClientRect().bottom)}),true,'Full supplier chart fits above footer');
 await report.pdf({path:'../accounts-report-test.pdf',preferCSSPageSize:true,printBackground:true});await report.screenshot({path:'../accounts-report-test.png',fullPage:true});
 await page.screenshot({path:'../accounts-overview-test.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 eosFail=true;await page.evaluate(()=>loadAccountsOverview());assert.match(await page.locator('#ao-message').innerText(),/could not load/);assert.match(await page.locator('#ao-kpis').innerText(),/Unavailable/);assert.deepEqual(errors,[]);
 console.log('PASS dashboard, receipt detail, three-page branded printable report, mobile width and partial failure');
}finally{await browser.close();}
