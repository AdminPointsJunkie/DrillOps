import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveStatus} from '../src/save-status.js';
import {syncProjectRelease} from '../src/operator-sync.js';

test('save failures stay retryable; newest queued change supersedes stale failure',async()=>{
 const saves=createSaveStatus();let attempts=0;
 await assert.rejects(saves.run('style:a',async()=>{if(!attempts++)throw Error('Offline');}));
 assert.equal(saves.state().failed,1);await assert.rejects(saves.flush());
 await saves.retry();assert.deepEqual(saves.state(),{pending:false,failed:0});
 let release;const old=saves.run('style:a',()=>new Promise((resolve,reject)=>release=reject));
 await Promise.resolve();await Promise.resolve();
 let saved=false;const latest=saves.run('style:a',async()=>{saved=true;});
 release(Error('Older save failed'));await assert.rejects(old);await latest;
 assert.equal(saved,true);assert.equal(saves.state().failed,0);
});

test('SYNC copies included previews and sends revision guard; copy failure never publishes',async()=>{
 const copies=[],calls=[];let fail=false;
 const project={draft_revision:5,last_synced_revision:2,layer_layout:['raster','vector']};
 const db={from(table){return {select(){return this;},eq(){return this;},single:async()=>({data:project}),order:async()=>({data:[{id:'raster',name:'Aerial',kind:'raster',raster_path:'draft.png'},{id:'removed',kind:'raster',raster_path:'missing.png'},{id:'vector',kind:'vector'}]})};},
 storage:{from(){return {copy:async(from,to)=>{copies.push([from,to]);return fail?{error:Error('Copy failed')}:{data:{}};}};}},
 rpc:async(name,args)=>{calls.push({name,args});return {data:{version:1,source_revision:5}};}};
 const result=await syncProjectRelease(db,'map','owner');
 assert.equal(result.version,1);assert.equal(copies.length,1);assert.equal(copies[0][0],'draft.png');assert.match(copies[0][1],/^owner\/sync\/[^/]+\/raster.png$/);
 assert.equal(calls[0].args.p_expected_revision,5);assert.equal(calls[0].args.p_rasters.raster,copies[0][1]);
 fail=true;await assert.rejects(syncProjectRelease(db,'map','owner'),/Copy failed/);assert.equal(calls.length,1);
 project.last_synced_revision=5;await syncProjectRelease(db,'map','owner');assert.equal(copies.length,2,'already synced project does not copy files again');
});
