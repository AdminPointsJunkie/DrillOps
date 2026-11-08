import {createClient} from '@supabase/supabase-js';
const config=window.DRILLOPS_CONFIG;
const client=createClient(config.supabaseUrl,config.supabasePublishableKey);
window.DrillOpsAuthClient=client;
window.DrillOpsUnifiedSession=function(legacy){
 const storageKey='sb-dzthwvxrltkltfvubvld-auth-token';let pending=null,signingOut=false;
 const read=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'null');}catch{return null;}};
 const canonical=s=>{try{return JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).iss===config.supabaseUrl+'/auth/v1';}catch{return false;}};
 const changed=()=>window.dispatchEvent(new Event('drillops-session-change'));
 client.auth.onAuthStateChange((event,session)=>{if(session||event==='SIGNED_OUT')legacy.save(null);changed();});
 function save(session){
  if(!session){signingOut=true;legacy.save(null);pending=client.auth.signOut({scope:'local'}).finally(()=>{signingOut=false;changed();});return pending;}
  if(!canonical(session))return legacy.save(session);
  pending=client.auth.setSession(session).then(({error})=>{if(error)throw error;legacy.save(null);changed();});return pending;
 }
 function load(){return signingOut?null:read()||legacy.load();}
 async function token(rejected=''){
  if(pending){await pending;pending=null;}
  if(!read())return legacy.token(rejected);
  let {data,error}=await client.auth.getSession();if(error)throw error;
  if(rejected&&data.session?.access_token===rejected){const next=await client.auth.refreshSession();data=next.data;error=next.error;}
  if(error)throw error;return data.session?.access_token||'';
 }
 async function authenticate(grant,payload){
  const result=grant==='password'?await client.auth.signInWithPassword(payload):await client.auth.refreshSession(payload);
  if(result.error)throw result.error;legacy.save(null);changed();return result.data.session;
 }
 async function apiFetch(input,options={}){
  const request=new Request(input,options);
  const first=await token();if(!first){const e=Error('Please sign in to DrillOps.');e.sessionExpired=true;throw e;}
  let r=await nativeFetchWithToken(first);if(r.status===401){const next=await token(first);if(next&&next!==first)r=await nativeFetchWithToken(next);}return r;
  function nativeFetchWithToken(access){const copy=request.clone(),headers=new Headers(copy.headers);headers.set('Authorization','Bearer '+access);return nativeFetch(new Request(copy,{headers}));}
 }
 const nativeFetch=window.fetch.bind(window);
 return {load,save,token,authenticate,fetch:apiFetch};
};
