import test from 'node:test';import assert from 'node:assert/strict';
import {readSpecial} from '../src/file-readers.js';
import {coordinate,analyzeCSVRows,csvGeoJSON} from '../src/geo.js';
import {cachedConversion} from '../src/conversion-cache.js';
import {readFile} from 'node:fs/promises';import vm from 'node:vm';
test('legacy encoding, multiline headers, blank lines and missing coordinates retain source lines',async()=>{
 const text='Hole ID,Easting,Northing,"Note\r\n(m)"\r\nA,620012.9\xa0 ,7595939.0\xa0 ,ok\r\n\r\nB,,,missing\r\nC,619893.9,7595950.3,ok';
 const bytes=Uint8Array.from([...text].map(c=>c.charCodeAt(0)));const [item]=await readSpecial(new File([bytes],'collars.csv'));
 assert.equal(item.encoding,'Windows-1252');assert.deepEqual(item.rowNumbers,[3,5,6]);
 const result=analyzeCSVRows(item.rows,'Easting','Northing',item);assert.equal(result.fc.features.length,2);assert.equal(result.repairs.length,1);assert.equal(result.issues[0].row,5);assert.equal(result.fc.features[0].properties.Easting,'620012.9\xa0 ');
 assert.throws(()=>csvGeoJSON(item.rows,'Easting','Northing',item),/row 5/);assert.equal(csvGeoJSON(item.rows,'Easting','Northing',{...item,skipInvalid:true}).features.length,2);
});
test('safe number cleanup preserves meaning and refuses guesses',()=>{
 for(const [input,expected] of [['620,012.9',620012.9],['7\u202f595\u202f939.0',7595939],['−27.5',-27.5],["'153.1",153.1],['6.2e5',620000]])assert.equal(coordinate(input),expected);
 for(const input of ['153,5','620012.9?', '620012.9\ufffd','1e999','2+3','N/A'])assert.throws(()=>coordinate(input));
 const result=analyzeCSVRows([{x:'181',y:'-27'},{x:'153',y:'-27'}],'x','y',{geographic:true});assert.equal(result.issues.length,1);assert.equal(result.fc.features.length,1);
 assert.throws(()=>csvGeoJSON([{x:'',y:''}],'x','y',{skipInvalid:true}),/No usable/);
});
test('CSV shape repairs never shift data and malformed quotes remain blocking',async()=>{
 const [item]=await readSpecial(new File(['id,x,y,note\nA,153,-27\nB,154,-28,ok,,\nC,155,-29,ok,unexpected'],'a.csv'));
 assert.equal(item.rows[0].note,'');assert.equal(item.tableRepairs.length,2);
 const result=analyzeCSVRows(item.rows,'x','y',item);assert.equal(result.fc.features.length,2);assert.equal(result.issues[0].row,4);assert.deepEqual(result.issues[0].values.__parsed_extra,['unexpected']);
 await assert.rejects(readSpecial(new File(['x,y\n"153,-27'],'a.csv')),/quotation/);
});
test('UTF-16 BOM is decoded and skip changes invalidate conversion cache',async()=>{
 const text='x,y\r\n153,-27';const bytes=new Uint8Array(2+text.length*2);bytes.set([255,254]);for(let i=0;i<text.length;i++)bytes[2+i*2]=text.charCodeAt(i);
 const [item]=await readSpecial(new File([bytes],'a.csv'));assert.equal(item.rows[0].x,'153');assert.equal(item.encoding,'UTF-16LE');
 let calls=0;const convert=async()=>++calls;await cachedConversion(item,{skipInvalid:true},convert);await cachedConversion(item,{skipInvalid:true},convert);await cachedConversion(item,{skipInvalid:false},convert);assert.equal(calls,2);
});
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
test('direct imports require a project CRS and unambiguous columns',()=>{
 const context={activeMap:{id:'p'},user:{id:'u'},selectedCRS:'EPSG:20355',$:()=>({value:''})};vm.createContext(context);vm.runInContext(main.slice(main.indexOf('function canImportDirectly('),main.indexOf('function showCSVResult(')),context);
 const item={rows:[{}],fields:['Hole ID','Easting','Northing']};assert.equal(context.canImportDirectly(item),true);
 assert.equal(context.canImportDirectly({...item,fields:['x','Easting','Northing']}),false);
 assert.equal(context.canImportDirectly({...item,fields:['Hole ID','Position']}),false);
 context.selectedCRS='';assert.equal(context.canImportDirectly(item),false);
 context.selectedCRS='EPSG:20355';context.activeMap=null;assert.equal(context.canImportDirectly(item),false);
});
test('file upload imports automatically without showing review and retains unresolved files',async()=>{
 const elements=new Map();const $=s=>{if(!elements.has(s))elements.set(s,{value:'',textContent:'',insertAdjacentHTML(){}});return elements.get(s);};
 const first={name:'Known'},second={name:'Unknown'},reviews=[],imported=[];
 const context={analysisScope:()=>'scope',createReferenceResolver:()=>null,workspaceLibrary:null,busy:false,queue:[],reviewIndex:null,$,isReadOnly:()=>false,LOCAL_TESTING:true,CLOUD_FILE_LIMIT:1e8,setBusy(v){context.busy=v},importJob(){},toast(){},inspect:async()=>({items:[first,second],errors:[]}),renderQueue(){},canImportDirectly:item=>item===first,openReview(i,show=true){context.reviewIndex=i;reviews.push({name:context.queue[i].name,show});},async reviewAction(preview,direct){assert.equal(preview,false);assert.equal(direct,true);imported.push(context.queue.splice(context.reviewIndex,1)[0]);},errorText:e=>e.message,esc:String};
 vm.createContext(context);const start=main.indexOf('async function handleGISFiles('),end=main.indexOf("\n",start);vm.runInContext(main.slice(start,end),context);await context.handleGISFiles([{name:'a.csv',size:10}]);
 assert.deepEqual(imported,[first]);assert.deepEqual(context.queue,[second]);assert.deepEqual(reviews,[{name:'Known',show:false},{name:'Unknown',show:false},{name:'Unknown',show:true}]);
});
