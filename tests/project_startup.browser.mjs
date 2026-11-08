import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 for(const view of ['project-dashboard','budget','drilling-schedule']){
  const context=await browser.newContext(),counts={},errors=[];
  const holes=[{id:1,contractor:'Company',project:'Ironbark',program:'Exploration',planned_year:2026,hole_id:'TEST-A',site_id:'SITE-A',status:'Planned',budget_total:1000,drilling_budget_total:1000,earthworks_budget_total:0,geophysical_budget_total:0,geological_support_budget_total:0,misc_budget_total:0}];
  const source={project:'Ironbark',year:2026,source:'Example.xlsx',sheet:'Budget Breakdown',total:1000,comparison_total:1200,boreholes:holes,contractors:[{key:'drill',name:'Mitchells Drilling'}],holes:[[1,'TEST-A',2,1000]]};
  await context.addInitScript(()=>{localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999}));localStorage.setItem('drillops_client_id','1');localStorage.setItem('drillops_project','Ironbark');localStorage.setItem('drillops_program','Exploration');});
  await context.route('http://localhost:8000/**',async route=>{const p=new URL(route.request().url()).pathname;counts[p]=(counts[p]||0)+1;
   const data=p==='/mobile/me'?{name:'Test',role:'System Administrator',management_portal_access:true}:p==='/clients'?[{id:1,name:'Example'}]:p==='/projects'?[{id:1,name:'Ironbark',client_id:1,program:'Exploration',year:'2026'}]:p==='/boreholes'?holes:p==='/rig-schedule'?{entries:[],planner:holes,projects:[]}:p==='/project-budget-source'?source:p==='/account-accruals/project-summary'?{invoiced:0,accruals:0,combined:0,missing_amounts:0}:[];await route.fulfill({json:data});});
  const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('console',msg=>{if(msg.type()==='error')console.log(msg.text());});await page.goto((process.env.TEST_ORIGIN||'http://localhost:8766')+'/project.html?view='+view);
  if(view==='project-dashboard')await page.waitForFunction(()=>document.querySelector('#pm-updated').textContent.startsWith('Updated'));
  if(view==='budget')await page.waitForSelector('.budget-hole-ledger tbody tr');
  if(view==='drilling-schedule')await page.waitForSelector('#rs-content:not([hidden])');
  for(const p of ['/contractors','/project-contractors','/filters','/filter-options'])assert.equal(counts[p]||0,0,view+' must not load '+p);
  assert.equal(counts['/boreholes']||0,view==='drilling-schedule'?0:1,view+' loads planner once');assert.equal(counts['/rig-schedule']||0,view==='drilling-schedule'?1:0);assert.equal(counts['/project-budgets']||0,view==='drilling-schedule'?0:1);assert.equal(counts['/project-budget-source']||0,view==='drilling-schedule'?0:1);assert.equal(counts['/clients'],1);assert.equal(counts['/projects'],1);
  assert.equal(counts['/account-accruals/project-summary']||0,view==='project-dashboard'?1:0);
  assert.equal(await page.locator('#contractor-switcher').count(),0);assert.equal(await page.locator('script[src*="invoice-ledger"],script[src*="invoice-import"],script[src*="fortem-estimate"],link[href*="invoice-ledger"]').count(),0);
  if(errors.length)console.log(errors);if(view==='budget'){const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/contractors');await page.locator('#budget-manual-section summary').click();await response;assert.equal(counts['/contractors'],1,'supplier directory loads on demand');}assert.deepEqual(errors,[]);console.log('PASS '+view+' startup: '+JSON.stringify(counts));await context.close();
 }
}finally{await browser.close();}
