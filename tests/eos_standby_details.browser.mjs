import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1100}});
await context.addInitScript(()=>{localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999}));sessionStorage.setItem('drillops_contractor','DEPCO Drilling');});
const base={contractor:'DEPCO Drilling',project:'Alpha',program:'Exploration',date:'2026-10-01',drill_rig:'DR17',hole_num:'A1',shift:'Day',total_metres:0,code:'DEPCO_A_STANDBY_WET_WEAT_053',total_time:'0:30',unit_rate:550,line_cost:275};
const rows=Array.from({length:60},(_,i)=>({...base,id:i+1,date:'2026-10-'+String(i%28+1).padStart(2,'0'),source_file:'sample-'+String(i+1).padStart(3,'0')+'.pdf',notes:'Wet weather standby entry '+String(i+1).padStart(3,'0')}));
rows.push({...base,id:61,code:'H_Standby_Logger',notes:'Waiting for logger',program:'Gas Riser',project:'Beta',drill_rig:'DR28',total_time:'1:00',line_cost:100},
 {...base,id:62,code:'H_Standby_Fatigue',notes:'Unpaid fatigue',total_time:'32:45',line_cost:0},
 {...base,id:63,code:'H_Standby_Inspection',notes:'Inspection with no charge',total_time:'2:00',unit_rate:0,line_cost:0},
 {...base,id:64,code:'H_Standby_Water',notes:'Unconfirmed water standby',total_time:'1:00',unit_rate:null,line_cost:null},
 {...base,id:65,code:'H_Standby_Fatigue',notes:'Paid fatigue',total_time:'1:00',line_cost:50},
 {...base,id:66,notes:'Missing duration',total_time:'',line_cost:null},
 {...base,id:67,notes:'Wet weather credit',total_time:'0:15',line_cost:-10});
let bundles=0,fail=false;
await context.route('http://localhost:8000/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/activity-report-data'){bundles++;if(fail){fail=false;return route.fulfill({status:503,body:'Unavailable'});}}
 const data=path==='/mobile/me'?{name:'Sample',role:'System Administrator',management_portal_access:true}:path==='/contractors'?[{name:base.contractor,category:'Drilling'}]:path==='/clients'?[{id:1,name:'Sample'}]:path==='/projects'?[{id:1,client_id:1,name:'Alpha',program:'Exploration'},{id:2,client_id:1,name:'Beta',program:'Gas Riser'}]:path==='/activity-report-data'?{activities:rows,consumables:[],crew:[],report_approvals:[],activity_sheet_locks:[]}:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const details=page.locator('#eos-standby-details'),wet=()=>page.locator('.eos-standby-reason[data-reason="Wet weather"]'),entries=()=>page.locator('.eos-standby-entry-table tbody tr');
