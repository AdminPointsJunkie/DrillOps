/* Shared session renewal for the management apps and field pages. */
(function(root){
 'use strict';
 const key='drillops_supabase_session',fetcher=root.fetch.bind(root);
 let memory=null,refreshing=null;
 const valid=s=>s&&typeof s.access_token==='string'&&s.access_token;
 function stored(storage){try{const s=JSON.parse(root[storage].getItem(key)||'null');return valid(s)?s:null;}catch(_){return null;}}
 function remove(storage){try{root[storage].removeItem(key);}catch(_){}}
 function save(session){
  memory=session;
  if(session){
   try{root.localStorage.setItem(key,JSON.stringify(session));remove('sessionStorage');}
   catch(_){try{root.sessionStorage.setItem(key,JSON.stringify(session));remove('localStorage');}catch(_){}}
  }else{remove('localStorage');remove('sessionStorage');}
  root.dispatchEvent(new Event('drillops-session-change'));
 }
 function load(){
  // Read on every request: another app/tab may already have rotated the refresh token.
  const local=stored('localStorage'),legacy=stored('sessionStorage');
  if(local)return memory=local;
  if(legacy)return memory=legacy;
  // Memory fallback is only for browsers where neither storage API is available.
  try{root.localStorage.getItem(key);root.sessionStorage.getItem(key);memory=null;}catch(_){}
  return memory;
 }
 function expiry(session){
  if(Number(session.expires_at)>0)return Number(session.expires_at);
  try{return Number(JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).exp)||0;}catch(_){return 0;}
 }
 function config(){
  const c=root.DRILLOPS_CONFIG||{};
  if(!c.supabaseUrl||!c.supabasePublishableKey)throw new Error('Authentication is not configured.');
  return {url:String(c.supabaseUrl).replace(/\/$/,''),key:c.supabasePublishableKey};
 }
 async function request(grant,payload){
  let c=config();
  if(grant==='refresh_token'&&root.DRILLOPS_CONFIG?.legacyUrl){try{const issuer=JSON.parse(atob(load().access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).iss;if(issuer===root.DRILLOPS_CONFIG.legacyUrl+'/auth/v1')c={url:root.DRILLOPS_CONFIG.legacyUrl,key:root.DRILLOPS_CONFIG.legacyKey};}catch{}}
  const response=await fetcher(c.url+'/auth/v1/token?grant_type='+encodeURIComponent(grant),{method:'POST',headers:{apikey:c.key,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
   const error=new Error(data.message||data.error_description||'Authentication is temporarily unavailable.');
   error.sessionExpired=grant==='refresh_token'&&([400,401,403].includes(response.status))&&(!data.code||['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','invalid_grant','user_banned','user_not_found'].includes(data.code));
   throw error;
  }
  if(!valid(data))throw new Error('The sign-in response could not be read. Please retry.');
  return {...data,expires_at:expiry(data)||(Number(data.expires_in)>0?Math.floor(Date.now()/1000)+Number(data.expires_in):0)};
 }
 function expiredError(){const error=new Error('Your session expired. Please sign in again.');error.sessionExpired=true;return error;}
 function fresh(s){const end=expiry(s);return end?end*1000>Date.now()+90000:!s.refresh_token;}
 async function token(rejectedToken=''){
  let current=load();if(!current)return '';
  if(fresh(current)&&(!rejectedToken||current.access_token!==rejectedToken))return current.access_token;
  if(refreshing)return refreshing;
  const renew=async()=>{
   current=load();if(!current)return '';
   if(fresh(current)&&(!rejectedToken||current.access_token!==rejectedToken))return current.access_token;
   if(!current.refresh_token){save(null);throw expiredError();}
   try{
    const next=await request('refresh_token',{refresh_token:current.refresh_token});
    const latest=load();
    if(!latest)throw expiredError(); // Sign-out while the renewal was in flight wins.
    if(latest.access_token!==current.access_token||latest.refresh_token!==current.refresh_token)return latest.access_token;
    save(next);return next.access_token;
   }catch(error){
    const latest=load();
    if(latest&&(latest.access_token!==current.access_token||latest.refresh_token!==current.refresh_token))return latest.access_token;
    if(error.sessionExpired)save(null);
    throw error;
   }
  };
  // Web Locks also serialize refreshes across EOS, Account, Project and field tabs.
  refreshing=(root.navigator.locks?root.navigator.locks.request(key+'-refresh',renew):renew());
  try{return await refreshing;}finally{refreshing=null;}
 }
 async function authenticate(grant,payload){const session=await request(grant,payload);save(session);return session;}
 async function apiFetch(input,options={}){
  const original=new Request(input,options);
  const send=access=>{const request=original.clone(),headers=new Headers(request.headers);headers.set('Authorization','Bearer '+access);return fetcher(new Request(request,{headers}));};
  const first=await token();if(!first)throw expiredError();
  let response=await send(first);
  if(response.status!==401)return response;
  const next=await token(first);if(!next)throw expiredError();
  response=await send(next);
  if(response.status===401){
   // An old response must never erase a newer session written by another tab.
   if(load()?.access_token===next)save(null);
   throw expiredError();
  }
  return response;
 }
 root.DrillOpsSession={load,save,token,authenticate,fetch:apiFetch};
 if(root.DrillOpsUnifiedSession)root.DrillOpsSession=root.DrillOpsUnifiedSession(root.DrillOpsSession);
 root.addEventListener('storage',event=>{if(event.key===key){memory=null;root.dispatchEvent(new Event('drillops-session-change'));}});
})(window);
