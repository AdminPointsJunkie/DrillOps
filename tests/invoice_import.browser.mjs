import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext();let bodies=[],result='duplicate';
await context.addInitScript(()=>localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999})));
await context.route('http://localhost:8000/**',async route=>{
 const p=new URL(route.request().url()).pathname;
 if(p==='/invoices/import'){
  bodies.push(route.request().postData());
  return route.fulfill({status:result==='failure'?422:200,json:result==='failure'?{detail:'Could not read this invoice.'}:result==='duplicate'?{status:'duplicate',existing_invoice:{invoice_number:'INV-1',project:'Example',po_reference:'PO-1'}}:{status:'imported',invoice_number:'INV-2',contractor:'Supplier'}});
 }
 const data=p==='/mobile/me'?{name:'Test',role:'System Administrator',management_portal_access:true}:p==='/projects'?[{id:1,name:'Example',client_id:1,program:'Exploration',year:'2026'},{id:2,name:'Example',client_id:1,program:'Gas Riser',year:'2026'}]:p==='/clients'?[{id:1,name:'Client'}]:p==='/contractors'?[{name:'Supplier',program:'Exploration'}]:p==='/invoice-ledger'?{invoices:[{source_file:'existing.pdf'}],purchase_orders:[{id:10,project:'Example',program:'Exploration',po_number:'PO-1',contractor:'Supplier'},{id:20,project:'Example',program:'Gas Riser',po_number:'PO-2',contractor:'Other supplier'}]}:[];
 await route.fulfill({json:data});
});
try{
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8766/account.html?view=importer');await page.waitForFunction(()=>document.querySelector('#inv-import-destination').textContent==='');
 const button=page.locator('#inv-import-btn-sidebar');assert.equal(await button.isDisabled(),true);
 await page.locator('#inv-file-input-sidebar').setInputFiles({name:'existing.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic')});
 assert.match(await page.locator('#inv-import-log-sidebar').innerText(),/filename is already recorded/);assert.equal(await button.isDisabled(),true);
 await page.locator('#inv-import-project').selectOption('1');assert.equal(await button.isDisabled(),true);
 assert.deepEqual(await page.locator('#inv-import-po option').allTextContents(),['Choose PO number','PO-1 · Supplier']);
 await page.locator('#inv-import-po').selectOption('10');assert.equal(await button.isDisabled(),false);
 await button.click();await page.waitForFunction(()=>document.querySelector('#inv-import-log-sidebar').textContent.includes('DUPLICATE'));
 assert.match(bodies[0],/name="project_id"\r\n\r\n1/);assert.match(bodies[0],/name="po_id"\r\n\r\n10/);
 assert.match(await page.locator('#inv-import-log-sidebar').innerText(),/Nothing added/);
 await page.locator('#inv-import-project').selectOption('2');assert.equal(await page.locator('#inv-import-po').inputValue(),'');assert.deepEqual(await page.locator('#inv-import-po option').allTextContents(),['Choose PO number','PO-2 · Other supplier']);
 await page.locator('#inv-import-po').selectOption('20');result='failure';await page.locator('#inv-file-input-sidebar').setInputFiles({name:'bad.pdf',mimeType:'application/pdf',buffer:Buffer.from('bad')});await button.click();await page.waitForFunction(()=>document.querySelector('#inv-import-log-sidebar').textContent.includes('Could not read'));
 assert.equal(await button.isDisabled(),false,'failed files remain available for retry');
 result='imported';await button.click();await page.waitForFunction(()=>document.querySelector('#inv-import-log-sidebar').textContent.includes('imported INV-2'));
 assert.equal(await button.isDisabled(),true);assert.deepEqual(errors,[]);
 console.log('PASS required project/PO selection, program-specific PO list, duplicate warning, explicit IDs, failure retry and success');
}finally{await browser.close();}
