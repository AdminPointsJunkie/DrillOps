
// ── Supabase authentication ──────────────────────────────────────────────────
const API = window.location.hostname==='localhost'||window.location.hostname==='127.0.0.1'
  ? 'http://localhost:8000' : 'https://api.drillops.com.au';
const AUTH_STORAGE_KEY='drillops_supabase_session';
const nativeFetch=window.fetch.bind(window);
let authSession=null;
let portalInitialized=false;
let authenticatedUser=null;

function authConfig(){
  const config=window.DRILLOPS_CONFIG||{};
  const url=String(config.supabaseUrl||'').replace(/\/$/,'');
  const key=String(config.supabasePublishableKey||'');
  if(!url||!key)throw new Error('Authentication is not configured. Add the Supabase URL and publishable key to docs/config.js.');
  return {url,key};
}

function saveAuthSession(session){
  if(typeof invalidateEosReads==='function')invalidateEosReads();
  authSession=session;
  if(session){
    localStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(session));
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  }else{
    localStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

function loadStoredAuthSession(){
  try{
    const session=JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)||sessionStorage.getItem(AUTH_STORAGE_KEY)||'null');
    if(session){
      localStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(session));
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }
    return session;
  }
  catch(error){localStorage.removeItem(AUTH_STORAGE_KEY);sessionStorage.removeItem(AUTH_STORAGE_KEY);return null;}
}

async function authRequest(grantType,payload){
  const config=authConfig();
  const response=await nativeFetch(config.url+'/auth/v1/token?grant_type='+encodeURIComponent(grantType),{
    method:'POST',
    headers:{apikey:config.key,'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.message||data.error_description||'Authentication failed');
  saveAuthSession(data);
  return data;
}

async function accessToken(){
  if(!authSession)authSession=loadStoredAuthSession();
  if(!authSession)return '';
  const expiresAt=Number(authSession.expires_at||0);
  if(!expiresAt||expiresAt*1000>Date.now()+90000)return authSession.access_token;
  const refreshed=await authRequest('refresh_token',{refresh_token:authSession.refresh_token});
  return refreshed.access_token;
}

window.fetch=async function(input,options={}){
  const requestUrl=typeof input==='string'?input:input.url;
  const targetOrigin=new URL(requestUrl,window.location.href).origin;
  if(targetOrigin!==new URL(API).origin)return nativeFetch(input,options);
  const token=await accessToken();
  if(!token)throw new Error('Authentication required');
  const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
  headers.set('Authorization','Bearer '+token);
  const response=await nativeFetch(input,{...options,headers});
  if(response.status===401){
    saveAuthSession(null);
    showLogin('Your session expired. Please sign in again.');
  }
  return response;
};

function showLogin(message=''){
  document.getElementById('login-screen').style.display='block';
  document.body.classList.add('workspace-locked');
  document.getElementById('login-error').textContent=message;
}

function safeReturnTo(){
  const requested=new URLSearchParams(window.location.search).get('return_to')||'';
  const value=requested||sessionStorage.getItem('drillops_return_to')||'';
  if(!value.startsWith('./'))return '';
  try{
    const target=new URL(value,window.location.href);
    const page=target.pathname.split('/').pop();
    const allowed=new Set(['field.html','report.html','range-report.html','borehole.html','training.html','eos.html','account.html','project.html']);
    if(target.origin!==window.location.origin||!allowed.has(page))return '';
    return './'+page+target.search;
  }catch(error){return '';}
}

async function verifyPortalAccount(){
  const response=await apiFetch(API+'/mobile/me',{cache:'no-store'},2);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.detail||'Your account is not active in DrillOps.');
  const returnTo=safeReturnTo();
  const hasManagementAccess=data.management_portal_access===true||data.role==='System Administrator';
  const returnPage=returnTo?new URL(returnTo,window.location.href).pathname.split('/').pop():'';
  // A system administrator signing in from the main website should land in the
  // management portal. Preserve direct links to individual records, but ignore
  // a stale generic field-portal return route left by an earlier session.
  if(returnTo&&(!['eos.html','account.html','project.html'].includes(returnPage)||hasManagementAccess)&&(!hasManagementAccess||returnPage!=='field.html')){
    sessionStorage.removeItem('drillops_return_to');
    window.location.replace(returnTo);
    return false;
  }
  sessionStorage.removeItem('drillops_return_to');
  if(!hasManagementAccess){
    window.location.replace('./field.html');
    return false;
  }
  authenticatedUser=data;
  const name=document.getElementById('authenticated-user-name');
  const email=document.getElementById('authenticated-user-email');
  if(name)name.textContent=data.name+' · '+data.role;
  if(email)email.textContent=data.email;
  return true;
}

async function doLogin(){
  const button=document.getElementById('login-button');
  const error=document.getElementById('login-error');
  const email=document.getElementById('login-email').value.trim().toLowerCase();
  const password=document.getElementById('login-password').value;
  if(!email||!password){error.textContent='Email and password are required.';return;}
  button.disabled=true;button.textContent='Signing in…';error.textContent='';
  try{
    await authRequest('password',{email,password});
    if(!await verifyPortalAccount())return;
    document.getElementById('login-screen').style.display='none';
    await initializePortal();
  }catch(authenticationError){
    saveAuthSession(null);
    error.textContent=authenticationError.message||'Sign-in failed.';
  }finally{
    button.disabled=false;button.textContent='Sign in securely';
  }
}

async function requestPasswordReset(){
  const button=document.getElementById('forgot-password-button');
  const feedback=document.getElementById('login-error');
  const email=document.getElementById('login-email').value.trim().toLowerCase();
  if(!email){feedback.textContent='Enter your email address first.';return;}
  button.disabled=true;button.textContent='Sending reset link…';feedback.classList.remove('error');feedback.textContent='';
  try{
    const config=authConfig();
    const redirectTo=window.location.origin+window.location.pathname;
    const response=await nativeFetch(config.url+'/auth/v1/recover?redirect_to='+encodeURIComponent(redirectTo),{
      method:'POST',
      headers:{apikey:config.key,'Content-Type':'application/json'},
      body:JSON.stringify({email})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.error_description||'The reset email could not be sent.');
    feedback.textContent='If that email belongs to a DrillOps account, a password reset link is on its way.';
  }catch(error){
    feedback.classList.add('error');
    feedback.textContent=error.message||'The reset email could not be sent.';
  }finally{
    button.disabled=false;button.textContent='Forgot your password?';
  }
}

function loadRecoverySessionFromUrl(){
  const values=new URLSearchParams(window.location.hash.replace(/^#/,''));
  const linkType=values.get('type');
  if(!['recovery','invite'].includes(linkType)||!values.get('access_token'))return false;
  const expiresIn=Number(values.get('expires_in')||3600);
  saveAuthSession({
    access_token:values.get('access_token'),
    refresh_token:values.get('refresh_token')||'',
    token_type:values.get('token_type')||'bearer',
    expires_in:expiresIn,
    expires_at:Math.floor(Date.now()/1000)+expiresIn
  });
  document.getElementById('login-panel').hidden=true;
  document.getElementById('password-reset-panel').hidden=false;
  document.querySelector('#password-reset-panel h3').textContent=linkType==='invite'?'Finish setting up your account':'Choose a new password';
  document.querySelector('#password-reset-panel p').textContent=linkType==='invite'?'Create a password to activate your DrillOps invitation.':'Use at least eight characters for your new DrillOps password.';
  showLogin();
  window.history.replaceState(null,'',window.location.pathname+window.location.search);
  document.getElementById('new-password').focus();
  return true;
}

async function updateRecoveredPassword(){
  const button=document.getElementById('update-password-button');
  const feedback=document.getElementById('password-reset-error');
  const password=document.getElementById('new-password').value;
  const confirmation=document.getElementById('confirm-password').value;
  if(password.length<8){feedback.textContent='Use at least eight characters.';return;}
  if(password!==confirmation){feedback.textContent='The passwords do not match.';return;}
  button.disabled=true;button.textContent='Updating password…';feedback.textContent='';
  try{
    const config=authConfig();
    const token=await accessToken();
    if(!token)throw new Error('This password reset link has expired. Request a new one.');
    const response=await nativeFetch(config.url+'/auth/v1/user',{
      method:'PUT',
      headers:{apikey:config.key,Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({password})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.error_description||'Your password could not be updated.');
    saveAuthSession(null);
    document.getElementById('password-reset-panel').hidden=true;
    document.getElementById('login-panel').hidden=false;
    document.getElementById('login-password').value='';
    document.getElementById('login-error').classList.remove('error');
    document.getElementById('login-error').textContent='Password updated. Sign in with your new password.';
    document.getElementById('login-password').focus();
  }catch(error){
    feedback.textContent=error.message||'Your password could not be updated.';
  }finally{
    button.disabled=false;button.textContent='Update password';
  }
}

async function doLogout(){
  try{
    const config=authConfig();
    const token=await accessToken();
    if(token)await nativeFetch(config.url+'/auth/v1/logout',{
      method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+token}
    });
  }catch(error){}
  saveAuthSession(null);
  ['drillops_client_id','drillops_project','drillops_program','drillops_active_page'].forEach(function(key){localStorage.removeItem(key);});
  sessionStorage.clear();
  window.location.reload();
}

document.getElementById('login-email').addEventListener('keydown',event=>{if(event.key==='Enter')document.getElementById('login-password').focus();});
document.getElementById('login-password').addEventListener('keydown',event=>{if(event.key==='Enter')doLogin();});

// ── API fetch with retry (handles Render cold starts) ────────────────────────
async function apiFetch(url, options={}, retries=2){
  for(let i=0; i<=retries; i++){
    try{
      const res = await fetch(url, {...options, signal: AbortSignal.timeout(25000)});
      if(res.ok || res.status < 500) return res;
      if(i < retries){ await new Promise(r=>setTimeout(r, 3000)); }
    }catch(e){
      if(i < retries){
        document.getElementById('db-count').textContent = '⏳ waking API…';
        await new Promise(r=>setTimeout(r, 5000));
      } else { throw e; }
    }
  }
}

// Contractors — loaded from backend, stored locally
const PLANNING_CONTRACTOR = 'Company';
function boreholePlanningContractor(){return PLANNING_CONTRACTOR;}

let CONTRACTORS = JSON.parse(sessionStorage.getItem('drillops_contractors') || 'null') ||
  [{name:'Allianz Drilling',short_code:'ALZ',category:'Drilling'},{name:'Mitchells Drilling',short_code:'MIT',category:'Drilling'},
   {name:'DEPCO Drilling',short_code:'DEP',category:'Drilling',program:'Exploration,Gas Riser,SIS'},
   {name:'MCC Group',short_code:'MCC',category:'Labour',program:'Exploration,Gas Riser,SIS'},{name:'King Konstruct',short_code:'KK',category:'Earthworks'},
   {name:'CHMS',short_code:'CHMS',category:'Earthworks'},
   {name:'Weatherfords',short_code:'WFD',category:'Geological Support'},
   {name:'Epiroc',short_code:'EPI',category:'Geological Support'},{name:'Fortem',short_code:'FOR',category:'Geological Support'},
   {name:'GEOGAS',short_code:'GEO',category:'Lab Testing'},{name:'Geochempet',short_code:'GCP',category:'Lab Testing'},
   {name:'STANTEC',short_code:'STN',category:'Lab Testing'},{name:'SIGRA',short_code:'SIG',category:'Lab Testing'},
   {name:'Earth Works',short_code:'EW',category:'Earthworks'}];
CONTRACTORS=contractorsForApp(CONTRACTORS);

const PROJECT_PROGRAMS = ['Exploration','Gas Riser','SIS'];
const CONTRACTOR_SITES = ['Ironbark','Carborough Downs'];
const CONTRACTOR_CATEGORIES = ['Drilling','Earthworks','Labour','Geological Support','Lab Testing','Misc'];
const CONTRACTOR_GL_LABELS = {
  '4200':'Consulting Services',
  '4250':'Contractors',
  '4350':'Drilling Services'
};
let activeProgram = localStorage.getItem('drillops_program') || sessionStorage.getItem('drillops_program') || 'Exploration';

function contractorPrograms(c) {
  const raw = c && (c.programs || c.program);
  const list = Array.isArray(raw) ? raw : String(raw || 'Exploration').split(',');
  const programs = list.map(function(p){return String(p).trim();}).filter(Boolean);
  return programs.length ? programs : ['Exploration'];
}

function contractorProgram(c) {
  return contractorPrograms(c).join(', ');
}

function contractorSites(c) {
  const raw=c&&(c.sites||c.site);
  const list=Array.isArray(raw)?raw:String(raw||'Ironbark').split(',');
  const sites=list.map(function(site){return String(site).trim();}).filter(Boolean);
  return sites.length?sites:['Ironbark'];
}

function contractorSite(c) {
  return contractorSites(c).join(', ');
}

function contractorCategory(c) {
  if(c&&c.category)return c.category;
  const name=String(c&&c.name||'').toLowerCase();
  if(name.includes('drill'))return 'Drilling';
  if(name.includes('earth')||name.includes('king')||name.includes('konstruct')||name.includes('chms'))return 'Earthworks';
  if(name.includes('mcc'))return 'Labour';
  if(name.includes('fortem')||name.includes('weatherford')||name.includes('geophys')||name.includes('geolog'))return 'Geological Support';
  if(name.includes('geogas')||name.includes('sigra')||name.includes('geochem')||name.includes('stantec')||name.includes('stantect')||name.includes('lab'))return 'Lab Testing';
  return 'Misc';
}

function defaultContractorExpenseGl(c) {
  const category=contractorCategory(c);
  if(category==='Drilling')return '4350';
  if(category==='Earthworks'||category==='Labour')return '4250';
  return '4200';
}

function contractorExpenseGl(c) {
  const gl=String(c&&c.expense_gl||'').trim();
  return /^\d{4}$/.test(gl)?gl:defaultContractorExpenseGl(c);
}

function contractorGlLabel(gl) {
  return CONTRACTOR_GL_LABELS[String(gl)]||'Other Finance account';
}

function contractorByName(name){
  return CONTRACTORS.find(function(c){ return c.name === name; }) || {name:name||''};
}

function activeContractorCategory(){
  return contractorCategory(contractorByName(activeContractor));
}

function reportDrillingContractor(){
  const linkedDrilling=(projectContractorsData||[]).map(function(row){
    const configured=contractorByName(row.contractor);
    return Object.assign({},configured,{
      name:row.contractor||configured.name,
      category:row.category||configured.category,
      activity_rows:Number(row.activity_rows||0),
      usage_count:Number(row.usage_count||0)
    });
  }).filter(function(c){return contractorCategory(c)==='Drilling';}).sort(function(a,b){
    return b.activity_rows-a.activity_rows||b.usage_count-a.usage_count||a.name.localeCompare(b.name);
  });
  const drilling = linkedDrilling[0]
    || filteredContractors().find(function(c){ return contractorCategory(c) === 'Drilling'; })
    || CONTRACTORS.find(function(c){ return contractorCategory(c) === 'Drilling'; });
  return (drilling && drilling.name) || '';
}

function contractorInProgram(c, program) {
  if(c&&c.name==='DEPCO Drilling')return true;
  return !program || contractorPrograms(c).includes(program);
}

function filteredContractors() {
  if(WORKSPACE_APP==='eos')return contractorsForApp(CONTRACTORS);
  const programContractors=CONTRACTORS.filter(function(c){ return contractorInProgram(c, activeProgram); });
  if(!activeProjectName||!projectContractorsData.length)return programContractors;
  const linkedNames=new Set(projectContractorsData.map(function(row){return String(row.contractor||'').toLowerCase();}));
  const linked=programContractors.filter(function(c){
    return c.name==='DEPCO Drilling'||linkedNames.has(String(c.name||'').toLowerCase());
  });
  return linked.length?linked:programContractors;
}

function invoiceContractorsForWorkspace(program) {
  const selectedProgram=program===undefined?activeProgram:program;
  const projectKey=String(activeProjectName||'').trim().toLowerCase();
  const byName=new Map();
  function addContractor(contractor){
    const name=String(contractor&&contractor.name||'').trim();
    if(!name)return;
    const key=name.toLowerCase();
    const existing=byName.get(key);
    if(!existing||(contractorCategory(existing)==='Misc'&&contractorCategory(contractor)!=='Misc')){
      byName.set(key,contractor);
    }
  }
  CONTRACTORS.forEach(function(contractor){
    if(contractor.active===false||!contractorInProgram(contractor,selectedProgram))return;
    const sites=contractorSites(contractor).map(function(site){return site.toLowerCase();});
    if(projectKey&&sites.length&&!sites.includes(projectKey))return;
    addContractor(contractor);
  });
  (projectContractorsData||[]).forEach(function(row){
    const configured=CONTRACTORS.find(function(contractor){
      return String(contractor.name||'').toLowerCase()===String(row.contractor||'').toLowerCase();
    })||{};
    if(configured.active===false)return;
    addContractor(Object.assign({},configured,row,{name:row.contractor||configured.name}));
  });
  const active=CONTRACTORS.find(function(contractor){return contractor.name===activeContractor;});
  if(active&&active.active!==false&&contractorInProgram(active,selectedProgram))addContractor(active);
  return Array.from(byName.values()).sort(function(a,b){return a.name.localeCompare(b.name);});
}

async function loadProjectContractors(){
  projectContractorsData=[];
  if(!activeProjectName)return projectContractorsData;
  try{
    const response=await fetch(API+'/project-contractors?project='+encodeURIComponent(activeProjectName)+'&program='+encodeURIComponent(activeProgram||'')+'&_='+Date.now(),{cache:'no-store'});
    if(response.ok)projectContractorsData=contractorsForApp(await response.json(),'contractor');
  }catch(error){
    console.warn('Could not load project suppliers',error);
  }
  return projectContractorsData;
}

async function fetchContractors(){
  try{
    const data=await fetch(`${API}/contractors`).then(r=>r.json());
    if(data&&data.length){
      CONTRACTORS=contractorsForApp(data);
      sessionStorage.setItem('drillops_contractors',JSON.stringify(data));
    }
  }catch(e){console.warn('Could not fetch contractors from API, using cached list');}
}

// ── User administration and change history ─────────────────────────────────
let adminUsers=[];

function adminDate(value){
  if(!value)return '—';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return String(value);
  return date.toLocaleString('en-AU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function adminRoleLabel(value){
  return ({system_admin:'System administrator',project_manager:'Project manager',approver:'Approver',contractor_supervisor:'Contractor supervisor',field_user:'Field user',finance:'Finance',auditor:'Auditor',user:'Project user'})[value]||String(value||'User').replaceAll('_',' ');
}

function adminRowsLabel(counts){
  const entries=Object.entries(counts||{}).filter(function(entry){return Number(entry[1]||0)>0;});
  return entries.length?entries.map(function(entry){return Number(entry[1]).toLocaleString('en-AU')+' '+entry[0].replaceAll('_',' ');}).join(' · '):'—';
}

async function loadAdminPage(){
  const userBody=document.getElementById('admin-users-body');
  const importBody=document.getElementById('admin-imports-body');
  if(userBody)userBody.innerHTML='<tr><td colspan="6">Loading user accounts…</td></tr>';
  if(importBody)importBody.innerHTML='<tr><td colspan="6">Loading import history…</td></tr>';
  await Promise.all([loadAdminUsers(),loadAdminImports(),loadAdminAudit()]);
}

async function loadAdminUsers(){
  const body=document.getElementById('admin-users-body');
  try{
    const response=await fetch(API+'/admin/users',{cache:'no-store'});
    const data=await response.json().catch(function(){return [];});
    if(!response.ok)throw new Error(data.detail||'Could not load users');
    adminUsers=Array.isArray(data)?data:[];
    document.getElementById('admin-user-count').textContent=adminUsers.length+' account'+(adminUsers.length===1?'':'s');
    body.innerHTML=adminUsers.map(function(user){
      const memberships=(user.project_memberships||[]).filter(function(item){return item.active;});
      const access=user.system_role==='system_admin'
        ?'<strong>All workspaces</strong>'
        :(memberships.map(function(item){return '<div>'+esc(item.project_name)+' <span style="color:var(--muted);">· '+esc(adminRoleLabel(item.role))+'</span></div>';}).join('')||'<span style="color:var(--red);">No active project access</span>');
      return '<tr><td><strong>'+esc(user.display_name||user.email||'Unnamed user')+'</strong><div style="color:var(--muted);margin-top:3px;">'+esc(user.email||'')+'</div></td>'
        +'<td>'+esc(adminRoleLabel(user.system_role))+'</td><td>'+access+'</td>'
        +'<td><span class="admin-status '+(user.active?'':'inactive')+'">'+(user.active?'Active':'Inactive')+'</span></td>'
        +'<td>'+esc(adminDate(user.last_sign_in_at))+'</td>'
        +'<td><button class="btn-ghost" type="button" onclick="openUserAccessDialogById(\''+String(user.id).replaceAll("'",'')+'\')">Edit access</button></td></tr>';
    }).join('')||'<tr><td colspan="6">No accounts found.</td></tr>';
  }catch(error){
    body.innerHTML='<tr><td colspan="6" style="color:var(--red);">'+esc(error.message||error)+'</td></tr>';
  }
}

function openUserAccessDialogById(userId){
  openUserAccessDialog(adminUsers.find(function(user){return user.id===userId;})||null);
}

function projectRoleOptions(selected){
  return ['field_user','contractor_supervisor','project_manager','approver','finance','auditor'].map(function(role){
    return '<option value="'+role+'" '+(role===selected?'selected':'')+'>'+esc(adminRoleLabel(role))+'</option>';
  }).join('');
}

function openUserAccessDialog(user){
  user=user||null;
  const memberships=new Map((user&&user.project_memberships||[]).map(function(item){return [Number(item.project_id),item];}));
  document.getElementById('user-access-id').value=user?user.id:'';
  document.getElementById('user-access-name').value=user?(user.display_name||''):'';
  document.getElementById('user-access-email').value=user?(user.email||''):'';
  document.getElementById('user-access-email').disabled=Boolean(user);
  document.getElementById('user-access-system-role').value=user?(user.system_role||'user'):'user';
  document.getElementById('user-access-active').checked=user?user.active!==false:true;
  document.getElementById('user-access-active-wrap').style.display=user?'flex':'none';
  const firstMembership=user&&(user.project_memberships||[]).find(function(item){return item.active;});
  document.getElementById('user-access-project-role').value=firstMembership?firstMembership.role:'field_user';
  document.getElementById('user-access-title').textContent=user?'Edit user access':'Invite user';
  document.getElementById('user-access-copy').textContent=user?'Change the person’s role, projects, or account status. Every change is written to the audit log.':'Send a secure invitation and choose exactly which projects the person can access.';
  document.getElementById('user-access-save').textContent=user?'Save access':'Send invitation';
  document.getElementById('user-access-error').textContent='';
  document.getElementById('user-access-projects').innerHTML=(projects||[]).filter(function(project){return project.status!=='Inactive';}).map(function(project){
    const membership=memberships.get(Number(project.id));
    return '<label class="project-access-option"><input class="user-project-check" type="checkbox" value="'+Number(project.id)+'" '+(membership&&membership.active?'checked':'')+'/>'
      +'<span style="flex:1;"><strong>'+esc(project.name)+'</strong><br/><small>'+esc(project.program||'')+'</small></span>'
      +'<select class="drawer-input user-project-role" style="width:145px;padding:5px;">'+projectRoleOptions(membership?membership.role:document.getElementById('user-access-project-role').value)+'</select></label>';
  }).join('')||'<div style="color:var(--muted);">Create a project before assigning project access.</div>';
  syncUserAccessForm();
  document.getElementById('user-access-dialog').showModal();
}

function applyDefaultProjectRole(){
  const role=document.getElementById('user-access-project-role').value;
  document.querySelectorAll('#user-access-projects .project-access-option').forEach(function(option){
    if(option.querySelector('.user-project-check')?.checked)option.querySelector('.user-project-role').value=role;
  });
}

function syncUserAccessForm(){
  const isAdmin=document.getElementById('user-access-system-role').value==='system_admin';
  document.getElementById('user-access-project-role').disabled=isAdmin;
  document.getElementById('user-access-projects').style.opacity=isAdmin?'.45':'1';
  document.querySelectorAll('#user-access-projects input,#user-access-projects select').forEach(function(input){input.disabled=isAdmin;});
}

async function saveUserAccess(event){
  event.preventDefault();
  const userId=document.getElementById('user-access-id').value;
  const button=document.getElementById('user-access-save');
  const error=document.getElementById('user-access-error');
  const systemRole=document.getElementById('user-access-system-role').value;
  const memberships=systemRole==='system_admin'?[]:Array.from(document.querySelectorAll('#user-access-projects .project-access-option')).filter(function(option){return option.querySelector('.user-project-check').checked;}).map(function(option){return {project_id:Number(option.querySelector('.user-project-check').value),role:option.querySelector('.user-project-role').value};});
  if(systemRole!=='system_admin'&&!memberships.length){error.textContent='Choose at least one project for a project user.';return;}
  const payload={
    display_name:document.getElementById('user-access-name').value.trim(),
    system_role:systemRole,
    active:document.getElementById('user-access-active').checked,
    project_memberships:memberships
  };
  if(!userId)payload.email=document.getElementById('user-access-email').value.trim().toLowerCase();
  button.disabled=true;button.textContent=userId?'Saving…':'Sending…';error.textContent='';
  try{
    const response=await fetch(userId?API+'/admin/users/'+encodeURIComponent(userId):API+'/admin/users/invite',{
      method:userId?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    const data=await response.json().catch(function(){return {};});
    if(!response.ok)throw new Error(data.detail||'Could not save user access');
    document.getElementById('user-access-dialog').close();
    toast(userId?'User access updated':'Invitation sent');
    await Promise.all([loadAdminUsers(),loadAdminAudit()]);
  }catch(saveError){error.textContent=saveError.message||saveError;}
  finally{button.disabled=false;button.textContent=userId?'Save access':'Send invitation';}
}

async function loadAdminImports(){
  const body=document.getElementById('admin-imports-body');
  try{
    const response=await fetch(API+'/admin/imports?limit=150',{cache:'no-store'});
    const rows=await response.json().catch(function(){return [];});
    if(!response.ok)throw new Error(rows.detail||'Could not load import history');
    body.innerHTML=rows.map(function(row){
      const workspace=[row.client,row.project,row.contractor].filter(Boolean).join(' · ')||'—';
      return '<tr><td>'+esc(adminDate(row.created_at))+'</td><td><strong>'+esc(row.actor_name||'System')+'</strong><div style="color:var(--muted);">'+esc(row.actor_email||'')+'</div></td>'
        +'<td><strong>'+esc(row.filename||'')+'</strong></td><td>'+esc(String(row.import_kind||'').replaceAll('_',' '))+'</td><td>'+esc(workspace)+'</td><td>'+esc(adminRowsLabel(row.row_counts))+'</td></tr>';
    }).join('')||'<tr><td colspan="6">No imports recorded yet.</td></tr>';
  }catch(error){body.innerHTML='<tr><td colspan="6" style="color:var(--red);">'+esc(error.message||error)+'</td></tr>';}
}

function auditValue(value){
  if(value===null||value===undefined||value==='')return 'blank';
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
}

function auditDetails(row){
  const details=row.details||{};
  if(row.action&&row.action.startsWith('import.')){
    return [details.filename,adminRowsLabel(details.row_counts)].filter(Boolean).join(' · ');
  }
  if(row.action&&row.action.startsWith('user.'))return details.email||'User access changed';
  const changes=details.changes||{};
  const entries=Object.entries(changes);
  if(!entries.length)return row.request_path||'Recorded change';
  return entries.slice(0,8).map(function(entry){
    const field=entry[0].replaceAll('_',' ');
    const value=entry[1];
    if(value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'from'))return field+': '+auditValue(value.from)+' → '+auditValue(value.to);
    return field+': '+auditValue(value);
  }).join(' · ')+(entries.length>8?' · +'+(entries.length-8)+' more':'');
}

async function loadAdminAudit(){
  const body=document.getElementById('admin-audit-body');
  if(!body)return;
  body.innerHTML='<tr><td colspan="5">Loading change history…</td></tr>';
  const params=new URLSearchParams({limit:'200'});
  const action=document.getElementById('admin-audit-filter')?.value||'';
  const search=document.getElementById('admin-audit-search')?.value.trim()||'';
  if(action)params.set('action',action);
  if(search)params.set('search',search);
  try{
    const response=await fetch(API+'/admin/audit-events?'+params.toString(),{cache:'no-store'});
    const rows=await response.json().catch(function(){return [];});
    if(!response.ok)throw new Error(rows.detail||'Could not load change log');
    body.innerHTML=rows.map(function(row){
      return '<tr><td>'+esc(adminDate(row.created_at))+'</td><td><strong>'+esc(row.actor_name||'System')+'</strong><div style="color:var(--muted);">'+esc(row.actor_email||'')+'</div></td>'
        +'<td>'+esc(String(row.action||'').replaceAll('_',' '))+'</td><td><strong>'+esc(String(row.entity_type||'').replaceAll('_',' '))+'</strong><div style="color:var(--muted);">'+esc(row.entity_key||'')+(row.project_name?' · '+esc(row.project_name):'')+'</div></td>'
        +'<td class="admin-details">'+esc(auditDetails(row))+'</td></tr>';
    }).join('')||'<tr><td colspan="5">No matching changes.</td></tr>';
  }catch(error){body.innerHTML='<tr><td colspan="5" style="color:var(--red);">'+esc(error.message||error)+'</td></tr>';}
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function toggleDrawer(){
  const d=document.getElementById('drawer');
  const o=document.getElementById('drawer-overlay');
  const h=document.getElementById('hamburger-btn');
  const isOpen=d.classList.contains('open');
  if(isOpen){closeDrawer();}
  else{d.classList.add('open');o.classList.add('open');h.classList.add('open');renderDrawerContractors();}
}
function closeDrawer(){
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('hamburger-btn').classList.remove('open');
}
function drawerNav(btn){
  const page=btn.dataset.page;
  if(routeWorkspacePage(page))return;
  const pageEl=document.getElementById(`page-${page}`);
  if(!pageEl){toast('Page not found: '+page,'err');closeDrawer();return;}
  updateContractorSwitcherVisibility(page);
  // Sync sidebar nav
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  pageEl.classList.add('active');
  localStorage.setItem(workspacePageStorageKey(),page);
  if(WORKSPACE_APP==='eos')syncEosRoute(page);
  triggerPageLoad(page);
  // Update drawer nav highlight
  document.querySelectorAll('.drawer-nav-item').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  closeDrawer();
}

function openTrainingMatrix(){
  window.location.href='./training.html?contractor='+encodeURIComponent(activeContractor||'DEPCO Drilling');
}

function openProjectsFromDrawer(){
  openProjectWorkspaceSection('overview');
}

function openProjectWorkspaceSection(section){
  const pages={overview:'project-budgets',contracts:'cost-contracts',rates:'rates'};
  section=pages[section]?section:'overview';
  const page=pages[section];
  if(routeWorkspacePage(page))return;
  const pageEl=document.getElementById('page-'+page);
  if(!pageEl){toast('Project section not found','err');return;}
  document.querySelectorAll('.nav-item').forEach(function(item){item.classList.remove('active');});
  document.querySelectorAll('.page').forEach(function(item){item.classList.remove('active');});
  document.querySelector('.nav-item[data-page="project-budgets"]')?.classList.add('active');
  pageEl.classList.add('active');
  localStorage.setItem(workspacePageStorageKey(),page);
  document.querySelectorAll('.drawer-nav-item').forEach(function(item){item.classList.remove('active');});
  document.querySelector('.drawer-nav-item[data-page="project-budgets"]')?.classList.add('active');
  document.querySelectorAll('.project-workspace-tab').forEach(function(tab){
    tab.classList.toggle('active',tab.dataset.projectSection===section);
  });
  updateContractorSwitcherVisibility(page);
  triggerPageLoad(page);
  closeDrawer();
}

function renderDrawerContractors(){
  const list=document.getElementById('drawer-contractor-list');
  if(!list)return;
  list.innerHTML=filteredContractors().map((c)=>`
    <div class="contractor-item ${c.name===activeContractor?'active':''}" onclick="switchContractor('${c.name.replace(/'/g,"\\'")}')">
      <div class="contractor-item-left">
        <div class="contractor-dot"></div>
        <div>
          <div class="contractor-name">${esc(c.name)}</div>
          <div class="contractor-code">${esc(c.short_code||'')} · ${esc(contractorProgram(c))}</div>
        </div>
      </div>
      <div class="contractor-item-actions">
        <button class="icon-btn" title="Remove contractor" onclick="event.stopPropagation();removeContractorByName('${c.name.replace(/'/g,"\\'")}')">Remove</button>
      </div>
    </div>`).join('');
}

function renderContractorsPage(){
  const list=document.getElementById('contractors-page-list');
  if(!list)return;
  list.innerHTML=filteredContractors().map((c)=>`
    <div class="contractor-item ${c.name===activeContractor?'active':''}" onclick="switchContractor('${c.name.replace(/'/g,"\\'")}')">
      <div class="contractor-item-left">
        <div class="contractor-dot"></div>
        <div>
          <div class="contractor-name">${esc(c.name)}</div>
          <div class="contractor-code">${esc(c.short_code||'')} · ${esc(contractorProgram(c))}</div>
        </div>
      </div>
      <div class="contractor-item-actions">
        <div style="display:flex;gap:7px;flex-wrap:wrap;max-width:270px;" onclick="event.stopPropagation()">${PROJECT_PROGRAMS.map(function(p){return '<label style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--muted);"><input type="checkbox" '+(contractorPrograms(c).includes(p)?'checked':'')+' onchange="toggleContractorProgram(\''+c.name.replace(/'/g,"\\'")+'\',\''+p+'\',this.checked)"> '+p+'</label>';}).join('')}</div>
        ${c.name===activeContractor?'<span class="tenement-risk ok">Active</span>':`<button class="icon-btn" onclick="event.stopPropagation();removeContractorByName('${c.name.replace(/'/g,"\\'")}')">Remove</button>`}
      </div>
    </div>`).join('');
  renderContractorGlAssignments();
}

function renderContractorGlAssignments(){
  const body=document.getElementById('contractor-gl-body');
  if(!body)return;
  body.innerHTML=CONTRACTORS.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(c){
    const gl=contractorExpenseGl(c);
    const inCurrentView=['4200','4250','4350'].includes(gl);
    return `<tr data-contractor-name="${attr(c.name)}">
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(contractorCategory(c))}</td>
      <td>${esc(contractorProgram(c))}</td>
      <td>${esc(contractorSite(c))}</td>
      <td><span class="tenement-risk ok">TECEXP</span></td>
      <td><input class="drawer-input contractor-gl-input" inputmode="numeric" maxlength="4" list="contractor-gl-options" value="${attr(gl)}" oninput="updateContractorGlLabel(this)" style="width:110px;"/></td>
      <td class="contractor-gl-label">${esc(contractorGlLabel(gl))}${inCurrentView?'':' <span class="tenement-risk warn">Outside current forecast view</span>'}</td>
      <td><button class="icon-btn" onclick="saveContractorGl(this)">Save</button></td>
    </tr>`;
  }).join('');
}

function updateContractorGlLabel(input){
  const gl=String(input.value||'').trim();
  const cell=input.closest('tr')?.querySelector('.contractor-gl-label');
  if(!cell)return;
  const inCurrentView=['4200','4250','4350'].includes(gl);
  cell.innerHTML=esc(contractorGlLabel(gl))+(inCurrentView?'':' <span class="tenement-risk warn">Outside current forecast view</span>');
}

async function saveContractorGl(button){
  const row=button.closest('tr');
  const name=row?.dataset.contractorName||'';
  const input=row?.querySelector('.contractor-gl-input');
  const expenseGl=String(input?.value||'').trim();
  if(!/^\d{4}$/.test(expenseGl)){toast('Expense GL must be a four-digit account code','err');return;}
  try{
    button.disabled=true;
    const res=await fetch(`${API}/contractors/${encodeURIComponent(name)}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expense_gl:expenseGl})
    });
    if(!res.ok){const e=await res.json().catch(()=>({detail:'Failed to save account'}));throw new Error(e.detail||'Failed to save account');}
    const updated=await res.json();
    const contractor=CONTRACTORS.find(function(c){return c.name===name;});
    if(contractor)Object.assign(contractor,updated);
    sessionStorage.setItem('drillops_contractors',JSON.stringify(CONTRACTORS));
    renderContractorGlAssignments();
    toast(name+' assigned to '+expenseGl);
  }catch(e){
    button.disabled=false;
    toast(e.message||'Failed to save contractor account','err');
  }
}

function renderDrawerContractors(){
  const list=document.getElementById('drawer-contractor-list');
  if(!list)return;
  list.innerHTML=filteredContractors().map((c)=>`
    <div class="contractor-item ${c.name===activeContractor?'active':''}" onclick="switchContractor('${c.name.replace(/'/g,"\\'")}')">
      <div class="contractor-item-left">
        <div class="contractor-dot"></div>
        <div>
          <div class="contractor-name">${esc(c.name)}</div>
          <div class="contractor-code">${esc(c.short_code||'')} - ${esc(contractorCategory(c))} - ${esc(contractorProgram(c))}</div>
        </div>
      </div>
      <div class="contractor-item-actions">
        <button class="icon-btn" title="Remove contractor" onclick="event.stopPropagation();removeContractorByName('${c.name.replace(/'/g,"\\'")}')">Remove</button>
      </div>
    </div>`).join('');
}

function renderContractorsPage(){
  const list=document.getElementById('contractors-page-list');
  if(!list)return;
  list.innerHTML=filteredContractors().map((c)=>`
    <div class="contractor-item contractor-edit-row ${c.name===activeContractor?'active':''}" data-contractor-name="${attr(c.name)}" onclick="switchContractor('${c.name.replace(/'/g,"\\'")}')">
      <input class="drawer-input contractor-name-input" value="${attr(c.name)}" onclick="event.stopPropagation()"/>
      <input class="drawer-input contractor-code-input" value="${attr(c.short_code||'')}" onclick="event.stopPropagation()"/>
      <select class="drawer-input contractor-category-input" onclick="event.stopPropagation()">
        ${CONTRACTOR_CATEGORIES.map(function(cat){return '<option '+(contractorCategory(c)===cat?'selected':'')+'>'+esc(cat)+'</option>';}).join('')}
      </select>
      <div class="contractor-program-checks contractor-program-values" onclick="event.stopPropagation()">${PROJECT_PROGRAMS.map(function(p){return '<label><input type="checkbox" '+(contractorPrograms(c).includes(p)?'checked':'')+' value="'+attr(p)+'"> '+esc(p)+'</label>';}).join('')}</div>
      <div class="contractor-site-checks contractor-program-checks" onclick="event.stopPropagation()">${CONTRACTOR_SITES.map(function(site){return '<label><input type="checkbox" '+(contractorSites(c).includes(site)?'checked':'')+' value="'+attr(site)+'"> '+esc(site)+'</label>';}).join('')}</div>
      <div class="contractor-row-actions" onclick="event.stopPropagation()">
        ${c.name===activeContractor?'<span class="tenement-risk ok">Active</span>':''}
        <button class="icon-btn contractor-save-btn" onclick="saveContractorFromRow(this,'${c.name.replace(/'/g,"\\'")}')">Save</button>
        <button class="icon-btn" onclick="removeContractorByName('${c.name.replace(/'/g,"\\'")}')">Delete</button>
      </div>
    </div>`).join('');
  renderContractorGlAssignments();
}

function toggleAddContractorForm(){
  const f=document.getElementById('add-contractor-form');
  f.classList.toggle('open');
}

async function addContractor(){
  const nameEl=document.getElementById('page-new-con-name')||document.getElementById('new-con-name');
  const codeEl=document.getElementById('page-new-con-code')||document.getElementById('new-con-code');
  const categoryEl=document.getElementById('page-new-con-category');
  const programEl=document.getElementById('page-new-con-program');
  const siteEl=document.getElementById('page-new-con-site');
  const name=nameEl.value.trim();
  const code=codeEl.value.trim().toUpperCase();
  const category=(categoryEl&&categoryEl.value)||'Misc';
  const programs=[(programEl&&programEl.value)||activeProgram||'Exploration'];
  const sites=[(siteEl&&siteEl.value)||'Ironbark'];
  if(!name){toast('Contractor name required','err');return;}
  try{
    const res=await fetch(`${API}/contractors`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,short_code:code||name.slice(0,3).toUpperCase(),category,programs,sites})
    });
    if(!res.ok){const e=await res.json();toast(e.detail||'Failed to add','err');return;}
    const d=await res.json();
    // Update local list
    const existing=CONTRACTORS.find(c=>c.name===name);
    if(existing)Object.assign(existing,d);
    else CONTRACTORS.push(d);
    sessionStorage.setItem('drillops_contractors',JSON.stringify(CONTRACTORS));
    nameEl.value='';
    codeEl.value='';
    if(categoryEl)categoryEl.value='Misc';
    document.getElementById('add-contractor-form')?.classList.remove('open');
    buildContractorSwitcher();
    renderDrawerContractors();
    renderContractorsPage();
    toast(`✓ ${name} saved to database`);
  }catch(e){toast('Network error — could not save contractor','err');}
}

async function removeContractor(idx){
  const c=CONTRACTORS[idx];
  if(c.name===activeContractor){toast('Cannot remove active contractor — switch first','err');return;}
  if(!confirm(`Remove "${c.name}" from the list?\n\nThis does NOT delete their data from the database.`))return;
  try{
    await fetch(`${API}/contractors/${encodeURIComponent(c.name)}`,{method:'DELETE'});
    CONTRACTORS.splice(idx,1);
    sessionStorage.setItem('drillops_contractors',JSON.stringify(CONTRACTORS));
    buildContractorSwitcher();
    renderDrawerContractors();
    renderContractorsPage();
    toast(`${c.name} removed`,'warn');
  }catch(e){toast('Failed to remove contractor','err');}
}

async function removeContractorByName(name){
  const idx=CONTRACTORS.findIndex(function(c){return c.name===name;});
  if(idx>=0) return removeContractor(idx);
}

async function removeContractor(idx){
  const c=CONTRACTORS[idx];
  if(!c)return;
  if(!confirm(`Remove "${c.name}" from the list?\n\nThis does NOT delete their data from the database.`))return;
  try{
    await fetch(`${API}/contractors/${encodeURIComponent(c.name)}`,{method:'DELETE'});
    CONTRACTORS.splice(idx,1);
    if(c.name===activeContractor){
      const next=filteredContractors()[0]||CONTRACTORS[0];
      if(next){
        activeContractor=next.name;
        sessionStorage.setItem('drillops_contractor',activeContractor);
      }
    }
    sessionStorage.setItem('drillops_contractors',JSON.stringify(CONTRACTORS));
    buildContractorSwitcher();
    renderDrawerContractors();
    renderContractorsPage();
    toast(`${c.name} removed`,'warn');
  }catch(e){toast('Failed to remove contractor','err');}
}

async function saveContractorFromRow(button, oldName){
  const row=button.closest('.contractor-edit-row');
  const c=CONTRACTORS.find(function(item){return item.name===oldName;});
  if(!row||!c)return;
  const newName=row.querySelector('.contractor-name-input').value.trim();
  const code=row.querySelector('.contractor-code-input').value.trim().toUpperCase();
  const category=row.querySelector('.contractor-category-input').value;
  let programs=Array.from(row.querySelectorAll('.contractor-program-values input:checked')).map(function(input){return input.value;});
  let sites=Array.from(row.querySelectorAll('.contractor-site-checks input:checked')).map(function(input){return input.value;});
  if(!newName){toast('Contractor name required','err');return;}
  if(!programs.length)programs=['Exploration'];
  if(!sites.length)sites=['Ironbark'];
  try{
    const res=await fetch(`${API}/contractors/${encodeURIComponent(oldName)}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:newName,short_code:code||newName.slice(0,3).toUpperCase(),category,programs,sites})
    });
    if(!res.ok){const e=await res.json().catch(()=>({detail:'Failed to update contractor'}));toast(e.detail||'Failed to update contractor','err');return;}
    const updated=await res.json();
    Object.assign(c,updated);
    if(oldName===activeContractor){
      activeContractor=updated.name;
      sessionStorage.setItem('drillops_contractor',activeContractor);
    }
    sessionStorage.setItem('drillops_contractors',JSON.stringify(CONTRACTORS));
    buildContractorSwitcher();
    renderDrawerContractors();
    renderContractorsPage();
    toast(updated.name+' saved');
  }catch(e){toast('Failed to update contractor','err');}
}

async function updateContractorPrograms(name, programs){
  const c=CONTRACTORS.find(function(item){return item.name===name;});
  if(!c)return;
  try{
    const res=await fetch(`${API}/contractors/${encodeURIComponent(name)}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({programs})
    });
    if(!res.ok)throw new Error(await res.text());
    c.program=programs.join(',');
    sessionStorage.setItem('drillops_contractors',JSON.stringify(CONTRACTORS));
    buildContractorSwitcher();
    renderDrawerContractors();
    renderContractorsPage();
    toast(name+' programs updated');
  }catch(e){toast('Failed to update contractor program','err');}
}

async function updateContractorProgram(name, program){
  return updateContractorPrograms(name, [program]);
}

async function toggleContractorProgram(name, program, checked){
  const c=CONTRACTORS.find(function(item){return item.name===name;});
  if(!c)return;
  let programs=contractorPrograms(c);
  if(checked && !programs.includes(program))programs.push(program);
  if(!checked)programs=programs.filter(function(p){return p!==program;});
  if(!programs.length)programs=['Exploration'];
  await updateContractorPrograms(name, programs);
}

// Wire up clear buttons (drawer + sidebar)
function doClearContractor(){
  if(!confirm(`Clear ALL data for ${activeContractor}?\n\nThis cannot be undone.`))return;
  fetch(`${API}/reset?contractor=${encodeURIComponent(activeContractor)}`,{method:'DELETE'})
    .then(()=>{toast(`${activeContractor} data cleared`,'warn');updateDbCount();loadActivities();});
}
document.getElementById('clear-btn')?.addEventListener('click',doClearContractor);
// sidebar removed

// ── Global State ──────────────────────────────────────────────────────────────
let activeContractor = sessionStorage.getItem('drillops_contractor') || 'Allianz Drilling';
let activeClientId = null;
let activeProjectName = '';
let projectContractorsData = [];
let pendingFiles = [];
let filterOpts   = {dates:[],holes:[],sites:[],codes:[]};
let activitiesData=[], consumablesData=[], reportConsumablesData=[], crewData=[], anomaliesData=[], periodReportActivitiesData=[], periodReportConsumablesData=[], periodMccActivitiesData=[], periodSupportInvoicesData=[], projectBudgetsData=[], periodSourceBudgetData=null, explorationMetresSummaryData=null, costCentreForecastData=null, mccWeeklyAuditData=null, mccWeeklyAuditLoaded=false, mccWeeklyAuditLoading=false, mccWeeklyAuditScope='', mccPersonnelData=null, mccPersonnelLoading=false, selectedMccPersonKey='';
let activityMissingCodesOnly=false;
let dailyReportsData=[], mccWeeklyReportsData=[], selectedDailyReportKey=null;
let dailyReportSort={key:'date',direction:-1};
let productionRawData=[], productionFilteredData=[];
let costContractsData=[], costContractRatesData=[], rateLibrarySummaryData=[], selectedCostContractId=null, activeCostContractStatus='Active', activeCostContractSection='Time Activities';
let reportApprovalsByKey={};
let reportLocksByKey={};
let costingHolesData=[], costingDatesData=[], costingLinesData=[];
let drillingRatesData=[], hourlyRatesData=[];
let posData=[];
let tenementsData=[];
let charts={};
let activeRateYear=null;
const activityBroadcast=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('drillops-activity-updates');

// ── Helpers ───────────────────────────────────────────────────────────────────
function toast(msg,type='ok'){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.style.borderLeftColor=type==='err'?'var(--red)':type==='warn'?'var(--yellow)':'var(--accent)';
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),3000);
}
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function attr(s){return esc(s).replace(/"/g,'&quot;');}
function fmt(v,d=2){if(v==null||v==='')return'';const n=parseFloat(v);return isNaN(n)?'':n.toFixed(d);}
function cur(v){return '$'+(parseFloat(v)||0).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});}
function numberFromAny(){
  for(let i=0;i<arguments.length;i++){
    const raw=arguments[i];
    if(raw==null||raw==='')continue;
    const n=parseFloat(String(raw).replace(/[$,\s]/g,''));
    if(Number.isFinite(n))return n;
  }
  return null;
}
function getSelVals(id){const s=document.getElementById(id);return s?[...s.selectedOptions].map(o=>o.value):[];}
function selectAll(id){const s=document.getElementById(id);if(s)[...s.options].forEach(o=>o.selected=true);}
function isPageActive(page){return document.getElementById('page-'+page)?.classList.contains('active');}
function pageUsesContractorSwitcher(page){return WORKSPACE_APP!=='eos'&&page==='activities';}
function updateContractorSwitcherVisibility(page){
  if(typeof document==='undefined'||!document.body)return;
  document.body.classList.toggle('hide-contractor-switcher', !pageUsesContractorSwitcher(page));
}
function setProgramControls(){
  const global=document.getElementById('global-program-select');
  if(global)global.value=activeProgram;
  const planning=document.getElementById('bh-program-select');
  if(planning)planning.value=activeProgram;
  const addCon=document.getElementById('page-new-con-program');
  if(addCon)addCon.value=activeProgram||'Exploration';
  const budgetProgram=document.getElementById('budget-program-filter');
  if(budgetProgram)budgetProgram.value=activeProgram||'';
}
function activeProgramLabel(){return activeProgram||'All Programs';}
function projectMatchesActiveProgram(projectName){
  if(!activeProgram)return true;
  if(!projectName)return false;
  return projectProgramForName(projectName)===activeProgram;
}
function boreholeMatchesActiveProgram(b){
  if(!activeProgram)return true;
  if(b&&b.program)return b.program===activeProgram;
  return projectMatchesActiveProgram((b&&b.project)||'');
}
function filterBoreholesForActiveProgram(rows){
  return (rows||[]).filter(boreholeMatchesActiveProgram);
}
function rowMatchesActiveProgram(row){
  if(WORKSPACE_APP==='eos')return EosProduction.scopeMatch(row||{},eosScope);
  if(activeProjectName && row && row.project && !projectNamesMatch(row.project, activeProjectName)) return false;
  if(!activeProgram)return true;
  if(row&&row.program)return String(row.program).split(',').map(function(p){return p.trim();}).includes(activeProgram);
  if(row&&row.project)return projectMatchesActiveProgram(row.project);
  const text=[row&&row.location,row&&row.contract,row&&row.notes,row&&row.source_file].join(' ').toLowerCase();
  if(text.includes('arg-002')||text.includes('gas riser'))return activeProgram==='Gas Riser';
  if(text.includes('arg-003')||text.includes('sis'))return activeProgram==='SIS';
  if(text.includes('arg-005')||text.includes('exploration'))return activeProgram==='Exploration';
  const holes=holeLookup();
  const bh=holes.get(rowHole(row||{}));
  if(activeProjectName && bh && !projectNamesMatch(bh.project, activeProjectName)) return false;
  return !!(bh&&boreholeMatchesActiveProgram(bh));
}
function filterRowsForActiveProgram(rows){
  if(WORKSPACE_APP==='eos'&&typeof filterEosRows==='function')return filterEosRows(rows);
  if(activeContractor==='MCC Group')return rows||[];
  return (rows||[]).filter(rowMatchesActiveProgram);
}
function filterWorkspaceActivities(rows){
  if(WORKSPACE_APP==='eos'&&typeof filterEosRows==='function')return filterEosRows(rows);
  return filterRowsForActiveProgram(rows).filter(function(row){
    return !activeProjectName||projectNamesMatch(row.project,activeProjectName);
  });
}
function ensureActiveContractorInProgram(){
  const allowed=filteredContractors();
  if(!allowed.length){
    activeContractor='';
    sessionStorage.setItem('drillops_contractor',activeContractor);
    return;
  }
  if(!allowed.some(function(c){return c.name===activeContractor;})){
    activeContractor=allowed[0].name;
    sessionStorage.setItem('drillops_contractor',activeContractor);
  }
}
async function switchProgram(program){
  activeProgram=program||'';
  saveWorkspaceSelection();
  updateWorkspaceContextLabel();
  setProgramControls();
  ensureActiveContractorInProgram();
  projects=[];
  projectBudgetsData=[];
  periodSourceBudgetData=null;
  explorationMetresSummaryData=null;
  bhData=[];
  activitiesData=[];consumablesData=[];reportConsumablesData=[];periodMccActivitiesData=[];crewData=[];dailyReportsData=[];mccWeeklyReportsData=[];mccPersonnelData=null;selectedMccPersonKey='';productionRawData=[];productionFilteredData=[];
  buildContractorSwitcher();
  renderDrawerContractors();
  await fetchProjects();
  await loadProjectBudgets();
  await updateDbCount();
  const activePage=document.querySelector('.page.active')?.id?.replace('page-','');
  if(activePage) triggerPageLoad(activePage);
  toast('Workspace: '+activeProgramLabel());
}
let costingRefreshTimer=null;
function refreshCostingIfActive(delay=250){
  if(!isPageActive('costing'))return;
  clearTimeout(costingRefreshTimer);
  costingRefreshTimer=setTimeout(()=>loadCosting(),delay);
}
function handleExternalActivityUpdate(msg){
  if(!msg||msg.contractor!==activeContractor)return;
  if(isPageActive('activities'))loadActivities();
  else if(activitiesData.length)renderDailyReportSummary(activitiesData);
  refreshCostingIfActive();
}
if(activityBroadcast)activityBroadcast.addEventListener('message',function(e){handleExternalActivityUpdate(e.data);});
window.addEventListener('storage',function(e){
  if(e.key!=='drillops-activity-updated'||!e.newValue)return;
  try{handleExternalActivityUpdate(JSON.parse(e.newValue));}catch(err){}
});
function fillSelect(id,vals,allSel=true){
  const s=document.getElementById(id); if(!s)return;
  s.innerHTML='';
  vals = Array.isArray(vals) ? vals : [];
  vals.forEach(v=>{const o=document.createElement('option');o.value=o.textContent=v;o.selected=allSel;s.appendChild(o);});
}
function codeBadge(code){
  if(!code)return'';const c=code.toLowerCase();
  let cls='badge-other';
  if(c.includes('drill_core')||c.includes('drill_chip'))cls='badge-drill';
  else if(c.includes('repair'))cls='badge-repair';
  else if(c.includes('standby')||c.includes('grout')||c.includes('logger'))cls='badge-standby';
  else if(c.includes('travel'))cls='badge-travel';
  return `<span class="badge ${cls}">${esc(code)}</span>`;
}
function dateSortKey(d){
  try{const[dy,mn,yr]=String(d).split('/');return parseInt(yr)*10000+parseInt(mn)*100+parseInt(dy);}catch{return 0;}
}

function parseDurationHours(value){
  if(value==null||value==='')return 0;
  const s=String(value).trim();
  if(!s)return 0;
  if(s.includes(':')){
    const parts=s.split(':').map(function(p){return parseFloat(p)||0;});
    return (parts[0]||0)+((parts[1]||0)/60);
  }
  const n=parseFloat(s);
  return isNaN(n)?0:n;
}
function parseClockMinutes(value){
  if(!value)return null;
  let s=String(value).trim().replace(/\./g,':');
  if(/^\d{3,4}$/.test(s)){
    s=s.padStart(4,'0');
    return parseInt(s.slice(0,2))*60+parseInt(s.slice(2));
  }
  const m=s.match(/^(\d{1,2}):(\d{2})/);
  if(!m)return null;
  return parseInt(m[1])*60+parseInt(m[2]);
}
function clockLabel(mins){
  mins=((mins%1440)+1440)%1440;
  const h=Math.floor(mins/60),m=mins%60;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}
function reportDateSortKey(d){
  const base=dateSortKey(d);
  if(base)return base;
  const parsed=Date.parse(String(d||''));
  return isNaN(parsed)?0:parsed;
}
function activityCategory(row){
  const text=((row.code||'')+' '+(row.notes||'')).toLowerCase();
  if(text.includes('drill')||text.includes('core')||text.includes('chip'))return 'Productive Drilling';
  if(text.includes('trip')||text.includes('rod'))return 'Tripping Rods';
  if(text.includes('flush')||text.includes('circul')||text.includes('water')||text.includes('lost'))return 'Circulation';
  if(text.includes('repair')||text.includes('breakdown'))return 'Repairs';
  if(text.includes('standby')||text.includes('fatigue')||text.includes('wait')||text.includes('delay')||text.includes('no access'))return 'Standby / Delays';
  if(text.includes('travel'))return 'Travel';
  if(text.includes('safety')||text.includes('prestart')||text.includes('meeting')||text.includes('admin'))return 'Safety & Admin';
  return 'Other';
}
function reportKeyFor(row){
  if(typeof WORKSPACE_APP!=='undefined'&&WORKSPACE_APP==='eos')return JSON.stringify([row.contractor||activeContractor,row.project||'',row.date||'',row.source_file||'',row.source_file?'':row.hole_num||'']);
  if(row.source_file){
    return [row.contractor||activeContractor||'No contractor',row.date||'No date',row.source_file].join('|');
  }
  return [row.contractor||activeContractor||'No contractor',row.date||'No date',row.hole_num||'No hole','Manual entry'].join('|');
}
function relatedDailyReportGroup(row,groups,groupsByKey){
  const exact=groupsByKey.get(reportKeyFor(row));
  if(exact)return exact;

  // Some imported consumables do not retain the source filename even though
  // the report detail correctly treats them as part of that day's report.
  // Fall back only when the date/hole identifies one report, so an unlinked
  // cost is never duplicated across multiple reports from the same shift.
  if(row.source_file){
    if(typeof WORKSPACE_APP==='undefined'||WORKSPACE_APP!=='eos')return null;
    const matching=groups.filter(g=>g.sourceFile===row.source_file&&g.date===row.date&&(!row.contractor||g.contractor===row.contractor)&&(!row.project||g.project===row.project));
    return matching.length===1?matching[0]:null;
  }
  let candidates=groups.filter(function(group){
    return (!row.contractor||row.contractor===group.contractor)
      && (!row.date||row.date===group.date);
  });
  if(row.hole_num){
    const holeMatches=candidates.filter(function(group){
      return group.holeSet.has(row.hole_num)||group.hole===row.hole_num;
    });
    if(holeMatches.length)candidates=holeMatches;
  }
  return candidates.length===1?candidates[0]:null;
}
function reportRecordHole(report){
  return report&&report.recordHole!=null?report.recordHole:(report&&report.hole)||'';
}
function reportIdFor(group,index){
  const file=group.sourceFile||'';
  if(file)return file.replace(/\.[^.]+$/,'').slice(0,34);
  return 'DR-'+String(index+1).padStart(4,'0');
}
function reportStatus(group){
  const saved=getStoredReportApproval(group.date,reportRecordHole(group),group.sourceFile,group.contractor);
  if(saved&&saved.status==='approved')return {label:'Approved',cls:'status-ok'};
  if(saved&&saved.status==='rejected')return {label:'Rejected',cls:'status-warn'};
  if(saved&&saved.status==='query')return {label:'Query',cls:'status-warn'};
  if(group.flags.length)return {label:'Needs Review',cls:'status-warn'};
  if(group.cost>0)return {label:'Priced',cls:'status-ok'};
  return {label:'Imported',cls:'status-info'};
}
function reportApprovalStorageKey(contractor,date,hole,source){
  return ['drillops-report-approval',contractor||'',date||'',hole||'',source||''].join('|');
}
function reportApprovalRecordKey(contractor,date,hole,source){
  return [contractor||'',date||'',hole||'',source||''].join('|');
}
function reportLockRecordKey(contractor,date,hole,source){
  return [contractor||'',date||'',hole||'',source||''].join('|');
}
function getStoredReportApproval(date,hole,source,reportContractor){
  const contractor=reportContractor||activeContractor;
  const key=reportApprovalRecordKey(contractor,date,hole,source);
  if(reportApprovalsByKey[key])return reportApprovalsByKey[key];
  try{return JSON.parse(localStorage.getItem(reportApprovalStorageKey(contractor,date,hole,source))||'null');}
  catch(e){return null;}
}
function getStoredReportLock(date,hole,source,reportContractor){
  const key=reportLockRecordKey(reportContractor||activeContractor,date,hole,source);
  return reportLocksByKey[key]||null;
}
function applyActivityReportBundle(bundle){
  bundle=bundle||{};
  activitiesData=bundle.activities||[];
  consumablesData=bundle.consumables||[];
  reportConsumablesData=consumablesData.slice();
  crewData=bundle.crew||[];
  reportApprovalsByKey={};
  (bundle.report_approvals||[]).forEach(function(r){
    reportApprovalsByKey[reportApprovalRecordKey(r.contractor,r.report_date,r.hole_num,r.source_file)]=r;
  });
  reportLocksByKey={};
  (bundle.activity_sheet_locks||[]).forEach(function(r){
    reportLocksByKey[reportLockRecordKey(r.contractor,r.report_date,r.hole_num,r.source_file)]=r;
  });
}
async function loadReportApprovals(dates){
  reportApprovalsByKey={};
  const p=new URLSearchParams({contractor:activeContractor});
  if(dates)p.set('dates',dates);
  try{
    const rows=await fetch(API+'/report-approvals?'+p.toString()).then(function(r){return r.ok?r.json():[];});
    (rows||[]).forEach(function(r){
      const key=reportApprovalRecordKey(r.contractor,r.report_date,r.hole_num,r.source_file);
      reportApprovalsByKey[key]=r;
    });
  }catch(e){
    console.warn('Report approvals unavailable',e);
  }
}
async function loadReportLocks(dates){
  reportLocksByKey={};
  const p=new URLSearchParams({contractor:activeContractor});
  if(dates)p.set('dates',dates);
  try{
    const rows=await fetch(API+'/activity-sheet-locks?'+p.toString()).then(function(r){return r.ok?r.json():[];});
    (rows||[]).forEach(function(r){
      const key=reportLockRecordKey(r.contractor,r.report_date,r.hole_num,r.source_file);
      reportLocksByKey[key]=r;
    });
  }catch(e){
    console.warn('Report locks unavailable',e);
  }
}
function allocatedActivityCost(row){
  const gross=parseFloat(row&&row.line_cost)||0;
  if(String(row&&row.contractor||'')!=='MCC Group')return gross;
  const raw=row&&row.allocation_percent!=null?parseFloat(row.allocation_percent):100;
  const percent=Number.isFinite(raw)?Math.min(100,Math.max(0,raw)):100;
  return gross*percent/100;
}
function groupDailyReports(rows,reportConsumables){
  const map=new Map();
  rows.forEach(function(r){
    const key=reportKeyFor(r);
    if(!map.has(key)){
      map.set(key,{key:key,contractor:r.contractor||activeContractor||'',date:r.date||'',hole:r.hole_num||'',recordHole:r.source_file?'':(r.hole_num||''),site:r.site_name||'',project:r.project||'',shift:r.shift||'',rig:r.drill_rig||'',sourceFile:r.source_file||'',sourceType:r.source_file_type||'',rows:[],holeSet:new Set(),activityCost:0,consumableCost:0,cost:0,metres:0,hours:0,notes:[],categories:{},flags:[]});
    }
    const g=map.get(key);
    g.rows.push(r);
    if(r.hole_num)g.holeSet.add(r.hole_num);
    if(r.is_cost_source!==false)g.activityCost+=allocatedActivityCost(r);
    g.metres+=parseFloat(r.total_metres)||0;
    const hrs=parseDurationHours(r.total_time);
    g.hours+=hrs;
    const cat=activityCategory(r);
    g.categories[cat]=(g.categories[cat]||0)+hrs;
    if(r.notes&&g.notes.indexOf(r.notes)===-1)g.notes.push(r.notes);
    if(!g.rig&&r.drill_rig)g.rig=r.drill_rig;
    if(!g.shift&&r.shift)g.shift=r.shift;
  });
  const groups=[...map.values()];
  const groupsByKey=new Map(groups.map(function(group){return [group.key,group];}));
  const sourceConsumables=Array.isArray(reportConsumables)?reportConsumables:(reportConsumablesData||consumablesData||[]);
  sourceConsumables.forEach(function(c){
    const group=relatedDailyReportGroup(c,groups,groupsByKey);
    if(group)group.consumableCost+=parseFloat(c.line_cost)||0;
  });
  groups.forEach(function(g,i){
    const holes=[...g.holeSet].filter(Boolean);
    if(holes.length>1)g.hole=holes.length+' holes';
    else if(holes.length===1)g.hole=holes[0];
    g.cost=g.activityCost+g.consumableCost;
    g.unpriced=g.rows.filter(function(row){return row.is_cost_source!==false&&(row.line_cost==null||row.line_cost==='');}).length;
    g.id=reportIdFor(g,i);
    g.driller=crewData.filter(function(c){
      return (!c.contractor||c.contractor===g.contractor)
        && c.date===g.date
        && (g.sourceFile?(!c.source_file||c.source_file===g.sourceFile):c.hole_num===g.hole)
        && (!g.sourceFile||!c.source_file||c.source_file===g.sourceFile)
        && String(c.role||'').toLowerCase().includes('drill');
    }).map(function(c){return c.name;})[0]||'';
    if(g.metres===0&&g.cost>0)g.flags.push('Cost with zero metres');
    if(g.notes.join(' ').toLowerCase().match(/lost|fatigue|no access|breakdown|repair|standby/))g.flags.push('Operational note');
    if(g.hours>=12)g.flags.push('Long shift');
    g.status=reportStatus(g);
  });
  return groups.sort(function(a,b){return reportDateSortKey(b.date)-reportDateSortKey(a.date)||a.hole.localeCompare(b.hole);});
}

function dailyReportSortValue(report,key){
  if(key==='date')return reportDateSortKey(report.date);
  if(key==='status')return String((report.status||{}).label||'');
  if(key==='lock')return getStoredReportLock(report.date,reportRecordHole(report),report.sourceFile,report.contractor)?.locked?1:0;
  if(key==='metres'||key==='hours'||key==='cost')return Number(report[key])||0;
  if(key==='notes')return (report.notes||[]).join(' ');
  return String(report[key]||'');
}

function sortDailyReportData(rows){
  const key=dailyReportSort.key;
  const direction=dailyReportSort.direction;
  return (rows||[]).slice().sort(function(a,b){
    const left=dailyReportSortValue(a,key);
    const right=dailyReportSortValue(b,key);
    let comparison;
    if(typeof left==='number'&&typeof right==='number')comparison=left-right;
    else comparison=String(left).localeCompare(String(right),undefined,{numeric:true,sensitivity:'base'});
    if(comparison)return comparison*direction;
    return a.id.localeCompare(b.id,undefined,{numeric:true})*direction;
  });
}

function syncDailyReportSortHeaders(){
  document.querySelectorAll('[data-report-sort]').forEach(function(header){
    const active=header.dataset.reportSort===dailyReportSort.key;
    header.classList.toggle('active-sort',active);
    header.setAttribute('aria-sort',active?(dailyReportSort.direction===1?'ascending':'descending'):'none');
    const indicator=header.querySelector('.report-sort-indicator');
    if(indicator)indicator.textContent=active?(dailyReportSort.direction===1?'↑':'↓'):'↕';
  });
}

function sortDailyReports(key){
  if(dailyReportSort.key===key)dailyReportSort.direction*=-1;
  else dailyReportSort={key:key,direction:1};
  renderDailyReportSummary(activitiesData);
}

function sortDailyReportsFromKey(event,key){
  if(event.key!=='Enter'&&event.key!==' ')return;
  event.preventDefault();
  sortDailyReports(key);
}

// ── Contractor switcher ───────────────────────────────────────────────────────
function buildContractorSwitcher(){
  ensureActiveContractorInProgram();
  setProgramControls();
  const label=document.getElementById('active-contractor-label');
  if(label)label.textContent=activeContractor;
  const switcher=document.getElementById('contractor-switcher');
  if(switcher){
    switcher.innerHTML=filteredContractors().map(function(c){
      const active=c.name===activeContractor;
      const code=c.short_code ? ' · '+c.short_code : '';
      return '<button class="con-btn '+(active?'active':'')+'" type="button" data-contractor="'+attr(c.name)+'" title="'+attr(c.name+code)+'">'+esc(c.name)+'</button>';
    }).join('');
    switcher.querySelectorAll('.con-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        if(btn.dataset.contractor&&btn.dataset.contractor!==activeContractor) switchContractor(btn.dataset.contractor);
      });
    });
  }
  // Update clear button label
  const cn=document.getElementById('clear-con-name');
  if(cn)cn.textContent=activeContractor;
  renderContractorsPage();
}

async function switchContractor(name){
  projects = [];
  activeContractor=name;
  sessionStorage.setItem('drillops_contractor',name);
  if(contractorCategory(contractorByName(name)) === 'Drilling'){
    sessionStorage.setItem('drillops_report_drilling_contractor', name);
  }
  buildContractorSwitcher();
  renderDrawerContractors();
  // Reset all state
  filterOpts={dates:[],holes:[],sites:[],codes:[]};
  activitiesData=[];consumablesData=[];reportConsumablesData=[];crewData=[];anomaliesData=[];mccPersonnelData=null;selectedMccPersonKey='';
  costingHolesData=[];costingDatesData=[];costingLinesData=[];
  posData=[];drillingRatesData=[];hourlyRatesData=[];
  // Reload current page
  await fetchProjects();
  await updateDbCount();
  const activePage=document.querySelector('.page.active')?.id?.replace('page-','');
  if(activePage) triggerPageLoad(activePage);
}

// ── DB count / filters ────────────────────────────────────────────────────────
async function updateDbCount(){
  const dbEl = document.getElementById('db-count');
  if(dbEl) dbEl.textContent='checking...';
  try{
    const res = await apiFetch(`${API}/filters?contractor=${encodeURIComponent(activeContractor)}`, {}, 2);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const d=await res.json();
    if(dbEl) dbEl.textContent=(d.total_rows||0).toLocaleString();
    filterOpts=d;
    try{
      fillSelect('f-dates',d.dates);fillSelect('f-holes',d.holes);
      fillSelect('f-sites',d.sites);fillSelect('f-codes',d.codes);
      fillSelect('f-con-dates',d.dates);fillSelect('f-crew-dates',d.dates);
      buildHoleSelector(d.holes);
    }catch(uiErr){
      console.warn('Filter UI refresh skipped:', uiErr.message);
    }
  }catch(e){
    if(dbEl) {
      dbEl.textContent='offline';
      dbEl.title=`Could not reach ${API}. ${e.message}`;
    }
    console.error('API error:', e.message);
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const page=btn.dataset.page;
  if(routeWorkspacePage(page))return;
    const pageEl=document.getElementById(`page-${page}`);
    if(!pageEl){toast('Page not found: '+page,'err');return;}
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    pageEl.classList.add('active');
    updateContractorSwitcherVisibility(page);
    triggerPageLoad(page);
  });
});

function triggerPageLoad(page){
  if(page==='app-home'&&WORKSPACE_APP==='eos'){loadEosOverview();return;}
  if(routeWorkspacePage(page))return;
  document.querySelectorAll('.app-local-nav a').forEach(a=>{if(new URL(a.href).searchParams.get('view')===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  updateContractorSwitcherVisibility(page);
  // Always reload fresh data when switching tabs — no caching
  if(page==='settings'&&WORKSPACE_APP==='eos')updateEosSettings();
  if(page==='importer')     {};
  if(page==='contractors')  { renderContractorsPage(); }
  if(page==='admin')        loadAdminPage();
  if(page==='boreholes')    loadBoreholes();
  if(page==='production')   loadDailyProduction();
  if(page==='project-budgets') renderClientProjectHierarchy();
  if(page==='project-dashboard') loadProjectDashboard();
  if(page==='budget')       loadProjectBudgets();
  if(page==='cost-contracts') loadCostContracts();
  if(page==='reports')      loadReportsPage();
  if(page==='activities')   loadActivities();
  if(page==='costing')      loadCosting();
  if(page==='analytics')    { populateAnalyticsFilters(); setTimeout(function(){loadAnalytics('all');},80); }
  if(page==='purchase-orders') loadPOs();
  if(page==='invoices')     loadInvoices();
  if(page==='rates')        initRatesTab();
}

// Collapsible filters
['act','con','crew'].forEach(p=>{
  const t=document.getElementById(`${p}-filter-toggle`);
  const body=document.getElementById(`${p}-filter-body`);
  if(t&&body)t.addEventListener('click',()=>{t.classList.toggle('open');body.classList.toggle('open');});
});
[
  ['cost-filter-toggle','cost-filter-body'],
  ['po-add-toggle','po-add-body']
].forEach(([toggleId,bodyId])=>{
  const t=document.getElementById(toggleId);
  const body=document.getElementById(bodyId);
  if(t&&body)t.addEventListener('click',()=>{t.classList.toggle('open');body.classList.toggle('open');});
});

// ── Operational and invoice-source report upload ─────────────────────────────
const dropZone=document.getElementById('drop-zone');
const fileInput=document.getElementById('file-input');
const importBtn=document.getElementById('import-btn');

function looksLikeInvoice(filename){
  return /INV[-_]\d+/i.test(filename) || /invoice/i.test(filename) || /tax.invoice/i.test(filename);
}

function populateImportScopeOptions(){
  const select=document.getElementById('import-client-select');
  if(!select)return;
  const current=Number(select.value||(WORKSPACE_APP==='eos'?0:activeClientId)||0);
  select.innerHTML='<option value="">Select client</option>'+clients.filter(function(client){
    return client.status!=='Inactive';
  }).map(function(client){
    return '<option value="'+Number(client.id)+'"'+(Number(client.id)===current?' selected':'')+'>'+esc(client.name)+'</option>';
  }).join('');
  populateImportProjectOptions();
}

function populateImportProjectOptions(){
  const clientSelect=document.getElementById('import-client-select');
  const projectSelect=document.getElementById('import-project-select');
  if(!clientSelect||!projectSelect)return;
  const clientId=Number(clientSelect.value||0);
  const current=projectSelect.value||((clientId===Number(activeClientId))?activeProjectName:'');
  const available=Array.from(new Set(projects.filter(function(project){
    return clientId&&Number(project.client_id)===clientId&&project.status!=='Inactive';
  }).map(function(project){return project.name;}))).sort();
  projectSelect.innerHTML=clientId
    ? '<option value="">Select project</option>'+available.map(function(projectName){
        return '<option value="'+attr(projectName)+'"'+(projectName===current?' selected':'')+'>'+esc(projectName)+'</option>';
      }).join('')
    : '<option value="">Select client first</option>';
  projectSelect.disabled=!clientId;
}

function selectedImportScope(){
  const clientId=Number(document.getElementById('import-client-select')?.value||0);
  const projectName=document.getElementById('import-project-select')?.value||'';
  const client=clients.find(function(item){return Number(item.id)===clientId;});
  const project=projects.find(function(item){
    return Number(item.client_id)===clientId
      && item.name===projectName
      && (!activeProgram||projectProgram(item)===activeProgram);
  });
  return {client:client,project:project};
}

fileInput?.addEventListener('change',e=>{
  const files=[...e.target.files];
  const invoices=files.filter(f=>looksLikeInvoice(f.name));
  if(invoices.length){
    toast(`⚠ "${invoices[0].name}" looks like an invoice — use the 🧾 Invoice import below`,'warn');
    fileInput.value='';pendingFiles=[];importBtn.disabled=true;importBtn.textContent='Import Reports';return;
  }
  pendingFiles=files;
  importBtn.disabled=pendingFiles.length===0;
  importBtn.textContent=pendingFiles.length>0?`Import ${pendingFiles.length} report(s)`:'Import Reports';
});
dropZone?.addEventListener('dragover',e=>{e.preventDefault();dropZone.classList.add('drag-over');});
dropZone?.addEventListener('dragleave',()=>dropZone.classList.remove('drag-over'));
dropZone?.addEventListener('drop',e=>{
  e.preventDefault();dropZone.classList.remove('drag-over');
  pendingFiles=[...e.dataTransfer.files].filter(f=>/\.(pdf|csv|xlsx)$/i.test(f.name));
  importBtn.disabled=pendingFiles.length===0;
  importBtn.textContent=pendingFiles.length>0?`Import ${pendingFiles.length} file(s)`:'Import to Database';
});

async function isMccSiteLogCsv(file){
  if(!file||!/\.csv$/i.test(file.name))return false;
  try{
    const header=(await file.slice(0,8192).text()).split(/\r?\n/,1)[0];
    const required=['Time In','Time Out','Dur (h:m)','Site','Logpoint','First Name','Last Name','Person ID','Company'];
    const headers=header.split(',').map(function(value){return value.replace(/^"|"$/g,'').trim();});
    return required.every(function(name){return headers.includes(name);});
  }catch(error){return false;}
}

function parseSiteLogCsvRows(text){
  const rows=[];
  let row=[];
  let value='';
  let quoted=false;
  for(let index=0;index<text.length;index++){
    const character=text[index];
    if(quoted){
      if(character==='"'&&text[index+1]==='"'){value+='"';index++;}
      else if(character==='"'){quoted=false;}
      else{value+=character;}
    }else if(character==='"'&&!value){quoted=true;}
    else if(character===','){row.push(value);value='';}
    else if(character==='\n'){
      row.push(value.replace(/\r$/,''));
      if(row.some(function(cell){return cell!=='';}))rows.push(row);
      row=[];value='';
    }else{value+=character;}
  }
  if(value||row.length){row.push(value.replace(/\r$/,''));rows.push(row);}
  return rows;
}

function siteLogCsvCell(value){
  const text=String(value==null?'':value);
  return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
}

function importRetryDelay(attempt){
  return new Promise(function(resolve){setTimeout(resolve,2000*(attempt+1));});
}

async function postOperationalReport(url,formData,retries=2){
  let lastError=null;
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      const response=await fetch(url,{
        method:'POST',
        body:formData,
        signal:AbortSignal.timeout(60000)
      });
      if(response.status>=500&&attempt<retries){
        await importRetryDelay(attempt);
        continue;
      }
      return response;
    }catch(error){
      lastError=error;
      if(attempt<retries){
        await importRetryDelay(attempt);
        continue;
      }
    }
  }
  throw new Error(
    lastError&&lastError.name==='TimeoutError'
      ?'The DrillOps API did not finish the import in time. The file remains selected so you can retry.'
      :'Could not reach the DrillOps API after 3 attempts. The file remains selected so you can retry.'
  );
}

async function mccOnlySiteLogFile(file){
  const bytes=await file.arrayBuffer();
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch(error){text=new TextDecoder('windows-1252').decode(bytes);}
  const rows=parseSiteLogCsvRows(text);
  if(!rows.length)throw new Error('Site Log CSV is empty');
  rows[0][0]=String(rows[0][0]||'').replace(/^\uFEFF/,'');
  const companyIndex=rows[0].findIndex(function(value){return String(value||'').trim()==='Company';});
  if(companyIndex<0)throw new Error('Site Log CSV is missing the Company column');
  const mccRows=rows.slice(1).filter(function(row){
    return String(row[companyIndex]||'').trim().toLowerCase()==='mcc group';
  });
  if(!mccRows.length)throw new Error('No MCC Group rows were found in the Site Log CSV');
  const filtered=[rows[0]].concat(mccRows).map(function(row){return row.map(siteLogCsvCell).join(',');}).join('\r\n')+'\r\n';
  return {
    file:new File([filtered],file.name,{type:'text/csv',lastModified:file.lastModified}),
    rows:mccRows.length
  };
}

importBtn?.addEventListener('click',async()=>{
  if(!pendingFiles.length)return;
  const classifiedFiles=await Promise.all(pendingFiles.map(async function(file){
    return {file:file,isMccSiteLog:await isMccSiteLogCsv(file)};
  }));
  const hasOperationalReports=classifiedFiles.some(function(item){return !item.isMccSiteLog;});
  const importScope=selectedImportScope();
  if(hasOperationalReports&&(!importScope.client||!importScope.project)){
    toast('Select the client and project for these reports','err');
    return;
  }
  importBtn.disabled=true;
  importBtn.innerHTML='<span class="spinner"></span>Importing…';
  const log=document.getElementById('import-log');log.innerHTML='';
  let total=0;
  const failedFiles=[];
  const importedContractors=new Set();
  let importedSwipeHistory=false;
  try{
    const apiReady=await apiFetch(API+'/',{cache:'no-store'},2);
    if(!apiReady||!apiReady.ok)throw new Error('The DrillOps API is unavailable. The selected files have been kept for retry.');
  }catch(error){
    log.innerHTML='<div class="err">✗ The DrillOps API is unavailable. The selected files have been kept for retry.</div>';
    importBtn.textContent=`Retry ${pendingFiles.length} report(s)`;
    importBtn.disabled=false;
    return;
  }
  for(const item of classifiedFiles){
    const file=item.file;
    if(item.isMccSiteLog){
      try{
        const mccUpload=await mccOnlySiteLogFile(file);
        const fd=new FormData();
        fd.append('file',mccUpload.file);
        const response=await postOperationalReport(API+'/mcc/swipe-history/import',fd);
        const data=await response.json().catch(function(){return {};});
        if(!response.ok)throw new Error(data.detail||'Site Log swipe import failed');
        const records=Number(data.swipe_records||data.rows||0);
        log.innerHTML+=`<div class="ok">✓ ${esc(file.name)} (${records} MCC swipe records · ${Number(data.people||0)} people)</div>`;
        total+=records;
        importedSwipeHistory=true;
      }catch(error){
        failedFiles.push(file);
        log.innerHTML+=`<div class="err">✗ ${esc(file.name)}: ${esc(error.message||'Site Log swipe import failed')}</div>`;
      }
      continue;
    }
    const uploadContractor=/\.csv$/i.test(file.name)?'Mitchells Drilling':activeContractor;
    const fd=new FormData();
    fd.append('file',file);
    fd.append('contractor',uploadContractor);
    fd.append('client',importScope.client.name);
    fd.append('project',importScope.project.name);
    fd.append('program',projectProgram(importScope.project));
    try{
      const response=await postOperationalReport(`${API}/import`,fd);
      const d=await response.json().catch(function(){return {};});
      if(!response.ok)throw new Error(d.detail||'Report import failed');
      if(d.status==='imported'){const savedContractor=d.contractor||uploadContractor;const contractTag=d.cost_contract?' · '+esc(d.cost_contract.name):'';importedContractors.add(savedContractor);log.innerHTML+=`<div class="ok">✓ ${file.name} (${d.rows} rows · ${esc(savedContractor)} · ${esc(importScope.client.name)} / ${esc(importScope.project.name)}${contractTag})</div>`+renderImportCheck(d.import_check);total+=d.rows;}
      else{log.innerHTML+=`<div class="skip">⚠ ${file.name} (already imported)</div>`;}
    }catch(e){failedFiles.push(file);log.innerHTML+=`<div class="err">✗ ${esc(file.name)}: ${esc(e.message||'Import failed')}</div>`;}
  }
  pendingFiles=failedFiles;
  importBtn.textContent=failedFiles.length?`Retry ${failedFiles.length} failed report(s)`:'Import to Database';
  importBtn.disabled=failedFiles.length===0;
  if(!failedFiles.length)fileInput.value='';
  await updateDbCount();
  if(importedSwipeHistory)await loadMccPersonnel();
  if(total>0){
    toast(importedSwipeHistory&&classifiedFiles.every(function(item){return item.isMccSiteLog;})
      ?`✓ Imported ${total} MCC swipe records`
      :`✓ Imported ${total} rows for ${Array.from(importedContractors).join(', ')||activeContractor}`);
    loadActivities();
  }
});

function renderImportCheck(check){
  if(!check)return '';
  const warnings=check.warnings||[];
  const cls=check.status==='needs_review'||warnings.some(w=>w.severity==='critical')?'err':check.status==='ok'?'ok':'skip';
  const label=check.label||(check.status==='ok'?'OpenAI check passed':check.status==='unavailable'?'Import QA checks':'OpenAI check needs review');
  const shown=warnings.slice(0,5).map(function(w){
    const row=w.row?' row '+esc(w.row):'';
    const code=w.code?' '+esc(w.code):'';
    return '<div style="margin-left:10px;">• '+esc(w.severity||'info')+row+code+': '+esc(w.issue||'')+'</div>';
  }).join('');
  const more=warnings.length>5?'<div style="margin-left:10px;">… '+(warnings.length-5)+' more issue(s)</div>':'';
  return '<div class="'+cls+'" style="margin-left:10px;">'+label+': '+esc(check.summary||warnings.length+' warning(s)')+'</div>'+shown+more;
}

async function auditExistingImports(){
  const btn=document.getElementById('audit-imports-btn');
  const log=document.getElementById('import-log');
  if(!btn||!log)return;
  btn.disabled=true;
  btn.textContent='Auditing existing EOS...';
  log.innerHTML='<div class="skip">Checking imported EOS rows against the schedule of rates...</div>';
  try{
    const res=await fetch(`${API}/imports/qa-existing`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:activeContractor,limit:500,use_openai:false})
    });
    const d=await res.json();
    if(!res.ok)throw new Error(d.detail||JSON.stringify(d).slice(0,180));
    log.innerHTML='<div class="'+(d.issues?'err':'ok')+'">Checked '+d.checked+' imported report(s). '+d.needs_review+' need review. '+d.issues+' issue(s).</div>';
    (d.results||[]).forEach(function(r){
      const check=r.check||{};
      const warnings=check.warnings||[];
      if(!warnings.length)return;
      log.innerHTML+='<div style="margin-top:8px;font-weight:700;color:var(--text);">'+esc(r.filename)+' · '+esc(r.date||'')+'</div>'+renderImportCheck(check);
    });
    if(!d.issues)log.innerHTML+='<div class="ok">No schedule-of-rates mismatches found in the scanned reports.</div>';
    toast('EOS rate audit complete');
  }catch(e){
    log.innerHTML='<div class="err">Audit failed: '+esc(e.message||e)+'</div>';
    toast('EOS rate audit failed','err');
  }finally{
    btn.disabled=false;
    btn.textContent='Audit Existing EOS Rates';
  }
}

async function fixExistingImportRates(){
  const btn=document.getElementById('fix-imports-btn');
  const log=document.getElementById('import-log');
  if(!btn||!log)return;
  if(!confirm('Apply AI/schedule rate fixes to existing EOS rows for '+activeContractor+'?'))return;
  btn.disabled=true;
  btn.textContent='Fixing EOS rates...';
  log.innerHTML='<div class="skip">Matching imported EOS rows to the schedule of rates and applying corrections...</div>';
  try{
    const res=await fetch(`${API}/imports/ai-fix-rates`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:activeContractor,limit:1000,apply:true})
    });
    const d=await res.json();
    if(!res.ok)throw new Error(d.detail||JSON.stringify(d).slice(0,180));
    log.innerHTML='<div class="ok">Updated '+d.activities_changed+' activity row(s), '+d.consumables_changed+' consumable row(s), and added '+d.consumable_rates_added+' consumable rate item(s).</div>';
    (d.activity_changes||[]).slice(0,8).forEach(function(c){
      log.innerHTML+='<div style="margin-left:10px;">• Activity '+esc(c.id)+' '+esc(c.old_code||'')+': '+esc(c.reason||'updated')+'</div>';
    });
    (d.consumable_changes||[]).slice(0,8).forEach(function(c){
      log.innerHTML+='<div style="margin-left:10px;">• Consumable '+esc(c.id)+' '+esc(c.old_consumable||'')+': '+esc(c.reason||'updated')+'</div>';
    });
    (d.new_consumable_rates||[]).slice(0,8).forEach(function(c){
      log.innerHTML+='<div style="margin-left:10px;">• Added consumable rate: '+esc(c.product)+' ('+esc(c.unit||'')+', '+cur(c.unit_price||0)+')</div>';
    });
    toast('EOS rate fixes applied');
    await loadActivities();
  }catch(e){
    log.innerHTML='<div class="err">Fix failed: '+esc(e.message||e)+'</div>';
    toast('EOS rate fix failed','err');
  }finally{
    btn.disabled=false;
    btn.textContent='AI Fix EOS Rates';
  }
}

async function cleanupCorePlanDoubleups(){
  const btn=document.getElementById('cleanup-imports-btn');
  const log=document.getElementById('import-log');
  if(!btn||!log)return;
  if(!confirm('Remove CorePlan total adjustment rows and make minimum shift charges cost-only for '+activeContractor+'?'))return;
  btn.disabled=true;
  btn.textContent='Cleaning double-ups...';
  log.innerHTML='<div class="skip">Removing CorePlan adjustment rows and zeroing minimum-shift duration double-ups...</div>';
  try{
    const res=await fetch(`${API}/imports/cleanup-coreplan-doubleups`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:activeContractor})
    });
    const d=await res.json();
    if(!res.ok)throw new Error(d.detail||JSON.stringify(d).slice(0,180));
    log.innerHTML='<div class="ok">Cleaned '+d.deleted_adjustments+' adjustment row(s) and '+d.zeroed_minimum_shift_rows+' minimum-shift duration row(s).</div>';
    toast('CorePlan double-ups removed');
    await loadActivities();
  }catch(e){
    log.innerHTML='<div class="err">Cleanup failed: '+esc(e.message||e)+'</div>';
    toast('Cleanup failed','err');
  }finally{
    btn.disabled=false;
    btn.textContent='Remove CorePlan Double-ups';
  }
}

// ── Activities ────────────────────────────────────────────────────────────────
function resetFilters(){
  ['f-dates','f-holes','f-sites','f-codes'].forEach(id=>selectAll(id));
  document.getElementById('f-search').value='';
  const reportSearch=document.getElementById('report-search');
  if(reportSearch)reportSearch.value='';
  activityMissingCodesOnly=false;
  updateMissingCodeButton();
  loadActivities();
}

function toggleActFilters(){
  const panel=document.getElementById('activity-advanced-filters');
  const body=document.getElementById('act-filter-body');
  const toggle=document.getElementById('act-filter-toggle');
  if(!panel)return;
  panel.style.display=panel.style.display==='none'?'block':'none';
  if(panel.style.display==='block'){
    body?.classList.add('open');
    toggle?.classList.add('open');
  }
}

function toggleActivityLog(){
  togglePanel('activity-log-panel','activity-log-toggle-label');
}

function updateMissingCodeButton(){
  const btn=document.getElementById('missing-code-btn');
  if(!btn)return;
  btn.classList.toggle('active',activityMissingCodesOnly);
  btn.textContent=activityMissingCodesOnly?'All rows':'Missing codes';
}

function toggleMissingCodeRows(){
  activityMissingCodesOnly=!activityMissingCodesOnly;
  updateMissingCodeButton();
  const panel=document.getElementById('activity-log-panel');
  if(activityMissingCodesOnly&&panel&&panel.classList.contains('collapsed'))toggleActivityLog();
  loadActivities();
}

function togglePanel(panelId,labelId,labelWord){
  const panel=document.getElementById(panelId);
  const label=document.getElementById(labelId);
  if(!panel)return;
  const opening=panel.classList.contains('collapsed');
  panel.classList.toggle('collapsed');
  const word=labelWord||'rows';
  if(label)label.textContent=panel.classList.contains('collapsed')?'Show '+word:'Hide '+word;
  if(!opening)return;
  if(panelId==='activity-log-panel')renderActivities(activitiesData);
  if(panelId==='consumables-panel')renderConsumablesTable();
  if(panelId==='crew-panel')renderCrewTable();
}

function activityFilterParam(id,delimiter=','){
  const select=document.getElementById(id);
  if(!select)return'';
  const available=[...select.options].map(function(option){return option.value;}).filter(Boolean);
  const selected=[...select.selectedOptions].map(function(option){return option.value;}).filter(Boolean);
  if(!selected.length||selected.length===available.length)return'';
  return selected.join(delimiter);
}

function isMccWeeklyReportRow(row){
  return !!row&&(
    row.source_file_type==='mcc_weekly_xlsx'
    || (/\.xlsx$/i.test(String(row.source_file||''))&&String(row.contractor||activeContractor)==='MCC Group')
  );
}

function mccWeeklyWorkstreamLabel(row){
  const match=String((row&&row.notes)||'').match(/(?:^|\|)\s*Workstream:\s*([^|]+)/i);
  return (match&&match[1]?match[1].trim():String((row&&row.program)||'Unassigned').trim())||'Unassigned';
}

function mccReportRowMatchesProgram(row){
  if(!activeProgram)return true;
  const programs=String((row&&row.program)||'').split(',').map(function(value){return value.trim();}).filter(Boolean);
  if(programs.length)return programs.includes(activeProgram);
  const text=[row&&row.location,row&&row.contract,row&&row.notes,row&&row.source_file].join(' ').toLowerCase();
  if(text.includes('arg-002')||text.includes('gas riser'))return activeProgram==='Gas Riser';
  if(text.includes('arg-003')||text.includes('arg-004')||text.includes('sis'))return activeProgram==='SIS';
  if(text.includes('arg-005')||text.includes('exploration'))return activeProgram==='Exploration';
  return false;
}

function groupMccWeeklyReports(rows){
  const reports=new Map();
  (rows||[]).filter(isMccWeeklyReportRow).forEach(function(row){
    const source=String(row.source_file||'').trim();
    if(!source)return;
    if(!reports.has(source))reports.set(source,{
      sourceFile:source,
      contractor:row.contractor||'MCC Group',
      dates:new Set(),
      workstreams:new Set(),
      lines:0,
      cost:0,
      unpriced:0
    });
    const report=reports.get(source);
    if(row.date)report.dates.add(row.date);
    report.workstreams.add(mccWeeklyWorkstreamLabel(row));
    report.lines++;
    report.cost+=numVal(row.line_cost);
    if(row.line_cost==null||row.line_cost==='')report.unpriced++;
  });
  return [...reports.values()].map(function(report){
    const dates=[...report.dates].sort(function(a,b){return reportDateSortKey(a)-reportDateSortKey(b);});
    report.startDate=dates[0]||'';
    report.endDate=dates[dates.length-1]||'';
    report.workstreamList=[...report.workstreams].sort();
    return report;
  }).sort(function(a,b){return reportDateSortKey(b.endDate)-reportDateSortKey(a.endDate)||a.sourceFile.localeCompare(b.sourceFile);});
}

function mccWeeklyReportPeriod(report){
  if(!report.startDate&&!report.endDate)return'--';
  if(report.startDate===report.endDate)return report.startDate;
  return report.startDate+' – '+report.endDate;
}

function openMccWeeklyReport(sourceFile){
  const report=mccWeeklyReportsData.find(function(item){return item.sourceFile===sourceFile;});
  if(!report)return;
  const params=new URLSearchParams({
    contractor:report.contractor||'MCC Group',
    program:activeProgram||'',
    source:report.sourceFile,
    title:'MCC Weekly Timesheet',
    _:Date.now().toString()
  });
  window.open('report.html?'+params.toString(),'_blank','noopener');
}

function renderMccWeeklyReports(rows){
  const panel=document.getElementById('mcc-weekly-report-panel');
  if(!panel)return;
  if(activeContractor!=='MCC Group'){
    panel.style.display='none';
    mccWeeklyReportsData=[];
    return;
  }
  panel.style.display='block';
  mccWeeklyReportsData=groupMccWeeklyReports(rows);
  const scope=activeProgram||'all workstreams';
  document.getElementById('mcc-weekly-report-summary').textContent='Invoice-source workbooks showing '+scope+' lines. Open a report to review its costing and focused daily comparison; other imported workstreams remain stored.';
  document.getElementById('mcc-weekly-report-count').textContent='· '+mccWeeklyReportsData.length.toLocaleString();
  document.getElementById('mcc-weekly-report-body').innerHTML=mccWeeklyReportsData.map(function(report){
    const workstreams=report.workstreamList.join(', ');
    return '<tr>'
      +'<td><button class="plod-link" type="button" data-source="'+attr(report.sourceFile)+'" onclick="openMccWeeklyReport(this.dataset.source)">'+esc(report.sourceFile.replace(/\.xlsx$/i,''))+'</button><div style="font-size:10px;color:var(--muted);margin-top:3px;">Authoritative invoice source</div></td>'
      +'<td>'+esc(mccWeeklyReportPeriod(report))+'</td>'
      +'<td><span class="notes-preview" title="'+attr(workstreams)+'">'+esc(workstreams||'--')+'</span></td>'
      +'<td>'+report.lines.toLocaleString()+'</td>'
      +'<td style="font-weight:800;color:var(--text);">'+cur(report.cost)+'</td>'
      +'<td>'+(report.unpriced?'<span class="status status-warn">'+report.unpriced+' to review</span>':'<span class="status status-ok">Fully priced</span>')+'</td>'
      +'<td><button class="btn-csv" type="button" data-source="'+attr(report.sourceFile)+'" onclick="openMccWeeklyReport(this.dataset.source)">View &amp; audit</button></td>'
      +'</tr>';
  }).join('')||'<tr><td colspan="7" style="padding:18px;color:var(--muted);">No MCC weekly reports imported yet.</td></tr>';
  makeTableSortable('mcc-weekly-report-table');
}

function mccPersonnelStatusMeta(status){
  return {
    verified:{label:'Verified',cls:'status-ok'},
    variance:{label:'Hours differ',cls:'status-error'},
    no_swipe:{label:'No swipe shift',cls:'status-warn'},
    no_timesheet:{label:'No submitted hours',cls:'status-warn'},
    open_swipe:{label:'Open swipe',cls:'status-warn'}
  }[status]||{label:'Review',cls:'status-warn'};
}

function mccHours(value){
  return numVal(value).toFixed(2)+' h';
}

function mccSignedHours(value){
  const amount=numVal(value);
  return (amount>0?'+':'')+amount.toFixed(2)+' h';
}

function filterMccPersonnel(){
  renderMccPersonnel(mccPersonnelData);
}

function downloadMccPersonnelCSV(){
  const people=((mccPersonnelData&&mccPersonnelData.people)||[]).filter(function(person){
    return numVal(person.submitted_hours)>0;
  });
  const rows=[];
  people.forEach(function(person){
    (person.days||[]).filter(function(day){return numVal(day.submitted_hours)>0;}).forEach(function(day){
      rows.push({
        Person:person.name||'',
        'Person ID':(person.person_ids||[]).join(' | '),
        Role:day.role||person.role||'',
        Date:day.date||'',
        'Submitted hours':numVal(day.submitted_hours).toFixed(2),
        'Swipe in':day.time_in||'',
        'Swipe out':day.time_out||'',
        'Swipe hours':numVal(day.swipe_hours).toFixed(2),
        'Recorded swipe hours':numVal(day.recorded_swipe_hours).toFixed(2),
        'Recorded swipe over 15 hours':day.swipe_ignored?'Yes — submitted hours used':'No',
        'Submitted - swipe':numVal(day.variance_hours).toFixed(2),
        Status:mccPersonnelStatusMeta(day.status).label,
        'Swipe evidence':(day.logpoints||[]).join(' | '),
        'Swipe events':Number(day.swipe_events||0),
        'Timesheet sources':(day.timesheet_sources||[]).join(' | '),
        'Swipe sources':(day.swipe_sources||[]).join(' | ')
      });
    });
  });
  if(!rows.length){toast('No submitted MCC personnel hours to export','warn');return;}
  const headers=Object.keys(rows[0]);
  const csv='\uFEFF'+[headers.map(function(value){return '"'+value.replace(/"/g,'""')+'"';}).join(',')]
    .concat(rows.map(function(row){return headers.map(function(header){return '"'+String(row[header]??'').replace(/"/g,'""')+'"';}).join(',');}))
    .join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='mcc-personnel-reconciliation.csv';
  link.click();
  setTimeout(function(){URL.revokeObjectURL(url);},0);
}

function openMccPersonnelDetail(personKey){
  selectedMccPersonKey=selectedMccPersonKey===personKey?'':personKey;
  renderMccPersonnel(mccPersonnelData);
}

function closeMccSwipeEvidence(){
  const dialog=document.getElementById('mcc-swipe-evidence-dialog');
  if(dialog&&dialog.open)dialog.close();
}

function openMccSwipeEvidence(personKey,dateIso){
  const people=(mccPersonnelData&&mccPersonnelData.people)||[];
  const person=people.find(function(item){return item.person_key===personKey;});
  const day=person&&(person.days||[]).find(function(item){return item.date_iso===dateIso;});
  if(!person||!day){toast('Swipe evidence is no longer available','warn');return;}
  const dialog=document.getElementById('mcc-swipe-evidence-dialog');
  const body=document.getElementById('mcc-swipe-evidence-body');
  document.getElementById('mcc-swipe-evidence-title').textContent='Swipe hours — '+person.name;
  document.getElementById('mcc-swipe-evidence-copy').textContent=(day.date||'')+' · '+(day.role||person.role||'MCC personnel')+' · '+(day.swipe_ignored?'recorded swipe total over 15 h was replaced with submitted hours':'overlapping swipe records count once');
  const varianceColour=Math.abs(numVal(day.variance_hours))>0.5?'var(--red)':'var(--text)';
  const details=day.swipe_details||[];
  body.innerHTML='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:16px;">'
    +'<div class="weekly-card"><div class="weekly-card-title">Submitted</div><div class="weekly-card-value">'+mccHours(day.submitted_hours)+'</div></div>'
    +'<div class="weekly-card"><div class="weekly-card-title">Verification hours</div><div class="weekly-card-value">'+mccHours(day.swipe_hours)+'</div>'+(day.swipe_ignored?'<div class="weekly-card-meta">'+mccHours(day.recorded_swipe_hours)+' recorded — submitted hours used</div>':'')+'</div>'
    +'<div class="weekly-card"><div class="weekly-card-title">Difference</div><div class="weekly-card-value" style="color:'+varianceColour+';">'+mccSignedHours(day.variance_hours)+'</div></div></div>'
    +'<div class="tbl-scroll" style="max-height:360px;border:1px solid var(--border);border-radius:6px;"><table><thead><tr><th>Swipe in</th><th>Swipe out</th><th>Event hours</th><th>Logpoint</th><th>Site / activity</th><th>Source</th></tr></thead><tbody>'
    +(details.length?details.map(function(item){
      const location=[item.site,item.activity].filter(Boolean).join(' · ')||'--';
      return '<tr><td>'+esc(item.time_in||'--')+'</td><td>'+esc(item.time_out||'--')+'</td><td>'+mccHours(item.hours)+'</td><td>'+esc(item.logpoint||'--')+'</td><td>'+esc(location)+'</td><td>'+esc(item.source_file||'--')+'</td></tr>';
    }).join(''):'<tr><td colspan="6" style="padding:18px;color:var(--muted);">No swipe events were recorded for this day.</td></tr>')
    +'</tbody></table></div>'
    +'<div style="font-size:11px;color:var(--muted);line-height:1.5;margin-top:10px;">'+(day.swipe_ignored?'The recorded swipe total exceeded 15 hours, so the submitted hours are used for verification. ':'The Swipe hours total merges overlapping device events. ')+'Individual event hours above are shown as recorded and may overlap.</div>';
  if(dialog&&!dialog.open)dialog.showModal();
}

function renderMccPersonnelDetail(people){
  const host=document.getElementById('mcc-personnel-detail');
  if(!host)return;
  const person=(people||[]).find(function(item){return item.person_key===selectedMccPersonKey;});
  if(!person){host.style.display='none';host.innerHTML='';return;}
  host.style.display='block';
  const ids=(person.person_ids||[]).join(', ');
  host.innerHTML='<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px;">'
    +'<div><div style="font-weight:800;color:var(--text);">'+esc(person.name)+'</div><div style="font-size:11px;color:var(--muted);margin-top:3px;">Daily submitted hours compared with merged swipe coverage'+(ids?' · Person ID '+esc(ids):'')+'. Overlapping device records are counted once.</div></div>'
    +'<button class="btn-csv" type="button" onclick="openMccPersonnelDetail(\''+attr(person.person_key)+'\')">Close</button></div>'
    +'<div class="tbl-scroll" style="max-height:300px;border:1px solid var(--border);border-radius:6px;background:#fff;"><table><thead><tr><th>Date</th><th>Role</th><th>Submitted</th><th>Swipe in / out</th><th>Swipe hours</th><th>Submitted − swipe</th><th>Swipe evidence</th><th>Status</th></tr></thead><tbody>'
    +(person.days||[]).map(function(day){
      const meta=mccPersonnelStatusMeta(day.status);
      const evidence=(day.logpoints||[]).join(', ')||'No positive-duration swipe';
      const source=(day.swipe_sources||[]).join(', ');
      return '<tr><td>'+esc(day.date||'--')+'</td><td>'+esc(day.role||'--')+'</td><td>'+mccHours(day.submitted_hours)+'</td>'
        +'<td>'+esc(day.time_in||'--')+' – '+esc(day.time_out||'--')+'</td><td>'+mccHours(day.swipe_hours)+'</td>'
        +'<td style="font-weight:700;color:'+(Math.abs(numVal(day.variance_hours))>0.5?'var(--red)':'var(--text)')+';">'+mccSignedHours(day.variance_hours)+'</td>'
        +'<td><button class="swipe-evidence-link" type="button" title="Open swipe hours'+(source?' · '+attr(source):'')+'" onclick="openMccSwipeEvidence(\''+attr(person.person_key)+'\',\''+attr(day.date_iso)+'\')">'+esc(evidence)+' · '+Number(day.swipe_events||0)+' event'+(Number(day.swipe_events||0)===1?'':'s')+'</button></td>'
        +'<td><span class="status-pill '+meta.cls+'">'+esc(meta.label)+'</span></td></tr>';
    }).join('')+'</tbody></table></div>';
}

function renderMccPersonnel(data){
  if(WORKSPACE_APP==='eos'&&!eosRawLogsEnabled)return;
  const panel=document.getElementById('mcc-personnel-panel');
  if(!panel)return;
  if(activeContractor!=='MCC Group'){
    panel.style.display='none';
    return;
  }
  panel.style.display='block';
  const body=document.getElementById('mcc-personnel-body');
  const summary=document.getElementById('mcc-personnel-summary');
  const kpis=document.getElementById('mcc-personnel-kpis');
  if(mccPersonnelLoading&&!data){
    summary.textContent='Loading submitted hours and swipe evidence…';
    kpis.innerHTML='';
    body.innerHTML='<tr><td colspan="8" style="padding:18px;color:var(--muted);">Loading MCC personnel…</td></tr>';
    renderMccPersonnelDetail([]);
    return;
  }
  const allPeople=(data&&data.people)||[];
  const query=String(document.getElementById('mcc-personnel-search')?.value||'').trim().toLowerCase();
  const people=query?allPeople.filter(function(person){
    const haystack=[person.name,person.role,(person.person_ids||[]).join(' ')].join(' ').toLowerCase();
    const compact=function(value){return String(value||'').replace(/[^a-z0-9]+/g,'');};
    const compactQuery=compact(query);
    return haystack.includes(query)||(compactQuery&&compact(haystack).includes(compactQuery));
  }):allPeople;
  const coverage=(data&&data.swipe_coverage)||{};
  const dateLabel=function(value){return value?String(value).split('-').reverse().join('/'):'--';};
  const verificationStart=dateLabel((data&&data.verification_start)||'2026-08-01');
  summary.textContent=coverage.records
    ?'Verification begins '+verificationStart+'. '+coverage.records+' swipe records from '+dateLabel(coverage.date_from)+' to '+dateLabel(coverage.date_to)+' · '+coverage.files+' source file'+(coverage.files===1?'':'s')+'. Swipe hours merge overlapping device records; submitted hours are used when the recorded total exceeds 15 h; daily differences within ±0.50 h are verified.'
    :'Verification begins '+verificationStart+'. No MCC swipe history imported yet. Import a Site Log Report CSV to verify submitted hours.';
  const shownTotals={
    people:people.length,
    submitted:people.reduce(function(sum,row){return sum+numVal(row.submitted_hours);},0),
    swipe:people.reduce(function(sum,row){return sum+numVal(row.swipe_hours);},0),
    verified:people.reduce(function(sum,row){return sum+(row.days||[]).filter(function(day){return day.status==='verified';}).length;},0),
    review:people.reduce(function(sum,row){return sum+Number(row.review_days||0);},0)
  };
  kpis.innerHTML=[
    ['People',String(shownTotals.people)],
    ['Submitted',mccHours(shownTotals.submitted)],
    ['Swipe',mccHours(shownTotals.swipe)],
    ['Verified days',String(shownTotals.verified)],
    ['Review days',String(shownTotals.review)]
  ].map(function(item){return '<span><strong>'+esc(item[1])+'</strong> '+esc(item[0])+'</span>';}).join('');
  body.innerHTML=people.map(function(person){
    const meta=mccPersonnelStatusMeta(person.status);
    const ids=(person.person_ids||[]).join(', ');
    return '<tr data-person-key="'+attr(person.person_key)+'"><td><strong>'+esc(person.name)+'</strong>'+(ids?'<div style="font-size:10px;color:var(--muted);margin-top:2px;">ID '+esc(ids)+'</div>':'')+'</td>'
      +'<td>'+esc(person.role||'--')+'</td><td>'+mccHours(person.submitted_hours)+'</td><td>'+mccHours(person.swipe_hours)+'</td>'
      +'<td style="font-weight:700;color:'+(person.status==='verified'?'var(--text)':'var(--red)')+';">'+mccSignedHours(person.variance_hours)+'</td>'
      +'<td>'+Number(person.day_count||0)+' <span style="font-size:10px;color:var(--muted);">('+Number(person.review_days||0)+' review)</span></td>'
      +'<td><span class="status-pill '+meta.cls+'">'+esc(meta.label)+'</span></td>'
      +'<td><button class="btn-csv" type="button" onclick="openMccPersonnelDetail(\''+attr(person.person_key)+'\')">'+(selectedMccPersonKey===person.person_key?'Hide days':'View days')+'</button></td></tr>';
  }).join('')||'<tr><td colspan="8" style="padding:18px;color:var(--muted);">'+(query?'No MCC personnel match this search.':'No submitted or swipe personnel records are available yet.')+'</td></tr>';
  renderMccPersonnelDetail(people);
}

async function loadMccPersonnel(){
  if(WORKSPACE_APP==='eos'&&!eosRawLogsEnabled)return;
  if(activeContractor!=='MCC Group'){
    renderMccPersonnel(null);
    return;
  }
  const requestContractor=activeContractor;
  mccPersonnelLoading=true;
  mccPersonnelData=null;
  renderMccPersonnel(null);
  try{
    const response=await fetch(API+'/mcc/personnel?_='+Date.now(),{cache:'no-store'});
    const data=await response.json().catch(function(){return {};});
    if(!response.ok)throw new Error(data.detail||'HTTP '+response.status);
    if(activeContractor!==requestContractor||(WORKSPACE_APP==='eos'&&!eosRawLogsEnabled))return;
    mccPersonnelData=data;
    mccPersonnelLoading=false;
    renderMccPersonnel(data);
  }catch(error){
    if(activeContractor!==requestContractor||(WORKSPACE_APP==='eos'&&!eosRawLogsEnabled))return;
    mccPersonnelLoading=false;
    const summary=document.getElementById('mcc-personnel-summary');
    const body=document.getElementById('mcc-personnel-body');
    if(summary)summary.textContent='MCC personnel reconciliation could not be loaded.';
    if(body)body.innerHTML='<tr><td colspan="8" style="padding:18px;color:var(--red);">'+esc(error.message||'Personnel data unavailable')+'</td></tr>';
  }
}

async function importMccSwipeHistory(file){
  const input=document.getElementById('mcc-swipe-input');
  const label=document.getElementById('mcc-swipe-upload-label');
  const labelText=document.getElementById('mcc-swipe-upload-text');
  const summary=document.getElementById('mcc-personnel-summary');
  if(!file)return;
  if(!/\.csv$/i.test(file.name)){
    toast('Choose a Site Log Report CSV','err');
    if(input)input.value='';
    return;
  }
  if(label){label.style.opacity='.6';label.style.pointerEvents='none';}
  if(labelText)labelText.textContent='Importing Site Log…';
  if(summary)summary.textContent='Uploading and checking '+file.name+'…';
  try{
    const mccUpload=await mccOnlySiteLogFile(file);
    const form=new FormData();
    form.append('file',mccUpload.file);
    const response=await fetch(API+'/mcc/swipe-history/import',{method:'POST',body:form});
    const data=await response.json().catch(function(){return {};});
    if(!response.ok)throw new Error(data.detail||'Swipe import failed');
    toast('Imported '+Number(data.swipe_records||data.rows||0)+' MCC swipe records for '+Number(data.people||0)+' people');
    await loadMccPersonnel();
  }catch(error){
    const message=error.message||'Swipe import failed';
    if(summary)summary.textContent='Site Log import failed: '+message;
    toast(message,'err');
  }finally{
    if(input)input.value='';
    if(label){label.style.opacity='';label.style.pointerEvents='';}
    if(labelText)labelText.textContent='Import swipe CSV';
  }
}

function toggleMccCombinedAudit(){
  const content=document.getElementById('mcc-weekly-audit-content');
  const button=document.getElementById('mcc-weekly-audit-toggle');
  if(!content||!button)return;
  const opening=content.style.display==='none';
  content.style.display=opening?'block':'none';
  button.textContent=opening?'Hide combined exceptions':'Show combined exceptions';
  if(opening)loadMccWeeklyAudit();
}

function prepareMccWeeklyAuditState(){
  const scope=activeContractor+'|'+(activeProgram||'');
  if(scope===mccWeeklyAuditScope)return;
  mccWeeklyAuditScope=scope;
  mccWeeklyAuditData=null;
  mccWeeklyAuditLoaded=false;
  mccWeeklyAuditLoading=false;
  renderMccWeeklyAudit(null);
}

async function loadMccWeeklyAudit(){
  prepareMccWeeklyAuditState();
  if(activeContractor!=='MCC Group'||mccWeeklyAuditLoaded||mccWeeklyAuditLoading)return;
  const requestScope=mccWeeklyAuditScope;
  mccWeeklyAuditLoading=true;
  renderMccWeeklyAudit(null);
  try{
    const auditUrl=API+'/mcc/weekly-audit?program='+encodeURIComponent(activeProgram||'')+'&_='+Date.now();
    const response=await fetch(auditUrl,{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();
    if(requestScope!==mccWeeklyAuditScope)return;
    mccWeeklyAuditData=data;
    mccWeeklyAuditLoaded=true;
    mccWeeklyAuditLoading=false;
    renderMccWeeklyAudit(data);
  }catch(error){
    if(requestScope!==mccWeeklyAuditScope)return;
    mccWeeklyAuditLoading=false;
    mccWeeklyAuditLoaded=false;
    const summary=document.getElementById('mcc-weekly-audit-summary');
    const body=document.getElementById('mcc-weekly-audit-body');
    if(summary)summary.textContent='The combined audit could not be loaded. Close and reopen this panel to retry.';
    if(body)body.innerHTML='<tr><td colspan="7" style="padding:18px;color:var(--red);">Combined audit unavailable.</td></tr>';
  }
}

function renderMccWeeklyAudit(data){
  if(WORKSPACE_APP==='eos'&&!eosRawLogsEnabled)return;
  mccWeeklyAuditData=data||null;
  const panel=document.getElementById('mcc-weekly-audit-panel');
  if(!panel)return;
  if(activeContractor!=='MCC Group'){
    panel.style.display='none';
    return;
  }
  panel.style.display='block';
  if(!mccWeeklyAuditLoaded){
    document.getElementById('mcc-weekly-audit-summary').textContent=mccWeeklyAuditLoading
      ?'Loading the combined daily-versus-weekly audit…'
      :'Combined exceptions are calculated only when opened so Activity Reports load immediately.';
    document.getElementById('mcc-weekly-audit-kpis').innerHTML='';
    document.getElementById('mcc-weekly-audit-body').innerHTML='<tr><td colspan="7" style="padding:18px;color:var(--muted);">'+(mccWeeklyAuditLoading?'Loading audit…':'Open combined exceptions to run the audit.')+'</td></tr>';
    return;
  }
  const totals=(data&&data.totals)||{};
  const rows=(data&&data.comparison)||[];
  document.getElementById('mcc-weekly-audit-summary').textContent=rows.length
    ?'Combined exception summary across the selected MCC reports. Open a weekly report above for its focused audit.'
    :'Import MCC daily Site Services PDFs and weekly timesheets to run the audit.';
  document.getElementById('mcc-weekly-audit-kpis').innerHTML=[
    ['Weekly cost',cur(totals.weekly_cost||0)],
    ['Audit baseline',cur(totals.daily_estimate||0)],
    ['Unexplained',cur(totals.cost_variance||0)],
    ['Accepted',String(totals.accepted||0)],
    ['Before daily start',String(totals.not_required||0)],
    ['Daily roles ignored',String(totals.ignored_daily||0)],
    ['Exceptions',String(totals.exceptions||0)]
  ].map(function(item){return '<div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">'+esc(item[0])+'</div><div style="font-weight:800;color:var(--text);">'+esc(item[1])+'</div></div>';}).join('');
  const statusLabel={match:'Match',accepted_rule:'Accepted rule',not_required:'Daily not required',ignored_daily:'Ignored from daily',unexpected_charge:'Unexpected weekly charge',variance:'Variance',missing_daily:'Missing daily',missing_weekly:'Missing weekly'};
  const exceptions=rows.filter(function(row){return !['match','accepted_rule','not_required','ignored_daily'].includes(row.status);});
  const displayRows=exceptions.length?exceptions:rows;
  document.getElementById('mcc-weekly-audit-body').innerHTML=displayRows.map(function(row){
    const ok=['match','accepted_rule','not_required','ignored_daily'].includes(row.status);
    const charged=row.status==='unexpected_charge';
    return '<tr><td>'+esc(row.date||'--')+'</td><td>'+esc(row.description||row.code||'--')+'</td>'
      +'<td>'+numVal(row.daily_quantity).toFixed(2)+' '+esc(row.unit||'')+'</td>'
      +'<td>'+numVal(row.weekly_quantity).toFixed(2)+' '+esc(row.unit||'')+'</td>'
      +'<td>'+numVal(row.quantity_variance).toFixed(2)+'</td><td>'+cur(row.weekly_cost||0)+'</td>'
      +'<td><span class="status '+(ok?'status-ok':charged?'status-error':'status-warn')+'">'+esc(statusLabel[row.status]||row.status||'Review')+'</span></td></tr>';
  }).join('')||'<tr><td colspan="7" style="padding:18px;color:var(--muted);">No comparable MCC rows yet.</td></tr>';
  makeTableSortable('mcc-weekly-audit-table');
}

let activitiesRequestSequence=0;
async function loadActivities(){
  if(WORKSPACE_APP==='eos'&&!isPageActive('activities'))return;
  const requestSequence=++activitiesRequestSequence,scopeVersion=typeof eosScopeVersion==='undefined'?0:eosScopeVersion;
  if(WORKSPACE_APP==='eos'){renderDailyReportSummary([]);document.getElementById('report-body').innerHTML='<tr><td colspan="9">Loading plods…</td></tr>';}
  var dates=activityFilterParam('f-dates');
  var holes=activityFilterParam('f-holes');
  var sites=activityFilterParam('f-sites','|||');
  var codes=activityFilterParam('f-codes');
  var search=(document.getElementById('f-search')?document.getElementById('f-search').value:'').trim();
  var p=new URLSearchParams({contractor:activeContractor});
  if(dates)p.set('dates',dates);
  if(holes)p.set('holes',holes);
  if(sites)p.set('sites',sites);
  if(codes)p.set('codes',codes);
  if(search)p.set('search',search);
  if(activityMissingCodesOnly)p.set('missing_codes','true');
  prepareMccWeeklyAuditState();
  loadMccPersonnel();
  try{
    const response=await fetch(API+'/activity-report-data?'+p,{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const bundle=await response.json();
    if(requestSequence!==activitiesRequestSequence||(typeof eosScopeVersion!=='undefined'&&scopeVersion!==eosScopeVersion)||(WORKSPACE_APP==='eos'&&!isPageActive('activities')))return;
    if(!bundle||!Array.isArray(bundle.activities))throw new Error('Invalid activity report response');
    applyActivityReportBundle(bundle);
    if(WORKSPACE_APP==='eos')rememberEosProjects(bundle.activities,!dates&&!holes&&!sites&&!codes&&!search&&!activityMissingCodesOnly);
    activitiesData=filterWorkspaceActivities(activitiesData);
    consumablesData=filterRowsForActiveProgram(consumablesData);
    crewData=filterRowsForActiveProgram(crewData);
    // Paint the report register before doing any work for the optional raw
    // tables. Those tables can contain thousands of editable cells and are
    // hidden by default, so building them here only delays useful content.
    renderActivities(activitiesData);
    renderConsumablesTable();
    renderCrewTable();
  }catch(e){
    if(requestSequence!==activitiesRequestSequence||(typeof eosScopeVersion!=='undefined'&&scopeVersion!==eosScopeVersion)||(WORKSPACE_APP==='eos'&&!isPageActive('activities')))return;
    renderDailyReportSummary([]);
    document.getElementById('report-body').innerHTML='<tr><td colspan="15" role="status" style="color:var(--red);padding:20px">Could not load activity reports. Use Refresh to retry.</td></tr>';
    if(WORKSPACE_APP!=='eos'||eosRawLogsEnabled)document.getElementById('act-body').innerHTML='<tr><td colspan="19" style="color:var(--red);padding:20px">API offline</td></tr>';
  }
}

async function addActivityRow(){
  const dates=getSelVals('f-dates').filter(Boolean);
  const holes=getSelVals('f-holes').filter(Boolean);
  const sites=getSelVals('f-sites').filter(Boolean);
  const row={
    contractor:activeContractor,
    source_file:'Manual entry',
    client:(clientById(activeClientId)||{}).name||'',
    program:activeProgram||'Exploration',
    project:activeProjectName||'',
    date:dates[0]||'',
    hole_num:holes[0]||'',
    site_name:sites[0]||'',
    shift:'Day',
    time_from:'',
    time_to:'',
    total_time:'',
    bit_type:'',
    diameter:'',
    metres_from:null,
    metres_to:null,
    total_metres:null,
    code:'',
    notes:'',
    unit_rate:null,
    quantity:null,
    line_cost:null,
    rate_basis:'manual'
  };
  try{
    const res=await fetch(API+'/activities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)});
    if(!res.ok)throw new Error(await res.text());
    const created=await res.json();
    const panel=document.getElementById('activity-log-panel');
    if(panel&&panel.classList.contains('collapsed'))toggleActivityLog();
    await loadActivities();
    const tr=document.querySelector('#act-body tr[data-id="'+created.id+'"]');
    if(tr){
      tr.scrollIntoView({behavior:'smooth',block:'center'});
      const firstCell=tr.querySelector('[contenteditable]');
      if(firstCell)firstCell.focus();
    }
    toast('Activity row added');
  }catch(e){
    toast('Add row failed: '+(e.message||e),'err');
  }
}

async function loadDailyReportRelatedData(dates){
  const suffix='contractor='+encodeURIComponent(activeContractor)+(dates?'&dates='+encodeURIComponent(dates):'');
  try{
    const results=await Promise.all([
      fetch(API+'/consumables?'+suffix).then(function(r){return r.ok?r.json():[];}),
      fetch(API+'/crew?'+suffix).then(function(r){return r.ok?r.json():[];})
    ]);
    consumablesData=results[0]||[];
    crewData=results[1]||[];
    renderConsumablesTable();
    renderCrewTable();
  }catch(e){
    console.warn('Daily report related data unavailable',e);
  }
}

function renderActivities(rows){
  if(WORKSPACE_APP==='eos'&&!isPageActive('activities'))return;
  updateMissingCodeButton();
  document.getElementById('act-count').textContent=rows.length.toLocaleString();
  renderDailyReportSummary(rows);
  const tbody=document.getElementById('act-body');
  if(WORKSPACE_APP==='eos'&&!eosRawLogsEnabled){tbody.replaceChildren();return;}
  const panel=document.getElementById('activity-log-panel');
  if(panel&&panel.classList.contains('collapsed')){
    tbody.innerHTML='';
    return;
  }
  if(!rows.length){tbody.innerHTML=`<tr><td colspan="19"><div class="empty-state"><div class="big">📭</div>No records</div></td></tr>`;return;}
  tbody.innerHTML=rows.map(r=>`
    <tr data-id="${r.id}">
      <td contenteditable="true" data-col="date">${esc(r.date)}</td>
      <td contenteditable="true" data-col="hole_num">${esc(r.hole_num)}</td>
      <td contenteditable="true" data-col="program">${esc(r.program||'')}</td>
      <td contenteditable="true" data-col="site_name">${esc(r.site_name)}</td>
      <td contenteditable="true" data-col="time_from">${esc(r.time_from)}</td>
      <td contenteditable="true" data-col="time_to">${esc(r.time_to)}</td>
      <td contenteditable="true" data-col="total_time">${esc(r.total_time)}</td>
      <td contenteditable="true" data-col="bit_type">${esc(r.bit_type)}</td>
      <td contenteditable="true" data-col="diameter">${esc(r.diameter)}</td>
      <td contenteditable="true" data-col="metres_from" data-numeric="true">${fmt(r.metres_from)}</td>
      <td contenteditable="true" data-col="metres_to" data-numeric="true">${fmt(r.metres_to)}</td>
      <td contenteditable="true" data-col="total_metres" data-numeric="true" data-cost-trigger="true">${fmt(r.total_metres)}</td>
      <td contenteditable="true" data-col="code" data-cost-trigger="true" data-missing-code="${String(r.code||'').trim()?'false':'true'}" style="${String(r.code||'').trim()?'':'color:var(--red);font-weight:800;'}">${esc(String(r.code||'').trim()||'Missing_Code')}</td>
      <td contenteditable="true" data-col="notes">${esc(r.notes)}</td>
      <td contenteditable="true" data-col="unit_rate" data-numeric="true" data-cost-trigger="true" style="color:var(--yellow)">${r.unit_rate!=null?r.unit_rate.toFixed(2):''}</td>
      <td contenteditable="true" data-col="quantity" data-numeric="true" data-cost-trigger="true" style="color:var(--yellow)">${r.quantity!=null?r.quantity.toFixed(2):''}</td>
      <td contenteditable="true" data-col="line_cost" data-numeric="true" style="color:var(--accent);font-weight:600">${r.line_cost!=null?r.line_cost.toFixed(2):''}</td>
      <td contenteditable="true" data-col="rate_basis" style="color:var(--muted);font-size:10px">${esc(r.rate_basis||'')}</td>
      <td>${r.contractor==='DEPCO Drilling'?'<button class="btn-secondary" onclick="chooseDepcoCode('+Number(r.id)+')">Contract code</button>':''}${r.source_file?'<button onclick="viewSourcePdf(\''+esc(r.source_file).replace(/'/g,'')+'\')" style="background:transparent;border:1.5px solid var(--accent);color:var(--accent);cursor:pointer;font-size:10px;padding:2px 6px;border-radius:4px;font-family:var(--font);">'+(/\.xlsx$/i.test(r.source_file)?'XLSX':'PDF')+'</button>':''}</td>
    </tr>`).join('');

  function setCellValue(row,col,value){
    const target=row.querySelector('[data-col="'+col+'"]');
    if(!target)return;
    if(target.dataset.numeric)target.textContent=value==null?'':fmt(value);
    else target.textContent=value==null?'':String(value);
  }
  function updateActivityRowCache(id,updates){
    const item=activitiesData.find(function(r){return Number(r.id)===Number(id);});
    if(item)Object.assign(item,updates);
  }
  function optionalNumber(text){
    const raw=String(text||'').trim();
    if(!raw)return null;
    const n=parseFloat(raw);
    return Number.isFinite(n)?n:null;
  }
  async function repriceRenderedActivityRow(row){
    const id=row.dataset.id;
    const res=await fetch(`${API}/activities/${id}/reprice`,{method:'POST'});
    if(!res.ok)throw new Error(await res.text());
    const updated=await res.json();
    ['code','rate_year','unit_rate','quantity','line_cost','rate_basis'].forEach(function(col){setCellValue(row,col,updated[col]);});
    updateActivityRowCache(id,updated);
    renderDailyReportSummary(activitiesData);
    refreshCostingIfActive(150);
    return updated;
  }
  const scheduleRepriceCols=new Set(['date','time_from','time_to','total_time','bit_type','diameter','metres_from','metres_to','total_metres','code','notes']);

  tbody.querySelectorAll('[contenteditable]').forEach(cell=>{
    cell.addEventListener('focus',()=>{
      if(cell.dataset.col==='code'&&cell.dataset.missingCode==='true'&&cell.textContent.trim()==='Missing_Code'){
        cell.textContent='';
      }
    });
    cell.addEventListener('blur',async()=>{
      const row=cell.closest('tr');const id=row.dataset.id;const col=cell.dataset.col;
      let val=cell.textContent.trim();
      if(col==='code'&&cell.dataset.missingCode==='true'&&val==='Missing_Code')val='';
      if(cell.dataset.numeric)val=val===''?null:parseFloat(val);
      if(col==='unit_rate'||col==='quantity'){
        const ur=parseFloat(row.querySelector('[data-col="unit_rate"]').textContent)||0;
        const qty=parseFloat(row.querySelector('[data-col="quantity"]').textContent)||0;
        const lc=row.querySelector('[data-col="line_cost"]');
        if(ur>0&&qty>0){const nc=(ur*qty).toFixed(2);lc.textContent=nc;
          await fetch(`${API}/activities/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({line_cost:parseFloat(nc)})}).catch(()=>{});}
      }
      try{
        await fetch(`${API}/activities/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({[col]:val})});
        updateActivityRowCache(id,{[col]:val});
        if(scheduleRepriceCols.has(col)||(col==='quantity'&&activitiesData.find(r=>Number(r.id)===Number(id))?.contractor==='DEPCO Drilling')){
          await repriceRenderedActivityRow(row);
        }else if(col==='unit_rate'||col==='quantity'||col==='line_cost'){
          updateActivityRowCache(id,{
            unit_rate:optionalNumber(row.querySelector('[data-col="unit_rate"]').textContent),
            quantity:optionalNumber(row.querySelector('[data-col="quantity"]').textContent),
            line_cost:optionalNumber(row.querySelector('[data-col="line_cost"]').textContent)
          });
          renderDailyReportSummary(activitiesData);
        }
        toast('✓ Saved');
        refreshCostingIfActive();
      }catch(e){toast('Save failed','err');}
    });
    cell.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();const cells=[...cell.closest('tr').querySelectorAll('[contenteditable]')];const nx=cells[cells.indexOf(cell)+1];if(nx)nx.focus();}
    });
  });
  makeTableSortable('act-table');
}

function renderDailyReportSummary(rows){
  const allRows=rows||[];
  const isMccEarthworks=activeContractor==='MCC Group';
  const reportTable=document.getElementById('report-table');
  if(reportTable)reportTable.classList.toggle('mcc-earthworks',isMccEarthworks);
  const reportRows=activeContractor==='MCC Group'&&activeProgram
    ?allRows.filter(mccReportRowMatchesProgram)
    :allRows;
  renderMccWeeklyReports(reportRows);
  const dailyRows=activeContractor==='MCC Group'
    ?reportRows.filter(function(row){return !isMccWeeklyReportRow(row);})
    :reportRows;
  dailyReportsData=sortDailyReportData(groupDailyReports(dailyRows));
  const totalCost=dailyReportsData.reduce(function(s,r){return s+r.cost;},0);
  const totalMetres=dailyReportsData.reduce(function(s,r){return s+r.metres;},0);
  const totalHours=dailyReportsData.reduce(function(s,r){return s+r.hours;},0);
  const reviewCount=dailyReportsData.filter(function(r){return r.flags.length;}).length;
  const setText=function(id,value){const el=document.getElementById(id);if(el)el.textContent=value;};
  setText('report-register-title',activeContractor==='MCC Group'?'MCC '+(activeProgram||'All Workstreams')+' Daily Site Services Reports':(activeContractor||'')+' Daily Reports — '+(activeProjectName||'All projects')+' / '+(activeProgram||'All programs'));
  setText('report-total',dailyReportsData.length.toLocaleString());
  setText('report-count',dailyReportsData.length.toLocaleString());
  setText('report-cost',cur(totalCost));
  setText('report-metres',totalMetres.toFixed(1));
  setText('report-hours',totalHours.toFixed(1));
  setText('report-review',reviewCount.toLocaleString());
  const tbody=document.getElementById('report-body');
  if(!tbody)return;
  if(!dailyReportsData.length){
    tbody.innerHTML='<tr><td colspan="'+(isMccEarthworks?11:15)+'"><div class="empty-state"><div class="big">No reports</div></div></td></tr>';
    updateBulkReportSelection();
    closeDailyReportDetail();
    return;
  }
  tbody.innerHTML=dailyReportsData.map(function(r){
    const note=r.notes.join(' ').slice(0,180);
    return '<tr class="report-row '+(r.key===selectedDailyReportKey?'active':'')+'" data-report-key="'+attr(r.key)+'" data-search="'+attr((r.id+' '+r.date+' '+r.hole+' '+r.project+' '+r.rig+' '+r.driller+' '+note).toLowerCase())+'">'
      +'<td class="select-cell"><input class="row-check" type="checkbox" onchange="updateBulkReportSelection()"/></td>'
      +'<td><div class="plod-cell"><button class="plod-link" type="button" onclick="openDailyReportDetailByKey(this.closest(\'tr\').dataset.reportKey)">'+esc(r.id)+'</button>'+(r.sourceFile?'<span class="attach-icon">↗</span>':'')+'</div></td>'
      +'<td>'+renderReportStatusSelect(r)+'</td>'
      +'<td>'+renderReportLockStatus(r)+'</td>'
      +'<td>'+esc(r.date)+'</td>'
      +'<td>'+(r.shift?'<span class="shift-pill">'+esc(r.shift)+'</span>':'')+'</td>'
      +'<td class="mcc-drilling-only">'+esc(r.rig||'--')+'</td>'
      +'<td>'+esc(r.hole||'--')+'</td>'
      +'<td>'+esc(r.project||'Unassigned')+'</td>'
      +'<td class="mcc-drilling-only">'+esc(r.driller||'--')+'</td>'
      +'<td class="mcc-drilling-only">'+r.metres.toFixed(2)+'</td>'
      +'<td>'+r.hours.toFixed(2)+'</td>'
      +'<td class="mcc-drilling-only" style="font-weight:700;color:var(--text);">'+(r.unpriced===r.rows.length?'Pricing pending':cur(r.cost))+(r.unpriced?'<div style="color:var(--muted);font-size:11px;">'+r.unpriced+' lines need pricing review</div>':'')+'</td>'
      +'<td><span class="notes-preview">'+esc(note||'--')+'</span></td>'
      +'<td><button class="row-actions" type="button" onclick="openDailyReportDetailByKey(this.closest(\'tr\').dataset.reportKey)">...</button></td>'
      +'</tr>';
  }).join('');
  syncDailyReportSortHeaders();
  filterDailyReportRows();
  updateBulkReportSelection();
  if(selectedDailyReportKey&&!dailyReportsData.find(function(r){return r.key===selectedDailyReportKey;}))closeDailyReportDetail();
  if(isPageActive('reports'))renderPeriodReport();
}

async function ensureReportBoreholes(force){
  if(bhData&&bhData.length&&!force)return bhData;
  try{return await loadBoreholes(!!force);}catch(e){console.warn('Borehole planning data unavailable for period report',e);return bhData;}
}

function numVal(value){
  const n=parseFloat(value);
  return Number.isFinite(n)?n:0;
}

function reportIso(value){
  return isoFromReportDate(value);
}

function rowHole(row){
  return String(row.hole_num||row.hole_id||'').trim();
}

function reportIdentity(value){
  return String(value||'').trim().toUpperCase().replace(/\s+/g,'');
}

function boreholeMatchValues(borehole){
  const aliases=[];
  if(borehole&&Array.isArray(borehole.activity_hole_ids))aliases.push.apply(aliases,borehole.activity_hole_ids);
  aliases.push(borehole&&borehole.hole_id,borehole&&borehole.hole_num,borehole&&borehole.site_id);
  return new Set(aliases.map(reportIdentity).filter(Boolean));
}

function boreholeHasOperatingId(borehole){
  const holeId=reportIdentity(borehole&&borehole.hole_id);
  const siteId=reportIdentity(borehole&&borehole.site_id);
  return !!(holeId&&(!siteId||holeId!==siteId));
}

function preferredBorehole(current,candidate){
  if(!current)return candidate;
  if(boreholeHasOperatingId(candidate)&&!boreholeHasOperatingId(current))return candidate;
  return current;
}

function rowMatchesBorehole(row,borehole){
  if(row.project&&borehole.project&&!projectNamesMatch(row.project,borehole.project))return false;
  const aliases=boreholeMatchValues(borehole);
  return aliases.has(reportIdentity(rowHole(row)))||aliases.has(reportIdentity(row&&row.site_name));
}

function holeLookup(){
  const map=new Map();
  (bhData||[]).forEach(function(b){
    const aliases=[];
    if(Array.isArray(b&&b.activity_hole_ids))aliases.push.apply(aliases,b.activity_hole_ids);
    aliases.push(b&&b.hole_id,b&&b.hole_num,b&&b.site_id);
    aliases.forEach(function(value){
      const raw=String(value||'').trim();
      [raw,reportIdentity(raw)].filter(Boolean).forEach(function(identity){
        map.set(identity,preferredBorehole(map.get(identity),b));
      });
    });
  });
  return map;
}

function rowIsDrillerEarthworksSupport(row){
  const code=String(row.code||row.activity_code||'').trim().toLowerCase();
  const text=[row.notes,row.rate_basis,row.bit_type,row.diameter].join(' ').toLowerCase();
  if(code){
    return /^d[\s_-]/.test(code)&&code.match(/water\s*cart|backhoe|loader|excavat|earthworks|earth works/);
  }
  return text.match(/water\s*cart|backhoe|loader|excavat/);
}

function activityMethod(row,bh){
  if(rowIsDrillerEarthworksSupport(row))return 'Drilling provider earthworks';
  const text=[row.bit_type,row.code,row.activity_code,row.notes,bh&&bh.bh_type,bh&&bh.type,bh&&bh.bit_type].join(' ').toLowerCase();
  if(text.match(/\bpcd\b|chip|rc|open hole/))return 'Chipped / RC';
  if(text.match(/core|coring|hq|nq|pq|dd/))return 'Core';
  return bh&&(bh.bh_type||bh.type)||'Other';
}

function rowIsStandby(row){
  return activityCategory(row)==='Standby / Delays'||String(row.code||row.activity_code||'').toLowerCase().includes('standby');
}

function rowIsExtra(row){
  const text=[row.code,row.activity_code,row.notes].join(' ').toLowerCase();
  return rowIsStandby(row)||text.match(/mobil|travel|delay|wait|fatigue|breakdown|repair|extra|non[- ]?drilling/);
}
function rowIsMitchellsDrillingCost(row){
  const code=String(row.code||row.activity_code||'');
  return code.indexOf('Drill_')===0||['H_Min_Shift','H_Casing_Install','H_Circulation_Flush','H_Circulation_Lost','H_Reaming','H_Rig_Cementing','H_Surface_Setup','H_Tripping_Rods'].includes(code);
}

function normalizeProjectName(value){
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function projectNamesMatch(left,right){
  const a=normalizeProjectName(left),b=normalizeProjectName(right);
  if(!a||!b)return false;
  return a===b;
}

function rowMatchesPeriodProject(row,holes,project){
  if(!project)return true;
  // An explicit project assignment takes precedence over a matching hole alias.
  if(String(row.project||'').trim())return projectNamesMatch(row.project,project);
  const bh=holes.get(rowHole(row));
  if(projectNamesMatch((bh&&bh.project)||'',project))return true;
  if(projectNamesMatch(row.project,project))return true;
  const text=[row.project,row.site_name,row.hole_num,row.source_file,row.notes].join(' ').toLowerCase();
  return project.toLowerCase()==='ironbark'&&text.includes('ironbark');
}

function boreholeIsComplete(b){
  return String((b&&b.status)||'').trim().toLowerCase().indexOf('complete')===0;
}

function boreholeIsInProgress(b){
  return String((b&&b.status)||'').trim().toLowerCase()==='in progress';
}

function uniqueBoreholesById(rows){
  const byId=new Map();
  (rows||[]).forEach(function(b){
    const id=String((b&&b.hole_id)||'').trim();
    if(id&&!byId.has(id))byId.set(id,b);
  });
  return Array.from(byId.values());
}

function periodPlannedBoreholes(rows){
  const holes=uniqueBoreholesById(rows);
  const hasNamedHole=holes.some(function(b){
    const id=String((b&&b.hole_id)||'').trim();
    const site=String((b&&b.site_id)||'').trim();
    return id&&(!site||id!==site);
  });
  if(!hasNamedHole)return holes;
  return holes.filter(function(b){
    const id=String((b&&b.hole_id)||'').trim();
    const site=String((b&&b.site_id)||'').trim();
    const status=String((b&&b.status)||'').trim().toLowerCase();
    return !(id&&site&&id===site&&status==='planned');
  });
}

function periodRelevantProjectHoles(projectHoles,activeHoles){
  // Status KPIs are the current approved Borehole Planning status set.  They
  // must not vary merely because a completion report falls outside the selected
  // financial/reporting period.
  return uniqueBoreholesById(projectHoles||[]);
}

function periodHoleStatusSummary(reportHoles,period,allRows){
  const completed=[];
  const inProgress=[];
  const excluded=[];
  (reportHoles||[]).forEach(function(b){
    if(boreholeIsComplete(b))completed.push(b);
    else if(boreholeIsInProgress(b))inProgress.push(b);
    else excluded.push(b);
  });
  return {completed:completed,inProgress:inProgress,excluded:excluded};
}

function buildPeriodProjectOptions(){
  const sel=document.getElementById('period-project-select');
  if(!sel)return;
  const current=sel.value;
  const names=Array.from(new Set((bhData||[]).map(function(b){return b.project||'';}).filter(Boolean))).sort();
  (projectBudgetsData||[]).forEach(function(r){
    if(r.project&&(!activeProgram||!r.program||r.program===activeProgram)&&!names.includes(r.project))names.push(r.project);
  });
  names.sort();
  sel.innerHTML='<option value="">All Projects</option>'+names.map(function(name){
    return '<option value="'+attr(name)+'">'+esc(name)+'</option>';
  }).join('');
  if(names.includes(current))sel.value=current;
}

function selectedPeriod(){
  let from=document.getElementById('period-range-from')?.value||'';
  let to=document.getElementById('period-range-to')?.value||'';
  const source=(periodReportActivitiesData&&periodReportActivitiesData.length)?periodReportActivitiesData:activitiesData;
  const dates=(source||[]).map(function(r){return reportIso(r.date);}).filter(Boolean).sort();
  const reportYear=String(activeProjectYear());
  const projectYearDates=dates.filter(function(date){return date.startsWith(reportYear+'-');});
  const fromEl=document.getElementById('period-range-from');
  const toEl=document.getElementById('period-range-to');
  if(!from){from=projectYearDates[0]||reportYear+'-01-01';if(fromEl)fromEl.value=from;}
  if(!to){to=projectYearDates[projectYearDates.length-1]||reportYear+'-12-31';if(toEl)toEl.value=to;}
  return {from:from,to:to,project:activeProjectName||''};
}

async function loadReportsPage(preserveRange){
  const shell=document.getElementById('period-report-meta');
  if(shell)shell.textContent='Loading report data...';
  if(!preserveRange){
    const from=document.getElementById('period-range-from');
    const to=document.getElementById('period-range-to');
    if(from)from.value='';
    if(to)to.value='';
  }
  try{
    const drillingContractor=reportDrillingContractor();
    const reportYear=activeProjectYear();
    const splitIronbark=activeProgram==='Exploration'&&projectNamesMatch(activeProjectName,'Ironbark');
    const reportContractors=splitIronbark?['Mitchells Drilling','DEPCO Drilling']:[drillingContractor];
    const stamp=Date.now();
    const fetchDrillingBundle=async function(contractor){
      const response=await fetch(API+'/activity-report-data?contractor='+encodeURIComponent(contractor)+'&_='+stamp,{cache:'no-store'});
      if(!response.ok)throw new Error('Could not load '+contractor+' drilling records');
      return response.json();
    };
    const combinedDrillingBundles=Promise.all(reportContractors.map(fetchDrillingBundle)).then(function(bundles){
      return ['activities','consumables','crew','report_approvals','activity_sheet_locks'].reduce(function(out,key){
        out[key]=bundles.flatMap(function(b){return Array.isArray(b[key])?b[key]:[];});
        return out;
      },{});
    });
    const results=await Promise.all([
      combinedDrillingBundles,
      loadPeriodSupportInvoices(),
      fetch(API+'/project-budgets?contractor=Company&_='+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.json():[];}),
      fetch(API+'/project-budget-source?project='+encodeURIComponent(activeProjectName||'')+'&year='+encodeURIComponent(reportYear)+'&_='+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch(API+'/exploration-metres-summary?year='+encodeURIComponent(reportYear)+'&_='+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch(API+'/activities?contractor='+encodeURIComponent('MCC Group')+'&_='+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.json():[];}).catch(function(){return [];})
    ]);
    applyActivityReportBundle(results[0]);
    periodReportActivitiesData=activitiesData;
    periodReportConsumablesData=consumablesData;
    activitiesData=periodReportActivitiesData;
    consumablesData=periodReportConsumablesData;
    periodSupportInvoicesData=results[1]||[];
    projectBudgetsData=results[2]||[];
    periodSourceBudgetData=results[3]||null;
    explorationMetresSummaryData=results[4]||null;
    periodMccActivitiesData=Array.isArray(results[5])?results[5]:[];
    // A previous page may have loaded an older site-ID-only plan. Reloading
    // keeps this report aligned with the current operational-hole mapping.
    await ensureReportBoreholes(true);
    periodSupportInvoicesData=periodSupportInvoicesData.filter(function(r){return !r.project||rowMatchesActiveProgram(r);});
    renderPeriodReport();
  }catch(e){
    if(shell)shell.textContent='Report data could not be loaded.';
    toast('Report load failed: '+(e.message||e),'err');
  }
}

async function loadPeriodSupportInvoices(){
  const contractors=filteredContractors().filter(function(c){return contractorCategory(c)!=='Drilling';});
  const stamp=Date.now();
  const rows=await Promise.all(contractors.map(function(c){
    // Project names on imported invoices are not always exact (for example,
    // "Ironbark Mine" versus "Ironbark"). Fetch by contractor and apply the
    // same normalized project matching used everywhere else in the report.
    return fetch(API+'/invoices?contractor='+encodeURIComponent(c.name)+'&_='+stamp,{cache:'no-store'}).then(function(r){return r.ok?r.json():[];}).catch(function(){return [];});
  }));
  const originalInvoices=rows.flat().filter(function(r){
    return !activeProjectName||projectNamesMatch(r.project,activeProjectName);
  }).map(function(r){
    const c=contractorByName(r.contractor);
    return Object.assign({},r,{contractor_category:contractorCategory(c)});
  });
  // The accounting register records posting status, unlike the normal
  // invoice table whose Paid/Unpaid value describes settlement only.
  if(!(activeProgram==='Exploration'&&projectNamesMatch(activeProjectName,'Ironbark')))return originalInvoices;
  const ledgerResponse=await fetch(API+'/ironbark-posted-invoices?year='+encodeURIComponent(activeProjectYear())+'&_='+stamp,{cache:'no-store'});
  if(!ledgerResponse.ok)throw new Error('Ironbark posted invoice ledger unavailable');
  const postedLedger=await ledgerResponse.json();
  if(!Array.isArray(postedLedger))throw new Error('Invalid Ironbark posted ledger response');
  const overridden=new Set(postedLedger.map(function(row){return contractorSummaryKey(row.contractor);}));
  // Logging invoice history is retained alongside the separately sourced
  // Weatherford posted PO line. Remove only exact invoice/PO duplicates,
  // not every Epiroc invoice merely because one Weatherford line exists.
  const postedKeys=new Set(postedLedger.map(function(row){
    return String(row.invoice_number||'').trim().toUpperCase()+'|'+String(row.po_reference||'').trim().toUpperCase();
  }));
  return originalInvoices.filter(function(row){
    const key=contractorSummaryKey(row.contractor);
    if(key==='epiroc'){
      const id=String(row.invoice_number||'').trim().toUpperCase()+'|'+String(row.po_reference||'').trim().toUpperCase();
      return !postedKeys.has(id);
    }
    return !overridden.has(key);
  }).concat(postedLedger);
}

function periodFilteredRows(){
  const period=selectedPeriod();
  const holes=holeLookup();
  const source=(periodReportActivitiesData&&periodReportActivitiesData.length)?periodReportActivitiesData:activitiesData;
  return (source||[]).filter(function(r){
    const iso=reportIso(r.date);
    if(period.from&&(!iso||iso<period.from))return false;
    if(period.to&&(!iso||iso>period.to))return false;
    if(!period.project&&!rowMatchesActiveProgram(r))return false;
    if(!rowMatchesPeriodProject(r,holes,period.project))return false;
    if(activeProgram==='Exploration'&&projectNamesMatch(period.project,'Ironbark')&&String(r.program||'').split(',').map(p=>p.trim()).indexOf('Exploration')<0)return false;
    return true;
  });
}

function periodFilteredConsumables(){
  const period=selectedPeriod();
  const holes=holeLookup();
  const activities=(periodReportActivitiesData&&periodReportActivitiesData.length)?periodReportActivitiesData:activitiesData;
  const source=(periodReportConsumablesData&&periodReportConsumablesData.length)?periodReportConsumablesData:consumablesData;
  return (source||[]).filter(function(r){
    const iso=reportIso(r.date);
    if(period.from&&(!iso||iso<period.from))return false;
    if(period.to&&(!iso||iso>period.to))return false;
    if(!period.project&&!rowMatchesActiveProgram(r))return false;
    // Consumables have no project column. Respect the project on their source
    // report before falling back to hole identity for older source-less rows.
    const related=r.source_file?(activities||[]).filter(a=>a.source_file===r.source_file&&a.contractor===r.contractor):[];
    if(period.project&&related.length&&related.every(a=>String(a.project||'').trim())&&!related.some(a=>projectNamesMatch(a.project,period.project)))return false;
    if(!rowMatchesPeriodProject(r,holes,period.project))return false;
    if(activeProgram==='Exploration'&&projectNamesMatch(period.project,'Ironbark')){
      const relatedPrograms=related.map(a=>String(a.program||'').split(',').map(p=>p.trim()));
      if(relatedPrograms.length&&!relatedPrograms.some(p=>p.includes('Exploration')))return false;
    }
    return true;
  });
}

function invoiceReportIso(inv){
  const iso=isoFromReportDate(inv.invoice_date||'');
  if(iso)return iso;
  const m=String(inv.billing_month||'').match(/^(\d{1,2})\/(\d{4})$/);
  return m?m[2]+'-'+String(m[1]).padStart(2,'0')+'-01':'';
}

function invoiceMatchesPeriod(inv,period){
  const iso=invoiceReportIso(inv);
  if(iso){
    if(period.from&&iso<period.from)return false;
    if(period.to&&iso>period.to)return false;
  }
  if(period.project&&!projectNamesMatch(inv.project,period.project))return false;
  return true;
}

function supportSectionForInvoice(inv){
  const cat=String(inv.contractor_category||'').toLowerCase();
  const text=[inv.contractor,inv.project,inv.notes,inv.source_file,inv.po_reference,inv.invoice_number].join(' ').toLowerCase();
  const supplier=contractorSummaryKey(inv.contractor);
  if(supplier==='epiroc')return 'Downhole Geophysical Logging';
  if(supplier==='fortem')return 'Geological Support & Project Management';
  if(cat==='drilling')return 'Drilling';
  if(supplier==='mccgroup')return 'Earthworks';
  if(cat==='earthworks'||text.match(/earth|civil|dozer|excavat|grader|pad|track|king|konstruct|chms/))return 'Earthworks';
  if(cat==='lab testing'||text.match(/geogas|sigra|gas|geochem|lab test|assay|stantec|stantect/))return 'Lab Testing';
  if(/geophys|wireline|logging|weatherford|epiroc/.test(text))return 'Downhole Geophysical Logging';
  if(cat==='geological support'||/geolog|project management/.test(text))return 'Geological Support & Project Management';
  if(cat==='labour'||text.match(/mcc|labour|labor|support/))return 'Support';
  return 'MISC';
}

function periodFilteredSupportInvoices(){
  const period=selectedPeriod();
  return (periodSupportInvoicesData||[]).filter(function(inv){return invoiceMatchesPeriod(inv,period);});
}

function periodFilteredMccCharges(){
  const period=selectedPeriod();
  return (periodMccActivitiesData||[]).filter(function(row){
    const iso=reportIso(row.date);
    if(row.is_cost_source===false||String(row.is_cost_source).toLowerCase()==='false')return false;
    if(period.from&&(!iso||iso<period.from))return false;
    if(period.to&&(!iso||iso>period.to))return false;
    if(period.project&&row.project&&!projectNamesMatch(row.project,period.project))return false;
    if(activeProgram&&row.program&&!String(row.program).split(',').map(function(value){return value.trim();}).includes(activeProgram))return false;
    return true;
  });
}

function isPostedOnlySupplier(name){return ['mccgroup','geogas','stantec','impactenvironmental','fortem'].includes(contractorSummaryKey(name));}
function approvedInvoiceForReport(invoice){
  // Payment status is not an expense approval status. The workbook-backed
  // suppliers use explicit posting evidence; Epiroc legacy invoices remain
  // recorded as invoiced amounts, without interpreting Paid/Unpaid.
  return !isPostedOnlySupplier(invoice.contractor) || String(invoice.posting_status||invoice.postingStatus||'').trim().toLowerCase()==='posted';
}
function reportPostedSupportInvoices(invoices){return (invoices||[]).filter(approvedInvoiceForReport);}
function periodMccChargeSummary(invoices){
  const weeklyRows=periodFilteredMccCharges();
  const weeklyTotal=weeklyRows.reduce(function(sum,row){return sum+numVal(row.line_cost);},0);
  const mccInvoices=reportPostedSupportInvoices(invoices).filter(function(invoice){return contractorSummaryKey(invoice.contractor)==='mccgroup';});
  const invoiceTotal=mccInvoices.reduce(function(sum,invoice){return sum+numVal(invoice.total_aud);},0);
  // Invoices override EOS completely; no automatic unbilled estimate.
  return {weeklyTotal:weeklyTotal,invoiceTotal:invoiceTotal,unbilled:0,actual:invoiceTotal,rowCount:weeklyRows.length,invoicesOverride:true,postedInvoiceCount:mccInvoices.length};
}

function periodFilteredBudgetRows(period){
  return (projectBudgetsData||[]).filter(function(r){
    if(activeProgram&&r.program&&r.program!==activeProgram)return false;
    if(period.project&&!projectNamesMatch(r.project,period.project))return false;
    if(!period.project&&!budgetMatchesActiveProgram(r))return false;
    return true;
  });
}

function sourceBudgetSection(key){
  if(key==='mitchells')return 'Drilling';
  if(key==='mcc')return 'Earthworks';
  if(key==='geophysics')return 'Downhole Geophysical Logging';
  if(key==='fortem')return 'Geological Support & Project Management';
  if(['gas_testing','stantec','fi_testing','spon_com','coal_quality'].includes(key))return 'Lab Testing';
  return 'MISC';
}

function periodSourceBudgetRows(period,metrics){
  const source=periodSourceBudgetData||{};
  const sourceProject=String(source.project||'').trim();
  const definitions=Array.isArray(source.contractors)?source.contractors:[];
  const sourceHoles=Array.isArray(source.holes)?source.holes:[];
  if(!sourceProject||!definitions.length||!sourceHoles.length)return [];
  if(period.project&&!projectNamesMatch(period.project,sourceProject))return [];
  const relevant=(metrics||[]).filter(function(metric){
    return projectNamesMatch(metric.borehole&&metric.borehole.project,sourceProject);
  });
  if(!relevant.length)return [];
  const sourceStatuses=new Map((Array.isArray(source.boreholes)?source.boreholes:[]).map(function(row){return [String(row&&row.hole_id||''),String(row&&row.source_status||'').toLowerCase()];}));
  const byId=new Map(sourceHoles.map(function(row){return [String(row&&row[1]||''),row];}));
  const byOrder=new Map();
  sourceHoles.forEach(function(row){
    const order=Number(row&&row[0]);
    const current=byOrder.get(order);
    const incomingCancelled=['cancelled','abandoned'].includes(sourceStatuses.get(String(row&&row[1]||'')));
    const currentCancelled=current?['cancelled','abandoned'].includes(sourceStatuses.get(String(current[1]||''))):true;
    if(!current||(currentCancelled&&!incomingCancelled))byOrder.set(order,row);
  });
  const totals=definitions.map(function(){return 0;});
  relevant.forEach(function(metric){
    const order=Number(metric.borehole&&metric.borehole.drill_order);
    const sourceRow=byId.get(String(metric.borehole&&metric.borehole.hole_id||''))||byOrder.get(order);
    definitions.forEach(function(definition,index){
      const sourceAmount=sourceRow?numVal(sourceRow[3+index]):0;
      const amount=definition.key==='mitchells'
        ? (numVal(metric.drillingBudget)||sourceAmount)
        : sourceAmount;
      totals[index]+=amount;
    });
  });
  const rows=definitions.map(function(definition,index){
    const amount=Math.round(totals[index]*100)/100;
    if(amount<=0)return null;
    const section=sourceBudgetSection(definition.key);
    return {
      contractor:'Company',
      program:'Exploration',
      project:sourceProject,
      section:section,
      canonical_section:section,
      vendor:definition.name||definition.key,
      budget_amount:amount,
      allocation:'Version 5.4 per-hole source',
      notes:'Source: '+String(source.source||'Version 5.4 workbook'),
      source_budget:true
    };
  }).filter(Boolean);
  const boreholeTotal=relevant.reduce(function(sum,metric){return sum+numVal(metric.budget);},0);
  const mappedTotal=rows.reduce(function(sum,row){return sum+numVal(row.budget_amount);},0);
  const unallocated=Math.round(Math.max(0,boreholeTotal-mappedTotal)*100)/100;
  if(unallocated>0){
    rows.push({
      contractor:'Company',
      program:'Exploration',
      project:sourceProject,
      section:'MISC',
      canonical_section:'MISC',
      vendor:'Unallocated Support',
      budget_amount:unallocated,
      allocation:'Borehole total less mapped Version 5.4 contractor lines',
      notes:'Retains support budget on report holes that do not have a matching Version 5.4 source row.',
      source_budget:true
    });
  }
  return rows;
}

function periodBudgetTotals(period,metrics){
  const projectRows=periodFilteredBudgetRows(period);
  const sourceRows=projectRows.length?[]:periodSourceBudgetRows(period,metrics);
  const rows=projectRows.length?projectRows:sourceRows;
  const bySection={};
  rows.forEach(function(r){
    const section=budgetRowSection(r);
    bySection[section]=(bySection[section]||0)+numVal(r.budget_amount);
  });
  const projectTotal=rows.reduce(function(s,r){return s+numVal(r.budget_amount);},0);
  const drillingFromRows=bySection.Drilling||0;
  const boreholeDrilling=(metrics||[]).reduce(function(s,r){return s+r.drillingBudget;},0);
  const boreholeTotal=(metrics||[]).reduce(function(s,r){return s+r.budget;},0);
  const drilling=drillingFromRows||boreholeDrilling;
  if(!drillingFromRows&&boreholeDrilling)bySection.Drilling=boreholeDrilling;
  const total=projectRows.length?(projectTotal||boreholeTotal):(boreholeTotal||projectTotal);
  return {
    rows:rows,
    bySection:bySection,
    hasProjectBudget:projectRows.length>0,
    hasSourceBudget:sourceRows.length>0,
    total:total,
    drilling:drilling,
    support:Math.max(0,total-drilling)
  };
}

function periodHoleMetrics(rows,consumables,reportHoles,holes){
  return reportHoles.map(function(b){
    const id=String(b.hole_id||b.hole_num||'').trim();
    const hr=rows.filter(function(r){return rowMatchesBorehole(r,b);});
    const drillingRows=hr.filter(function(r){return !rowIsDrillerEarthworksSupport(r);});
    const hc=consumables.filter(function(r){return rowMatchesBorehole(r,b);});
    const actualMetres=hr.reduce(function(s,r){return s+numVal(r.total_metres);},0);
    const drillHours=hr.filter(function(r){return numVal(r.total_metres)>0;}).reduce(function(s,r){return s+parseDurationHours(r.total_time);},0);
    const drillingCharged=drillingRows.reduce(function(s,r){return s+numVal(r.line_cost);},0)+hc.reduce(function(s,r){return s+numVal(r.line_cost);},0);
    const charged=drillingCharged;
    const budget=numVal(b.budget_total);
    const drillingBudget=numVal(b.drilling_budget_total);
    const plannedMetres=numVal(b.eoh_depth)||numVal(b.chip_depth)||numVal(b.total_core);
    const variance=drillingBudget-drillingCharged;
    const dates=hr.map(function(r){return reportIso(r.date);}).filter(Boolean).sort();
    return {
      id:id,
      borehole:b,
      rows:hr,
      actualMetres:actualMetres,
      drillHours:drillHours,
      charged:charged,
      drillingCharged:drillingCharged,
      budget:budget,
      drillingBudget:drillingBudget,
      plannedMetres:plannedMetres,
      variance:variance,
      costPerMetre:actualMetres>0?drillingCharged/actualMetres:0,
      penetration:drillHours>0?actualMetres/drillHours:0,
      start:dates[0]||'',
      end:dates[dates.length-1]||''
    };
  });
}

function renderPeriodReconciliation(rows,reportHoles,metrics){
  const el=document.getElementById('period-reconciliation');
  if(!el)return;
  const holeRows=(rows||[]).filter(function(row){return !!reportIdentity(rowHole(row));});
  const matched=holeRows.filter(function(row){
    return (reportHoles||[]).some(function(borehole){return rowMatchesBorehole(row,borehole);});
  });
  const unmatched=Math.max(0,holeRows.length-matched.length);
  const linkedHoles=(metrics||[]).filter(function(metric){return (metric.rows||[]).length>0;}).length;
  const state=unmatched?' warn':'';
  const detail=unmatched
    ?unmatched+' hole-coded activity line'+(unmatched===1?' needs':'s need')+' attribution before it is included in a borehole total.'
    :'Every hole-coded activity line is linked to a borehole in this report.';
  el.className='period-reconciliation'+state;
  el.innerHTML='<span class="period-reconciliation-badge">Data check</span>'
    +'<div><strong>'+matched.length+' of '+holeRows.length+' hole-coded activity lines linked</strong>'
    +' <span>Across '+linkedHoles+' report hole'+(linkedHoles===1?'':'s')+'. '+esc(detail)+'</span></div>';
}

function ironbarkDepcoGasRiserCost(period){
  // Include DEPCO's Ironbark Gas Riser costs in financials, but not
  // Exploration drilling metre or hole-completion metrics.
  if(!(activeProgram==='Exploration'&&projectNamesMatch(period.project,'Ironbark')))return {cost:0,rows:0};
  const source=(periodReportActivitiesData&&periodReportActivitiesData.length)?periodReportActivitiesData:activitiesData;
  const matches=(source||[]).filter(function(row){
    if(contractorSummaryKey(row.contractor)!=='depcodrilling')return false;
    if(!projectNamesMatch(row.project,'Ironbark'))return false;
    if(String(row.program||'').trim().toLowerCase()!=='gas riser')return false;
    const day=reportIso(row.date);
    return !!day&&(!period.from||day>=period.from)&&(!period.to||day<=period.to);
  });
  return {cost:matches.reduce(function(sum,row){return sum+numVal(row.line_cost);},0),rows:matches.length};
}

function renderPeriodReport(){
  const shell=document.getElementById('period-report-meta');
  if(!shell)return;
  buildPeriodProjectOptions();
  const period=selectedPeriod();
  const holes=holeLookup();
  const rows=periodFilteredRows();
  const consumables=periodFilteredConsumables();
  const supportInvoices=periodFilteredSupportInvoices();
  const mccChargeSummary=periodMccChargeSummary(supportInvoices);
  const depcoGasRiser=ironbarkDepcoGasRiserCost(period);
  const activeIds=Array.from(new Set(rows.map(rowHole).filter(Boolean))).sort();
  const activeHoles=uniqueBoreholesById(activeIds.map(function(id){return holes.get(id);}).filter(Boolean));
  const projectHoles=periodPlannedBoreholes((bhData||[]).filter(function(b){return !period.project||projectNamesMatch(b.project,period.project);}));
  const allActivitySource=(periodReportActivitiesData&&periodReportActivitiesData.length)?periodReportActivitiesData:activitiesData;
  const allProjectRows=(allActivitySource||[]).filter(function(r){
    if(!period.project&&!rowMatchesActiveProgram(r))return false;
    return rowMatchesPeriodProject(r,holes,period.project);
  });
  const periodCandidates=periodRelevantProjectHoles(projectHoles,activeHoles);
  const holeStatusSummary=periodHoleStatusSummary(periodCandidates,period,allProjectRows);
  const reportHoles=holeStatusSummary.completed.concat(holeStatusSummary.inProgress);
  const drillingReports=groupDailyReports(rows,consumables);
  const groupedConsumableKeys=new Set(drillingReports.map(function(report){return report.key;}));
  const ungroupedConsumableCost=consumables.filter(function(row){
    return !groupedConsumableKeys.has(reportKeyFor(row));
  }).reduce(function(sum,row){return sum+numVal(row.line_cost);},0);
  const totalDrillingCost=drillingReports.reduce(function(sum,report){return sum+report.cost;},0)+ungroupedConsumableCost;
  const drillingByContractor=new Map();
  drillingReports.forEach(function(report){
    const key=contractorSummaryKey(report.contractor);
    drillingByContractor.set(key,(drillingByContractor.get(key)||0)+report.cost);
  });
  consumables.filter(function(row){return !groupedConsumableKeys.has(reportKeyFor(row));}).forEach(function(row){
    const key=contractorSummaryKey(row.contractor);
    drillingByContractor.set(key,(drillingByContractor.get(key)||0)+numVal(row.line_cost));
  });
  renderPeriodDrillingProviders(period,rows,drillingByContractor);
  const totalMetres=rows.reduce(function(s,r){return s+numVal(r.total_metres);},0);
  const metrics=periodHoleMetrics(rows,consumables,reportHoles,holes);
  renderPeriodReconciliation(rows,reportHoles,metrics);
  const budgetTotals=periodBudgetTotals(period,metrics);
  const budgetTotal=budgetTotals.total;
  const drillHours=metrics.reduce(function(s,r){return s+r.drillHours;},0);
  const supportInvoiceCost=reportPostedSupportInvoices(supportInvoices).reduce(function(s,r){return s+numVal(r.total_aud);},0);
  const fortem=periodFortemEstimate(period,supportInvoices);
  const supportCost=supportInvoiceCost+mccChargeSummary.unbilled+fortem.unbilled;
  const totalSpent=totalDrillingCost+supportCost+depcoGasRiser.cost;
  const drillingBudgetTotal=budgetTotals.drilling;
  const variance=budgetTotal-totalSpent;
  const penetration=drillHours>0?totalMetres/drillHours:0;
  let coreMetres=0, chippedMetres=0;
  rows.forEach(function(r){
    const method=activityMethod(r,holes.get(rowHole(r)));
    if(method==='Core')coreMetres+=numVal(r.total_metres);
    else if(method==='Chipped / RC')chippedMetres+=numVal(r.total_metres);
  });
  const extrasCost=rows.filter(rowIsExtra).reduce(function(s,r){return s+numVal(r.line_cost);},0);
  const avgCost=totalMetres>0?totalDrillingCost/totalMetres:0;
  const projectLabel=period.project||'All Projects';
  const programLabel=activeWorkspaceProgramLabel();
  const drillingContractor=reportDrillingContractor();
  const today=new Date().toLocaleDateString('en-AU');
  setPeriodText('period-print-title',projectLabel+' - '+programLabel+' Drilling Report');
  shell.textContent=projectLabel+' | '+programLabel+' | '+drillingContractor+' | '+(period.from||'start')+' to '+(period.to||'end')+' | Prepared '+today;
  setPeriodText('period-print-meta',projectLabel+' | '+programLabel+' | '+drillingContractor+' | '+(period.from||'start')+' to '+(period.to||'end')+' | Prepared '+today);
  setPeriodText('period-holes-completed',holeStatusSummary.completed.length.toLocaleString());
  setPeriodText('period-holes-completed-sub','Current Borehole Planning status');
  setPeriodText('period-holes-in-progress',holeStatusSummary.inProgress.length.toLocaleString());
  setPeriodText('period-holes-in-progress-sub','Current Borehole Planning status');
  setPeriodText('period-budget-total',cur(budgetTotal));
  setPeriodText('period-budget-sub',budgetTotals.hasProjectBudget?'Project budget lines':(budgetTotals.hasSourceBudget?'Version 5.4 per-hole budget':'Borehole budget fallback'));
  const drillingSummaryEl=document.getElementById('period-drilling-summary');
  if(drillingSummaryEl){
    drillingSummaryEl.textContent=cur(totalDrillingCost)+' / '+cur(drillingBudgetTotal);
    drillingSummaryEl.className='value '+(drillingBudgetTotal&&totalDrillingCost>drillingBudgetTotal?'variance-neg':'');
  }
  const drillVariance=drillingBudgetTotal-totalDrillingCost;
  const reportCountLabel=drillingReports.length+' drilling report'+(drillingReports.length===1?'':'s')+(activeProgram==='Exploration'&&projectNamesMatch(period.project,'Ironbark')?' (Mitchells + Depco)':' from '+drillingContractor);
  setPeriodText('period-drilling-sub',reportCountLabel+(drillingBudgetTotal?' / '+cur(Math.abs(drillVariance))+' '+(drillVariance>=0?'under':'over'):' / No drilling budget loaded'));
  setPeriodText('period-support-total',cur(supportCost));
  document.getElementById('period-support-total').previousElementSibling.textContent=fortem.unbilled>0?'Support incl. estimate':'Recorded Support';
  const mccAccrualLabel=mccChargeSummary.unbilled>0?' + '+cur(mccChargeSummary.unbilled)+' unbilled MCC charges':(mccChargeSummary.weeklyTotal>0?' / MCC weekly charges reconciled':'');
  setPeriodText('period-support-sub',supportInvoices.length+' invoice'+(supportInvoices.length===1?'':'s')+mccAccrualLabel+(fortem.unbilled>0?' + '+cur(fortem.unbilled)+' Fortem estimate':'')+' / '+cur(budgetTotals.support)+' budget');
  setPeriodText('period-total-spent',cur(totalSpent));
  const spentEl=document.getElementById('period-total-spent');
  spentEl.previousElementSibling.textContent=fortem.unbilled>0?'Spend incl. estimate':'Recorded Spend';
  spentEl.nextElementSibling.textContent=fortem.unbilled>0?'Includes '+cur(fortem.unbilled)+' estimated Fortem cost':'Drilling + recorded support costs';
  const varianceEl=document.getElementById('period-variance');
  if(varianceEl){
    varianceEl.textContent=cur(Math.abs(variance));
    varianceEl.className='value '+(variance>=0?'variance-pos':'variance-neg');
  }
  setPeriodText('period-variance-sub',variance>=0?'Under total budget':'Over total budget');
  setPeriodText('period-total-metres',totalMetres.toFixed(1)+' m');
  setPeriodText('period-metres-sub','Core '+coreMetres.toFixed(1)+' m | Chip/RC '+chippedMetres.toFixed(1)+' m');
  setPeriodText('period-cost-metre',totalMetres>0?cur(avgCost):'--');
  setPeriodText('period-extra-costs','Standby and extras');
  setPeriodText('period-penetration',penetration>0?penetration.toFixed(2)+' m/h':'--');
  setPeriodText('period-penetration-sub',drillHours>0?drillHours.toFixed(1)+' drill h':'No drilling hours');
  renderExplorationMetresSummary();
  renderPeriodMap(reportHoles);
  renderPeriodHoleGraphics(metrics);
  renderPeriodHoleTable(metrics);
  renderPeriodCostBreakdown(rows,consumables,holes,drillingBudgetTotal,totalDrillingCost);
  renderPeriodSupportInvoices(supportInvoices,budgetTotals,totalDrillingCost,mccChargeSummary,fortem,drillingByContractor,depcoGasRiser);
  renderPeriodStandbyReasons(rows);
  renderPeriodProgress(rows,activeHoles,projectHoles,reportHoles,holeStatusSummary);
}

function setPeriodText(id,value){
  const el=document.getElementById(id);
  if(el)el.textContent=value;
}

function waitForPrintPrep(ms){
  return new Promise(function(resolve){ setTimeout(resolve,ms); });
}

async function preparePeriodMapForPrint(){
  if(typeof document==='undefined')return;
  document.body.classList.add('period-print-prep');
  await waitForPrintPrep(120);
  fitPeriodMapToBounds(true);
  renderPeriodPrintMap();
  await waitForPrintPrep(260);
  fitPeriodMapToBounds(true);
  renderPeriodPrintMap();
  await waitForPrintPrep(260);
}

async function printPeriodReport(){
  renderPeriodReport();
  await waitForPrintPrep(700);
  await preparePeriodMapForPrint();
  window.print();
}

function renderPeriodMap(activeHoles){
  const el=document.getElementById('period-map');
  const empty=document.getElementById('period-map-empty');
  if(!el||typeof L==='undefined')return;
  const mapped=(activeHoles||[]).map(function(b){
    const lat=parseFloat(b.lat),lng=parseFloat(b.lng);
    return Object.assign({},b,{lat:lat,lng:lng});
  }).filter(function(b){return Number.isFinite(b.lat)&&Number.isFinite(b.lng);});
  if(!mapped.length){
    el.style.display='none';
    periodMapPrintHoles=[];
    const printEl=document.getElementById('period-map-print');
    if(printEl)printEl.innerHTML='';
    if(empty)empty.style.display='flex';
    periodMapBounds=null;
    if(periodMap){periodMap.remove();periodMap=null;periodMapMarkers=[];periodMapOverlays=[];}
    return;
  }
  periodMapPrintHoles=mapped;
  el.style.display='block';
  if(empty)empty.style.display='none';
  if(!periodMap){
    const sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri'});
    periodMap=L.map('period-map',{layers:[sat],scrollWheelZoom:false,zoomControl:true});
  }
  periodMapMarkers.forEach(function(m){try{m.remove();}catch(e){}});
  periodMapOverlays.forEach(function(m){try{m.remove();}catch(e){}});
  periodMapMarkers=[];
  periodMapOverlays=[];
  periodMapOverlayAssets(mapped).forEach(function(asset){
    const layer=L.imageOverlay(asset.path,asset.bounds,{opacity:0.86,interactive:false});
    layer.addTo(periodMap);
    periodMapOverlays.push(layer);
  });
  mapped.forEach(function(b){
    const col=getBhColor(b);
    const label=displayHoleId(b)||b.hole_id||b.site_id||'Hole';
    const marker=L.circleMarker([b.lat,b.lng],{radius:7,color:'#fff',weight:1.5,fillColor:col,fillOpacity:0.92});
    marker.bindTooltip(label,{permanent:true,direction:'right',className:'bh-label',offset:[8,0]});
    marker.bindPopup('<b>'+esc(label)+'</b><br>'+esc(b.site_id||'')+'<br>'+esc(b.bh_type||b.type||''));
    marker.addTo(periodMap);
    periodMapMarkers.push(marker);
  });
  periodMapBounds=L.latLngBounds(mapped.map(function(b){return[b.lat,b.lng];}));
  setTimeout(fitPeriodMapToBounds,80);
  setTimeout(renderPeriodPrintMap,140);
}

function renderPeriodPrintMap(){
  const el=document.getElementById('period-map-print');
  if(!el||typeof L==='undefined'||!periodMapBounds||!periodMapBounds.isValid()||!periodMapPrintHoles.length)return;
  const width=Math.max(1,Math.round(el.clientWidth||el.getBoundingClientRect().width||1060));
  const height=Math.max(1,Math.round(el.clientHeight||250));
  const sw0=L.CRS.EPSG3857.latLngToPoint(periodMapBounds.getSouthWest(),0);
  const ne0=L.CRS.EPSG3857.latLngToPoint(periodMapBounds.getNorthEast(),0);
  const spanX=Math.max(0.0001,Math.abs(ne0.x-sw0.x));
  const spanY=Math.max(0.0001,Math.abs(sw0.y-ne0.y));
  const fitScale=Math.min((width-180)/spanX,(height-70)/spanY);
  const zoom=Math.max(1,Math.min(16,Math.floor(Math.log(Math.max(1,fitScale))/Math.log(2))));
  const center=periodMapBounds.getCenter();
  const tileSize=256;
  const centerPoint=L.CRS.EPSG3857.latLngToPoint(center,zoom);
  const origin=L.point(centerPoint.x-width/2,centerPoint.y-height/2);
  const minTileX=Math.floor(origin.x/tileSize);
  const maxTileX=Math.floor((origin.x+width)/tileSize);
  const minTileY=Math.floor(origin.y/tileSize);
  const maxTileY=Math.floor((origin.y+height)/tileSize);
  const maxTile=Math.pow(2,zoom);
  let html='';
  for(let x=minTileX;x<=maxTileX;x++){
    for(let y=minTileY;y<=maxTileY;y++){
      if(y<0||y>=maxTile)continue;
      const wrappedX=((x%maxTile)+maxTile)%maxTile;
      const left=Math.round(x*tileSize-origin.x);
      const top=Math.round(y*tileSize-origin.y);
      html+='<img alt="" src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/'+zoom+'/'+y+'/'+wrappedX+'" style="left:'+left+'px;top:'+top+'px;width:'+tileSize+'px;height:'+tileSize+'px;">';
    }
  }
  periodMapOverlayAssets(periodMapPrintHoles).forEach(function(asset){
    const nw=L.CRS.EPSG3857.latLngToPoint(L.latLng(asset.bounds[1][0],asset.bounds[0][1]),zoom);
    const se=L.CRS.EPSG3857.latLngToPoint(L.latLng(asset.bounds[0][0],asset.bounds[1][1]),zoom);
    const left=nw.x-origin.x;
    const top=nw.y-origin.y;
    const overlayWidth=se.x-nw.x;
    const overlayHeight=se.y-nw.y;
    html+='<img class="print-map-overlay" alt="" src="'+attr(asset.path)+'" style="left:'+left.toFixed(1)+'px;top:'+top.toFixed(1)+'px;width:'+overlayWidth.toFixed(1)+'px;height:'+overlayHeight.toFixed(1)+'px;">';
  });
  periodMapPrintHoles.forEach(function(b){
    const point=L.CRS.EPSG3857.latLngToPoint(L.latLng(b.lat,b.lng),zoom);
    const left=point.x-origin.x;
    const top=point.y-origin.y;
    const label=displayHoleId(b)||b.hole_id||b.site_id||'Hole';
    const col=getBhColor(b);
    html+='<div class="print-map-marker" style="left:'+left.toFixed(1)+'px;top:'+top.toFixed(1)+'px;background:'+attr(col)+'"></div>'
      +'<div class="print-map-label" style="left:'+left.toFixed(1)+'px;top:'+top.toFixed(1)+'px;">'+esc(label)+'</div>';
  });
  html+='<div class="print-map-attribution">Esri</div>';
  el.innerHTML=html;
}

function fitPeriodMapToBounds(printMode){
  if(!periodMap||!periodMapBounds||!periodMapBounds.isValid())return;
  periodMap.invalidateSize({pan:false});
  const sw=periodMapBounds.getSouthWest();
  const ne=periodMapBounds.getNorthEast();
  const latSpan=Math.abs(ne.lat-sw.lat);
  const lngSpan=Math.abs(ne.lng-sw.lng);
  if(latSpan<0.015&&lngSpan<0.015){
    periodMap.setView(periodMapBounds.getCenter(),16,{animate:false});
    return;
  }
  periodMap.fitBounds(periodMapBounds,{
    paddingTopLeft:printMode?[150,54]:[90,48],
    paddingBottomRight:printMode?[150,54]:[180,48],
    maxZoom:16
  });
}

if(typeof window!=='undefined'){
  window.addEventListener('beforeprint',function(){
    if(WORKSPACE_APP==='eos')return;
    if(document&&document.body)document.body.classList.add('period-print-prep');
    fitPeriodMapToBounds(true);
    renderPeriodPrintMap();
    setTimeout(function(){fitPeriodMapToBounds(true);},120);
    setTimeout(function(){fitPeriodMapToBounds(true);renderPeriodPrintMap();},320);
  });
  window.addEventListener('afterprint',function(){
    if(WORKSPACE_APP==='eos')return;
    if(document&&document.body)document.body.classList.remove('period-print-prep');
    setTimeout(function(){fitPeriodMapToBounds(false);},120);
  });
}

function periodMapOverlayAssets(activeHoles){
  const period=selectedPeriod();
  if(period.project)return mapOverlayAssetsForProject(period.project);
  const projects=Array.from(new Set((activeHoles||[]).map(function(b){return b.project||'';}).filter(Boolean)));
  if(projects.length===1)return mapOverlayAssetsForProject(projects[0]);
  if(projects.some(function(p){return String(p).toLowerCase().includes('iron');}))return mapOverlayAssetsForProject('Ironbark');
  return [];
}

function periodHoleNeedsCoding(metric){
  const status=String((metric&&metric.borehole&&metric.borehole.status)||'').trim().toLowerCase();
  if(status.indexOf('complete')!==0)return false;
  return Number(metric.drillingCharged||0)<=0;
}

function renderPeriodHoleTable(metrics){
  const tbody=document.getElementById('period-hole-body');
  if(!tbody)return;
  if(!metrics.length){
    tbody.innerHTML='<tr><td colspan="14"><div class="empty-state">No holes active in the selected period.</div></td></tr>';
    return;
  }
  tbody.innerHTML=metrics.map(function(m){
    const b=m.borehole||{};
    const needsCoding=periodHoleNeedsCoding(m);
    const noMetres=Number(m.actualMetres||0)<=0;
    const noDrillingCost=needsCoding&&Number(m.drillingCharged||0)<=0;
    const noTotalCost=needsCoding&&Number(m.charged||0)<=0;
    const notCoded='<span class="not-coded-text">Not Coded</span>';
    return '<tr>'
      +'<td><b>'+esc(m.id)+'</b></td>'
      +'<td>'+esc(b.purpose||'--')+'</td>'
      +'<td class="num">'+(m.plannedMetres?m.plannedMetres.toFixed(1):'--')+'</td>'
      +'<td class="num">'+m.actualMetres.toFixed(1)+'</td>'
      +'<td class="num">'+cur(m.drillingBudget)+'</td>'
      +'<td class="num">'+(noDrillingCost?notCoded:cur(m.drillingCharged))+'</td>'
      +'<td class="num">'+(noTotalCost?notCoded:cur(m.charged))+'</td>'
      +'<td class="num">'+(needsCoding?notCoded:(m.costPerMetre>0?cur(m.costPerMetre):'--'))+'</td>'
      +'<td class="num">'+(needsCoding?notCoded:(m.penetration>0?m.penetration.toFixed(2)+' m/h':'--'))+'</td>'
      +'<td class="num '+(needsCoding?'not-coded-text':(m.variance>=0?'variance-pos':'variance-neg'))+'">'+(needsCoding?'Not Coded':cur(Math.abs(m.variance)))+'</td>'
      +'<td>'+esc(b.bh_type||b.type||b.bit_type||'--')+'</td>'
      +'<td>'+esc(m.start||'--')+'</td>'
      +'<td>'+esc(m.end||'--')+'</td>'
      +'<td>'+esc(b.status||'Planned')+'</td>'
      +'</tr>';
  }).join('');
}

function renderPeriodHoleGraphics(metrics){
  const el=document.getElementById('period-hole-graphics');
  if(!el)return;
  if(!metrics.length){
    el.innerHTML='<div class="period-visual-card"><div class="empty-state">No hole performance data for this period.</div></div>';
    return;
  }
  const rankedCost=metrics.slice().sort(function(a,b){return b.drillingCharged-a.drillingCharged;}).slice(0,10);
  metrics.forEach(function(m){
    if(periodHoleNeedsCoding(m)&&Number(m.drillingCharged||0)<=0&&!rankedCost.some(function(row){return row.id===m.id;}))rankedCost.push(m);
  });
  const rankedPen=metrics.slice().filter(function(m){return m.penetration>0;}).sort(function(a,b){return b.penetration-a.penetration;}).slice(0,10);
  metrics.forEach(function(m){
    if(periodHoleNeedsCoding(m)&&!rankedPen.some(function(row){return row.id===m.id;}))rankedPen.push(m);
  });
  const maxCost=Math.max(1,...rankedCost.map(function(m){return Math.max(m.drillingCharged,m.drillingBudget);}));
  const maxPen=Math.max(1,...rankedPen.map(function(m){return m.penetration;}));
  const costBars=rankedCost.map(function(m){
    const over=m.drillingBudget>0&&m.drillingCharged>m.drillingBudget;
    const needsCoding=periodHoleNeedsCoding(m);
    const noDrillingCost=needsCoding&&Number(m.drillingCharged||0)<=0;
    const title=noDrillingCost?'Not Coded - completed hole has no matched drilling charge':'Drilling '+cur(m.drillingCharged)+' / Drill budget '+cur(m.drillingBudget);
    const moneyWhole=function(value){return '$'+Math.round(Number(value)||0).toLocaleString('en-AU');};
    const value=noDrillingCost?'Not Coded':moneyWhole(m.drillingCharged)+' / '+moneyWhole(m.drillingBudget);
    const budgetSpend=noDrillingCost?0:(m.drillingBudget>0?Math.min(m.drillingCharged,m.drillingBudget):m.drillingCharged);
    const overSpend=noDrillingCost?0:Math.max(0,m.drillingCharged-m.drillingBudget);
    const budgetWidth=Math.min(100,(budgetSpend/maxCost)*100);
    const overWidth=over?Math.min(100-budgetWidth,(overSpend/maxCost)*100):0;
    const fill=noDrillingCost
      ?'<div class="period-hole-fill not-coded" style="width:0"></div>'
      :'<div class="period-hole-fill cost-budget '+(over?'has-over':'')+'" style="width:'+budgetWidth.toFixed(1)+'%"></div>'
        +(over?'<div class="period-hole-fill cost-over" style="width:'+overWidth.toFixed(1)+'%"></div>':'');
    return '<div class="period-hole-bar">'
      +'<div class="period-hole-label" title="'+attr(m.id)+'">'+esc(m.id)+'</div>'
      +'<div class="period-hole-track" title="'+attr(title)+'">'+fill+'</div>'
      +'<div class="period-hole-value '+(noDrillingCost?'not-coded-text':'')+'">'+value+'</div>'
      +'</div>';
  }).join('');
  const penBars=(rankedPen.length?rankedPen:metrics.slice(0,10)).map(function(m){
    const needsCoding=periodHoleNeedsCoding(m);
    const title=needsCoding?'Not Coded - completed hole has no matched drilling charge':m.actualMetres.toFixed(1)+' m / '+m.drillHours.toFixed(1)+' h';
    const value=needsCoding?'Not Coded':(m.penetration>0?m.penetration.toFixed(2)+' m/h':'--');
    const width=needsCoding?0:Math.min(100,((m.penetration||0)/maxPen)*100);
    return '<div class="period-hole-bar">'
      +'<div class="period-hole-label" title="'+attr(m.id)+'">'+esc(m.id)+'</div>'
      +'<div class="period-hole-track" title="'+attr(title)+'"><div class="period-hole-fill '+(needsCoding?'not-coded':'')+'" style="width:'+width.toFixed(1)+'%"></div></div>'
      +'<div class="period-hole-value '+(needsCoding?'not-coded-text':'')+'">'+value+'</div>'
      +'</div>';
  }).join('');
  el.innerHTML='<div class="period-visual-card"><div class="period-visual-title">Drilling Spend Per Hole (Actual / Budget)</div><div class="period-hole-bars">'+costBars+'</div><div class="period-legend"><span><i style="background:#16a34a"></i>Within drill budget</span><span><i style="background:#dc2626"></i>Over drill budget</span></div></div>'
    +'<div class="period-visual-card"><div class="period-visual-title">Penetration Rate</div><div class="period-hole-bars">'+penBars+'</div><div class="period-legend"><span><i style="background:#315d49"></i>Metres per drilling hour</span></div></div>';
}

function reportActivityCode(row,holes){
  const raw=String(row.code||row.activity_code||'').trim();
  if(raw)return raw;
  const text=[row.notes,row.rate_basis,row.bit_type,row.diameter].join(' ').toLowerCase();
  if(text.match(/water\s*cart|water\s*truck/))return 'D_Water_Cart';
  if(text.match(/backhoe|loader|excavat/))return 'D_Backhoe';
  if(numVal(row.total_metres)>0){
    const method=activityMethod(row,holes.get(rowHole(row)));
    return method==='Chipped / RC'?'Drill_Chip_or_Open_hole':'Drill_Core';
  }
  if(text.match(/standby|wait|delay|fatigue/))return 'H_Standby';
  if(text.match(/travel/))return 'H_Crew_Travel';
  if(text.match(/surface|setup|set up/))return 'H_Surface_Setup';
  if(text.match(/trip|rod/))return 'H_Tripping_Rods';
  if(text.match(/cement/))return 'H_Rig_Cementing';
  if(text.match(/repair|breakdown/))return 'H_Repairs';
  if(text.match(/flush|circulat/))return 'H_Circulation_Flush';
  return 'Missing_Code';
}

function reportCodeGroup(row,code){
  if(code==='Missing_Code')return 'Needs Coding';
  if(rowIsDrillerEarthworksSupport(row))return 'Drilling provider earthworks';
  if(rowIsStandby(row))return 'Standby';
  return 'Chargeable / Other';
}

function periodLineSource(row){
  const source=String(row.source_file||'').split(/[\\/]/).pop();
  return source?source.replace(/\.[^.]+$/,''):'Manual entry';
}

function periodCodePivot(rows){
  const pivot=new Map();
  rows.forEach(function(row){
    const source=periodLineSource(row);
    const key=[row.date||'',source,rowHole(row),row.shift||''].join('|');
    if(!pivot.has(key))pivot.set(key,{date:row.date||'',source:source,hole:rowHole(row)||'--',shift:row.shift||'--',count:0,hours:0,metres:0,value:0});
    const item=pivot.get(key);
    item.count+=1;
    item.hours+=parseDurationHours(row.total_time);
    item.metres+=numVal(row.total_metres);
    item.value+=numVal(row.line_cost);
  });
  return Array.from(pivot.values()).sort(function(a,b){
    return reportDateSortKey(b.date)-reportDateSortKey(a.date)||a.source.localeCompare(b.source)||a.hole.localeCompare(b.hole);
  });
}

function openPeriodCodeDrilldown(code,group){
  const holes=holeLookup();
  const rows=periodFilteredRows().filter(function(row){
    const rowCode=reportActivityCode(row,holes);
    return rowCode===code&&reportCodeGroup(row,rowCode)===group;
  }).sort(function(a,b){
    return reportDateSortKey(b.date)-reportDateSortKey(a.date)||periodLineSource(a).localeCompare(periodLineSource(b))||String(a.time_from||'').localeCompare(String(b.time_from||''));
  });
  if(!rows.length){toast('No source line items found for '+code,'warn');return;}
  const pivot=periodCodePivot(rows);
  const hours=rows.reduce(function(sum,row){return sum+parseDurationHours(row.total_time);},0);
  const metres=rows.reduce(function(sum,row){return sum+numVal(row.total_metres);},0);
  const value=rows.reduce(function(sum,row){return sum+numVal(row.line_cost);},0);
  const period=selectedPeriod();
  const project=period.project||activeProjectName||'All projects';
  setPeriodText('period-code-drilldown-title',code);
  setPeriodText('period-code-drilldown-meta',group+' | '+project+' | '+(period.from||'start')+' to '+(period.to||'end'));
  setPeriodText('period-code-line-count',rows.length.toLocaleString());
  setPeriodText('period-code-hours',hours.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}));
  setPeriodText('period-code-metres',metres.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}));
  setPeriodText('period-code-value',cur(value));
  setPeriodText('period-code-pivot-count',pivot.length+' report / hole combination'+(pivot.length===1?'':'s'));
  document.getElementById('period-code-pivot-body').innerHTML=pivot.map(function(item){
    return '<tr>'
      +'<td>'+esc(item.date||'--')+'</td>'
      +'<td class="source" title="'+attr(item.source)+'">'+esc(item.source)+'</td>'
      +'<td>'+esc(item.hole)+'</td>'
      +'<td>'+esc(item.shift)+'</td>'
      +'<td class="num">'+item.count.toLocaleString()+'</td>'
      +'<td class="num">'+item.hours.toFixed(2)+'</td>'
      +'<td class="num">'+item.metres.toFixed(2)+'</td>'
      +'<td class="num">'+cur(item.value)+'</td>'
      +'</tr>';
  }).join('');
  document.getElementById('period-code-pivot-foot').innerHTML='<tr><td colspan="4">Total</td><td class="num">'+rows.length.toLocaleString()+'</td><td class="num">'+hours.toFixed(2)+'</td><td class="num">'+metres.toFixed(2)+'</td><td class="num">'+cur(value)+'</td></tr>';
  document.getElementById('period-code-line-body').innerHTML=rows.map(function(row){
    const time=[row.time_from,row.time_to].filter(Boolean).join('–')||'--';
    const duration=parseDurationHours(row.total_time);
    const quantity=numberFromAny(row.quantity);
    const unitRate=numberFromAny(row.unit_rate);
    return '<tr>'
      +'<td>'+esc(row.date||'--')+'</td>'
      +'<td class="source" title="'+attr(periodLineSource(row))+'">'+esc(periodLineSource(row))+'</td>'
      +'<td>'+esc(rowHole(row)||'--')+'</td>'
      +'<td>'+esc(row.shift||'--')+'</td>'
      +'<td>'+esc(time)+'</td>'
      +'<td class="num">'+(duration?duration.toFixed(2):'--')+'</td>'
      +'<td class="num">'+(numVal(row.total_metres)?numVal(row.total_metres).toFixed(2):'--')+'</td>'
      +'<td class="num">'+(quantity==null?'--':quantity.toFixed(2))+'</td>'
      +'<td class="num">'+(unitRate==null?'--':cur(unitRate))+'</td>'
      +'<td class="num">'+cur(row.line_cost)+'</td>'
      +'<td class="notes">'+esc(row.notes||'--')+'</td>'
      +'</tr>';
  }).join('');
  document.getElementById('period-code-line-foot').innerHTML='<tr><td colspan="5">Total</td><td class="num">'+hours.toFixed(2)+'</td><td class="num">'+metres.toFixed(2)+'</td><td></td><td></td><td class="num">'+cur(value)+'</td><td></td></tr>';
  const dialog=document.getElementById('period-code-drilldown');
  if(dialog&&!dialog.open)dialog.showModal();
}

function renderPeriodCostBreakdown(rows,consumables,holes,budgetTotal,actualTotal){
  const el=document.getElementById('period-cost-breakdown');
  if(!el)return;
  const codeMap=new Map();
  rows.forEach(function(r){
    const code=reportActivityCode(r,holes);
    const group=reportCodeGroup(r,code);
    const key=group+'|'+code;
    if(!codeMap.has(key))codeMap.set(key,{code:code,group:group,count:0,value:0});
    const item=codeMap.get(key);
    item.count+=1;
    item.value+=numVal(r.line_cost);
  });
  const typeMap=new Map();
  rows.forEach(function(r){
    const method=activityMethod(r,holes.get(rowHole(r)));
    if(!typeMap.has(method))typeMap.set(method,{type:method,metres:0,value:0});
    const item=typeMap.get(method);
    item.metres+=numVal(r.total_metres);
    item.value+=numVal(r.line_cost);
  });
  if(consumables.length){
    typeMap.set('Consumables',{type:'Consumables',metres:0,value:consumables.reduce(function(s,r){return s+numVal(r.line_cost);},0)});
  }
  const codes=Array.from(codeMap.values()).sort(function(a,b){return a.group.localeCompare(b.group)||b.value-a.value;});
  const types=Array.from(typeMap.values()).sort(function(a,b){return b.value-a.value;});
  el.innerHTML='<table class="period-mini-table"><thead><tr><th>Type</th><th>Metres</th><th>Value</th></tr></thead><tbody>'
    +(types.map(function(r){return '<tr><td>'+esc(r.type)+'</td><td class="num">'+(r.metres?r.metres.toFixed(1):'--')+'</td><td class="num">'+cur(r.value)+'</td></tr>';}).join('')||'<tr><td colspan="3">No costs in period.</td></tr>')
    +'</tbody></table>'
    +'<div class="period-section-title">Codes and Recurrences</div>'
    +'<div class="period-table-hint">Select a code to view its pivot summary and every underlying activity line.</div>'
    +'<table class="period-mini-table"><thead><tr><th>Code</th><th>Group</th><th>Occurrences</th><th>Value</th></tr></thead><tbody>'
    +(codes.map(function(r){return '<tr class="period-code-row" tabindex="0" role="button" aria-label="View '+attr(r.code)+' line items" data-code="'+attr(r.code)+'" data-group="'+attr(r.group)+'"><td><span class="period-code-open">'+esc(r.code)+'</span></td><td>'+esc(r.group)+'</td><td class="num">'+r.count+'</td><td class="num">'+cur(r.value)+'</td></tr>';}).join('')||'<tr><td colspan="4">No activity codes in period.</td></tr>')
    +'</tbody></table>';
  el.querySelectorAll('.period-code-row').forEach(function(row){
    row.addEventListener('click',function(){openPeriodCodeDrilldown(row.dataset.code,row.dataset.group);});
    row.addEventListener('keydown',function(event){
      if(event.key==='Enter'||event.key===' '){event.preventDefault();openPeriodCodeDrilldown(row.dataset.code,row.dataset.group);}
    });
  });
}

function contractorSummaryKey(value){
  const raw=String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
  const aliases={
    allianzdrilling:'allianz',
    allianz:'allianz',
    mitchellsdrilling:'mitchells',
    mitchells:'mitchells',
    stantect:'stantec',
    stantec:'stantec',
    geogas:'geogas',
    geochempet:'geochempet',
    fortem:'fortem',
    epirocweatherford:'epiroc',
    weatherfordepiroc:'epiroc',
    weatherfordsepiroc:'epiroc',
    weatherford:'epiroc',
    weatherfords:'epiroc',
    b3:'sponcomtesting',
    sponcom:'sponcomtesting',
    sponcomtesting:'sponcomtesting',
    environmentfscesc:'impactenvironmental',
    impactenvironmental:'impactenvironmental',
    impactenvironmentalptyltd:'impactenvironmental'
  };
  return aliases[raw]||raw||'unassigned';
}

function reportForecastLabel(item){
  const sections=Array.from(item.sections||[]);
  if(sections.includes('Drilling'))return item.label||'Drilling';
  return item.label||sections.join(' / ')||'Unassigned';
}

function reportForecastAssumption(item){
  if(item&&item.forecastAssumption!=null)return item.forecastAssumption;
  const text=(reportForecastLabel(item)+' '+Array.from(item.sections||[]).join(' ')).toLowerCase();
  if(text.includes('drilling'))return 0.60;
  if(text.includes('sigra'))return 1.00;
  if(text.includes('allianz')&&text.includes('earth'))return 0;
  return 0.50;
}

function pct(value){
  return Math.round((Number.isFinite(value)?value:0)*100)+'%';
}

function periodVarianceNoteKey(label){
  const period=selectedPeriod();
  return 'drillops_period_variance_note_'+[activeProgramLabel(),period.project||'All Projects',label].map(function(v){
    return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'_');
  }).join('_');
}

function periodVarianceNote(label){
  try{return localStorage.getItem(periodVarianceNoteKey(label))||'';}catch(e){return '';}
}

function savePeriodVarianceNote(el,label){
  try{localStorage.setItem(periodVarianceNoteKey(label),String(el.textContent||'').trim());}catch(e){}
}

function clearPeriodVarianceNote(button,label){
  try{localStorage.removeItem(periodVarianceNoteKey(label));}catch(e){}
  const cell=button&&button.closest?button.closest('td'):null;
  const note=cell?cell.querySelector('[contenteditable="true"]'):null;
  if(note)note.textContent='';
}

function periodFortemEstimate(period,invoices){
  const scope={...period,client:activeClientId,program:activeProgramLabel()};
  const key=FortemEstimate.storageKey(scope);
  const source=(periodReportActivitiesData&&periodReportActivitiesData.length)?periodReportActivitiesData:activitiesData;
  const projectHoles=(bhData||[]).filter(b=>projectNamesMatch(b.project,period.project));
  const firstHoleStart=(source||[]).filter(row=>rowMatchesActiveProgram(row)&&projectHoles.some(b=>rowMatchesBorehole(row,b)))
    .map(row=>reportIso(row.date)).filter(date=>date&&date.startsWith(String(activeProjectYear())+'-')).sort()[0]||'';
  let settings=FortemEstimate.defaults(period,firstHoleStart);
  let storageWarning='';
  try{
    const saved=JSON.parse(localStorage.getItem(key)||'null');
    if(saved){FortemEstimate.calculate(saved,0);settings={...saved,enabled:saved.enabled===true};}
  }catch(error){storageWarning='Saved settings could not be loaded. Review and apply the estimate again.';}
  const invoiced=(invoices||[]).filter(inv=>contractorSummaryKey(inv.contractor)==='fortem').reduce((sum,inv)=>sum+numVal(inv.total_aud),0);
  return {...FortemEstimate.calculate(settings,invoiced),settings,key,storageWarning,firstHoleStart};
}

function useFortemFirstHoleDates(button){
  const form=button.closest('form');
  const estimate=periodFortemEstimate(selectedPeriod(),[]);
  const defaults=FortemEstimate.defaults(selectedPeriod(),estimate.firstHoleStart);
  form.elements.days.value=defaults.days;
  form.elements.flights.value=defaults.flights;
  form.querySelector('[role="status"]').textContent='Days and flights reset from the first hole. Click Apply estimate to save.';
}

function saveFortemEstimate(event){
  event.preventDefault();
  const form=event.target;
  if(!form.reportValidity())return;
  const settings={enabled:form.elements.enabled.checked};
  for(const field of ['geologist','vehicle','flightRate','days','flights'])settings[field]=Number(form.elements[field].value);
  const feedback=form.querySelector('[role="status"]');
  try{
    FortemEstimate.calculate(settings,0);
    const period=selectedPeriod();
    const key=FortemEstimate.storageKey({...period,client:activeClientId,program:activeProgramLabel()});
    localStorage.setItem(key,JSON.stringify(settings));
    renderPeriodReport();
    toast('Fortem estimate saved for this report in this browser.');
  }catch(error){feedback.textContent='Estimate not saved: '+error.message;}
}

function renderFortemEstimateEditor(fortem){
  if(!selectedPeriod().project)return '';
  const s=fortem.settings;
  const fields=[['geologist','Geologist ($/day)'],['vehicle','Vehicle ($/day)'],['flightRate','Flight ($/flight)'],['days','Chargeable calendar days'],['flights','Number of flights']];
  return '<details class="fortem-estimate-panel" style="margin-bottom:14px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);">'
    +'<summary style="padding:14px;cursor:pointer;font-weight:700;list-style-position:inside;" aria-label="Show or hide Fortem estimated cost">Fortem — estimated cost <span style="font-size:11px;color:var(--muted);font-weight:400;">(show / hide)</span></summary>'
    +'<form onsubmit="saveFortemEstimate(event)" class="fortem-estimate-editor" style="padding:14px;border:1px solid var(--border);border-radius:8px;margin-bottom:14px;">'
    +'<div style="display:flex;flex-wrap:wrap;gap:12px;">'+fields.map(([field,label])=>'<label style="display:grid;gap:4px;font-size:12px;">'+label+'<input name="'+field+'" aria-label="'+label+'" type="number" min="0" max="100000000" step="'+(['days','flights'].includes(field)?'1':'0.01')+'" required value="'+s[field]+'" style="width:150px;padding:7px;border:1px solid var(--border);border-radius:4px;"/></label>').join('')+'</div>'
    +'<p style="font-size:12px;margin:10px 0;">'+(fortem.firstHoleStart?'First hole started '+esc(fortem.firstHoleStart)+'. Defaults count calendar days from that date (or the report start, if later) through the report end, including weekends.':'No dated hole activity found for this project and program year. Enter chargeable days manually.')+' One flight per commenced seven days. Days and flights remain editable. All amounts use the same tax basis as report invoices.</p>'
    +'<button type="button" class="btn-csv" onclick="useFortemFirstHoleDates(this)" style="margin-bottom:10px;">Use first-hole dates</button><br>'
    +'<label style="font-size:12px;"><input type="checkbox" name="enabled" '+(s.enabled?'checked':'')+'/> Include estimated unbilled cost in report totals</label> '
    +'<button type="submit" class="btn-csv">Apply estimate</button>'
    +'<p style="font-size:12px;margin:10px 0 0;"><b>'+(s.enabled?'Applied estimate':'Estimate preview — not included')+': '+cur(fortem.gross)+'</b> = '+s.days+' days × '+cur(s.geologist+s.vehicle)+' + '+s.flights+' flights × '+cur(s.flightRate)+'. Fortem invoices in this period: '+cur(fortem.invoices)+'. Estimated unbilled amount included: '+cur(fortem.unbilled)+'.</p>'
    +'<p style="font-size:12px;margin:6px 0 0;">Invoices already counted in this period reduce the estimate, down to $0. Check that their service dates match this estimate. Saved in this browser for this project, program and date range; changing the report range requires a new estimate.</p>'
    +'<div role="status" style="color:#b45309;">'+esc(fortem.storageWarning)+'</div></form></details>';
}

function renderPeriodDrillingProviders(period,rows,byContractor){
  const el=document.getElementById('period-drilling-providers');
  if(!el)return;
  if(!(activeProgram==='Exploration'&&projectNamesMatch(period.project,'Ironbark'))){el.innerHTML='';return;}
  const providers=[['Mitchells Drilling','mitchells'],['DEPCO Drilling','depcodrilling']];
  const reportCounts=new Map();
  groupDailyReports(rows,[]).forEach(function(r){
    const key=contractorSummaryKey(r.contractor);
    reportCounts.set(key,(reportCounts.get(key)||0)+1);
  });
  const records=providers.map(function(p){
    const value=byContractor.get(p[1])||0;
    return '<tr><td><b>'+esc(p[0])+'</b></td><td class="num">'+(reportCounts.get(p[1])||0)+'</td><td class="num">'+cur(value)+'</td><td>'+((reportCounts.get(p[1])||0)>0?'Activity records loaded':'No Exploration activity recorded')+'</td></tr>';
  }).join('');
  const total=providers.reduce(function(sum,p){return sum+(byContractor.get(p[1])||0);},0);
  el.innerHTML='<div class="period-section-title period-print-section-start">Ironbark Exploration — Drilling Costs by Provider</div>'
    +'<div class="period-table-hint">Provider actuals are taken from each contractor\'s activity and consumable records for the selected reporting period. Gas Riser work is excluded. Budget allocations remain unchanged.</div>'
    +'<table class="period-mini-table" style="margin-bottom:12px"><thead><tr><th>Drilling provider</th><th>Daily reports</th><th>Recorded cost</th><th>Source status</th></tr></thead><tbody>'
    +records+'<tr><td><b>Combined drilling</b></td><td class="num"><b>'+Array.from(reportCounts.values()).reduce(function(s,n){return s+n;},0)+'</b></td><td class="num"><b>'+cur(total)+'</b></td><td>Mitchells + Depco</td></tr></tbody></table>';
}

function renderPeriodSupportInvoices(invoices,budgetTotals,drillingSpend,mccChargeSummary,fortem,drillingByContractor,depcoGasRiser){
  depcoGasRiser=depcoGasRiser||{cost:0,rows:0};
  fortem=fortem||periodFortemEstimate(selectedPeriod(),invoices);
  const el=document.getElementById('period-support-invoices');
  if(!el)return;
  const rows=reportPostedSupportInvoices(invoices).slice().sort(function(a,b){
    return (invoiceReportIso(b)||'').localeCompare(invoiceReportIso(a)||'') || String(a.contractor||'').localeCompare(String(b.contractor||''));
  });
  const totals={Earthworks:0,Support:0,'Downhole Geophysical Logging':0,'Geological Support & Project Management':0,'Lab Testing':0,MISC:0};
  rows.forEach(function(inv){
    const section=supportSectionForInvoice(inv);
    totals[section]=(totals[section]||0)+numVal(inv.total_aud);
  });
  const invoiceTotal=rows.reduce(function(s,r){return s+numVal(r.total_aud);},0);
  const mccUnbilled=numVal(mccChargeSummary&&mccChargeSummary.unbilled);
  const total=invoiceTotal+mccUnbilled+fortem.unbilled;
  const budgetBySection=(budgetTotals&&budgetTotals.bySection)||{};
  const contractorBudgetRows=(budgetTotals&&budgetTotals.rows)||[];
  const contractorMap=new Map();
  function ensureContractor(label,section){
    const original=String(label||section||'Unassigned').trim()||'Unassigned';
    const canonicalKey=contractorSummaryKey(original);
    const display=canonicalKey==='impactenvironmental'?'Impact Environmental':canonicalKey==='sponcomtesting'?'B3 / Spon Com Testing':original;
    const key=contractorSummaryKey(display);
    if(!contractorMap.has(key))contractorMap.set(key,{label:display,sections:new Set(),budget:0,spent:0,invoices:0,actualsRecorded:false,actualSources:new Set()});
    const item=contractorMap.get(key);
    if(section)item.sections.add(section);
    return item;
  }
  contractorBudgetRows.forEach(function(r){
    const section=budgetRowSection(r);
    const item=ensureContractor(r.vendor||section,section);
    item.budget+=numVal(r.budget_amount);
  });
  const drillingBudgetRows=contractorBudgetRows.filter(function(r){return budgetRowSection(r)==='Drilling';});
  const drillingBudget=drillingBudgetRows.reduce(function(s,r){return s+numVal(r.budget_amount);},0);
  const effectiveDrillingBudget=numVal(budgetTotals&&budgetTotals.drilling)||drillingBudget;
  const splitIronbarkDrilling=activeProgram==='Exploration'&&projectNamesMatch(selectedPeriod().project,'Ironbark');
  if(splitIronbarkDrilling){
    // Preserve existing vendor budgets, but attribute actuals strictly to the
    // contractor that produced each daily report. Never split actuals by budget share.
    if(!drillingBudgetRows.length&&effectiveDrillingBudget>0){
      ensureContractor('Mitchells Drilling','Drilling').budget+=effectiveDrillingBudget;
    }
    ['Mitchells Drilling','DEPCO Drilling'].forEach(function(provider){
      const item=ensureContractor(provider,'Drilling');
      item.spent=numVal(drillingByContractor&&drillingByContractor.get(contractorSummaryKey(provider)))+(provider==='DEPCO Drilling'?numVal(depcoGasRiser.cost):0);
      item.actualsRecorded=item.spent>0;
      if(item.actualsRecorded)item.actualSources.add('activity reports');
      if(provider==='DEPCO Drilling'&&depcoGasRiser.cost>0)item.actualSources.add('Ironbark Gas Riser DARs (separate from Exploration)');
    });
  }else if(drillingBudgetRows.length){
    drillingBudgetRows.forEach(function(r){
      const section=budgetRowSection(r);
      const item=ensureContractor(r.vendor||reportDrillingContractor()||section,section);
      const share=drillingBudget>0?numVal(r.budget_amount)/drillingBudget:1/drillingBudgetRows.length;
      if(drillingBudget<=0)item.budget+=effectiveDrillingBudget/drillingBudgetRows.length;
      item.spent+=numVal(drillingSpend)*share;
      item.actualsRecorded=true;
      item.actualSources.add('activity reports');
    });
  }else if(numVal(drillingSpend)>0||effectiveDrillingBudget>0){
    const item=ensureContractor(reportDrillingContractor()||'Drilling','Drilling');
    item.budget+=effectiveDrillingBudget;
    item.spent+=numVal(drillingSpend);
    item.actualsRecorded=true;
    item.actualSources.add('activity reports');
  }
  rows.forEach(function(inv){
    const section=supportSectionForInvoice(inv);
    if(section==='Drilling')return;
    const item=ensureContractor(inv.contractor||section,section);
    item.spent+=numVal(inv.total_aud);
    if(inv.posting_scope==='annual')item.annualPosted=true;
    item.invoices+=1;
    item.actualsRecorded=true;
    item.actualSources.add('invoices');
  });
  if(mccChargeSummary&&numVal(mccChargeSummary.weeklyTotal)>0){
    const item=ensureContractor('MCC Group','Support');
    item.spent+=mccUnbilled;
    item.mccWeeklyTotal=numVal(mccChargeSummary.weeklyTotal);
    item.mccUnbilled=mccUnbilled;
    if(mccChargeSummary.postedInvoiceCount>0)item.actualsRecorded=true;
    item.actualSources.add('posted invoices only; EOS reference only');
    totals.Support=(totals.Support||0)+mccUnbilled;
  }
  if(fortem.settings.enabled){
    const item=ensureContractor('Fortem','Geological Support & Project Management');
    item.spent+=fortem.unbilled;
    item.estimated=true;
    item.actualsRecorded=true;
    item.actualSources.add('editable daily estimate');
    totals['Geological Support & Project Management']=(totals['Geological Support & Project Management']||0)+fortem.unbilled;
  }
  const contractorCards=Array.from(contractorMap.values()).filter(function(item){
    // Always show both Ironbark drilling providers, even when no reports
    // have been imported and no provider-specific budget was allocated.
    return item.budget>0||item.spent>0||(splitIronbarkDrilling&&item.sections.has('Drilling'));
  }).sort(function(a,b){
    const ad=a.sections.has('Drilling')?0:1;
    const bd=b.sections.has('Drilling')?0:1;
    return ad-bd||b.budget-a.budget||a.label.localeCompare(b.label);
  });
  // Annual 2026 budgets come from the complete audited project source,
  // independent of the report's selected date range and borehole subset.
  const annualSource=periodSourceBudgetData||{};
  const annualByContractor=new Map();
  if(splitIronbarkDrilling&&projectNamesMatch(annualSource.project,'Ironbark')&&Array.isArray(annualSource.contractors)&&Array.isArray(annualSource.holes)){
    annualSource.contractors.forEach(function(definition,index){
      const key=contractorSummaryKey(definition.name||definition.key);
      const amount=annualSource.holes.reduce(function(sum,hole){
        return sum+numVal(hole&&hole[3+index]);
      },0);
      annualByContractor.set(key,(annualByContractor.get(key)||0)+amount);
    });
  }else{
    // Existing project budget entries are the fallback where no audited
    // full-year source exists. Do not mistake a period budget for an annual one.
    (projectBudgetsData||[]).filter(function(r){
      return (!selectedPeriod().project||projectNamesMatch(r.project,selectedPeriod().project))
        &&(!activeProgram||!r.program||r.program===activeProgram);
    }).forEach(function(r){
      const key=contractorSummaryKey(r.vendor||budgetRowSection(r));
      annualByContractor.set(key,(annualByContractor.get(key)||0)+numVal(r.budget_amount));
    });
  }
  function contractorGroup(item){
    const k=contractorSummaryKey(item.label);
    if(item.sections.has('Drilling'))return 'Drilling';
    if(k==='mccgroup'||k==='chms'||k==='kingkonstruct'||item.sections.has('Earthworks'))return 'Earthworks';
    if(['geogas','stantec','sponcomtesting','b3'].includes(k)||item.sections.has('Lab Testing'))return 'Lab Testing';
    if(k==='epiroc'||item.sections.has('Downhole Geophysical Logging'))return 'Downhole Geophysical Logging';
    if(k==='fortem'||item.sections.has('Geological Support & Project Management'))return 'Geological Support & Project Management';
    return 'Other Support';
  }
  const contractorCardEntries=contractorCards.map(function(item){
    const variance=item.budget-item.spent;
    const sectionText=Array.from(item.sections).join(' / ')||'Uncoded';
    const mccDetail=item.mccWeeklyTotal!=null?' | '+cur(item.mccWeeklyTotal)+' EOS/weekly reference, '+(mccChargeSummary.invoicesOverride?'invoices override EOS (no EOS added)':'no invoices: EOS provisional actual'):'';
    const recorded=!!item.actualsRecorded;
    const actualSource=Array.from(item.actualSources||[]).join(' + ');
    const value=recorded?(item.estimated?'Estimated total ':'')+cur(item.spent)+' / '+cur(item.budget):'Actual not loaded / '+cur(item.budget);
    const annualPosted=item.annualPosted===true;
    const sub=recorded
      ?(annualPosted?'2026 annual posted invoices (individual posting dates not provided) | ':'')+(item.estimated?'Includes ':'Actual from ')+(actualSource||'source records')+' | '+esc(sectionText)+(item.invoices?' | '+item.invoices+' invoice'+(item.invoices===1?'':'s'):'')+mccDetail
      :'No invoice or weekly activity recorded in the selected period | '+esc(sectionText);
    const fortemPreview=contractorSummaryKey(item.label)==='fortem'
      ?'<div class="sub" style="margin-top:7px;border-top:1px solid var(--border);padding-top:7px;"><b>Cost estimate for selected dates: '+cur(fortem.gross)+'</b>'
       +' | '+fortem.settings.days+' days × '+cur(fortem.settings.geologist+fortem.settings.vehicle)
       +' + '+fortem.settings.flights+' flights × '+cur(fortem.settings.flightRate)
       +' | Estimated unbilled: '+cur(fortem.unbilled)+(fortem.settings.enabled?' (included)':' (not included)')
       +'. Expand Fortem estimated cost above to edit.</div>'
      :'';
    const varianceText=recorded?cur(Math.abs(variance))+' '+(variance>=0?'under':'over'):'Actuals unavailable';
    const card='<div class="period-support-card'+(recorded?'':' no-actual')+'">'
      +'<div class="label">'+esc(item.label)+'</div>'
      +'<div class="value">'+value+'</div>'
      +'<div class="annual-budget"><span>2026 annual budget</span><strong>'+(annualByContractor.has(contractorSummaryKey(item.label))?cur(annualByContractor.get(contractorSummaryKey(item.label))):'Not separately allocated')+'</strong></div>'
      +'<div class="sub">'+sub+'</div>'
      +fortemPreview
      +'<div class="variance '+(recorded?(variance>=0?'variance-pos':'variance-neg'):'')+'">'+varianceText+'</div>'
      +'</div>';
    return {group:contractorGroup(item),card:card};
  });
  const groupOrder=['Drilling','Earthworks','Lab Testing','Downhole Geophysical Logging','Geological Support & Project Management','Other Support'];
  const contractorCardHtml=groupOrder.map(function(group){
    const cards=contractorCardEntries.filter(function(entry){return entry.group===group;});
    if(!cards.length)return '';
    return '<section class="period-contractor-group"><h3>'+esc(group)+'</h3><div class="period-contractor-grid">'
      +cards.map(function(entry){return entry.card;}).join('')+'</div></section>';
  }).join('');
  // Do not turn an absent invoice into a $0 actual or use it in a forecast.
  const forecastItems=contractorCards.filter(function(item){return item.actualsRecorded&&!item.estimated;});
  const forecastRows=forecastItems.map(function(item){
    const assumption=reportForecastAssumption(item);
    const forecastCost=item.budget*assumption;
    const forecastVariance=forecastCost-item.spent;
    const spentPct=item.budget>0?item.spent/item.budget:0;
    return '<tr>'
      +'<td><b>'+esc(reportForecastLabel(item))+'</b></td>'
      +'<td class="num">'+cur(item.spent)+'</td>'
      +'<td class="num">'+cur(item.budget)+'</td>'
      +'<td class="num">'+(item.budget>0?pct(spentPct):'--')+'</td>'
      +'<td class="num">'+pct(assumption)+'</td>'
      +'<td class="num">'+cur(forecastCost)+'</td>'
      +'<td class="num '+(forecastVariance>=0?'variance-pos':'variance-neg')+'">'+(forecastVariance<0?'-':'')+cur(Math.abs(forecastVariance))+'</td>'
      +'</tr>';
  }).join('');
  const topVarianceRows=forecastItems.map(function(item){
    const assumption=reportForecastAssumption(item);
    const forecastCost=item.budget*assumption;
    const forecastVariance=forecastCost-item.spent;
    const label=reportForecastLabel(item);
    return {
      label:label,
      spent:item.spent,
      budget:item.budget,
      assumption:assumption,
      forecastCost:forecastCost,
      forecastVariance:forecastVariance,
      detailSuffix:item.detailSuffix||''
    };
  }).filter(function(item){
    return item.forecastVariance<0;
  }).sort(function(a,b){
    return Math.abs(b.forecastVariance)-Math.abs(a.forecastVariance);
  }).slice(0,5).map(function(item){
    const calculated='Spent '+cur(item.spent)+' against forecast '+cur(item.forecastCost)+' ('+pct(item.assumption)+' of '+cur(item.budget)+' budget).'+(item.detailSuffix?' '+item.detailSuffix:'');
    const note=periodVarianceNote(item.label);
    return '<tr>'
      +'<td><b>'+esc(item.label)+'</b></td>'
      +'<td class="num variance-neg">-'+cur(Math.abs(item.forecastVariance))+'</td>'
      +'<td>'+esc(calculated)+'</td>'
      +'<td style="min-width:260px;background:#fffef3;">'
      +'<div contenteditable="true" onblur="savePeriodVarianceNote(this,\''+attr(item.label).replace(/'/g,'&#39;')+'\')" style="min-height:20px;outline:none;">'+esc(note)+'</div>'
      +'<button class="btn-csv variance-note-clear" type="button" onclick="clearPeriodVarianceNote(this,\''+attr(item.label).replace(/'/g,'&#39;')+'\')" style="margin-top:6px;">Clear</button>'
      +'</td>'
      +'</tr>';
  }).join('');
  const sectionActuals=Object.assign({},totals);
  sectionActuals.Drilling=numVal(drillingSpend);
  const sections=Array.from(new Set(['Drilling','Earthworks','Support','Downhole Geophysical Logging','Geological Support & Project Management','Lab Testing','MISC']
    .concat(Object.keys(totals)).concat(Object.keys(budgetBySection)))).filter(function(label){
      return (sectionActuals[label]||0)>0||(budgetBySection[label]||0)>0||['Drilling','Earthworks','Downhole Geophysical Logging','Geological Support & Project Management','Lab Testing','MISC'].includes(label);
    });
  const sectionRows=sections.map(function(label){
    const budget=budgetBySection[label]||0;
    const spent=sectionActuals[label]||0;
    const variance=budget-spent;
    return '<tr><td><b>'+esc(label)+'</b></td><td class="num">'+cur(budget)+'</td><td class="num">'+cur(spent)+'</td><td class="num '+(variance>=0?'variance-pos':'variance-neg')+'">'+cur(Math.abs(variance))+'</td></tr>';
  }).join('');
  const body=rows.map(function(inv){
    return '<tr>'
      +'<td><b>'+esc(supportSectionForInvoice(inv))+'</b></td>'
      +'<td>'+esc(inv.contractor||'')+'</td>'
      +'<td>'+esc(inv.invoice_number||'')+'</td>'
      +'<td>'+esc(inv.invoice_date||inv.billing_month||'')+'</td>'
      +'<td>'+esc(inv.project||'')+'</td>'
      +'<td>'+esc(inv.po_reference||'')+'</td>'
      +'<td class="num"><b>'+cur(inv.total_aud)+'</b></td>'
      +'</tr>';
  }).join('')+(mccUnbilled>0?'<tr>'
      +'<td><b>Support</b></td><td>MCC Group</td><td>Unbilled accrual</td>'
      +'<td>'+esc((selectedPeriod().from||'start')+' to '+(selectedPeriod().to||'end'))+'</td>'
      +'<td>'+esc(selectedPeriod().project||activeProjectName||'')+'</td><td></td><td>Weekly charges</td>'
      +'<td class="num"><b>'+cur(mccUnbilled)+'</b></td></tr>':'');
  const fortemRow=fortem.unbilled>0?'<tr><td>Geological Support & Project Management</td><td>Fortem</td><td>Estimated unbilled cost</td><td>'+esc(selectedPeriod().from+' to '+selectedPeriod().to)+'</td><td>'+esc(selectedPeriod().project)+'</td><td></td><td>Estimate</td><td class="num"><b>'+cur(fortem.unbilled)+'</b></td></tr>':'';
  el.innerHTML='<div class="period-support-panel">'
    +renderFortemEstimateEditor(fortem)
    +'<div class="period-support-total">'+(contractorCardHtml||'<div class="period-support-card"><div class="label">No contractor budgets</div><div class="value">--</div><div class="sub">Import or enter project budget rows to show contractor budget cards.</div></div>')+'</div>'
    +'<div class="period-support-note">Actuals are sourced from invoices, MCC weekly charges, and drilling activity reports. Applied Fortem estimates are labelled separately and included in support totals and budget variance. Fortem daily estimates are excluded from the percentage-based forecast below. A contractor with no source record or applied estimate is shown as <b>Actual not loaded</b>, not $0.</div>'
    +'<div class="period-section-title">Forecast Summary</div>'
    +'<table class="period-mini-table" style="margin-bottom:10px;"><thead><tr><th>Activity</th><th>Total spent</th><th>Total budget</th><th>% of budget spent</th><th>Forecast assumption</th><th>Forecasted cost</th><th>Forecast variance</th></tr></thead><tbody>'
    +(forecastRows||'<tr><td colspan="7" style="padding:14px;color:var(--muted);text-align:center;">No contractor budget forecast data.</td></tr>')
    +'</tbody></table>'
    +'<div class="period-section-title">Top Variances</div>'
    +'<table class="period-mini-table" style="margin-bottom:10px;"><thead><tr><th>Activity</th><th>Forecast variance</th><th>Calculated detail</th><th>Manual variance note</th></tr></thead><tbody>'
    +(topVarianceRows||'<tr><td colspan="4" style="padding:14px;color:var(--muted);text-align:center;">No forecast overruns in this period.</td></tr>')
    +'</tbody></table>'
    +'<table class="period-mini-table" style="margin-bottom:10px;"><thead><tr><th>Section</th><th>Budget</th><th>'+(fortem.unbilled>0?'Cost incl. estimate':'Spent')+'</th><th>Variance</th></tr></thead><tbody>'
    +(sectionRows||'<tr><td colspan="4" style="padding:14px;color:var(--muted);text-align:center;">No project budgets recorded.</td></tr>')
    +'</tbody></table>'
    +'<table class="period-mini-table"><thead><tr><th>Section</th><th>Contractor</th><th>Invoice #</th><th>Date</th><th>Project</th><th>PO</th><th>Total</th></tr></thead><tbody>'
    +(body+fortemRow||'<tr><td colspan="7" style="padding:18px;color:var(--muted);text-align:center;">No Earthworks, Support, Lab Testing or Misc invoices in this period.</td></tr>')
    +'<tr><td colspan="6"><b>'+(fortem.unbilled>0?'Total support including estimate':'Total support actuals')+'</b></td><td class="num"><b>'+cur(total)+'</b></td></tr>'
    +'</tbody></table></div>';
}

function cleanStandbyReason(row){
  const raw=String(row.notes||'').trim();
  if(raw)return raw.replace(/\s+/g,' ');
  return String(row.code||row.activity_code||'Standby').replace(/_/g,' ');
}

function renderPeriodStandbyReasons(rows){
  const el=document.getElementById('period-standby-reasons');
  if(!el)return;
  const period=selectedPeriod();
  const standby=(rows||[]).filter(function(r){
    const iso=reportIso(r.date);
    if(!iso)return false;
    if(period.from&&iso<period.from)return false;
    if(period.to&&iso>period.to)return false;
    return rowIsStandby(r)&&numVal(r.line_cost)>0;
  });
  if(!standby.length){
    el.innerHTML='<div class="period-issues"><div class="empty-state" style="padding:0;">No standby rows recorded in this period.</div></div>';
    return;
  }
  const groups=new Map();
  standby.forEach(function(r){
    const reason=cleanStandbyReason(r);
    if(!groups.has(reason))groups.set(reason,{reason:reason,count:0,hours:0,cost:0,holes:new Set(),dates:new Set()});
    const item=groups.get(reason);
    item.count+=1;
    item.hours+=parseDurationHours(r.total_time);
    item.cost+=numVal(r.line_cost);
    if(rowHole(r))item.holes.add(rowHole(r));
    const iso=reportIso(r.date);
    if(iso)item.dates.add(iso);
  });
  const items=Array.from(groups.values()).sort(function(a,b){return b.cost-a.cost||b.hours-a.hours||a.reason.localeCompare(b.reason);});
  const totalHours=items.reduce(function(s,r){return s+r.hours;},0);
  const totalCost=items.reduce(function(s,r){return s+r.cost;},0);
  el.innerHTML='<div class="period-bar-chart">'
    +'<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px;">'
    +'<div><div class="period-visual-title">Standby Events</div><b>'+standby.length.toLocaleString()+'</b></div>'
    +'<div><div class="period-visual-title">Standby Hours</div><b>'+totalHours.toFixed(2)+' h</b></div>'
    +'<div><div class="period-visual-title">Standby Cost</div><b>'+cur(totalCost)+'</b></div>'
    +'</div>'
    +'<table class="period-mini-table"><thead><tr><th>Reason</th><th>Holes</th><th>Dates</th><th>Events</th><th>Hours</th><th>Cost</th></tr></thead><tbody>'
    +items.map(function(r){
      return '<tr><td>'+esc(r.reason)+'</td><td>'+esc(Array.from(r.holes).join(', ')||'--')+'</td><td>'+esc(Array.from(r.dates).sort().join(', ')||'--')+'</td><td class="num">'+r.count+'</td><td class="num">'+r.hours.toFixed(2)+'</td><td class="num">'+cur(r.cost)+'</td></tr>';
    }).join('')
    +'</tbody></table></div>';
}

function renderPeriodProgress(rows,activeHoles,projectHoles,reportHoles,holeStatusSummary){
  const el=document.getElementById('period-progress-issues');
  if(!el)return;
  const relevant=Array.isArray(reportHoles)?reportHoles:periodRelevantProjectHoles(projectHoles,activeHoles);
  const statusSummary=holeStatusSummary||periodHoleStatusSummary(relevant,selectedPeriod(),periodReportActivitiesData||activitiesData);
  const notes=Array.from(new Set(rows.map(function(r){return r.notes||'';}).filter(function(n){return n&&String(n).toLowerCase().match(/delay|standby|fatigue|lost|breakdown|repair|access|issue|move|ground/);}))).slice(0,4);
  const items=[
    {label:'Completed',value:statusSummary.completed.length||0},
    {label:'In Progress',value:statusSummary.inProgress.length||0},
    {label:'Report holes',value:relevant.length||0},
    {label:'Exceptions',value:notes.length||0}
  ];
  el.innerHTML='<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px;">'
    +items.map(function(i){return '<div style="border:1px solid var(--border);border-radius:7px;background:#fff;padding:9px 10px;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--muted);letter-spacing:.08em;">'+esc(i.label)+'</div><div style="font-size:20px;font-weight:800;color:var(--text);">'+esc(i.value)+'</div></div>';}).join('')
    +'</div>'
    +(notes.length?'<div style="display:flex;gap:6px;flex-wrap:wrap;">'+notes.map(function(n){return '<span class="flag-pill" title="'+attr(n)+'">'+esc(String(n).slice(0,70))+'</span>';}).join('')+'</div>':'<div class="empty-state" style="padding:0;">No exception notes in this period.</div>');
}


function renderReportStatusSelect(report){
  const hole=reportRecordHole(report);
  const status=(getStoredReportApproval(report.date,hole,report.sourceFile,report.contractor)||{}).status||'pending';
  const cls=status==='approved'?'approved':status==='rejected'?'rejected':status==='query'?'query':'';
  return '<select class="status-select '+cls+'" data-report-key="'+attr(report.key)+'" onclick="event.stopPropagation()" onchange="changeReportApprovalFromList(this)">'
    +'<option value="pending" '+(status==='pending'?'selected':'')+'>ⓘ Client Approval Pending</option>'
    +'<option value="approved" '+(status==='approved'?'selected':'')+'>✓ Client Approved</option>'
    +'<option value="query" '+(status==='query'?'selected':'')+'>? Client Query</option>'
    +'<option value="rejected" '+(status==='rejected'?'selected':'')+'>✕ Client Rejected</option>'
    +'</select>';
}

function renderReportLockStatus(report){
  const lock=getStoredReportLock(report.date,reportRecordHole(report),report.sourceFile,report.contractor);
  const locked=!!(lock&&lock.locked);
  const title=locked?(lock.reason||'Locked from recalculation'):'Not locked';
  return '<span title="'+attr(title)+'" style="display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:800;border:1px solid '+(locked?'#bdc9ff':'#d8e0ea')+';background:'+(locked?'#eef2ff':'#f8fafc')+';color:'+(locked?'#315d49':'#647285')+';">'+(locked?'Locked':'Open')+'</span>';
}

async function changeReportApprovalFromList(select){
  const report=dailyReportsData.find(function(r){return r.key===select.dataset.reportKey;});
  if(!report)return;
  const status=select.value;
  const hole=reportRecordHole(report);
  const contractor=report.contractor||activeContractor;
  const key=reportApprovalRecordKey(contractor,report.date,hole,report.sourceFile);
  if(status==='pending'){
    try{
      const p=new URLSearchParams({contractor:contractor,date:report.date||'',hole:hole,source:report.sourceFile||''});
      const res=await fetch(API+'/report-approvals?'+p.toString(),{method:'DELETE'});
      if(!res.ok)throw new Error(await res.text());
      delete reportApprovalsByKey[key];
      localStorage.removeItem(reportApprovalStorageKey(contractor,report.date,hole,report.sourceFile));
      renderDailyReportSummary(activitiesData);
      toast('Client decision cleared');
    }catch(e){
      toast('Decision clear failed','err');
      renderDailyReportSummary(activitiesData);
    }
    return;
  }
  let reason='';
  if(status==='rejected'||status==='query'){
    reason=prompt(status==='query'?'What is the query?':'Why is this report rejected?')||'';
  }
  if((status==='rejected'||status==='query')&&!reason.trim()){
    renderDailyReportSummary(activitiesData);
    return;
  }
  const lockOnApproval=status==='approved'
    ? confirm('Lock this approved report data so future recalculations skip it?')
    : false;
  try{
    const res=await fetch(API+'/report-approvals',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        contractor:contractor,
        date:report.date||'',
        hole:hole,
        source:report.sourceFile||'',
        status:status,
        reason:reason.trim(),
        by:'Client',
        lock_on_approval:lockOnApproval,
        lock_reason:'Locked on client approval to protect reviewed/custom changes.'
      })
    });
    if(!res.ok)throw new Error(await res.text());
    const saved=await res.json();
    reportApprovalsByKey[key]=saved;
    if(saved.lock){
      reportLocksByKey[reportLockRecordKey(contractor,report.date,hole,report.sourceFile)]=saved.lock;
    }
    renderDailyReportSummary(activitiesData);
    toast('Client decision saved');
  }catch(e){
    toast('Decision save failed','err');
    renderDailyReportSummary(activitiesData);
  }
}

function clearDarReportFilters(){
  const search=document.getElementById("report-search");
  if(search)search.value="";
  const advanced=document.getElementById("f-search");
  if(advanced)advanced.value="";
  ["f-dates","f-holes","f-sites","f-codes"].forEach(function(id){
    const select=document.getElementById(id);
    if(select)Array.from(select.options).forEach(function(option){option.selected=true;});
  });
  activityMissingCodesOnly=false;
  loadActivities();
}

function filterDailyReportRows(){
  const q=(document.getElementById('report-search')?.value||'').trim().toLowerCase();
  document.querySelectorAll('#report-body tr.report-row').forEach(function(row){
    row.style.display=!q||row.dataset.search.includes(q)?'':'none';
  });
}

function toggleAllReportRows(box){
  document.querySelectorAll('#report-body .row-check').forEach(function(cb){cb.checked=box.checked;});
  updateBulkReportSelection();
}

function selectedReportRows(){
  return [...document.querySelectorAll('#report-body tr.report-row')].filter(function(row){
    return row.querySelector('.row-check')?.checked;
  }).map(function(row){
    return dailyReportsData.find(function(r){return r.key===row.dataset.reportKey;});
  }).filter(Boolean);
}

function updateBulkReportSelection(){
  const selected=selectedReportRows();
  const count=document.getElementById('bulk-report-count');
  const lockBtn=document.getElementById('bulk-lock-btn');
  const unlockBtn=document.getElementById('bulk-unlock-btn');
  const deleteBtn=document.getElementById('bulk-delete-btn');
  const assignBtn=document.getElementById('bulk-assign-project-btn');
  if(count)count.textContent=selected.length+' selected';
  if(lockBtn)lockBtn.disabled=!selected.length;
  if(unlockBtn)unlockBtn.disabled=!selected.length;
  if(deleteBtn)deleteBtn.disabled=!selected.length;
  if(assignBtn)assignBtn.disabled=!selected.length;
}

async function bulkAssignReportsToWorkspace(){
  const reports=selectedReportRows();
  if(!reports.length)return;
  if(!activeProjectName||!activeClientId){
    toast('Choose a client and project workspace first','err');
    return;
  }
  const activityIds=Array.from(new Set(reports.flatMap(function(report){
    return (report.rows||[]).map(function(row){return Number(row.id);}).filter(Number.isFinite);
  })));
  if(!activityIds.length){
    toast('No activity rows found for the selected reports','err');
    return;
  }
  const client=clientById(activeClientId);
  const destination=(client?client.name+' / ':'')+activeProjectName;
  if(!confirm('Assign '+reports.length+' selected report(s) to '+destination+'?'))return;
  const button=document.getElementById('bulk-assign-project-btn');
  if(button)button.disabled=true;
  try{
    const response=await fetch(API+'/activities/assign-project',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        contractor:reports[0].contractor||activeContractor,
        project:activeProjectName,
        program:activeProgram,
        activity_ids:activityIds
      })
    });
    if(!response.ok)throw new Error(await response.text());
    const result=await response.json();
    toast('\u2713 '+result.rows+' activity rows assigned to '+activeProjectName);
    await loadActivities();
  }catch(error){
    toast('Project assignment failed','err');
  }finally{
    updateBulkReportSelection();
  }
}

async function bulkSetReportLocks(locked){
  const reports=selectedReportRows();
  if(!reports.length){toast('Select reports first','warn');return;}
  const reason=locked
    ? (prompt('Bulk lock note', 'Bulk locked to protect reviewed/custom changes.')||'')
    : (prompt('Bulk unlock note', 'Bulk unlocked for recalculation.')||'');
  if(!confirm((locked?'Lock ':'Unlock ')+reports.length+' selected report(s)?'))return;
  const lockBtn=document.getElementById('bulk-lock-btn');
  const unlockBtn=document.getElementById('bulk-unlock-btn');
  if(lockBtn)lockBtn.disabled=true;
  if(unlockBtn)unlockBtn.disabled=true;
  let done=0;
  try{
    for(const report of reports){
      const hole=reportRecordHole(report);
      const contractor=report.contractor||activeContractor;
      const res=await fetch(API+'/activity-sheet-locks',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          contractor:contractor,
          date:report.date||'',
          hole:hole,
          source:report.sourceFile||'',
          locked:locked,
          reason:reason
        })
      });
      if(!res.ok)throw new Error(await res.text());
      const saved=await res.json();
      reportLocksByKey[reportLockRecordKey(contractor,report.date,hole,report.sourceFile)]=saved;
      done++;
    }
    renderDailyReportSummary(activitiesData);
    toast((locked?'Locked ':'Unlocked ')+done+' report(s)');
  }catch(e){
    toast('Bulk lock update failed after '+done+' report(s): '+(e.message||e),'err');
    renderDailyReportSummary(activitiesData);
  }
}

async function bulkDeleteReports(){
  const reports=selectedReportRows();
  if(!reports.length){toast('Select reports first','warn');return;}
  const contractors=Array.from(new Set(reports.map(function(report){
    return String(report.contractor||activeContractor||'').trim();
  }).filter(Boolean)));
  if(contractors.length!==1){
    toast('Selected reports must belong to one contractor','err');
    return;
  }
  const contractor=contractors[0];
  const label=reports.slice(0,5).map(function(r){return (r.id||r.date||'Report')+' '+(r.hole||'');}).join('\\n');
  const more=reports.length>5?'\\n...and '+(reports.length-5)+' more':'';
  if(!confirm('Delete '+reports.length+' selected activity report(s) and their database rows?\\n\\n'+label+more+'\\n\\nThis cannot be undone.'))return;
  const deleteBtn=document.getElementById('bulk-delete-btn');
  const lockBtn=document.getElementById('bulk-lock-btn');
  const unlockBtn=document.getElementById('bulk-unlock-btn');
  if(deleteBtn)deleteBtn.disabled=true;
  if(lockBtn)lockBtn.disabled=true;
  if(unlockBtn)unlockBtn.disabled=true;
  try{
    const payload={
      contractor:contractor,
      reports:reports.map(function(r){
        return {
          date:r.date||'',
          hole:reportRecordHole(r),
          source:r.sourceFile||'',
          activity_ids:(r.rows||[]).map(function(row){return Number(row.id);}).filter(Number.isInteger)
        };
      })
    };
    let res=await fetch(API+'/activity-reports/delete',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    if(res.status===404){
      const postError=await res.clone().text();
      if(postError.includes('"Not Found"')){
        res=await fetch(API+'/activity-reports',{
          method:'DELETE',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        });
      }else{
        throw new Error(postError);
      }
    }
    if(res.status===404)throw new Error('The API delete route is not deployed yet. Wait for the backend deploy to finish, then refresh and try again.');
    if(!res.ok)throw new Error(await res.text());
    const result=await res.json();
    if(!(result.activities||result.consumables||result.crew||result.approvals||result.locks)){
      throw new Error('No matching '+contractor+' report rows were deleted. Refresh and try again.');
    }
    toast('Deleted '+(result.reports||reports.length)+' report(s), '+(result.activities||0)+' activity row(s)');
    selectedDailyReportKey=null;
    closeDailyReportDetail();
    await loadActivities();
    await updateDbCount();
  }catch(e){
    toast('Delete failed: '+(e.message||e),'err');
    updateBulkReportSelection();
  }
}

function openDailyReportDetailByKey(key){
  selectedDailyReportKey=key;
  const report=dailyReportsData.find(function(r){return r.key===key;});
  if(!report)return;
  document.querySelectorAll('.report-row').forEach(function(row){row.classList.toggle('active',row.dataset.reportKey===key);});
  const navigationToken=createDailyReportNavigationContext();
  window.open(dailyReportUrl(report,navigationToken), '_blank', 'noopener');
}

function closeDailyReportDetail(){
  selectedDailyReportKey=null;
  document.querySelectorAll('.report-row').forEach(function(row){row.classList.remove('active');});
}

function dailyReportNavigationRecord(report){
  return {
    key:report.key||'',
    contractor:report.contractor||activeContractor,
    program:activeProgram||'',
    date:report.date||'',
    hole:reportRecordHole(report),
    source:report.sourceFile||'',
    title:report.id||'Daily report'
  };
}

function createDailyReportNavigationContext(){
  const visibleKeys=new Set([...document.querySelectorAll('#report-body tr.report-row')]
    .filter(function(row){return row.style.display!=='none';})
    .map(function(row){return row.dataset.reportKey;}));
  const reports=dailyReportsData
    .filter(function(report){return visibleKeys.has(report.key);})
    .map(dailyReportNavigationRecord);
  if(!reports.length)return '';
  const token=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
  const storageKey='drillops-report-navigation:'+token;
  try{
    localStorage.setItem(storageKey,JSON.stringify({createdAt:Date.now(),reports:reports}));
    const storedKeys=Object.keys(localStorage).filter(function(key){return key.startsWith('drillops-report-navigation:');});
    if(storedKeys.length>12){
      storedKeys.sort(function(a,b){
        try{return (JSON.parse(localStorage.getItem(a)||'{}').createdAt||0)-(JSON.parse(localStorage.getItem(b)||'{}').createdAt||0);}
        catch(e){return 0;}
      }).slice(0,storedKeys.length-12).forEach(function(key){localStorage.removeItem(key);});
    }
    return token;
  }catch(e){return '';}
}

function dailyReportUrl(report,navigationToken){
  const params=new URLSearchParams({
    contractor:report.contractor||activeContractor,
    program:activeProgram||'',
    date:report.date||'',
    hole:reportRecordHole(report),
    source:report.sourceFile||'',
    title:report.id||'Daily report'
  });
  if(navigationToken)params.set('nav',navigationToken);
  return 'report.html?'+params.toString();
}

function isoFromReportDate(value){
  if(!value)return '';
  const s=String(value).trim();
  const dm=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(dm)return dm[3]+'-'+String(dm[2]).padStart(2,'0')+'-'+String(dm[1]).padStart(2,'0');
  const named=s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if(named){
    const months={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
    const m=months[named[2].toLowerCase()];
    if(m)return named[3]+'-'+String(m).padStart(2,'0')+'-'+String(named[1]).padStart(2,'0');
  }
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const parsed=new Date(s);
  return isNaN(parsed)?'':parsed.toISOString().slice(0,10);
}

function openGraphicalRangeReport(){
  let from=document.getElementById('range-from')?.value||'';
  let to=document.getElementById('range-to')?.value||'';
  if(!from||!to){
    const dates=dailyReportsData.map(function(r){return isoFromReportDate(r.date);}).filter(Boolean).sort();
    if(!from)from=dates[0]||'';
    if(!to)to=dates[dates.length-1]||'';
  }
  if(!from||!to){toast('Select a start and end date first','warn');return;}
  const params=new URLSearchParams({contractor:activeContractor,from:from,to:to});
  window.open('range-report.html?'+params.toString(),'_blank','noopener');
}

function openSelectedReportPdf(){
  const report=dailyReportsData.find(function(r){return r.key===selectedDailyReportKey;});
  if(report&&report.sourceFile)viewSourcePdf(report.sourceFile);
}

function downloadDailyReportsCSV(){
  if(!dailyReportsData.length){toast('No daily reports to export','warn');return;}
  const isMccEarthworks=activeContractor==='MCC Group';
  const rows=dailyReportsData.map(function(r){
    const row={report:r.id,status:r.status.label,date:r.date,shift:r.shift,hole:r.hole,project:r.project||'',hours:r.hours.toFixed(2),notes:r.notes.join(' | ')};
    if(!isMccEarthworks){
      row.rig=r.rig;
      row.driller=r.driller;
      row.metres=r.metres.toFixed(2);
      row.cost=r.cost.toFixed(2);
    }
    return row;
  });
  const headers=Object.keys(rows[0]);
  const csv=[headers.join(',')].concat(rows.map(function(r){return headers.map(function(h){return '"'+String(r[h]??'').replace(/"/g,'""')+'"';}).join(',');})).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='daily-report-summaries.csv';
  a.click();
}

// ── Consumables ───────────────────────────────────────────────────────────────
async function loadConsumables(){
  var dates=(getSelVals('f-con-dates').length?getSelVals('f-con-dates'):getSelVals('f-dates')).filter(function(d){return d;}).join(',');
  var url=API+'/consumables?contractor='+encodeURIComponent(activeContractor);
  if(dates) url+='&dates='+dates;
  try{
    consumablesData=await fetch(url).then(function(r){return r.json();});
    renderConsumablesTable();
  }catch(e){ console.error('loadConsumables error:', e); document.getElementById('con-body').innerHTML='<tr><td colspan="9" style="color:var(--red);padding:16px;">Error loading: '+e.message+'</td></tr>'; }
}

function renderConsumablesTable(){
  if(WORKSPACE_APP==='eos'&&!eosRawLogsEnabled)return;
  const count=document.getElementById('con-count');
  const body=document.getElementById('con-body');
  if(!body)return;
  if(count)count.textContent=consumablesData.length;
  const panel=document.getElementById('consumables-panel');
  if(panel&&panel.classList.contains('collapsed')){
    body.innerHTML='';
    return;
  }
  body.innerHTML=consumablesData.map(function(r){
    var up = parseFloat(r.unit_price)||0;
    var lc = parseFloat(r.line_cost)||0;
    return '<tr data-con-id="'+r.id+'">'
      +'<td contenteditable="true" data-col="date">'+esc(r.date)+'</td>'
      +'<td contenteditable="true" data-col="hole_num">'+esc(r.hole_num)+'</td>'
      +'<td contenteditable="true" data-col="site_name">'+esc(r.site_name)+'</td>'
      +'<td contenteditable="true" data-col="consumable" style="font-weight:600;">'+esc(r.consumable)+'</td>'
      +'<td contenteditable="true" data-col="type">'+esc(r.type)+'</td>'
      +'<td contenteditable="true" data-col="quantity" data-num="true">'+esc(r.quantity)+'</td>'
      +'<td contenteditable="true" data-col="unit">'+esc(r.unit)+'</td>'
      +'<td contenteditable="true" data-col="unit_price" data-num="true" style="color:var(--accent);">'+(up>0?up.toFixed(2):'')+'</td>'
      +'<td style="font-weight:600;color:'+(lc>0?'var(--accent)':'var(--muted)')+';">'+(lc>0?'$'+lc.toFixed(2):'\u2014')+'</td>'
      +'</tr>';
  }).join('')||'<tr><td colspan="9"><div class="empty-state">No data</div></td></tr>';
  body.querySelectorAll('[contenteditable]').forEach(function(cell){
    cell.addEventListener('blur', async function(){
      var row = cell.closest('tr');
      var rid = row.dataset.conId;
      var col = cell.dataset.col;
      var val = cell.textContent.trim().replace(/[$,]/g,'');
      if(cell.dataset.num) val = val===''?null:parseFloat(val);
      try {
        var payload = {};
        payload[col] = val;
        await fetch(API+'/consumables/'+rid, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        toast('\u2713 Saved');
        if(col === 'unit_price' || col === 'quantity') loadConsumables();
      } catch(e) { toast('Save failed','err'); }
    });
  });
  makeTableSortable('con-table');
}

// ── Crew ──────────────────────────────────────────────────────────────────────
async function loadCrew(){
  var dates=(getSelVals('f-crew-dates').length?getSelVals('f-crew-dates'):getSelVals('f-dates')).filter(function(d){return d;}).join(',');
  var url=API+'/crew?contractor='+encodeURIComponent(activeContractor);
  if(dates) url+='&dates='+dates;
  try{
    crewData=await fetch(url).then(function(r){return r.json();});
    renderCrewTable();
  }catch(e){}
}

function renderCrewTable(){
  if(WORKSPACE_APP==='eos'&&!eosRawLogsEnabled)return;
  const count=document.getElementById('crew-count');
  const body=document.getElementById('crew-body');
  if(!body)return;
  if(count)count.textContent=crewData.length;
  const panel=document.getElementById('crew-panel');
  if(panel&&panel.classList.contains('collapsed')){
    body.innerHTML='';
    return;
  }
  body.innerHTML=crewData.map(r=>
    `<tr><td>${esc(r.date)}</td><td>${esc(r.hole_num)}</td><td>${esc(r.site_name)}</td><td>${esc(r.role)}</td><td>${esc(r.name)}</td><td>${esc(r.hours)}</td></tr>`
  ).join('')||'<tr><td colspan="6"><div class="empty-state"><div class="big">📭</div>No data</div></td></tr>';
  makeTableSortable('crew-table');
}

// ── Analytics ─────────────────────────────────────────────────────────────────
// Daily Drill Production
function productionDrillType(row){
  const bit=String(row&&row.bit_type||'').trim();
  const diameter=String(row&&row.diameter||'').trim();
  if(bit&&diameter&&!bit.toLowerCase().includes(diameter.toLowerCase()))return bit+' · '+diameter;
  return bit||diameter||'Unspecified';
}

function productionDate(row){
  return isoFromReportDate(row&&row.date||'');
}

function productionDisplayDate(value,short){
  const iso=isoFromReportDate(value);
  if(!iso)return String(value||'--');
  const date=new Date(iso+'T00:00:00Z');
  return date.toLocaleDateString('en-AU',short
    ? {day:'2-digit',month:'short',timeZone:'UTC'}
    : {day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
}

function populateProductionContractors(){
  const select=document.getElementById('production-contractor');
  if(!select)return '';
  const drilling=filteredContractors().filter(function(contractor){
    return contractorCategory(contractor)==='Drilling';
  });
  const preferred=select.value||sessionStorage.getItem('drillops_report_drilling_contractor')||reportDrillingContractor();
  select.innerHTML=drilling.map(function(contractor){
    return '<option value="'+attr(contractor.name)+'"'+(contractor.name===preferred?' selected':'')+'>'+esc(contractor.name)+'</option>';
  }).join('');
  if(!select.value&&drilling.length)select.value=drilling[0].name;
  return select.value;
}

function populateProductionDimensionFilters(){
  const rigSelect=document.getElementById('production-rig');
  const typeSelect=document.getElementById('production-drill-type');
  if(!rigSelect||!typeSelect)return;
  const currentRig=rigSelect.value;
  const currentType=typeSelect.value;
  const rigs=Array.from(new Set(productionRawData.map(function(row){return String(row.drill_rig||'Unspecified').trim()||'Unspecified';}))).sort();
  const types=Array.from(new Set(productionRawData.map(productionDrillType))).sort();
  rigSelect.innerHTML='<option value="">All rigs</option>'+rigs.map(function(rig){return '<option value="'+attr(rig)+'">'+esc(rig)+'</option>';}).join('');
  typeSelect.innerHTML='<option value="">All drill types</option>'+types.map(function(type){return '<option value="'+attr(type)+'">'+esc(type)+'</option>';}).join('');
  if(rigs.includes(currentRig))rigSelect.value=currentRig;
  if(types.includes(currentType))typeSelect.value=currentType;
}

async function loadDailyProduction(){
  const contractor=populateProductionContractors();
  const status=document.getElementById('production-chart-status');
  const context=document.getElementById('production-context');
  if(context){
    const client=clientById(activeClientId);
    context.textContent=(client?client.name+' / ':'')+(activeProjectName||'No project selected');
  }
  if(!contractor){
    productionRawData=[];
    renderDailyProduction();
    return;
  }
  if(status)status.textContent='Loading '+contractor+' production...';
  try{
    const response=await fetch(API+'/activity-report-data?contractor='+encodeURIComponent(contractor)+'&_='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const bundle=await response.json();
    productionRawData=filterRowsForActiveProgram(bundle.activities||[]).filter(function(row){
      return productionDate(row)&&Number(row.total_metres)>0;
    });
    sessionStorage.setItem('drillops_report_drilling_contractor',contractor);
    populateProductionDimensionFilters();
    setProductionDatePreset(document.getElementById('production-date-preset')?.value||'latest-month');
  }catch(error){
    productionRawData=[];
    productionFilteredData=[];
    if(status)status.textContent='Production data could not be loaded.';
    renderDailyProduction();
  }
}

function setProductionDatePreset(preset){
  const dates=productionRawData.map(productionDate).filter(Boolean).sort();
  const from=document.getElementById('production-from');
  const to=document.getElementById('production-to');
  const presetSelect=document.getElementById('production-date-preset');
  if(presetSelect&&presetSelect.value!==preset)presetSelect.value=preset;
  if(!dates.length){
    if(from)from.value='';
    if(to)to.value='';
    renderDailyProduction();
    return;
  }
  const first=dates[0];
  const latest=dates[dates.length-1];
  if(preset==='latest-month'){
    if(from)from.value=latest.slice(0,7)+'-01';
    if(to)to.value=latest;
  }else if(preset==='last-30'){
    const start=new Date(latest+'T00:00:00Z');
    start.setUTCDate(start.getUTCDate()-29);
    if(from)from.value=start.toISOString().slice(0,10);
    if(to)to.value=latest;
  }else if(preset==='year'){
    if(from)from.value=latest.slice(0,4)+'-01-01';
    if(to)to.value=latest;
  }else if(preset==='all'){
    if(from)from.value=first;
    if(to)to.value=latest;
  }
  renderDailyProduction();
}

function setProductionCustomRange(){
  const preset=document.getElementById('production-date-preset');
  if(preset)preset.value='custom';
  renderDailyProduction();
}

function productionCalendarDates(from,to,fallbackDates){
  if(!from||!to)return fallbackDates;
  const start=new Date(from+'T00:00:00Z');
  const end=new Date(to+'T00:00:00Z');
  const span=Math.round((end-start)/86400000);
  if(!Number.isFinite(span)||span<0||span>730)return fallbackDates;
  const result=[];
  for(let cursor=new Date(start);cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1)){
    result.push(cursor.toISOString().slice(0,10));
  }
  return result;
}

function renderDailyProduction(){
  const rig=document.getElementById('production-rig')?.value||'';
  const drillType=document.getElementById('production-drill-type')?.value||'';
  const from=document.getElementById('production-from')?.value||'';
  const to=document.getElementById('production-to')?.value||'';
  const contractor=document.getElementById('production-contractor')?.value||'';
  productionFilteredData=productionRawData.filter(function(row){
    const date=productionDate(row);
    if(!date||(from&&date<from)||(to&&date>to))return false;
    if(rig&&String(row.drill_rig||'Unspecified').trim()!==rig)return false;
    return !drillType||productionDrillType(row)===drillType;
  });

  const dailyMap=new Map();
  productionFilteredData.forEach(function(row){
    const date=productionDate(row);
    dailyMap.set(date,(dailyMap.get(date)||0)+(Number(row.total_metres)||0));
  });
  const activeDates=Array.from(dailyMap.keys()).sort();
  const chartDates=productionCalendarDates(from,to,activeDates);
  const daily=chartDates.map(function(date){return dailyMap.get(date)||0;});
  const cumulative=[];
  const movingAverage=[];
  let running=0;
  daily.forEach(function(value,index){
    running+=value;
    cumulative.push(Number(running.toFixed(2)));
    const window=daily.slice(Math.max(0,index-6),index+1);
    movingAverage.push(Number((window.reduce(function(sum,item){return sum+item;},0)/window.length).toFixed(2)));
  });

  const total=productionFilteredData.reduce(function(sum,row){return sum+(Number(row.total_metres)||0);},0);
  const productionDays=activeDates.length;
  const bestDate=activeDates.reduce(function(best,date){
    return !best||dailyMap.get(date)>dailyMap.get(best)?date:best;
  },'');
  const number=function(value,digits){
    return Number(value||0).toLocaleString('en-AU',{minimumFractionDigits:digits,maximumFractionDigits:digits});
  };
  const setText=function(id,value){const node=document.getElementById(id);if(node)node.textContent=value;};
  setText('production-kpi-metres',number(total,2)+' m');
  setText('production-kpi-days',String(productionDays));
  setText('production-kpi-average',number(productionDays?total/productionDays:0,2)+' m');
  setText('production-kpi-best',number(bestDate?dailyMap.get(bestDate):0,2)+' m');
  setText('production-kpi-best-date',bestDate?productionDisplayDate(bestDate,false):'No production in range');
  setText('production-kpi-period',from&&to?productionDisplayDate(from,true)+' – '+productionDisplayDate(to,true):'All available dates');
  setText('production-row-count',String(productionFilteredData.length));
  setText('production-chart-status',(activeProjectName||'All projects')+(contractor?' · '+contractor:''));

  destroyChart('production');
  const canvas=document.getElementById('production-chart');
  if(canvas&&chartDates.length&&typeof Chart!=='undefined'){
    charts.production=new Chart(canvas,{
      data:{
        labels:chartDates.map(function(date){return productionDisplayDate(date,true);}),
        datasets:[
          {type:'bar',label:'Daily metres',data:daily,backgroundColor:'rgba(30, 105, 160, .78)',borderColor:'#1e69a0',borderWidth:1,borderRadius:3,yAxisID:'y',order:3},
          {type:'line',label:'Cumulative',data:cumulative,borderColor:'#a8cf72',backgroundColor:'#a8cf72',borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:.2,yAxisID:'y1',order:1},
          {type:'line',label:'7-day average',data:movingAverage,borderColor:'#6842c2',backgroundColor:'#6842c2',borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:.28,yAxisID:'y',order:2}
        ]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:9,padding:18,font:{size:11}}},
          tooltip:{callbacks:{label:function(context){return context.dataset.label+': '+number(context.parsed.y,2)+' m';}}}
        },
        scales:{
          x:{grid:{display:false},ticks:{autoSkip:true,maxTicksLimit:24,maxRotation:0,font:{size:10}}},
          y:{beginAtZero:true,position:'left',title:{display:true,text:'Daily metres'},grid:{color:'rgba(148, 163, 184, .18)'}},
          y1:{beginAtZero:true,position:'right',title:{display:true,text:'Cumulative metres'},grid:{drawOnChartArea:false}}
        }
      }
    });
  }

  const body=document.getElementById('production-body');
  if(body){
    const rows=productionFilteredData.slice().sort(function(a,b){
      return productionDate(b).localeCompare(productionDate(a))||String(b.source_file||'').localeCompare(String(a.source_file||''));
    });
    body.innerHTML=rows.map(function(row){
      const source=String(row.source_file||'').replace(/\.[^.]+$/,'')||'--';
      const shift=String(row.shift||'--');
      return '<tr>'
        +'<td style="font-weight:750;color:var(--accent);">'+esc(row.hole_num||'--')+'</td>'
        +'<td>'+esc(productionDisplayDate(row.date,false))+'</td>'
        +'<td><span class="status-pill '+(shift.toLowerCase().includes('night')?'status-info':'status-warn')+'">'+esc(shift)+'</span></td>'
        +'<td title="'+attr(row.source_file||'')+'">'+esc(source)+'</td>'
        +'<td>'+esc(row.drill_rig||'--')+'</td>'
        +'<td>'+esc(productionDrillType(row))+'</td>'
        +'<td class="num">'+number(row.metres_from,2)+'</td>'
        +'<td class="num">'+number(row.metres_to,2)+'</td>'
        +'<td class="num" style="font-weight:800;">'+number(row.total_metres,2)+'</td>'
        +'</tr>';
    }).join('')||'<tr><td colspan="9"><div class="empty-state"><div class="big">--</div>No drilling production found for these filters.</div></td></tr>';
    makeTableSortable('production-table');
  }
}

function downloadProductionCsv(){
  if(!productionFilteredData.length){alert('There is no production data to export for the selected filters.');return;}
  const headers=['Hole','Date','Shift','Plod','Rig','Drill type','Depth from (m)','Depth to (m)','Total (m)','Project','Contractor'];
  const contractor=document.getElementById('production-contractor')?.value||'';
  const values=productionFilteredData.map(function(row){
    return [row.hole_num,productionDate(row),row.shift,row.source_file,row.drill_rig,productionDrillType(row),row.metres_from,row.metres_to,row.total_metres,row.project||activeProjectName,contractor];
  });
  const csv=[headers].concat(values).map(function(row){
    return row.map(function(value){return '"'+String(value==null?'':value).replace(/"/g,'""')+'"';}).join(',');
  }).join('\r\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download='daily_drill_production_'+String(activeProjectName||'all-projects').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function(){URL.revokeObjectURL(link.href);},0);
}

const CAT_COLORS={'Productive Drilling':'#27ae60','Tripping Rods':'#3498db','Circulation':'#9b59b6',
  'Repairs':'#e74c3c','Standby / Delays':'#f39c12','Travel':'#7f8c8d','Safety & Admin':'#1abc9c','Other':'#555e6b'};

function buildHoleSelector(holes){
  const sel=document.getElementById('hole-selector');
  if(!sel) return;
  holes = Array.isArray(holes) ? holes : [];
  sel.innerHTML='';
  const allBtn=document.createElement('button');
  allBtn.className='hole-btn active';allBtn.dataset.hole='all';allBtn.textContent='All Holes';
  allBtn.addEventListener('click',()=>{sel.querySelectorAll('.hole-btn').forEach(b=>b.classList.remove('active'));allBtn.classList.add('active');loadAnalytics('all');});
  sel.appendChild(allBtn);
  holes.forEach(h=>{
    const btn=document.createElement('button');btn.className='hole-btn';btn.dataset.hole=h;btn.textContent=h;
    btn.addEventListener('click',()=>{sel.querySelectorAll('.hole-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');loadAnalytics(h);});
    sel.appendChild(btn);
  });
}

function destroyChart(id){if(charts[id]){charts[id].destroy();delete charts[id];}}

async function loadAnalytics(hole){
  try{
    const url=`${API}/analytics?contractor=${encodeURIComponent(activeContractor)}&hole=${encodeURIComponent(hole)}`;
    const d=await fetch(url).then(r=>r.json());
    if(!d.kpis||Object.keys(d.kpis).length===0){
      ['kpi-total','kpi-drill','kpi-repair','kpi-delay','kpi-metres'].forEach(id=>document.getElementById(id).textContent='—');
      document.getElementById('kpi-eff').textContent='no data';
      return;
    }
    const k=d.kpis;
    document.getElementById('kpi-total').textContent=k.total_hours+' h';
    document.getElementById('kpi-drill').textContent=k.drill_hours+' h';
    document.getElementById('kpi-eff').textContent=k.efficiency+'% efficiency';
    document.getElementById('kpi-repair').textContent=k.repair_hours+' h';
    document.getElementById('kpi-delay').textContent=k.delay_hours+' h';
    document.getElementById('kpi-metres').textContent=k.total_metres+' m';
    document.querySelectorAll('.kpi')[2].className='kpi '+(k.repair_hours>=4?'crit':'good');
    document.querySelectorAll('.kpi')[3].className='kpi '+(k.delay_hours>=6?'warn':'good');
    buildDailyChart(d.daily_categories);
    buildCumulativeChart(d.drill_runs);
    buildRunChart(d.drill_runs);
    buildCostCategoryChart(d.daily_categories, d.kpis);
    renderAnomalies(d.anomalies);
    renderHeatmap(d.heatmap,d.daily_categories);
    anomaliesData=d.anomalies;
  }catch(e){console.error('Analytics error:',e);}
}

function buildDailyChart(data){
  destroyChart('daily');if(!data||!data.length)return;
  const dates=[...new Set(data.map(r=>r.date))].sort((a,b)=>dateSortKey(a)-dateSortKey(b));
  const datasets=Object.keys(CAT_COLORS).map(cat=>({
    label:cat,backgroundColor:CAT_COLORS[cat],borderWidth:0,
    data:dates.map(d=>{const r=data.find(r=>r.date===d&&r.category===cat);return r?+r.hours.toFixed(2):0;})
  })).filter(ds=>ds.data.some(v=>v>0));
  charts['daily']=new Chart(document.getElementById('chart-daily').getContext('2d'),{
    type:'bar',data:{labels:dates,datasets},
    options:{plugins:{legend:{labels:{color:'#6b7280',font:{family:'Inter',size:10}}}},
      scales:{x:{stacked:true,ticks:{color:'#6b7280',font:{size:9}},grid:{color:'#e5e7eb'}},
              y:{stacked:true,ticks:{color:'#6b7280',font:{size:9}},grid:{color:'#e5e7eb'}}},
      responsive:true,maintainAspectRatio:true}});
}

function buildCumulativeChart(runs){
  destroyChart('cumulative');if(!runs||!runs.length)return;
  charts['cumulative']=new Chart(document.getElementById('chart-cumulative').getContext('2d'),{
    type:'line',
    data:{labels:runs.map((_,i)=>i+1),datasets:[{label:'Cumulative Metres',data:runs.map(r=>r.cumulative),
      borderColor:'#315d49',backgroundColor:'rgba(49,93,73,0.08)',fill:true,tension:0.3,pointRadius:2,pointBackgroundColor:'#315d49'}]},
    options:{plugins:{legend:{display:false}},scales:{x:{ticks:{display:false},grid:{color:'#e5e7eb'}},y:{ticks:{color:'#6b7280',font:{size:9}},grid:{color:'#e5e7eb'}}},responsive:true,maintainAspectRatio:true}});
}

function buildRunChart(runs){
  destroyChart('runs');if(!runs||!runs.length)return;
  charts['runs']=new Chart(document.getElementById('chart-runs').getContext('2d'),{
    type:'bar',
    data:{labels:runs.map((_,i)=>i+1),datasets:[{label:'Metres',data:runs.map(r=>r.total_metres),backgroundColor:runs.map(r=>r.total_metres<1?'#dc2626':'#315d49'),borderWidth:0}]},
    options:{plugins:{legend:{display:false},tooltip:{callbacks:{title:function(items){const r=runs[items[0].dataIndex];return r.date+' Run#'+(items[0].dataIndex+1);},afterBody:function(items){const r=runs[items[0].dataIndex];return r.notes?[r.notes.substring(0,60)]:[]; }}}},
      scales:{x:{ticks:{display:false},grid:{color:'#e5e7eb'}},y:{ticks:{color:'#6b7280',font:{size:9}},grid:{color:'#e5e7eb'}}},responsive:true,maintainAspectRatio:true}});
}

function buildCostCategoryChart(dailyData, kpis){
  destroyChart('cost_cat');
  if(!kpis||!kpis.total_cost) return;
  var catTotals = {};
  if(dailyData) {
    dailyData.forEach(function(r) {
      catTotals[r.category] = (catTotals[r.category]||0) + r.hours;
    });
  }
  var labels = Object.keys(catTotals).filter(function(k){return catTotals[k]>0;});
  var values = labels.map(function(k){return Math.round(catTotals[k]*10)/10;});
  var colors = labels.map(function(k){return CAT_COLORS[k]||'#6b7280';});
  charts['cost_cat'] = new Chart(document.getElementById('chart-cost-cat').getContext('2d'),{
    type:'doughnut',
    data:{labels:labels, datasets:[{data:values, backgroundColor:colors, borderWidth:2, borderColor:'#fff'}]},
    options:{plugins:{legend:{position:'right',labels:{color:'#374151',font:{family:'Inter',size:11},padding:10}}},responsive:true,maintainAspectRatio:true}
  });
}

// ── Analytics Filters ─────────────────────────────────────────────────────────
const analyticsFilterToggle = document.getElementById('analytics-filter-toggle');
const analyticsFilterBody = document.getElementById('analytics-filter-body');
if(analyticsFilterToggle && analyticsFilterBody) {
  analyticsFilterToggle.addEventListener('click',function(){
    analyticsFilterToggle.classList.toggle('open');
    analyticsFilterBody.classList.toggle('open');
  });
}

function populateAnalyticsFilters(){
  fillSelect('f-an-holes', filterOpts.holes||[]);
  fillSelect('f-an-sites', filterOpts.sites||[]);
  var projSel = document.getElementById('f-an-project');
  if(projSel && typeof projects !== 'undefined'){
    var current = projSel.value;
    projSel.innerHTML = '<option value="">All Projects</option>';
    projects.forEach(function(p){
      var opt = document.createElement('option');
      opt.value = p.name; opt.textContent = p.name;
      if(p.name===current) opt.selected = true;
      projSel.appendChild(opt);
    });
  }
}

function applyAnalyticsFilters(){
  var hole = 'all';
  var selectedHoles = getSelVals('f-an-holes');
  if(selectedHoles.length === 1) hole = selectedHoles[0];
  loadAnalytics(hole);
}

function resetAnalyticsFilters(){
  selectAll('f-an-holes');
  selectAll('f-an-sites');
  var projSel = document.getElementById('f-an-project');
  if(projSel) projSel.value = '';
  document.getElementById('f-an-date-from').value = '';
  document.getElementById('f-an-date-to').value = '';
  loadAnalytics('all');
}

function renderAnomalies(anomalies){
  document.getElementById('anom-count').textContent=anomalies.length;
  const icons={critical:'🔴',warning:'🟠',caution:'🟡',info:'🔵'};
  document.getElementById('anom-body').innerHTML=anomalies.length
    ?anomalies.map(a=>`<tr><td>${esc(a.date)}</td><td>${esc(a.hole)}</td><td><span class="badge severity-${a.severity}">${icons[a.severity]||''} ${esc(a.type)}</span></td><td>${esc(a.detail)}</td></tr>`).join('')
    :`<tr><td colspan="4" style="padding:16px;color:var(--green);font-family:var(--font-mono);font-size:11px">✓ No anomalies detected</td></tr>`;
  makeTableSortable('anom-table');
}

function renderHeatmap(heatmap,daily){
  const el=document.getElementById('heatmap-container');
  if(!heatmap||!heatmap.length){el.innerHTML='<p style="color:var(--muted);font-family:var(--font-mono);font-size:11px">No data</p>';return;}
  const dates=[...new Set((daily||[]).map(r=>r.date))].sort((a,b)=>dateSortKey(a)-dateSortKey(b));
  const cats=['Repairs','Standby / Delays','Circulation'];
  const maxVal=Math.max(...heatmap.map(r=>r.hours),1);
  function hc(h){if(!h)return'#111318';const t=h/maxVal;return t<0.3?`rgba(243,156,18,${0.2+t*0.6})`:`rgba(192,57,43,${0.3+t*0.7})`;}
  let html='<table class="heatmap-table"><thead><tr><th></th>';
  dates.forEach(d=>html+=`<th>${d.split('/').slice(0,2).join('/')}</th>`);
  html+='</tr></thead><tbody>';
  cats.forEach(cat=>{
    html+=`<tr><th style="text-align:left;white-space:nowrap;padding-right:10px">${cat}</th>`;
    dates.forEach(d=>{const r=heatmap.find(r=>r.date===d&&r.category===cat);const v=r?r.hours:0;
      html+=`<td class="heatmap-cell" style="background:${hc(v)}" title="${cat} ${d}: ${v.toFixed(1)}h">${v>0.1?v.toFixed(1):''}</td>`;});
    html+='</tr>';
  });
  el.innerHTML=html+'</tbody></table>';
}

async function rationaliseAndSync() {
  var btn = document.getElementById("sync-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Rationalising...';
  try {
    var res = await fetch(API+"/reprice?contractor="+encodeURIComponent(activeContractor), {method:"POST"});
    if(!res.ok) {
      var errText = await res.text();
      toast("Rationalise failed: "+res.status+" "+errText.substring(0,100), "err");
      btn.innerHTML = "\uD83D\uDD04 Rationalise & Sync All";
      btn.disabled = false;
      return;
    }
    var d = await res.json();
    console.log("Rationalise result:", d);

    var parts = [];
    if(d.dates_fixed > 0) parts.push(d.dates_fixed+" dates fixed");
    if(d.holes_fixed > 0) parts.push(d.holes_fixed+" hole IDs fixed");
    if(d.sites_fixed > 0) parts.push(d.sites_fixed+" sites filled");
    parts.push(d.priced+" of "+d.total+" activities priced");
    if(d.locked_skipped > 0) parts.push(d.locked_skipped+" locked activities skipped");
    if(d.consumables_priced > 0) parts.push(d.consumables_priced+" of "+(d.consumables_total||0)+" consumables priced");
    if(d.consumables_locked_skipped > 0) parts.push(d.consumables_locked_skipped+" locked consumables skipped");
    if(d.consumables_error) parts.push("consumables error: "+d.consumables_error);
    toast("\u2713 "+parts.join(", "));

  } catch(e) {
    toast("Rationalise failed: "+e.message, "err");
    console.error("Rationalise error:", e);
  }

  // Always refresh all tabs regardless of rationalise result
  btn.innerHTML = '<span class="spinner"></span> Refreshing...';
  try { await loadActivities(); } catch(e) { console.error("loadActivities:", e); }
  try { await updateDbCount(); } catch(e) {}
  try { await loadConsumables(); } catch(e) { console.error("loadConsumables:", e); }
  try { await loadCrew(); } catch(e) { console.error("loadCrew:", e); }
  try { await loadCosting(); } catch(e) {}
  try { await loadInvoices(); } catch(e) {}

  btn.innerHTML = "\uD83D\uDD04 Rationalise & Sync All";
  btn.disabled = false;
}

async function repriceActivities(){
  // Just call the main sync function
  await rationaliseAndSync();
}

// ── Costing ───────────────────────────────────────────────────────────────────
async function repriceCosting(){
  const btn=document.getElementById('cost-reprice-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<span class="spinner"></span>Repricing...';}
  try{
    const res=await fetch(API+"/reprice?contractor="+encodeURIComponent(activeContractor),{method:"POST"});
    if(!res.ok){
      const txt=await res.text();
      toast("Reprice failed: "+txt.substring(0,120),"err");
      return;
    }
    const d=await res.json();
    const parts=[];
    if(d.priced!=null)parts.push((d.priced||0)+" priced");
    if(d.total!=null)parts.push((d.total||0)+" activities checked");
    if(d.locked_skipped)parts.push(d.locked_skipped+" locked skipped");
    if(d.consumables_priced)parts.push(d.consumables_priced+" consumables priced");
    if(d.consumables_locked_skipped)parts.push(d.consumables_locked_skipped+" locked consumables skipped");
    toast("✓ Repriced "+(parts.length?parts.join(", "):"costing"));
    await updateDbCount();
    await loadCosting();
  }catch(e){
    toast("Reprice failed: "+e.message,"err");
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Reprice from Rates';}
  }
}

let costingRequest=0,costingLinesRequest=0;
async function loadCosting(){
  const request=++costingRequest,scopeVersion=typeof eosScopeVersion==='undefined'?0:eosScopeVersion;
  if(WORKSPACE_APP==='eos'){for(const id of ['cost-grand','cost-drilling','cost-nondrilling','cost-metres','cost-per-m'])document.getElementById(id).textContent='—';for(const id of ['cost-hole-body','cost-date-body','cost-line-body'])document.getElementById(id).innerHTML='';}
  try{
    const url=`${API}/costing?contractor=${encodeURIComponent(activeContractor)}`;
    const response=await fetch(url);if(!response.ok)throw Error('Could not load associated charges.');
    const d=await response.json();
    if(WORKSPACE_APP!=='eos')await ensureReportBoreholes();
    if(request!==costingRequest||(typeof eosScopeVersion!=='undefined'&&scopeVersion!==eosScopeVersion))return;
    costingHolesData=Array.isArray(d.by_hole)?d.by_hole:[];
    costingDatesData=Array.isArray(d.by_date)?d.by_date:[];
    costingHolesData=costingHolesData.filter(function(r){return rowMatchesActiveProgram(r);});
    costingDatesData=costingDatesData.filter(function(r){return rowMatchesActiveProgram(r);});
    const grand=costingHolesData.reduce((s,r)=>s+(parseFloat(r.total_cost)||0),0);
    const totalDrill=costingHolesData.reduce((s,r)=>s+(parseFloat(r.drilling_cost)||0),0);
    const totalNon=costingHolesData.reduce((s,r)=>s+(parseFloat(r.non_drilling_cost)||0),0);
    const totalM=costingHolesData.reduce((s,r)=>s+(parseFloat(r.total_metres)||0),0);
    document.getElementById('cost-grand').textContent=cur(grand);
    document.getElementById('cost-drilling').textContent=cur(totalDrill);
    document.getElementById('cost-nondrilling').textContent=cur(totalNon);
    document.getElementById('cost-metres').textContent=totalM.toFixed(1)+' m';
    document.getElementById('cost-per-m').textContent=totalM>0?'$'+(grand/totalM).toFixed(2):'—';
    document.getElementById('cost-hole-count').textContent=costingHolesData.length;
    document.getElementById('cost-hole-body').innerHTML=costingHolesData.map(r=>`<tr>
      <td>${esc(r.hole_num)}</td>
      <td style="color:var(--accent)">${cur(r.total_cost)}</td>
      <td>${cur(r.drilling_cost)}</td>
      <td>${cur(r.non_drilling_cost)}</td>
      <td>${(parseFloat(r.total_metres)||0).toFixed(1)}</td>
      <td>${parseFloat(r.total_metres)>0?'$'+((parseFloat(r.total_cost)||0)/parseFloat(r.total_metres)).toFixed(2):'—'}</td>
      <td>${r.activity_count}</td></tr>`).join('')||'<tr><td colspan="7" style="padding:16px;color:var(--muted);font-family:var(--font-mono)">No priced data yet</td></tr>';
    document.getElementById('cost-date-count').textContent=costingDatesData.length;
    document.getElementById('cost-date-body').innerHTML=costingDatesData.map(r=>`<tr>
      <td>${esc(r.date)}</td><td>${esc(r.hole_num)}</td>
      <td style="color:var(--accent)">${cur(r.total_cost)}</td>
      <td>${(parseFloat(r.total_metres)||0).toFixed(1)}</td></tr>`).join('')||'<tr><td colspan="4" style="padding:16px;color:var(--muted);font-family:var(--font-mono)">No daily costs yet</td></tr>';
    // Populate cost line item filters without blowing away the user's current filter.
    const selectedCostHoles=getSelVals('f-cost-holes');
    const selectedCostDates=getSelVals('f-cost-dates');
    fillSelect('f-cost-holes',[...new Set(costingHolesData.map(r=>r.hole_num))],selectedCostHoles.length===0);
    fillSelect('f-cost-dates',[...new Set(costingDatesData.map(r=>r.date))],selectedCostDates.length===0);
    if(selectedCostHoles.length)document.querySelectorAll('#f-cost-holes option').forEach(o=>o.selected=selectedCostHoles.includes(o.value));
    if(selectedCostDates.length)document.querySelectorAll('#f-cost-dates option').forEach(o=>o.selected=selectedCostDates.includes(o.value));
    await loadCostingLines();
    ['cost-hole-table','cost-date-table'].forEach(id=>makeTableSortable(id));
  }catch(e){if(request===costingRequest&&(typeof eosScopeVersion==='undefined'||scopeVersion===eosScopeVersion))toast(e.message||'Could not load associated charges.','err');}
}

async function loadCostingLines(){
  const request=++costingLinesRequest,scopeVersion=typeof eosScopeVersion==='undefined'?0:eosScopeVersion;
  const holes=getSelVals('f-cost-holes').join(',');
  const dates=getSelVals('f-cost-dates').join(',');
  const p=new URLSearchParams({contractor:activeContractor,dates,holes});
  try{
    if(WORKSPACE_APP!=='eos')await ensureReportBoreholes();
    const response=await fetch(`${API}/activities?${p}`);if(!response.ok)throw Error('Could not load charge lines.');
    const all=await response.json();
    if(request!==costingLinesRequest||(typeof eosScopeVersion!=='undefined'&&scopeVersion!==eosScopeVersion))return;
    costingLinesData=filterRowsForActiveProgram(all).filter(r=>r.line_cost!=null&&r.is_cost_source!==false);
    document.getElementById('cost-line-count').textContent=costingLinesData.length;
    document.getElementById('cost-line-body').innerHTML=costingLinesData.map(r=>`<tr data-id="${r.id}">
      <td>${esc(r.date)}</td><td>${esc(r.hole_num)}</td>
      <td>${codeBadge(r.code)}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.notes)}">${esc(r.notes)}</td>
      <td contenteditable="true" data-col="total_metres" data-numeric="true">${r.total_metres!=null?parseFloat(r.total_metres).toFixed(2):''}</td>
      <td contenteditable="true" data-col="rate_basis" style="color:var(--muted);font-size:10px">${esc(r.rate_basis||'')}</td>
      <td contenteditable="true" data-col="unit_rate" data-numeric="true" data-recalc="true" style="color:var(--yellow);font-weight:600">${r.unit_rate!=null?parseFloat(r.unit_rate).toFixed(2):''}</td>
      <td contenteditable="true" data-col="quantity" data-numeric="true" data-recalc="true" style="color:var(--yellow);font-weight:600">${r.quantity!=null?parseFloat(r.quantity).toFixed(2):''}</td>
      <td contenteditable="true" data-col="line_cost" data-numeric="true" style="color:var(--accent);font-weight:700">${r.line_cost!=null?parseFloat(r.line_cost).toFixed(2):''}</td></tr>`).join('')
      ||'<tr><td colspan="9" style="padding:16px;color:var(--muted);font-family:var(--font-mono)">No priced rows</td></tr>';
    attachCostingLineEdits();
    makeTableSortable('cost-line-table');
  }catch(e){}
}

function attachCostingLineEdits(){
  document.getElementById('cost-line-body').querySelectorAll('[contenteditable]').forEach(cell=>{
    cell.addEventListener('blur',async()=>{
      const row=cell.closest('tr');
      const id=row.dataset.id;
      const col=cell.dataset.col;
      let val=cell.textContent.trim().replace(/[$,]/g,'');
      if(cell.dataset.numeric)val=val===''?null:parseFloat(val);
      const body={[col]:val};
      if(cell.dataset.recalc){
        const ur=parseFloat(row.querySelector('[data-col="unit_rate"]').textContent.replace(/[$,]/g,''))||0;
        const qty=parseFloat(row.querySelector('[data-col="quantity"]').textContent.replace(/[$,]/g,''))||0;
        const lineCell=row.querySelector('[data-col="line_cost"]');
        if(ur&&qty){
          const lc=parseFloat((ur*qty).toFixed(2));
          body.line_cost=lc;
          lineCell.textContent=lc.toFixed(2);
        }
      }
      try{
        const res=await fetch(`${API}/activities/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!res.ok)throw new Error('HTTP '+res.status);
        toast('✓ Cost saved');
        refreshCostingIfActive(150);
      }catch(e){
        toast('Cost save failed','err');
      }
    });
    cell.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();cell.blur();}
    });
  });
}

// ── Purchase Orders ───────────────────────────────────────────────────────────
async function loadPOs(){
  try{
    const res=await fetch(API+'/purchase_orders?project='+encodeURIComponent(activeProjectName||'')+'&program='+encodeURIComponent(activeProgram||''));
    if(!res.ok){const e=await res.json();toast(e.detail||'Failed to load POs','err');return;}
    posData=await res.json();
    if(!Array.isArray(posData)){toast('PO data error','err');return;}
    posData=posData.filter(function(r){return rowMatchesActiveProgram(r);});
    renderPOs(posData);
  }catch(e){console.error('loadPOs:',e);}
}

function renderPOs(rows){
  document.getElementById('po-count').textContent=rows.length;
  const tbody=document.getElementById('po-body');
  if(!rows.length){tbody.innerHTML='<tr><td colspan="12"><div class="empty-state"><div class="big">🧾</div>No purchase orders recorded for '+esc(activeProjectName||'this project')+'</div></td></tr>';return;}
  tbody.innerHTML=rows.map(r=>{
    const spent=parseFloat(r.spent_to_date)||0;
    const value=parseFloat(r.po_value)||0;
    const rem=value-spent;
    const pct=value>0?Math.min(spent/value*100,100).toFixed(1):'0.0';
    const bc=parseFloat(pct)>90?'var(--red)':parseFloat(pct)>70?'var(--yellow)':'var(--green)';
    const sc=r.status==='Active'?'var(--green)':r.status==='Completed'?'var(--blue)':'var(--muted)';
    return`<tr data-id="${r.id}">
      <td contenteditable="true" data-col="po_number" style="color:var(--accent);font-weight:600">${esc(r.po_number)}</td>
      <td contenteditable="true" data-col="project">${esc(r.project||'')}</td>
      <td contenteditable="true" data-col="description">${esc(r.description||'')}</td>
      <td contenteditable="true" data-col="issue_date">${esc(r.issue_date||'')}</td>
      <td contenteditable="true" data-col="expiry_date">${esc(r.expiry_date||'')}</td>
      <td contenteditable="true" data-col="po_value" data-numeric="true">${cur(value)}</td>
      <td style="color:var(--accent)">${cur(spent)}</td>
      <td style="color:${rem<0?'var(--red)':'var(--green)'}">${cur(rem)}</td>
      <td><div style="display:flex;align-items:center;gap:5px;"><div style="flex:1;height:5px;background:var(--border);border-radius:2px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${bc};"></div></div><span style="font-family:var(--font-mono);font-size:9px;color:${bc}">${pct}%</span></div></td>
      <td contenteditable="true" data-col="status" style="color:${sc}">${esc(r.status||'Active')}</td>
      <td contenteditable="true" data-col="notes" class="multiline-cell">${esc(r.notes||'')}</td>
      <td><button onclick="deletePO(${r.id})" style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:13px">✕</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[contenteditable]').forEach(cell=>{
    cell.addEventListener('blur',async()=>{
      const row=cell.closest('tr');const id=row.dataset.id;const col=cell.dataset.col;
      let val=cell.textContent.trim().replace(/[$,]/g,'');
      if(cell.dataset.numeric)val=parseFloat(val)||0;
      await fetch(`${API}/purchase_orders/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({[col]:val})});
      toast('✓ PO saved');loadPOs();
    });
  });
  makeTableSortable('po-table');
}

async function addPO(){
  const pn=document.getElementById('po-number').value.trim();
  if(!pn){toast('PO Number required','err');return;}
  try{
    const payload={
      po_number:pn,
      contractor:activeContractor,
      project:activeProjectName||'',
      program:activeProgram||'Exploration',
      description:document.getElementById('po-description').value,
      po_value:parseFloat(document.getElementById('po-value').value)||0,
      issue_date:document.getElementById('po-issue-date').value,
      expiry_date:document.getElementById('po-expiry-date').value,
      status:document.getElementById('po-status').value,
      notes:document.getElementById('po-notes').value,
    };
    console.log('Saving PO:', payload);
    const res=await fetch(`${API}/purchase_orders`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const d=await res.json();
    console.log('PO response:', res.status, d);
    if(!res.ok){toast(d.detail||'Failed to save PO — see console','err');return;}
    ['po-number','po-description','po-value','po-issue-date','po-expiry-date','po-notes'].forEach(id=>document.getElementById(id).value='');
    toast('✓ Purchase order saved');
    loadPOs();
  }catch(e){toast('Network error: '+e.message,'err');console.error('addPO error:',e);}
}

async function deletePO(id){
  if(!confirm('Delete this PO?'))return;
  await fetch(`${API}/purchase_orders/${id}`,{method:'DELETE'});
  toast('PO deleted','warn');loadPOs();
}

// ── Tenements ────────────────────────────────────────────────────────────────
function tenementStorageKey(){
  return 'drillops_tenements_'+activeContractor.replace(/\W+/g,'_');
}

function seedTenements(){
  return [
    {id:'EPC 3021',name:'Ironbark North',project:'Ironbark',status:'Granted',holder:'Exploration Co Pty Ltd',area_ha:1860,expiry:'31/12/2026',renewal_due:'30/09/2026',min_spend:450000,actual_spend:392500,next_obligation:'Annual expenditure report',x:8,y:14,w:34,h:32},
    {id:'EPC 3178',name:'Carborough West',project:'Carborough',status:'Renewal Due',holder:'Exploration Co Pty Ltd',area_ha:1245,expiry:'15/08/2026',renewal_due:'15/06/2026',min_spend:280000,actual_spend:301250,next_obligation:'Renewal application',x:44,y:18,w:28,h:26},
    {id:'MDL 901',name:'Codrilla Corridor',project:'Codrilla',status:'Granted',holder:'JV Operations',area_ha:740,expiry:'22/03/2027',renewal_due:'22/01/2027',min_spend:180000,actual_spend:96500,next_obligation:'Rent payment',x:26,y:55,w:42,h:24}
  ];
}

async function loadTenements(){
  const saved=localStorage.getItem(tenementStorageKey());
  try{
    const res=await fetch(`${API}/tenements?contractor=${encodeURIComponent(activeContractor)}`);
    if(res.ok){
      const rows=await res.json();
      tenementsData=Array.isArray(rows)&&rows.length?rows:(saved?JSON.parse(saved):seedTenements());
      tenementsData=tenementsData.filter(function(r){return rowMatchesActiveProgram(r);});
      saveTenements();
      renderTenements();
      return;
    }
  }catch(e){}
  try{
    tenementsData=saved?JSON.parse(saved):seedTenements();
  }catch(e){
    tenementsData=seedTenements();
  }
  tenementsData=tenementsData.filter(function(r){return rowMatchesActiveProgram(r);});
  saveTenements();
  renderTenements();
}

function saveTenements(){
  localStorage.setItem(tenementStorageKey(), JSON.stringify(tenementsData));
}

function parseTenDate(value){
  const parts=String(value||'').split(/[\/\-]/).map(Number);
  if(parts.length<3||parts.some(isNaN))return null;
  const normal=parts[0]>31?[parts[2],parts[1],parts[0]]:parts;
  return new Date(normal[2],normal[1]-1,normal[0]);
}

function tenementRisk(t){
  const dates=[parseTenDate(t.renewal_due),parseTenDate(t.expiry)].filter(Boolean);
  if(!dates.length)return {cls:'ok',label:'Current',days:null};
  const next=new Date(Math.min(...dates.map(d=>d.getTime())));
  const today=new Date(); today.setHours(0,0,0,0);
  const days=Math.ceil((next-today)/86400000);
  if(days<0)return {cls:'crit',label:'Overdue',days};
  if(days<=90)return {cls:'warn',label:days+' days',days};
  return {cls:'ok',label:'Current',days};
}

function renderTenements(){
  const rows=Array.isArray(tenementsData)?tenementsData:[];
  document.getElementById('ten-count').textContent=rows.length;
  const granted=rows.filter(r=>(r.status||'')==='Granted').length;
  const due=rows.filter(r=>tenementRisk(r).cls==='warn').length;
  const overdue=rows.filter(r=>tenementRisk(r).cls==='crit').length;
  const variance=rows.reduce((s,r)=>s+((parseFloat(r.actual_spend)||0)-(parseFloat(r.min_spend)||0)),0);
  document.getElementById('ten-kpi-total').textContent=rows.length;
  document.getElementById('ten-kpi-granted').textContent=granted;
  document.getElementById('ten-kpi-due').textContent=due;
  document.getElementById('ten-kpi-overdue').textContent=overdue;
  document.getElementById('ten-kpi-variance').textContent=cur(variance);

  document.getElementById('tenement-map').innerHTML=rows.map((r,i)=>{
    const risk=tenementRisk(r);
    const x=r.x??(8+(i*18)%70),y=r.y??(12+(i*15)%62),w=r.w??28,h=r.h??24;
    return `<div class="tenement-block ${risk.cls==='ok'?'':risk.cls}" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;">${esc(r.id)}<br><span style="font-weight:600;">${esc(r.project||'')}</span></div>`;
  }).join('');

  const watch=rows.slice().sort((a,b)=>(tenementRisk(a).days??9999)-(tenementRisk(b).days??9999)).slice(0,5);
  document.getElementById('tenement-alerts').innerHTML=watch.length?watch.map(r=>{
    const risk=tenementRisk(r);
    return `<div class="tenement-alert"><div><strong>${esc(r.id)} ${esc(r.name||'')}</strong><br><span>${esc(r.next_obligation||'Next obligation')} · Renewal ${esc(r.renewal_due||'—')}</span></div><div class="tenement-risk ${risk.cls}">${esc(risk.label)}</div></div>`;
  }).join(''):'<div class="empty-state">No tenements yet</div>';

  const tbody=document.getElementById('ten-body');
  tbody.innerHTML=rows.length?rows.map((r,i)=>{
    const spend=(parseFloat(r.actual_spend)||0)-(parseFloat(r.min_spend)||0);
    const risk=tenementRisk(r);
    return `<tr>
      <td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${esc(r.project)}</td>
      <td><span class="tenement-risk ${risk.cls}">${esc(r.status||'')}</span></td>
      <td>${esc(r.holder)}</td><td>${Number(r.area_ha||0).toLocaleString()}</td>
      <td>${esc(r.expiry)}</td><td>${esc(r.renewal_due)}</td>
      <td>${cur(r.min_spend)}</td><td>${cur(r.actual_spend)}</td>
      <td style="color:${spend<0?'var(--red)':'var(--green)'};font-weight:700;">${cur(spend)}</td>
      <td>${esc(r.next_obligation)}</td>
      <td><button class="btn-csv" onclick="deleteTenement(${i})">Remove</button></td>
    </tr>`;
  }).join(''):'<tr><td colspan="13"><div class="empty-state">No tenements yet</div></td></tr>';
  makeTableSortable('ten-table');
}

function clearTenementForm(){
  ['ten-id','ten-name','ten-project','ten-holder','ten-area','ten-expiry','ten-renewal','ten-min-spend','ten-actual-spend','ten-obligation'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const status=document.getElementById('ten-status');if(status)status.value='Granted';
}

async function addTenement(){
  const id=document.getElementById('ten-id').value.trim();
  if(!id){toast('Enter a tenement ID','err');return;}
  const existing=tenementsData.findIndex(t=>String(t.id).toLowerCase()===id.toLowerCase());
  const item={
    id,
    name:document.getElementById('ten-name').value.trim(),
    project:document.getElementById('ten-project').value.trim(),
    status:document.getElementById('ten-status').value,
    holder:document.getElementById('ten-holder').value.trim(),
    area_ha:parseFloat(document.getElementById('ten-area').value)||0,
    expiry:document.getElementById('ten-expiry').value.trim(),
    renewal_due:document.getElementById('ten-renewal').value.trim(),
    min_spend:parseFloat(document.getElementById('ten-min-spend').value)||0,
    actual_spend:parseFloat(document.getElementById('ten-actual-spend').value)||0,
    next_obligation:document.getElementById('ten-obligation').value.trim(),
    x:8+((tenementsData.length*17)%68),y:12+((tenementsData.length*13)%58),w:28,h:24
  };
  try{
    const res=await fetch(`${API}/tenements`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({contractor:activeContractor},item))});
    if(res.ok){
      clearTenementForm();toast('Tenement saved');await loadTenements();return;
    }
  }catch(e){}
  if(existing>=0)tenementsData[existing]=Object.assign({},tenementsData[existing],item);
  else tenementsData.push(item);
  saveTenements();renderTenements();clearTenementForm();toast('Tenement saved');
}

async function deleteTenement(index){
  const item=tenementsData[index];
  if(!item||!confirm('Remove '+item.id+' from this register?'))return;
  try{
    await fetch(`${API}/tenements/${encodeURIComponent(item.id)}?contractor=${encodeURIComponent(activeContractor)}`,{method:'DELETE'});
  }catch(e){}
  tenementsData.splice(index,1);
  saveTenements();renderTenements();toast('Tenement removed','warn');
}

// ── Rates ─────────────────────────────────────────────────────────────────────
function buildRateYearSelector(years){
  const sel=document.getElementById('rate-year-selector');sel.innerHTML='';
  years.forEach((y,i)=>{
    const btn=document.createElement('button');btn.className='hole-btn'+(i===0?' active':'');btn.textContent=y;btn.dataset.year=y;
    btn.addEventListener('click',()=>{sel.querySelectorAll('.hole-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');activeRateYear=y;loadRates(y);});
    sel.appendChild(btn);
  });
  if(years.length){activeRateYear=years[0];loadRates(years[0]);}
}

let rateRequest=0;
async function initRatesTab(){
  const scopeVersion=typeof eosScopeVersion==='undefined'?0:eosScopeVersion,contractor=activeContractor;
  if(WORKSPACE_APP==='eos'){drillingRatesData=[];hourlyRatesData=[];consumableRatesData=[];renderDrillingRates([]);renderHourlyRates([]);renderConsumableRates([]);}
  try{
    const d=await fetch(`${API}/rates/years?contractor=${encodeURIComponent(activeContractor)}`).then(r=>r.json());
    if(contractor!==activeContractor||(typeof eosScopeVersion!=='undefined'&&scopeVersion!==eosScopeVersion))return;
    buildRateYearSelector(d.years||[]);
  }catch(e){}
}

async function loadRates(year){
  const request=++rateRequest,scopeVersion=typeof eosScopeVersion==='undefined'?0:eosScopeVersion;
  try{
    const [dr,hr,cr]=await Promise.all([
      fetch(`${API}/rates/drilling?contractor=${encodeURIComponent(activeContractor)}&year=${year}`).then(r=>r.json()),
      fetch(`${API}/rates/hourly?contractor=${encodeURIComponent(activeContractor)}&year=${year}`).then(r=>r.json()),
      fetch(`${API}/rates/consumables?contractor=${encodeURIComponent(activeContractor)}&year=${year}`).then(r=>r.json()),
    ]);
    if(request!==rateRequest||(typeof eosScopeVersion!=='undefined'&&scopeVersion!==eosScopeVersion))return;
    drillingRatesData=dr;hourlyRatesData=hr;consumableRatesData=cr;
    renderDrillingRates(dr);renderHourlyRates(hr);renderConsumableRates(cr);
  }catch(e){}
}

var consumableRatesData=[];

function renderDrillingRates(rows){
  document.getElementById('dr-count').textContent=rows.length;
  document.getElementById('dr-body').innerHTML=rows.map(r=>`
    <tr data-id="${r.id}">
      <td contenteditable="true" data-col="year">${esc(r.year)}</td>
      <td contenteditable="true" data-col="bit_type">${esc(r.bit_type)}</td>
      <td contenteditable="true" data-col="depth_from" data-numeric="true">${r.depth_from}</td>
      <td contenteditable="true" data-col="depth_to" data-numeric="true">${r.depth_to}</td>
      <td contenteditable="true" data-col="rate" data-numeric="true">$${r.rate.toFixed(2)}</td>
      <td><button onclick="deleteRate('drilling',${r.id})" style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:12px">\u2715</button></td>
    </tr>`).join('')||'<tr><td colspan="6" style="padding:16px;color:var(--muted);">No rates for this year</td></tr>';
  attachRateEdits('drilling');makeTableSortable('dr-table');
}

function renderHourlyRates(rows){
  document.getElementById('hr-count').textContent=rows.length;
  document.getElementById('hr-body').innerHTML=rows.map(r=>`
    <tr data-id="${r.id}">
      <td contenteditable="true" data-col="year">${esc(r.year)}</td>
      <td contenteditable="true" data-col="code">${esc(r.code)}</td>
      <td contenteditable="true" data-col="description">${esc(r.description||'')}</td>
      <td contenteditable="true" data-col="rate" data-numeric="true">$${r.rate.toFixed(2)}</td>
      <td contenteditable="true" data-col="unit">${esc(r.unit)}</td>
      <td><button onclick="deleteRate('hourly',${r.id})" style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:12px">\u2715</button></td>
    </tr>`).join('')||'<tr><td colspan="6" style="padding:16px;color:var(--muted);">No rates for this year</td></tr>';
  attachRateEdits('hourly');makeTableSortable('hr-table');
}

function renderConsumableRates(rows){
  document.getElementById('cr-count').textContent=rows.length;
  document.getElementById('cr-body').innerHTML=rows.map(r=>`
    <tr data-id="${r.id}">
      <td contenteditable="true" data-col="year">${esc(r.year)}</td>
      <td contenteditable="true" data-col="product" style="font-weight:600;">${esc(r.product)}</td>
      <td contenteditable="true" data-col="description">${esc(r.description||'')}</td>
      <td contenteditable="true" data-col="unit_price" data-numeric="true" style="color:var(--accent);font-weight:600;">$${(r.unit_price||0).toFixed(2)}</td>
      <td contenteditable="true" data-col="unit">${esc(r.unit||'each')}</td>
      <td><button onclick="deleteRate('consumables',${r.id})" style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:12px">\u2715</button></td>
    </tr>`).join('')||'<tr><td colspan="6" style="padding:16px;color:var(--muted);">No consumable rates for this year</td></tr>';
  attachRateEdits('consumables');makeTableSortable('cr-table');
}

function attachRateEdits(table){
  var id=table==='drilling'?'dr-body':table==='hourly'?'hr-body':'cr-body';
  var endpoint=table==='consumables'?'rates/consumables':'rates/'+table;
  document.getElementById(id).querySelectorAll('[contenteditable]').forEach(cell=>{
    cell.addEventListener('blur',async()=>{
      const row=cell.closest('tr');const rid=row.dataset.id;const col=cell.dataset.col;
      let val=cell.textContent.trim().replace(/^\$/,'');
      if(cell.dataset.numeric)val=parseFloat(val)||0;
      await fetch(`${API}/${endpoint}/${rid}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({[col]:val})});
      toast('\u2713 Rate saved');
    });
  });
}

async function deleteRate(table,id){
  if(!confirm('Delete this rate?'))return;
  await fetch(`${API}/rates/${table}/${id}`,{method:'DELETE'});
  toast('Rate deleted','warn');loadRates(activeRateYear);
}

async function addDrillingRate(){
  const year=activeRateYear||'2025';
  await fetch(`${API}/rates/drilling`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contractor:activeContractor,year,bit_type:'HQ_HQ3',depth_from:0,depth_to:100,rate:0})});
  loadRates(year);toast('New row added');
}

async function addHourlyRate(){
  const year=activeRateYear||'2025';
  await fetch(`${API}/rates/hourly`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contractor:activeContractor,year,code:'NEW_CODE',description:'',rate:0,unit:'hour'})});
  loadRates(year);toast('New row added');
}

async function addConsumableRate(){
  const year=activeRateYear||'2025';
  await fetch(`${API}/rates/consumables`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contractor:activeContractor,year:year,product:'NEW PRODUCT',description:'',unit_price:0,unit:'each'})});
  loadRates(year);toast('New consumable added');
}

async function syncContractRates(){
  const year=activeRateYear||'2025';
  const btn=document.getElementById('sync-contract-rates-btn');
  if(!['Allianz Drilling','Mitchells Drilling'].includes(activeContractor)){toast('Contract sync is only available for configured drilling contractors','err');return;}
  if(!confirm('Replace '+activeContractor+' drilling/hourly rates for '+year+' with the contract rate template? You can edit the rows after syncing.'))return;
  btn.disabled=true;
  btn.textContent='Syncing contract...';
  try{
    const res=await fetch(`${API}/rates/allianz-contract-sync`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:activeContractor,year:year})
    });
    const d=await res.json();
    if(!res.ok)throw new Error(d.detail||JSON.stringify(d).slice(0,180));
    toast('Contract rates synced: '+d.drilling_rates+' drilling, '+d.hourly_rates+' hourly');
    await loadRates(year);
  }catch(e){
    toast('Contract sync failed: '+(e.message||e),'err');
  }finally{
    btn.disabled=false;
    btn.textContent='Sync contract rates';
  }
}

async function recalculateDatabaseFromRates(){
  const btn=document.getElementById('recalc-db-btn');
  if(!btn){toast('Recalculate button not found','err');return;}
  if(!confirm('Recalculate all EOS activity costs, consumables, and invoice matching for '+activeContractor+' using the current schedule of rates?'))return;
  btn.disabled=true;
  btn.textContent='Recalculating...';
  try{
    const res=await fetch(`${API}/rates/recalculate-database`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:activeContractor})
    });
    const d=await res.json();
    if(!res.ok)throw new Error(d.detail||JSON.stringify(d).slice(0,180));
    const cleanup=d.cleanup||{};
    const reprice=d.reprice||{};
    const topups=reprice.minimum_shift_topups||{};
    const match=d.invoice_match_summary||{};
    const lockedText=(reprice.locked_skipped||reprice.consumables_locked_skipped)?' ('+(reprice.locked_skipped||0)+' locked activities skipped, '+(reprice.consumables_locked_skipped||0)+' locked consumables skipped)':'';
    const topupText=topups.inserted?(', '+topups.inserted+' minimum shift top-ups added'):'';
    toast('Recalculated '+(reprice.priced||0)+' activities, '+(reprice.consumables_priced||0)+' consumables, '+(d.invoices_rematched||0)+' invoices'+topupText+lockedText);
    alert(
      'Database recalculated for '+activeContractor+'\\n\\n'
      +'Activities repriced: '+(reprice.priced||0)+' / '+(reprice.total||0)+'\\n'
      +'Locked activities skipped: '+(reprice.locked_skipped||0)+'\\n'
      +'Consumables repriced: '+(reprice.consumables_priced||0)+' / '+(reprice.consumables_total||0)+'\\n'
      +'Locked consumables skipped: '+(reprice.consumables_locked_skipped||0)+'\\n'
      +'CorePlan adjustment rows removed: '+(cleanup.deleted_adjustments||0)+'\\n'
      +'Minimum shift duration rows zeroed: '+(cleanup.zeroed_minimum_shift_rows||0)+'\\n'
      +'Imported minimum shift rows adjusted: '+(reprice.minimum_shift_rows_adjusted||0)+'\\n'
      +'Minimum shift top-ups refreshed: '+(topups.deleted||0)+' removed, '+(topups.inserted||0)+' added\\n'
      +'Invoices rematched: '+(d.invoices_rematched||0)+'\\n'
      +'Invoice lines accounted for: '+(match.accounted_lines||0)+' / '+(match.line_count||0)+'\\n'
      +'Invoice variance: '+cur(match.variance||0)
    );
    await Promise.allSettled([loadRates(activeRateYear||'2025'),loadActivities(),loadInvoices()]);
  }catch(e){
    toast('Recalculation failed: '+(e.message||e),'err');
  }finally{
    btn.disabled=false;
    btn.textContent='Recalculate database';
  }
}

async function copyRatesYear(){
  const ny=document.getElementById('new-year-input').value.trim();
  if(!ny||!/^\d{4}$/.test(ny)){toast('Enter valid 4-digit year','err');return;}
  for(const r of drillingRatesData)
    await fetch(`${API}/rates/drilling`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contractor:activeContractor,year:ny,bit_type:r.bit_type,depth_from:r.depth_from,depth_to:r.depth_to,rate:r.rate})});
  for(const r of hourlyRatesData)
    await fetch(`${API}/rates/hourly`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contractor:activeContractor,year:ny,code:r.code,description:r.description,rate:r.rate,unit:r.unit})});
  for(const r of consumableRatesData)
    await fetch(`${API}/rates/consumables`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contractor:activeContractor,year:ny,product:r.product,description:r.description,unit_price:r.unit_price,unit:r.unit})});
  toast(`\u2713 All rates copied to ${ny}`);
  document.getElementById('new-year-input').value='';
  initRatesTab();
}

// ── Column Sorting ────────────────────────────────────────────────────────────
const sortState={};
function makeTableSortable(tableId){
  var table=document.getElementById(tableId);if(!table)return;
  var thead=table.querySelector('thead tr');if(!thead)return;

  // Add sort click handlers
  [...thead.children].forEach(function(th,i){
    if(th.dataset.sortBound)return;th.dataset.sortBound='1';
    th.style.cursor='pointer';
    th.addEventListener('click',function(){
      var st=sortState[tableId]||{col:-1,dir:1};
      var dir=st.col===i?-st.dir:1;
      sortState[tableId]={col:i,dir:dir};
      [...thead.children].forEach(function(h){h.textContent=h.textContent.replace(' \u25b2','').replace(' \u25bc','');});
      th.textContent+=dir===1?' \u25b2':' \u25bc';
      var tbody=table.querySelector('tbody');
      [...tbody.querySelectorAll('tr')].sort(function(a,b){
        var av=(a.children[i]?a.children[i].textContent:'').trim().replace(/[$,]/g,'');
        var bv=(b.children[i]?b.children[i].textContent:'').trim().replace(/[$,]/g,'');
        var ad=dateSortKey(av),bd=dateSortKey(bv);
        if(ad&&bd&&ad!==0&&bd!==0)return(ad-bd)*dir;
        var an=parseFloat(av),bn=parseFloat(bv);
        if(!isNaN(an)&&!isNaN(bn))return(an-bn)*dir;
        return av.localeCompare(bv)*dir;
      }).forEach(function(r){tbody.appendChild(r);});
    });
  });

  // Add filter row if not already present
  if(table.querySelector('.filter-row'))return;
  var filterRow=document.createElement('tr');
  filterRow.className='filter-row';
  filterRow.style.cssText='background:var(--bg3);';
  [...thead.children].forEach(function(th,i){
    var td=document.createElement('td');
    td.style.cssText='padding:4px 4px;';
    // Skip columns that are buttons/actions (last column usually)
    var headerText=(th.textContent||'').replace(' \u25b2','').replace(' \u25bc','').trim();
    if(headerText && headerText!=='' && i<thead.children.length-1){
      var input=document.createElement('input');
      input.type='text';
      input.placeholder='\u2315';
      input.style.cssText='width:100%;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:10px;outline:none;background:#fff;color:var(--text);font-family:var(--font);';
      input.addEventListener('input',function(){
        var val=this.value.toLowerCase();
        var tbody=table.querySelector('tbody');
        [...tbody.querySelectorAll('tr')].forEach(function(row){
          var cell=row.children[i];
          var text=(cell?cell.textContent:'').toLowerCase();
          if(!val || text.indexOf(val)>=0){
            row.style.display='';
          } else {
            // Only hide if ALL other filter inputs also pass
            var allPass=true;
            filterRow.querySelectorAll('input').forEach(function(inp,idx){
              if(inp===input)return;
              var fv=inp.value.toLowerCase();
              if(fv){
                var c=row.children[idx];
                var ct=(c?c.textContent:'').toLowerCase();
                if(ct.indexOf(fv)<0) allPass=false;
              }
            });
            row.style.display=allPass&&(!val||text.indexOf(val)>=0)?'':'none';
          }
        });
        // Re-evaluate all rows with all filters
        var filters=[];
        filterRow.querySelectorAll('input').forEach(function(inp,idx){
          if(inp.value) filters.push({idx:idx,val:inp.value.toLowerCase()});
        });
        [...tbody.querySelectorAll('tr')].forEach(function(row){
          var show=true;
          filters.forEach(function(f){
            var cell=row.children[f.idx];
            var text=(cell?cell.textContent:'').toLowerCase();
            if(text.indexOf(f.val)<0) show=false;
          });
          row.style.display=show?'':'none';
        });
      });
      td.appendChild(input);
    }
    filterRow.appendChild(td);
  });
  var theadEl=table.querySelector('thead');
  theadEl.appendChild(filterRow);
}

// ── CSV Download ──────────────────────────────────────────────────────────────
function downloadCSV(type){
  const map={activities:[activitiesData,'activities.csv'],consumables:[consumablesData,'consumables.csv'],
    crew:[crewData,'crew.csv'],anomalies:[anomaliesData,'anomalies.csv'],
    costing_holes:[costingHolesData,'costing_holes.csv'],costing_dates:[costingDatesData,'costing_dates.csv'],
    costing_lines:[costingLinesData,'costing_lines.csv'],pos:[posData,'purchase_orders.csv'],
    invoices:[invoicesData,'invoices.csv'],discrepancies:[discrepanciesData,'reconciliation_discrepancies.csv'],
    boreholes:[boreholesCsvData,'boreholes_2026.csv'],borehole_details:[boreholeDetailsCsvData,'borehole_details.csv'],tenements:[tenementsData,'tenements.csv']};
  const [rows,filename]=map[type]||[null,null];
  if(!rows||!rows.length)return;
  const keys=Object.keys(rows[0]);
  const csv=[keys.join(','),...rows.map(r=>keys.map(k=>`"${String(r[k]??'').replace(/"/g,'""')}"`).join(','))].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=filename;a.click();
}

// ── Invoice import (sidebar) ──────────────────────────────────────────────────
const invSidebarInput = document.getElementById('inv-file-input-sidebar');
const invSidebarBtn   = document.getElementById('inv-import-btn-sidebar');
let invSidebarFiles   = [];

invSidebarInput?.addEventListener('change', e=>{
  invSidebarFiles=[...e.target.files];
  invSidebarBtn.disabled=invSidebarFiles.length===0;
  invSidebarBtn.textContent=invSidebarFiles.length>0?`Import ${invSidebarFiles.length} invoice(s)`:'Import Invoices';
});

document.getElementById('inv-drop-zone-sidebar')?.addEventListener('dragover',e=>{e.preventDefault();});
document.getElementById('inv-drop-zone-sidebar')?.addEventListener('drop',e=>{
  e.preventDefault();
  invSidebarFiles=[...e.dataTransfer.files].filter(f=>f.name.endsWith('.pdf'));
  invSidebarBtn.disabled=invSidebarFiles.length===0;
  invSidebarBtn.textContent=invSidebarFiles.length>0?`Import ${invSidebarFiles.length} invoice(s)`:'Import Invoices';
});

invSidebarBtn?.addEventListener('click', async()=>{
  if(!invSidebarFiles.length)return;
  invSidebarBtn.disabled=true;invSidebarBtn.innerHTML='<span class="spinner"></span>Importing…';
  const log=document.getElementById('inv-import-log-sidebar');log.innerHTML='';
  let importedContractor='';
  for(const file of invSidebarFiles){
    const fd=new FormData();fd.append('file',file);fd.append('contractor',activeContractor);fd.append('project',activeProjectName||'');fd.append('program',activeProgram||'');
    try{
      const d=await fetch(`${API}/invoices/import`,{method:'POST',body:fd}).then(r=>r.json());
      if(d.status==='imported'){
        importedContractor=d.contractor||importedContractor;
        log.innerHTML+=`<div style="color:var(--green)">✓ ${d.invoice_number} — $${(d.total_aud||0).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})}${invoiceMatchImportText(d.match_summary)}</div>`;
      }else
        log.innerHTML+=`<div style="color:var(--yellow)">⚠ ${file.name} already imported</div>`;
    }catch(e){log.innerHTML+=`<div style="color:var(--red)">✗ ${file.name}</div>`;}
  }
  invSidebarBtn.textContent='Import Invoices';invSidebarBtn.disabled=false;
  invSidebarFiles=[];invSidebarInput.value='';
  await loadProjectContractors();
  ensureActiveContractorInProgram();
  buildContractorSwitcher();
  // Refresh invoices tab if open
  if(document.getElementById('page-invoices').classList.contains('active')) await loadInvoices(importedContractor);
});

// ── OCR Import (handwritten drill logs via OpenAI) ────────────────────────────
var ocrFileInput = document.getElementById('ocr-file-input');
var ocrImportBtn = document.getElementById('ocr-import-btn');
var ocrPendingFiles = [];
var ocrPreviewIndex = 0;
var ocrCurrentFile = null;
var ocrCurrentData = null;
var ocrCurrentIntegrityCheck = null;
var ocrReviewActive = false;
var ocrContractRates = [];
var ocrImportScope = null;
var ocrPreviewContractor = '';
var ocrPricingDirty = false;

if(ocrFileInput) {
  ocrFileInput.addEventListener('change', function(e) {
    ocrPendingFiles = [].slice.call(e.target.files);
    ocrImportBtn.disabled = ocrPendingFiles.length === 0;
    ocrImportBtn.textContent = ocrPendingFiles.length > 0 ? 'AI Read & Preview ' + ocrPendingFiles.length + ' file(s)' : 'AI Read & Preview';
  });
}

if(document.getElementById('ocr-drop-zone')) {
  document.getElementById('ocr-drop-zone').addEventListener('dragover', function(e) { e.preventDefault(); });
  document.getElementById('ocr-drop-zone').addEventListener('drop', function(e) {
    e.preventDefault();
    if (ocrReviewActive) return;
    ocrPendingFiles = [].slice.call(e.dataTransfer.files).filter(function(f) { return f.name.endsWith('.pdf'); });
    ocrImportBtn.disabled = ocrPendingFiles.length === 0;
    ocrImportBtn.textContent = ocrPendingFiles.length > 0 ? 'AI Read & Preview ' + ocrPendingFiles.length + ' file(s)' : 'AI Read & Preview';
  });
}

function ocrInput(value, field, rowIndex) {
  var rowAttr = rowIndex === undefined ? '' : ' data-ocr-row="' + rowIndex + '"';
  return '<input type="text" data-ocr-field="' + field + '"' + rowAttr + ' value="' + attr(value == null ? '' : value) + '" style="width:100%;min-width:72px;padding:6px;border:1px solid var(--border);border-radius:4px;font:12px var(--font);">';
}

function readOcrPreviewData() {
  var panel = document.getElementById('ocr-preview-panel');
  var reviewed = Object.assign({}, ocrCurrentData || {});
  panel.querySelectorAll('[data-ocr-header]').forEach(function(input) {
    reviewed[input.getAttribute('data-ocr-header')] = input.value.trim();
  });
  reviewed.activities = [].slice.call(panel.querySelectorAll('tbody tr[data-ocr-activity]')).map(function(row) {
    var activity = {};
    row.querySelectorAll('[data-ocr-field]').forEach(function(input) {
      var field = input.getAttribute('data-ocr-field');
      var value = input.value.trim();
      if (field === 'metres_from' || field === 'metres_to' || field === 'total_metres' || field === 'quantity') {
        activity[field] = value === '' || !isFinite(Number(value)) ? null : Number(value);
      } else {
        activity[field] = value;
      }
    });
    return activity;
  });
  return reviewed;
}

function renderOcrIntegrityCheck(check) {
  var warnings = (check && check.warnings) || [];
  if (!warnings.length) return '<div style="margin:0 0 12px;padding:8px 10px;background:#effaf4;color:#17663c;border-radius:4px;font-size:11px;">OCR integrity check passed. Still compare important values with the source PDF.</div>';
  return '<div style="margin:0 0 12px;padding:8px 10px;background:#fff7e6;color:#8a5600;border-radius:4px;font-size:11px;">'
    + '<strong>Review ' + warnings.length + ' item(s) before import</strong>'
    + warnings.map(function(w) { return '<div style="margin-top:4px;">• ' + esc(w.issue || '') + ' ' + esc(w.recommendation || '') + '</div>'; }).join('')
    + '</div>';
}

function renderDepcoOcrPrice(pricing){
  if(!pricing)return '<span style="color:#a05a00;">No suggestion yet — refresh code suggestions.</span>';
  const reason=String(pricing.rate_basis||'');
  const needsReview=reason.startsWith('DEPCO review required:');
  return '<strong>'+esc(pricing.code||'Needs code review')+'</strong>'
    +'<div>'+(pricing.unit_rate==null?'Rate pending':cur(pricing.unit_rate))+' / '+(pricing.line_cost==null?'Amount pending':cur(pricing.line_cost))+'</div>'
    +(needsReview?'<div role="status" style="margin-top:4px;color:#a05a00;font-size:11px;">'+esc(reason)+'</div>':'<details><summary>Pricing details</summary><small>'+esc(reason)+'</small></details>');
}
function depcoOcrContractWarning(data,rates){
  const items=(data&&data.activities)||[];
  if(rates.length)return '';
  if(!items.length)return '';
  return '<div role="alert" style="margin:8px 0 12px;padding:12px;background:#fff7e6;border:1px solid #e9bd65;color:#805000;border-radius:6px;font-size:12px;">'
    +'<strong>DEPCO code suggestions unavailable for this project.</strong> No active contract rate lines were found for '
    +esc(ocrImportScope.project)+' / '+esc(ocrImportScope.program)
    +'. Open Cost Contracts and link an active DEPCO contract with its approved rates to this exact project and program. Do not use another project\'s rates. Then refresh suggestions.</div>';
}

async function refreshDepcoOcrPrices(){
  try{
    const data=readOcrPreviewData();
    const response=await fetch(API+'/import/depco/suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ocr_data:data,project:ocrImportScope.project,program:ocrImportScope.program})});
    if(!response.ok)throw new Error(await response.text());
    const result=await response.json();
    if(JSON.stringify(data)!==JSON.stringify(readOcrPreviewData())){toast('The report changed while matching. Refresh suggestions again.','err');return;}
    ocrCurrentData=result.ocr_data;ocrContractRates=result.contract_rates||[];ocrPricingDirty=false;renderOcrPreview();
  }catch(error){toast('Could not refresh code suggestions: '+error.message,'err');}
}

function importCodeGroup(rate){
  const text=String(rate.cost_code||'')+' '+String(rate.name||'');
  if(rate.section==='Consumables')return 'Consumables';
  if(rate.section==='Personnel'||/SUPERVISOR|ACCOMMODATION/i.test(text))return 'Personnel & accommodation';
  if(/STANDBY/i.test(text))return 'Standby & delays';
  if(/TRAVEL|MOBILISATION|DEMOBILISATION|MOB_DEMOB/i.test(text))return 'Travel & mobilisation';
  if(/SAFETY|TRAINING|INSPECTION/i.test(text))return 'Safety, training & inspections';
  if(rate.section==='Equipment')return 'Equipment';
  if(/_PCD_/i.test(text))return 'Drilling — PCD';
  if(/_BLADE_/i.test(text))return 'Drilling — blade';
  if(/_HAMMER_/i.test(text))return 'Drilling — hammer';
  if(/_CORE_/i.test(text))return 'Drilling — coring';
  if(/SETUP|PACKUP/i.test(text))return 'Setup & pack-up';
  if(/CASING|CEMENT|GROUT/i.test(text))return 'Casing & cementing';
  if(/REPAIR|MAINTENANCE|RIG_TESTING/i.test(text))return 'Repairs, maintenance & testing';
  if(/WATER_COLLECT|CON_COLLECT/i.test(text))return 'Water & supply collection';
  if(/DRILL|BORING|RIG_RATE|TRIPPING|REAMING|CLEANOUT|CIRCULATION|MUD_MIXING|FISING|FISHING|WATER_FLOW/i.test(text))return 'Drilling operations';
  return 'Other activities';
}
function groupedImportCodeOptions(rates,current){
  const order=['Drilling — PCD','Drilling — blade','Drilling — hammer','Drilling — coring','Drilling operations','Setup & pack-up','Travel & mobilisation','Standby & delays','Safety, training & inspections','Casing & cementing','Water & supply collection','Repairs, maintenance & testing','Equipment','Personnel & accommodation','Consumables','Other activities'];
  return order.map(group=>{
    const items=rates.filter(r=>importCodeGroup(r)===group).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),undefined,{numeric:true})||Number(a.depth_from||0)-Number(b.depth_from||0)||String(a.cost_code).localeCompare(String(b.cost_code),undefined,{numeric:true}));
    if(!items.length)return '';
    return '<optgroup label="'+attr(group)+'">'+items.map(r=>'<option value="'+attr(r.cost_code)+'"'+(current===r.cost_code?' selected':'')+'>'+esc(r.name)+(r.depth_from!=null?' ('+esc(r.depth_from)+'–'+esc(r.depth_to==null?'':r.depth_to)+' m)':'')+' ['+esc(r.cost_code)+'] — '+(r.charge==null?'Price needs review':cur(r.charge)+'/'+esc(r.unit||''))+'</option>').join('')+'</optgroup>';
  }).join('');
}
function renderOcrPreview() {
  var panel = document.getElementById('ocr-preview-panel');
  var data = ocrCurrentData || {};
  var depcoPricing = (ocrPreviewContractor||ocrImportScope.contractor)==='DEPCO Drilling' || /(^|[^a-z0-9])depco(?=$|[^a-z0-9])/i.test(ocrCurrentFile.name);
  var fields = [
    ['hole_num', 'Hole number'], ['date', 'Date (DD/MM/YYYY)'], ['client', 'Client'],
    ['location', 'Location'], ['rig_no', 'Rig'], ['shift', 'Shift'], ['driller', 'Driller']
  ];
  var html = '<div style="border:1.5px solid var(--accent);border-radius:var(--radius-sm);padding:14px;background:#fff;">'
    + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px;">'
    + '<div><strong>Review before import</strong><div style="font-size:11px;color:var(--muted);margin-top:3px;">' + esc(ocrCurrentFile ? ocrCurrentFile.name : '') + ' \u00b7 File ' + (ocrPreviewIndex + 1) + ' of ' + ocrPendingFiles.length + '</div></div>'
    + '<span style="font-size:11px;color:#a05a00;background:#fff7e6;padding:4px 7px;border-radius:4px;">Nothing saved yet</span></div>'
    + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px;">';
  fields.forEach(function(item) {
    html += '<label style="font-size:10px;color:var(--muted);">' + item[1]
      + '<input type="text" data-ocr-header="' + item[0] + '"'+(item[0]==='date'?' placeholder="DD/MM/YYYY" inputmode="numeric"':'')+' value="' + attr(data[item[0]] == null ? '' : data[item[0]]) + '" style="display:block;width:100%;margin-top:3px;padding:7px;border:1px solid var(--border);border-radius:4px;font:12px var(--font);"></label>';
  });
  html += '</div>' + renderOcrIntegrityCheck(ocrCurrentIntegrityCheck) + (depcoPricing?depcoOcrContractWarning(data,ocrContractRates):'') + '<div style="font-size:11px;font-weight:600;margin-bottom:6px;">Activities (' + ((data.activities || []).length) + ')</div>'
    + '<div style="overflow-x:auto;"><table style="width:100%;min-width:760px;font-size:11px;"><thead><tr><th>Comments</th>'+ (depcoPricing?'<th>Contract code &amp; price (ex GST)</th>':'') +'<th>From</th><th>To</th><th>Total</th><th>m From</th><th>m To</th><th>Total m</th><th>Bit / core</th><th>Diameter</th><th></th></tr></thead><tbody>';
  (data.activities || []).forEach(function(activity, index) {
    html += '<tr data-ocr-activity="' + index + '"><td style="min-width:220px;">' + ocrInput(activity.comments, 'comments', index) + '</td>'
      + (depcoPricing?'<td style="min-width:260px;max-width:300px;white-space:normal;overflow-wrap:anywhere;"><label>Suggested code — change if needed<select aria-label="Activity '+(index+1)+' contract code" data-ocr-field="code" style="display:block;width:100%;max-width:260px;"><option value="">Suggest automatically</option>'+groupedImportCodeOptions(ocrContractRates,activity.code)+'</select></label><div data-ocr-pricing>'+renderDepcoOcrPrice(activity.pricing)+'</div>'
      + '<details><summary>Quantity (days/items)</summary>'+ocrInput(activity.quantity, 'quantity', index)+'</details></td>':'')
      + '<td>' + ocrInput(activity.time_from, 'time_from', index) + '</td><td>' + ocrInput(activity.time_to, 'time_to', index) + '</td>'
      + '<td>' + ocrInput(activity.total_time, 'total_time', index) + '</td><td>' + ocrInput(activity.metres_from, 'metres_from', index) + '</td>'
      + '<td>' + ocrInput(activity.metres_to, 'metres_to', index) + '</td><td>' + ocrInput(activity.total_metres, 'total_metres', index) + '</td>'
      + '<td>' + ocrInput(activity.bit_type, 'bit_type', index) + '</td><td>' + ocrInput(activity.diameter, 'diameter', index) + '</td>'
      + '<td><button type="button" data-remove-ocr-row="' + index + '" title="Remove row" style="border:none;background:none;color:var(--red);cursor:pointer;font-size:16px;">\u00d7</button></td></tr>';
  });
  html += '</tbody></table></div><div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap;">'
    + '<button type="button" id="ocr-add-row" style="padding:7px 10px;background:#fff;border:1px solid var(--border);border-radius:4px;cursor:pointer;">+ Add activity</button>'
    + '<div style="display:flex;gap:8px;"><button type="button" style="display:'+(depcoPricing?'inline-block':'none')+'" id="ocr-refresh-prices" onclick="refreshDepcoOcrPrices()">Refresh code suggestions</button><button type="button" id="ocr-skip-preview" style="padding:8px 12px;background:#fff;border:1px solid var(--border);border-radius:4px;cursor:pointer;">Skip file</button>'
    + '<button type="button" id="ocr-confirm-import" style="padding:8px 12px;background:var(--green);color:#fff;border:none;border-radius:4px;font-weight:600;cursor:pointer;">Import reviewed data</button></div></div></div>';
  panel.innerHTML = html;
  panel.style.display = 'block';
  panel.oninput = function(){if(!depcoPricing)return;ocrPricingDirty=true;panel.querySelectorAll('[data-ocr-pricing]').forEach(function(cell){cell.textContent='Edited — refresh suggestions';});};
  panel.onchange = function(e){if(depcoPricing&&e.target.matches('select[data-ocr-field="code"]'))refreshDepcoOcrPrices();};

  panel.onclick = function(e) {
    var removeButton = e.target.closest('[data-remove-ocr-row]');
    if (removeButton) {
      ocrCurrentData = readOcrPreviewData();
      ocrCurrentData.activities.splice(parseInt(removeButton.getAttribute('data-remove-ocr-row'), 10), 1);
      ocrPricingDirty = depcoPricing;
      renderOcrPreview();
    }
  };
  document.getElementById('ocr-add-row').onclick = function() {
    ocrCurrentData = readOcrPreviewData();
    ocrCurrentData.activities.push({comments:'',time_from:'',time_to:'',total_time:'',metres_from:null,metres_to:null,total_metres:null});
    ocrPricingDirty = depcoPricing;
    renderOcrPreview();
  };
  document.getElementById('ocr-skip-preview').onclick = function() {
    document.getElementById('ocr-import-log').innerHTML += '<div style="color:var(--yellow);">\u26a0 ' + esc(ocrCurrentFile.name) + ' skipped</div>';
    ocrPreviewIndex++;
    previewNextOcrFile();
  };
  document.getElementById('ocr-confirm-import').onclick = importReviewedOcrFile;
}

async function importReviewedOcrFile() {
  var button = document.getElementById('ocr-confirm-import');
  var log = document.getElementById('ocr-import-log');
  if(ocrPricingDirty){await refreshDepcoOcrPrices();if(!ocrPricingDirty)toast('Suggestions refreshed. Review the updated prices, then import.');return;}
  ocrCurrentData = readOcrPreviewData();
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>Importing...';
  document.getElementById('ocr-skip-preview').disabled = true;
  document.getElementById('ocr-add-row').disabled = true;
  document.querySelectorAll('[data-remove-ocr-row]').forEach(function(removeButton) { removeButton.disabled = true; });
  var fd = new FormData();
  fd.append('file', ocrCurrentFile);
  fd.append('contractor', ocrImportScope.contractor);
  fd.append('program', ocrImportScope.program);
  fd.append('project', ocrImportScope.project);
  fd.append('client', ocrImportScope.client);
  fd.set('contractor',ocrPreviewContractor||ocrImportScope.contractor);
  fd.append('ocr_data', JSON.stringify(ocrCurrentData));
  try {
    var res = await fetch(API + '/import/ocr', {method:'POST', body:fd});
    var d = await res.json();
    if (!res.ok) throw new Error(d.detail || 'Import failed');
    if (d.status === 'imported') {
      log.innerHTML += '<div style="color:var(--green);">\u2713 ' + esc(d.hole_num || ocrCurrentFile.name) + ' \u2014 ' + esc(d.date) + ' \u2014 ' + d.rows + ' reviewed activities imported</div>';
      if(d.pricing_summary)log.innerHTML+='<div>'+d.pricing_summary.priced+' lines priced; '+d.pricing_summary.review+' need code/rate review.</div>';
      (d.integrity_check && d.integrity_check.warnings || []).forEach(function(w) {
        log.innerHTML += '<div style="color:#8a5600;margin-left:10px;">• ' + esc(w.issue || '') + '</div>';
      });
    } else {
      log.innerHTML += '<div style="color:var(--yellow);">\u26a0 ' + esc(ocrCurrentFile.name) + ' already imported</div>';
    }
  } catch (err) {
    log.innerHTML += '<div style="color:var(--red);">\u2717 ' + esc(ocrCurrentFile.name) + ': ' + esc(err.message) + '</div>';
    button.disabled = false;
    button.textContent = 'Retry reviewed import';
    document.getElementById('ocr-skip-preview').disabled = false;
    document.getElementById('ocr-add-row').disabled = false;
    document.querySelectorAll('[data-remove-ocr-row]').forEach(function(removeButton) { removeButton.disabled = false; });
    return;
  }
  ocrPreviewIndex++;
  await updateDbCount();
  previewNextOcrFile();
}

function finishOcrPreviews() {
  document.getElementById('ocr-preview-panel').style.display = 'none';
  document.getElementById('ocr-preview-panel').innerHTML = '';
  ocrPendingFiles = [];
  ocrCurrentFile = null;
  ocrCurrentData = null;
  ocrCurrentIntegrityCheck = null;
  ocrReviewActive = false;
  if (ocrFileInput) ocrFileInput.value = '';
  if (ocrFileInput) ocrFileInput.disabled = false;
  ocrImportBtn.textContent = 'AI Read & Preview';
  ocrImportBtn.disabled = true;
}

async function previewNextOcrFile() {
  if (ocrPreviewIndex >= ocrPendingFiles.length) {
    finishOcrPreviews();
    return;
  }
  ocrCurrentFile = ocrPendingFiles[ocrPreviewIndex];
  ocrPreviewContractor = '';
  ocrImportBtn.innerHTML = '<span class="spinner"></span>AI reading...';
  var log = document.getElementById('ocr-import-log');
  log.innerHTML += '<div style="color:var(--accent);">\u23f3 Previewing ' + esc(ocrCurrentFile.name) + ' with OpenAI...</div>';
  var fd = new FormData();
  fd.append('file', ocrCurrentFile);
  fd.append('contractor', ocrImportScope.contractor);
  fd.append('project', ocrImportScope.project);
  fd.append('program', ocrImportScope.program);
  try {
    var res = await fetch(API + '/import/ocr/preview', {method:'POST', body:fd});
    var d = await res.json();
    if (!res.ok) throw new Error(d.detail || 'Preview failed');
    ocrPreviewContractor=d.contractor||ocrImportScope.contractor;
    ocrCurrentData = d.ocr_data || {activities:[]};
    ocrContractRates = d.contract_rates || [];
    ocrPricingDirty = false;
    ocrCurrentIntegrityCheck = d.integrity_check || null;
    renderOcrPreview();
  } catch (err) {
    log.innerHTML += '<div style="color:var(--red);">\u2717 ' + esc(ocrCurrentFile.name) + ': ' + esc(err.message) + '</div>';
    ocrPreviewIndex++;
    previewNextOcrFile();
  }
}

if(ocrImportBtn) {
  ocrImportBtn.addEventListener('click', function() {
    if (!ocrPendingFiles.length) return;
    const scope=selectedImportScope();
    if(!scope.client||!scope.project){toast('Select the client and project for these DDRs','err');return;}
    ocrImportScope={project:scope.project.name,client:scope.client.name,program:projectProgram(scope.project),contractor:activeContractor};
    ocrReviewActive = true;
    ocrImportBtn.disabled = true;
    if (ocrFileInput) ocrFileInput.disabled = true;
    document.getElementById('ocr-import-log').innerHTML = '';
    ocrPreviewIndex = 0;
    previewNextOcrFile();
  });
}

async function auditImportedOcr() {
  var button = document.getElementById('ocr-audit-btn');
  var log = document.getElementById('ocr-import-log');
  if (!button || !log) return;
  button.disabled = true;
  button.textContent = 'Auditing...';
  log.innerHTML = '<div style="color:var(--muted);">Checking stored OCR rows. Dates are review-only.</div>';
  try {
    var res = await fetch(API + '/imports/ocr-integrity-audit', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({contractor: activeContractor, limit: 500})
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'OCR audit failed');
    log.innerHTML = '<div style="color:' + (data.issues ? '#8a5600' : 'var(--green)') + ';">Checked ' + data.checked + ' source file(s); ' + data.needs_review + ' need review; ' + data.issues + ' issue(s).</div>';
    (data.results || []).forEach(function(result) {
      (result.warnings || []).forEach(function(warning) {
        log.innerHTML += '<div style="margin-left:10px;">• ' + esc(result.filename) + ': ' + esc(warning.issue || '') + '</div>';
      });
    });
  } catch (error) {
    log.innerHTML = '<div style="color:var(--red);">Audit failed: ' + esc(error.message || error) + '</div>';
  } finally {
    button.disabled = false;
    button.textContent = 'Audit imported OCR';
  }
}

async function applySafeOcrFixes() {
  var button = document.getElementById('ocr-safe-fix-btn');
  var log = document.getElementById('ocr-import-log');
  if (!button || !log || !confirm('Apply only safe OCR fixes for ' + activeContractor + '? This standardises known site spelling and clears a four-digit year stored as an activity code. Dates and blank rows will not be changed.')) return;
  button.disabled = true;
  button.textContent = 'Applying...';
  try {
    var res = await fetch(API + '/imports/ocr-integrity-fixes', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({contractor: activeContractor, apply: true})
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Safe OCR fixes failed');
    log.innerHTML = '<div style="color:var(--green);">Applied ' + data.changed + ' safe OCR fix(es).</div>';
    (data.changes || []).forEach(function(change) {
      log.innerHTML += '<div style="margin-left:10px;">• Activity ' + esc(change.id) + ': ' + esc(Object.keys(change.updates || {}).join(', ')) + '</div>';
    });
    log.innerHTML += '<div style="color:var(--muted);">' + esc(data.message || '') + '</div>';
    if (data.changed) await loadActivities();
  } catch (error) {
    log.innerHTML = '<div style="color:var(--red);">Fix failed: ' + esc(error.message || error) + '</div>';
  } finally {
    button.disabled = false;
    button.textContent = 'Apply safe fixes';
  }
}

var ocrAuditButton = document.getElementById('ocr-audit-btn');
var ocrSafeFixButton = document.getElementById('ocr-safe-fix-btn');
if (ocrAuditButton) ocrAuditButton.addEventListener('click', auditImportedOcr);
if (ocrSafeFixButton) ocrSafeFixButton.addEventListener('click', applySafeOcrFixes);

// ── Invoices ──────────────────────────────────────────────────────────────────
let invoicesData = [], discrepanciesData = [];
let invPendingFiles = [];
let invoiceBreakdownLines = [];
let selectedInvoiceBreakdownId = null;

function invoiceMatchImportText(summary) {
  if(!summary || !summary.total) return '';
  var accounted = (parseInt(summary.exact || 0) || 0) + (parseInt(summary.close || 0) || 0);
  var missing = parseInt(summary.no_eos || 0) || 0;
  var errors = parseInt(summary.errors || 0) || 0;
  var variance = parseFloat(summary.variance || 0) || 0;
  return ' · cleared '+accounted+'/'+summary.total+' · errors '+errors+' · unsupported '+missing+' · difference '+cur(variance);
}

function invoiceMatchClass(status) {
  status = status || 'pending';
  if(status === 'exact_match') return 'match-exact';
  if(status === 'close_match') return 'match-close';
  if(status === 'no_eos_data' || status === 'no_weekly_evidence' || status === 'supporting_document_required') return 'match-missing';
  if(status === 'rate_error' || status === 'quantity_error' || status === 'amount_error') return 'match-over';
  if(status.indexOf('over') >= 0) return 'match-over';
  if(status.indexOf('under') >= 0) return 'match-under';
  return 'match-pending';
}

function invoiceMatchLabel(status) {
  var labels = {
    exact_match:'Cleared', close_match:'Close match', no_eos_data:'No source data',
    no_weekly_evidence:'No weekly evidence', supporting_document_required:'Supporting document required',
    rate_error:'Rate error', quantity_error:'Quantity error', amount_error:'Amount error'
  };
  return labels[status] || (status || 'pending').replace(/_/g,' ');
}

// Invoice import controls are optional; the current UI uses the sidebar uploader.
const invImportToggle = document.getElementById('inv-import-toggle');
const invImportBody = document.getElementById('inv-import-body');
if(invImportToggle && invImportBody) {
  invImportToggle.addEventListener('click',()=>{
    invImportToggle.classList.toggle('open');
    invImportBody.classList.toggle('open');
  });
}

// Invoice file input
const invFileInput = document.getElementById('inv-file-input');
const invImportBtn = document.getElementById('inv-import-btn');
const invDropZone  = document.getElementById('inv-drop-zone');

if(invFileInput && invImportBtn && invDropZone) {
  invFileInput.addEventListener('change',e=>{
    invPendingFiles=[...e.target.files];
    invImportBtn.disabled=invPendingFiles.length===0;
    invImportBtn.textContent=invPendingFiles.length>0?`Import ${invPendingFiles.length} invoice(s)`:'Import Invoices';
  });
  invDropZone.addEventListener('dragover',e=>{e.preventDefault();invDropZone.style.borderColor='var(--accent)';});
  invDropZone.addEventListener('dragleave',()=>invDropZone.style.borderColor='');
  invDropZone.addEventListener('drop',e=>{
    e.preventDefault();invDropZone.style.borderColor='';
    invPendingFiles=[...e.dataTransfer.files].filter(f=>f.name.endsWith('.pdf'));
    invImportBtn.disabled=invPendingFiles.length===0;
    invImportBtn.textContent=invPendingFiles.length>0?`Import ${invPendingFiles.length} invoice(s)`:'Import Invoices';
  });

  invImportBtn.addEventListener('click',async()=>{
    if(!invPendingFiles.length)return;
    invImportBtn.disabled=true;invImportBtn.innerHTML='<span class="spinner"></span>Importing...';
    const log=document.getElementById('inv-import-log');
    if(log) log.innerHTML='';
    let importedContractor='';
    for(const file of invPendingFiles){
      const fd=new FormData();fd.append('file',file);fd.append('contractor',activeContractor);fd.append('project',activeProjectName||'');fd.append('program',activeProgram||'');
      try{
        const d=await fetch(`${API}/invoices/import`,{method:'POST',body:fd}).then(r=>r.json());
        if(log) {
          if(d.status==='imported'){
            importedContractor=d.contractor||importedContractor;
            log.innerHTML+=`<div style="color:var(--green)">✓ ${d.invoice_number} - ${cur(d.total_aud)} (${d.line_count} lines)${invoiceMatchImportText(d.match_summary)}</div>`;
          }else
            log.innerHTML+=`<div style="color:var(--yellow)">⚠ ${file.name} (already imported)</div>`;
        }
      }catch(e){if(log) log.innerHTML+=`<div style="color:var(--red)">✗ ${file.name}</div>`;}
    }
    invImportBtn.textContent='Import Invoices';invImportBtn.disabled=false;
    invPendingFiles=[];invFileInput.value='';
    await loadProjectContractors();
    ensureActiveContractorInProgram();
    buildContractorSwitcher();
    await loadInvoices(importedContractor);
  });
}

function populateManualInvoiceForm(programChanged){
  var programSel = document.getElementById('manual-inv-program');
  var program = (programSel && programSel.value) || activeProgram || 'Exploration';
  if(programSel) programSel.value = program;
  var csel = document.getElementById('manual-inv-contractor');
  if(csel){
    var current = csel.value || activeContractor;
    var availableContractors=invoiceContractorsForWorkspace(program);
    csel.innerHTML = availableContractors.map(function(c){
      return '<option value="'+attr(c.name)+'">'+esc(c.name)+'</option>';
    }).join('');
    var selected=availableContractors.find(function(c){return c.name.toLowerCase()===String(current||'').toLowerCase();});
    csel.value=selected?selected.name:(availableContractors[0]&&availableContractors[0].name)||'';
  }
  var psel = document.getElementById('manual-inv-project');
  if(psel){
    psel.innerHTML='<option value="'+attr(activeProjectName||'')+'">'+esc(activeProjectName||'No project selected')+'</option>';
    psel.value=activeProjectName||'';
  }
  var date = document.getElementById('manual-inv-date');
  if(date && !date.value) date.value = new Date().toISOString().slice(0,10);
}

function manualInvoiceNumber(id){
  var el = document.getElementById(id);
  var n = parseFloat(String((el && el.value) || '').replace(/[$,]/g,''));
  return Number.isFinite(n) ? n : 0;
}

function updateManualInvoiceTotals(amountEdited){
  var qty = manualInvoiceNumber('manual-inv-qty') || 1;
  var unit = manualInvoiceNumber('manual-inv-unit');
  var amountEl = document.getElementById('manual-inv-amount');
  var amount = manualInvoiceNumber('manual-inv-amount');
  if(!amountEdited && unit > 0){
    amount = Number((qty * unit).toFixed(2));
    if(amountEl) amountEl.value = amount.toFixed(2);
  }
  var gst = Number((amount * 0.1).toFixed(2));
  var total = Number((amount + gst).toFixed(2));
  var gstEl = document.getElementById('manual-inv-gst');
  var totalEl = document.getElementById('manual-inv-total');
  if(gstEl) gstEl.value = amount ? gst.toFixed(2) : '';
  if(totalEl) totalEl.value = amount ? total.toFixed(2) : '';
}

function clearManualInvoiceForm(){
  ['manual-inv-number','manual-inv-po','manual-inv-description','manual-inv-unit','manual-inv-amount','manual-inv-gst','manual-inv-total'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.value = '';
  });
  var qty = document.getElementById('manual-inv-qty');
  if(qty) qty.value = '1';
  var status = document.getElementById('manual-inv-status');
  if(status) status.value = 'Unpaid';
  var category = document.getElementById('manual-inv-category');
  if(category) category.value = '';
  populateManualInvoiceForm();
}

async function createManualInvoice(){
  populateManualInvoiceForm();
  updateManualInvoiceTotals();
  var status = (document.getElementById('manual-inv-status') || {}).value || 'Unpaid';
  var total = manualInvoiceNumber('manual-inv-total');
  var payload = {
    contractor: (document.getElementById('manual-inv-contractor') || {}).value || activeContractor,
    project: activeProjectName||'',
    program: (document.getElementById('manual-inv-program') || {}).value || activeProgram || 'Exploration',
    invoice_number: ((document.getElementById('manual-inv-number') || {}).value || '').trim(),
    invoice_date: ((document.getElementById('manual-inv-date') || {}).value || '').trim(),
    po_reference: ((document.getElementById('manual-inv-po') || {}).value || '').trim(),
    status: status,
    description: ((document.getElementById('manual-inv-description') || {}).value || '').trim(),
    category: (document.getElementById('manual-inv-category') || {}).value || '',
    quantity: manualInvoiceNumber('manual-inv-qty') || 1,
    unit_price: manualInvoiceNumber('manual-inv-unit'),
    amount: manualInvoiceNumber('manual-inv-amount'),
    gst: manualInvoiceNumber('manual-inv-gst'),
    total_aud: total,
    amount_paid: status === 'Paid' ? total : 0,
    amount_due: status === 'Paid' ? 0 : total
  };
  if(!payload.invoice_number || !payload.description){
    toast('Invoice number and description are required','err');
    return;
  }
  if(payload.total_aud <= 0){
    toast('Enter a subtotal or unit price before adding the line','err');
    return;
  }
  try{
    var res = await fetch(API+'/invoices/manual', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(await res.text());
    toast('Manual invoice line added');
    var csel = document.getElementById('inv-contractor-filter');
    if(csel) csel.value = payload.contractor;
    clearManualInvoiceForm();
    await loadProjectContractors();
    await loadInvoices();
  }catch(e){
    toast('Manual invoice failed: '+((e && e.message) || 'not saved'),'err');
  }
}

async function loadInvoices(preferredContractor){
  try{
    populateManualInvoiceForm();
    // The invoice register inherits the selected workspace project. Contractor
    // remains a useful secondary filter because a project can have many suppliers.
    var invoiceContractors = invoiceContractorsForWorkspace().map(function(c){ return c.name; });
    if(activeContractor && !invoiceContractors.includes(activeContractor)) invoiceContractors.push(activeContractor);
    var results = await Promise.all(invoiceContractors.map(function(name){
      return fetch(API+'/invoices?contractor='+encodeURIComponent(name)+'&project='+encodeURIComponent(activeProjectName||''))
        .then(function(r){ return r.ok ? r.json() : []; })
        .catch(function(){ return []; });
    }));
    invoicesData = results.flat();
    if(!Array.isArray(invoicesData)) invoicesData = [];
    if(activeProjectName) {
      invoicesData = invoicesData.filter(function(invoice){
        return invoice.project && projectNamesMatch(invoice.project, activeProjectName);
      });
    }

    // Apply client-side filters
    var cfilt = preferredContractor || document.getElementById('inv-contractor-filter').value;
    var sfilt = document.getElementById('inv-status-filter').value;
    var filtered = invoicesData;
    if(cfilt) filtered = filtered.filter(function(r){ return (r.contractor||'') === cfilt; });
    if(sfilt) filtered = filtered.filter(function(r){ return (r.status||'') === sfilt; });

    // Populate contractor filter
    var contractors = {};
    invoicesData.forEach(function(r){ if(r.contractor) contractors[r.contractor] = true; });
    var csel = document.getElementById('inv-contractor-filter');
    var cv = cfilt;
    csel.innerHTML = '<option value="">All Contractors</option>';
    Object.keys(contractors).sort().forEach(function(c){
      csel.innerHTML += '<option value="'+esc(c)+'"'+(c===cv?' selected':'')+'>'+esc(c)+'</option>';
    });

    renderInvoices(filtered);
  }catch(e){ console.error('loadInvoices:',e); }
}

function renderInvoices(rows){
  if(!Array.isArray(rows)) rows = [];
  document.getElementById('inv-count').textContent = rows.length;

  var totalInv = rows.reduce(function(s,r){return s+(parseFloat(r.total_aud)||0);},0);
  var totalPaid = rows.reduce(function(s,r){return s+(parseFloat(r.amount_paid)||0);},0);
  var totalDue = rows.reduce(function(s,r){return s+(parseFloat(r.amount_due)||0);},0);
  var queryCount = rows.filter(function(r){return r.status==='Query';}).length;

  document.getElementById('inv-kpi-total').textContent = cur(totalInv);
  document.getElementById('inv-kpi-paid').textContent = cur(totalPaid);
  document.getElementById('inv-kpi-due').textContent = cur(totalDue);
  document.getElementById('inv-kpi-count').textContent = rows.length;
  document.getElementById('inv-kpi-query').textContent = queryCount;

  // Build PO options per contractor for dropdown
  var STATUS_CLR = {Paid:'#16a34a',Unpaid:'#dc2626',Query:'#d97706',Rejected:'#6b7280',Approved:'#16a34a','Not Approved':'#dc2626'};
  var STATUS_OPTS = ['Unpaid','Paid','Query','Rejected','Approved','Not Approved'];
  var MONTH_OPTS = ['','01/2025','02/2025','03/2025','04/2025','05/2025','06/2025','07/2025','08/2025','09/2025','10/2025','11/2025','12/2025',
                    '01/2026','02/2026','03/2026','04/2026','05/2026','06/2026','07/2026','08/2026','09/2026','10/2026','11/2026','12/2026'];

  document.getElementById('inv-body').innerHTML = rows.map(function(r){
    var sc = STATUS_CLR[r.status] || '#6b7280';
    var statusOpts = STATUS_OPTS.map(function(s){
      return '<option value="'+s+'"'+(s===r.status?' selected':'')+'>'+s+'</option>';
    }).join('');
    var monthOpts = MONTH_OPTS.map(function(m){
      var label = m || '— Select —';
      return '<option value="'+m+'"'+(m===(r.billing_month||'')?' selected':'')+'>'+label+'</option>';
    }).join('');
    var accounted = (parseInt(r.exact_matches || 0) || 0) + (parseInt(r.close_matches || 0) || 0);
    var errorCount = parseInt(r.error_count || 0) || 0;
    var lineSummary = r.line_count ? '<div style="font-size:10px;color:'+(errorCount?'var(--red)':'var(--green)')+';margin-top:2px;">'+accounted+'/'+r.line_count+' cleared'+(errorCount?' · '+errorCount+' error'+(errorCount===1?'':'s'):'')+'</div>' : '';
    var hasPdf = r.source_file && String(r.source_file).indexOf('manual:') !== 0;
    var isManual = r.source_file && String(r.source_file).indexOf('manual:') === 0;
    return '<tr data-inv-id="'+r.id+'"'+(Number(r.id)===Number(selectedInvoiceBreakdownId)?' class="active"':'')+'>'
      +'<td contenteditable="true" data-col="invoice_number" style="color:var(--accent);font-weight:700;">'+esc(r.invoice_number||'')+'</td>'
      +'<td contenteditable="true" data-col="contractor" style="font-size:12px;">'+esc(r.contractor||'')+'</td>'
      +'<td contenteditable="true" data-col="project" style="font-size:12px;">'+esc(r.project||'')+'</td>'
      +'<td contenteditable="true" data-col="invoice_date">'+esc(r.invoice_date||'')+'</td>'
      +'<td><select onchange="saveInvField('+r.id+',&apos;billing_month&apos;,this.value)" style="font-size:12px;padding:3px 6px;border:1.5px solid var(--border);border-radius:4px;outline:none;background:#fff;color:var(--text);font-family:var(--font);min-width:100px;">'+monthOpts+'</select></td>'
      +'<td contenteditable="true" data-col="po_reference" style="font-size:12px;">'+esc(r.po_reference||'')+'</td>'
      +'<td contenteditable="true" data-col="subtotal" data-num="true">'+((r.subtotal||0)>0?(r.subtotal).toLocaleString("en-AU",{minimumFractionDigits:2}):'')+'</td>'
      +'<td contenteditable="true" data-col="gst" data-num="true">'+((r.gst||0)>0?(r.gst).toLocaleString("en-AU",{minimumFractionDigits:2}):'')+'</td>'
      +'<td contenteditable="true" data-col="total_aud" data-num="true" style="color:var(--accent);font-weight:700;">'+((r.total_aud||0)>0?(r.total_aud).toLocaleString("en-AU",{minimumFractionDigits:2}):'')+'</td>'
      +'<td contenteditable="true" data-col="amount_paid" data-num="true" style="color:var(--green);">'+((r.amount_paid||0)>0?(r.amount_paid).toLocaleString("en-AU",{minimumFractionDigits:2}):'')+'</td>'
      +'<td style="color:'+((r.amount_due||0)>0?'var(--red)':'var(--muted)')+';">'+cur(r.amount_due)+'</td>'
      +'<td><select onchange="saveInvField('+r.id+',&apos;status&apos;,this.value)" style="font-size:11px;background:'+sc+'18;color:'+sc+';border:1.5px solid '+sc+';border-radius:12px;padding:2px 8px;outline:none;font-family:var(--font);">'+statusOpts+'</select></td>'
      +'<td contenteditable="true" data-col="query_notes" class="multiline-cell" style="font-size:11px;color:var(--muted);">'+esc(r.query_notes||'')+'</td>'
      +'<td style="font-size:11px;color:var(--muted);text-align:center;">v'+(r.version||1)+'</td>'
      +'<td style="display:flex;gap:4px;align-items:center;">'
        +(r.id&&hasPdf?'<button onclick="viewInvoicePdf('+r.id+')" style="background:transparent;border:1.5px solid var(--accent);color:var(--accent);cursor:pointer;font-size:10px;padding:2px 6px;border-radius:4px;font-family:var(--font);">PDF</button>':'')
        +(r.id&&isManual?'<button class="invoice-paperclip" onclick="openInvoiceAttachments('+r.id+')" title="Manage attachments" aria-label="Manage attachments">&#128206;<span class="invoice-paperclip-count">'+(parseInt(r.attachment_count||0)||'')+'</span></button>':'')
        +(r.id?'<button onclick="loadInvoiceBreakdown('+r.id+')" style="background:transparent;border:1.5px solid var(--border);color:var(--text2);cursor:pointer;font-size:10px;padding:2px 6px;border-radius:4px;font-family:var(--font);">Breakdown</button>':'')
        +lineSummary
        +'<button onclick="deleteInvoice('+r.id+')" style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:13px;">\u2715</button>'
      +'</td></tr>';
  }).join('') || '<tr><td colspan="16" style="padding:20px;color:var(--muted);text-align:center;">No invoices — import via the Import Data tab</td></tr>';

  // Wire up inline edits
  document.getElementById('inv-body').querySelectorAll('[contenteditable]').forEach(function(cell){
    cell.addEventListener('blur', function(){
      var row = cell.closest('tr');
      var invId = row.dataset.invId;
      var col = cell.dataset.col;
      var val = cell.textContent.trim().replace(/[$,]/g,'');
      if(cell.dataset.num) val = val===''?null:parseFloat(val);
      // Increment version on any edit
      saveInvField(parseInt(invId), col, val, true);
    });
  });
  makeTableSortable('inv-table');
}

function syncInvoiceLocal(invId, patch) {
  var row = invoicesData.find(function(r){ return Number(r.id) === Number(invId); });
  if(row) Object.assign(row, patch);
  return row;
}

async function saveInvField(invId, field, value, bumpVersion) {
  try {
    var body = {};
    body[field] = value;
    if(bumpVersion) body.version = null; // server will increment
    if(field === 'status') {
      var inv = invoicesData.find(function(r){ return Number(r.id) === Number(invId); });
      var total = inv ? (parseFloat(inv.total_aud) || 0) : 0;
      if(value === 'Paid' && total > 0) {
        body.amount_paid = total;
        body.amount_due = 0;
      } else if(value === 'Unpaid' && total > 0) {
        body.amount_paid = 0;
        body.amount_due = total;
      }
    }
    var res = await fetch(API+'/invoices/'+encodeURIComponent(invId), {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if(!res.ok) throw new Error(await res.text());
    var saved = await res.json().catch(function(){ return {}; });
    if(saved && saved.version) body.version = saved.version;
    syncInvoiceLocal(invId, body);
    toast('\u2713 Saved');
    if(field === 'status' || field === 'amount_paid' || field === 'amount_due' || field === 'total_aud') loadInvoices();
  } catch(e) { toast('Save failed: '+((e&&e.message)||'change was not saved'),'err'); }
}

async function deleteInvoice(id){
  if(!confirm('Delete this invoice?'))return;
  await fetch(API+'/invoices/'+id,{method:'DELETE'});
  toast('Invoice deleted','warn');
  loadInvoices();
}

function viewInvoicePdf(invoiceId) {
  window.open(API+'/invoices/'+invoiceId+'/pdf', '_blank');
}

function renderExplorationMetresSummary(){
  const el=document.getElementById('exploration-metres-summary');
  const note=document.getElementById('exploration-metres-note');
  const title=document.getElementById('exploration-metres-title');
  if(title)title.textContent=activeWorkspaceProgramLabel()+' Drilling Metres';
  if(!el)return;
  const data=explorationMetresSummaryData;
  const allSites=Array.isArray(data&&data.sites)?data.sites:[];
  const reportProject=String((selectedPeriod().project||activeProjectName)||'').trim();
  const sites=reportProject?allSites.filter(function(site){
    return projectNamesMatch(site.site_name||'',reportProject)
      ||normalizeProjectName(site.site_code)===normalizeProjectName(reportProject);
  }):allSites;
  el.classList.toggle('single-site',sites.length===1);
  if(!sites.length){
    el.innerHTML='<div class="exploration-metres-card"><div class="empty-state">Annual exploration metres are unavailable for '+esc(reportProject||'this report')+'.</div></div>';
    if(note)note.textContent='No matching annual activity or Borehole Planning summary was found for the selected report project.';
    return;
  }
  const colors=['#315d49','#5f8f73','#d39a2c','#a85745'];
  el.innerHTML=sites.map(function(site){
    const bands=Array.isArray(site.depth_bands)?site.depth_bands:[];
    const openLabel=(site.open_holes||0)+' open hole'+(Number(site.open_holes)===1?'':'s');
    return '<div class="exploration-metres-card">'
      +'<div class="exploration-metres-head"><div class="exploration-metres-site">'+esc(site.site_name||site.site_code)+'<span class="exploration-metres-code">'+esc(site.site_code)+'</span></div><div class="exploration-metres-asof">As at '+esc(data.as_of||'--')+'</div></div>'
      +'<div class="exploration-metres-kpis">'
      +'<div class="exploration-metres-kpi"><span>Drilled in '+esc(data.year)+'</span><strong>'+numVal(site.actual_metres).toLocaleString('en-AU',{minimumFractionDigits:1,maximumFractionDigits:1})+' m</strong></div>'
      +'<div class="exploration-metres-kpi"><span>Remaining</span><strong>'+numVal(site.remaining_metres).toLocaleString('en-AU',{minimumFractionDigits:1,maximumFractionDigits:1})+' m</strong></div>'
      +'<div class="exploration-metres-kpi"><span>Open plan</span><strong>'+esc(openLabel)+'</strong></div>'
      +'</div>'
      +'<div class="exploration-depth-bar" aria-label="Depth band proportions">'+bands.map(function(band,index){return '<span title="'+attr(band.label+' m: '+numVal(band.metres).toFixed(1)+' m ('+numVal(band.proportion).toFixed(1)+'%)')+'" style="width:'+Math.max(0,numVal(band.proportion)).toFixed(1)+'%;background:'+colors[index%colors.length]+'"></span>';}).join('')+'</div>'
      +'<div class="exploration-depth-band-list">'+bands.map(function(band,index){return '<div class="exploration-depth-band"><span><i style="background:'+colors[index%colors.length]+'"></i>'+esc(band.label)+' m</span><b>'+numVal(band.metres).toFixed(1)+' m · '+numVal(band.proportion).toFixed(1)+'%</b></div>';}).join('')+'</div>'
      +'</div>';
  }).join('');
  if(note){
    const deduplicated=sites.reduce(function(sum,site){return sum+numVal(site.deduplicated_rows);},0);
    note.textContent='Actuals: '+data.year+' Drill Core and Chip/Open Hole activity intervals; '+deduplicated+' exact duplicate interval'+(deduplicated===1?'':'s')+' removed. Remaining: open Borehole Planning EOH balance; completed and cancelled holes excluded.';
  }
}

function invoiceAttachmentSize(bytes) {
  var value = parseInt(bytes || 0) || 0;
  if(value < 1024) return value + ' B';
  if(value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

async function openInvoiceAttachments(invoiceId) {
  var invoice = invoicesData.find(function(r){ return Number(r.id) === Number(invoiceId); }) || {};
  document.getElementById('invoice-attachment-id').value = invoiceId;
  document.getElementById('invoice-attachment-title').textContent = (invoice.invoice_number || 'Invoice') + ' attachments';
  document.getElementById('invoice-attachment-files').value = '';
  var dialog = document.getElementById('invoice-attachment-dialog');
  if(dialog && !dialog.open) dialog.showModal();
  await loadInvoiceAttachments(invoiceId);
}

function closeInvoiceAttachments() {
  var dialog = document.getElementById('invoice-attachment-dialog');
  if(dialog && dialog.open) dialog.close();
}

async function loadInvoiceAttachments(invoiceId) {
  var list = document.getElementById('invoice-attachment-list');
  list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:14px 0;">Loading attachments...</div>';
  try {
    var res = await fetch(API+'/invoices/'+encodeURIComponent(invoiceId)+'/attachments');
    if(!res.ok) throw new Error(await res.text());
    var attachments = await res.json();
    if(!Array.isArray(attachments)) attachments = [];
    var invoice = syncInvoiceLocal(invoiceId, {attachment_count: attachments.length});
    list.innerHTML = attachments.map(function(a){
      var uploaded = a.uploaded_at ? new Date(a.uploaded_at).toLocaleString('en-AU') : '';
      return '<div class="invoice-attachment-row">'
        +'<div class="invoice-attachment-name" title="'+attr(a.filename||'Attachment')+'">'+esc(a.filename||'Attachment')+'</div>'
        +'<div class="invoice-attachment-meta">'+esc(invoiceAttachmentSize(a.file_size))+(uploaded?' &middot; '+esc(uploaded):'')+'</div>'
        +'<button class="btn-ghost" type="button" onclick="viewInvoiceAttachment('+invoiceId+','+a.id+')">Open</button>'
        +'<button class="btn-ghost" type="button" style="color:var(--red);" onclick="deleteInvoiceAttachment('+invoiceId+','+a.id+')">Delete</button>'
        +'</div>';
    }).join('') || '<div style="font-size:12px;color:var(--muted);padding:14px 0;">No attachments yet.</div>';
    if(invoice) renderInvoices((function(){
      var cfilt = (document.getElementById('inv-contractor-filter') || {}).value || '';
      var sfilt = (document.getElementById('inv-status-filter') || {}).value || '';
      return invoicesData.filter(function(r){
        return (!cfilt || r.contractor === cfilt) && (!sfilt || r.status === sfilt);
      });
    })());
  } catch(e) {
    list.innerHTML = '<div style="font-size:12px;color:var(--red);padding:14px 0;">Could not load attachments.</div>';
  }
}

async function uploadInvoiceAttachments(files) {
  var invoiceId = parseInt(document.getElementById('invoice-attachment-id').value || 0);
  files = Array.from(files || []);
  if(!invoiceId || !files.length) return;
  var oversized = files.find(function(file){ return file.size > 20 * 1024 * 1024; });
  if(oversized) {
    toast(oversized.name + ' exceeds the 20 MB limit','err');
    document.getElementById('invoice-attachment-files').value = '';
    return;
  }
  var input = document.getElementById('invoice-attachment-files');
  input.disabled = true;
  try {
    for(var i=0; i<files.length; i++) {
      var body = new FormData();
      body.append('file', files[i]);
      var res = await fetch(API+'/invoices/'+encodeURIComponent(invoiceId)+'/attachments', {method:'POST', body:body});
      if(!res.ok) throw new Error(await res.text());
    }
    toast(files.length === 1 ? 'Attachment added' : files.length + ' attachments added');
    await loadInvoiceAttachments(invoiceId);
  } catch(e) {
    toast('Upload failed: '+((e && e.message) || 'attachment was not saved'),'err');
  } finally {
    input.disabled = false;
    input.value = '';
  }
}

function viewInvoiceAttachment(invoiceId, attachmentId) {
  window.open(API+'/invoices/'+encodeURIComponent(invoiceId)+'/attachments/'+encodeURIComponent(attachmentId), '_blank');
}

async function deleteInvoiceAttachment(invoiceId, attachmentId) {
  if(!confirm('Delete this attachment?')) return;
  try {
    var res = await fetch(API+'/invoices/'+encodeURIComponent(invoiceId)+'/attachments/'+encodeURIComponent(attachmentId), {method:'DELETE'});
    if(!res.ok) throw new Error(await res.text());
    toast('Attachment deleted','warn');
    await loadInvoiceAttachments(invoiceId);
  } catch(e) {
    toast('Delete failed: '+((e && e.message) || 'attachment was not removed'),'err');
  }
}

async function loadInvoiceBreakdown(invoiceId) {
  selectedInvoiceBreakdownId = invoiceId;
  var invoice = invoicesData.find(function(r){ return Number(r.id) === Number(invoiceId); }) || {};
  document.getElementById('invoice-breakdown-title').textContent = (invoice.invoice_number || 'Invoice') + ' breakdown';
  document.getElementById('invoice-breakdown-body').innerHTML = '<tr><td colspan="12" style="padding:20px;color:var(--muted);text-align:center;">Loading breakdown...</td></tr>';
  try {
    var res = await fetch(API+'/invoices/'+encodeURIComponent(invoiceId)+'/lines');
    if(!res.ok) throw new Error(await res.text());
    invoiceBreakdownLines = await res.json();
    if(!Array.isArray(invoiceBreakdownLines)) invoiceBreakdownLines = [];
    renderInvoiceBreakdown(invoice, invoiceBreakdownLines);
    document.querySelectorAll('#inv-body tr').forEach(function(row){
      row.classList.toggle('active', Number(row.dataset.invId) === Number(invoiceId));
    });
  } catch(e) {
    invoiceBreakdownLines = [];
    document.getElementById('invoice-breakdown-body').innerHTML = '<tr><td colspan="12" style="padding:20px;color:var(--red);text-align:center;">Could not load invoice breakdown.</td></tr>';
  }
}

function renderInvoiceBreakdown(invoice, lines) {
  lines = Array.isArray(lines) ? lines : [];
  var exact = lines.filter(function(r){ return r.match_status === 'exact_match'; }).length;
  var close = lines.filter(function(r){ return r.match_status === 'close_match'; }).length;
  var errors = lines.filter(function(r){ return !['exact_match','close_match'].includes(r.match_status); }).length;
  var invoiced = lines.reduce(function(s,r){ return s + (parseFloat(r.amount) || 0); }, 0);
  var eos = lines.reduce(function(s,r){ return s + (parseFloat(r.matched_eos_cost) || 0); }, 0);
  var variance = lines.reduce(function(s,r){ return s + (parseFloat(r.variance) || 0); }, 0);
  document.getElementById('invbd-lines').textContent = lines.length;
  document.getElementById('invbd-accounted').textContent = (exact + close) + ' / ' + lines.length;
  document.getElementById('invbd-missing').textContent = errors;
  document.getElementById('invbd-invoiced').textContent = cur(invoiced);
  document.getElementById('invbd-eos').textContent = cur(eos);
  document.getElementById('invbd-variance').textContent = cur(variance);
  document.getElementById('invbd-variance').style.color = Math.abs(variance) <= 1 ? 'var(--green)' : (variance > 0 ? 'var(--red)' : 'var(--accent)');

  document.getElementById('invoice-breakdown-body').innerHTML = lines.map(function(r){
    var status = r.match_status || 'pending';
    var period = [invoice.service_start, invoice.service_end].filter(Boolean).join(' to ');
    var invoiceQty = parseFloat(r.quantity);
    var weeklyQty = parseFloat(r.matched_eos_quantity);
    var invoiceRate = parseFloat(r.unit_price);
    var contractRate = parseFloat(r.matched_eos_rate);
    var evidence = '<strong>'+esc(r.description || '')+'</strong>'+(r.audit_note?'<div style="margin-top:3px;color:var(--muted);">'+esc(r.audit_note)+'</div>':'');
    return '<tr>'
      +'<td>'+esc(period || r.line_date || '')+'</td>'
      +'<td style="font-family:var(--font-mono);font-weight:700;color:var(--accent);">'+esc(r.activity_code || r.category || '')+'</td>'
      +'<td style="text-align:right;">'+(Number.isFinite(invoiceQty)?invoiceQty.toLocaleString('en-AU',{maximumFractionDigits:2}):'—')+'</td>'
      +'<td style="text-align:right;">'+(Number.isFinite(weeklyQty)?weeklyQty.toLocaleString('en-AU',{maximumFractionDigits:2}):'—')+'</td>'
      +'<td>'+esc(r.unit || '')+'</td>'
      +'<td>'+((Number.isFinite(invoiceRate))?cur(invoiceRate):'—')+'</td>'
      +'<td>'+((Number.isFinite(contractRate))?cur(contractRate):'—')+'</td>'
      +'<td style="font-weight:700;color:var(--text);">'+cur(r.amount)+'</td>'
      +'<td>'+cur(r.matched_eos_cost)+'</td>'
      +'<td style="color:'+((parseFloat(r.variance)||0)>1?'var(--red)':((parseFloat(r.variance)||0)<-1?'var(--accent)':'var(--green)'))+';">'+cur(r.variance)+'</td>'
      +'<td><span class="invoice-line-status '+invoiceMatchClass(status)+'">'+esc(invoiceMatchLabel(status))+'</span></td>'
      +'<td class="multiline-cell">'+evidence+'</td>'
      +'</tr>';
  }).join('') || '<tr><td colspan="12" style="padding:20px;color:var(--muted);text-align:center;">No invoice lines found for this invoice.</td></tr>';
  makeTableSortable('invoice-breakdown-table');
}

function downloadInvoiceBreakdownCSV() {
  if(!invoiceBreakdownLines.length) return;
  var invoice = invoicesData.find(function(r){ return Number(r.id) === Number(selectedInvoiceBreakdownId); }) || {};
  var keys = ['activity_code','quantity','matched_eos_quantity','unit','unit_price','matched_eos_rate','amount','matched_eos_cost','quantity_variance','rate_variance','variance','match_status','audit_note','description'];
  var csv = [keys.join(','), ...invoiceBreakdownLines.map(function(r){
    return keys.map(function(k){ return '"'+String(r[k] ?? '').replace(/"/g,'""')+'"'; }).join(',');
  })].join('\n');
  var name = (invoice.invoice_number || 'invoice_breakdown').replace(/[^\w.-]+/g,'_') + '_breakdown.csv';
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=name;
  a.click();
}

function viewSourcePdf(filename) {
  window.open(API+'/source_files/'+encodeURIComponent(filename), '_blank');
}

// ── Reconciliation ────────────────────────────────────────────────────────────
async function loadReconciliation(){
  try{
    var d = await fetch(API+'/reconciliation?contractor='+encodeURIComponent(activeContractor)).then(function(r){return r.json();});
    var t = d.totals;
    var monthFilter = document.getElementById('rec-month-filter').value;

    // Build month options from invoice data
    var months = {};
    (d.invoices||[]).forEach(function(inv){
      var bm = inv.billing_month || '';
      if(bm) months[bm] = true;
      // Also extract month from invoice_date
      var dt = inv.invoice_date || '';
      var parts = dt.split('/');
      if(parts.length === 3) {
        var mk = parts[1]+'/'+parts[2]; // mm/yyyy
        months[mk] = true;
      }
    });
    var sel = document.getElementById('rec-month-filter');
    var current = sel.value;
    var opts = '<option value="">All Months</option>';
    Object.keys(months).sort().forEach(function(m){
      opts += '<option value="'+m+'"'+(m===current?' selected':'')+'>'+m+'</option>';
    });
    sel.innerHTML = opts;

    // Filter invoices by month if selected
    var filteredInvoices = d.invoices || [];
    if(monthFilter) {
      filteredInvoices = filteredInvoices.filter(function(inv){
        if(inv.billing_month === monthFilter) return true;
        var dt = inv.invoice_date || '';
        var parts = dt.split('/');
        if(parts.length === 3 && (parts[1]+'/'+parts[2]) === monthFilter) return true;
        return false;
      });
    }

    // Recalculate totals for filtered data
    var invTotal = filteredInvoices.reduce(function(s,r){return s+(parseFloat(r.total_aud)||0);},0);
    var invPaid = filteredInvoices.reduce(function(s,r){return s+(parseFloat(r.amount_paid)||0);},0);
    var invDue = filteredInvoices.reduce(function(s,r){return s+(parseFloat(r.amount_due)||0);},0);
    var eosTotal = monthFilter ? 0 : (t.eos_total||0); // TODO: filter EOS by month too
    if(!monthFilter) { invTotal = t.invoice_total; invPaid = t.invoice_paid; invDue = t.invoice_due; eosTotal = t.eos_total; }
    var variance = invTotal - eosTotal;

    // KPIs
    document.getElementById('rec-inv-total').textContent = cur(invTotal);
    document.getElementById('rec-eos-total').textContent = cur(eosTotal);
    document.getElementById('rec-variance').textContent = (variance>=0?'+':'')+cur(variance);
    document.getElementById('rec-variance').style.color = variance>100?'var(--red)':variance<-100?'var(--blue)':'var(--green)';
    document.getElementById('rec-variance-note').textContent = invTotal>0?
      ((variance/invTotal)*100).toFixed(1)+'% of invoiced':'—';
    document.getElementById('rec-paid').textContent = cur(invPaid);
    document.getElementById('rec-due').textContent = cur(invDue);

    // Category comparison
    var STATUS_STYLE = {match:'color:var(--green)',over:'color:var(--red)',under:'color:var(--blue)'};
    var STATUS_LABEL = {match:'\u2713 Match',over:'\u25b2 Over',under:'\u25bc Under'};
    document.getElementById('rec-cat-body').innerHTML = (d.comparison||[]).map(function(r){
      return '<tr>'
        +'<td style="text-transform:capitalize">'+esc((r.category||'').replace(/_/g,' '))+'</td>'
        +'<td style="color:var(--accent)">'+cur(r.invoice_total)+'</td>'
        +'<td>'+cur(r.eos_total)+'</td>'
        +'<td style="'+(r.variance>100?'color:var(--red)':r.variance<-100?'color:var(--blue)':'color:var(--green)')+'">'+
          (r.variance>=0?'+':'')+cur(r.variance)+'</td>'
        +'<td style="'+(r.variance_pct!=null&&Math.abs(r.variance_pct)>5?'color:var(--red)':'color:var(--muted)')+'">'+
          (r.variance_pct!=null?(r.variance_pct>=0?'+':'')+r.variance_pct+'%':'N/A')+'</td>'
        +'<td><span style="'+(STATUS_STYLE[r.status]||'')+'">'+
          (STATUS_LABEL[r.status]||r.status)+'</span></td>'
        +'</tr>';
    }).join('')||'<tr><td colspan="6" style="padding:16px;color:var(--muted);">No data</td></tr>';
    makeTableSortable('rec-cat-table');

    // Invoice register (editable billing month + status)
    var MONTH_OPTIONS = ['','01/2026','02/2026','03/2026','04/2026','05/2026','06/2026','07/2026','08/2026','09/2026','10/2026','11/2026','12/2026',
                         '01/2027','02/2027','03/2027'];
    document.getElementById('rec-inv-body').innerHTML = filteredInvoices.map(function(r){
      var monthOpts = MONTH_OPTIONS.map(function(m){
        var label = m || '— Assign —';
        return '<option value="'+m+'"'+(m===(r.billing_month||'')?'selected':'')+'>'+label+'</option>';
      }).join('');
      var statusOpts = ['Unpaid','Partial','Paid','Disputed'].map(function(s){
        return '<option value="'+s+'"'+(s===r.status?' selected':'')+'>'+s+'</option>';
      }).join('');
      return '<tr>'
        +'<td style="color:var(--accent);font-weight:600">'+esc(r.invoice_number)+'</td>'
        +'<td>'+esc(r.invoice_date||'')+'</td>'
        +'<td><select onchange="updateInvoiceField('+r.id+',&apos;billing_month&apos;,this.value)" style="font-size:12px;padding:3px 6px;border:1.5px solid var(--border);border-radius:4px;outline:none;background:#fff;color:var(--text);font-family:var(--font);">'+monthOpts+'</select></td>'
        +'<td contenteditable="true" data-inv-id="'+r.id+'" data-col="po_reference" style="font-size:11px;">'+esc(r.po_reference||'')+'</td>'
        +'<td style="color:var(--accent);font-weight:600;">'+cur(r.total_aud)+'</td>'
        +'<td contenteditable="true" data-inv-id="'+r.id+'" data-col="amount_paid" style="color:var(--green)">'+((r.amount_paid||0)>0?(r.amount_paid||0).toLocaleString("en-AU",{maximumFractionDigits:2}):'')+'</td>'
        +'<td style="color:'+((r.amount_due||0)>0?'var(--red)':'var(--muted)')+'">'+cur(r.amount_due)+'</td>'
        +'<td><select onchange="updateInvoiceField('+r.id+',&apos;status&apos;,this.value)" style="font-size:11px;padding:2px 6px;border:1.5px solid var(--border);border-radius:12px;outline:none;background:#fff;color:var(--text);font-family:var(--font);">'+statusOpts+'</select></td>'
        +'<td>'+(r.id?'<button onclick="viewInvoicePdf('+r.id+')" style="background:transparent;border:1.5px solid var(--accent);color:var(--accent);cursor:pointer;font-size:10px;padding:2px 6px;border-radius:4px;font-family:var(--font);">PDF</button>':'')+'</td>'
        +'</tr>';
    }).join('');

    // Wire up contenteditable blur for inline edits
    document.getElementById('rec-inv-body').querySelectorAll('[contenteditable]').forEach(function(cell){
      cell.addEventListener('blur', function(){
        var invId = cell.dataset.invId;
        var col = cell.dataset.col;
        var val = cell.textContent.trim().replace(/[$,]/g,'');
        if(col === 'amount_paid') val = parseFloat(val) || 0;
        updateInvoiceField(parseInt(invId), col, val);
      });
    });
    makeTableSortable('rec-inv-table');

    // Monthly summary
    var monthlyData = {};
    (d.invoices||[]).forEach(function(inv){
      var mk = inv.billing_month || '';
      if(!mk) {
        var dt = inv.invoice_date || '';
        var parts = dt.split('/');
        if(parts.length === 3) mk = parts[1]+'/'+parts[2];
      }
      if(!mk) mk = 'Unassigned';
      if(!monthlyData[mk]) monthlyData[mk] = {count:0, invoiced:0, paid:0, due:0};
      monthlyData[mk].count++;
      monthlyData[mk].invoiced += parseFloat(inv.total_aud)||0;
      monthlyData[mk].paid += parseFloat(inv.amount_paid)||0;
      monthlyData[mk].due += parseFloat(inv.amount_due)||0;
    });
    document.getElementById('rec-monthly-body').innerHTML = Object.entries(monthlyData).sort(function(a,b){return a[0].localeCompare(b[0]);}).map(function(entry){
      var mk = entry[0], v = entry[1];
      var eos = 0; // TODO: sum EOS for this month
      var variance = v.invoiced - eos;
      var vpct = eos > 0 ? ((variance/eos)*100).toFixed(1) : 'N/A';
      return '<tr style="cursor:pointer;" onclick="document.getElementById(&apos;rec-month-filter&apos;).value=&apos;'+mk+'&apos;;loadReconciliation();">'
        +'<td style="font-weight:600;">'+esc(mk)+'</td>'
        +'<td>'+v.count+'</td>'
        +'<td style="color:var(--accent);font-weight:600;">'+cur(v.invoiced)+'</td>'
        +'<td>'+cur(eos)+'</td>'
        +'<td style="color:'+(variance>100?'var(--red)':'var(--green)')+'">'+
          (variance>=0?'+':'')+cur(variance)+'</td>'
        +'<td>'+vpct+(vpct!=='N/A'?'%':'')+'</td>'
        +'<td style="color:'+(v.due>0?'var(--red)':'var(--green)')+'">'+
          (v.due>0?v.count+' outstanding':'\u2713 Settled')+'</td>'
        +'</tr>';
    }).join('')||'<tr><td colspan="7" style="padding:16px;color:var(--muted);">No invoices imported yet</td></tr>';
    makeTableSortable('rec-monthly-table');

    // Discrepancies
    discrepanciesData = d.discrepancies || [];
    document.getElementById('rec-disc-count').textContent = discrepanciesData.length;
    document.getElementById('rec-disc-body').innerHTML = discrepanciesData.map(function(r){
      return '<tr>'
        +'<td style="color:var(--accent)">'+esc(r.invoice_number)+'</td>'
        +'<td style="max-width:280px;white-space:normal;font-size:11px;">'+esc(r.description)+'</td>'
        +'<td><span class="badge badge-other">'+esc(r.category||'')+'</span></td>'
        +'<td>'+cur(r.amount)+'</td>'
        +'<td>'+(r.matched_eos_cost!=null?cur(r.matched_eos_cost):'\u2014')+'</td>'
        +'<td style="color:'+((r.variance||0)>5?'var(--red)':(r.variance||0)<-5?'var(--blue)':'var(--green)')+'">'
          +(r.variance!=null?(r.variance>=0?'+':'')+cur(r.variance):'\u2014')+'</td>'
        +'<td style="color:'+((r.match_status||'').indexOf('over')>=0?'var(--red)':'var(--blue)')+'">'
          +((r.match_status||'').replace(/_/g,' '))+'</td>'
        +'</tr>';
    }).join('')||'<tr><td colspan="7" style="padding:16px;color:var(--green);">\u2713 No significant discrepancies</td></tr>';
    makeTableSortable('rec-disc-table');

  }catch(e){console.error('Reconciliation error:',e);}
}

async function updateInvoiceField(invoiceId, field, value) {
  await saveInvField(invoiceId, field, value);
  loadReconciliation();
}

async function rematchAll(){
  toast('Re-running matching...');
  await fetch(API+'/reconciliation/rematch?contractor='+encodeURIComponent(activeContractor),{method:'POST'});
  toast('\u2713 Matching complete');
  loadReconciliation();
}

async function runAiAudit() {
  var btn = document.getElementById('ai-audit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> AI analysing...';
  var month = document.getElementById('rec-month-filter').value;

  try {
    var res = await fetch(API+'/reconciliation/ai-audit', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:activeContractor, month:month})
    });
    if(!res.ok) {
      var err = await res.text();
      toast('AI Audit failed: '+err.substring(0,100), 'err');
      btn.innerHTML = '\uD83E\uDD16 AI Audit'; btn.disabled = false;
      return;
    }
    var d = await res.json();
    console.log('AI Audit result:', d);

    if(d.status === 'ok' && d.audit) {
      renderAiAudit(d.audit);
      toast('\u2713 AI Audit complete');
    } else if(d.status === 'partial') {
      document.getElementById('ai-audit-panel').style.display = 'block';
      document.getElementById('ai-summary').textContent = 'AI returned partial results. Raw: ' + (d.raw_response||'').substring(0, 500);
      document.getElementById('ai-findings').innerHTML = '';
      document.getElementById('ai-rates').innerHTML = '';
      document.getElementById('ai-recommendations').innerHTML = '';
      document.getElementById('ai-variance').innerHTML = '';
    } else {
      toast('AI returned unexpected response', 'err');
    }
  } catch(e) {
    toast('AI Audit failed: '+e.message, 'err');
    console.error(e);
  }
  btn.innerHTML = '\uD83E\uDD16 AI Audit';
  btn.disabled = false;
}

function renderAiAudit(audit) {
  document.getElementById('ai-audit-panel').style.display = 'block';

  // Summary
  document.getElementById('ai-summary').textContent = audit.summary || 'No summary provided';

  // Grand variance
  var gv = audit.grand_variance || {};
  document.getElementById('ai-variance').innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">'
    +'<div style="background:var(--bg3);padding:10px 12px;border-radius:6px;"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Invoiced</div><div style="font-size:18px;font-weight:700;color:var(--accent);">'+cur(gv.invoiced)+'</div></div>'
    +'<div style="background:var(--bg3);padding:10px 12px;border-radius:6px;"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">EOS Calculated</div><div style="font-size:18px;font-weight:700;">'+cur(gv.eos_calculated)+'</div></div>'
    +'<div style="background:var(--bg3);padding:10px 12px;border-radius:6px;"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Consumables</div><div style="font-size:18px;font-weight:700;">'+cur(gv.consumables)+'</div></div>'
    +'<div style="background:var(--bg3);padding:10px 12px;border-radius:6px;"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Difference</div><div style="font-size:18px;font-weight:700;color:'+((gv.difference||0)>0?'var(--red)':'var(--green)')+';">'+(gv.difference>=0?'+':'')+cur(gv.difference)+'</div></div>'
    +'</div>';

  // Findings
  var findings = audit.findings || [];
  var severityStyle = {critical:'background:#fee2e2;border-left:3px solid #dc2626;',warning:'background:#fef3c7;border-left:3px solid #d97706;',info:'background:#e5eee1;border-left:3px solid #315d49;'};
  var severityIcon = {critical:'\u26d4',warning:'\u26a0\ufe0f',info:'\u2139\ufe0f'};
  document.getElementById('ai-findings').innerHTML =
    '<div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Findings ('+findings.length+')</div>'
    + findings.map(function(f){
      return '<div style="'+( severityStyle[f.severity]||severityStyle.info)+'padding:12px 14px;border-radius:6px;margin-bottom:8px;">'
        +'<div style="font-weight:700;font-size:13px;margin-bottom:4px;">'+(severityIcon[f.severity]||'')+' '+esc(f.title)+'</div>'
        +'<div style="font-size:12px;color:var(--text2);line-height:1.6;">'+esc(f.detail)+'</div>'
        +(f.amount?'<div style="font-size:12px;font-weight:600;margin-top:4px;">Amount: '+cur(f.amount)+'</div>':'')
        +(f.recommendation?'<div style="font-size:11px;color:var(--accent);margin-top:4px;">\u27a1 '+esc(f.recommendation)+'</div>':'')
        +'</div>';
    }).join('') || '<div style="color:var(--green);padding:12px;">\u2713 No significant findings</div>';

  // Rate checks
  var rateChecks = audit.rate_check || [];
  if(rateChecks.length) {
    document.getElementById('ai-rates').innerHTML =
      '<div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Rate Card Check</div>'
      +'<table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="background:var(--bg3);">'
      +'<th style="padding:6px 8px;text-align:left;">Code</th><th style="padding:6px 8px;">Schedule Rate</th>'
      +'<th style="padding:6px 8px;">Invoiced Rate</th><th style="padding:6px 8px;">Status</th><th style="padding:6px 8px;">Note</th></tr></thead><tbody>'
      + rateChecks.map(function(r){
        var statusColor = r.status==='match'?'var(--green)':r.status==='mismatch'?'var(--red)':'var(--muted)';
        return '<tr style="border-bottom:1px solid var(--border);">'
          +'<td style="padding:6px 8px;font-family:var(--font-mono);">'+esc(r.code)+'</td>'
          +'<td style="padding:6px 8px;text-align:center;">'+cur(r.schedule_rate)+'</td>'
          +'<td style="padding:6px 8px;text-align:center;">'+(r.invoiced_rate!=null?cur(r.invoiced_rate):'\u2014')+'</td>'
          +'<td style="padding:6px 8px;text-align:center;color:'+statusColor+';font-weight:600;">'+esc(r.status)+'</td>'
          +'<td style="padding:6px 8px;font-size:11px;color:var(--muted);">'+esc(r.note||'')+'</td></tr>';
      }).join('') + '</tbody></table>';
  } else {
    document.getElementById('ai-rates').innerHTML = '';
  }

  // Recommendations
  var recs = audit.recommendations || [];
  if(recs.length) {
    document.getElementById('ai-recommendations').innerHTML =
      '<div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Recommendations</div>'
      +'<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;">'
      + recs.map(function(r,i){ return '<div style="font-size:13px;color:var(--text2);margin-bottom:6px;">'+(i+1)+'. '+esc(r)+'</div>'; }).join('')
      +'</div>';
  } else {
    document.getElementById('ai-recommendations').innerHTML = '';
  }

  // Scroll to panel
  document.getElementById('ai-audit-panel').scrollIntoView({behavior:'smooth',block:'start'});
}

// ── Borehole Planning ─────────────────────────────────────────────────────────
const BUDGET_BOREHOLES = [];  // removed - DB is source of truth

let bhData = [];
let boreholesLoadPromise = null;
let bhMap = null;
let bhMarkers = [];
let periodMap = null;
let periodMapMarkers = [];
let periodMapOverlays = [];
let periodMapBounds = null;
let periodMapPrintHoles = [];
let boreholesCsvData = [];
let boreholeDetailsCsvData = [];

function mgaToWgs84(easting, northing) {
  const a=6378137.0,f=1/298.257222101,b=a*(1-f),e2=1-(b*b)/(a*a);
  const k0=0.9996,E0=500000,N0=10000000;
  const lon0=147*Math.PI/180;
  const x=easting-E0,y=northing-N0;
  const M=y/k0;
  const mu=M/(a*(1-e2/4-3*e2*e2/64));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const phi1=mu+(3*e1/2-27*e1*e1*e1/32)*Math.sin(2*mu)+(21*e1*e1/16)*Math.sin(4*mu)+(151*e1*e1*e1/96)*Math.sin(6*mu);
  const N1=a/Math.sqrt(1-e2*Math.sin(phi1)*Math.sin(phi1));
  const T1=Math.tan(phi1)*Math.tan(phi1);
  const C1=e2*Math.cos(phi1)*Math.cos(phi1)/(1-e2);
  const R1=a*(1-e2)/Math.pow(1-e2*Math.sin(phi1)*Math.sin(phi1),1.5);
  const D=x/(N1*k0);
  const lat=phi1-(N1*Math.tan(phi1)/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*e2)*D*D*D*D/24);
  const lng=lon0+(D-(1+2*T1+C1)*D*D*D/6)/Math.cos(phi1);
  return {lat:lat*180/Math.PI, lng:lng*180/Math.PI};
}

function getBhColor(bh) {
  if(bh.status==='Complete') return '#16a34a';
  if(bh.status==='In Progress') return '#dc2626';
  if(bh.status==='Cancelled') return '#9b2c2c';
  if(bh.type==='Chip'||bh.bh_type==='Chip') return '#d97706';
  if(bh.bit_type==='PQ') return '#315d49';
  const p=(bh.purpose||'').toLowerCase();
  if(p.includes('spon')) return '#0891b2';
  if(p.includes('gas')||p.includes('geo')) return '#7c3aed';
  return '#6b7280';
}

function isPlaceholderHoleId(bh) {
  const hole = String((bh&&bh.hole_id)||'').trim();
  const site = String((bh&&bh.site_id)||'').trim();
  return !!hole && !!site && hole===site && /^26-\d+/i.test(site);
}

function displayHoleId(bh) {
  return isPlaceholderHoleId(bh) ? '' : ((bh&&bh.hole_id)||'');
}

async function loadBoreholes(force) {
  if(bhData.length && !force) {
    filterBoreholesByProject();
    if(isPageActive('boreholes')) setTimeout(initBhMap, 0);
    if(isPageActive('borehole-details')) renderBoreholeDetails();
    if(isPageActive('drilling-schedule')) renderDrillingSchedule();
    return bhData;
  }
  if(boreholesLoadPromise) return boreholesLoadPromise;
  boreholesLoadPromise = fetchBoreholesFromApi();
  try {
    return await boreholesLoadPromise;
  } finally {
    boreholesLoadPromise = null;
  }
}

async function fetchBoreholesFromApi() {
  let dbData = [];
  try {
    const res = await fetch(API+'/boreholes?contractor='+encodeURIComponent(boreholePlanningContractor()));
    if(res.ok) dbData = await res.json();
  } catch(e) {}

  if(dbData.length) {
    bhData = dbData.map(d => {
      const seed = BUDGET_BOREHOLES.find(b => b.hole_id===d.hole_id) || {};
      return Object.assign({}, seed, d, {
        lat: d.lat||seed.lat, lng: d.lng||seed.lng,
        type: d.bh_type||d.type||seed.type,
        eos_cost: parseFloat(d.eos_cost)||0,
        drilling_cost: parseFloat(d.drilling_cost)||0,
        drilling_metres: parseFloat(d.drilling_metres)||0,
        eos_metres: parseFloat(d.eos_metres)||0
      });
    });
    BUDGET_BOREHOLES.forEach(b => {
      if(!bhData.find(d => d.hole_id===b.hole_id)) {
        bhData.push(Object.assign({}, b, {status:'Planned',eos_cost:0,drilling_cost:0,drilling_metres:0,eos_metres:0}));
      }
    });
  } else {
    bhData = BUDGET_BOREHOLES.map(b => Object.assign({}, b, {status:'Planned',eos_cost:0,drilling_cost:0,drilling_metres:0,eos_metres:0}));
  }
  bhData.sort((a,b) => (a.drill_order||999)-(b.drill_order||999));
  bhData = filterBoreholesForActiveProgram(bhData);
  filterBoreholesByProject();
  if(isPageActive('boreholes')) setTimeout(initBhMap, 100);
  if(isPageActive('borehole-details')) renderBoreholeDetails();
  if(isPageActive('drilling-schedule')) renderDrillingSchedule();
  return bhData;
}

const BOREHOLE_DETAIL_COLUMNS = [
  {key:'site_id', label:'Site ID', editable:true},
  {key:'hole_id', label:'Hole ID', editable:true},
  {key:'ug_location', label:'UG Location', editable:true, extra:true},
  {key:'status', label:'Borehole Status', editable:true, type:'status'},
  {key:'notes', label:'Comments', editable:true},
  {key:'assigned_rig', label:'Scheduled Rig', editable:true},
  {key:'scheduled_start', label:'Schedule Start', editable:true},
  {key:'scheduled_end', label:'Schedule End', editable:true},
  {key:'area_m2', label:'AREA m2', editable:true, num:true, extra:true, digits:2},
  {key:'lcp', label:'LCP', editable:true, extra:true},
  {key:'lcp_submitted', label:'Submitted', editable:true, extra:true},
  {key:'lcp_expiry', label:'Expiry', editable:true, extra:true},
  {key:'lcp_signed', label:'Signed', editable:true, extra:true},
  {key:'lcp_link', label:'Link', editable:true, extra:true},
  {key:'lcp_closed', label:'Closed', editable:true, extra:true},
  {key:'pte', label:'PTE', editable:true, extra:true},
  {key:'pte_expiry', label:'Expiry', editable:true, extra:true},
  {key:'pte_link', label:'Link', editable:true, extra:true},
  {key:'pte_signed', label:'Signed', editable:true, extra:true},
  {key:'pte_closed', label:'Closed', editable:true, extra:true},
  {key:'ptdrill', label:'PTDrill', editable:true, extra:true},
  {key:'bh_type', label:'Type', editable:true},
  {key:'issued_date', label:'Issued Date', editable:true, extra:true},
  {key:'issued_link', label:'LINK', editable:true, extra:true},
  {key:'best_coord', label:'Best Co Ord', editable:true, extra:true},
  {key:'easting', label:'Best Easting', editable:true, num:true, digits:0},
  {key:'northing', label:'Best Northing', editable:true, num:true, digits:0},
  {key:'rl', label:'Best RL', editable:true, num:true, digits:2},
  {key:'site_inspection', label:'Site Inspection', editable:true, extra:true},
  {key:'pre_disturb_photo', label:'Pre Disturb Photo', editable:true, extra:true},
  {key:'si_comments', label:'SI Comments', editable:true, extra:true},
  {key:'fsc', label:'FSC', editable:true, extra:true},
  {key:'fsc_date', label:'FSC Date', editable:true, extra:true},
  {key:'fsc_report', label:'FSC Report', editable:true, extra:true},
  {key:'prepped', label:'Prepped', editable:true, extra:true},
  {key:'prep_date', label:'Prep Date', editable:true, extra:true},
  {key:'start_date', label:'Start Date', editable:true, extra:true},
  {key:'end_date', label:'End Date', editable:true, extra:true},
  {key:'drilled', label:'Drilled', editable:true, extra:true},
  {key:'cemented', label:'Cemented', editable:true, extra:true},
  {key:'cemented_date', label:'Cemented Date', editable:true, extra:true},
  {key:'delivered_volume', label:'Dellivred Volume', editable:true, num:true, extra:true, digits:2},
  {key:'volume_m2', label:'Volume (m2)', editable:true, num:true, extra:true, digits:2},
  {key:'cement_link', label:'Cement Link', editable:true, extra:true},
  {key:'rehabbed', label:'Rehabbed', editable:true, extra:true},
  {key:'rehab_date', label:'Rehab Date', editable:true, extra:true},
  {key:'r_photo', label:'R Photo', editable:true, extra:true},
  {key:'rehab_inspection_comments', label:'Rehab Inspection Comments', editable:true, extra:true},
  {key:'inspection_date', label:'Inspection Date', editable:true, extra:true}
];

const BOREHOLE_DB_DETAIL_FIELDS = new Set([
  'site_id','hole_id','status','notes','assigned_rig','scheduled_start','scheduled_end','bh_type','easting','northing','rl'
]);

function boreholeDetailsExtraKey() {
  return 'drillops_borehole_details_extra_'+boreholePlanningContractor();
}

function getBoreholeDetailsExtras() {
  try { return JSON.parse(localStorage.getItem(boreholeDetailsExtraKey())||'{}')||{}; }
  catch(e) { return {}; }
}

function setBoreholeDetailsExtra(holeId, col, val) {
  const extras = getBoreholeDetailsExtras();
  if(!extras[holeId]) extras[holeId] = {};
  extras[holeId][col] = val;
  localStorage.setItem(boreholeDetailsExtraKey(), JSON.stringify(extras));
}

async function loadBoreholeDetails() {
  if(!bhData.length) await loadBoreholes();
  else renderBoreholeDetails();
}

function syncBoreholeDetailsProjectFilter(rows) {
  const sel = document.getElementById('details-project-filter');
  if(!sel) return;
  const current = sel.value;
  const projects = Array.from(new Set(rows.map(function(b){return b.project||'Unassigned';}))).sort();
  sel.innerHTML = '<option value="">All Projects</option>';
  projects.forEach(function(p) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
  if(projects.includes(current)) sel.value = current;
}

function boreholeDetailUrl(b) {
  const p = new URLSearchParams({
    contractor: boreholePlanningContractor(),
    hole: b.hole_id || '',
    site: b.site_id || ''
  });
  return 'borehole.html?' + p.toString();
}

function detailsCellValue(b, col) {
  if(col.extra) return (getBoreholeDetailsExtras()[b.hole_id]||{})[col.key] ?? '';
  if(col.key==='hole_id') return displayHoleId(b);
  return b[col.key];
}

function formatDetailValue(value, col) {
  if(value==null || value==='') return '';
  const n = parseFloat(value);
  if(col.money) return isNaN(n) ? '' : '$'+Math.round(n).toLocaleString('en-AU');
  if(col.num) return isNaN(n) ? '' : n.toLocaleString('en-AU', {minimumFractionDigits:col.digits||0, maximumFractionDigits:col.digits||0});
  return esc(value);
}

function renderBoreholeDetails() {
  const head = document.getElementById('details-head');
  const body = document.getElementById('details-body');
  if(!head || !body) return;
  const allRows = (bhData||[]).slice().sort(function(a,b) {
    const projectCompare = String(a.project||'Unassigned').localeCompare(String(b.project||'Unassigned'));
    if(projectCompare) return projectCompare;
    return (parseFloat(a.drill_order)||9999) - (parseFloat(b.drill_order)||9999);
  });
  syncBoreholeDetailsProjectFilter(allRows);
  const projectFilter = activeProjectName || '';
  const statusFilter = document.getElementById('details-status-filter')?.value || '';
  const search = (document.getElementById('details-search')?.value || '').trim().toLowerCase();
  const rows = allRows.filter(function(b) {
    const project = b.project||'Unassigned';
    if(projectFilter && project!==projectFilter) return false;
    if(!boreholeMatchesActiveProgram(b)) return false;
    if(statusFilter && (b.status||'Planned')!==statusFilter) return false;
    if(search) {
      const haystack = [b.project,b.site_id,b.hole_id,b.status,b.bh_type,b.bit_type,b.purpose,b.notes].join(' ').toLowerCase();
      if(!haystack.includes(search)) return false;
    }
    return true;
  });
  boreholeDetailsCsvData = rows.map(function(b) {
    const out = {};
    BOREHOLE_DETAIL_COLUMNS.forEach(function(col){ out[col.label] = detailsCellValue(b,col); });
    return out;
  });
  head.innerHTML = BOREHOLE_DETAIL_COLUMNS.map(function(col){return '<th>'+esc(col.label)+'</th>';}).join('');
  body.innerHTML = rows.map(function(b) {
    return '<tr data-hole="'+esc(b.hole_id)+'">' + BOREHOLE_DETAIL_COLUMNS.map(function(col) {
      const value = detailsCellValue(b,col);
      if(col.type==='status') {
        const status = b.status||'Planned';
        const opts = ['Planned','In Progress','Complete','Cancelled'].map(function(s) {
          return '<option value="'+s+'"'+(s===status?' selected':'')+'>'+s+'</option>';
        }).join('');
        return '<td><select onchange="saveBoreholeDetailCell(&apos;'+esc(b.hole_id)+'&apos;,&apos;status&apos;,this.value,false)" style="font-size:11px;background:#fff;border:1.5px solid var(--border);border-radius:12px;padding:2px 6px;outline:none;font-family:var(--font);">'+opts+'</select></td>';
      }
      if(col.key==='site_id') {
        return '<td><a href="'+boreholeDetailUrl(b)+'" target="_blank" style="font-weight:700;color:var(--accent);text-decoration:none;">'+esc(value||'Open')+'</a></td>';
      }
      const attrs = col.editable ? 'contenteditable="true" data-col="'+col.key+'" '+(col.num?'data-num="true" ':'')+(col.extra?'data-extra="true" ':'') : '';
      const cls = col.editable ? '' : ' class="readonly-cell"';
      const style = col.key==='hole_id' ? ' style="font-weight:700;color:var(--accent);"' : (col.key==='notes' ? ' style="min-width:220px;white-space:normal;"' : '');
      return '<td'+cls+' '+attrs+style+'>'+formatDetailValue(value,col)+'</td>';
    }).join('') + '</tr>';
  }).join('') || '<tr><td colspan="'+BOREHOLE_DETAIL_COLUMNS.length+'"><div class="empty-state">No boreholes match the selected filters</div></td></tr>';
  const totalArea = rows.reduce(function(sum,b){return sum+(parseFloat(detailsCellValue(b,{key:'area_m2',extra:true}))||0);},0);
  const inspected = rows.filter(function(b){return detailsCellValue(b,{key:'site_inspection',extra:true});}).length;
  const projects = Array.from(new Set(rows.map(function(b){return b.project||'Unassigned';})));
  const complete = rows.filter(function(b){return b.status==='Complete';}).length;
  document.getElementById('details-count').textContent = rows.length;
  document.getElementById('details-kpi-rows').textContent = rows.length;
  document.getElementById('details-kpi-projects').textContent = projects.length;
  document.getElementById('details-kpi-depth').textContent = totalArea ? totalArea.toLocaleString('en-AU', {maximumFractionDigits:1})+' m2' : '—';
  document.getElementById('details-kpi-budget').textContent = inspected;
  document.getElementById('details-kpi-complete').textContent = complete;
  body.querySelectorAll('[contenteditable]').forEach(function(cell) {
    cell.addEventListener('blur', function() {
      const row = cell.closest('tr');
      const holeId = row.dataset.hole;
      const col = cell.dataset.col;
      let val = cell.textContent.trim().replace(/[$,]/g,'');
      if(col==='hole_id' && !val) {
        renderBoreholeDetails();
        return;
      }
      saveBoreholeDetailCell(holeId, col, val, !!cell.dataset.num, !!cell.dataset.extra);
    });
  });
  makeTableSortable('details-table');
}

async function saveBoreholeDetailCell(holeId, col, rawVal, isNumeric, isExtra) {
  const bh = bhData.find(function(b){return b.hole_id===holeId;});
  if(!bh) return;
  const oldHoleId = holeId;
  let val = rawVal;
  if(isNumeric) val = val==='' ? null : parseFloat(val);
  if(col==='hole_id' && !val) return;
  if(isExtra || !BOREHOLE_DB_DETAIL_FIELDS.has(col)) {
    setBoreholeDetailsExtra(oldHoleId, col, val);
    toast('Saved');
    renderBoreholeDetails();
    return;
  }
  const previousValue = bh[col];
  bh[col] = val;
  if((col==='easting'||col==='northing')&&bh.easting&&bh.northing) {
    const wgs = mgaToWgs84(bh.easting, bh.northing);
    bh.lat = wgs.lat; bh.lng = wgs.lng;
  }
  try {
    const res = await fetch(API+'/boreholes/'+encodeURIComponent(oldHoleId), {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:boreholePlanningContractor(),[col]:val})
    });
    if(!res.ok) throw new Error(await res.text());
    toast('Saved');
  } catch(e) {
    bh[col] = previousValue;
    toast('Save failed: '+((e&&e.message)||'change was not saved'),'err');
  }
  if(col==='hole_id') {
    await loadBoreholes(true);
    return;
  }
  renderBoreholeDetails();
  updateBhKPIs();
  if(isPageActive('boreholes')) {
    filterBoreholesByProject();
  }
}

var selectedScheduleHoleId = null;
var scheduleRenderedRows = [];

async function loadDrillingSchedule() {
  if(!bhData.length) await loadBoreholes();
  else renderDrillingSchedule();
}

async function updateDrillingSchedule() {
  await loadBoreholes(true);
  toast('Schedule updated');
}

function syncScheduleProjectFilter(rows) {
  const sel = document.getElementById('schedule-project-filter');
  if(!sel) return;
  const current = sel.value;
  const projects = Array.from(new Set(rows.map(function(b){return b.project||'Unassigned';}))).sort();
  sel.innerHTML = '<option value="">All Projects</option>';
  projects.forEach(function(p) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
  if(projects.includes(current)) sel.value = current;
}

function syncScheduleRigFilter(rows) {
  const sel = document.getElementById('schedule-rig-filter');
  if(!sel) return;
  const current = sel.value;
  const rigs = Array.from(new Set(rows.map(scheduleRigFor))).sort(function(a,b){
    if(a==='Unassigned') return 1;
    if(b==='Unassigned') return -1;
    return a.localeCompare(b);
  });
  sel.innerHTML = '<option value="">All Rigs</option>';
  rigs.forEach(function(rig) {
    const opt = document.createElement('option');
    opt.value = rig;
    opt.textContent = rig;
    sel.appendChild(opt);
  });
  if(rigs.includes(current)) sel.value = current;
}

function scheduleStatusClass(status) {
  const s = String(status||'Planned').toLowerCase().replace(/\s+/g,'-');
  return ['planned','in-progress','complete','cancelled'].includes(s) ? s : 'planned';
}

function parseScheduleDate(value) {
  if(!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if(m) {
    const year = parseInt(m[3].length===2 ? '20'+m[3] : m[3],10);
    const d = new Date(year, parseInt(m[2],10)-1, parseInt(m[1],10));
    return isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m) {
    const d = new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function scheduleIso(d) {
  if(!d) return '';
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function scheduleDateFromIso(iso) {
  const d = parseScheduleDate(iso);
  return d || new Date();
}

function scheduleAddDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate()+days);
  return d;
}

function scheduleDayDiff(a,b) {
  const aa = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bb = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bb-aa)/86400000);
}

function scheduleDurationDays(b) {
  return Math.max(1, Math.ceil(parseFloat(b.days_budgeted||b.days)||1));
}

function scheduleRigFor(b) {
  return String(b.assigned_rig||b.drill_rig||'').trim() || 'Unassigned';
}

function scheduleStoredStart(b) {
  const extra = (getBoreholeDetailsExtras()[b.hole_id]||{});
  return scheduleIso(parseScheduleDate(b.scheduled_start || extra.start_date));
}

function scheduleStoredEnd(b) {
  const extra = (getBoreholeDetailsExtras()[b.hole_id]||{});
  return scheduleIso(parseScheduleDate(b.scheduled_end || extra.end_date));
}

function scheduleDateLabel(d) {
  return d.toLocaleDateString('en-AU', {day:'2-digit', month:'short'});
}

function ensureScheduleRange(rows) {
  const fromEl = document.getElementById('schedule-from');
  const toEl = document.getElementById('schedule-to');
  if(!fromEl || !toEl) return {from:scheduleIso(new Date()), to:scheduleIso(scheduleAddDays(new Date(),30))};
  if(!fromEl.value || !toEl.value) {
    const starts = rows.map(scheduleStoredStart).filter(Boolean).sort();
    const first = starts[0] || scheduleIso(new Date());
    fromEl.value = first;
    toEl.value = scheduleIso(scheduleAddDays(scheduleDateFromIso(first), 30));
  }
  if(scheduleDateFromIso(toEl.value) < scheduleDateFromIso(fromEl.value)) {
    toEl.value = scheduleIso(scheduleAddDays(scheduleDateFromIso(fromEl.value), 30));
  }
  return {from:fromEl.value, to:toEl.value};
}

function buildScheduleRows(rows, rangeStartIso) {
  const startBase = scheduleDateFromIso(rangeStartIso);
  const cursors = {};
  return rows.map(function(b) {
    const rig = scheduleRigFor(b);
    const duration = scheduleDurationDays(b);
    let startIso = scheduleStoredStart(b);
    let startDate = startIso ? scheduleDateFromIso(startIso) : (cursors[rig] || startBase);
    let endIso = scheduleStoredEnd(b);
    let endDate = endIso ? scheduleDateFromIso(endIso) : scheduleAddDays(startDate, duration-1);
    if(endDate < startDate) endDate = startDate;
    cursors[rig] = scheduleAddDays(endDate, 1);
    return {
      borehole:b,
      hole:b.hole_id||'Hole',
      site:b.site_id||'',
      project:b.project||'Unassigned',
      rig:rig,
      status:b.status||'Planned',
      startIso:scheduleIso(startDate),
      endIso:scheduleIso(endDate),
      startDate:startDate,
      endDate:endDate,
      days:scheduleDayDiff(startDate,endDate)+1
    };
  });
}

function renderDrillingSchedule() {
  const grid = document.getElementById('schedule-grid');
  if(!grid) return;
  const baseRows = (bhData||[]).slice().sort(function(a,b) {
    const rigCompare = scheduleRigFor(a).localeCompare(scheduleRigFor(b));
    if(rigCompare) return rigCompare;
    const projectCompare = String(a.project||'Unassigned').localeCompare(String(b.project||'Unassigned'));
    if(projectCompare) return projectCompare;
    return (parseFloat(a.drill_order)||9999) - (parseFloat(b.drill_order)||9999);
  });
  syncScheduleProjectFilter(baseRows);
  syncScheduleRigFilter(baseRows);
  const projectFilter = activeProjectName || '';
  const statusFilter = document.getElementById('schedule-status-filter')?.value || '';
  const rigFilter = document.getElementById('schedule-rig-filter')?.value || '';
  const range = ensureScheduleRange(baseRows);
  const rangeStart = scheduleDateFromIso(range.from);
  const rangeEnd = scheduleDateFromIso(range.to);
  const dayCount = Math.max(1, Math.min(180, scheduleDayDiff(rangeStart, rangeEnd)+1));
  const rows = buildScheduleRows(baseRows, range.from).filter(function(r) {
    if(projectFilter && r.project!==projectFilter) return false;
    if(!boreholeMatchesActiveProgram(r.borehole)) return false;
    if(statusFilter && r.status!==statusFilter) return false;
    if(rigFilter && r.rig!==rigFilter) return false;
    return r.endDate >= rangeStart && r.startDate <= rangeEnd;
  });
  scheduleRenderedRows = rows;
  grid.style.setProperty('--schedule-days', dayCount);
  grid.style.minWidth = Math.max(1040, 260 + dayCount*46) + 'px';
  const rigs = Array.from(new Set(rows.map(function(r){return r.rig;})));
  const projects = Array.from(new Set(rows.map(function(r){return r.project;})));
  const totalDays = rows.reduce(function(sum,r){return sum+r.days;},0);
  const complete = rows.filter(function(r){return r.status==='Complete';}).length;
  const holesEl = document.getElementById('schedule-kpi-holes');
  const rigsEl = document.getElementById('schedule-kpi-rigs');
  const projectsEl = document.getElementById('schedule-kpi-projects');
  const daysEl = document.getElementById('schedule-kpi-days');
  const completeEl = document.getElementById('schedule-kpi-complete');
  if(holesEl) holesEl.textContent = rows.length;
  if(rigsEl) rigsEl.textContent = rigs.length;
  if(projectsEl) projectsEl.textContent = projects.length;
  if(daysEl) daysEl.textContent = totalDays ? totalDays.toFixed(0)+' d' : '--';
  if(completeEl) completeEl.textContent = complete;
  if(!rows.length) {
    grid.innerHTML = '<div class="schedule-empty">No boreholes match the selected scheduler filters.</div>';
    renderScheduleDetail();
    return;
  }
  const today = scheduleIso(new Date());
  const dayHeaders = Array.from({length:dayCount}, function(_,i) {
    const d = scheduleAddDays(rangeStart, i);
    const cls = scheduleIso(d)===today ? ' schedule-day today' : ' schedule-day';
    return '<div class="'+cls.trim()+'"><div>'+scheduleDateLabel(d)+'</div><div>'+d.toLocaleDateString('en-AU',{weekday:'short'})+'</div></div>';
  }).join('');
  let html = '<div class="schedule-header"><div class="schedule-left">Rig / Hole</div><div class="schedule-head-scale">'+dayHeaders+'</div></div>';
  const grouped = {};
  rows.forEach(function(r) {
    if(!grouped[r.rig]) grouped[r.rig] = [];
    grouped[r.rig].push(r);
  });
  Object.keys(grouped).sort(function(a,b){
    if(a==='Unassigned') return 1;
    if(b==='Unassigned') return -1;
    return a.localeCompare(b);
  }).forEach(function(rig) {
    const rigRows = grouped[rig].sort(function(a,b){
      return a.startDate-b.startDate || a.project.localeCompare(b.project) || a.hole.localeCompare(b.hole);
    });
    const rigDays = rigRows.reduce(function(sum,r){return sum+r.days;},0);
    html += '<div class="schedule-row schedule-rig"><div class="schedule-left">'+esc(rig)+'</div><div class="schedule-track"><div style="grid-column:1 / -1;padding:8px 10px;font-size:11px;font-weight:700;color:#254b3a;">'+rigRows.length+' holes <span class="schedule-util">&middot; '+rigDays+' scheduled days in view</span></div></div></div>';
    rigRows.forEach(function(r) {
      const startCol = Math.max(1, scheduleDayDiff(rangeStart, r.startDate)+1);
      const endCol = Math.min(dayCount+1, scheduleDayDiff(rangeStart, r.endDate)+2);
      const selected = r.hole===selectedScheduleHoleId ? ' selected' : '';
      html += '<div class="schedule-row">'
        +'<div class="schedule-left"><span class="schedule-status-dot '+scheduleStatusClass(r.status)+'"></span><div class="schedule-hole-meta"><div class="schedule-hole-title">'+esc(r.hole)+'</div><div class="schedule-hole-sub">'+esc(r.project+' · '+(r.site||'No site')+' · '+r.startIso+' to '+r.endIso)+'</div></div></div>'
        +'<div class="schedule-track"><button class="schedule-bar '+scheduleStatusClass(r.status)+selected+'" type="button" onclick="selectScheduleHole(&apos;'+attr(r.hole)+'&apos;)" title="'+attr(r.hole+' · '+r.rig+' · '+r.startIso+' to '+r.endIso)+'" style="grid-column:'+startCol+' / '+endCol+';">'+esc(r.hole)+'</button></div>'
        +'</div>';
    });
  });
  grid.innerHTML = html;
  renderScheduleDetail();
}

function renderScheduleDetail() {
  const row = scheduleRenderedRows.find(function(r){return r.hole===selectedScheduleHoleId;});
  const b = row ? row.borehole : bhData.find(function(x){return x.hole_id===selectedScheduleHoleId;});
  const title = document.getElementById('schedule-detail-title');
  const sub = document.getElementById('schedule-detail-sub');
  if(!b) {
    if(title) title.textContent = 'Select a scheduled hole';
    if(sub) sub.textContent = 'Rig and date changes save to the borehole database.';
    ['schedule-detail-rig','schedule-detail-start','schedule-detail-end','schedule-detail-days','schedule-detail-notes'].forEach(function(id){const el=document.getElementById(id); if(el) el.value='';});
    const st = document.getElementById('schedule-detail-status'); if(st) st.value='Planned';
    return;
  }
  const display = row || buildScheduleRows([b], document.getElementById('schedule-from')?.value || scheduleIso(new Date()))[0];
  if(title) title.textContent = b.hole_id || 'Scheduled hole';
  if(sub) sub.textContent = [b.site_id,b.project,b.bh_type||b.type,b.bit_type].filter(Boolean).join(' · ') || 'Borehole schedule';
  document.getElementById('schedule-detail-rig').value = display.rig==='Unassigned' ? '' : display.rig;
  document.getElementById('schedule-detail-start').value = display.startIso;
  document.getElementById('schedule-detail-end').value = display.endIso;
  document.getElementById('schedule-detail-days').value = parseFloat(b.days_budgeted||b.days)||display.days||1;
  document.getElementById('schedule-detail-status').value = b.status||'Planned';
  document.getElementById('schedule-detail-notes').value = b.notes||'';
}

function selectScheduleHole(holeId) {
  selectedScheduleHoleId = holeId;
  renderDrillingSchedule();
}

async function saveScheduleDetail() {
  if(!selectedScheduleHoleId) { toast('Select a hole first','err'); return; }
  const b = bhData.find(function(x){return x.hole_id===selectedScheduleHoleId;});
  if(!b) { toast('Selected hole not found','err'); return; }
  const rig = document.getElementById('schedule-detail-rig').value.trim();
  const start = document.getElementById('schedule-detail-start').value;
  const end = document.getElementById('schedule-detail-end').value;
  const days = parseFloat(document.getElementById('schedule-detail-days').value)||null;
  const status = document.getElementById('schedule-detail-status').value;
  const notes = document.getElementById('schedule-detail-notes').value.trim();
  if(start && end && scheduleDateFromIso(end) < scheduleDateFromIso(start)) {
    toast('End date must be after start date','err');
    return;
  }
  const payload = {contractor:boreholePlanningContractor(), assigned_rig:rig, scheduled_start:start, scheduled_end:end, days_budgeted:days, status:status, notes:notes};
  try {
    const res = await fetch(API+'/boreholes/'+encodeURIComponent(selectedScheduleHoleId), {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(await res.text());
    Object.assign(b, payload);
    toast('Schedule saved');
    renderDrillingSchedule();
    updateBhKPIs();
    if(isPageActive('boreholes')) filterBoreholesByProject();
  } catch(e) {
    toast('Save failed: '+((e&&e.message)||'schedule was not saved'),'err');
  }
}

function openSelectedScheduleBorehole() {
  const b = bhData.find(function(x){return x.hole_id===selectedScheduleHoleId;});
  if(!b) { toast('Select a hole first','err'); return; }
  window.open(boreholeDetailUrl(b), '_blank');
}

function updateBhKPIs(rows) {
  const scopedRows = Array.isArray(rows) ? rows : currentFilteredBoreholes();
  const budgetScopeRows = scopedRows.filter(function(b){return b.current_budget_scope!==false;});
  const complete = scopedRows.filter(b => b.status==='Complete').length;
  const inprog   = scopedRows.filter(b => b.status==='In Progress').length;
  const planned  = scopedRows.filter(b => b.status==='Planned').length;
  const totalBudget = budgetScopeRows.reduce((s,b) => s+(parseFloat(b.budget_total)||0), 0);
  const drillingBudget = budgetScopeRows.reduce((s,b) => s+(parseFloat(b.drilling_budget_total)||0), 0);
  const totalDays   = budgetScopeRows.reduce((s,b) => s+(parseFloat(b.days_budgeted||b.days)||0), 0);
  const totalEos    = scopedRows.reduce((s,b) => s+(parseFloat(b.eos_cost)||0), 0);
  const totalDrilling = scopedRows.reduce((s,b) => s+(parseFloat(b.drilling_cost)||0), 0);
  const variance    = totalDrilling - drillingBudget;
  document.getElementById('bh-kpi-total').textContent = scopedRows.length;
  document.getElementById('bh-kpi-complete').textContent = complete;
  document.getElementById('bh-kpi-inprog').textContent = inprog;
  document.getElementById('bh-kpi-planned').textContent = planned;
  document.getElementById('bh-kpi-budget').textContent = totalBudget>0 ? '$'+Math.round(totalBudget).toLocaleString('en-AU') : '—';
  document.getElementById('bh-kpi-days').textContent = totalDays>0 ? totalDays.toFixed(1)+' days' : '—';
  document.getElementById('bh-kpi-actual').textContent = totalDrilling>0 ? '$'+Math.round(totalDrilling).toLocaleString('en-AU') : '—';
  const vEl = document.getElementById('bh-kpi-variance');
  if(vEl && drillingBudget>0) {
    vEl.textContent = (variance>=0?'+':'')+Math.round(variance).toLocaleString('en-AU');
    vEl.style.color = variance>0?'var(--red)':variance<0?'var(--green)':'var(--muted)';
  }
  renderBhBudgetSummary(budgetScopeRows);
  renderBoreholeCompletionChart(scopedRows);
}

function renderBoreholeCompletionChart(rows) {
  destroyChart('bh-completions');
  const canvas = document.getElementById('bh-completions-chart');
  const status = document.getElementById('bh-completion-status');
  if(!canvas || !status) return;
  const year = document.getElementById('bh-year-select')?.value || '';
  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const counts = Array(12).fill(0);
  let dated = 0, undated = 0;
  (rows||[]).filter(function(b){return b.status==='Complete';}).forEach(function(b) {
    const value = String(b.completion_date||'');
    const match = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
    if(!match || (year && match[1]!==year)) { undated++; return; }
    counts[parseInt(match[2],10)-1]++;
    dated++;
  });
  status.textContent = dated+' completed with a final drilling date'+(undated ? ' · '+undated+' without a dated completion' : '');
  if(typeof Chart==='undefined') return;
  charts['bh-completions'] = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{labels:labels,datasets:[{label:'Holes completed',data:counts,backgroundColor:'rgba(49, 93, 73, .82)',borderColor:'#315d49',borderWidth:1,borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(context){return context.parsed.y+' hole'+(context.parsed.y===1?'':'s')+' completed';}}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,ticks:{precision:0,stepSize:1},title:{display:true,text:'Holes completed'},grid:{color:'rgba(148, 163, 184, .18)'}}}}
  });
}

function renderBhBudgetSummary(rows) {
  const el = document.getElementById('bh-budget-summary');
  if(!el) return;
  const scopedRows = Array.isArray(rows) ? rows : currentFilteredBoreholes();
  const groups = {};
  scopedRows.forEach(b => {
    const k = (b.purpose||'Other').split('/')[0].trim();
    if(!groups[k]) groups[k] = {count:0,days:0,budget:0};
    groups[k].count++;
    groups[k].days += parseFloat(b.days_budgeted||b.days)||0;
    groups[k].budget += parseFloat(b.budget_total)||0;
  });
  el.innerHTML = Object.entries(groups).sort((a,b) => b[1].count-a[1].count).map(function(entry) {
    const k=entry[0], v=entry[1];
    return '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 12px;">'
      +'<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px;">'+esc(k)+'</div>'
      +'<div style="font-size:11px;color:var(--muted);">'+v.count+' holes &middot; '+v.days.toFixed(1)+' days</div>'
      +(v.budget>0?'<div style="font-size:13px;font-weight:700;color:var(--accent);margin-top:4px;">$'+Math.round(v.budget).toLocaleString('en-AU')+'</div>':'')
      +'</div>';
  }).join('');
}

function initBhMap() {
  if(bhMap) { bhMap.remove(); bhMap=null; }
  mapOverlayLayers = [];
  mapOverlaysAutoLoaded = false;
  mapOverlayProjectKey = '';
  setMapOverlayStatus('Mine drawings loading...');
  const el = document.getElementById('bh-map');
  if(!el) return;
  ['bh-filter-core','bh-filter-chip','bh-filter-labels'].forEach(function(id){var cb=document.getElementById(id);if(cb)cb.checked=true;});
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'OSM'});
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri'});
  bhMap = L.map('bh-map', {layers:[osm],center:[-22,148.25],zoom:11});
  L.control.layers({'Street':osm,'Satellite':sat}).addTo(bhMap);
  renderBhMapFiltered(currentFilteredBoreholes());
  bhMap.invalidateSize();
  setTimeout(loadDefaultMapOverlays, 250);
}

document.addEventListener('DOMContentLoaded',function(){
  var recalcBtn=document.getElementById('recalc-db-btn');
  if(recalcBtn) recalcBtn.addEventListener('click',function(e){
    e.preventDefault();
    recalculateDatabaseFromRates();
  });
});

function renderBhMap() {
  if(!bhMap) return;
  bhMarkers.forEach(function(m){try{m.remove();}catch(e){}});
  bhMarkers = [];
  const showCore   = document.getElementById('bh-filter-core') ? document.getElementById('bh-filter-core').checked : true;
  const showChip   = document.getElementById('bh-filter-chip') ? document.getElementById('bh-filter-chip').checked : true;
  const showLabels = document.getElementById('bh-filter-labels') ? document.getElementById('bh-filter-labels').checked : true;
  const visible = bhData.filter(function(b) {
    b.lat = parseFloat(b.lat);
    b.lng = parseFloat(b.lng);
    if(!Number.isFinite(b.lat)||!Number.isFinite(b.lng)) return false;
    const t = b.type||b.bh_type||'';
    return t==='Core' ? showCore : showChip;
  });

  visible.forEach(function(b) {
    const col = getBhColor(b);
    const t = b.type||b.bh_type||'Core';
    let marker;
    if(t==='Core') {
      marker = L.circleMarker([b.lat,b.lng], {radius:7,color:'#fff',weight:1.5,fillColor:col,fillOpacity:0.9});
    } else {
      marker = L.marker([b.lat,b.lng], {icon:L.divIcon({
        html:'<div style="width:13px;height:13px;background:'+col+';border:2px solid #fff;border-radius:2px;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>',
        iconSize:[13,13], iconAnchor:[6,6], className:''
      })});
    }
    const eos = parseFloat(b.eos_cost)||0;
    const drilling = parseFloat(b.drilling_cost)||0;
    const budget = parseFloat(b.budget_total)||0;
    const drillingBudget = parseFloat(b.drilling_budget_total)||0;
    const popupHtml = '<div style="font-family:Inter,sans-serif;min-width:190px;">'
      +'<div style="font-weight:700;font-size:15px;margin-bottom:2px;">'+b.hole_id+'</div>'
      +'<div style="color:#6b7280;font-size:12px;margin-bottom:8px;">'+t+' &middot; '+(b.bit_type||'')+' &middot; '+(b.purpose||'')+'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:8px;">'
      +'<div><div style="color:#9ca3af;font-size:10px;">EASTING</div>'+(b.easting||0).toFixed(0)+'</div>'
      +'<div><div style="color:#9ca3af;font-size:10px;">NORTHING</div>'+(b.northing||0).toFixed(0)+'</div>'
      +'<div><div style="color:#9ca3af;font-size:10px;">RL</div>'+(b.rl||0).toFixed(1)+'m</div>'
      +'<div><div style="color:#9ca3af;font-size:10px;">DEPTH</div>'+(b.chip_depth||0).toFixed(1)+'m</div>'
      +'<div><div style="color:#9ca3af;font-size:10px;">SEAM</div>'+(b.seam_tk||'—')+'m</div>'
      +'<div><div style="color:#9ca3af;font-size:10px;">DAYS</div>'+(b.days_budgeted||b.days||'—')+'</div>'
      +'</div>'
      +(budget>0?'<div style="font-size:12px;margin-bottom:4px;">Budget: <b>$'+budget.toLocaleString('en-AU',{maximumFractionDigits:0})+'</b></div>':'')
      +(drillingBudget>0?'<div style="font-size:12px;margin-bottom:4px;">Drilling budget: <b>$'+drillingBudget.toLocaleString('en-AU',{maximumFractionDigits:0})+'</b></div>':'')
      +(drilling>0?'<div style="font-size:12px;margin-bottom:4px;">Drilling spend: <b style="color:'+(drilling>drillingBudget&&drillingBudget>0?'#dc2626':'#16a34a')+'">$'+drilling.toLocaleString('en-AU',{maximumFractionDigits:0})+'</b></div>':'')
      +(eos>0?'<div style="font-size:12px;margin-bottom:8px;">Total EOS: <b style="color:var(--accent)">$'+eos.toLocaleString('en-AU',{maximumFractionDigits:0})+'</b></div>':'')
      +'<span style="background:'+col+'22;color:'+col+';padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">'+b.status+'</span>'
      +'<div style="margin-top:10px;display:flex;gap:6px;">'
      +'<button onclick="setBhStatus(&apos;'+b.hole_id+'&apos;,&apos;In Progress&apos;)" style="font-size:10px;padding:3px 8px;background:#fef3c7;border:1px solid #d97706;color:#d97706;border-radius:4px;cursor:pointer;">&#9654; Start</button>'
      +'<button onclick="setBhStatus(&apos;'+b.hole_id+'&apos;,&apos;Complete&apos;)" style="font-size:10px;padding:3px 8px;background:#dcfce7;border:1px solid #16a34a;color:#16a34a;border-radius:4px;cursor:pointer;">&#10003; Complete</button>'
      +'</div></div>';
    marker.bindPopup(popupHtml);
    if(showLabels) {
      marker.bindTooltip(b.hole_id, {permanent:true, direction:'right', className:'bh-label', offset:[8,0]});
    }
    marker.addTo(bhMap);
    bhMarkers.push(marker);
  });
  if(visible.length) {
    bhMap.fitBounds(L.latLngBounds(visible.map(function(b){return[b.lat,b.lng];})), {padding:[20,20]});
  }
}

async function setBhStatus(holeId, status) {
  const bh = bhData.find(function(b){return b.hole_id===holeId;});
  if(!bh) return;
  const previous = bh.status;
  bh.status = status;
  try {
    const res = await fetch(API+'/boreholes/'+encodeURIComponent(holeId), {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:boreholePlanningContractor(),status:status})
    });
    if(!res.ok) throw new Error(await res.text());
    toast('✓ '+holeId+' → '+status);
  } catch(e) {
    bh.status = previous;
    toast('Save failed: '+((e&&e.message)||'status was not saved'),'err');
  }
  filterBoreholesByProject();
}

function filterBhTable() {
  const sf = document.getElementById('bh-status-filter').value;
  const scopedRows = currentFilteredBoreholes();
  const rows = sf==='current' ? scopedRows.filter(function(b){return b.status!=='Cancelled';})
    : (sf ? scopedRows.filter(function(b){return b.status===sf;}) : scopedRows);
  renderBhTable(rows);
}

function renderBhTable(rows) {
  document.getElementById('bh-count').textContent = rows.length;
  boreholesCsvData = rows;
  const STATUS_CLR = {Planned:'#6b7280','In Progress':'#d97706',Complete:'#16a34a',Cancelled:'#dc2626'};
  document.getElementById('bh-body').innerHTML = rows.map(function(b) {
    const eos = parseFloat(b.eos_cost)||0;
    const drilling = parseFloat(b.drilling_cost)||0;
    const bgt = parseFloat(b.budget_total)||0;
    const drillingBudget = parseFloat(b.drilling_budget_total)||0;
    const drillingVariance = drillingBudget>0 ? drilling-drillingBudget : null;
    const sc = STATUS_CLR[b.status]||'#6b7280';
    const t = b.type||b.bh_type||'Core';
    const statusOpts = ['Planned','In Progress','Complete','Cancelled'].map(function(s) {
      return '<option value="'+s+'"'+(s===b.status?' selected':'')+'>'+s+'</option>';
    }).join('');
    return '<tr data-hole="'+esc(b.hole_id)+'" style="cursor:pointer;" onclick="bhMap&&bhMap.setView(['+b.lat+','+b.lng+'],16)">'
      +'<td style="color:var(--muted);font-size:11px;">'+(b.drill_order||'')+'</td>'
      +'<td contenteditable="true" data-col="project" style="font-size:12px;">'+ esc(b.project||'')+'</td>'
      +'<td contenteditable="true" data-col="planned_year" style="font-size:12px;">'+ esc(b.planned_year||'')+'</td>'
      +'<td style="font-size:12px;"><a href="'+boreholeDetailUrl(b)+'" target="_blank" onclick="event.stopPropagation()" style="font-weight:700;color:var(--accent);text-decoration:none;">'+ esc(b.site_id||'Open')+'</a></td>'
      +'<td contenteditable="true" data-col="hole_id" onclick="event.stopPropagation()" style="font-weight:700;color:var(--accent);min-width:90px;">'+esc(displayHoleId(b))+'</td>'
      +'<td contenteditable="true" data-col="bh_type"><span class="badge '+(t==='Core'?'badge-drill':'badge-standby')+'">'+esc(t)+'</span></td>'
      +'<td contenteditable="true" data-col="bit_type" style="font-family:var(--font-mono);font-size:11px;">'+esc(b.bit_type||'')+'</td>'
      +'<td contenteditable="true" data-col="purpose" style="font-size:12px;max-width:130px;overflow:hidden;text-overflow:ellipsis;">'+esc(b.purpose||'')+'</td>'
      +'<td contenteditable="true" data-col="easting" data-num="true" style="font-family:var(--font-mono);font-size:11px;">'+(b.easting||0).toFixed(0)+'</td>'
      +'<td contenteditable="true" data-col="northing" data-num="true" style="font-family:var(--font-mono);font-size:11px;">'+(b.northing||0).toFixed(0)+'</td>'
      +'<td contenteditable="true" data-col="rl" data-num="true" style="font-family:var(--font-mono);font-size:11px;">'+(b.rl||0).toFixed(1)+'</td>'
      +'<td contenteditable="true" data-col="chip_depth" data-num="true" style="font-family:var(--font-mono);font-size:11px;">'+(b.chip_depth||0).toFixed(1)+'</td>'
      +'<td contenteditable="true" data-col="eoh_depth" data-num="true" style="font-family:var(--font-mono);font-size:11px;">'+(b.eoh_depth||0).toFixed(1)+'</td>'
      +'<td contenteditable="true" data-col="total_core" data-num="true" style="font-family:var(--font-mono);font-size:11px;">'+(b.total_core||0).toFixed(1)+'</td>'
      +'<td contenteditable="true" data-col="seam_tk" data-num="true" style="font-family:var(--font-mono);font-size:11px;">'+(b.seam_tk||'')+'</td>'
      +'<td contenteditable="true" data-col="days_budgeted" data-num="true" style="font-family:var(--font-mono);font-size:11px;">'+(b.days_budgeted||b.days||'')+'</td>'
      +'<td><select onclick="event.stopPropagation()" onchange="setBhStatus(&apos;'+b.hole_id+'&apos;,this.value)" style="font-size:11px;background:'+sc+'18;color:'+sc+';border:1.5px solid '+sc+';border-radius:12px;padding:2px 6px;outline:none;font-family:var(--font);">'+statusOpts+'</select></td>'
      +'<td contenteditable="true" data-col="budget_total" data-num="true" style="font-weight:600;">'+(bgt>0?bgt.toLocaleString("en-AU",{maximumFractionDigits:0}):"")+'</td>'
      +'<td contenteditable="true" data-col="drilling_budget_total" data-num="true" style="font-weight:600;color:#254b3a;">'+(drillingBudget>0?drillingBudget.toLocaleString("en-AU",{maximumFractionDigits:0}):"")+'</td>'
      +'<td style="color:#254b3a;font-weight:700;">'+(drilling>0?"$"+drilling.toLocaleString("en-AU",{maximumFractionDigits:0}):"\u2014")+'</td>'
      +'<td style="color:var(--accent);font-weight:600;">'+(eos>0?"$"+eos.toLocaleString("en-AU",{maximumFractionDigits:0}):"\u2014")+'</td>'
      +'<td style="color:'+(drillingVariance===null?"var(--muted)":drillingVariance>0?"var(--red)":"var(--green)")+';font-weight:600;">'
        +(drillingVariance===null?"\u2014":(drillingVariance>0?"+":"")+("$"+Math.abs(Math.round(drillingVariance)).toLocaleString("en-AU")))+'</td>'
      +'<td contenteditable="true" data-col="notes" style="font-size:11px;color:var(--muted);max-width:120px;">'+esc(b.notes||'')+'</td>'
      +'<td><button onclick="deleteBorehole(&apos;'+esc(b.hole_id)+'&apos;)" style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:14px;">\u2715</button></td>'
      +'</tr>';
  }).join('');

  if(!rows.length)document.getElementById('bh-body').innerHTML='<tr><td colspan="24" style="padding:20px;color:var(--muted);">No boreholes match this project, year and filters. Add a borehole or import the plan for '+esc(activeProjectName||'this project')+'.</td></tr>';
  document.getElementById('bh-body').querySelectorAll('[contenteditable]').forEach(function(cell) {
    cell.addEventListener('blur', async function() {
      const row = cell.closest('tr');
      const holeId = row.dataset.hole;
      const col = cell.dataset.col;
      let val = cell.textContent.trim().replace(/[$,]/g,'');
      if(col==='hole_id' && !val) {
        filterBoreholesByProject();
        return;
      }
      if(cell.dataset.num) val = val===''?null:parseFloat(val);
      const bh = bhData.find(function(b){return b.hole_id===holeId;});
      if(bh) {
        bh[col] = val;
      }
      try {
        const res = await fetch(API+'/boreholes/'+encodeURIComponent(holeId), {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({contractor:boreholePlanningContractor(),[col]:val})
        });
        if(!res.ok) throw new Error(await res.text());
        toast('✓ Saved');
      } catch(e) { toast('Save failed: '+((e&&e.message)||'change was not saved'),'err'); }
      if(col==='hole_id') {
        await loadBoreholes(true);
        return;
      }
      updateBhKPIs();
      if(col==='easting'||col==='northing') await loadBoreholes(true);
    });
  });
  makeTableSortable('bh-table');
}

function showAddBhForm() {
  const f = document.getElementById('bh-add-form');
  f.style.display = f.style.display==='none'?'block':'none';
}

async function addBorehole() {
  const holeId = document.getElementById('add-bh-id').value.trim();
  if(!holeId) { toast('Hole ID required','err'); return; }
  if(bhData.find(function(b){return b.hole_id===holeId;})) { toast('Hole ID already exists','err'); return; }
  const easting  = parseFloat(document.getElementById('add-bh-east').value)||0;
  const northing = parseFloat(document.getElementById('add-bh-north').value)||0;
  const newBh = {
    hole_id:holeId,
    project:document.getElementById('add-bh-project').value,
    program:activeProgram||'Exploration',
    planned_year:document.getElementById('add-bh-year').value,
    site_id:document.getElementById('add-bh-site').value,
    bh_type:document.getElementById('add-bh-type').value,
    type:document.getElementById('add-bh-type').value,
    bit_type:document.getElementById('add-bh-bit').value,
    purpose:document.getElementById('add-bh-purpose').value,
    days_budgeted:parseFloat(document.getElementById('add-bh-days').value)||null,
    days:parseFloat(document.getElementById('add-bh-days').value)||null,
    easting:easting, northing:northing,
    rl:parseFloat(document.getElementById('add-bh-rl').value)||null,
    chip_depth:parseFloat(document.getElementById('add-bh-depth').value)||null,
    eoh_depth:parseFloat(document.getElementById('add-bh-eoh').value)||null,
    total_core:parseFloat(document.getElementById('add-bh-core').value)||null,
    seam_tk:parseFloat(document.getElementById('add-bh-seam').value)||null,
    drilling_budget_total:parseFloat(document.getElementById('add-bh-drilling-budget').value)||null,
    budget_total:parseFloat(document.getElementById('add-bh-budget').value)||null,
    status:document.getElementById('add-bh-status').value,
    notes:document.getElementById('add-bh-notes').value,
    drill_order:bhData.length+1,
    eos_cost:0, drilling_cost:0, drilling_metres:0, eos_metres:0
  };
  try {
    const res = await fetch(API+'/boreholes/import_budget', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:boreholePlanningContractor(), source_filename:'Manual borehole entry', boreholes:[newBh]})
    });
    if(!res.ok) { toast('Failed to add','err'); return; }
    ['add-bh-project','add-bh-year','add-bh-site','add-bh-id','add-bh-purpose','add-bh-days','add-bh-east','add-bh-north','add-bh-rl','add-bh-depth','add-bh-eoh','add-bh-core','add-bh-seam','add-bh-budget','add-bh-drilling-budget','add-bh-notes'].forEach(function(id){
      const el=document.getElementById(id); if(el) el.value='';
    });
    document.getElementById('bh-add-form').style.display='none';
    toast('✓ '+holeId+' added');
    await loadBoreholes(true);
  } catch(e) { toast('Failed: '+e.message,'err'); }
}

async function deleteBorehole(holeId) {
  if(!confirm('Delete borehole '+holeId+'? This cannot be undone.')) return;
  try {
    await fetch(API+'/boreholes/'+encodeURIComponent(holeId)+'?contractor='+encodeURIComponent(boreholePlanningContractor()), {method:'DELETE'});
    bhData = bhData.filter(function(b){return b.hole_id!==holeId;});
    toast(holeId+' deleted','warn');
    filterBoreholesByProject();
  } catch(e) { toast('Delete failed','err'); }
}

function downloadBhCsvTemplate(e) {
  e.preventDefault();
  const cols = 'project,program,planned_year,hole_id,site_id,type,bit_type,purpose,planned_days,easting,northing,rl,chip_depth,seam_tk,eoh_depth,total_core,drilling_budget_total,earthworks_budget_total,geophysical_budget_total,geological_support_budget_total,misc_budget_total,budget_total,notes';
  const example = 'Ironbark,Gas Riser,2026,26-062,IB-26-004,Core,HQ,Gas Riser,3.5,620000,7594000,320.5,250,5.2,239.5,25.2,65000,85000,Example hole';
  const csv = cols + String.fromCharCode(10) + example;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = 'borehole_budget_template.csv';
  a.click();
  toast('✓ Template downloaded');
}

function importBhCSV(input) {
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async function(ev) {
    const text = ev.target.result;
    const rows = parseSimpleCSV(text);
    if(rows.length<2) { toast('No valid rows found','err'); return; }
    const headers = rows[0].map(function(h){return String(h).toLowerCase().trim().replace(/[^a-z_]/g,'');});
    const boreholes = [];
    const errors = [];
    for(let i=1;i<rows.length;i++) {
      const vals = rows[i];
      if(vals.length<2) continue;
      if(vals.length!==headers.length) errors.push('Row '+(i+1)+': '+vals.length+' columns, expected '+headers.length);
      const row = {};
      headers.forEach(function(h,idx){row[h]=(vals[idx]||'').trim();});
      if(!row.hole_id) { errors.push('Row '+(i+1)+': missing hole_id'); continue; }
      const easting  = parseFloat(row.easting)||0;
      const northing = parseFloat(row.northing)||0;
      const wgs = (easting&&northing) ? mgaToWgs84(easting,northing) : {lat:null,lng:null};
      boreholes.push({
        hole_id:row.hole_id, project:row.project||activeProjectName||'', program:row.program||activeProgram||'Exploration', planned_year:row.planned_year||row.year||'', site_id:row.site_id||'', bh_type:row.type||'Core', type:row.type||'Core',
        bit_type:row.bit_type||row.bittype||'HQ', purpose:row.purpose||'',
        days_budgeted:parseFloat(row.planned_days||row.days)||null, days:parseFloat(row.planned_days||row.days)||null,
        easting:easting, northing:northing,
        rl:parseFloat(row.rl)||null,
        chip_depth:parseFloat(row.chip_depth||row.chipdepth)||null,
        seam_tk:parseFloat(row.seam_tk||row.seamtk)||null,
        eoh_depth:parseFloat(row.eoh_depth||row.eoh)||null,
        total_core:parseFloat(row.total_core)||null,
        drilling_budget_total:numberFromAny(row.drilling_budget_total,row.drillingbudget,row.drilling_budget),
        earthworks_budget_total:numberFromAny(row.earthworks_budget_total,row.earthworksbudget,row.earthworks_budget,row.earth_works,row.earthworks),
        geophysical_budget_total:numberFromAny(row.geophysical_budget_total,row.geophysicalbudget,row.geophysical_budget,row.geophysical_logging_budget,row.geophysical_logging,row.geophysics_budget),
        geological_support_budget_total:numberFromAny(row.geological_support_budget_total,row.geologicalsupportbudget,row.geological_support_budget,row.geology_budget,row.geological_budget,row.fortem_budget),
        misc_budget_total:numberFromAny(row.misc_budget_total,row.miscbudget,row.misc_budget,row.miscellaneous_budget),
        budget_total:numberFromAny(row.budget_total,row.budget,row.total_budget),
        notes:row.notes||'',
        lat:wgs.lat, lng:wgs.lng,
        drill_order:i, status:'Planned', eos_cost:0, drilling_cost:0, drilling_metres:0, eos_metres:0
      });
    }
    if(errors.length) toast('⚠ '+errors.join('; '),'warn');
    if(!boreholes.length) { toast('No valid rows found','err'); return; }
    try {
      const res = await fetch(API+'/boreholes/import_budget', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contractor:boreholePlanningContractor(), source_filename:file.name, boreholes:boreholes})
      });
      if(!res.ok) { toast('Import failed','err'); return; }
      const d = await res.json();
      toast('Imported '+d.count+' boreholes from CSV'+(d.merged_by_site?' / merged '+d.merged_by_site+' by site':''));
      loadBoreholes(true);
    } catch(err) { toast('Import failed: '+err.message,'err'); }
  };
  reader.readAsText(file);
  input.value = '';
}

function exportKML() {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  lines.push('<Document><name>2026 Ironbark Boreholes</name>');
  lines.push('<Style id="core-pq"><IconStyle><color>ffeb6325</color><scale>1.0</scale></IconStyle></Style>');
  lines.push('<Style id="core-hq"><IconStyle><color>ffed3477</color><scale>0.9</scale></IconStyle></Style>');
  lines.push('<Style id="chip"><IconStyle><color>ff0099ff</color><scale>0.8</scale></IconStyle></Style>');
  lines.push('<Style id="complete"><IconStyle><color>ff00a550</color><scale>1.0</scale></IconStyle></Style>');
  bhData.filter(function(b){return b.lat&&b.lng;}).forEach(function(b) {
    const t = b.type||b.bh_type||'Core';
    const styleId = b.status==='Complete'?'complete':t==='Chip'?'chip':b.bit_type==='PQ'?'core-pq':'core-hq';
    const bgt = b.budget_total ? '$'+parseFloat(b.budget_total).toLocaleString('en-AU',{maximumFractionDigits:0}) : 'N/A';
    lines.push('<Placemark>');
    lines.push('<name>'+b.hole_id+'</name>');
    lines.push('<description><![CDATA[<b>'+b.hole_id+'</b><br>Type: '+t+' | Bit: '+(b.bit_type||'')+'<br>Purpose: '+(b.purpose||'')+'<br>Easting: '+(b.easting||0).toFixed(3)+' (MGA55)<br>Northing: '+(b.northing||0).toFixed(3)+'<br>RL: '+(b.rl||0).toFixed(2)+'m<br>Depth: '+(b.chip_depth||0).toFixed(2)+'m<br>Seam: '+(b.seam_tk||'N/A')+'m<br>Days: '+(b.days_budgeted||b.days||'N/A')+'<br>Budget: '+bgt+'<br>Status: '+b.status+']]></description>');
    lines.push('<styleUrl>#'+styleId+'</styleUrl>');
    lines.push('<Point><coordinates>'+b.lng+','+b.lat+','+(b.rl||0).toFixed(2)+'</coordinates></Point>');
    lines.push('</Placemark>');
  });
  lines.push('</Document></kml>');
  const kml = lines.join(String.fromCharCode(10));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([kml], {type:'application/vnd.google-earth.kml+xml'}));
  a.download = 'Ironbark_2026_Boreholes.kml';
  a.click();
  toast('✓ KML exported');
}

async function importBudgetToDb() {
  try {
    const res = await fetch(API+'/boreholes/import_budget', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:boreholePlanningContractor(), source_filename:'Borehole planning save', boreholes:bhData})
    });
    if(!res.ok) { toast('Failed to save','err'); return; }
    const d = await res.json();
    toast('\u2713 '+d.count+' boreholes saved to database');
  } catch(e) { toast('Save failed: '+e.message,'err'); }
}

// ── Mine Drawing Image Overlays ───────────────────────────────────────────────
var mapOverlayLayers = [];
var mapOverlaysAutoLoaded = false;
var mapOverlayLoadSummary = [];
var mapOverlayProjectKey = '';

function setMapOverlayStatus(message, isError) {
  var el = document.getElementById('map-overlay-status');
  if(!el) return;
  el.textContent = message;
  el.style.color = isError ? 'var(--red)' : 'var(--muted)';
}

function fitMapToVisibleContent() {
  if(!bhMap) return;
  var bounds = null;
  var points = currentFilteredBoreholes().filter(function(b){
    var lat=parseFloat(b.lat),lng=parseFloat(b.lng);
    return Number.isFinite(lat)&&Number.isFinite(lng);
  }).map(function(b){return [parseFloat(b.lat),parseFloat(b.lng)];});
  if(points.length) bounds = L.latLngBounds(points);
  mapOverlayLayers.forEach(function(item){
    try {
      var b = item.layer.getBounds();
      if(b&&b.isValid()) bounds = bounds ? bounds.extend(b) : b;
    } catch(e) {}
  });
  if(bounds&&bounds.isValid()) bhMap.fitBounds(bounds,{padding:[30,30]});
}

function mapOverlayAssetsForProject(projectName) {
  var p = String(projectName||'').toLowerCase();
  if(p.includes('iron')) return [{path:'assets/map-overlays/IB001-overlay.png', name:'IB001', bounds:[[-21.85432055,148.15204156],[-21.73056905,148.22051483]]}];
  if(p.includes('carb') || p.includes('cd')) return [{path:'assets/map-overlays/CD001-overlay.png', name:'CD001', bounds:[[-22.01854530,148.23160263],[-21.95253461,148.29458790]]}];
  return [
    {path:'assets/map-overlays/IB001-overlay.png', name:'IB001', bounds:[[-21.85432055,148.15204156],[-21.73056905,148.22051483]]},
    {path:'assets/map-overlays/CD001-overlay.png', name:'CD001', bounds:[[-22.01854530,148.23160263],[-21.95253461,148.29458790]]}
  ];
}

function clearMapOverlays() {
  mapOverlayLayers.forEach(function(item){try{if(bhMap)bhMap.removeLayer(item.layer);}catch(e){}});
  mapOverlayLayers = [];
}

async function loadDefaultMapOverlays(forceReload) {
  if(!bhMap) return;
  var project = (document.getElementById('bh-project-select')?.value || activeProjectName || '');
  var key = project || 'All Projects';
  if(!forceReload && mapOverlaysAutoLoaded && mapOverlayProjectKey===key) return;
  mapOverlaysAutoLoaded = true;
  mapOverlayProjectKey = key;
  mapOverlayLoadSummary = [];
  clearMapOverlays();
  setMapOverlayStatus('Mine drawings loading for '+key+'...');
  var assets = mapOverlayAssetsForProject(project);
  if(!currentFilteredBoreholes().some(b=>Number.isFinite(parseFloat(b.lat))&&Number.isFinite(parseFloat(b.lng)))&&assets.length){
    bhMap.fitBounds(L.latLngBounds(assets.flatMap(asset=>asset.bounds)),{padding:[20,20]});
  }
  for(var i=0;i<assets.length;i++) {
    loadImageMapOverlay(assets[i]);
  }
  if(mapOverlayLoadSummary.length) {
    setMapOverlayStatus('Mine drawings loaded for '+key+': '+mapOverlayLoadSummary.join(', '));
  }
}

function loadImageMapOverlay(asset) {
  if(!bhMap) { setMapOverlayStatus('Map not ready', true); return; }
  var layer = L.imageOverlay(asset.path, asset.bounds, {opacity:0.9, interactive:false});
  layer.on('error', function(){
    setMapOverlayStatus(asset.name+' drawing failed to load', true);
  });
  layer.addTo(bhMap);
  mapOverlayLayers.push({name:asset.name, layer:layer});
  mapOverlayLoadSummary.push(asset.name);
}




// ── Project Management ────────────────────────────────────────────────────────────
var clients = [];
var projects = [];
var workspaceGateResolve = null;
var workspaceStarted = false;
const WORKSPACE_CLIENT_KEY = 'drillops_client_id';
const WORKSPACE_PROJECT_KEY = 'drillops_project';
const WORKSPACE_PROGRAM_KEY = 'drillops_program';

function storedWorkspaceValue(key) {
  return localStorage.getItem(key) || sessionStorage.getItem(key) || '';
}

function activeWorkspaceProject() {
  return projects.find(function(project) {
    return Number(project.client_id) === Number(activeClientId)
      && project.name === activeProjectName
      && (!activeProgram || projectProgram(project) === activeProgram);
  }) || null;
}

function activeProjectYear() {
  var year = String((activeWorkspaceProject() || {}).year || '').trim();
  return /^\d{4}$/.test(year) ? Number(year) : new Date().getFullYear();
}

function workspaceProgramLabel(project, program) {
  var year = String((project || {}).year || '').trim();
  var name = String(program || projectProgram(project) || '').trim();
  return [year, name].filter(Boolean).join(' ');
}

function activeWorkspaceProgramLabel() {
  return workspaceProgramLabel(activeWorkspaceProject(), activeProgram) || activeProgramLabel();
}

function workspaceScopeLabel() {
  if(WORKSPACE_APP==='eos'&&typeof eosScopeLabel==='function')return eosScopeLabel();
  return [activeProjectName, activeWorkspaceProgramLabel()].filter(Boolean).join(' / ');
}

function updateWorkspaceContextLabel() {
  if(WORKSPACE_APP==='eos'&&typeof renderEosScopeControls==='function'){renderEosScopeControls();return;}
  var label = document.getElementById('workspace-context-label');
  if(!label) return;
  var client = clientById(activeClientId);
  label.textContent = [client ? client.name : '', activeProjectName, activeWorkspaceProgramLabel()].filter(Boolean).join(' / ')
    || 'Select client / project / program';
}

function saveWorkspaceSelection() {
  if(WORKSPACE_APP==='eos'&&typeof persistEosScope==='function'){persistEosScope();return;}
  var values = {};
  values[WORKSPACE_CLIENT_KEY] = String(activeClientId || '');
  values[WORKSPACE_PROJECT_KEY] = activeProjectName || '';
  values[WORKSPACE_PROGRAM_KEY] = activeProgram || '';
  Object.keys(values).forEach(function(key) {
    localStorage.setItem(key, values[key]);
    sessionStorage.setItem(key, values[key]);
  });
}

function restoreWorkspaceSelection() {
  var clientId = Number(storedWorkspaceValue(WORKSPACE_CLIENT_KEY) || 0);
  var projectName = storedWorkspaceValue(WORKSPACE_PROJECT_KEY);
  var savedProgram = storedWorkspaceValue(WORKSPACE_PROGRAM_KEY);
  var project = projects.find(function(item) {
    return Number(item.client_id) === clientId
      && item.name === projectName
      && (!savedProgram || projectProgram(item) === savedProgram)
      && item.status !== 'Inactive';
  });
  var client = clients.find(function(item) {
    return Number(item.id) === clientId && item.status !== 'Inactive';
  });
  if(!client || !project) return false;
  activeClientId = clientId;
  activeProjectName = project.name;
  var configuredProgram = projectProgram(project);
  activeProgram = savedProgram === configuredProgram ? savedProgram : configuredProgram;
  saveWorkspaceSelection();
  updateWorkspaceContextLabel();
  document.getElementById('workspace-gate').classList.remove('open');
  document.body.classList.remove('workspace-locked');
  return true;
}

function populateWorkspaceClientOptions() {
  var select = document.getElementById('workspace-client-select');
  if(!select) return;
  var preferred = activeClientId || Number(storedWorkspaceValue(WORKSPACE_CLIENT_KEY) || 0);
  select.innerHTML = '<option value="">Select client</option>';
  clients.filter(function(client){ return client.status !== 'Inactive'; }).forEach(function(client) {
    var option = document.createElement('option');
    option.value = client.id;
    option.textContent = client.name;
    if(Number(client.id) === Number(preferred)) option.selected = true;
    select.appendChild(option);
  });
  populateWorkspaceProjectOptions();
}

function populateWorkspaceProjectOptions() {
  var clientSelect = document.getElementById('workspace-client-select');
  var projectSelect = document.getElementById('workspace-project-select');
  if(!clientSelect || !projectSelect) return;
  var clientId = Number(clientSelect.value || 0);
  var preferred = activeProjectName || storedWorkspaceValue(WORKSPACE_PROJECT_KEY);
  projectSelect.innerHTML = clientId
    ? '<option value="">Select project</option>'
    : '<option value="">Select client first</option>';
  var names=Array.from(new Set(projects.filter(function(project){
    return clientId && Number(project.client_id) === clientId && project.status !== 'Inactive';
  }).map(function(project){return project.name;}))).sort();
  names.forEach(function(projectName) {
    var option = document.createElement('option');
    option.value = projectName;
    option.textContent = projectName;
    if(projectName === preferred) option.selected = true;
    projectSelect.appendChild(option);
  });
  projectSelect.disabled = !clientId;
  populateWorkspaceProgramOptions();
}

function populateWorkspaceProgramOptions() {
  var clientSelect = document.getElementById('workspace-client-select');
  var projectSelect = document.getElementById('workspace-project-select');
  var programSelect = document.getElementById('workspace-program-select');
  if(!clientSelect || !projectSelect || !programSelect) return;
  var clientId = Number(clientSelect.value || 0);
  var projectName = String(projectSelect.value || '');
  var matchingProjects = projects.filter(function(item) {
    return Number(item.client_id) === clientId
      && item.name === projectName
      && item.status !== 'Inactive';
  });
  if(!matchingProjects.length) {
    programSelect.innerHTML = '<option value="">Select project first</option>';
    programSelect.disabled = true;
    updateWorkspaceContinueState();
    return;
  }
  var preferred=activeProjectName===projectName?activeProgram:storedWorkspaceValue(WORKSPACE_PROGRAM_KEY);
  programSelect.innerHTML = matchingProjects.map(function(project){
    var program=projectProgram(project);
    return '<option value="'+attr(program)+'"'+(program===preferred?' selected':'')+'>'+esc(workspaceProgramLabel(project, program))+'</option>';
  }).join('');
  if(!programSelect.value)programSelect.value=projectProgram(matchingProjects[0]);
  programSelect.disabled = false;
  updateWorkspaceContinueState();
}

function updateWorkspaceContinueState() {
  var clientSelect = document.getElementById('workspace-client-select');
  var projectSelect = document.getElementById('workspace-project-select');
  var programSelect = document.getElementById('workspace-program-select');
  var button = document.getElementById('workspace-continue-btn');
  if(button) button.disabled = !(clientSelect && clientSelect.value
    && projectSelect && projectSelect.value
    && programSelect && programSelect.value);
}

function showWorkspaceGate() {
  populateWorkspaceClientOptions();
  var gate = document.getElementById('workspace-gate');
  var error = document.getElementById('workspace-gate-error');
  if(error) error.textContent = '';
  if(gate) gate.classList.add('open');
  document.body.classList.add('workspace-locked');
  return new Promise(function(resolve){ workspaceGateResolve = resolve; });
}

function syncWorkspaceControls() {
  var scopeLabel=workspaceScopeLabel()||'No project selected';
  ['period-project-context','budget-project-context','cost-contract-project-context','details-project-context','schedule-project-context'].forEach(function(id){
    var node=document.getElementById(id);
    if(node)node.textContent=scopeLabel;
  });
  updateWorkspaceContextLabel();
  var poProject=document.getElementById('po-project');
  if(poProject)poProject.value=activeProjectName||'';
  var tenementProject=document.getElementById('ten-project');
  if(tenementProject)tenementProject.value=activeProjectName||'';
  var clientSelect = document.getElementById('bh-client-select');
  if(clientSelect) clientSelect.value = activeClientId ? String(activeClientId) : '';
  buildProgramSelector();
  buildProjectSelector();
  buildAddBoreholeProjectSelector();
  var projectSelect = document.getElementById('bh-project-select');
  if(projectSelect) projectSelect.value = activeProjectName;
  var budgetProgram = document.getElementById('budget-program-filter');
  var budgetProject = document.getElementById('budget-project-filter');
  buildProjectBudgetSelectors();
  if(budgetProgram) budgetProgram.value = activeProgram;
  if(budgetProject) budgetProject.value = activeProjectName;
  var importClient = document.getElementById('import-client-select');
  var importProject = document.getElementById('import-project-select');
  if(WORKSPACE_APP!=='eos'){
    if(importClient) importClient.value = activeClientId ? String(activeClientId) : '';
    if(importProject) importProject.value = '';
  }
  populateImportScopeOptions();
}

async function confirmWorkspaceSelection() {
  var clientSelect = document.getElementById('workspace-client-select');
  var projectSelect = document.getElementById('workspace-project-select');
  var programSelect = document.getElementById('workspace-program-select');
  var error = document.getElementById('workspace-gate-error');
  var clientId = Number(clientSelect && clientSelect.value || 0);
  var projectName = String(projectSelect && projectSelect.value || '');
  var programName = String(programSelect && programSelect.value || '');
  var project = projects.find(function(item){
    return Number(item.client_id) === clientId
      && item.name === projectName
      && projectProgram(item) === programName;
  });
  if(!clientId || !project || !programName) {
    if(error) error.textContent = 'Select a client, project and program to continue.';
    return;
  }
  activeClientId = clientId;
  activeProjectName = project.name;
  activeProgram = programName;
  saveWorkspaceSelection();
  await loadProjectContractors();
  ensureActiveContractorInProgram();
  buildContractorSwitcher();
  renderDrawerContractors();
  setProgramControls();
  syncWorkspaceControls();
  updateWorkspaceContextLabel();
  document.getElementById('workspace-gate').classList.remove('open');
  document.body.classList.remove('workspace-locked');
  var resolve = workspaceGateResolve;
  workspaceGateResolve = null;
  if(resolve) resolve({clientId:activeClientId, project:activeProjectName, program:activeProgram});
}

async function changeWorkspace() {
  if(WORKSPACE_APP==='eos'){document.getElementById('eos-project-filter')?.focus();return;}
  if(!clients.length || !projects.length) await fetchProjects();
  await showWorkspaceGate();
  if(!workspaceStarted) return;
  bhData = [];
  activitiesData = [];
  consumablesData = [];
  reportConsumablesData = [];
  crewData = [];
  dailyReportsData = [];
  productionRawData = [];
  productionFilteredData = [];
  await loadProjectContractors();
  ensureActiveContractorInProgram();
  buildContractorSwitcher();
  renderDrawerContractors();
  await loadProjectBudgets();
  syncWorkspaceControls();
  await updateDbCount();
  var activePage = document.querySelector('.page.active')?.id?.replace('page-','');
  if(activePage) triggerPageLoad(activePage);
}

function selectedClientId() {
  var sel = document.getElementById("bh-client-select");
  return sel && sel.value ? Number(sel.value) : activeClientId;
}

function clientById(clientId) {
  return clients.find(function(client){ return Number(client.id) === Number(clientId); }) || null;
}

function projectMatchesSelectedClient(project) {
  var clientId = selectedClientId();
  return !clientId || Number(project.client_id) === clientId;
}

function clientProjectOptions(selectedId) {
  var options = '<option value="">Unassigned</option>';
  clients.forEach(function(client) {
    options += '<option value="'+Number(client.id)+'"'+(Number(client.id)===Number(selectedId)?' selected':'')+'>'+esc(client.name)+'</option>';
  });
  return options;
}

function buildClientSelector() {
  var sel = document.getElementById("bh-client-select");
  if(!sel) return;
  var current = sel.value;
  sel.innerHTML = '<option value="">All Clients</option>';
  clients.filter(function(client){ return client.status !== 'Inactive'; }).forEach(function(client) {
    var option = document.createElement("option");
    option.value = client.id;
    option.textContent = client.name;
    if(String(client.id) === current) option.selected = true;
    sel.appendChild(option);
  });
}

function renderClientProjectHierarchy() {
  var body = document.getElementById("client-project-body");
  if(!body) return;
  var search=String(document.getElementById('project-register-search')?.value||'').trim().toLowerCase();
  var statusFilter=document.getElementById('project-register-status')?.value||'';
  var visibleProjects=projects.filter(function(project){
    var client=clientById(project.client_id);
    var text=[project.name,projectProgram(project),project.year,client&&client.name].join(' ').toLowerCase();
    return (!search||text.includes(search))&&(!statusFilter||project.status===statusFilter);
  });
  var projectRows = visibleProjects.map(function(project) {
    var contractCount=Number(project.active_contract_count||0);
    var rateSource=contractCount
      ? '<div class="rate-source"><button class="management-link" type="button" onclick="openProjectCostContracts('+Number(project.id)+')">'+esc(project.active_contract_names||contractCount+' active contract')+'</button><span>'+contractCount+' active project contract'+(contractCount===1?'':'s')+'</span></div>'
      : '<button class="library-fallback" type="button" style="border:0;background:transparent;padding:0;cursor:pointer;" onclick="openProjectCostContracts('+Number(project.id)+')">Rate Library fallback</button>';
    return '<tr data-project-id="'+Number(project.id)+'">'
      +'<td><select onchange="saveProjectHierarchyField(this,&apos;client_id&apos;)">'+clientProjectOptions(project.client_id)+'</select></td>'
      +'<td contenteditable="true" data-field="name">'+esc(project.name||'')+'</td>'
      +'<td><select onchange="saveProjectHierarchyField(this,&apos;status&apos;)"><option'+(project.status==='Active'?' selected':'')+'>Active</option><option'+(project.status==='Inactive'?' selected':'')+'>Inactive</option></select></td>'
      +'<td><select onchange="saveProjectHierarchyField(this,&apos;program&apos;)">'+PROJECT_PROGRAMS.map(function(program){return '<option'+(program===projectProgram(project)?' selected':'')+'>'+esc(program)+'</option>';}).join('')+'</select></td>'
      +'<td>'+rateSource+'</td>'
      +'<td contenteditable="true" data-field="year">'+esc(project.year||'')+'</td>'
      +'<td style="white-space:nowrap;"><button class="btn-ghost" type="button" onclick="showEditProjectDialog('+Number(project.id)+')">Edit</button> <button class="btn-ghost" type="button" onclick="activateProjectFromRegister('+Number(project.id)+')">Open</button> <button class="icon-btn" type="button" onclick="deleteProjectFromHierarchy('+Number(project.id)+')">Delete</button></td>'
      +'</tr>';
  }).join('');
  var emptyClientRows = clients.filter(function(client){
    if(search&&!String(client.name||'').toLowerCase().includes(search))return false;
    return !projects.some(function(project){ return Number(project.client_id) === Number(client.id); });
  }).map(function(client){
    return '<tr>'
      +'<td style="font-weight:700;">'+esc(client.name)+'</td>'
      +'<td colspan="5" style="color:var(--muted);">No projects configured</td>'
      +'<td><button class="btn-ghost" type="button" onclick="showNewProjectDialog('+Number(client.id)+')">Add project</button></td>'
      +'</tr>';
  }).join('');
  body.innerHTML = projectRows + emptyClientRows;
  if(!body.innerHTML) body.innerHTML = '<tr><td colspan="7" style="padding:24px;color:var(--muted);text-align:center;">No projects match these filters.</td></tr>';
  body.querySelectorAll('[contenteditable][data-field]').forEach(function(cell) {
    cell.addEventListener('blur', function(){ saveProjectHierarchyField(cell, cell.dataset.field); });
  });
}

async function activateProjectFromRegister(projectId){
  var project=projects.find(function(item){return Number(item.id)===Number(projectId);});
  if(!project)return;
  activeClientId=Number(project.client_id)||null;
  activeProjectName=project.name;
  activeProgram=projectProgram(project);
  saveWorkspaceSelection();
  await loadProjectContractors();
  ensureActiveContractorInProgram();
  buildContractorSwitcher();
  syncWorkspaceControls();
  updateWorkspaceContextLabel();
  var button=document.querySelector('.drawer-nav-item[data-page="boreholes"]');
  if(button)drawerNav(button);
}

async function openProjectCostContracts(projectId){
  var project=projects.find(function(item){return Number(item.id)===Number(projectId);});
  if(project&&Number((activeWorkspaceProject()||{}).id)!==Number(project.id)){
    activeClientId=Number(project.client_id)||null;
    activeProjectName=project.name;
    activeProgram=projectProgram(project);
    saveWorkspaceSelection();
    await loadProjectContractors();
    ensureActiveContractorInProgram();
    buildContractorSwitcher();
    syncWorkspaceControls();
    updateWorkspaceContextLabel();
  }
  openProjectWorkspaceSection('contracts');
  await loadCostContracts();
  renderCostContracts();
}

async function saveProjectHierarchyField(element, field) {
  var row = element.closest('tr');
  if(!row) return;
  var value = element.matches('select') ? element.value : element.textContent.trim();
  if(field === 'client_id') value = value ? Number(value) : null;
  try {
    var response = await fetch(API+'/projects/'+encodeURIComponent(row.dataset.projectId), {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({[field]:value})
    });
    if(!response.ok) throw new Error(await response.text());
    await fetchProjects();
    toast('Project updated');
  } catch(error) {
    toast('Project update failed','err');
    await fetchProjects();
  }
}

async function deleteProjectFromHierarchy(projectId) {
  if(!confirm('Delete this project setup row? Existing operational records will retain the project name.')) return;
  try {
    var response = await fetch(API+'/projects/'+encodeURIComponent(projectId), {method:'DELETE'});
    if(!response.ok) throw new Error(await response.text());
    await fetchProjects();
    toast('Project removed','warn');
  } catch(error) {
    toast('Project delete failed','err');
  }
}

function contractStatusClass(status){
  return String(status||'Draft').toLowerCase().replace(/\s+/g,'-');
}

function contractDateDisplay(value){
  if(!value)return '--';
  const iso=isoFromReportDate(value);
  if(!iso)return String(value);
  return new Date(iso+'T00:00:00Z').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
}

function populateCostContractProjectOptions(){
  const filter=document.getElementById('cost-contract-project-filter');
  const dialog=document.getElementById('cost-contract-project');
  const workspaceProject=activeWorkspaceProject();
  const scopedProjects=WORKSPACE_APP==='eos'?projects.filter(p=>EosProduction.scopeMatch({project:p.name,program:projectProgram(p)},eosScope)):(workspaceProject?[workspaceProject]:[]);
  const options=scopedProjects.map(function(project){
    const client=clientById(project.client_id);
    return '<option value="'+Number(project.id)+'">'+esc((client?client.name+' / ':'')+project.name+(WORKSPACE_APP==='eos'?' / '+projectProgram(project):''))+'</option>';
  }).join('');
  if(filter){
    filter.innerHTML=options||'<option value=""></option>';
    filter.value=workspaceProject?String(workspaceProject.id):'';
  }
  if(dialog){
    dialog.innerHTML=(WORKSPACE_APP==='eos'?'<option value="">Select project and program</option>':'')+(options||'<option value="">No workspace project</option>');
    dialog.value=workspaceProject?String(workspaceProject.id):'';
  }
}

let costContractsRequest=0;
async function loadCostContracts(){
  const request=++costContractsRequest,scopeVersion=typeof eosScopeVersion==='undefined'?0:eosScopeVersion;
  const body=document.getElementById('cost-contract-body');
  if(body)body.innerHTML='<tr><td colspan="8" class="contract-empty">Loading cost contracts...</td></tr>';
  if(!projects.length)await fetchProjects();
  populateCostContractProjectOptions();
  try{
    const workspaceProject=activeWorkspaceProject();
    const projectQuery=WORKSPACE_APP!=='eos'&&workspaceProject?'&project_id='+encodeURIComponent(workspaceProject.id):'';
    const responses=await Promise.all([
      fetch(API+'/cost-contracts?_='+Date.now()+projectQuery,{cache:'no-store'}),
      fetch(API+'/rate-library-summary?_='+Date.now(),{cache:'no-store'})
    ]);
    if(!responses[0].ok)throw new Error(await responses[0].text());
    const contracts=await responses[0].json(),library=responses[1].ok?await responses[1].json():[];
    if(request!==costContractsRequest||(typeof eosScopeVersion!=='undefined'&&scopeVersion!==eosScopeVersion))return;
    costContractsData=WORKSPACE_APP==='eos'?contracts.filter(c=>c.contractor===activeContractor):contracts;
    rateLibrarySummaryData=library;
    if(selectedCostContractId&&!costContractsData.some(function(contract){return Number(contract.id)===Number(selectedCostContractId);})){
      selectedCostContractId=null;
      costContractRatesData=[];
    }
    renderRateLibrarySummary();
    renderCostContracts();
    if(selectedCostContractId)await openCostContract(selectedCostContractId,false);
  }catch(error){
    if(request!==costContractsRequest||(typeof eosScopeVersion!=='undefined'&&scopeVersion!==eosScopeVersion))return;
    costContractsData=[];
    if(body)body.innerHTML='<tr><td colspan="8" class="contract-empty">Cost contracts could not be loaded.</td></tr>';
  }
}

function renderRateLibrarySummary(){
  const body=document.getElementById('rate-library-summary-body');
  if(!body)return;
  const linkedNames=new Set(filteredContractors().map(function(item){return item.name;}));
  const visibleRows=rateLibrarySummaryData.filter(function(row){return WORKSPACE_APP==='eos'?row.contractor===activeContractor:linkedNames.has(row.contractor);});
  const totalLines=visibleRows.reduce(function(sum,row){
    return sum+Number(row.drilling_rates||0)+Number(row.hourly_rates||0)+Number(row.consumable_rates||0);
  },0);
  const contractors=new Set(visibleRows.map(function(row){return row.contractor;}));
  const setText=function(id,value){const node=document.getElementById(id);if(node)node.textContent=Number(value||0).toLocaleString('en-AU');};
  setText('rate-library-schedule-count',visibleRows.length);
  setText('rate-library-contractor-count',contractors.size);
  setText('rate-library-line-count',totalLines);
  body.innerHTML=visibleRows.map(function(row){
    const linked=Number(row.contract_count||0);
    return '<tr>'
      +'<td style="font-weight:750;">'+esc(row.contractor)+'</td>'
      +'<td><span class="status-pill status-info">'+esc(row.year)+'</span></td>'
      +'<td>'+Number(row.drilling_rates||0).toLocaleString('en-AU')+'</td>'
      +'<td>'+Number(row.hourly_rates||0).toLocaleString('en-AU')+'</td>'
      +'<td>'+Number(row.consumable_rates||0).toLocaleString('en-AU')+'</td>'
      +'<td><span style="font-weight:700;">'+linked+'</span><div style="font-size:10px;color:var(--muted);">'+Number(row.active_contract_count||0)+' active</div></td>'
      +'<td><button class="btn-primary" type="button" onclick="createContractFromLibrary(decodeURIComponent(&apos;'+attr(encodeURIComponent(row.contractor))+'&apos;),decodeURIComponent(&apos;'+attr(encodeURIComponent(row.year))+'&apos;))">Use for project</button></td>'
      +'</tr>';
  }).join('')||'<tr><td colspan="7" class="contract-empty">No reusable rate schedules are linked to '+esc(activeProjectName||'this project')+'. Open Manage rate library to add one.</td></tr>';
}

function createContractFromLibrary(contractor,year){
  const activeProject=activeWorkspaceProject();
  showCostContractDialog(activeProject&&activeProject.id,contractor,year);
}

function setCostContractStatus(button){
  document.querySelectorAll('#cost-contract-tabs .management-tab').forEach(function(tab){tab.classList.remove('active');});
  button.classList.add('active');
  activeCostContractStatus=button.dataset.status||'';
  renderCostContracts();
}

function renderCostContracts(){
  const body=document.getElementById('cost-contract-body');
  if(!body)return;
  const search=String(document.getElementById('cost-contract-search')?.value||'').trim().toLowerCase();
  const workspaceProject=activeWorkspaceProject();
  const projectId=WORKSPACE_APP!=='eos'&&workspaceProject?String(workspaceProject.id):'';
  const rows=costContractsData.filter(function(contract){
    if(WORKSPACE_APP==='eos'){const project=projects.find(p=>Number(p.id)===Number(contract.project_id));if(contract.contractor!==activeContractor||!EosProduction.scopeMatch({project:project?.name||contract.project_name,program:project?projectProgram(project):contract.program},eosScope))return false;}
    const text=[contract.name,contract.project_name,contract.client_name,contract.contractor,contract.rate_year].join(' ').toLowerCase();
    return (!activeCostContractStatus||contract.status===activeCostContractStatus)
      &&(!projectId||String(contract.project_id)===projectId)
      &&(!search||text.includes(search));
  });
  body.innerHTML=rows.map(function(contract){
    return '<tr>'
      +'<td><button class="management-link" type="button" onclick="openCostContract('+Number(contract.id)+')">'+esc(contract.name)+'</button></td>'
      +'<td><span class="contract-status '+contractStatusClass(contract.status)+'">'+esc(contract.status)+'</span></td>'
      +'<td>'+esc(contract.contractor)+'</td>'
      +'<td>'+esc(contractDateDisplay(contract.start_date))+'</td>'
      +'<td>'+esc(contractDateDisplay(contract.end_date))+'</td>'
      +'<td><span style="font-weight:700;">'+esc(contract.project_name)+'</span><div style="font-size:10px;color:var(--muted);">'+esc(contract.client_name||'Unassigned client')+'</div></td>'
      +'<td>'+Number(contract.rate_count||0).toLocaleString('en-AU')+'</td>'
      +'<td><button class="btn-ghost" type="button" onclick="openCostContract('+Number(contract.id)+')">Open</button></td>'
      +'</tr>';
  }).join('')||'<tr><td colspan="8" class="contract-empty">No cost contracts match this view. Add one to create a project-specific schedule.</td></tr>';
}

function showCostContractDialog(preferredProjectId,preferredContractor,preferredYear){
  populateCostContractProjectOptions();
  const projectSelect=document.getElementById('cost-contract-project');
  const preferred=preferredProjectId||Number((activeWorkspaceProject()||{}).id||0);
  if(preferred)projectSelect.value=String(preferred);
  document.getElementById('cost-contract-name').value='';
  document.getElementById('cost-contract-status').value='Draft';
  document.getElementById('cost-contract-start').value='';
  document.getElementById('cost-contract-end').value='';
  document.getElementById('cost-contract-year').innerHTML='<option value="">Loading schedules...</option>';
  document.getElementById('cost-contract-notes').value='';
  const contractor=document.getElementById('cost-contract-contractor');
  const availableContractors=filteredContractors().filter(function(item){return item.active!==false&&(WORKSPACE_APP!=='eos'||item.name===activeContractor);});
  contractor.innerHTML=availableContractors.map(function(item){
    return '<option value="'+attr(item.name)+'">'+esc(item.name)+'</option>';
  }).join('');
  const drilling=availableContractors.find(function(item){return contractorCategory(item)==='Drilling';});
  if(preferredContractor&&availableContractors.some(function(item){return item.name===preferredContractor;}))contractor.value=preferredContractor;
  else if(drilling)contractor.value=drilling.name;
  document.getElementById('cost-contract-copy-library').checked=true;
  loadCostContractYears(preferredYear);
  syncCostContractClient();
  if(preferredContractor&&preferredYear&&projectSelect.value){
    const selectedProject=projects.find(function(project){return String(project.id)===projectSelect.value;});
    if(selectedProject)document.getElementById('cost-contract-name').value=selectedProject.name+' - '+preferredContractor+' '+preferredYear;
  }
  document.getElementById('cost-contract-dialog').showModal();
  setTimeout(function(){document.getElementById('cost-contract-name').focus();},0);
}

async function loadCostContractYears(preferredYear){
  const contractor=document.getElementById('cost-contract-contractor')?.value||'';
  const select=document.getElementById('cost-contract-year');
  if(!select)return;
  try{
    const response=await fetch(API+'/rates/years?contractor='+encodeURIComponent(contractor));
    if(!response.ok)throw new Error('Could not load schedules');
    const result=await response.json();
    if(document.getElementById('cost-contract-contractor')?.value!==contractor)return;
    const years=(result.years||[]).slice().sort().reverse();
    select.innerHTML=years.length
      ? years.map(function(year){return '<option value="'+attr(year)+'">'+esc(year)+'</option>';}).join('')
      : '<option value="">No existing schedule</option>';
    if(preferredYear&&years.includes(String(preferredYear)))select.value=String(preferredYear);
  }catch(error){
    select.innerHTML='<option value="">No existing schedule</option>';
  }
}

function syncCostContractClient(){
  const projectId=Number(document.getElementById('cost-contract-project')?.value||0);
  const project=projects.find(function(item){return Number(item.id)===projectId;});
  const client=project&&clientById(project.client_id);
  const field=document.getElementById('cost-contract-client');
  if(field)field.value=client?client.name:'';
  if(project&&!document.getElementById('cost-contract-name').value){
    document.getElementById('cost-contract-name').placeholder=project.name+' Contract V1';
  }
}

async function saveCostContract(event){
  event.preventDefault();
  const projectId=Number(document.getElementById('cost-contract-project').value||0);
  const project=projects.find(function(item){return Number(item.id)===projectId;});
  const payload={
    project_id:projectId,
    client_id:project&&project.client_id,
    contractor:document.getElementById('cost-contract-contractor').value,
    name:document.getElementById('cost-contract-name').value.trim(),
    status:document.getElementById('cost-contract-status').value,
    start_date:document.getElementById('cost-contract-start').value,
    end_date:document.getElementById('cost-contract-end').value,
    rate_year:document.getElementById('cost-contract-year').value.trim(),
    notes:document.getElementById('cost-contract-notes').value.trim()
  };
  if(!payload.project_id||!payload.name||!payload.contractor)return;
  const button=document.getElementById('cost-contract-save');
  button.disabled=true;
  try{
    const response=await fetch(API+'/cost-contracts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!response.ok)throw new Error(await response.text());
    const saved=await response.json();
    let copiedRates=0;
    let copyWarning='';
    if(document.getElementById('cost-contract-copy-library').checked&&payload.rate_year){
      const copyResponse=await fetch(API+'/cost-contracts/'+encodeURIComponent(saved.id)+'/import-schedule',{method:'POST'});
      const copyResult=await copyResponse.json().catch(function(){return {};});
      if(copyResponse.ok){
        copiedRates=Number(copyResult.time_activities||0)+Number(copyResult.drilling_rates||0)+Number(copyResult.consumables||0);
      }else{
        copyWarning=copyResult.detail||'The contract was created, but its library schedule could not be copied.';
      }
    }
    document.getElementById('cost-contract-dialog').close();
    selectedCostContractId=Number(saved.id);
    activeCostContractStatus=payload.status;
    document.querySelectorAll('#cost-contract-tabs .management-tab').forEach(function(tab){
      tab.classList.toggle('active',(tab.dataset.status||'')===activeCostContractStatus);
    });
    await fetchProjects();
    await loadCostContracts();
    await openCostContract(selectedCostContractId);
    if(copyWarning)toast(copyWarning,'warn');
    else toast('Cost contract created'+(copiedRates?' with '+copiedRates+' Rate Library lines':''));
  }catch(error){
    toast('Cost contract creation failed','err');
  }finally{
    button.disabled=false;
  }
}

async function openCostContract(contractId,scrollIntoView=true){
  selectedCostContractId=Number(contractId);
  try{
    const [contractResponse,ratesResponse]=await Promise.all([
      fetch(API+'/cost-contracts/'+encodeURIComponent(contractId)),
      fetch(API+'/cost-contract-rates?contract_id='+encodeURIComponent(contractId))
    ]);
    if(!contractResponse.ok||!ratesResponse.ok)throw new Error('Could not load contract');
    const contract=await contractResponse.json();
    costContractRatesData=await ratesResponse.json();
    const existing=costContractsData.findIndex(function(item){return Number(item.id)===Number(contract.id);});
    if(existing>=0)costContractsData[existing]=contract;
    else costContractsData.push(contract);
    renderCostContracts();
    renderCostContractDetail(contract);
    if(scrollIntoView)document.getElementById('cost-contract-detail')?.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){
    toast('Cost contract could not be opened','err');
  }
}

function setCostContractSection(section){
  activeCostContractSection=section;
  const contract=costContractsData.find(function(item){return Number(item.id)===Number(selectedCostContractId);});
  if(contract)renderCostContractDetail(contract);
}

function renderCostContractDetail(contract){
  const host=document.getElementById('cost-contract-detail');
  if(!host||!contract)return;
  const sections=['Time Activities','Drilling Rates','Downhole Activities','Consumables','Equipment','Personnel','Miscellaneous','Bit Wear'];
  host.innerHTML='<div class="contract-detail">'
    +'<div class="contract-summary">'
      +'<div class="contract-summary-title">'+esc(contract.name)+' <span class="contract-status '+contractStatusClass(contract.status)+'">'+esc(contract.status)+'</span></div>'
      +'<div class="contract-summary-meta"><strong>'+esc(contract.contractor)+'</strong><span>'+esc(contractDateDisplay(contract.start_date))+(contract.end_date?' – '+esc(contractDateDisplay(contract.end_date)):'')+'</span><span>'+esc(contract.client_name||'')+' / '+esc(contract.project_name||'')+'</span><span>Schedule '+esc(contract.rate_year||'not set')+'</span><select class="range-date" onchange="updateCostContractStatus(this.value)"><option'+(contract.status==='Draft'?' selected':'')+'>Draft</option><option'+(contract.status==='Pending Approval'?' selected':'')+'>Pending Approval</option><option'+(contract.status==='Active'?' selected':'')+'>Active</option><option'+(contract.status==='Ended'?' selected':'')+'>Ended</option></select></div>'
      +(contract.notes?'<div style="font-size:11px;color:var(--muted);margin-top:8px;">'+esc(contract.notes)+'</div>':'')
    +'</div>'
    +'<aside class="contract-side">'+sections.map(function(section){return '<button type="button" class="'+(section===activeCostContractSection?'active':'')+'" onclick="setCostContractSection(&apos;'+attr(section)+'&apos;)">'+esc(section)+'</button>';}).join('')+'</aside>'
    +'<div class="contract-main"><div class="contract-main-head"><div><div style="font-size:16px;font-weight:780;">'+esc(activeCostContractSection)+'</div><div style="font-size:11px;color:var(--muted);margin-top:3px;">Rates in this section belong only to this cost contract.</div></div>'
      +'<div style="display:flex;gap:8px;">'+(contract.contractor==='DEPCO Drilling'?'<select id="depco-scope" aria-label="DEPCO schedule"><option value="A"'+(contract.program==='Exploration'?' selected':'')+'>Exploration — revised</option><option value="C"'+(contract.program==='Gas Riser'?' selected':'')+'>Service Casing</option><option value="B"'+(contract.program==='SIS'?' selected':'')+'>SIS</option></select><button class="btn-secondary" type="button" onclick="importDepcoSchedule()">Add DEPCO codes</button>':'<button class="btn-secondary" type="button" onclick="importCostContractSchedule()">Refresh from Rate Library</button>')+'<button class="btn-primary" type="button" onclick="addCostContractRate()">Add rate</button></div>'
    +'</div><div class="contract-rate-table">'+costContractRateTable()+'</div></div>'
    +'</div>';
  attachCostContractRateEdits();
}

async function importDepcoSchedule(){
  const scope=document.getElementById('depco-scope').value;
  try{
    const response=await fetch(API+'/cost-contracts/'+selectedCostContractId+'/import-depco',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope})});
    if(!response.ok)throw new Error(await response.text());
    const result=await response.json();
    await openCostContract(selectedCostContractId,false);
    toast(result.added+' codes added. '+result.review+' schedule items need review.');
  }catch(error){toast(error.message,'err');}
}

async function chooseDepcoCode(id){
  try{
    const response=await fetch(API+'/activities/'+id+'/contract-codes');
    if(!response.ok)throw new Error(await response.text());
    const rates=await response.json();
    if(!rates.length){toast('Add DEPCO codes to an active contract for this project and program first.','err');return;}
    document.getElementById('depco-code-dialog')?.remove();
    const dialog=document.createElement('dialog');
    dialog.id='depco-code-dialog';dialog.className='contract-dialog';
    dialog.style.cssText='margin:auto;max-height:85vh;overflow:auto;width:min(800px,calc(100vw - 32px));';
    dialog.innerHTML='<div style="padding:24px"><h2>Choose contract activity</h2><p>Select the drilling size or activity. Drilling prices split across depth bands. Daily and item charges use the activity quantity.</p><input id="depco-code-search" class="management-search" placeholder="Search activity or code" aria-label="Search contract codes"><select id="depco-code-choice" size="12" style="display:block;width:100%;margin:12px 0"></select><label id="depco-quantity-label" hidden>Quantity <input id="depco-code-quantity" type="number" min="0" step="any"></label><p id="depco-code-note" style="white-space:pre-wrap"></p><button class="btn-secondary" id="depco-code-cancel">Cancel</button> <button class="btn-primary" id="depco-code-save">Apply code and price</button></div>';
    document.body.appendChild(dialog);
    const choice=dialog.querySelector('#depco-code-choice');
    choice.style.cssText='display:block;width:100%;margin:12px 0;padding:8px;font:inherit;font-size:14px;border:1px solid #cbd5e1;border-radius:6px;';
    function render(){
      const search=dialog.querySelector('#depco-code-search').value.toLowerCase();
      choice.innerHTML=rates.filter(r=>[r.name,r.cost_code,r.reference_name].join(' ').toLowerCase().includes(search)).map(r=>'<option value="'+Number(r.id)+'">'+esc(r.name)+(r.depth_from!=null?' ('+r.depth_from+'–'+r.depth_to+'m)':'')+' — '+(r.charge==null?'Needs price':cur(r.charge)+'/'+esc(r.unit))+(r.status!=='Active'?' — '+esc(r.status):'')+'</option>').join('');
      note();
    }
    function note(){const rate=rates.find(r=>Number(r.id)===Number(choice.value));dialog.querySelector('#depco-code-note').textContent=rate?rate.reference_name||'':'';dialog.querySelector('#depco-quantity-label').hidden=!rate||['hour','metre'].includes(rate.unit);}
    dialog.querySelector('#depco-code-search').oninput=render;choice.onchange=note;
    dialog.querySelector('#depco-code-cancel').onclick=()=>dialog.close();
    dialog.querySelector('#depco-code-save').onclick=async()=>{
      const rate=rates.find(r=>Number(r.id)===Number(choice.value));if(!rate)return;
      const patch={code:rate.cost_code};
      if(!['hour','metre'].includes(rate.unit)){
        const raw=dialog.querySelector('#depco-code-quantity').value;
        if(raw===''||!Number.isFinite(Number(raw))||Number(raw)<0){toast('Enter the quantity in '+rate.unit,'err');return;}
        patch.quantity=Number(raw);
      }
      const button=dialog.querySelector('#depco-code-save');button.disabled=true;
      try{
        const saved=await fetch(API+'/activities/'+id+'/contract-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});
        if(!saved.ok)throw new Error(await saved.text());
        const priced=await saved.json();dialog.close();await loadActivities();
        toast(priced.line_cost==null?priced.rate_basis:'Contract code applied and activity priced');
      }catch(error){toast(error.message,'err');}finally{button.disabled=false;}
    };
    render();dialog.showModal();
  }catch(error){toast(error.message,'err');}
}

async function updateCostContractStatus(status){
  if(!selectedCostContractId)return;
  try{
    const response=await fetch(API+'/cost-contracts/'+selectedCostContractId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:status})});
    if(!response.ok)throw new Error(await response.text());
    await fetchProjects();
    await loadCostContracts();
    toast('Contract status updated');
  }catch(error){toast('Contract status update failed','err');}
}

function costContractRateTable(){
  const rows=costContractRatesData.filter(function(rate){return rate.section===activeCostContractSection;});
  const drilling=activeCostContractSection==='Drilling Rates';
  let head=drilling
    ? '<tr><th>Drill type</th><th>Depth from</th><th>Depth to</th><th>Unit</th><th>Charge</th><th>Reference</th><th>Cost code</th><th>Status</th><th></th></tr>'
    : '<tr><th>Name</th><th>Rig type</th><th>Category</th><th>Unit</th><th>Charge</th><th>Reference</th><th>Cost code</th><th>Status</th><th></th></tr>';
  const body=rows.map(function(rate){
    return '<tr data-rate-id="'+Number(rate.id)+'">'
      +'<td contenteditable="true" data-col="name">'+esc(rate.name)+'</td>'
      +(drilling
        ? '<td contenteditable="true" data-col="depth_from" data-num="true">'+(rate.depth_from==null?'':Number(rate.depth_from).toFixed(2))+'</td><td contenteditable="true" data-col="depth_to" data-num="true">'+(rate.depth_to==null?'':Number(rate.depth_to).toFixed(2))+'</td>'
        : '<td contenteditable="true" data-col="rig_type">'+esc(rate.rig_type||'All')+'</td><td contenteditable="true" data-col="category">'+esc(rate.category||'')+'</td>')
      +'<td contenteditable="true" data-col="unit">'+esc(rate.unit||'')+'</td>'
      +'<td contenteditable="true" data-col="charge" data-num="true" style="font-weight:780;">'+(rate.charge==null?'Needs price':cur(rate.charge))+'</td>'
      +'<td contenteditable="true" data-col="reference_name">'+esc(rate.reference_name||'')+'</td>'
      +'<td contenteditable="true" data-col="cost_code">'+esc(rate.cost_code||'')+'</td>'
      +'<td><select data-col="status" onchange="saveCostContractRateSelect(this)"><option'+(rate.status==='Active'?' selected':'')+'>Active</option><option'+(rate.status==='Inactive'?' selected':'')+'>Inactive</option><option'+(rate.status==='Review'?' selected':'')+'>Review</option></select></td>'
      +'<td><button class="icon-btn" type="button" onclick="deleteCostContractRate('+Number(rate.id)+')">Delete</button></td>'
      +'</tr>';
  }).join('');
  return '<table><thead>'+head+'</thead><tbody id="cost-contract-rate-body">'+(body||'<tr><td colspan="9" class="contract-empty">No rates in this section yet.</td></tr>')+'</tbody></table>';
}

function attachCostContractRateEdits(){
  document.querySelectorAll('#cost-contract-rate-body [contenteditable][data-col]').forEach(function(cell){
    cell.addEventListener('blur',function(){saveCostContractRateCell(cell);});
  });
}

async function saveCostContractRateCell(cell){
  const row=cell.closest('tr');
  const rateId=Number(row&&row.dataset.rateId||0);
  const col=cell.dataset.col;
  let value=cell.textContent.trim().replace(/[$,]/g,'');
  if(cell.dataset.num)value=value===''?null:(parseFloat(value)||0);
  if(!rateId||!col)return;
  try{
    const response=await fetch(API+'/cost-contract-rates/'+rateId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({[col]:value})});
    if(!response.ok)throw new Error(await response.text());
    const rate=costContractRatesData.find(function(item){return Number(item.id)===rateId;});
    if(rate)rate[col]=value;
    toast('Contract rate saved');
  }catch(error){toast('Rate save failed','err');await openCostContract(selectedCostContractId,false);}
}

function saveCostContractRateSelect(select){
  const cell={closest:function(){return select.closest('tr');},dataset:{col:select.dataset.col},textContent:select.value};
  saveCostContractRateCell(cell);
}

async function addCostContractRate(){
  if(!selectedCostContractId)return;
  const drilling=activeCostContractSection==='Drilling Rates';
  const payload={
    contract_id:selectedCostContractId,
    section:activeCostContractSection,
    name:drilling?'New drill type':'New rate',
    rig_type:'All',
    category:'',
    depth_from:drilling?0:null,
    depth_to:drilling?100:null,
    unit:drilling?'Per Metre':'hour',
    charge:0,
    reference_name:'',
    cost_code:'',
    status:'Active'
  };
  try{
    const response=await fetch(API+'/cost-contract-rates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!response.ok)throw new Error(await response.text());
    await openCostContract(selectedCostContractId,false);
    toast('Contract rate added');
  }catch(error){toast('Could not add rate','err');}
}

async function deleteCostContractRate(rateId){
  if(!confirm('Delete this contract rate?'))return;
  try{
    const response=await fetch(API+'/cost-contract-rates/'+rateId,{method:'DELETE'});
    if(!response.ok)throw new Error(await response.text());
    costContractRatesData=costContractRatesData.filter(function(rate){return Number(rate.id)!==Number(rateId);});
    const contract=costContractsData.find(function(item){return Number(item.id)===Number(selectedCostContractId);});
    renderCostContractDetail(contract);
    toast('Contract rate deleted','warn');
  }catch(error){toast('Could not delete rate','err');}
}

async function importCostContractSchedule(){
  const contract=costContractsData.find(function(item){return Number(item.id)===Number(selectedCostContractId);});
  if(!contract)return;
  if(!confirm('Replace this contract’s rate lines with the '+(contract.rate_year||'available')+' '+contract.contractor+' Rate Library schedule?'))return;
  try{
    const response=await fetch(API+'/cost-contracts/'+selectedCostContractId+'/import-schedule',{method:'POST'});
    const result=await response.json();
    if(!response.ok)throw new Error(result.detail||'Import failed');
    await openCostContract(selectedCostContractId,false);
    toast('Imported '+(result.time_activities+result.drilling_rates+result.consumables)+' schedule lines');
  }catch(error){toast('Schedule import failed','err');}
}

function projectProgram(p) {
  return (p && (p.program || p.category)) || 'Exploration';
}

function projectProgramForName(name) {
  var raw = String(name||'').toLowerCase();
  if(activeProgram&&String(activeProjectName||'').toLowerCase()===raw)return activeProgram;
  var match = projects.find(function(p){ return String(p.name||'').toLowerCase() === raw; })
    || projects.find(function(p){
      var pn=String(p.name||'').toLowerCase();
      return pn && (raw.includes(pn) || pn.includes(raw));
    });
  return match ? projectProgram(match) : 'Exploration';
}

function knownProjectNames(){
  var names = ['Ironbark'];
  (projects||[]).forEach(function(p){ if(p&&p.name) names.push(p.name); });
  (bhData||[]).forEach(function(b){ if(b&&b.project) names.push(b.project); });
  (projectBudgetsData||[]).forEach(function(b){ if(b&&b.project) names.push(b.project); });
  return Array.from(new Set(names.filter(Boolean))).sort(function(a,b){
    if(a === 'Ironbark') return -1;
    if(b === 'Ironbark') return 1;
    return a.localeCompare(b);
  });
}

function contractorForVendor(vendor){
  const raw=String(vendor||'').trim();
  if(!raw)return null;
  const norm=raw.toLowerCase().replace(/[^a-z0-9]+/g,'');
  const aliases={
    allianz:'Allianz Drilling',
    mitchells:'Mitchells Drilling',
    mitchellsdrilling:'Mitchells Drilling',
    weatherford:'Weatherfords',
    weatherfords:'Weatherfords',
    epirocweatherford:'Epiroc',
    earthworks:'Earth Works',
    earthwork:'Earth Works',
    stantect:'STANTEC'
  };
  const alias=aliases[norm];
  if(alias)return contractorByName(alias);
  return CONTRACTORS.find(function(c){
    const cn=String(c.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
    const code=String(c.short_code||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
    return cn===norm||code===norm||cn.includes(norm)||norm.includes(cn);
  })||null;
}

function normalBudgetSection(value,vendor){
  const contractor=contractorForVendor(vendor);
  const cat=contractorCategory(contractor).toLowerCase();
  if(cat==='drilling')return 'Drilling';
  if(cat==='earthworks')return 'Earthworks';
  const vendorName=String(vendor||'').toLowerCase();
  if(/weatherford|epiroc|precision energy/.test(vendorName))return 'Downhole Geophysical Logging';
  if(/fortem/.test(vendorName))return 'Geological Support & Project Management';
  if(cat==='geological support')return 'Geological Support & Project Management';
  if(cat==='lab testing')return 'Lab Testing';
  if(cat==='labour')return 'Support';
  const text=String((value||'')+' '+(vendor||'')).toLowerCase();
  if(text.match(/drill|allianz|mitchell/))return 'Drilling';
  if(text.match(/earth|civil|dozer|excavat|grader|pad|track/))return 'Earthworks';
  if(text.match(/geophys|logging|weatherford|epiroc|wireline/))return 'Downhole Geophysical Logging';
  if(text.match(/fortem|geolog|project management/))return 'Geological Support & Project Management';
  if(text.match(/geogas|sigra|gas|geochem|lab test|assay/))return 'Lab Testing';
  return value||'MISC';
}

function budgetRowSection(row){
  const vendor=String(row&&row.vendor||'');
  if(/weatherford|epiroc|precision energy/i.test(vendor))return 'Downhole Geophysical Logging';
  if(/fortem/i.test(vendor))return 'Geological Support & Project Management';
  return String((row&&row.canonical_section)||'').trim()||normalBudgetSection(row&&row.section,row&&row.vendor);
}

function budgetMatchesActiveProgram(row){
  return !activeProgram || !row.program || row.program===activeProgram;
}

function buildProjectBudgetSelectors(){
  const programSel=document.getElementById('budget-program-filter');
  const projectSel=document.getElementById('budget-project-filter');
  if(programSel){
    const current=programSel.options.length?programSel.value:activeProgram;
    const programs=Array.from(new Set(PROJECT_PROGRAMS.concat((projects||[]).map(projectProgram),(projectBudgetsData||[]).map(function(r){return r.program||'';})))).filter(Boolean);
    programSel.innerHTML='<option value="">All Programs</option>'+programs.map(function(p){return '<option value="'+attr(p)+'">'+esc(p)+'</option>';}).join('');
    programSel.value=current===''?'':(programs.includes(current)?current:'');
  }
  if(projectSel){
    projectSel.innerHTML='<option value="'+attr(activeProjectName||'')+'">'+esc(activeProjectName||'No project selected')+'</option>';
    projectSel.value=activeProjectName||'';
  }
}

const COST_CENTRE_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let costCentreHideEmptyRows=false;
const COST_CENTRE_SHEET_EDITS_KEY='drillops_ironbark_tecexp_sheet_edits';

function loadCostCentreSheetEdits(){
  try{return JSON.parse(localStorage.getItem(COST_CENTRE_SHEET_EDITS_KEY)||'{}')||{};}catch(e){return {};}
}

function applyCostCentreSheetEdits(row){
  const edits=loadCostCentreSheetEdits()[row.rowKey]||{};
  ['site','division','costCentre','expense','commentary'].forEach(function(field){
    if(Object.prototype.hasOwnProperty.call(edits,field))row[field]=String(edits[field]||'');
  });
  row.monthly=row.monthly.map(function(value,index){
    const field='monthly.'+index;
    return Object.prototype.hasOwnProperty.call(edits,field)?numVal(edits[field]):value;
  });
  if(Object.prototype.hasOwnProperty.call(edits,'currentMonthForecast'))row.currentMonthForecast=numVal(edits.currentMonthForecast);
  row.future=row.future.map(function(value,index){
    const field='future.'+index;
    return Object.prototype.hasOwnProperty.call(edits,field)?numVal(edits[field]):value;
  });
  row.total=row.monthly.reduce(function(sum,value){return sum+value;},0)+numVal(row.currentMonthForecast);
  if(Object.prototype.hasOwnProperty.call(edits,'total'))row.total=numVal(edits.total);
  return row;
}

function saveCostCentreSheetCell(rowKey,field,rawValue,isNumber){
  const edits=loadCostCentreSheetEdits();
  if(!edits[rowKey])edits[rowKey]={};
  edits[rowKey][field]=isNumber?numVal(String(rawValue||'').replace(/[$,]/g,'')):String(rawValue||'').trim();
  localStorage.setItem(COST_CENTRE_SHEET_EDITS_KEY,JSON.stringify(edits));
  renderCostCentreSpreadsheetGrid();
}

function costCentreCurrentForecastContext(){
  const forecastYear=numVal(costCentreForecastData&&costCentreForecastData.year)||2026;
  const asOf=String((costCentreForecastData&&costCentreForecastData.as_of)||'');
  const match=asOf.match(/^(\d{4})-(\d{2})-/);
  let month=match&&numVal(match[1])===forecastYear?numVal(match[2]):new Date().getMonth()+1;
  month=Math.max(1,Math.min(12,month));
  return {
    year:forecastYear,
    month:month,
    period:forecastYear+'-'+String(month).padStart(2,'0'),
    label:'Rest of '+COST_CENTRE_MONTHS[month-1]+'-'+String(forecastYear).slice(-2)+' Forecast'
  };
}
const COST_CENTRE_GLS=['4200 - Consulting Services','4250 - Contractors','4350 - Drilling Services'];

function costCentreLiveActual(row){
  if(!costCentreForecastData)return 0;
  return numVal(costCentreForecastData.live_actuals[row.month+':'+row.category]);
}

function costCentrePlanForecast(row){
  if(!costCentreForecastData)return 0;
  return numVal((costCentreForecastData.plan_forecast||{})[row.month+':'+row.category]);
}

function costCentreDefaultForecast(row){
  if(row.month<=6)return costCentreLiveActual(row);
  if(row.month===7)return costCentreLiveActual(row)+costCentrePlanForecast(row);
  return costCentrePlanForecast(row);
}

function costCentreRowReforecast(row){
  if(row.forecast_override!==null&&row.forecast_override!==''&&row.forecast_override!==undefined)return numVal(row.forecast_override);
  return costCentreDefaultForecast(row)+numVal(row.manual_accrual);
}

function aggregateCostCentreMonths(){
  const months=Array.from({length:12},function(_,i){return {month:i+1,baseline:0,finance:0,live:0,plan:0,accrual:0,reforecast:0};});
  ((costCentreForecastData&&costCentreForecastData.rows)||[]).forEach(function(row){
    const item=months[row.month-1];
    if(!item)return;
    item.baseline+=numVal(row.baseline_amount);
    item.finance+=numVal(row.finance_actual);
    item.live+=costCentreLiveActual(row);
    item.plan+=costCentrePlanForecast(row);
    item.accrual+=numVal(row.manual_accrual);
    item.reforecast+=costCentreRowReforecast(row);
  });
  return months;
}

function costCentreCategoryMonths(){
  const source=(costCentreForecastData&&costCentreForecastData.rows)||[];
  const result={};
  COST_CENTRE_GLS.forEach(function(category){
    result[category]=Array.from({length:12},function(_,index){
      const row=source.find(function(item){return item.category===category&&item.month===index+1;});
      return row?costCentreRowReforecast(row):0;
    });
  });
  return result;
}

function costCentreSpreadsheetRows(){
  const contractorActuals=(costCentreForecastData&&costCentreForecastData.contractor_actuals)||{};
  const forecastYear=numVal(costCentreForecastData&&costCentreForecastData.year)||2026;
  const currentForecast=costCentreCurrentForecastContext();
  const planDefinitions=(costCentreForecastData&&costCentreForecastData.contractor_plan_rows)||[];
  const contractorDefinitions=[];
  function costCentreContractorName(name){
    const cleanName=String(name||'').trim();
    const normalized=cleanName.toLowerCase().replace(/[^a-z0-9]+/g,'');
    return ['weatherford','weatherfords','epiroc','weatherfordsepiroc'].includes(normalized)?'Weatherfords / Epiroc':cleanName;
  }
  function addContractorDefinition(name,expenseGl,sourceLine,periods){
    const cleanName=costCentreContractorName(name);
    if(!cleanName)return;
    const existing=contractorDefinitions.find(function(item){return item.name.toLowerCase()===cleanName.toLowerCase();});
    if(existing){
      if(periods)existing.periods=periods;
      if(sourceLine)existing.sourceLine=sourceLine;
      if(expenseGl)existing.expenseGl=String(expenseGl);
      return;
    }
    contractorDefinitions.push({name:cleanName,expenseGl:String(expenseGl||'4200'),sourceLine:sourceLine||cleanName,periods:periods||{}});
  }
  ((costCentreForecastData&&costCentreForecastData.exploration_contractors)||[]).forEach(function(contractor){
    if(['4200','4250','4350'].includes(String(contractor.expense_gl||'')))addContractorDefinition(contractor.name,contractor.expense_gl,contractor.name,{});
  });
  planDefinitions.forEach(function(definition){
    addContractorDefinition(definition.name,definition.expense_gl,definition.source_line,definition.periods||{});
  });
  const contractorRows=contractorDefinitions.map(function(contractor){
    const expense=contractor.expenseGl+' - '+({4200:'Consulting Services',4250:'Contractors',4350:'Drilling Services'}[contractor.expenseGl]||'Assigned contractor GL');
    const monthly=Array.from({length:12},function(_,monthIndex){
      const period=forecastYear+'-'+String(monthIndex+1).padStart(2,'0');
      const actual=numVal(contractorActuals[(monthIndex+1)+':'+contractor.name]);
      const forecast=numVal(contractor.periods[period]);
      return actual+(monthIndex+1===currentForecast.month?0:forecast);
    });
    return {
      rowKey:'contractor:'+contractor.name,
      site:'IB',division:'TEC',costCentre:'TECEXP',expense:expense,
      commentary:contractor.name==='Weatherfords / Epiroc'?'Geophysical Logging — Weatherfords / Epiroc':contractor.name,sourceLine:contractor.sourceLine,monthly:monthly,
      currentMonthForecast:numVal(contractor.periods[currentForecast.period]),
      future:[numVal(contractor.periods[(forecastYear+1)+'-01']),numVal(contractor.periods[(forecastYear+1)+'-02'])],
      actualLine:false,contractorLine:true
    };
  });
  return contractorRows.map(function(row){
    row.total=row.monthly.reduce(function(sum,value){return sum+value;},0)+numVal(row.currentMonthForecast);
    if(!row.future)row.future=[0,0];
    return applyCostCentreSheetEdits(row);
  });
}

function costCentreSpreadsheetRowHasData(row){
  return row.monthly.some(function(value){return Math.abs(numVal(value))>=0.005;})
    ||Math.abs(numVal(row.currentMonthForecast))>=0.005
    ||(row.future||[]).some(function(value){return Math.abs(numVal(value))>=0.005;});
}

function visibleCostCentreSpreadsheetRows(){
  const rows=costCentreSpreadsheetRows();
  return costCentreHideEmptyRows?rows.filter(costCentreSpreadsheetRowHasData):rows;
}

function toggleCostCentreEmptyRows(){
  costCentreHideEmptyRows=!costCentreHideEmptyRows;
  renderCostCentreSpreadsheetGrid();
}

function renderCostCentreSpreadsheetGrid(){
  const body=document.getElementById('ccf-sheet-body');
  if(!body)return;
  const rows=visibleCostCentreSpreadsheetRows();
  const currentForecast=costCentreCurrentForecastContext();
  const emptyRowsButton=document.getElementById('ccf-empty-rows-btn');
  if(emptyRowsButton){
    emptyRowsButton.textContent=costCentreHideEmptyRows?'Show all rows':'Hide empty rows';
    emptyRowsButton.setAttribute('aria-pressed',costCentreHideEmptyRows?'true':'false');
  }
  const header=document.getElementById('ccf-finance-header');
  if(header)header.innerHTML=['Site','Div','Cost Centre','Expense','Commentary'].map(function(label){return '<th>'+label+'</th>';}).join('')
    +COST_CENTRE_MONTHS.map(function(month,index){
      const monthLabel=month+'-'+String(currentForecast.year).slice(-2)+(index===currentForecast.month-1?' Actual':'');
      const monthHeader='<th class="num">'+monthLabel+'</th>';
      return monthHeader+(index===currentForecast.month-1?'<th class="num remainder-period">'+currentForecast.label+'</th>':'');
    }).join('')
    +'<th class="num">'+currentForecast.year+' Reforecast (includes Rest of '+COST_CENTRE_MONTHS[currentForecast.month-1]+')</th><th class="num">Jan-'+String(currentForecast.year+1).slice(-2)+'</th><th class="num">Feb-'+String(currentForecast.year+1).slice(-2)+'</th>';
  const money=function(value){return Math.abs(numVal(value))<0.005?'-':numVal(value).toLocaleString('en-AU',{maximumFractionDigits:0});};
  const editableTextCell=function(row,field,value,className){
    return '<td contenteditable="true" data-ccf-row="'+attr(row.rowKey)+'" data-ccf-field="'+field+'" class="'+(className||'')+'">'+esc(value||'')+'</td>';
  };
  const editableMoneyCell=function(row,field,value,className){
    return '<td contenteditable="true" data-ccf-row="'+attr(row.rowKey)+'" data-ccf-field="'+field+'" data-ccf-number="true" class="num '+(className||'')+'">'+money(value)+'</td>';
  };
  const totals=Array.from({length:12},function(_,index){return rows.reduce(function(sum,row){return sum+row.monthly[index];},0);});
  const currentMonthForecastTotal=rows.reduce(function(sum,row){return sum+numVal(row.currentMonthForecast);},0);
  const futureTotals=Array.from({length:2},function(_,index){return rows.reduce(function(sum,row){return sum+numVal(row.future[index]);},0);});
  body.innerHTML=rows.map(function(row){
    const rowClass=row.actualLine?'ccf-actual-line':(row.contractorLine?'ccf-contractor-line':'');
    return '<tr class="'+rowClass+'">'
      +editableTextCell(row,'site',row.site,'identity')
      +editableTextCell(row,'division',row.division,'identity')
      +editableTextCell(row,'costCentre',row.costCentre,'identity')
      +editableTextCell(row,'expense',row.expense,'identity')
      +editableTextCell(row,'commentary',row.commentary,'identity commentary')
      +row.monthly.map(function(value,index){
        const monthlyCell=editableMoneyCell(row,'monthly.'+index,value,index<=currentForecast.month-1?'actual-period':'');
        return monthlyCell+(index===currentForecast.month-1?editableMoneyCell(row,'currentMonthForecast',row.currentMonthForecast,'remainder-period'):'');
      }).join('')
      +editableMoneyCell(row,'total',row.total,'year-total')
      +row.future.map(function(value,index){return editableMoneyCell(row,'future.'+index,value,'');}).join('')+'</tr>';
  }).join('')+'<tr class="ccf-total-row"><td colspan="5">2026 REFORECAST TOTAL</td>'
    +totals.map(function(value,index){
      const monthlyCell='<td class="num '+(index<=currentForecast.month-1?'actual-period':'')+'">'+money(value)+'</td>';
      return monthlyCell+(index===currentForecast.month-1?'<td class="num remainder-period">'+money(currentMonthForecastTotal)+'</td>':'');
    }).join('')
    +'<td class="num year-total">'+money(rows.reduce(function(sum,row){return sum+numVal(row.total);},0))+'</td>'
    +futureTotals.map(function(value){return '<td class="num">'+money(value)+'</td>';}).join('')+'</tr>';
  body.querySelectorAll('[contenteditable][data-ccf-row]').forEach(function(cell){
    cell.addEventListener('keydown',function(event){
      if(event.key==='Enter'){event.preventDefault();cell.blur();}
    });
    cell.addEventListener('blur',function(){
      saveCostCentreSheetCell(cell.dataset.ccfRow,cell.dataset.ccfField,cell.textContent,cell.dataset.ccfNumber==='true');
    });
  });
}

async function copyCostCentreSpreadsheetRows(){
  const currentForecast=costCentreCurrentForecastContext();
  const monthHeaders=[];
  COST_CENTRE_MONTHS.forEach(function(month,index){
    monthHeaders.push(month+'-'+String(currentForecast.year).slice(-2)+(index===currentForecast.month-1?' Actual':''));
    if(index===currentForecast.month-1)monthHeaders.push(currentForecast.label);
  });
  const headers=['Site','Div','Cost Centre','Expense','Commentary'].concat(monthHeaders,[String(currentForecast.year)+' Reforecast (includes Rest of '+COST_CENTRE_MONTHS[currentForecast.month-1]+')','Jan-'+String(currentForecast.year+1).slice(-2),'Feb-'+String(currentForecast.year+1).slice(-2)]);
  const lines=[headers].concat(visibleCostCentreSpreadsheetRows().map(function(row){
    const monthValues=[];
    row.monthly.forEach(function(value,index){
      monthValues.push(numVal(value).toFixed(2));
      if(index===currentForecast.month-1)monthValues.push(numVal(row.currentMonthForecast).toFixed(2));
    });
    return [row.site,row.division,row.costCentre,row.expense,row.commentary].concat(monthValues,[row.total.toFixed(2)],row.future.map(function(value){return numVal(value).toFixed(2);}));
  })).map(function(row){return row.join('\t');}).join('\n');
  try{
    await navigator.clipboard.writeText(lines);
  }catch(e){
    const textarea=document.createElement('textarea');
    textarea.value=lines;textarea.style.position='fixed';textarea.style.opacity='0';document.body.appendChild(textarea);
    textarea.select();document.execCommand('copy');textarea.remove();
  }
  toast('Ironbark TECEXP finance rows copied for Excel');
}

async function loadCostCentreForecast(){
  try{
    const res=await fetch(API+'/cost-centre-forecast?site=IB&cost_centre=TECEXP&year=2026&_='+Date.now(),{cache:'no-store'});
    if(!res.ok)throw new Error(await res.text());
    costCentreForecastData=await res.json();
    renderCostCentreForecast();
  }catch(e){
    toast('TECEXP forecast load failed','err');
  }
}

function renderCostCentreForecast(){
  if(!costCentreForecastData)return;
  const months=aggregateCostCentreMonths();
  const baselineTotal=months.reduce(function(s,m){return s+m.baseline;},0);
  const reforecastTotal=months.reduce(function(s,m){return s+m.reforecast;},0);
  const currentForecast=costCentreCurrentForecastContext();
  const currentMonth=months[currentForecast.month-1];
  const currentMonthAccrued=currentMonth.live+currentMonth.accrual;
  const plan=costCentreForecastData.plan_summary||{};
  setPeriodText('ccf-f07-total',cur(plan.workbook_total||baselineTotal));
  setPeriodText('ccf-current-accrued-label',COST_CENTRE_MONTHS[currentForecast.month-1]+' Accrued to Date');
  setPeriodText('ccf-current-accrued',cur(currentMonthAccrued));
  setPeriodText('ccf-plan-total',cur(plan.remaining_program_budget||0));
  setPeriodText('ccf-plan-sub',(plan.source_mapped_holes||0)+' workbook-mapped of '+(plan.hole_count||0)+' open holes'+(plan.latest_forecast_end?' | through '+plan.latest_forecast_end:'')+(plan.source_missing_holes?' | '+plan.source_missing_holes+' without a workbook row':''));
  setPeriodText('ccf-reforecast-total',cur(reforecastTotal));
  setPeriodText('ccf-asof','As at '+costCentreForecastData.as_of+' | 4200 + 4250 + 4350');
  renderCostCentreSpreadsheetGrid();

  const scheduleBody=document.getElementById('ccf-drill-schedule-body');
  if(scheduleBody)scheduleBody.innerHTML=(costCentreForecastData.plan_holes||[]).map(function(hole){
    return '<tr><td>'+esc(hole.drill_order==null?'--':hole.drill_order)+'</td><td><b>'+esc(hole.hole_id||hole.site_id||'--')+'</b></td>'
      +'<td>'+esc(hole.assigned_rig||'Unassigned')+'</td><td>'+esc(hole.status||'Planned')+'</td>'
      +'<td class="num">'+numVal(hole.days_budgeted).toLocaleString('en-AU',{maximumFractionDigits:1})+'</td>'
      +'<td class="num">'+numVal(hole.forecast_drill_days).toLocaleString('en-AU',{maximumFractionDigits:0})+'</td>'
      +'<td>'+esc(hole.forecast_start||'--')+'</td><td>'+esc(hole.forecast_end||'--')+'</td>'
      +'<td class="num">'+cur(hole.remaining_drilling)+'</td><td class="num"><b>'+cur(hole.remaining_program_budget)+'</b></td></tr>';
  }).join('')||'<tr><td colspan="10">No open Ironbark holes in Borehole Planning.</td></tr>';

  const maxValue=Math.max(1,...months.map(function(m){return Math.max(Math.abs(m.baseline),Math.abs(m.reforecast));}));
  const visual=document.getElementById('ccf-month-visual');
  if(visual)visual.innerHTML=months.map(function(m){
    const baselineWidth=Math.min(100,Math.abs(m.baseline)/maxValue*100).toFixed(2);
    const reforecastWidth=Math.min(100,Math.abs(m.reforecast)/maxValue*100).toFixed(2);
    return '<div class="ccf-visual-row">'
      +'<b>'+COST_CENTRE_MONTHS[m.month-1]+'</b>'
      +'<div class="ccf-bars">'
        +'<div class="ccf-track"><div class="ccf-bar baseline'+(m.baseline<0?' negative':'')+'" style="width:'+baselineWidth+'%"></div></div>'
        +'<div class="ccf-track"><div class="ccf-bar reforecast'+(m.reforecast<0?' negative':'')+'" style="width:'+reforecastWidth+'%"></div></div>'
      +'</div>'
      +'<div class="ccf-money">'+cur(m.baseline)+'</div>'
      +'<div class="ccf-money">'+cur(m.reforecast)+'</div>'
      +'</div>';
  }).join('');

}

async function loadProjectBudgets(){
  try{
    const res=await fetch(API+'/project-budgets?contractor=Company');
    projectBudgetsData=res.ok?await res.json():[];
  }catch(e){
    projectBudgetsData=[];
    toast('Project budgets could not be loaded','err');
  }
  buildProjectBudgetSelectors();
  renderProjectBudgets();
}

function projectBudgetFilteredRows(){
  const program=activeProgram||document.getElementById('budget-program-filter')?.value||'';
  const project=activeProjectName||'';
  return (projectBudgetsData||[]).filter(function(r){
    if(program&&r.program!==program)return false;
    if(project&&r.project!==project)return false;
    return true;
  });
}

function budgetProgramOptions(current){
  const programs=Array.from(new Set(PROJECT_PROGRAMS.concat((projects||[]).map(projectProgram),(projectBudgetsData||[]).map(function(r){return r.program||'';})))).filter(Boolean);
  return programs.map(function(p){return '<option value="'+attr(p)+'" '+(p===(current||'')?'selected':'')+'>'+esc(p)+'</option>';}).join('');
}

function budgetProjectOptions(current){
  return knownProjectNames().map(function(name){
    return '<option value="'+attr(name)+'" '+(name===(current||'')?'selected':'')+'>'+esc(name)+'</option>';
  }).join('');
}

function budgetContractorOptions(current){
  const names=[];
  (CONTRACTORS||[]).forEach(function(c){if(c&&c.name)names.push(c.name);});
  (projectBudgetsData||[]).forEach(function(r){if(r&&r.vendor)names.push(r.vendor);});
  const unique=Array.from(new Set(names.filter(Boolean))).sort();
  if(current&&!unique.includes(current))unique.unshift(current);
  return unique.map(function(name){return '<option value="'+attr(name)+'" '+(name===(current||'')?'selected':'')+'>'+esc(name)+'</option>';}).join('');
}

function budgetRowCategory(row){
  return normalBudgetSection(row.section,row.vendor);
}

function renderProjectBudgets(){
  buildProjectBudgetSelectors();
  const rows=projectBudgetFilteredRows();
  const body=document.getElementById('project-budget-body');
  const total=rows.reduce(function(s,r){return s+numVal(r.budget_amount);},0);
  const drilling=rows.filter(function(r){return budgetRowCategory(r)==='Drilling';}).reduce(function(s,r){return s+numVal(r.budget_amount);},0);
  setPeriodText('budget-kpi-total',cur(total));
  setPeriodText('budget-kpi-drilling',cur(drilling));
  setPeriodText('budget-kpi-support',cur(total-drilling));
  setPeriodText('budget-kpi-rows',rows.length.toLocaleString());
  setPeriodText('budget-row-count',rows.length.toLocaleString());
  if(!body)return;
  if(!rows.length){
    body.innerHTML='<tr><td colspan="9"><div class="empty-state">No project budgets recorded.</div></td></tr>';
    return;
  }
  body.innerHTML=rows.map(function(r){
    const category=budgetRowCategory(r);
    return '<tr data-budget-id="'+attr(r.id)+'">'
      +'<td><select data-col="program" onchange="saveProjectBudgetSelect(this)">'+budgetProgramOptions(r.program||'Exploration')+'</select></td>'
      +'<td><select data-col="project" onchange="saveProjectBudgetSelect(this)">'+budgetProjectOptions(r.project||'')+'</select></td>'
      +'<td contenteditable="true" data-col="section">'+esc(r.section||'')+'</td>'
      +'<td><select data-col="vendor" onchange="saveProjectBudgetSelect(this)">'+budgetContractorOptions(r.vendor||'')+'</select></td>'
      +'<td><span class="flag-pill">'+esc(category)+'</span></td>'
      +'<td contenteditable="true" data-col="budget_amount" data-num="true" style="font-weight:800;color:var(--accent);">'+(numVal(r.budget_amount)?numVal(r.budget_amount).toLocaleString('en-AU',{maximumFractionDigits:2}):'')+'</td>'
      +'<td contenteditable="true" data-col="allocation">'+esc(r.allocation||'Project level')+'</td>'
      +'<td contenteditable="true" data-col="notes">'+esc(r.notes||'')+'</td>'
      +'<td><button class="icon-btn" type="button" onclick="deleteProjectBudgetRow('+Number(r.id)+')">Delete</button></td>'
      +'</tr>';
  }).join('');
  body.querySelectorAll('[contenteditable]').forEach(function(cell){
    cell.addEventListener('blur',saveProjectBudgetCell);
    cell.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();cell.blur();}});
  });
}

async function saveProjectBudgetSelect(select){
  const tr=select.closest('tr');
  const id=tr?.dataset.budgetId;
  const col=select.dataset.col;
  if(!id||!col)return;
  try{
    const res=await fetch(API+'/project-budgets/'+encodeURIComponent(id),{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({[col]:select.value})
    });
    if(!res.ok)throw new Error(await res.text());
    const row=projectBudgetsData.find(function(r){return Number(r.id)===Number(id);});
    if(row)row[col]=select.value;
    renderProjectBudgets();
    toast('Budget saved');
  }catch(err){
    toast('Budget save failed','err');
  }
}

async function saveProjectBudgetCell(e){
  const cell=e.currentTarget;
  const tr=cell.closest('tr');
  const id=tr?.dataset.budgetId;
  const col=cell.dataset.col;
  if(!id||!col)return;
  let val=cell.textContent.trim();
  if(cell.dataset.num==='true')val=numberFromAny(val)||0;
  try{
    const res=await fetch(API+'/project-budgets/'+encodeURIComponent(id),{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({[col]:val})
    });
    if(!res.ok)throw new Error(await res.text());
    const row=projectBudgetsData.find(function(r){return Number(r.id)===Number(id);});
    if(row)row[col]=val;
    renderProjectBudgets();
    toast('Budget saved');
  }catch(err){
    toast('Budget save failed','err');
  }
}

async function addProjectBudgetRow(){
  const program=document.getElementById('budget-program-filter')?.value||activeProgram||'Exploration';
  const project=document.getElementById('budget-project-filter')?.value||knownProjectNames()[0]||'Carborough Downs';
  try{
    const res=await fetch(API+'/project-budgets',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:'Company',program:program,project:project,section:'MISC',vendor:(CONTRACTORS[0]||{}).name||'',budget_amount:0,allocation:'Project level'})
    });
    if(!res.ok)throw new Error(await res.text());
    await loadProjectBudgets();
    toast('Budget row added');
  }catch(e){toast('Add budget failed','err');}
}

async function seedCarboroughBudgets(){
  const rows=[
    {section:'Geological Support',vendor:'Fortem',budget_amount:197920},
    {section:'Lab Testing - Gas',vendor:'GEOGAS',budget_amount:90144},
    {section:'Lab Testing - Geochempet',vendor:'Geochempet',budget_amount:13320},
    {section:'Lab Testing - Geotech',vendor:'STANTEC',budget_amount:34800},
    {section:'Earthworks',vendor:'EARTH WORKS',budget_amount:79570},
    {section:'Geophysical Logging',vendor:'Epiroc',budget_amount:73942},
    {section:'Drilling',vendor:'Allianz Drilling',budget_amount:918744},
    {section:'Stress Testing',vendor:'SIGRA',budget_amount:373000}
  ].map(function(r){return Object.assign({contractor:'Company',program:'Exploration',project:'Carborough Downs',allocation:'Project level'},r);});
  try{
    const res=await fetch(API+'/project-budgets',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:'Company',budgets:rows})
    });
    if(!res.ok)throw new Error(await res.text());
    await loadProjectBudgets();
    const psel=document.getElementById('budget-program-filter');
    if(psel)psel.value='Exploration';
    const sel=document.getElementById('budget-project-filter');
    buildProjectBudgetSelectors();
    if(sel)sel.value='Carborough Downs';
    renderProjectBudgets();
    toast('Carborough Downs budgets saved');
  }catch(e){toast('Carborough seed failed','err');}
}

function parseSimpleCSV(text){
  const rows=[];
  let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(ch==='"'&&quoted&&next==='"'){cell+='"';i++;continue;}
    if(ch==='"'){quoted=!quoted;continue;}
    if(ch===','&&!quoted){row.push(cell);cell='';continue;}
    if((ch==='\n'||ch==='\r')&&!quoted){
      if(ch==='\r'&&next==='\n')i++;
      row.push(cell);cell='';
      if(row.some(function(v){return String(v).trim();}))rows.push(row);
      row=[];
      continue;
    }
    cell+=ch;
  }
  row.push(cell);
  if(row.some(function(v){return String(v).trim();}))rows.push(row);
  return rows;
}

function projectBudgetTemplateRows(){
  const program=activeProgram||'Exploration';
  const project=activeProjectName||'Project name';
  return [
    ['program','project','section','contractor','budget_amount','allocation','notes'],
    [program,project,'Geological Support','Contractor name','0','Project level',''],
    [program,project,'Drilling','Drilling contractor','0','Project level','']
  ];
}

function downloadProjectBudgetTemplate(){
  const csv=projectBudgetTemplateRows().map(function(row){
    return row.map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',');
  }).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='project_budget_template.csv';
  a.click();
}

async function importProjectBudgetCSV(input){
  const file=input.files&&input.files[0];
  if(!file)return;
  try{
    const text=await file.text();
    const rows=parseSimpleCSV(text);
    if(rows.length<2){toast('CSV has no budget rows','err');return;}
    const headers=rows[0].map(function(h){return String(h).trim().toLowerCase().replace(/\s+/g,'_');});
    const budgets=rows.slice(1).map(function(row){
      const obj={contractor:'Company'};
      headers.forEach(function(h,i){obj[h]=row[i]||'';});
      const rowContractor=obj.contractor;
      obj.program=obj.program||activeProgram||'Exploration';
      obj.project=obj.project||document.getElementById('budget-project-filter')?.value||'';
      obj.section=obj.section||obj.category||'MISC';
      obj.vendor=obj.vendor||obj.contractor_vendor||obj.budget_contractor||obj.contractor_name||(rowContractor&&rowContractor!=='Company'?rowContractor:'');
      obj.contractor='Company';
      obj.budget_amount=numberFromAny(obj.budget_amount,obj.budget,obj.amount)||0;
      obj.allocation=obj.allocation||'Project level';
      return obj;
    }).filter(function(r){return r.project&&r.section;});
    if(!budgets.length){toast('No usable budget rows found','err');return;}
    const res=await fetch(API+'/project-budgets',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contractor:'Company',budgets:budgets})
    });
    if(!res.ok)throw new Error(await res.text());
    await loadProjectBudgets();
    toast('Imported '+budgets.length+' project budget rows');
  }catch(e){
    toast('Budget CSV import failed','err');
  }finally{
    input.value='';
  }
}

async function deleteProjectBudgetRow(id){
  if(!id||!confirm('Delete this project budget row?'))return;
  try{
    const res=await fetch(API+'/project-budgets/'+encodeURIComponent(id),{method:'DELETE'});
    if(!res.ok)throw new Error(await res.text());
    projectBudgetsData=projectBudgetsData.filter(function(r){return Number(r.id)!==Number(id);});
    renderProjectBudgets();
    toast('Budget row deleted','warn');
  }catch(e){toast('Delete failed','err');}
}

async function fetchProjects() {
  try {
    var responses = await Promise.all([
      fetch(API+"/clients"),
      fetch(API+"/projects?contractor=Company")
    ]);
    if(responses[0].ok) clients = await responses[0].json();
    if(responses[1].ok) projects = await responses[1].json();
  } catch(e) { console.warn("Could not fetch projects"); }
  buildClientSelector();
  buildProgramSelector();
  buildProjectSelector();
  buildAddBoreholeProjectSelector();
  buildProjectBudgetSelectors();
  syncHierarchyYearSelector();
  renderClientProjectHierarchy();
  populateImportScopeOptions();
}

function buildProgramSelector() {
  var sel = document.getElementById("bh-program-select");
  if(!sel) return;
  var current = activeProgram;
  var programs = Array.from(new Set(PROJECT_PROGRAMS.concat(projects.map(projectProgram)))).filter(Boolean);
  sel.innerHTML = "<option value=\"\""+(!current?" selected":"")+">All Programs</option>";
  programs.forEach(function(program) {
    var opt = document.createElement("option");
    opt.value = program;
    opt.textContent = program;
    if(program === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

function buildProjectSelector() {
  var sel = document.getElementById("bh-project-select");
  if(!sel) return;
  var current = sel.value;
  var program = activeProgram;
  sel.innerHTML = "<option value=\"\">All Projects</option>";
  projects.filter(function(p){
    return projectMatchesSelectedClient(p) && (!program || projectProgram(p) === program);
  }).forEach(function(p) {
    var opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name + (p.year ? " (" + p.year + ")" : "");
    if(p.name === current) opt.selected = true;
    sel.appendChild(opt);
  });
  if(current && sel.value !== current) sel.value = "";
}

function buildAddBoreholeProjectSelector() {
  var sel = document.getElementById("add-bh-project");
  if(!sel) return;
  var current = sel.value;
  var program = activeProgram;
  sel.innerHTML = "<option value=\"\">Select project</option>";
  projects.filter(function(p){
    return projectMatchesSelectedClient(p) && (!program || projectProgram(p) === program);
  }).forEach(function(p) {
    var opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name + (p.year ? " (" + p.year + ")" : "");
    if(p.name === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

function syncHierarchyYearSelector() {
  var sel = document.getElementById("bh-year-select");
  if(!sel) return;
  var current = sel.value || "2026";
  var years = Array.from(new Set(
    (bhData||[]).map(function(b){ return b.planned_year || ""; })
      .concat(projects.map(function(p){ return p.year || ""; }))
      .concat(["2025","2026","2027"])
  )).filter(function(y){ return /^\d{4}$/.test(String(y)); }).sort();
  sel.innerHTML = "<option value=\"\">All Years</option>";
  years.forEach(function(year) {
    var opt = document.createElement("option");
    opt.value = year;
    opt.textContent = year;
    if(year === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

function setEntityDialogMode(mode) {
  var isClient = mode === 'client';
  var isProjectEdit = mode === 'project-edit';
  document.getElementById('entity-dialog-mode').value = mode;
  document.getElementById('entity-client-fields').style.display = isClient ? 'grid' : 'none';
  document.getElementById('entity-project-fields').style.display = isClient ? 'none' : 'grid';
  document.getElementById('entity-dialog-title').textContent = isClient ? 'Add client' : isProjectEdit ? 'Edit project program' : 'Add project / program';
  document.getElementById('entity-dialog-copy').textContent = isClient
    ? 'Create a client account. Projects can then be assigned to this client.'
    : isProjectEdit
      ? 'Update the project setup. Existing operational records are not renamed or moved automatically.'
      : 'Create a project program and assign it to a client. An existing project name can have separate Exploration, Gas Riser and SIS programs.';
  document.getElementById('entity-dialog-save').textContent = isClient ? 'Create client' : isProjectEdit ? 'Save project' : 'Create project';
  document.querySelectorAll('#entity-client-fields [required]').forEach(function(el){ el.disabled = !isClient; });
  document.querySelectorAll('#entity-project-fields [required]').forEach(function(el){ el.disabled = isClient; });
}

function showNewClientDialog() {
  setEntityDialogMode('client');
  document.getElementById('entity-project-id').value = '';
  document.getElementById('entity-client-name').value = '';
  document.getElementById('entity-client-code').value = '';
  document.getElementById('entity-client-status').value = 'Active';
  document.getElementById('entity-client-notes').value = '';
  document.getElementById('client-project-dialog').showModal();
  setTimeout(function(){ document.getElementById('entity-client-name').focus(); }, 0);
}

function showNewProjectDialog(preferredClientId) {
  if(!clients.length) {
    toast('Create a client first','warn');
    showNewClientDialog();
    return;
  }
  setEntityDialogMode('project');
  document.getElementById('entity-project-id').value = '';
  var defaultClient = clientById(preferredClientId) || clientById(selectedClientId()) || clientById(activeClientId) || clients[0];
  var clientSelect = document.getElementById('entity-project-client');
  clientSelect.innerHTML = clients.filter(function(client){ return client.status !== 'Inactive'; }).map(function(client){
    return '<option value="'+Number(client.id)+'"'+(defaultClient&&Number(defaultClient.id)===Number(client.id)?' selected':'')+'>'+esc(client.name)+'</option>';
  }).join('');
  var programSelect = document.getElementById('entity-project-program');
  programSelect.innerHTML = PROJECT_PROGRAMS.map(function(program){
    return '<option'+(program===(activeProgram||'Exploration')?' selected':'')+'>'+esc(program)+'</option>';
  }).join('');
  document.getElementById('entity-project-name').value = '';
  document.getElementById('entity-project-year').value = String(new Date().getFullYear());
  document.getElementById('entity-project-status').value = 'Active';
  document.getElementById('entity-project-notes').value = '';
  document.getElementById('client-project-dialog').showModal();
  setTimeout(function(){ document.getElementById('entity-project-name').focus(); }, 0);
}

function showEditProjectDialog(projectId) {
  var project = projects.find(function(item){ return Number(item.id) === Number(projectId); });
  if(!project) {
    toast('Project could not be found','err');
    return;
  }
  setEntityDialogMode('project-edit');
  document.getElementById('entity-project-id').value = String(project.id);
  var clientSelect = document.getElementById('entity-project-client');
  clientSelect.innerHTML = clients.filter(function(client){
    return client.status !== 'Inactive' || Number(client.id) === Number(project.client_id);
  }).map(function(client){
    return '<option value="'+Number(client.id)+'"'+(Number(client.id)===Number(project.client_id)?' selected':'')+'>'+esc(client.name)+'</option>';
  }).join('');
  var programSelect = document.getElementById('entity-project-program');
  programSelect.innerHTML = PROJECT_PROGRAMS.map(function(program){
    return '<option'+(program===projectProgram(project)?' selected':'')+'>'+esc(program)+'</option>';
  }).join('');
  document.getElementById('entity-project-name').value = project.name || '';
  document.getElementById('entity-project-year').value = project.year || '';
  document.getElementById('entity-project-status').value = project.status || 'Active';
  document.getElementById('entity-project-notes').value = project.notes || '';
  document.getElementById('client-project-dialog').showModal();
  setTimeout(function(){ document.getElementById('entity-project-name').focus(); }, 0);
}

function closeClientProjectDialog() {
  var dialog = document.getElementById('client-project-dialog');
  if(dialog && dialog.open) dialog.close();
}

async function saveClientProjectDialog(event) {
  event.preventDefault();
  var mode = document.getElementById('entity-dialog-mode').value;
  var isProjectEdit = mode === 'project-edit';
  var projectId = Number(document.getElementById('entity-project-id').value || 0);
  var existingProject = isProjectEdit
    ? projects.find(function(item){ return Number(item.id) === projectId; })
    : null;
  var payload;
  var url;
  if(mode === 'client') {
    payload = {
      name:document.getElementById('entity-client-name').value.trim(),
      code:document.getElementById('entity-client-code').value.trim(),
      status:document.getElementById('entity-client-status').value,
      notes:document.getElementById('entity-client-notes').value.trim()
    };
    url = API+'/clients';
  } else {
    payload = {
      contractor:'Company',
      client_id:Number(document.getElementById('entity-project-client').value),
      name:document.getElementById('entity-project-name').value.trim(),
      program:document.getElementById('entity-project-program').value,
      year:document.getElementById('entity-project-year').value.trim(),
      status:document.getElementById('entity-project-status').value,
      notes:document.getElementById('entity-project-notes').value.trim()
    };
    url = isProjectEdit ? API+'/projects/'+encodeURIComponent(projectId) : API+'/projects';
  }
  if(!payload.name) return;
  var saveButton = document.getElementById('entity-dialog-save');
  saveButton.disabled = true;
  try {
    var response = await fetch(url, {
      method:isProjectEdit?'PATCH':'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    var saved = await response.json().catch(function(){ return {}; });
    if(!response.ok) throw new Error(saved.detail || 'Project save failed');
    closeClientProjectDialog();
    await fetchProjects();
    populateWorkspaceClientOptions();
    if(mode === 'client') {
      var clientSel = document.getElementById('bh-client-select');
      if(clientSel) clientSel.value = String(saved.id);
      var workspaceClient = document.getElementById('workspace-client-select');
      if(workspaceClient) {
        workspaceClient.value = String(saved.id);
        populateWorkspaceProjectOptions();
      }
      toast('\u2713 Client '+payload.name+' created');
    } else if(isProjectEdit) {
      var updatedProject = projects.find(function(item){ return Number(item.id) === projectId; });
      var wasActiveProject = existingProject
        && Number(activeClientId) === Number(existingProject.client_id)
        && activeProjectName === existingProject.name
        && activeProgram === projectProgram(existingProject);
      if(wasActiveProject && updatedProject) {
        activeClientId = Number(updatedProject.client_id) || null;
        activeProjectName = updatedProject.name;
        activeProgram = projectProgram(updatedProject);
        saveWorkspaceSelection();
        await loadProjectContractors();
        ensureActiveContractorInProgram();
        buildContractorSwitcher();
        syncWorkspaceControls();
      }
      renderClientProjectHierarchy();
      toast('\u2713 Project '+payload.name+' updated');
    } else {
      var planningClient = document.getElementById('bh-client-select');
      var planningProject = document.getElementById('bh-project-select');
      if(planningClient) planningClient.value = String(payload.client_id);
      buildProjectSelector();
      if(planningProject) planningProject.value = payload.name;
      var workspaceClientForProject = document.getElementById('workspace-client-select');
      var workspaceProject = document.getElementById('workspace-project-select');
      if(workspaceClientForProject) {
        workspaceClientForProject.value = String(payload.client_id);
        populateWorkspaceProjectOptions();
      }
      if(workspaceProject) {
        workspaceProject.value = payload.name;
        populateWorkspaceProgramOptions();
        var workspaceProgram = document.getElementById('workspace-program-select');
        if(workspaceProgram) workspaceProgram.value = payload.program;
      }
      toast('\u2713 Project '+payload.name+' created');
    }
    populateImportScopeOptions();
  } catch(error) {
    toast(error.message || (mode === 'client' ? 'Client creation failed' : 'Project save failed'),'err');
  } finally {
    saveButton.disabled = false;
  }
}

function filterBoreholesByClient() {
  var projectSel = document.getElementById("bh-project-select");
  if(projectSel) projectSel.value = "";
  buildProjectSelector();
  buildAddBoreholeProjectSelector();
  filterBoreholesByProject();
}

function currentFilteredBoreholes() {
  const program = activeProgram;
  const clientId = selectedClientId();
  const projectEl = document.getElementById("bh-project-select");
  const yearEl = document.getElementById("bh-year-select");
  const proj = (projectEl && projectEl.value) || activeProjectName || "";
  const year = (yearEl && yearEl.value) || "";
  let filtered = bhData.slice();
  if(program) filtered = filtered.filter(boreholeMatchesActiveProgram);
  if(clientId) {
    var clientProjects = new Set(projects.filter(function(p){ return Number(p.client_id)===clientId; }).map(function(p){ return p.name; }));
    filtered = filtered.filter(function(b){ return clientProjects.has(b.project||""); });
  }
  if(proj) filtered = filtered.filter(function(b){ return (b.project||"") === proj; });
  if(year) filtered = filtered.filter(function(b){
    return (b.hole_id||"").startsWith(year.slice(2)+"-") || (b.planned_year||"") === year || (b.project||"").includes(year);
  });
  return filtered;
}

function filterBoreholesByProject() {
  if(!document.getElementById("page-boreholes"))return;
  buildProjectSelector();
  buildAddBoreholeProjectSelector();
  syncHierarchyYearSelector();
  const filtered = currentFilteredBoreholes();
  // Keep cancelled holes visible in the register and map for auditability.
  // They are deliberately excluded from the active programme KPI and budget.
  const currentPlan = filtered.filter(function(b){return b.status!=='Cancelled';});
  updateBhKPIs(currentPlan);
  filterBhTable();
  renderBhMapFiltered(filtered);
  loadDefaultMapOverlays(false);
}

function renderBhMapFiltered(filteredData) {
  if(!bhMap) return;
  bhMarkers.forEach(function(m){try{m.remove();}catch(e){}});
  bhMarkers = [];
  var showCore   = document.getElementById("bh-filter-core") ? document.getElementById("bh-filter-core").checked : true;
  var showChip   = document.getElementById("bh-filter-chip") ? document.getElementById("bh-filter-chip").checked : true;
  var showLabels = document.getElementById("bh-filter-labels") ? document.getElementById("bh-filter-labels").checked : true;
  var visible = filteredData.filter(function(b) {
    b.lat = parseFloat(b.lat);
    b.lng = parseFloat(b.lng);
    if(!Number.isFinite(b.lat)||!Number.isFinite(b.lng)) return false;
    var t = b.type||b.bh_type||"";
    return t==="Core" ? showCore : showChip;
  });

  visible.forEach(function(b) {
    var col = getBhColor(b);
    var t = b.type||b.bh_type||"Core";
    var marker;
    if(t==="Core") {
      marker = L.circleMarker([b.lat,b.lng], {radius:7,color:"#fff",weight:1.5,fillColor:col,fillOpacity:0.9});
    } else {
      marker = L.marker([b.lat,b.lng], {icon:L.divIcon({
        html:"<div style=\"width:13px;height:13px;background:"+col+";border:2px solid #fff;border-radius:2px;box-shadow:0 1px 4px rgba(0,0,0,0.3)\"></div>",
        iconSize:[13,13], iconAnchor:[6,6], className:""
      })});
    }
    var eos = parseFloat(b.eos_cost)||0;
    var budget = parseFloat(b.budget_total)||0;
    var popupHtml = "<div style=\"font-family:Inter,sans-serif;min-width:190px;\">"
      +"<div style=\"font-weight:700;font-size:15px;margin-bottom:2px;\">"+b.hole_id+"</div>"
      +"<div style=\"color:#6b7280;font-size:12px;margin-bottom:8px;\">"+t+" &middot; "+(b.bit_type||"")+" &middot; "+(b.purpose||"")+"</div>"
      +"<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:8px;\">"
      +"<div><div style=\"color:#9ca3af;font-size:10px;\">EASTING</div>"+(b.easting||0).toFixed(0)+"</div>"
      +"<div><div style=\"color:#9ca3af;font-size:10px;\">NORTHING</div>"+(b.northing||0).toFixed(0)+"</div>"
      +"<div><div style=\"color:#9ca3af;font-size:10px;\">RL</div>"+(b.rl||0).toFixed(1)+"m</div>"
      +"<div><div style=\"color:#9ca3af;font-size:10px;\">DEPTH</div>"+(b.chip_depth||0).toFixed(1)+"m</div>"
      +"</div>"
      +"<span style=\"background:"+col+"22;color:"+col+";padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;\">"+b.status+"</span>"
      +"<div style=\"margin-top:10px;display:flex;gap:6px;\">"
      +"<button onclick=\"setBhStatus(&apos;"+b.hole_id+"&apos;,&apos;In Progress&apos;)\" style=\"font-size:10px;padding:3px 8px;background:#fef3c7;border:1px solid #d97706;color:#d97706;border-radius:4px;cursor:pointer;\">Start</button>"
      +"<button onclick=\"setBhStatus(&apos;"+b.hole_id+"&apos;,&apos;Complete&apos;)\" style=\"font-size:10px;padding:3px 8px;background:#dcfce7;border:1px solid #16a34a;color:#16a34a;border-radius:4px;cursor:pointer;\">Complete</button>"
      +"</div></div>";
    marker.bindPopup(popupHtml);
    if(showLabels) {
      marker.bindTooltip(b.hole_id, {permanent:true, direction:"right", className:"bh-label", offset:[8,0]});
    }
    marker.on("click", function(){ highlightBhRow(b.hole_id); });
    marker.addTo(bhMap);
    bhMarkers.push(marker);
  });
  if(visible.length) {
    bhMap.fitBounds(L.latLngBounds(visible.map(function(b){return[b.lat,b.lng];})), {padding:[20,20]});
  }
}

function highlightBhRow(holeId) {
  var rows = document.querySelectorAll("#bh-body tr");
  rows.forEach(function(r){ r.style.background = ""; });
  var target = document.querySelector("#bh-body tr[data-hole=\""+holeId+"\"]");
  if(target) {
    target.style.background = "#e5eee1";
    target.scrollIntoView({behavior:"smooth", block:"center"});
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initializePortal(){
  if(portalInitialized)return;
  portalInitialized=true;
  if(WORKSPACE_APP==='eos'){
    // Open the requested view immediately after authentication. Registry metadata
    // fills in alongside the report; no filter-count or project-link gate.
    initializeEosScope();workspaceStarted=true;ensureActiveContractorInProgram();buildContractorSwitcher();
    openInitialAppPage();
    Promise.all([fetchContractors(),fetchProjects()]).then(()=>{
      const previous=activeContractor;ensureActiveContractorInProgram();
      if(previous!==activeContractor)switchContractor(activeContractor);
      renderEosScopeControls();buildContractorSwitcher();syncWorkspaceControls();
    }).catch(error=>console.warn('EOS setup refresh failed:',error.message));
    return;
  }
  await fetchContractors();
  await fetchProjects();
  if(WORKSPACE_APP==='eos')initializeEosScope();
  else if(!restoreWorkspaceSelection()) await showWorkspaceGate();
  workspaceStarted = true;
  await loadProjectContractors();
  ensureActiveContractorInProgram();
  buildContractorSwitcher();
  syncWorkspaceControls();
  if(WORKSPACE_APP==='project')await loadProjectBudgets();
  await updateDbCount();
  openInitialAppPage();
}
