import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {hasUnsyncedChanges,updateSyncWarning} from '../src/sync-warning.js';
import {createSaveStatus} from '../src/save-status.js';
const synced={draft_revision:4,last_synced_revision:4,last_synced_at:'2026-11-16T00:00:00Z'};
test('warning detects saved drafts after reload and hides after confirmed sync',()=>{
 assert.equal(hasUnsyncedChanges(synced),false);
 assert.equal(hasUnsyncedChanges({...synced,draft_revision:5}),true);
 assert.equal(hasUnsyncedChanges({...synced,_unsynced:true}),true);
 assert.equal(hasUnsyncedChanges({draft_revision:1,last_synced_revision:0}),true);
 for(const project of [null,{}, {draft_revision:0}])assert.equal(hasUnsyncedChanges(project),false);
 for(const options of [{readOnly:true},{local:true}])assert.equal(hasUnsyncedChanges({...synced,draft_revision:5},options),false);
});
test('warning stays visible while syncing and on failure, with accessible explanation',()=>{
 const dom=new JSDOM('<span hidden></span>'),element=dom.window.document.querySelector('span');
 for(const state of [{pending:true},{pending:true,syncing:true},{pending:true,error:true}]){updateSyncWarning(element,state);assert.equal(element.hidden,false);assert.ok(element.getAttribute('aria-label'));assert.equal(element.title,element.getAttribute('aria-label'));}
 assert.match(element.title,/retry/);updateSyncWarning(element,{pending:false});assert.equal(element.hidden,true);dom.window.close();
});
test('only successful saves mark a draft as saved-but-unsynced; failed saves remain retryable',async()=>{
 let saved=false,dirty=false;const saves=createSaveStatus(()=>{},()=>dirty=true);
 await assert.rejects(saves.run('layout',async()=>{if(!saved)throw Error('Offline');}));assert.equal(dirty,false);
 saved=true;await saves.retry();assert.equal(dirty,true);
});

test('view mode refresh keeps the map warning visible until successful publication',async()=>{
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function refreshSaveStatus(){'),source.indexOf('\nasync function retrySaves'));
 const dom=new JSDOM('<span id="save-status"></span><span id="map-sync-warning" hidden></span><button id="sync-project"></button><button id="save-draft"></button><button id="retry-save"></button><small id="sync-status"></small>');
 const project={...synced,draft_revision:5},env={$:s=>dom.window.document.querySelector(s),activeMap:project,syncDirty:false,LOCAL_TESTING:false,isPermissionReadOnly:()=>false,hasUnsyncedChanges,updateSyncWarning,syncing:false,syncError:false,mapEditing:false,user:{id:'owner'},busy:false,draftSaving:false,workspacePending:()=>false,saves:{state:()=>({pending:false})},projectControls:null,isReadOnly:()=>true};
 const refresh=new Function(...Object.keys(env),body+';return refreshSaveStatus;')(...Object.values(env));refresh();assert.equal(env.$('#map-sync-warning').hidden,false);assert.equal(env.$('#sync-status').textContent,'Saved changes not synced');project.last_synced_revision=5;refresh();assert.equal(env.$('#map-sync-warning').hidden,true);dom.window.close();
});
test('saving an unchanged layout does not queue a save or mark the map unsynced',async()=>{
 const {readFile}=await import('node:fs/promises'),{serialiseTree}=await import('../src/layer-tree.js'),{cloudLayout}=await import('../src/data-policy.js');const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function saveLayout(){'),source.indexOf('\nfunction replaceTreeId'));
 const env={activeMap:{layer_layout:['a']},isReadOnly:()=>false,LOCAL_TESTING:false,serialiseTree,cloudLayout,layerTree:['a'],layers:[],layoutSave:Promise.resolve(),structuredClone};
 const save=new Function(...Object.keys(env),body+';return saveLayout;')(...Object.values(env));await save();
});
