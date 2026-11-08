import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 const context=await browser.newContext();let saves=[],fail=false;
 let invoice={id:1,invoice_number:'INV-1',invoice_date:'2026-10-01',contractor:'Supplier',project:'Example',program:'Exploration',po_reference:'PO-1',subtotal:100,gst:10,total_aud:110,version:1};
 await context.addInitScript(()=>localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999})));
 await context.route('http://localhost:8000/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/invoices/1'){
   const payload=route.request().postDataJSON();saves.push(payload);
   if(fail)return route.fulfill({status:500,json:{detail:'Save failed'}});
   invoice={...invoice,...payload,version:invoice.version+1};return route.fulfill({json:{status:'updated',version:invoice.version}});
  }
  const data=p==='/mobile/me'?{name:'Test',role:'System Administrator',management_portal_access:true}:p==='/projects'?[{id:1,name:'Example',client_id:1,program:'Exploration',year:'2026'}]:p==='/clients'?[{id:1,name:'Client'}]:p==='/contractors'?[{name:'Supplier',program:'Exploration'}]:p==='/invoice-ledger'?{invoices:[invoice],purchase_orders:[{id:1,po_number:'PO-1',project:'Example',program:'Exploration',contractor:'Supplier',po_value:1000}]}:[];
  await route.fulfill({json:data});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:8766/account.html?view=invoices');await page.waitForFunction(()=>document.querySelector('#inv-kpi-total').textContent==='$100.00');
 await page.locator('#ledger-edit').click();await page.locator('[data-edit=subtotal]').fill('250');await page.locator('[data-edit=gst]').fill('25');
 assert.equal(saves.length,0);assert.equal(await page.locator('#inv-kpi-total').innerText(),'$100.00');assert.equal(await page.locator('#ledger-refresh').isDisabled(),true);
 await page.locator('#ledger-edit').click();await page.waitForFunction(()=>document.querySelector('#inv-kpi-total').textContent==='$250.00');
 assert.equal(saves[0].total_aud,275);assert.equal(saves[0].version,1);assert.match(await page.locator('#inv-body').innerText(),/25.0%/);assert.match(await page.locator('#inv-body td').last().innerText(),/250.00/);assert.equal(await page.locator('#ledger-edit').innerText(),'Edit ledger');
 await page.locator('#ledger-edit').click();await page.locator('[data-edit=subtotal]').fill('400');await page.locator('#ledger-cancel').click();assert.equal(saves.length,1);assert.equal(await page.locator('#inv-kpi-total').innerText(),'$250.00');
 fail=true;await page.locator('#ledger-edit').click();await page.locator('[data-edit=subtotal]').fill('300');await page.locator('#ledger-edit').click();await page.waitForFunction(()=>document.querySelector('#ledger-message').textContent.includes('Unsaved edits'));
 assert.equal(await page.locator('[data-edit=subtotal]').inputValue(),'300');assert.equal(await page.locator('#ledger-edit').innerText(),'Done');
 fail=false;await page.locator('#ledger-edit').click();await page.waitForFunction(()=>document.querySelector('#inv-kpi-total').textContent==='$300.00');assert.deepEqual(errors,[]);
 console.log('PASS explicit edit mode, Done saves and recalculates totals and PO use, Cancel discards, failed saves retain edits and retry');
}finally{await browser.close();}
