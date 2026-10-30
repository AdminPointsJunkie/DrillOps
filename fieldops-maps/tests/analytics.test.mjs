import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAnalyticsMeter} from '../src/analytics-meter.js';
import {analyticsMarkup,quotaMarkup,FREE_LIMITS} from '../src/owner-analytics.js';
import {installPlatformAdmin} from '../src/platform-admin.js';
test('meter keeps request behaviour, strips sensitive paths and excludes auth, external traffic and itself',async()=>{
 let who={userId:'a',workspaceId:'w'},clock=0;const sent=[];
 const m=createAnalyticsMeter({origin:'https://example.test',context:()=>who,now:()=>clock+=10,fetcher:async()=>new Response('ok',{headers:{'content-length':'2'}})});
 for(const path of ['/storage/v1/object/private/secret.tif?token=secret','/rest/v1/maps?email=private','/auth/v1/token','/rest/v1/rpc/record_analytics','/rest/v1/rpc/layer_geojson?key=private'])assert.equal(await (await m.fetch('https://example.test'+path)).text(),'ok');
 await m.fetch('https://other.test/rest/v1/maps');await m.flush({rpc:async(n,p)=>sent.push([n,p])});
 assert.deepEqual(sent[0][1].p_events.map(e=>e.route),['storage','database','rpc:layer_geojson']);assert.ok(!JSON.stringify(sent).includes('secret'));assert.equal(sent[0][1].p_events[0].bytes,2);
 await m.fetch('https://example.test/rest/v1/maps');who={userId:'b'};await m.flush({rpc:async()=>assert.fail('previous user events must not be attributed to new user')});
});
test('network errors propagate and unknown byte sizes stay unknown; telemetry failure does not break work',async()=>{
 let fail=false;const m=createAnalyticsMeter({origin:'https://example.test',context:()=>({userId:'a'}),fetcher:async()=>{if(fail)throw Error('offline');return new Response('ok');}});
 await m.fetch('https://example.test/rest/v1/maps');fail=true;await assert.rejects(m.fetch('https://example.test/rest/v1/maps'),/offline/);
 await m.flush({rpc:async(n,p)=>{assert.equal(p.p_events[0].bytes,null);assert.equal(p.p_events[1].status,0);throw Error('unavailable');}});
});
test('owner report handles empty samples and escapes operation labels',()=>{
 const html=analyticsMarkup({days:7,started_at:new Date().toISOString(),summary:{},routes:[{route:'<script>bad</script>'}]});
 assert.match(html,/No measurements yet/);assert.match(html,/No samples/);assert.ok(!html.includes('<script>'));assert.match(html,/not billing totals/);
});
test('analytics only loads when server returns exact owner access, and clears on close',async()=>{
 const dom=new JSDOM('');dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let access=false;const calls=[];const db={rpc:async(n)=>{calls.push(n);return {data:n==='owner_analytics_access'?access:n==='owner_analytics'?{days:7,started_at:new Date().toISOString(),summary:{}}:{companies:[],generated_at:new Date().toISOString()}};}};
 const ui=installPlatformAdmin(db,{doc:dom.window.document,isPlatform:()=>true});await ui.open();assert.ok(!calls.includes('owner_analytics'));access=true;await ui.open();assert.match(dom.window.document.body.textContent,/Your platform analytics/);ui.close();assert.ok(!dom.window.document.body.textContent.includes('Your platform analytics'));
});

 test('Free quota bars cap visually, warn near limits and distinguish unknown usage from zero',()=>{
 const full=quotaMarkup('Database',FREE_LIMITS.database*1.1,FREE_LIMITS.database,'Current');
 assert.match(full,/110.0%/);assert.match(full,/width:100%/);assert.match(full,/At or above allowance/);
 const unknown=quotaMarkup('Downloads',null,FREE_LIMITS.egress,'Unmeasured');assert.match(unknown,/Not measured/);assert.ok(!unknown.includes('role="progressbar"'));
 const zero=quotaMarkup('Files',0,FREE_LIMITS.storage,'Current');assert.match(zero,/0.0%/);assert.match(zero,/role="progressbar"/);
 const html=analyticsMarkup({days:7,started_at:new Date().toISOString(),summary:{requests:0}});assert.match(html,/Awaiting activity/);assert.ok(!html.includes('100.0%'));assert.match(html,/Separate 5 GB/);
 });
