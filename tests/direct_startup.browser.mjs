import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 for(const app of ['account','project'])for(const saved of [false,true]){
  const context=await browser.newContext();
  await context.addInitScript(saved=>{localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999}));if(saved){localStorage.setItem('drillops_client_id','1');localStorage.setItem('drillops_project','Example');localStorage.setItem('drillops_program','Exploration');}},saved);
  await context.route('http://localhost:8000/**',async route=>{
   const p=new URL(route.request().url()).pathname;
   const data=p==='/mobile/me'?{name:'Sample',role:'System Administrator',management_portal_access:true}:p==='/clients'?[{id:1,name:'Client',status:'Active'}]:p==='/projects'?[{id:1,client_id:1,name:'Example',year:'2026',program:'Exploration',status:'Active'}]:p==='/contractors'?[{name:'Supplier',program:'Exploration',active:true}]:p==='/stats'?{}:[];
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8766/'+app+'.html');await page.waitForFunction(()=>workspaceStarted);
  assert.equal(await page.locator('#workspace-gate').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('workspace-locked')),false);
  assert.equal(await page.evaluate(()=>activeProjectName),saved?'Example':'');
  assert.equal(await page.locator('#page-'+(app==='account'?'invoices':'project-dashboard')).evaluate(el=>el.classList.contains('active')),true);
  await page.locator('#workspace-context-btn').click();await page.waitForSelector('#workspace-gate.open');
  await page.locator('#workspace-gate').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('#workspace-gate').isVisible(),false);
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS Account and Project direct startup with fresh/saved scope; optional project switch can be cancelled');
}finally{await browser.close();}
