import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPreviews,validPreview} from '../src/project-previews.js';
const image='data:image/jpeg;base64,/9j/2Q==';
test('Preview is persisted remotely and available to a fresh client',async()=>{
 const rows=new Map();const db={from(table){assert.equal(table,'project_previews');return {upsert:async row=>{rows.set(row.map_id,row);return {error:null};},select:()=>({in:async (_field,ids)=>({data:[...rows.values()].filter(r=>ids.includes(r.map_id))})})};}};
 await projectPreviews({db}).save('user:company','map-a',image);
 assert.equal((await projectPreviews({db}).load('different-device',['map-a'])).get('map-a'),image);
 assert.equal((await projectPreviews({db}).load('other',['map-b'])).size,0);
});
test('Preview validation rejects oversized and non-image values; database errors propagate',async()=>{
 assert.equal(validPreview('javascript:alert(1)'),false);assert.equal(validPreview('data:image/jpeg;base64,'+'A'.repeat(200001)),false);
 const db={from:()=>({upsert:async()=>({error:Error('Access denied')}),select:()=>({in:async()=>({error:Error('Offline')})})})};
 const previews=projectPreviews({db});await assert.rejects(previews.save('s','p',image),/Access denied/);await assert.rejects(previews.load('s',['p']),/Offline/);
});
