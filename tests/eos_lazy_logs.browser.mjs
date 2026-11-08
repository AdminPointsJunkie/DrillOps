import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999})));
const contractor='Mitchells Drilling';
const common={contractor,project:'Alpha',date:'2026-10-01',drill_rig:'Rig 1',source_file:'sample.pdf',hole_num:'A1',shift:'Day'};
const rows=[{...common,id:1,code:'Drill_Core',total_metres:10,total_time:'1:00',line_cost:100},{...common,id:2,code:'H_Standby_Fatigue',total_time:'32:45',unit_rate:0,line_cost:0},{...common,id:3,code:'H_Standby_Wet_Weath',total_time:'2:00',unit_rate:650,line_cost:1300}];
let bundles=0,hold=false,release;
await context.route('http://localhost:8000/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/activity-report-data'){bundles++;if(hold){hold=false;await new Promise(r=>release=r);}}
 const data=path==='/mobile/me'?{name:'Sample',role:'System Administrator',management_portal_access:true}:path==='/contractors'?[{name:contractor,category:'Drilling',program:'Exploration'}]:path==='/clients'?[{id:1,name:'Sample'}]:path==='/projects'?[{id:1,client_id:1,name:'Alpha',program:'Exploration'}]:path==='/activity-report-data'?{activities:rows,crew:[],consumables:[],report_approvals:[],activity_sheet_locks:[]}:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const nav=view=>page.locator('#drawer [data-page="'+view+'"]').click();
const rawRows=()=>page.locator('#act-body tr,#report-body tr,#con-body tr,#crew-body tr').count();
const reportRows=()=>page.locator('#eos-period-document tbody:not(#eos-period-register) tr').count();
try{
 // A bookmarked raw-log page must offer the Settings button without fetching reports.
 await page.goto('http://localhost:8766/eos.html?view=activities');
 await page.waitForFunction(()=>document.getElementById('page-settings').classList.contains('active'));
 assert.equal(bundles,0);assert.equal(await rawRows(),0);assert.equal(await page.locator('.eos-raw-nav').isVisible(),false);
 await page.locator('#eos-load-raw').click();await page.waitForFunction(()=>document.querySelectorAll('#act-body tr[data-id]').length===3);
 assert.equal(bundles,1);assert.equal(await page.locator('.eos-raw-nav').isVisible(),true);assert.equal(await page.locator('#report-body tr.report-row').count(),1);
 await nav('settings');await page.locator('#eos-unload-raw').click();assert.equal(await rawRows(),0);assert.equal(await reportRows(),0);
 const before=bundles;await page.evaluate(()=>loadActivities());assert.equal(bundles,before,'background hooks cannot load raw logs');
 await page.locator('#drawer .drawer-nav-item[href="./eos.html"]').click();await page.waitForFunction(()=>document.getElementById('eos-metres').textContent==='10 m');
 assert.equal(await rawRows(),0);assert.equal(await page.locator('#eos-overview-production svg').count(),1);
 await nav('reports');await page.waitForFunction(()=>!document.getElementById('eos-period-document').hidden);
 assert.equal(await reportRows(),0);assert.equal(await rawRows(),0);assert.equal(await page.locator('#eos-period-register tr').count(),1);assert.equal(await page.locator('.eos-period-register').isVisible(),true);
 const chartsBundles=bundles;await nav('settings');assert.equal(bundles,chartsBundles);assert.equal(await page.locator('#eos-load-production-tables').count(),0);
 await page.locator('#eos-load-period-tables').click();await page.waitForFunction(()=>document.querySelectorAll('#eos-period-daily tr').length===1);
 assert.equal(await rawRows(),0);assert.equal(await page.locator('.eos-shift-charge').count(),0);const chargeRequests=bundles;await page.locator('#eos-period-show-charges').check();assert.equal(await page.locator('.eos-shift-charge').innerText(),'$1,400.00');assert.equal(bundles,chargeRequests);await page.locator('#eos-period-show-charges').uncheck();assert.equal(await page.locator('.eos-shift-charge').count(),0);await nav('settings');await page.locator('#eos-unload-raw').click();assert.equal(await reportRows(),0);
 assert.equal(await page.locator('#eos-period-register tr').count(),1,'unloading raw tables retains the report register');
 // Unloading while a request is pending must not rebuild hidden rows on completion.
 await page.evaluate(()=>{invalidateEosReads();});hold=true;
 await page.locator('#eos-load-raw').click();await page.waitForFunction(()=>document.getElementById('report-body').textContent.includes('Loading'));
 while(!release)await new Promise(r=>setTimeout(r,10));
 await nav('settings');await page.locator('#eos-unload-raw').click();release();await page.waitForTimeout(100);
 assert.equal(await rawRows(),0);assert.equal(await page.locator('.eos-raw-nav').isVisible(),false);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.CAPTURE_EOS){await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:process.env.CAPTURE_EOS+'/EOS-settings.png'});}
 assert.deepEqual(errors,[]);console.log('PASS Settings opt-in, deep links, default shift register, optional detailed tables, unload and in-flight cancellation');
}finally{await browser.close();}
