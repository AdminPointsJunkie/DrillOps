import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 const context=await browser.newContext();let paths=[];
 await context.addInitScript(()=>localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999})));
 await context.route('http://localhost:8000/**',async route=>{
  const path=new URL(route.request().url()).pathname;paths.push(path);
  const data=path==='/mobile/me'?{name:'Sample',role:'System Administrator',management_portal_access:true}:path==='/projects'?[{id:1,client_id:1,name:'Example',year:'2026',program:'Exploration'}]:path==='/clients'?[{id:1,name:'Client'}]:path==='/contractors'?Array.from({length:50},(_,i)=>({name:'Supplier '+i,program:'Exploration'})):path==='/invoice-ledger'?{invoices:[{id:1,invoice_number:'EX-1',project:'Example',program:'Exploration',contractor:'Supplier 0',subtotal:100}],purchase_orders:[]}:[];
  await route.fulfill({json:data});
 });
 const page=await context.newPage();await page.goto('http://localhost:8766/account.html');await page.waitForFunction(()=>document.querySelector('#inv-kpi-total').textContent==='$100.00');
 assert.equal(await page.locator('#workspace-context-btn').count(),0);
 assert.equal(await page.locator('#workspace-gate').isVisible(),false);
 assert.equal(paths.filter(p=>p==='/invoice-ledger').length,1);
 assert.equal(paths.filter(p=>['/invoices','/purchase_orders','/filters'].includes(p)).length,0);
 assert.match(await page.locator('#inv-body').innerText(),/Example 2026/);
 await page.locator('#ledger-search').fill('EX-1');assert.equal(paths.filter(p=>p==='/invoice-ledger').length,1,'filtering makes no new data requests');
 await page.locator('#ledger-add').click();
 await page.locator('#manual-inv-project').selectOption('Example');
 await page.evaluate(()=>populateManualInvoiceForm());
 assert.equal(await page.locator('#manual-inv-project').inputValue(),'Example');
 console.log('PASS fifty suppliers require one ledger request; all projects visible without selection; filters remain local');
}finally{await browser.close();}
