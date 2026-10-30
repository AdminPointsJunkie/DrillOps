import test from 'node:test';
import assert from 'node:assert/strict';
import {networkAnalysis} from '../src/network-analysis.js';
import {analyse} from '../src/analysis-engine.js';
import {cloudFile,configuredProviders,graphURL} from '../src/cloud-providers.js';
const fc=features=>({type:'FeatureCollection',features}),line=coordinates=>({type:'Feature',properties:{road:'A'},geometry:{type:'LineString',coordinates}});
test('route follows the shortest connected roads, preserves sources and exposes limitations',()=>{
 const a=[153,-27],b=[153.001,-27],c=[153.002,-27],detour=[153.001,-26.99];
 const source=fc([line([a,b,c]),line([a,detour,c])]),before=structuredClone(source);
 const result=analyse({operation:'route',source,origin:a,destination:c});assert.deepEqual(result.features[0].geometry.coordinates,[a,b,c]);assert.ok(result.features[0].properties.distance_m>190);assert.match(result.features[0].properties.method,/two-way/);assert.deepEqual(source,before);
 assert.throws(()=>networkAnalysis({source,origin:[0,0],destination:c}),/250 metres/);
 assert.throws(()=>networkAnalysis({source:fc([line([a,b]),line([[154,-27],[154.001,-27]])]),origin:a,destination:[154,-27]}),/No connected/);
 assert.throws(()=>networkAnalysis({source,origin:a,destination:a}),/same vertex/);
});
test('Extract copies whole points, crossing lines and shapes while retaining properties',()=>{
 const features=[{type:'Feature',properties:{name:'inside'},geometry:{type:'Point',coordinates:[1,1]}},line([[-1,1],[3,1]]),{type:'Feature',properties:{name:'outside'},geometry:{type:'Point',coordinates:[4,4]}}],source=fc(features),target=fc([{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}}]);
 const result=analyse({operation:'extract',source,target});assert.deepEqual(result.features,features.slice(0,2));result.features[0].properties.name='changed';assert.equal(source.features[0].properties.name,'inside');
});
test('cloud providers stay unavailable without setup and API tokens cannot go to another host',()=>{
 assert.deepEqual(configuredProviders({}),{google:false,onedrive:false,dropbox:false});assert.equal(configuredProviders({googleClientId:'a',googleApiKey:'b',googleAppId:'c'}).google,true);
 assert.throws(()=>graphURL('https://evil.test/v1.0/me/drive'),/Invalid/);assert.throws(()=>graphURL('https://graph.microsoft.com.evil.test/v1.0/me'),/Invalid/);assert.match(graphURL('https://graph.microsoft.com/v1.0/me/drive/root/children'),/^https:/);
});
test('cloud download exports Google Sheets and sends bearer only to its fixed API',async()=>{
 let request;const file=await cloudFile({provider:'google',id:'a/b',name:'Survey',mimeType:'application/vnd.google-apps.spreadsheet',token:'test-only'}, {fetcher:async(url,options)=>{request={url,options};return new Response(new Uint8Array([1,2]),{headers:{'content-type':'application/octet-stream'}});}});
 assert.match(request.url,/www.googleapis.com\/drive\/v3\/files\/a%2Fb\/export/);assert.equal(request.options.redirect,'error');assert.equal(request.options.headers.Authorization,'Bearer test-only');assert.equal(file.name,'Survey.xlsx');assert.equal(file.size,2);
});
test('cloud downloads reject untrusted links and oversized streams without importing partial files',async()=>{
 let requests=0;await assert.rejects(cloudFile({provider:'dropbox',url:'https://evil.test/file'},{fetcher:async()=>{requests++;}}),/Invalid Dropbox/);assert.equal(requests,0);
 await assert.rejects(cloudFile({provider:'dropbox',url:'https://dl.dropboxusercontent.com/file',name:'x'},{limit:2,fetcher:async()=>new Response(new Uint8Array([1,2,3]))}),/exceeds/);
});
