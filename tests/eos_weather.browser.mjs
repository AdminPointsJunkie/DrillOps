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
  assert.deepEqual([...url.searchParams.keys()].sort(),['end','start']);weatherRequests++;
  if(hold){hold=false;await new Promise(r=>release=r);}
  if(fail){fail=false;return route.fulfill({status:503,body:'Unavailable'});}
  const data={available:true,conditions_available:true,days:rows.slice(0,31).map((r,i)=>({date:r.date,max_c:i===30?null:24+i%10,humidity_at_max:i===30?null:45+i%30,rain_mm:i%3===0?12:0,condition_code:i===16?25:i%3===0?9:3,condition_estimated:true}))};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 }
 const data=path==='/mobile/me'?{name:'Sample',role:'System Administrator',management_portal_access:true}:path==='/contractors'?[{name:'Mitchells Drilling',category:'Drilling'}]:path==='/clients'?[{id:1,name:'Sample'}]:path==='/projects'?['Alpha','Beta'].map((name,id)=>({id:id+1,client_id:1,name,program:'Exploration'})):path==='/activity-report-data'?{activities:rows,crew:[],consumables:[],report_approvals:[],activity_sheet_locks:[]}:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://localhost:8766/eos.html?view=reports');await page.waitForFunction(()=>document.getElementById('eos-period-narrative').textContent.startsWith('320.0 m'));
 assert.equal(await page.locator('#eos-period-print').isDisabled(),false);
 while(!release)await new Promise(r=>setTimeout(r,10));
 // Re-rendering while the weather request is pending shares the same request.
 await page.locator('#eos-period-show-charges').check();release();await page.waitForSelector('#eos-weather-trend svg');
 assert.equal(await page.locator('.eos-weather-day').count(),0);assert.equal(await page.locator('.eos-weather-line').count(),2);
 const alignment=await page.evaluate(()=>{const weather=document.querySelector('#eos-weather-trend circle'),bar=document.querySelector('#eos-period-chart rect'),point=new DOMPoint(+weather.getAttribute('cx'),0).matrixTransform(weather.getScreenCTM()),box=bar.getBoundingClientRect();return Math.abs(point.x-(box.x+box.width/2));});assert.ok(alignment<1,'weather points align with production bars');
 assert.ok(await page.locator('.eos-weather-symbol').count()<=11);
 assert.equal(await page.locator('.eos-weather-storm').count(),1);
 assert.equal(await page.locator('.eos-weather-storm').getAttribute('data-date'),'2026-10-17');
 assert.match(await page.locator('.eos-weather-storm title').textContent(),/Thunderstorm \(estimated\)/);
 assert.match(await page.locator('#eos-weather-trend').innerHTML(),/°C/);assert.match(await page.locator('#eos-weather-status').innerText(),/not confirmed strikes.*missing data/);
 assert.equal(await page.locator('#eos-period-register tr').count(),32);
 const before=weatherRequests;await page.locator('#eos-period-include-nonchargeable').check();await page.waitForSelector('#eos-weather-trend svg');assert.equal(weatherRequests,before);
 await page.locator('#eos-period-rig').selectOption('Rig 1');await page.waitForSelector('#eos-weather-trend svg');assert.equal(weatherRequests,before,'fixed weather is cached across rig changes');
 assert.equal(await page.locator('#eos-period-rig-chart,#eos-period-moves-chart').count(),0);
 const work=page.getByRole('button',{name:'01 Work recorded'}),project=page.getByRole('button',{name:'03 Production by project'});
 await work.click();assert.equal(await work.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#eos-period-chart').isVisible(),false);
 await work.click();await project.click();
 await page.evaluate(()=>document.body.classList.add('eos-period-print'));await page.emulateMedia({media:'print'});
 assert.equal(await project.isVisible(),false,'collapsed sections are omitted from print');assert.equal(await page.locator('#eos-period-chart').isVisible(),true);assert.equal(await page.locator('.eos-weather-retry').isVisible(),false);
 await page.emulateMedia({media:'screen'});await page.evaluate(()=>document.body.classList.remove('eos-period-print'));
 await page.getByRole('button',{name:'Collapse all',exact:true}).filter({visible:true}).click();assert.equal(await page.locator('#eos-period-chart').isVisible(),false);
 await page.getByRole('button',{name:'Expand all',exact:true}).filter({visible:true}).click();assert.equal(await page.locator('#eos-period-chart').isVisible(),true);assert.equal(await page.locator('.eos-period-register').isVisible(),true,'expand restores the report register');
 if(process.env.CAPTURE_EOS){
  await page.screenshot({path:process.env.CAPTURE_EOS+'/EOS-weather-compact.png',fullPage:true});
  await page.evaluate(()=>document.body.classList.add('eos-period-print'));await page.emulateMedia({media:'print'});await page.pdf({path:process.env.CAPTURE_EOS+'/EOS-weather-compact.pdf',preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});await page.evaluate(()=>document.body.classList.remove('eos-period-print'));
 }
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.CAPTURE_EOS)await page.screenshot({path:process.env.CAPTURE_EOS+'/EOS-weather-mobile.png',fullPage:true});
 fail=true;await page.getByRole('button',{name:'Reload weather'}).click();await page.waitForFunction(()=>document.getElementById('eos-weather-status').textContent.includes('unavailable'));
 assert.equal(await page.locator('#eos-weather-trend svg').count(),0);assert.match(await page.locator('#eos-period-narrative').innerText(),/310.0 m/);
 assert.deepEqual(errors,[]);console.log('PASS compact weather trends, explicit storm estimates, shared pending request, fixed location, missing data, failure, collapse, print and mobile');
}finally{await browser.close();}
