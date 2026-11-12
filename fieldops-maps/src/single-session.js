// The server selects the newest login. This client never claims or reclaims a session.
export function sessionIdentity(session){
 if(!session?.user?.id||!session.access_token)return null;
 try{const payload=JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return payload.session_id?session.user.id+':'+payload.session_id:session.access_token;}catch{return session.access_token;}
}
export function installSingleSession({db,win=window,doc=document,onRevoked=()=>{},onSignedOut=()=>{},onError=()=>{},intervalMs=15000}){
 let identity=null,pending=null,notified=null,disposed=false;
 async function verify(key){
  try{
   const {data,error}=await db.rpc('fieldmaps_session_current');
   if(disposed||key!==identity)return;
   if(error||data!==false)return; // An outage is not proof of a competing sign-in.
   if(notified!==key){notified=key;await onRevoked();}
   if(disposed||key!==identity)return;
   // Global sign-out here would also kill the new device's winning login.
   const result=await db.auth.signOut({scope:'local'});
   if(result?.error)throw result.error;
   if(!disposed&&(!identity||identity===key))onSignedOut();
  }catch(error){if(!disposed&&key===identity&&notified===key)onError(error);}
 }
 function check(){
  if(disposed||!identity||win.navigator?.onLine===false)return Promise.resolve();
  if(pending?.identity===identity)return pending.promise;
  const work={identity};pending=work;
  work.promise=verify(identity).finally(()=>{if(pending===work)pending=null;});return work.promise;
 }
 const wake=()=>void check(),visible=()=>{if(!doc.hidden)wake();};
 const timer=win.setInterval(wake,intervalMs);win.addEventListener('online',wake);win.addEventListener('focus',wake);doc.addEventListener('visibilitychange',visible);
 return {check,onSession(session){const next=sessionIdentity(session);if(next!==identity){identity=next;notified=null;}if(identity)win.setTimeout(wake,0);},dispose(){disposed=true;identity=null;win.clearInterval(timer);win.removeEventListener('online',wake);win.removeEventListener('focus',wake);doc.removeEventListener('visibilitychange',visible);}};
}
