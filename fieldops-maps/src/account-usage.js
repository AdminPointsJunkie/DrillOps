import {escapeHTML as esc,usageOverview,usageDefinitions,storageSize} from './usage-visuals.js';
import {memberReportHTML} from './member-report.js';

export function accountUsageHTML(data){
 const projects=data.projects||[];
 return `<p>Usage from every map in projects you own belongs to your account, including uploads by other members. Projects shared with you are the responsibility of their owner.</p>${usageOverview(data)}${usageDefinitions(data)}<h3>Your projects</h3><div class="account-project-usage">${projects.map(p=>`<details data-project-usage="${esc(p.id)}"><summary><strong>${esc(p.name)}</strong><span>${Number(p.map_count)||0} maps · ${storageSize(p.usage.file_bytes)} stored</span></summary><div data-project-report></div></details>`).join('')||'<p>You do not own any projects yet.</p>'}</div>`;
}

export function mountAccountUsage(root,{db,userId,getUser}){
 let sequence=0;
 const current=()=>root.isConnected&&getUser()?.id===userId;
 async function refresh(){
  const request=++sequence;root.innerHTML='<p role="status">Loading account usage…</p>';
  try{
   const {data,error}=await db.rpc('account_usage');if(!current()||request!==sequence)return;if(error)throw error;
   root.innerHTML='<button type="button" class="secondary" data-refresh-usage>Refresh usage</button>'+accountUsageHTML(data);
   root.querySelector('[data-refresh-usage]').onclick=refresh;
   for(const details of root.querySelectorAll('[data-project-usage]'))details.addEventListener('toggle',async()=>{
    if(!details.open||details.dataset.loaded)return;details.dataset.loaded='true';const report=details.querySelector('[data-project-report]');report.textContent='Loading member usage…';
    try{const result=await db.rpc('workspace_member_report',{p_workspace:details.dataset.projectUsage});if(!current()||!report.isConnected)return;if(result.error)throw result.error;report.innerHTML=memberReportHTML(result.data);}
    catch(e){if(current()&&report.isConnected){report.textContent=e.message||'Could not load member usage. Close and reopen this project to retry.';delete details.dataset.loaded;}}
   });
  }catch(e){if(current()&&request===sequence){root.innerHTML='<p role="alert"></p><button type="button" data-retry-usage>Retry</button>';root.querySelector('p').textContent=e.message||'Could not load account usage.';root.querySelector('button').onclick=refresh;}}
 }
 void refresh();return {refresh};
}
