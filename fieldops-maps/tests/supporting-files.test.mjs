import test from 'node:test';import assert from 'node:assert/strict';import {validateSupportingFiles,uploadSupportingFiles,SUPPORTING_LIMIT} from '../src/supporting-files.js';
test('supporting files enforce 50 MB per file and do not route GIS data as documents',()=>{validateSupportingFiles([{name:'Plan.pdf',size:SUPPORTING_LIMIT}]);for(const file of [{name:'Plan.pdf',size:SUPPORTING_LIMIT+1},{name:'Empty.docx',size:0},{name:'Map.csv',size:12},{name:'Map.geojson',size:12},{name:'script.html',size:12}])assert.throws(()=>validateSupportingFiles([file]));});
test('partial upload retains committed files and never deletes bytes on uncertain registration',async()=>{let uploaded=0;const project={id:'project',supporting_files:[]},saved=[];const db={storage:{from:()=>({upload:async()=>{uploaded++;return{};},remove:()=>{throw Error('Must retain bytes');}})},rpc:async(_,a)=>uploaded===1?{data:[a.p_file]}:{error:Error('Network response lost')}};await assert.rejects(uploadSupportingFiles({db,project,userId:'user',files:[new File(['a'],'A.pdf'),new File(['b'],'B.docx')],local:true,onSaved:files=>saved.push(files)}),/Network response lost/);assert.equal(project.supporting_files.length,1);assert.equal(saved.length,1);assert.match(saved[0][0].path,/^user\/project\/supporting\//);});
test('oversized file makes no upload request',async()=>{let called=false;await assert.rejects(uploadSupportingFiles({db:{storage:{from(){called=true;}}},project:{},userId:'user',files:[{name:'Big.pdf',size:SUPPORTING_LIMIT+1}],local:true}));assert.equal(called,false);});

test('supporting files stay closed until requested, retain explicit opening on refresh, and close for another project',async()=>{
 const {JSDOM}=await import('jsdom'),{installSupportingFiles}=await import('../src/supporting-files.js');
 const dom=new JSDOM('<div id="app"><main></main><nav class="map-navigation"></nav></div>'),previous=globalThis.document;globalThis.document=dom.window.document;
 let project={id:'one',name:'First',supporting_files:[]};
 try{const ui=installSupportingFiles({db:{},getProject:()=>project,getUser:()=>null,canEdit:()=>false});const panel=document.querySelector('.supporting-panel'),toggle=document.querySelector('[aria-label="Supporting Files"].square');
 assert.equal(panel.hidden,true);assert.equal(toggle.getAttribute('aria-expanded'),'false');
 toggle.click();assert.equal(panel.hidden,false);ui.refresh();assert.equal(panel.hidden,false);
 panel.querySelector('[data-close]').click();ui.refresh();assert.equal(panel.hidden,true);
 toggle.click();project={id:'two',name:'Second'};ui.refresh();assert.equal(panel.hidden,true);assert.ok(panel.querySelector('[data-panel-drag]'));
 }finally{globalThis.document=previous;dom.window.close();}
});
