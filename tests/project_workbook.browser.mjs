import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});let fail=false,requests=0;
 const source={project:'Ironbark',year:2026,source:'Example budget.xlsx',total:1500,comparison_total:1200,boreholes:[{hole_id:'TEST',budget_total:1500,drilling_budget_total:1000,earthworks_budget_total:200,geophysical_budget_total:100,geological_support_budget_total:150,misc_budget_total:50}]};
 await context.addInitScript(()=>localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999})));
 await context.route('http://localhost:8000/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/project-budget-source'){requests++;return route.fulfill({status:fail?500:200,json:source});}
  const data=p==='/mobile/me'?{name:'Test',role:'System Administrator',management_portal_access:true}:p==='/clients'?[{id:1,name:'Example client'}]:p==='/projects'?[{id:1,name:'Ironbark',client_id:1,program:'Exploration',year:'2026'},{id:2,name:'Ironbark',client_id:1,program:'Gas Riser',year:'2026'}]:p==='/project-budgets'?[{project:'Ironbark',program:'Gas Riser',budget_amount:200,section:'Drilling'}]:[];
  await route.fulfill({json:data});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:8766/project.html');
 await page.waitForFunction(()=>document.querySelector('#pm-message').textContent.includes('Choose a project'));
 await page.locator('#project-switcher-button').click();assert.equal(await page.locator('[data-project-choice]').count(),2);
 const trigger=await page.locator('#project-switcher-button').boundingBox(),panel=await page.locator('#project-switcher-panel').boundingBox();assert.ok(panel.y+panel.height<trigger.y);
 await page.locator('[data-project-choice="1"]').click();await page.waitForFunction(()=>document.querySelector('#pm-budget').textContent==='$1,200.00');assert.match(await page.locator('#pm-workbook-note').innerText(),/1,500/);assert.equal(await page.locator('.project-settings-section [data-page]').count(),2);assert.equal(await page.locator('.project-settings-section [data-page=project-budgets]').count(),1);assert.equal(await page.locator('.project-settings-section [data-page=admin]').count(),1);
 await page.locator('#project-switcher-button').click();await page.screenshot({path:'../project-switcher-test.png'});await page.keyboard.press('Escape');assert.equal(await page.locator('#project-switcher-panel').isVisible(),false);
 await page.locator('.drawer-nav-item[data-page="budget"]').click();await page.waitForFunction(()=>document.querySelector('#project-workbook-budget').textContent.includes('Example budget.xlsx'));
 assert.equal(await page.locator('#budget-kpi-total').innerText(),'$1,200.00');assert.equal(await page.locator('#budget-kpi-drilling').innerText(),'$1,500.00');assert.equal(await page.locator('#budget-kpi-support').innerText(),'$300.00');assert.match(await page.locator('#pm-budget-label').innerText(),/Approved budget/);assert.equal(await page.locator('.budget-hole-ledger tbody tr').count(),1);assert.match(await page.locator('#project-workbook-budget').innerText(),/TEST/);
 await page.locator('#project-switcher-button').click();await page.locator('[data-project-choice="2"]').click();await page.waitForFunction(()=>document.querySelector('#budget-kpi-total').textContent==='$200.00');assert.equal(await page.locator('#project-workbook-budget').isVisible(),false);assert.equal(await page.locator('#page-budget .kpi-label').first().textContent(),'Project budget');
 await page.reload();await page.waitForFunction(()=>document.querySelector('#pm-budget').textContent==='$200');assert.match(await page.locator('#project-switcher-meta').innerText(),/Gas Riser/);
 fail=true;await page.locator('#project-switcher-button').click();await page.locator('[data-project-choice="1"]').click();await page.waitForFunction(()=>document.querySelector('#pm-budget').textContent==='Unavailable');assert.equal(await page.locator('#pm-budget-chart .pm-allocation').count(),0);
 await page.setViewportSize({width:390,height:844});await page.locator('#hamburger-btn').click();await page.locator('#project-switcher-button').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok(requests>=2);assert.deepEqual(errors,[]);
 console.log('PASS saved workbook dashboard/budget, sidebar popover, scope isolation, persisted selection, failures, keyboard and mobile');
}finally{await browser.close();}
