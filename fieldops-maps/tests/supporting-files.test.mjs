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

test('headings group existing files, search by heading and persist renames without changing file paths',async()=>{
 const {groupSupportingFiles}=await import('../src/supporting-files.js');const {IDBFactory}=await import('fake-indexeddb');const {createLocalWorkspace}=await import('../src/local-workspace.js');
 const db=createLocalWorkspace(new IDBFactory()),p=(await db.from('maps').insert({name:'Grouped'}).select().single()).data;
 for(const f of [{path:'a',name:'Plan.pdf',group:'Plans'},{path:'b',name:'Permit.pdf',group:'Permits'},{path:'c',name:'Notes.txt'}])assert.equal((await db.rpc('maps_supporting_file',{p_map:p.id,p_action:'add',p_file:f})).error,null);
 let r=await db.rpc('maps_supporting_file',{p_map:p.id,p_action:'group',p_file:{path:'c',group:'Plans'}});assert.equal(groupSupportingFiles(r.data,'plans')[0][1].length,2);
 r=await db.rpc('maps_supporting_file',{p_map:p.id,p_action:'rename_group',p_file:{previous:'Plans',group:'Site plans'}});assert.deepEqual(r.data.map(f=>f.path),['a','b','c']);assert.equal(groupSupportingFiles(r.data,'Site plans')[0][1].length,2);
 r=await db.rpc('maps_supporting_file',{p_map:p.id,p_action:'group',p_file:{path:'a',group:''}});assert.equal(groupSupportingFiles(r.data).at(-1)[0],'');
 assert.ok((await db.rpc('maps_supporting_file',{p_map:p.id,p_action:'group',p_file:{path:'a',group:'x'.repeat(81)}})).error);
});
test('file grouping renders headings and saves the selected file without exposing editor controls to viewers',async()=>{
 const {JSDOM}=await import('jsdom'),{installSupportingFiles}=await import('../src/supporting-files.js');const dom=new JSDOM('<div id="app"><main></main><nav class="map-navigation"></nav></div>'),old=documentSafe();globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.show=dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.remove();};let editable=true,calls=[];const project={id:'one',name:'Map',supporting_files:[{path:'a',name:'Plan.pdf',size:12},{path:'b',name:'Permit.pdf',size:12,group:'Permits'}]};
 try{const ui=installSupportingFiles({db:{rpc:async(_,args)=>{calls.push(args);return {data:project.supporting_files.map(f=>f.path===args.p_file.path?{...f,group:args.p_file.group}:f)};}},getProject:()=>project,getUser:()=>({id:'u'}),canEdit:()=>editable});
 document.querySelector('[aria-label="Group Plan.pdf"]').click();document.querySelector('dialog [name=group]').value='Plans';await document.querySelector('dialog form').onsubmit({preventDefault(){}});
 assert.equal(calls[0].p_action,'group');assert.equal(calls[0].p_file.path,'a');assert.deepEqual([...document.querySelectorAll('.supporting-group summary')].map(e=>e.textContent),['Permits (1)','Plans (1)']);
 editable=false;ui.refresh();assert.equal(document.querySelector('[aria-label="Group Plan.pdf"]'),null);assert.equal(document.querySelector('.supporting-group-upload').hidden,true);
 }finally{globalThis.document=old;dom.window.close();}
 function documentSafe(){return globalThis.document;}
});

test('files without a group are direct rows and double-click opens a PDF preview',async()=>{
 const {JSDOM}=await import('jsdom'),{installSupportingFiles}=await import('../src/supporting-files.js');const dom=new JSDOM('<div id="app"><main></main><nav class="map-navigation"></nav></div>'),previous=globalThis.document;globalThis.document=dom.window.document;const downloads=[];dom.window.HTMLDialogElement.prototype.show=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 try{installSupportingFiles({db:{storage:{from:()=>({download:async path=>{downloads.push(path);return {data:new Blob(['pdf'],{type:'application/octet-stream'})};}})}},getProject:()=>({id:'a',name:'Map',supporting_files:[{name:'Plan.pdf',path:'plan',size:3}]}),getUser:()=>null,canEdit:()=>false});const row=document.querySelector('[data-list]>.supporting-file');assert.ok(row);assert.equal(document.querySelector('.supporting-group'),null);row.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true}));await new Promise(r=>setTimeout(r,0));assert.deepEqual(downloads,['plan']);assert.equal(document.querySelector('.supporting-preview iframe').title,'Plan.pdf');assert.match(document.querySelector('iframe').src,/^blob:/);document.querySelector('dialog').close();assert.equal(document.querySelector('dialog'),null);
 }finally{globalThis.document=previous;dom.window.close();}
});
