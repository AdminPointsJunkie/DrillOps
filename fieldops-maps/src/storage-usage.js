import {usageOverview,usageDefinitions} from './usage-visuals.js';
import {storageSize} from './platform-admin.js';
export function installStorageUsage(db,{doc=document,getWorkspace=()=>null}={}){
 const dialog=doc.createElement('dialog');dialog.id='storage-usage';doc.body.append(dialog);let sequence=0;
 async function open(){const company=getWorkspace();if(!company)return;const request=++sequence;dialog.innerHTML='<div class="dialog-heading"><h2>Storage usage</h2><button type="button" class="square" aria-label="Close storage usage">×</button></div><p data-company></p><div data-usage role="status">Loading usage…</div><button class="secondary" data-refresh>Refresh usage</button>';dialog.querySelector('[data-company]').textContent=company.name;dialog.querySelector('.square').onclick=()=>{sequence++;dialog.close();};dialog.querySelector('[data-refresh]').onclick=()=>open();if(!dialog.open)dialog.showModal();
  try{const {data,error}=await db.rpc('workspace_usage',{p_workspace:company.id});if(request!==sequence||getWorkspace()?.id!==company.id)return;if(error)throw error;dialog.querySelector('[data-usage]').innerHTML=`${usageOverview(data)}<div class="usage-footnote"><span>Vector data estimate</span><strong>${storageSize(data.vector_bytes)}</strong></div>${usageDefinitions(data)}`;}
  catch(e){if(request===sequence)dialog.querySelector('[data-usage]').textContent=e.message||'Usage could not load. Refresh to retry.';}
 }
 return {open,close(){sequence++;dialog.close();dialog.innerHTML='';}};
}
