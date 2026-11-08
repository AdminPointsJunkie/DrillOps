import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1100}});
await context.addInitScript(()=>{localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999}));sessionStorage.setItem('drillops_contractor','DEPCO Drilling');});
const base={contractor:'DEPCO Drilling',program:'Exploration',project:'Alpha',date:'2026-10-01',drill_rig:'Rig 1',hole_num:'TEST-A',shift:'Day',source_file:'sample.pdf',total_time:'1:00'};
const rows=[
 {...base,id:1,code:'DEPCO_A_PCD_90_125_006',total_metres:100,time_from:'08:00'},
 {...base,id:2,code:'DEPCO_A_STANDBY_LOGGER_048',notes:'Stand by logger',time_from:'12:00'},
 {...base,id:3,code:'DEPCO_A_RIG_CEMENTING_036',notes:'Cementing hole',date:'2026-10-02',time_from:'08:00'},
 {...base,id:4,project:'Beta',hole_num:'TEST-B',code:'DEPCO_A_CORE_HQ_001',total_metres:30,date:'2026-11-01'},
 {...base,id:5,project:'Beta',hole_num:'TEST-B',code:'DEPCO_A_STANDBY_LOGGER_048',date:'2026-11-02'},
 {...base,id:6,project:'Beta',hole_num:'TEST-B',code:'DEPCO_A_RIG_CEMENTING_036',notes:'Cementing hole',date:'2026-11-03'},
 {...base,id:7,project:'Beta',hole_num:'TEST-C',code:'DEPCO_A_CORE_HQ_001',total_metres:10,date:'2026-11-04'},
 {...base,id:8,project:'Beta',hole_num:'TEST-C',code:'H_Standby_Client',notes:'Incident standby',date:'2026-11-04'},
];
await context.route('http://localhost:8000/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 const data=path==='/mobile/me'?{name:'Sample',role:'System Administrator',management_portal_access:true}:path==='/contractors'?[{name:base.contractor,category:'Drilling'}]:path==='/clients'?[{id:1,name:'Sample'}]:path==='/projects'?[{id:1,client_id:1,name:'Alpha',program:'Exploration'},{id:2,client_id:1,name:'Beta',program:'Exploration'}]:path==='/activity-report-data'?{activities:rows,consumables:[],crew:[],report_approvals:[],activity_sheet_locks:[]}:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://localhost:8766/eos.html?view=reports');await page.waitForFunction(()=>document.getElementById('eos-completed-holes-count').textContent==='1');
 await page.locator('#eos-period-preset').selectOption('all');assert.equal(await page.locator('#eos-completed-holes-count').innerText(),'2');
 const details=page.locator('#eos-completed-holes');await details.locator('summary').click();assert.match(await details.innerText(),/TEST-A/);assert.match(await details.innerText(),/TEST-B/);assert.doesNotMatch(await details.innerText(),/TEST-C/);
 const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;let text='';for(let i=1;i<=doc.numPages;i++)text+=(await (await doc.getPage(i)).getTextContent()).items.map(x=>x.str).join(' ');await doc.destroy();assert.match(text,/Completion recorded/);assert.match(text,/TEST-A/);assert.match(text,/DrillOps/);
 await page.locator('#eos-project-filter').selectOption('Alpha');await page.waitForFunction(()=>document.getElementById('eos-completed-holes-count').textContent==='1');assert.doesNotMatch(await details.innerText(),/TEST-B/);
 await page.locator('#eos-period-to').fill('2026-10-01');await page.locator('#eos-period-to').dispatchEvent('change');assert.equal(await page.locator('#eos-completed-holes-count').innerText(),'0');
 // Exercise the actual import-review form, including edits and serialization.
 const imported=await page.evaluate(()=>{
  ocrImportScope={contractor:'DEPCO Drilling'};ocrPreviewContractor='DEPCO Drilling';ocrCurrentFile={name:'sample.pdf'};ocrCurrentData={hole_num:'TEST-A, TEST-B',activities:[{hole_num:'TEST-A',comments:'Cementing hole',completion_note:'Hole cemented to surface'},{hole_num:'TEST-B',comments:'Drill',total_metres:20}]};ocrCurrentIntegrityCheck={warnings:[]};renderOcrPreview();
  const panel=document.getElementById('ocr-preview-panel');panel.querySelector('[data-ocr-header="hole_num"]').value='TEST-B';
  const data=readOcrPreviewData();panel.querySelector('[data-ocr-row="0"][data-ocr-field="hole_num"]').value='';const unknown=readOcrPreviewData();return {data,unknown};
 });
 assert.deepEqual(imported.data.activities.map(r=>r.hole_num),['TEST-A','TEST-B']);assert.equal(imported.data.activities[0].completion_note,'Hole cemented to surface');assert.equal(imported.unknown.activities[0].hole_num,'');
 assert.deepEqual(errors,[]);console.log('PASS completion count, dates/projects, source details, print and per-activity OCR review');
}finally{await browser.close();}
