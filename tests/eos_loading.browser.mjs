import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext();const delay=300,counts={},starts={},completed={};
await context.addInitScript(()=>{new MutationObserver(()=>{if(!window.eosReadyAt&&document.getElementById('eos-metres')?.textContent==='10 m')window.eosReadyAt=Date.now();}).observe(document,{childList:true,subtree:true,characterData:true});localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999}));});
await context.route('http://localhost:8000/**',async route=>{
 const url=new URL(route.request().url()),p=url.pathname;counts[p]=(counts[p]||0)+1;starts[p]??=Date.now();await new Promise(r=>setTimeout(r,delay));
 const data=p==='/mobile/me'?{name:'Test',role:'System Administrator',management_portal_access:true}:p==='/contractors'?[{name:'Mitchells Drilling',category:'Drilling',program:'Exploration'}]:p==='/clients'?[{id:1,name:'Sample',status:'Active'}]:p==='/projects'?[{id:1,client_id:1,name:'Sample',program:'Exploration',status:'Active'}]:p==='/filters'?{dates:[],holes:[],sites:[],codes:[],total_rows:1}:p==='/activity-report-data'?{activities:[{id:1,contractor:'Mitchells Drilling',project:'Sample',program:'Exploration',date:'2026-10-02',source_file:'sample.pdf',drill_rig:'Rig 1',code:'Drill_Core',total_metres:10,total_time:'1:00'}],crew:[],consumables:[],report_approvals:[],activity_sheet_locks:[]}:[];
 completed[p]=Date.now();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage();let authStarted;
page.on('request',r=>{if(r.url().includes('/mobile/me'))authStarted=Date.now();});
try{
 await page.goto(process.env.DRILLOPS_TEST_URL||'http://localhost:8766/eos.html');await page.waitForFunction(()=>document.getElementById('eos-metres').textContent==='10 m');
 const initial=(await page.evaluate(()=>window.eosReadyAt))-authStarted;let at=Date.now();
 await page.locator('[data-page="reports"]').click();await page.waitForFunction(()=>document.getElementById('eos-period-narrative').textContent.startsWith('10.0 m'));const reports=Date.now()-at;
 if(!process.env.BASELINE){
  assert.equal(counts['/activity-report-data'],1,'one bundle reused across Overview and Production Report');
  assert.equal(counts['/filters']||0,0,'startup does not wait for another filter query');
  assert.ok(starts['/activity-report-data']<completed['/contractors'],'first report starts while metadata is loading');
  const before=counts['/activity-report-data'];await page.locator('#page-reports').getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('eos-period-document').hidden);assert.equal(counts['/activity-report-data'],before+1,'Refresh always fetches latest');
  await page.evaluate(()=>fetch(API+'/activities/1',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({notes:'test mutation'})}));
  await page.locator('#drawer .drawer-nav-item[href="./eos.html"]').click();await page.waitForFunction(()=>document.getElementById('eos-metres').textContent==='10 m');assert.equal(counts['/activity-report-data'],before+2,'edits invalidate cached data');
 }
 console.log(JSON.stringify({controlledRequestDelayMs:delay,authToOverviewMs:initial,overviewToReportMs:reports,requests:counts}));
}finally{await browser.close();}