async function pdfText(pdf){const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise,pages=[];for(let i=1;i<=doc.numPages;i++){const p=await doc.getPage(i);pages.push((await p.getTextContent()).items);}await doc.destroy();return pages;}
try{
 await page.goto('http://localhost:8766/eos.html?view=reports');await page.waitForFunction(()=>document.getElementById('eos-standby-details-summary').textContent.includes('32.25'));
 assert.equal(await details.evaluate(el=>el.open),false);assert.equal(await entries().count(),0);assert.equal(await page.locator('#act-body tr').count(),0);assert.equal(bundles,1);
 await details.locator(':scope>summary').click();await page.waitForFunction(()=>document.querySelectorAll('.eos-standby-reason').length===3);
 assert.equal(await entries().count(),0);assert.match(await wet().innerText(),/30.25 h/);assert.match(await wet().innerText(),/62 entries · 1 missing duration/);
 await wet().locator('summary').click();await page.waitForFunction(()=>document.querySelectorAll('.eos-standby-entry-table tbody tr').length===62);
 assert.doesNotMatch(await wet().innerText(),/\$/);assert.match(await wet().innerText(),/Missing duration[\s\S]*Not recorded/);
 await page.locator('#eos-standby-show-charges').check();assert.equal(await page.locator('#eos-period-show-charges').isChecked(),true);assert.match(await wet().innerText(),/\$16,490.00 \*/);assert.match(await wet().innerText(),/Unpriced/);
 await page.locator('#eos-period-include-nonchargeable').check();assert.equal(await page.locator('.eos-standby-reason').count(),4);assert.match(await details.innerText(),/Site inspections/);assert.doesNotMatch(await details.innerText(),/Unpaid fatigue|Unconfirmed water standby/);
 await page.locator('#eos-period-include-nonchargeable').uncheck();await page.locator('#eos-period-show-charges').uncheck();assert.equal(await page.locator('#eos-standby-show-charges').isChecked(),false);assert.doesNotMatch(await wet().innerText(),/\$/);
 await page.locator('#eos-period-rig').selectOption('DR28');assert.equal(await page.locator('.eos-standby-reason').count(),1);assert.match(await details.innerText(),/Waiting for geophysical logger/);assert.equal(await entries().count(),0);
 await page.locator('#eos-period-rig').selectOption('');await page.locator('#eos-period-from').fill('2026-10-28');await page.locator('#eos-period-from').dispatchEvent('change');assert.match(await page.locator('#eos-standby-details-summary').innerText(),/1 reason · 1.00 h/);
 await page.locator('#eos-period-preset').selectOption('all');await page.locator('#eos-project-filter').selectOption('Beta');await page.waitForFunction(()=>document.getElementById('eos-standby-details-summary').textContent.includes('1.00 h'));assert.equal(await page.locator('.eos-standby-reason').count(),1);
 await page.locator('#eos-clear-scope').click();await page.waitForFunction(()=>document.getElementById('eos-standby-details-summary').textContent.includes('32.25'));
 await page.getByRole('button',{name:'Expand reasons',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.eos-standby-entry-table tbody tr').length===64);assert.equal(bundles,1);
 const scrollBefore=await page.evaluate(()=>({y:window.scrollY,mainY:document.querySelector('main').scrollTop}));
 const fullPages=await pdfText(await page.pdf({path:process.env.CAPTURE_EOS?process.env.CAPTURE_EOS+'/EOS-branded-full.pdf':undefined,preferCSSPageSize:true,printBackground:true}));
 for(const [i,items] of fullPages.entries()){const logo=items.find(x=>x.str==='DrillOps');assert.ok(logo,'full report branded header page '+(i+1));assert.ok(logo.transform[5]>750,'header remains at page top after scrolling');}
 await page.waitForFunction(p=>Math.abs(window.scrollY-p.y)<2&&Math.abs(document.querySelector('main').scrollTop-p.mainY)<2,scrollBefore);
 // Native print header repeats branding and context, with only the chosen section printed.
 await page.getByRole('button',{name:'Collapse all',exact:true}).filter({visible:true}).click();await page.getByRole('button',{name:'04 Time & standby',exact:true}).click();
 await page.locator('#eos-standby-show-charges').check();
 if(process.env.CAPTURE_EOS)await details.screenshot({path:process.env.CAPTURE_EOS+'/EOS-standby-details-desktop.png'});
 const expanded=await page.pdf({path:process.env.CAPTURE_EOS?process.env.CAPTURE_EOS+'/EOS-branded-standby.pdf':undefined,preferCSSPageSize:true,printBackground:true});
 const pages=await pdfText(expanded);assert.ok(pages.length>=3,'fixture must span multiple pages');
 for(const [i,items] of pages.entries()){
  const text=items.map(x=>x.str).join(' ');assert.match(text,/DrillOps/,'branding page '+(i+1));assert.match(text,/EOS/);assert.match(text,/DEPCO Drilling/);assert.match(text,/All projects \/ All programs/);assert.match(text,/All rigs/);
  const logo=items.find(x=>x.str==='DrillOps');assert.ok(logo,'wordmark page '+(i+1));assert.ok(logo.height>=12,'wordmark keeps its display size');
  const first=pages[0].find(x=>x.str==='DrillOps');assert.ok(Math.abs(logo.transform[5]-first.transform[5])<1,'header repeats at same position');
 }
 assert.match(pages.flat().map(x=>x.str).join(' '),/entry 060/);assert.match(pages.flat().map(x=>x.str).join(' '),/16,490.00/);
 await details.locator(':scope>summary').click();await page.waitForFunction(()=>document.querySelectorAll('.eos-standby-entry-table tbody tr').length===0);
 const collapsed=await pdfText(await page.pdf({preferCSSPageSize:true,printBackground:true}));assert.doesNotMatch(collapsed.flat().map(x=>x.str).join(' '),/Standby reason details|entry 060/);
 // Register-only remains one page for a small filtered period and keeps the branded header.
 await page.locator('#eos-period-from').fill('2026-10-28');await page.locator('#eos-period-from').dispatchEvent('change');await page.getByRole('button',{name:'Collapse all',exact:true}).filter({visible:true}).click();await page.getByRole('button',{name:'05 Shift register',exact:true}).click();
 const register=await pdfText(await page.pdf({preferCSSPageSize:true,printBackground:true}));assert.equal(register.length,1);assert.match(register[0].map(x=>x.str).join(' '),/DrillOps/);assert.match(register[0].map(x=>x.str).join(' '),/Shift register/);
 await page.getByRole('button',{name:'04 Time & standby',exact:true}).click();await details.locator(':scope>summary').click();await page.getByRole('button',{name:'Expand reasons',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>closeDrawer());await page.waitForFunction(()=>document.getElementById('drawer').getBoundingClientRect().right<=0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.CAPTURE_EOS)await details.screenshot({path:process.env.CAPTURE_EOS+'/EOS-standby-details-mobile.png'});
 await page.setViewportSize({width:1440,height:1100});fail=true;await page.locator('#page-reports').getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>document.getElementById('eos-period-message').textContent.includes('Could not load'));assert.equal(await page.locator('#eos-period-document').isVisible(),false);assert.equal(await entries().count(),0);
 assert.deepEqual(errors,[]);console.log('PASS standby reason details, lazy entries, filters, shared charges, exclusions, mobile, failure state and branded header across '+pages.length+' printed pages');
}finally{await browser.close();}
