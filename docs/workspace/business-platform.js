/* Shared FieldMaps company identity; business projects contain campaigns. */
(()=>{
 const key='drillops_business_scope';let context,selection,settings,tab='projects';
 const originalInitialize=initializePortal;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const options=(rows,value,all)=>`${all?`<option value="">${all}</option>`:''}`+rows.map(r=>`<option value="${escape(r.id)}" ${r.id===value?'selected':''}>${escape(r.name)}</option>`).join('');
 const workspace=()=>context.workspaces.find(w=>w.id===selection.workspace_id);
 const canManage=()=>context.platform_admin||['owner','admin'].includes(workspace()?.role);
 const appShares=()=>context.shares.filter(s=>s.apps.includes(WORKSPACE_APP));
 const campaigns=()=>context.campaigns.filter(c=>c.workspace_id===selection.workspace_id&&(canManage()||appShares().some(s=>s.project_id===c.project_id||s.campaign_id===c.id)));
 const projects=()=>context.projects.filter(p=>p.workspace_id===selection.workspace_id&&(canManage()||appShares().some(s=>s.project_id===p.id)||campaigns().some(c=>c.project_id===p.id)));
 async function api(path,method='GET',data){
  const response=await fetch(API+'/platform'+path,{method,headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
  const result=await response.json();if(!response.ok)throw new Error(result.detail||'Could not save workspace settings');return result;
 }
 function persist(){localStorage.setItem(key,JSON.stringify(selection));}
 function apply(){
  const campaign=context.campaigns.find(c=>c.id===selection.campaign_id);
  activeProjectName=campaign?.legacy_name||'';activeProgram=campaign?.legacy_program||context.projects.find(p=>p.id===selection.project_id)?.name||'';
  activeClientId=campaign?.client_id||context.campaigns.find(c=>c.workspace_id===selection.workspace_id)?.client_id||null;
  if(typeof eosScope!=='undefined'){eosScope={project:activeProjectName,program:activeProgram};if(activeProjectName)eosKnownProjects.add(activeProjectName);}
  document.getElementById('workspace-gate')?.classList.remove('open');document.body.classList.remove('workspace-locked');return true;
 }
 function render(){
  let bar=document.getElementById('business-scope');
  if(!bar){bar=document.createElement('section');bar.id='business-scope';bar.setAttribute('aria-label','Company, project and campaign');document.querySelector('body > header').after(bar);}
  bar.innerHTML=`<label>Company workspace<select id="business-workspace">${options(context.workspaces,selection.workspace_id)}</select></label><label>Project<select id="business-project">${options(projects(),selection.project_id,'All projects')}</select></label><label>Campaign<select id="business-campaign">${options(campaigns().filter(c=>!selection.project_id||c.project_id===selection.project_id),selection.campaign_id,'All campaigns')}</select></label><span class="business-role">${context.platform_admin?'Platform Admin':escape(workspace()?.role||'Member')}</span><button type="button" id="business-settings">Workspace settings</button>`;
  for(const [id,field] of [['workspace','workspace_id'],['project','project_id'],['campaign','campaign_id']])document.getElementById('business-'+id).onchange=e=>{
   selection[field]=e.target.value;if(id==='workspace'){selection.project_id='';selection.campaign_id='';}if(id==='project')selection.campaign_id='';if(id==='campaign'&&selection.campaign_id)selection.project_id=context.campaigns.find(c=>c.id===selection.campaign_id).project_id;
   persist();location.reload();
  };
  document.getElementById('business-settings').onclick=open;
 }
 initializePortal=async function(){
  if(portalInitialized)return;
  context=await api('/context');
  const session=DrillOpsSession.load();const subject=session?.user?.id||JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;
  try{selection=JSON.parse(localStorage.getItem(key));}catch{}
  if(!selection||selection.subject!==subject)selection={subject,workspace_id:'a7ecd88b-8ba9-4c5f-80c8-872fcc50f34f',project_id:'',campaign_id:''};
  if(!context.workspaces.some(w=>w.id===selection.workspace_id))selection.workspace_id=context.workspaces[0]?.id||'';
  if(!selection.workspace_id)throw new Error('Your account needs membership of a company workspace in FieldMaps.');
  if(!projects().some(p=>p.id===selection.project_id)){selection.project_id='';selection.campaign_id='';}
  if(!campaigns().some(c=>c.id===selection.campaign_id))selection.campaign_id='';
  persist();apply();render();await originalInitialize();apply();
 };
 restoreWorkspaceSelection=apply;
 if(typeof initializeEosScope==='function')initializeEosScope=apply;
 showNewProjectDialog=()=>{tab='projects';open();};
 showNewClientDialog=()=>{tab='people';open();};
 showWorkspaceGate=async()=>{document.getElementById('business-campaign')?.focus();return null;};
 window.addEventListener('storage',event=>{if(event.key===key&&context)location.reload();});
 window.openBusinessWorkspaceSettings=()=>{tab='projects';open();};
 async function open(){
  try{
   settings=canManage()?await api('/workspaces/'+selection.workspace_id+'/settings'):{people:[],shares:[],events:[]};
   let dialog=document.getElementById('business-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='business-dialog';document.body.append(dialog);dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});}
   draw();dialog.showModal();
  }catch(error){toast(error.message,'warn');}
 }
 function draw(){
  const dialog=document.getElementById('business-dialog');
  dialog.innerHTML=`<div class="business-settings-head"><div><small>WORKSPACE SETTINGS</small><h2>${escape(workspace().name)}</h2></div><button id="business-close" type="button">Close</button></div><div class="business-settings-layout"><nav aria-label="Workspace settings">${['projects','people','sharing','activity'].map(t=>`<button type="button" data-tab="${t}" aria-current="${t===tab?'page':'false'}">${{projects:'Projects & campaigns',people:'People & permissions',sharing:'Sharing',activity:'Activity'}[t]}</button>`).join('')}</nav><section id="business-settings-body"></section></div><p id="business-error" role="alert"></p>`;
  document.getElementById('business-close').onclick=()=>dialog.close();dialog.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;draw();});
  const body=document.getElementById('business-settings-body');
  if(tab==='projects'){
   body.innerHTML=`<h3>Projects & campaigns</h3><p>Each company workspace contains projects. Each project contains its own campaigns.</p>${projects().map(p=>`<article><h4>${escape(p.name)}</h4><ul>${campaigns().filter(c=>c.project_id===p.id).map(c=>`<li>${escape(c.name)} <small>${escape(c.year)}</small></li>`).join('')||'<li>No campaigns yet</li>'}</ul></article>`).join('')||'<p>No projects are available.</p>'}${canManage()?`<form id="business-add-project"><h4>Add project</h4><label>Project name<input name="name" required maxlength="120" placeholder="Exploration"></label><button>Create project</button></form><form id="business-add-campaign"><h4>Add campaign</h4><label>Project<select name="project_id" required>${options(projects(),'')}</select></label><label>Campaign name<input name="name" required maxlength="120" placeholder="Ironbark No1 2026"></label><label>Year<input name="year" required pattern="[0-9]{4}" value="${new Date().getFullYear()}"></label><button>Create campaign</button></form>`:''}`;
   bindForm('business-add-project','projects');bindForm('business-add-campaign','campaigns');
  }
  if(tab==='people')body.innerHTML=`<h3>People & permissions</h3><p>Accounts, workspace membership and invitations are shared with FieldMaps. Platform Admins retain all permissions. Workspace owners and admins manage projects, campaigns and sharing.</p><a href="/maps/" target="_blank" rel="noopener">Open FieldMaps account and workspace settings ↗</a>${canManage()?`<table><thead><tr><th>Member</th><th>Workspace role</th><th>App access</th></tr></thead><tbody>${settings.people.map(p=>`<tr><td>${escape(p.name||p.email)}<br><small>${escape(p.status)}</small></td><td>${p.platform_admin?'Platform Admin':escape(p.role)}</td><td>${escape((p.apps||[]).join(', '))}</td></tr>`).join('')}</tbody></table>`:'<p>Your workspace admin can manage membership and sharing.</p>'}`;
  if(tab==='sharing'){
   const people=settings.people.filter(p=>p.status==='active'&&!p.platform_admin&&!['owner','admin'].includes(p.role));
   const shares=canManage()?settings.shares:context.shares.filter(s=>s.workspace_id===selection.workspace_id);
   body.innerHTML=`<h3>Project & campaign sharing</h3><p>Project access includes its campaigns. Campaign access is limited to that campaign. Sharing only applies to apps already enabled on the member’s account.</p>${canManage()?`<form id="business-share"><label>Member<select name="user_id" required>${options(people.map(p=>({...p,name:p.name||p.email})), '')}</select></label><label>Share<select name="target" required>${projects().map(p=>`<option value="project:${p.id}">Project · ${escape(p.name)}</option>`).join('')}${campaigns().map(c=>`<option value="campaign:${c.id}">Campaign · ${escape(c.name)}</option>`).join('')}</select></label><label>Permission<select name="role"><option value="viewer">Viewer · read only</option><option value="editor">Editor · read and edit</option></select></label><fieldset><legend>Apps</legend>${['eos','account','project'].map(a=>`<label><input type="checkbox" name="apps" value="${a}" checked>${{eos:'EOS',account:'Account',project:'Project'}[a]}</label>`).join('')}</fieldset><button ${people.length?'':'disabled'}>Save sharing</button></form>`:''}<table><thead><tr><th>Member</th><th>Shared access</th><th>Permission</th><th></th></tr></thead><tbody>${shares.map(s=>`<tr><td>${escape(settings.people.find(p=>p.id===s.user_id)?.name||settings.people.find(p=>p.id===s.user_id)?.email||'Your account')}</td><td>${escape(context.projects.find(p=>p.id===s.project_id)?.name||context.campaigns.find(c=>c.id===s.campaign_id)?.name)}<br><small>${escape(s.apps.join(', '))}</small></td><td>${escape(s.role)}</td><td>${canManage()?`<button type="button" data-revoke="${s.id}">Revoke</button>`:''}</td></tr>`).join('')||'<tr><td colspan="4">No additional sharing. Workspace owners, admins and Platform Admins retain their existing access.</td></tr>'}</tbody></table>`;
   const form=document.getElementById('business-share');if(form)form.onsubmit=async e=>{e.preventDefault();const values=new FormData(form),[kind,id]=values.get('target').split(':');await save('shares','POST',{user_id:values.get('user_id'),[kind+'_id']:id,role:values.get('role'),apps:values.getAll('apps')});};
   body.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>save('shares/'+b.dataset.revoke,'DELETE'));
  }
  if(tab==='activity')body.innerHTML=`<h3>Workspace activity</h3>${settings.events.map(e=>`<article><strong>${escape(e.action.replaceAll('.',' '))}</strong><p>${escape(e.detail.name||e.detail.role||'Sharing updated')} · ${escape(new Date(e.created_at).toLocaleString())}</p></article>`).join('')||'<p>No workspace changes recorded yet.</p>'}`;
 }
 function bindForm(id,path){const f=document.getElementById(id);if(f)f.onsubmit=async e=>{e.preventDefault();await save(path,'POST',Object.fromEntries(new FormData(f)));};}
 async function save(path,method,data){
  const dialog=document.getElementById('business-dialog');dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await api('/workspaces/'+selection.workspace_id+'/'+path,method,data);context=await api('/context');settings=await api('/workspaces/'+selection.workspace_id+'/settings');render();draw();}
  catch(error){document.getElementById('business-error').textContent=error.message;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
 }
})();
