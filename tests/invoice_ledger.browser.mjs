// Run with Playwright installed; optionally set CHROME_PATH to a local Chrome executable.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../docs/account.html',import.meta.url),'utf8');
const section=html.slice(html.indexOf('<section class="page" id="page-invoices">'),html.indexOf('<!-- Borehole Details -->'));
const js=fs.readFileSync(new URL('../docs/invoice-ledger.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../docs/invoice-ledger.css',import.meta.url),'utf8');
const fixtures=[
 {id:1,invoice_number:'INV-1',contractor:'Supplier A',project:'Ironbark',program:'Exploration',subtotal:100,invoice_date:'2026-01-01',billing_month:'01/2026',status:'Query',gst:null,total_aud:null,amount_due:null},
 {id:2,invoice_number:'CR-1',contractor:'Supplier A',project:'Ironbark',program:'Exploration',subtotal:-20,invoice_date:'2026-01-02',billing_month:'01/2026',status:'Paid',gst:0,total_aud:-20,amount_paid:0},
 {id:3,invoice_number:'INV-2',contractor:'Supplier A',project:'Ironbark',program:'Exploration',subtotal:0,invoice_date:'2026-01-03',billing_month:'01/2026',status:'Unpaid'},
 {id:4,invoice_number:'OTHER',contractor:'Supplier A',project:'Elsewhere',program:'Exploration',subtotal:10000},
 {id:5,invoice_number:'GAS',contractor:'Supplier A',project:'Ironbark',program:'Gas Riser',subtotal:10000}
];
const bootstrap=rows=>`var invoicesData=[],activeProjectName='Ironbark',activeProgram='Exploration',activeContractor='Supplier A',API='https://example.invalid';var fixture=${JSON.stringify(rows).replace(/</g,'\\u003c')};var failure=false;function activeWorkspaceProject(){return {id:4,name:activeProjectName,year:'2026',program:activeProgram}}function populateManualInvoiceForm(){}function invoiceContractorsForWorkspace(){return [...new Set(fixture.map(r=>r.contractor))].map(name=>({name}))}function projectNamesMatch(a,b){return a===b}async function fetch(url){if(failure)return {ok:false,status:401};return {ok:true,json:async()=>fixture.filter(r=>r.contractor===new URL(url).searchParams.get('contractor'))}}function loadInvoiceBreakdown(){}function openInvoiceAttachments(){}function viewInvoicePdf(){}function createManualInvoice(){}function downloadInvoiceBreakdownCSV(){}`;
const baseStyle='body{background:#f3f5f4;font-family:Arial,sans-serif;color:#213b34;padding:32px}*{box-sizing:border-box}.tbl-scroll{overflow:auto}table{text-align:left}.filter-group{display:flex;flex-direction:column;gap:6px}.table-wrap{margin-top:12px}button:disabled{opacity:.45;cursor:default}';
const pageHTML=rows=>`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DrillOps invoice ledger preview</title><style>${baseStyle}\n${css}</style></head><body>${section}<script>${bootstrap(rows)}</script><script>${js}</script><script>loadInvoices();</script></body></html>`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.setContent(pageHTML(fixtures));
await page.waitForFunction(()=>document.querySelector('#inv-kpi-total').textContent==='$80.00');
assert.equal(await page.locator('#inv-body tr').count(),3);
assert.equal(await page.locator('#page-invoices').getAttribute('data-project-id'),'4');
assert.match(await page.locator('#ledger-title').innerText(),/Ironbark 2026/);
assert.equal(await page.locator('[data-view=review], [data-view=paid], #inv-status-filter, #inv-kpi-query').count(),0);
assert.equal(await page.locator('#inv-table th').count(),7);
assert.equal(await page.locator('#inv-body [contenteditable]').count(),0);
assert.equal(await page.locator('#ledger-entry').getAttribute('open'),null);
assert.match(await page.locator('#inv-body').innerText(),/\$20.00/);
await page.locator('[data-view=credits]').click();assert.equal(await page.locator('#inv-body tr').count(),1);assert.equal(await page.locator('#inv-kpi-total').innerText(),'-$20.00');
await page.locator('#ledger-reset').click();await page.locator('#ledger-search').fill('INV-1');assert.equal(await page.locator('#inv-body tr').count(),1);
await page.locator('[data-invoice="1"]').click();assert.match(await page.locator('#ledger-detail').innerText(),/Not recorded/);
await page.evaluate(()=>renderInvoices(invoicesData));assert.equal(await page.locator('#inv-body tr').count(),1,'attachment refresh preserves search');
await page.locator('#ledger-reset').click();await page.evaluate(()=>{fixture.push({id:6,invoice_number:'UNKNOWN',contractor:'Supplier A',project:'Ironbark',program:'Exploration',subtotal:null});return loadInvoices()});
assert.match(await page.locator('#ledger-count').innerText(),/1 missing subtotal/);assert.match(await page.locator('#ledger-total').innerText(),/incomplete/);
await page.evaluate(()=>{failure=true;return loadInvoices()});assert.match(await page.locator('#ledger-message').innerText(),/Sign in again/);assert.equal(await page.locator('#inv-kpi-total').innerText(),'—');assert.equal(await page.locator('#ledger-export').isDisabled(),true);
await page.evaluate(()=>{failure=false;return loadInvoices()});assert.equal(await page.locator('#ledger-message').isVisible(),false);
await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no page overflow on mobile');
assert.deepEqual(errors,[]);
console.log('PASS: credits, zero and missing amounts, scoped rows, filters, attachment refresh, error recovery and mobile layout');
await browser.close();
