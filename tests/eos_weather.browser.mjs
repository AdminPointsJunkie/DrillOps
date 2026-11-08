import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1050}});
await context.addInitScript(()=>localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999})));
const rows=Array.from({length:31},(_,i)=>({id:i+1,contractor:'Mitchells Drilling',project:'Alpha',date:'2026-10-'+String(i+1).padStart(2,'0'),source_file:'sample-'+i+'.pdf',drill_rig:'Rig 1',hole_num:'A1',code:'Drill_Core',total_metres:10,total_time:'1:00',line_cost:100}));
rows.push({...rows[0],id:32,project:'Beta',drill_rig:'Rig 2'});
let weatherRequests=0,release,hold=true,fail=false;
await context.route('http://localhost:8000/**',async route=>{
 const url=new URL(route.request().url()),path=url.pathname;
 if(path==='/eos/weather'){
  weatherRequests++;if(hold){hold=false;await new Promise(r=>release=r);}
  if(fail){fail=false;return route.fulfill({status:503,body:'Unavailable'});}
  const data={available:true,latitude:-21.75,longitude:148.15,location_project:'Saved project area',days:rows.slice(0,31).map((r,i)=>({date:r.date,max_c:i===30?null:29,humidity_at_max:i===30?null:65,rain_mm:i%3===0?12:0}))};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 }
 const data=path==='/mobile/me'?{name:'Sample',role:'System Administrator',management_portal_access:true}:path==='/contractors'?[{name:'Mitchells Drilling',category:'Drilling'}]:path==='/clients'?[{id:1,name:'Sample'}]:path==='/projects'?['Alpha','Beta'].map((name,id)=>({id:id+1,client_id:1,name,program:'Exploration'})):path==='/activity-report-data'?{activities:rows,crew:[],consumables:[],report_approvals:[],activity_sheet_locks:[]}:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://localhost:8766/eos.html?view=reports');await page.waitForFunction(()=>document.getElementById('eos-period-narrative').textContent.startsWith('320.0 m'));
 assert.equal(await page.locator('#eos-period-print').isDisabled(),false,'weather cannot block production or printing');
 while(!release)await new Promise(r=>setTimeout(r,10));release();await page.waitForFunction(()=>document.querySelectorAll('.eos-weather-day').length===31);
 assert.match(await page.locator('.eos-weather-day').first().innerText(),/29°C\s*65% RH\s*12.0 mm/);assert.match(await page.locator('.eos-weather-day').last().innerText(),/—\s*—/);
 assert.equal(await page.locator('#eos-period-register tr').count(),0);assert.match(await page.locator('#eos-weather-location').innerText(),/Saved project area.*shared hole/);
 const before=weatherRequests;await page.locator('#eos-period-show-charges').check();await page.locator('#eos-period-include-nonchargeable').check();assert.equal(weatherRequests,before);
 await page.locator('#eos-weather-project').selectOption('Beta');await page.waitForFunction(()=>document.querySelectorAll('.eos-weather-day').length===31);assert.equal(weatherRequests,before+1);
 await page.locator('#eos-weather-project').selectOption('Alpha');assert.equal(weatherRequests,before+1,'cached weather is reused');
 if(process.env.CAPTURE_EOS){
  await page.screenshot({path:process.env.CAPTURE_EOS+'/EOS-weather.png',fullPage:true});
  await page.evaluate(()=>document.body.classList.add('eos-period-print'));await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('.eos-weather-retry').isVisible(),false);
  await page.pdf({path:process.env.CAPTURE_EOS+'/EOS-weather.pdf',preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});await page.evaluate(()=>document.body.classList.remove('eos-period-print'));
 }
 fail=true;await page.getByRole('button',{name:'Reload weather'}).click();await page.waitForFunction(()=>document.getElementById('eos-weather-status').textContent.includes('unavailable'));
 assert.equal(await page.locator('.eos-weather-day').count(),0);assert.match(await page.locator('#eos-period-narrative').innerText(),/320.0 m/);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS weather temperature/humidity/rain, deferred loading, project selection, caching, print, missing data and failures');
}catch(error){console.error('Weather diagnostics',errors,await page.evaluate(()=>['eos-period-show-charges','eos-period-document'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,rect:[r.x,r.y,r.width,r.height],position:getComputedStyle(e).position};})));if(process.env.CAPTURE_EOS)await page.screenshot({path:process.env.CAPTURE_EOS+'/EOS-weather-failure.png'});throw error;}finally{await browser.close();}
