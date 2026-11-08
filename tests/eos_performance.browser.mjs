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
 await page.goto('http://localhost:8766/eos.html');await page.waitForFunction(()=>document.getElementById('eos-completed').textContent==='2');
 assert.match(await value('eos-overview-standby'),/Wet weather.*4\.0/s);assert.doesNotMatch(await value('eos-overview-standby'),/Fatigue/);
 await nav('production');await page.waitForFunction(()=>document.getElementById('production-kpi-metres').textContent==='120.0 m');
 assert.equal(await value('production-kpi-completed'),'2');assert.equal(await value('production-kpi-standby'),'5.0 h');
 assert.match(await value('production-performance'),/Penetration rate\s*15\.0/);assert.match(await value('production-performance'),/Core penetration\s*12\.0/);assert.match(await value('production-performance'),/Chip penetration\s*20\.0/);assert.match(await value('production-performance'),/Metres \/ production day\s*60\.0/);
 assert.equal(await page.locator('#production-chart .eos-average-line').count(),1);assert.equal(await page.locator('#production-rate-chart .eos-average-line').count(),1);
 assert.match(await value('production-move-summary'),/3\.5 h/);assert.match(await value('production-move-note'),/2\.0 h combines/);
 const before=bundles;await page.locator('#production-include-nonchargeable').check();assert.equal(await value('production-kpi-standby'),'7.0 h');assert.doesNotMatch(await value('production-standby-chart'),/Fatigue management/);assert.match(await value('production-standby-chart'),/Site inspections/);assert.equal(bundles,before);
 await nav('reports');await page.waitForFunction(()=>document.getElementById('eos-period-document').hidden===false);
 assert.equal(await page.locator('#eos-period-include-nonchargeable').isChecked(),true);assert.match(await value('eos-period-standby-summary'),/^7\.0 hours/);
 await page.locator('#eos-period-include-nonchargeable').uncheck();assert.match(await value('eos-period-standby-summary'),/^5\.0 hours/);assert.doesNotMatch(await value('eos-period-standby-chart'),/Fatigue/);
 assert.match(await value('eos-period-metrics'),/Holes completed\s*2/);assert.match(await value('eos-period-performance'),/Penetration rate\s*15\.0/);
 assert.equal(await page.locator('#eos-period-daily tr').count(),0);await nav('settings');await page.locator('#eos-load-period-tables').click();await page.waitForFunction(()=>document.querySelectorAll('#eos-period-daily tr').length===2);assert.equal(await page.locator('#eos-period-daily tr').count(),2);assert.equal(await page.locator('#eos-period-moves').count(),0);assert.equal(await page.locator('#eos-period-rig-chart').count(),0);
 await page.locator('#eos-period-from').fill('2026-10-02');await page.locator('#eos-period-from').dispatchEvent('change');
 assert.match(await value('eos-period-metrics'),/Holes completed\s*0/);assert.match(await value('eos-period-performance'),/Penetration rate\s*10\.0/);
 await page.locator('#eos-period-preset').selectOption('all');await nav('settings');await page.locator('#eos-unload-raw').click();await nav('reports');await page.waitForFunction(()=>!document.getElementById('eos-period-document').hidden);
 if(process.env.CAPTURE_EOS){
  await page.screenshot({path:process.env.CAPTURE_EOS+'/EOS-performance-report.png',fullPage:true});
  await page.evaluate(()=>document.body.classList.add('eos-period-print'));await page.emulateMedia({media:'print'});await page.pdf({path:process.env.CAPTURE_EOS+'/EOS-performance-report.pdf',preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});await page.evaluate(()=>document.body.classList.remove('eos-period-print'));
 }
 await nav('production');await page.waitForFunction(()=>document.getElementById('production-kpi-metres').textContent==='120.0 m');assert.equal(await page.locator('#production-include-nonchargeable').isChecked(),false);
 assert.equal(await page.locator('#production-daily tr').count(),0);await nav('settings');await page.locator('#eos-load-production-tables').click();await page.waitForFunction(()=>document.querySelectorAll('#production-daily tr').length===2);assert.equal(await page.locator('#production-daily tr').count(),2);
 await page.locator('#eos-project-filter').selectOption('Alpha');await page.waitForFunction(()=>document.getElementById('production-kpi-metres').textContent==='100.0 m');assert.equal(await value('production-kpi-completed'),'1');
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export filtered activities',exact:true}).click();const csv=await readFile(await (await downloaded).path(),'utf8');assert.match(csv,/Standby chargeability/);assert.match(csv,/\"non-chargeable\",\"false\"/);assert.match(csv,/\"Wet weather\",\"chargeable\",\"true\"/);
 await page.setViewportSize({width:390,height:844});for(const view of ['production','reports']){await page.evaluate(v=>drawerNav(document.querySelector('[data-page="'+v+'"]')),view);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+' mobile overflow');}
 assert.deepEqual(errors,[]);console.log('PASS standby scope, wet-weather reasons, completed holes, weighted penetration, daily averages, site moves, print and mobile');
}finally{await browser.close();}
