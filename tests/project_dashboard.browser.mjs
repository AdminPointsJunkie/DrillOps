import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
let budgetFailure=false,empty=false;
const scope={project:'Test Project',program:'Exploration',planned_year:2026};
const budgets=[['DRILLING',1200000],['EARTHWORKS',240000],['GEOPHYSICAL',180000],['GEOLOGICAL SUPPORT',60000]].map(([section,budget_amount],i)=>({...scope,id:i+1,vendor:'Test Supplier',section,budget_amount}));
const holes=Array.from({length:8},(_,i)=>({...scope,id:i+1,hole_id:'TEST-'+String(i+1).padStart(2,'0'),site_id:'SITE-'+i,status:i<3?'Complete':i===3?'In Progress':'Planned',assigned_rig:i<4?'Rig 01':'Rig 02',lat:-23.5+i*.001,lng:148.1+i*.001,current_budget_scope:true,scheduled_start:i<6?'2026-11-'+String(i*3+1).padStart(2,'0'):null,scheduled_end:i<6?'2026-11-'+String(i*3+4).padStart(2,'0'):null}));
await page.addInitScript(()=>{
 localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test-session',expires_at:9999999999}));
 localStorage.setItem('drillops_client_id','1');localStorage.setItem('drillops_project','Test Project');localStorage.setItem('drillops_program','Exploration');
});
await page.route('https://www.googletagmanager.com/**',route=>route.abort());
await page.route('http://localhost:8000/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/project-budgets'&&budgetFailure)return route.fulfill({status:500,body:'Unavailable'});
 const data=path==='/mobile/me'?{name:'Test User',email:'test@example.invalid',role:'System Administrator',management_portal_access:true}
 :path==='/clients'?[{id:1,name:'Test Client',status:'Active'}]
 :path==='/projects'?[{id:1,client_id:1,name:'Test Project',program:'Exploration',year:2026,status:'Active'}]
 :path==='/contractors'?[{id:1,name:'Test Supplier',program:'Exploration',sites:'Test Project',active:true}]
 :path==='/project-budgets'?(empty?[]:[...budgets,{...scope,program:'SIS',budget_amount:9000000}])
 :path==='/boreholes'?(empty?[]:[...holes,{...scope,project:'Another Project',status:'Complete'}])
 :path==='/stats'?{}:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:8766/project.html');
await page.waitForFunction(()=>document.getElementById('pm-total')?.textContent==='8');
assert.equal(await page.locator('#pm-budget').innerText(),'$1,680,000');
assert.equal(await page.locator('#pm-complete').innerText(),'3');
assert.equal(await page.locator('#pm-scheduled').innerText(),'6');
assert.equal(await page.locator('.pm-timeline-row').count(),6);
assert.equal(await page.locator('.page.active').getAttribute('id'),'page-project-dashboard');
if(process.env.CAPTURE_PROJECT)await page.screenshot({path:process.env.CAPTURE_PROJECT,fullPage:true});
await page.evaluate(()=>window.print=()=>window.testPrinted=true);
await page.getByRole('button',{name:'Print dashboard',exact:true}).click();
assert.equal(await page.evaluate(()=>window.testPrinted),true);
await page.setViewportSize({width:390,height:844});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
budgetFailure=true;
await page.getByRole('button',{name:'Refresh',exact:true}).click();
await page.waitForFunction(()=>document.getElementById('pm-budget').textContent==='Unavailable');
assert.equal(await page.locator('#pm-total').innerText(),'8');
assert.match(await page.locator('#pm-message').innerText(),/could not be loaded/);
assert.equal(await page.locator('.pm-allocation').count(),0);
budgetFailure=false;empty=true;
await page.getByRole('button',{name:'Refresh',exact:true}).click();
await page.waitForFunction(()=>document.getElementById('pm-total').textContent==='0');
assert.equal(await page.locator('#pm-budget').innerText(),'Not set');
assert.equal(await page.locator('.pm-timeline-row').count(),0);
assert.deepEqual(errors,[]);
console.log('PASS Project dashboard scope, totals, schedule, print action, mobile and partial/empty responses');
await browser.close();
