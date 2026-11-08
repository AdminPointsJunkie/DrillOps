import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];let fail=false;
 const holes=[{id:1,contractor:'Company',project:'Ironbark',program:'Exploration',planned_year:2026,hole_id:'TEST-A',site_id:'SITE-A',drill_order:1,source_status:'Drilled',status:'Complete',days_budgeted:2,eoh_depth:20,total_core:10,drilling_budget_total:1000,earthworks_budget_total:200,geophysical_budget_total:100,geological_support_budget_total:150,misc_budget_total:50,budget_total:1500}, {id:2,contractor:'Company',project:'Ironbark',program:'Exploration',planned_year:2026,hole_id:'TEST-B',site_id:'SITE-B',drill_order:2,source_status:'Cancelled',status:'Cancelled',drilling_budget_total:200,earthworks_budget_total:100,geophysical_budget_total:100,geological_support_budget_total:50,misc_budget_total:50,budget_total:500}];
 const source={project:'Ironbark',year:2026,source:'Example workbook.xlsx',sheet:'Budget Breakdown',total:2000,comparison_total:1800,boreholes:holes,contractors:[{key:'drill',name:'Mitchells Drilling'},{key:'support',name:'Support',source_line:'Source budget'}],holes:[[1,'TEST-A',2,1000,500],[2,'TEST-B',1,200,300]]};
 await context.addInitScript(()=>{localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999}));localStorage.setItem('drillops_client_id','1');localStorage.setItem('drillops_project','Ironbark');localStorage.setItem('drillops_program','Exploration');});
 await context.route('http://localhost:8000/**',async route=>{
  const url=new URL(route.request().url()),p=url.pathname;
  if(p==='/activity-report-data'&&fail)return route.fulfill({status:500,json:{}});
  const data=p==='/mobile/me'?{name:'Test',role:'System Administrator',management_portal_access:true}:p==='/clients'?[{id:1,name:'Example client'}]:p==='/projects'?[{id:1,name:'Ironbark',client_id:1,program:'Exploration',year:'2026'}]:p==='/contractors'?[{name:'Mitchells Drilling',program:'Exploration',category:'Drilling',active:true,sites:'Ironbark'}]:p==='/project-budget-source'?source:p==='/boreholes'?holes:p==='/activity-report-data'?{activities:url.searchParams.get('contractor')==='Mitchells Drilling'?[{id:1,contractor:'Mitchells Drilling',project:'Ironbark',program:'Exploration',date:'2026-11-01',hole_num:'TEST-A',code:'Drill_Core',total_metres:10,hours:2,line_cost:500,source_file:'test-report.pdf'}]:[],consumables:[],crew:[],report_approvals:[],activity_sheet_locks:[]}:p==='/exploration-metres-summary'?{}:[];
  await route.fulfill({json:data});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8766/project.html?view=budget');await page.waitForFunction(()=>document.querySelectorAll('.budget-hole-ledger tbody tr').length===2);
 assert.match(await page.locator('.budget-hole-ledger tfoot').innerText(),/2,000.00/);assert.equal(await page.locator('#budget-manual-section').getAttribute('open'),null);
 await page.locator('#budget-ledger-search').fill('TEST-B');assert.equal(await page.locator('.budget-hole-ledger tbody tr').count(),1);assert.match(await page.locator('.budget-hole-ledger tfoot').innerText(),/500.00/);
 await page.locator('#budget-ledger-search').fill('');await page.locator('#budget-ledger-status').selectOption('Drilled');assert.equal(await page.locator('.budget-hole-ledger tbody tr').count(),1);
 await page.locator('#budget-ledger-status').selectOption('');await page.locator('#budget-ledger-details').check();assert.match(await page.locator('.budget-hole-ledger thead').innerText(),/Depth/);
 const downloadPromise=page.waitForEvent('download');await page.locator('#budget-ledger-export').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/hole-budget.csv/);
 await page.screenshot({path:'../project-hole-budget-test.png',fullPage:true});
 await page.goto('http://localhost:8766/project.html?view=reports');await page.waitForFunction(()=>document.querySelector('#period-hole-body')?.textContent.includes('TEST-A'),{},{timeout:20000});
 assert.equal(await page.locator('.page.active').getAttribute('id'),'page-reports');assert.equal(await page.locator('#project-hole-print').isEnabled(),true);assert.equal(await page.locator('#period-hole-graphics').isVisible(),true);assert.match(await page.locator('#period-hole-body').innerText(),/500/);
 await page.evaluate(()=>window.print=()=>window.testPrinted=true);await page.locator('#project-hole-print').click();await page.waitForFunction(()=>window.testPrinted===true);
 await page.evaluate(()=>document.body.classList.remove('period-print-prep'));fail=true;await page.getByRole('button',{name:'Update report',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#period-report-meta').textContent==='Report data could not be loaded.');assert.equal(await page.locator('.period-report-body').isVisible(),false);assert.equal(await page.locator('#project-hole-print').isDisabled(),true);
 assert.deepEqual(errors,[]);console.log('PASS per-hole ledger, totals, filters, export and restored Project report with charts, print and failure protection');
}finally{await browser.close();}
