import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
const common={contractor:'Mitchells Drilling',project:'Alpha',program:'Exploration',date:'2026-10-01',drill_rig:'Rig 1',hole_num:'A1',source_file:'sample-day-1.csv',shift:'Day',total_metres:0};
const rows=[
 {id:1,code:'Drill_Core',total_metres:30,total_time:'2:00',notes:'EOH'},
 {id:2,code:'Drill_Chip_or_Open_hole',total_metres:60,total_time:'3:00',drill_rig:'Rig 2',hole_num:'A2'},
 {id:3,code:'H_Standby_Wet_Weath',total_time:'4:00',unit_rate:650},
 {id:4,code:'H_Standby_Fatigue',total_time:'32:45',unit_rate:0,line_cost:0,rate_basis:'not chargeable'},
 {id:11,code:'H_Standby_Inspection',total_time:'2:00',unit_rate:0,line_cost:0},
 {id:5,code:'H_Standby_Water',total_time:'1:00',unit_rate:500},
 {id:6,code:'DEPCO_A_STANDBY_WET_WEAT_053',total_time:'1:00',unit_rate:null,line_cost:null},
 {id:7,code:'H_Rig_Move',total_time:'1:30',notes:'Rig move to next site'},
 {id:8,code:'H_Surface_Setup',total_time:'2:00',notes:'Site move & setup'},
 {id:9,code:'Drill_Core',total_metres:10,total_time:'1:00',date:'2026-10-02',source_file:'sample-day-2.csv',notes:'End of hole flush'},
 {id:10,code:'Drill_Core',total_metres:20,total_time:'2:00',project:'Beta',drill_rig:'Rig 2',notes:'Hole completed'},
].map(r=>({...common,...r}));
await context.addInitScript(()=>{localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999}));});
let bundles=0;await context.route('http://localhost:8000/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/activity-report-data')bundles++;
 const data=path==='/mobile/me'?{name:'Sample',role:'System Administrator',management_portal_access:true}:path==='/activity-report-data'?{activities:rows,crew:[],consumables:[],report_approvals:[],activity_sheet_locks:[]}:path==='/contractors'?[{name:'Mitchells Drilling',category:'Drilling',program:'Exploration'}]:path==='/clients'?[{id:1,name:'Sample'}]:path==='/projects'?[{id:1,name:'Alpha',client_id:1,program:'Exploration'},{id:2,name:'Beta',client_id:1,program:'Exploration'}]:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const value=id=>page.locator('#'+id).innerText();
const nav=async view=>page.locator('#drawer [data-page="'+view+'"]').click();
try{
 await page.goto('http://localhost:8766/eos.html?view=production');await page.waitForFunction(()=>document.getElementById('eos-period-narrative').textContent.startsWith('120.0 m'));
 assert.equal(await page.locator('#page-production').count(),0);assert.equal(await page.locator('#drawer [data-page="production"]').count(),0);assert.equal(await page.locator('#drawer [data-page="reports"]').innerText(),'Production Report');
 assert.equal(await page.locator('#page-reports h1').innerText(),'Production Report');assert.match(page.url(),/view=reports/);
 assert.match(await value('eos-period-metrics'),/Holes completed\s*2/);assert.match(await value('eos-period-standby-summary'),/^5\.0 hours/);
 assert.match(await value('eos-period-performance'),/Penetration rate\s*15\.0/);assert.match(await value('eos-period-performance'),/Core penetration\s*12\.0/);assert.match(await value('eos-period-performance'),/Chip penetration\s*20\.0/);assert.match(await value('eos-period-performance'),/Metres \/ production day\s*60\.0/);
 assert.doesNotMatch(await value('eos-period-performance'),/Chipped \/ production day|producing rig-day|Site-move time/);
 assert.equal(await page.locator('#eos-period-chart .eos-average-line').count(),1);assert.equal(await page.locator('#eos-period-rate-chart .eos-average-line').count(),1);
 assert.equal(await page.locator('#eos-period-register tr').count(),4);assert.equal(await page.locator('.eos-period-register').isVisible(),true);assert.equal(await page.locator('#eos-period-daily tr').count(),0);
 const before=bundles;await page.locator('#eos-period-include-nonchargeable').check();assert.match(await value('eos-period-standby-summary'),/^7\.0 hours/);assert.doesNotMatch(await value('eos-period-standby-chart'),/Fatigue management/);assert.match(await value('eos-period-standby-chart'),/Site inspections/);assert.equal(bundles,before);
 await page.locator('#eos-period-include-nonchargeable').uncheck();assert.match(await value('eos-period-standby-summary'),/^5\.0 hours/);
 await page.locator('#eos-period-show-charges').check();assert.equal(await page.locator('.eos-shift-charge').count(),4);
 await page.evaluate(()=>document.body.classList.add('eos-period-print'));await page.emulateMedia({media:'print'});
 assert.equal(await page.locator('.eos-period-register').isVisible(),true);assert.equal(await page.locator('#eos-period-charges-heading').isVisible(),true);
 assert.match(await page.locator('#eos-print-page-style').textContent(),/@top-left.*Production Report.*Mitchells Drilling.*@top-right/s);
 if(process.env.CAPTURE_EOS)await page.pdf({path:process.env.CAPTURE_EOS+'/EOS-production-register.pdf',preferCSSPageSize:true,printBackground:true});
 await page.emulateMedia({media:'screen'});await page.evaluate(()=>document.body.classList.remove('eos-period-print'));
 if(process.env.CAPTURE_EOS){
  await page.getByRole('button',{name:'Collapse all',exact:true}).filter({visible:true}).click();await page.getByRole('button',{name:'05 Shift register',exact:true}).click();
  await page.evaluate(()=>document.body.classList.add('eos-period-print'));await page.emulateMedia({media:'print'});await page.pdf({path:process.env.CAPTURE_EOS+'/EOS-shift-register-only.pdf',preferCSSPageSize:true,printBackground:true});
  await page.emulateMedia({media:'screen'});await page.evaluate(()=>document.body.classList.remove('eos-period-print'));await page.getByRole('button',{name:'Expand all',exact:true}).filter({visible:true}).click();
 }
 await page.locator('#eos-period-show-charges').uncheck();assert.equal(await page.locator('.eos-shift-charge').count(),0);
 await page.locator('#eos-period-from').fill('2026-10-02');await page.locator('#eos-period-from').dispatchEvent('change');assert.match(await value('eos-period-metrics'),/Holes completed\s*0/);assert.match(await value('eos-period-performance'),/Penetration rate\s*10\.0/);assert.equal(await page.locator('#eos-period-register tr').count(),1);
 await page.locator('#eos-period-preset').selectOption('all');await page.locator('#eos-project-filter').selectOption('Alpha');await page.waitForFunction(()=>document.getElementById('eos-period-narrative').textContent.startsWith('100.0 m'));assert.match(await value('eos-period-metrics'),/Holes completed\s*1/);
 await nav('settings');await page.locator('#eos-load-period-tables').click();await page.waitForFunction(()=>document.querySelectorAll('#eos-period-daily tr').length===2);
 await nav('settings');await page.locator('#eos-unload-raw').click();await nav('reports');await page.waitForFunction(()=>!document.getElementById('eos-period-document').hidden);
 assert.equal(await page.locator('#eos-period-daily tr').count(),0);assert.equal(await page.locator('#eos-period-register tr').count(),3);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS single Production Report, legacy redirect, default printable shift register, optional charges, retained averages/rates, standby and scope');
}finally{await browser.close();}
