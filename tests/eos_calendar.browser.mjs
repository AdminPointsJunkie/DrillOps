import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1100}});
await context.addInitScript(()=>{localStorage.setItem('drillops_supabase_session',JSON.stringify({access_token:'test',expires_at:9999999999}));sessionStorage.setItem('drillops_contractor','DEPCO Drilling');});
const contractor='DEPCO Drilling',base={contractor,project:'Alpha',program:'Exploration',date:'01/10/2026',drill_rig:'DR17',source_file:'DR17-day.pdf',hole_num:'A1',shift:'Day',code:'Drill_Core',total_time:'1:00',total_metres:10};
const rows=[{...base,id:1,line_cost:100},{...base,id:2,line_cost:20},{...base,id:3,line_cost:0,shift:'Night',source_file:'DR17-night.pdf'},{...base,id:4,line_cost:null,date:'03/10/2026'},{...base,id:5,line_cost:300,drill_rig:'DR28',program:'Gas Riser',source_file:'DR28-day.pdf'},{...base,id:6,line_cost:50,date:'04/10/2026',shift:''},{...base,id:7,line_cost:80,project:'Beta',date:'05/10/2026'},{...base,id:8,line_cost:10,date:'30/09/2026'}];
let bundles=0,fail=false,hold=false,release;
await context.route('http://localhost:8000/**',async route=>{
 const url=new URL(route.request().url()),path=url.pathname;
 if(path==='/activity-report-data'){bundles++;if(hold){hold=false;await new Promise(r=>release=r);}if(fail){fail=false;return route.fulfill({status:503,body:'Unavailable'});}}
 const c=url.searchParams.get('contractor');
 const data=path==='/mobile/me'?{name:'Sample',role:'System Administrator',management_portal_access:true}:path==='/contractors'?[{name:contractor,category:'Drilling'},{name:'Mitchells Drilling',category:'Drilling'}]:path==='/clients'?[{id:1,name:'Sample'}]:path==='/projects'?[{id:1,client_id:1,name:'Alpha',program:'Exploration'},{id:2,client_id:1,name:'Beta',program:'Exploration'}]:path==='/activity-report-data'?{activities:c===contractor?rows:[{...base,id:100,contractor:'Mitchells Drilling',drill_rig:'Rig 9',line_cost:20}],crew:[],consumables:[],report_approvals:[],activity_sheet_locks:[]}:[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const tile=date=>page.locator('.eos-calendar-day[data-date="2026-10-'+date+'"]');
const loaded=()=>page.waitForFunction(()=>!document.getElementById('eos-calendar-content').hidden);
try{
 await page.goto('http://localhost:8766/eos.html?view=report-calendar');await loaded();
 assert.equal(await page.locator('#page-report-calendar').isVisible(),true);assert.equal(await page.locator('#drawer [data-page="report-calendar"]').isVisible(),true);assert.equal(bundles,1);
 assert.equal(await page.locator('.eos-calendar-day').count(),31);assert.equal(await tile('01').locator('.loaded').count(),3);assert.equal(await tile('02').locator('.loaded').count(),0);assert.equal(await tile('02').locator('.empty').count(),4);
 assert.match(await tile('01').innerText(),/\$420\.00/);assert.match(await tile('03').innerText(),/Unpriced/);assert.match(await tile('04').innerText(),/\? ✓/);
 await tile('01').click();assert.equal(await page.locator('.eos-calendar-report').count(),3);
 const href=await page.locator('.eos-calendar-report').first().getAttribute('href'),url=new URL(href,'http://localhost:8766/');assert.equal(url.pathname,'/report.html');assert.equal(url.searchParams.get('date'),'01/10/2026');assert.equal(url.searchParams.get('source'),'DR17-day.pdf');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.locator('#eos-calendar-rig').selectOption('DR17');await page.locator('#eos-calendar-shift').selectOption('night');assert.equal(await tile('01').locator('.loaded').count(),1);assert.match(await tile('01').innerText(),/\$0\.00/);assert.equal(bundles,1);
 await page.locator('#eos-calendar-shift').selectOption('');await page.locator('#eos-calendar-rig').selectOption('');
 await page.getByRole('button',{name:'Previous month'}).click();assert.equal(await page.locator('.eos-calendar-day').count(),30);assert.equal(await page.locator('.has-reports').count(),1);
 await page.getByRole('button',{name:'Latest reports'}).click();assert.equal(await page.locator('#eos-calendar-month').inputValue(),'2026-10');
 await page.locator('#eos-project-filter').selectOption('Alpha');await loaded();assert.equal(await tile('05').locator('.loaded').count(),0);
 await page.locator('#eos-program-filter').selectOption('Exploration');await loaded();assert.equal(await tile('01').locator('.eos-calendar-rig').count(),1);assert.match(await tile('01').innerText(),/\$120\.00/);
 await page.locator('#eos-clear-scope').click();await loaded();
 // Month with no uploads is a calendar of gaps, not a $0 spending result.
 await page.locator('#eos-calendar-month').fill('2026-11');await page.locator('#eos-calendar-month').dispatchEvent('change');assert.equal(await page.locator('.has-reports').count(),0);assert.equal(await page.locator('.eos-calendar-day').count(),30);assert.doesNotMatch(await page.locator('#eos-calendar-grid').innerText(),/\$0/);
 await page.getByRole('button',{name:'Latest reports'}).click();
 // Explicit loading and error states remove stale coverage.
 fail=true;await page.locator('#page-report-calendar').getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>document.getElementById('eos-calendar-message').textContent.includes('Could not load'));assert.equal(await page.locator('#eos-calendar-content').isVisible(),false);
 await page.locator('#page-report-calendar').getByRole('button',{name:'Refresh',exact:true}).click();await loaded();
 await page.evaluate(()=>invalidateEosReads());hold=true;await page.locator('#page-report-calendar').getByRole('button',{name:'Refresh',exact:true}).click();while(!release)await new Promise(r=>setTimeout(r,10));
 await page.locator('#eos-contractor-filter').selectOption('Mitchells Drilling');await loaded();release();await page.waitForTimeout(100);assert.doesNotMatch(await page.locator('#eos-calendar-grid').innerText(),/DR17|DR28/);assert.match(await page.locator('#eos-calendar-grid').innerText(),/Rig 9/);
 await page.locator('#eos-contractor-filter').selectOption(contractor);await loaded();
 assert.equal(await page.locator('#act-body tr').count(),0,'calendar does not load raw logs');assert.equal(await page.locator('#page-reports #eos-calendar-grid').count(),0);
 if(process.env.CAPTURE_EOS)await page.screenshot({path:process.env.CAPTURE_EOS+'/EOS-calendar-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>closeDrawer());await page.waitForFunction(()=>document.getElementById('drawer').getBoundingClientRect().right<=0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('.eos-calendar-scroll').evaluate(el=>el.scrollWidth>el.clientWidth),true);
 if(process.env.CAPTURE_EOS)await page.screenshot({path:process.env.CAPTURE_EOS+'/EOS-calendar-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS report calendar routes, rig/shift coverage, costs, original report links, months, scope, shared cache, failed loads, stale responses and mobile containment');
}finally{await browser.close();}
