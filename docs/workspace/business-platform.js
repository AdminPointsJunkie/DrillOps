/* Shared FieldMaps company identity; business projects contain campaigns. */
(()=>{
 const key='drillops_business_scope';let context,selection,settings,tab='projects';
 const originalInitialize=initializePortal;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const options=(rows,value,all)=>`${all?`<option value="">${all}</option>`:''}`+rows.map(r=>`<option value="${escape(r.id)}" ${r.id===value?'selected':''}>${escape(r.name)}</option>`).join('');
 const workspace=()=>context.workspaces.find(w=>w.id===selection.workspace_id);
 const canManage=()=>context.platform_admin||['owner','admin'].includes(workspace()?.role);
 const appShares=()=>context.shares.filter(s=>document.body.dataset.workspaceLanding?s.apps.some(a=>(authenticatedUser?.apps||[]).includes(a)):s.apps.includes(WORKSPACE_APP));
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
  let bar=document.getElementById('business-context');
  if(!bar){bar=document.createElement('nav');bar.id='business-context';bar.setAttribute('aria-label','Workspace context');document.querySelector('body > header').append(bar);}
  const project=context.projects.find(p=>p.id===selection.project_id),campaign=context.campaigns.find(c=>c.id===selection.campaign_id);
  bar.innerHTML=`<a href="./workspace.html">Workspace home</a><span>${escape([workspace()?.name,project?.name,campaign?.name].filter(Boolean).join(' / '))}</span><small class="business-role">${context.platform_admin?'Platform Admin':escape(workspace()?.role||'Member')}</small>`;
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
  persist();apply();render();
  if(document.body.dataset.workspaceLanding){
   document.querySelectorAll('#drawer .drawer-section').forEach(n=>n.remove());
   const nav=document.createElement('div');nav.className='drawer-section';nav.innerHTML='<div class="drawer-section-title">Company workspace</div><a class="drawer-nav-item" href="./workspace.html">Projects & campaigns</a><button class="drawer-nav-item" data-page="workspace-settings" onclick="openBusinessWorkspaceSettings()">Workspace settings</button>';
   document.getElementById('drawer').append(nav);document.querySelectorAll('.do-product').forEach(n=>n.textContent='Workspace');
   portalInitialized=true;workspaceStarted=true;openInitialAppPage();return;
  }
  await originalInitialize();apply();
 };
 const originalInitialPage=openInitialAppPage;
 openInitialAppPage=function(){if(document.body.dataset.workspaceLanding&&!(new URLSearchParams(location.search).get('view')))return showWorkspaceHome();return originalInitialPage();};
 function showWorkspaceHome(){
  let page=document.getElementById('page-workspace-home');if(!page){page=document.createElement('section');page.id='page-workspace-home';page.className='page';document.querySelector('.app-local-nav').parentElement.append(page);}
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p===page));updateContractorSwitcherVisibility('workspace-settings');
  page.innerHTML=`<div class="eos-page-heading"><div><p>COMPANY WORKSPACE</p><label>Company <select id="workspace-home-company">${options(context.workspaces,selection.workspace_id)}</select></label><h1>${escape(workspace().name)}</h1><p>Choose a project and campaign to open its reports, accounts or planning.</p></div><button id="workspace-home-settings">Workspace settings</button></div><div class="workspace-projects">${projects().map(p=>`<article><h2>${escape(p.name)}</h2>${(authenticatedUser?.apps||[]).includes("project")?`<button data-open-app="project" data-project="${p.id}" data-campaign="">Open project</button>`:""}<ul>${campaigns().filter(c=>c.project_id===p.id).map(c=>`<li><strong>${escape(c.name)}</strong><div>${['eos','account','project'].filter(a=>(authenticatedUser?.apps||[]).includes(a)).map(a=>`<button data-open-app="${a}" data-campaign="${c.id}" data-project="${p.id}">${{eos:'EOS',account:'Account',project:'Project'}[a]}</button>`).join('')}</div></li>`).join('')||'<li>No campaigns yet. Create one in Workspace Settings.</li>'}</ul></article>`).join('')||'<p>No projects are available in this workspace.</p>'}</div>`;
  document.getElementById('workspace-home-company').onchange=e=>{selection.workspace_id=e.target.value;selection.project_id='';selection.campaign_id='';persist();location.reload();};
  document.getElementById('workspace-home-settings').onclick=()=>openBusinessWorkspaceSettings();
  page.querySelectorAll('[data-open-app]').forEach(b=>b.onclick=()=>{selection.project_id=b.dataset.project;selection.campaign_id=b.dataset.campaign;persist();location.assign('./'+b.dataset.openApp+'.html');});
 }
 window.businessImportDestination=()=>{
  const campaign=context?.campaigns.find(c=>c.id===selection?.campaign_id);
  const project=context?.projects.find(p=>p.id===selection?.project_id);
  if(!campaign||!project)return null;
  return {client:{id:campaign.client_id,name:workspace().name},project:{name:campaign.legacy_name,program:campaign.legacy_program},label:[workspace().name,project.name,campaign.name].join(' / ')};
 };
 selectedImportScope=()=>window.businessImportDestination()||{};
 restoreWorkspaceSelection=apply;
 if(typeof initializeEosScope==='function')initializeEosScope=apply;
 showNewProjectDialog=()=>{tab='projects';open();};
 showNewClientDialog=()=>{tab='people';open();};
 showWorkspaceGate=async()=>{location.assign('./workspace.html');return null;};
 window.addEventListener('storage',event=>{if(event.key===key&&context)location.reload();});
 window.openBusinessWorkspaceSettings=()=>{tab='projects';open();};
 async function open(){
  try{
   settings=canManage()?await api('/workspaces/'+selection.workspace_id+'/settings'):{people:[],shares:[],events:[]};
   let dialog=document.getElementById('business-dialog');if(!dialog){dialog=document.createElement('section');dialog.id='business-dialog';dialog.className='page';document.querySelector('.app-local-nav').parentElement.append(dialog);}
   document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p===dialog));
   closeDrawer();updateContractorSwitcherVisibility('workspace-settings');
   const url=new URL(location.href);url.searchParams.set('view','workspace-settings');history.replaceState({},'',url);
   draw();
  }catch(error){toast(error.message,'warn');}
 }
 function draw(){
  const dialog=document.getElementById('business-dialog');
  dialog.innerHTML=`<div class="business-settings-head"><div><small>WORKSPACE SETTINGS</small><h2>${escape(workspace().name)}</h2></div><button id="business-close" type="button">Workspace home</button></div><div class="business-settings-layout"><nav aria-label="Workspace settings">${['projects','contractors','people','sharing','activity'].map(t=>`<button type="button" data-tab="${t}" aria-current="${t===tab?'page':'false'}">${{projects:'Projects & campaigns',contractors:'Contractors',people:'People & permissions',sharing:'Sharing',activity:'Activity'}[t]}</button>`).join('')}</nav><section id="business-settings-body"></section></div><p id="business-error" role="alert"></p>`;
  document.getElementById('business-close').onclick=()=>location.assign('./workspace.html');dialog.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;draw();});
  const body=document.getElementById('business-settings-body');
  if(tab==='projects'){
   body.innerHTML=`<h3>Projects & campaigns</h3><p>Each company workspace contains projects. Each project contains its own campaigns.</p>${projects().map(p=>`<article><h4>${escape(p.name)}</h4><ul>${campaigns().filter(c=>c.project_id===p.id).map(c=>`<li>${escape(c.name)} <small>${escape(c.year)}</small></li>`).join('')||'<li>No campaigns yet</li>'}</ul></article>`).join('')||'<p>No projects are available.</p>'}${canManage()?`<form id="business-add-project"><h4>Add project</h4><label>Project name<input name="name" required maxlength="120" placeholder="Exploration"></label><button>Create project</button></form><form id="business-add-campaign"><h4>Add campaign</h4><label>Project<select name="project_id" required>${options(projects(),'')}</select></label><label>Campaign name<input name="name" required maxlength="120" placeholder="Ironbark No1 2026"></label><label>Year<input name="year" required pattern="[0-9]{4}" value="${new Date().getFullYear()}"></label><button>Create campaign</button></form>`:''}`;
   bindForm('business-add-project','projects');bindForm('business-add-campaign','campaigns');
  }
  if(tab==='contractors'){
   const descriptions={'Drilling':'Drilled metres, core and chip metres, completed holes, drilling hours and charges.','Geophysical Logging':'Logging reports, holes logged, logged interval metres, logging hours and charges.','Earthworks':'Work reports, equipment hours and charges.','Labour':'Work reports, recorded hours and charges.','Geological Support':'Service reports, recorded hours and charges.','Lab Testing':'Service reports and charges; assay and turnaround KPIs require laboratory results.','Misc':'Service reports, recorded hours and charges.'};
   body.innerHTML='<h3>Contractors</h3><p>Contractor type determines the EOS overview, KPI set and production report. Contractors belong to this company workspace and can be used across its projects and campaigns.</p>'+(canManage()?(settings.contractors||[]).map(c=>`<form data-contractor="${escape(c.name)}"><h4>${escape(c.name)}</h4><label>Contractor type<select name="category">${(settings.contractor_types||[]).map(t=>`<option ${t===c.category?'selected':''}>${escape(t)}</option>`).join('')}</select></label><button>Save type</button><p style="flex-basis:100%">${escape(descriptions[c.category]||descriptions.Misc)}</p></form>`).join('')||'<p>No contractors are configured in this workspace.</p>':'<p>A workspace admin can configure contractor types.</p>');
   if(canManage()){body.insertAdjacentHTML('beforeend',`<form id="business-add-contractor"><h4>Add company contractor</h4><label>Name<input name="name" required maxlength="120"></label><label>Contractor type<select name="category">${(settings.contractor_types||[]).map(t=>`<option>${escape(t)}</option>`).join('')}</select></label><button>Add contractor</button></form>`);bindForm('business-add-contractor','contractors');}
   body.querySelectorAll('[data-contractor]').forEach(f=>f.onsubmit=async e=>{e.preventDefault();await save('contractors/'+encodeURIComponent(f.dataset.contractor),'PATCH',{category:f.elements.category.value});await fetchContractors();});
  }
  if(tab==='people')body.innerHTML=`<h3>People & permissions</h3><p>Accounts, workspace membership and invitations are shared with FieldMaps. Platform Admins retain all permissions. Workspace owners and admins manage projects, campaigns and sharing.</p><a href="/maps/" target="_blank" rel="noopener">Open FieldMaps account and workspace settings ↗</a>${canManage()?`<table><thead><tr><th>Member</th><th>Workspace role</th><th>App access</th></tr></thead><tbody>${settings.people.map(p=>`<tr><td>${escape(p.name||p.email)}<br><small>${escape(p.status)}</small></td><td>${p.platform_admin?'Platform Admin':escape(p.role)}</td><td>${escape((p.apps||[]).join(', '))}</td></tr>`).join('')}</tbody></table>`:'<p>Your workspace admin can manage membership and sharing.</p>'}`;
  if(tab==='sharing'){
   const people=settings.people.filter(p=>p.status==='active'&&!p.platform_admin&&!['owner','admin'].includes(p.role));
   const shares=canManage()?settings.shares:context.shares.filter(s=>s.workspace_id===selection.workspace_id);
   body.innerHTML=`<h3>Project & campaign sharing</h3><p>Project access includes its campaigns. Campaign access is limited to that campaign. Sharing only applies to apps already enabled on the member’s account.</p>${canManage()?`<form id="business-share"><label>Member<select name="user_id" required>${options(people.map(p=>({...p,name:p.name||p.email})), '')}</select></label><label>Share<select name="target" required>${projects().map(p=>`<option value="project:${p.id}">Project · ${escape(p.name)}</option>`).join('')}${campaigns().map(c=>`<option value="campaign:${c.id}">Campaign · ${escape(c.name)}</option>`).join('')}</select></label><label>Permission<select name="role"><option value="viewer">Viewer · read only</option><option value="editor">Editor · read and edit</option></select></label><fieldset><legend>Apps</legend>${['eos','account','project'].map(a=>`<label><input type="checkbox" name="apps" value="${a}" checked>${{eos:'EOS',account:'Account',project:'Project'}[a]}</label>`).join('')}</fieldset><button ${people.length?'':'disabled'}>Save sharing</button></form>`:''}<table><thead><tr><th>Member</th><th>Shared access</th><th>Permission</th><th></th></tr></thead><tbody>${shares.map(s=>`<tr><td>${escape(settings.people.find(p=>p.id===s.user_id)?.name||settings.people.find(p=>p.id===s.user_id)?.email||'Your account')}</td><td>${escape(context.projects.find(p=>p.id===s.project_id)?.name||context.campaigns.find(c=>c.id===s.campaign_id)?.name)}<br><small>${escape(s.apps.join(', '))}</small></td><td>${escape(s.role)}</td><td>${canManage()?`<button type="button" data-revoke="${s.id}">Revoke</button>`:''}</td></tr>`).join('')||'<tr><td colspan="4">No additional sharing. Workspace owners, admins and Platform Admins retain their existing access.</td></tr>'}</tbody></table>`;
   const form=document.getElementById('business-share');
   if(form){const syncApps=()=>{const person=people.find(p=>p.id===form.elements.user_id.value);form.querySelectorAll('[name=apps]').forEach(input=>{input.disabled=!(person?.apps||[]).includes(input.value);input.checked=!input.disabled;});};form.elements.user_id.onchange=syncApps;syncApps();}
   if(form)form.onsubmit=async e=>{e.preventDefault();const values=new FormData(form),[kind,id]=values.get('target').split(':');await save('shares','POST',{user_id:values.get('user_id'),[kind+'_id']:id,role:values.get('role'),apps:values.getAll('apps')});};
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
