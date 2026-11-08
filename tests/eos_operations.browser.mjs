import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.DRILLOPS_TEST_URL||'http://localhost:8766/';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1100}});
await context.addInitScript(()=>{
 localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test-session',expires_at:9999999999}));
 localStorage.setItem('drillops_client_id','1');localStorage.setItem('drillops_project','Alpha');localStorage.setItem('drillops_program','Exploration');
});
const contractors=['Mitchells Drilling','DEPCO Drilling','MCC Group'];
const projects=[{id:1,client_id:1,name:'Alpha',program:'Exploration',year:2026,status:'Active'},{id:2,client_id:1,name:'Beta',program:'Exploration',year:2026,status:'Active'},{id:3,client_id:1,name:'Alpha',program:'Gas Riser',year:2026,status:'Active'}];
const rows=[
 [1,'Alpha','Rig 1','Drill_Core',30,'2:00'],[2,'Alpha','Rig 2','Drill_Chip_or_Open_hole',20,'3:00'],[3,'Alpha','Rig 1','H_Standby_Fatigue',0,'2:00'],
 [4,'Beta','Rig 1','Drill_Core',5,'1:00'],[5,'Beta','Rig 2','Drill_Chip_or_Open_hole',15,'1:00'],[6,'Beta','Rig 1','',7,'1:00'],[7,'Beta','Rig 2','H_Standby_Logger',0,'1:00'],[8,'','Rig 1','Drill_Core',10,'1:00']
].map(([id,project,drill_rig,code,total_metres,total_time])=>({id,project,drill_rig,code,total_metres,total_time,contractor:contractors[0],client:'Sample Client',program:'Exploration',date:'2026-10-02',shift:'Day',source_file:'sample-'+drill_rig+'.pdf',hole_num:project+'-01',line_cost:total_metres*10,unit_rate:code==='H_Standby_Logger'?650:0}));
rows.push({id:9,project:'Alpha',program:'Gas Riser',contractor:contractors[0],date:'2026-10-03',source_file:'sample-gas.pdf',drill_rig:'Rig 2',code:'H_Standby_Logger',total_time:'1:00',total_metres:0,line_cost:0,unit_rate:650});
const depco=[{...rows[0],id:101,contractor:contractors[1],total_metres:900,total_time:'8:00'}];
const mcc=[{...rows[0],id:201,contractor:contractors[2],code:'Labour',total_metres:0,total_time:'8:00',source_file:'sample-daily.csv'}, {...rows[0],id:202,contractor:contractors[2],code:'Labour',total_metres:0,total_time:'40:00',source_file:'sample-weekly.xlsx',source_file_type:'mcc_weekly_xlsx'}];
let requests=[],documents=0,delayNext=false,failNext=false,release;
await context.route('http://localhost:8000/**',async route=>{
 const url=new URL(route.request().url()),path=url.pathname,contractor=url.searchParams.get('contractor');requests.push({path,contractor});
 const source=contractor===contractors[1]?depco:contractor===contractors[2]?mcc:rows;
 if(path==='/activity-report-data'&&delayNext){delayNext=false;await new Promise(r=>release=r);}
 if(path==='/activity-report-data'&&failNext){failNext=false;return route.fulfill({status:503,body:'Unavailable'});}
 const data=path==='/mobile/me'?{name:'Sample User',email:'sample@example.invalid',role:'System Administrator',management_portal_access:true}
 :path==='/clients'?[{id:1,name:'Sample Client',status:'Active'}]:path==='/projects'?projects
 :path==='/contractors'?contractors.map((name,id)=>({id:id+1,name,category:name==='MCC Group'?'Labour':'Drilling',active:true,program:'Exploration'}))
 :path==='/activity-report-data'?{activities:source,consumables:[],crew:[],report_approvals:[],activity_sheet_locks:[]}
 :path==='/filters'?{dates:['2026-10-02','2026-10-03'],holes:['Alpha-01','Beta-01'],sites:[],codes:[],total_rows:source.length}
 :path==='/cost-contracts'?contractors.flatMap((name,i)=>[{id:i+10,project_id:1,project_name:'Alpha',contractor:name,name:name+' Alpha',status:'Active'},{id:i+20,project_id:3,project_name:'Alpha',contractor:name,name:name+' Gas Riser',status:'Active'}])
 :path==='/rate-library-summary'?contractors.map(contractor=>({contractor,year:2026,drilling_rates:1}))
 :path==='/rates/years'?{years:[2026]}
 :path==='/costing'?{by_hole:source.map(r=>({...r,total_cost:r.line_cost,drilling_cost:r.line_cost,non_drilling_cost:0,activity_count:1})),by_date:source.map(r=>({...r,total_cost:r.line_cost})),grand_total:870}
 :path==='/activities'?source:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())documents++;});
