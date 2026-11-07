import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createReadCache}=createRequire(import.meta.url)('../docs/workspace/eos-data-cache.js');
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
test('one read is shared by concurrent pages; each response stays independently readable',async()=>{
 let calls=0,finish;const cache=createReadCache({identity:()=> 'user',fetcher:async()=>{calls++;await new Promise(r=>finish=r);return response({value:3});}});
 const a=cache.fetch('https://api.test/activity-report-data?contractor=A'),b=cache.fetch('https://api.test/activity-report-data?contractor=A');await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);finish();assert.deepEqual(await (await a).json(),{value:3});assert.deepEqual(await (await b).json(),{value:3});
 assert.deepEqual(await (await cache.fetch('https://api.test/activity-report-data?contractor=A')).json(),{value:3});assert.equal(calls,1);
});
test('contractors, query filters, users, expiration and manual refresh isolate reads',async()=>{
 let owner='one',time=0,calls=0;const cache=createReadCache({identity:()=>owner,now:()=>time,ttl:100,fetcher:async()=>response(++calls)});
 const read=q=>cache.fetch('https://api.test/activity-report-data?'+q);
 await read('contractor=A');await read('contractor=B');await read('contractor=A&dates=2026-01-01');assert.equal(calls,3);await read('contractor=A');assert.equal(calls,3);
 owner='two';await read('contractor=A');assert.equal(calls,4);time=101;await read('contractor=A');assert.equal(calls,5);cache.clear();await read('contractor=A');assert.equal(calls,6);
});
test('writes invalidate before and after completion; pending reads cannot refill stale cache',async()=>{
 let finish,calls=0;const cache=createReadCache({identity:()=> 'user',fetcher:async(url,options)=>{if(options.method)return response({saved:true});calls++;if(calls===1)await new Promise(r=>finish=r);return response({call:calls});}});
 const first=cache.fetch('https://api.test/activities?contractor=A');await new Promise(r=>setTimeout(r,0));await cache.fetch('https://api.test/activities/1',{method:'PATCH'});finish();await first;await cache.fetch('https://api.test/activities?contractor=A');assert.equal(calls,2);
});
test('failures, anonymous requests and authorization endpoints are never cached',async()=>{
 let calls=0,owner='user',status=503;const cache=createReadCache({identity:()=>owner,fetcher:async()=>{calls++;return response({},status);}});
 await cache.fetch('https://api.test/activities');await cache.fetch('https://api.test/activities');assert.equal(calls,2);status=200;owner='';await cache.fetch('https://api.test/activities');await cache.fetch('https://api.test/activities');assert.equal(calls,4);owner='user';await cache.fetch('https://api.test/mobile/me');await cache.fetch('https://api.test/mobile/me');assert.equal(calls,6);
});
