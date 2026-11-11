import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf("$('#sync-project').onclick=async()=>{");
const body=source.slice(start,source.indexOf('\nasync function trashLayer',start));
test('Sync publishes saved drafts in view mode, never while editing or without permission',async()=>{
 for(const scenario of [{},{mapEditing:true},{isPermissionReadOnly:()=>true},{workspacePending:()=>true},{LOCAL_TESTING:true}]){
  const button={},map={id:'map'},messages=[];let calls=0;
  const env={$:()=>button,LOCAL_TESTING:false,mapEditing:false,isPermissionReadOnly:()=>false,syncing:false,busy:false,draftSaving:false,projectControls:null,activeMap:map,user:{id:'editor'},workspacePending:()=>false,saves:{state:()=>({pending:false}),flush:async()=>{}},geometryEditor:null,queue:[],syncError:false,syncDirty:true,setBusy(){},refreshSaveStatus(){},db:{},toast:m=>messages.push(m),errorText:String,syncProjectRelease:async()=>{calls++;return {published_at:'now',source_revision:3,version:2}},...scenario};
  const run=new Function(...Object.keys(env),body+';return $("#sync-project").onclick;')(...Object.values(env));await run();assert.equal(calls,Object.keys(scenario).length?0:1);
 }
});