const nav=async name=>{await page.locator('#drawer .drawer-nav-item[data-page="'+name+'"]').click();};
const text=id=>page.locator('#'+id).innerText();
try{
 await page.goto(base+'eos.html');await page.waitForFunction(()=>document.getElementById('eos-total').textContent!=='—');
 assert.equal(await page.locator('#workspace-gate').evaluate(e=>e.classList.contains('open')),false);
 assert.equal(await page.locator('#eos-project-filter').inputValue(),'');
 assert.deepEqual(await page.locator('#eos-contractor-filter option').allTextContents(),contractors);
 assert.equal(await text('eos-metres'),'87 m');
 assert.equal(await text('eos-total'),'6','same source filename stays separated by project');assert.equal(await page.locator('#report-body tr.report-row').count(),0);assert.equal(await page.locator('#eos-overview-production svg').count(),1);
 await page.evaluate(()=>window.navigationMarker='kept');const docCount=documents;
 await page.locator('#eos-project-filter').selectOption('Alpha');await page.waitForFunction(()=>document.getElementById('eos-metres').textContent==='50 m');
 await nav('production');await page.waitForFunction(()=>document.getElementById('production-kpi-metres').textContent==='50.0 m');
 assert.equal(await text('production-kpi-core'),'30.0 m');assert.equal(await text('production-kpi-chip'),'20.0 m');assert.equal(await text('production-kpi-standby'),'1.0 h');
 assert.equal(await page.locator('#production-contractor').count(),0);
 await page.locator('#drawer .drawer-nav-item[href="./eos.html"]').click();await page.waitForFunction(()=>document.getElementById('eos-metres').textContent==='50 m');
 assert.equal(documents,docCount);assert.equal(await page.evaluate(()=>window.navigationMarker),'kept');assert.equal(await page.locator('#login-screen').isVisible(),false);
 assert.equal(await page.locator('#eos-project-filter').inputValue(),'Alpha');
 await page.goBack();await page.waitForFunction(()=>document.getElementById('page-production').classList.contains('active'));
 assert.equal(await page.locator('#eos-project-filter').inputValue(),'Alpha');
 await page.locator('#eos-clear-scope').click();await page.waitForFunction(()=>document.getElementById('production-kpi-metres').textContent==='87.0 m');
 await page.locator('#production-rig').selectOption('Rig 2');assert.equal(await text('production-kpi-metres'),'35.0 m');
 await page.locator('#production-rig').selectOption('');
 await page.locator('#eos-program-filter').selectOption('Gas Riser');await page.waitForFunction(()=>document.getElementById('production-kpi-standby').textContent==='1.0 h');assert.equal(await text('production-kpi-metres'),'0.0 m');
 await page.locator('#eos-clear-scope').click();await page.waitForFunction(()=>document.getElementById('production-kpi-metres').textContent==='87.0 m');
 await page.locator('#eos-project-filter').selectOption('__unassigned__');await page.waitForFunction(()=>document.getElementById('production-kpi-metres').textContent==='10.0 m');
 await nav('costing');await page.waitForFunction(()=>document.getElementById('cost-grand').textContent==='$100.00');
 await page.locator('#eos-project-filter').selectOption('Alpha');await page.waitForFunction(()=>document.getElementById('cost-grand').textContent==='$500.00');
 await nav('cost-contracts');await page.waitForFunction(()=>document.querySelectorAll('#cost-contract-body tr').length===2);assert.equal((await text('cost-contract-body')).includes('DEPCO'),false);assert.equal((await text('rate-library-summary-body')).includes('DEPCO'),false);
 await nav('importer');assert.equal(await page.locator('#import-project-select').inputValue(),'');
 await page.locator('#import-client-select').selectOption('1');await page.locator('#import-project-select').selectOption('3');
 assert.deepEqual(await page.evaluate(()=>{const s=selectedImportScope();return [s.client.id,s.project.id,projectProgram(s.project)];}),[1,3,'Gas Riser']);
 await page.locator('#eos-project-filter').selectOption('Beta');assert.equal(await page.locator('#import-project-select').inputValue(),'3');
 assert.equal(await page.evaluate(()=>localStorage.getItem('drillops_project')),'Alpha');
 await page.locator('#eos-clear-scope').click();requests=[];await nav('reports');await page.waitForFunction(()=>document.getElementById('eos-period-document').hidden===false);
 assert.equal(requests.filter(r=>r.path==='/activity-report-data').every(r=>r.contractor==='Mitchells Drilling'),true);
 assert.equal(requests.some(r=>/budget|invoices|boreholes/.test(r.path)),false);
 assert.match(await text('eos-period-narrative'),/87.0 m/);assert.equal(await page.locator('#eos-period-rigs tr').count(),0);await nav('settings');await page.locator('#eos-load-period-tables').click();await page.waitForFunction(()=>document.querySelectorAll('#eos-period-projects tr').length===3);
 assert.equal(await page.locator('#page-reports').innerText().then(t=>/Total Budget|Forecast|Training/.test(t)),false);
 await page.locator('#eos-contractor-filter').selectOption('DEPCO Drilling');await page.waitForFunction(()=>document.getElementById('eos-period-narrative').textContent.startsWith('900.0 m'));
 assert.equal(await text('eos-period-contractor'),'DEPCO Drilling');
 await page.locator('#eos-contractor-filter').selectOption('MCC Group');await page.waitForFunction(()=>document.getElementById('eos-period-narrative').textContent.startsWith('8.0 h'));
 assert.equal(await page.locator('#eos-period-register tr').count(),1);
 await page.locator('#eos-contractor-filter').selectOption('Mitchells Drilling');await page.waitForFunction(()=>document.getElementById('eos-period-narrative').textContent.startsWith('87.0 m'));
 await nav('production');await page.waitForFunction(()=>document.getElementById('production-kpi-metres').textContent==='87.0 m');
 delayNext=true;await page.getByRole('button',{name:'Refresh',exact:true}).filter({visible:true}).click();await page.waitForFunction(()=>document.getElementById('production-message').textContent.includes('Loading'));
 await page.locator('#eos-contractor-filter').selectOption('DEPCO Drilling');await page.waitForFunction(()=>document.getElementById('production-kpi-metres').textContent==='900.0 m');release();await page.waitForTimeout(150);assert.equal(await text('production-kpi-metres'),'900.0 m');
 failNext=true;await page.locator('#page-production').getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>document.getElementById('production-message').textContent.includes('Could not load'));
 assert.equal(await text('production-kpi-metres'),'—');assert.equal(await page.locator('#production-print').isDisabled(),true);
 await page.locator('#eos-contractor-filter').selectOption('Mitchells Drilling');await page.waitForFunction(()=>document.getElementById('production-kpi-metres').textContent==='87.0 m');
 if(process.env.CAPTURE_EOS){
  await page.evaluate(()=>{const label=document.createElement('p');label.textContent='Sample records — layout check';label.style.cssText='font-size:11px;color:#63736a';document.getElementById('production-report').prepend(label);});
  await page.screenshot({path:process.env.CAPTURE_EOS+'/EOS-production-sample.png',fullPage:true});
  await page.evaluate(()=>document.body.classList.add('eos-production-print'));await page.emulateMedia({media:'print'});assert.equal(await page.locator('#page-reports').isVisible(),false);assert.equal(await page.locator('#production-kpi-core').evaluate(el=>getComputedStyle(el).visibility),'visible');assert.equal(await page.locator('#production-report .production-legend').isVisible(),true);await page.pdf({path:process.env.CAPTURE_EOS+'/EOS-production-sample.pdf',preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});await page.evaluate(()=>document.body.classList.remove('eos-production-print'));
  await nav('reports');await page.waitForFunction(()=>document.getElementById('eos-period-document').hidden===false);
  await page.evaluate(()=>{const label=document.createElement('p');label.textContent='Sample records — layout check';label.style.cssText='font-size:11px;color:#63736a';document.getElementById('eos-period-document').prepend(label);});
  await page.screenshot({path:process.env.CAPTURE_EOS+'/EOS-period-report-sample.png',fullPage:true});
  await page.evaluate(()=>document.body.classList.add('eos-period-print'));await page.emulateMedia({media:'print'});assert.equal(await page.locator('#page-production').isVisible(),false);await page.pdf({path:process.env.CAPTURE_EOS+'/EOS-period-report-sample.pdf',preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});await page.evaluate(()=>document.body.classList.remove('eos-period-print'));
 }
 await page.setViewportSize({width:390,height:844});
 for(const view of ['reports','production','settings']){
  await page.evaluate(view=>drawerNav(document.querySelector('[data-page="'+view+'"]')),view);await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+' mobile overflow');
 }
 assert.deepEqual(errors,[]);console.log('PASS EOS contractor isolation, scope, import destination, Overview navigation, back button, stale requests, errors, operational report and mobile');
}catch(error){console.error('Browser diagnostics',errors,await page.locator('#eos-overview-message').textContent(),await page.locator('#workspace-gate-error').textContent());throw error;}finally{await browser.close();}
