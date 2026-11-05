export const socialProviders=[{id:'google',name:'Google',logo:'google-signin.png'},{id:'azure',name:'Microsoft',symbol:'▦'},{id:'github',name:'GitHub',logo:'github-signin.png'}];
const pendingKey='fieldmaps.identity-link';
export function providerOptions(provider,redirectTo){
 if(!socialProviders.some(p=>p.id===provider))throw Error('Unknown sign-in provider.');
 return {redirectTo,...(provider==='azure'?{scopes:'email',queryParams:{prompt:'select_account'}}:provider==='google'?{queryParams:{prompt:'select_account'}}:{scopes:'read:user user:email'})};
}
export async function startSocialAuth(db,provider,{userId,redirectTo}={}){
 const options=providerOptions(provider,redirectTo);
 if(userId){const current=await db.auth.getUser();if(current.error||current.data.user?.id!==userId)throw Error('Your sign-in changed. Reopen Account settings.');const result=await db.auth.linkIdentity({provider,options});if(result.error)throw result.error;return result;}
 const result=await db.auth.signInWithOAuth({provider,options});if(result.error)throw result.error;return result;
}
export function installSocialAuth({db,url,key,doc=document,canLeave=()=>true,notify=()=>{},openAccount=()=>{}}){
 const win=doc.defaultView,initial=new URL(win.location.href),flow=initial.searchParams.get('auth_flow'),hash=new URLSearchParams(initial.hash.slice(1));
 const callbackError=initial.searchParams.get('error_description')||hash.get('error_description')||initial.searchParams.get('error')||hash.get('error');
 let settingsPromise,finished=false;
 async function settings(){
  if(!settingsPromise)settingsPromise=fetch(url+'/auth/v1/settings',{headers:{apikey:key}}).then(r=>{if(!r.ok)throw Error('Sign-in options could not load. Please reopen and try again.');return r.json();}).catch(e=>{settingsPromise=null;throw e;});
  return settingsPromise;
 }
 async function start(provider,userId){
  if(!canLeave())throw Error('Save your changes and finish pending uploads before connecting a sign-in account.');
  const redirect=new URL('./',win.location.href);redirect.searchParams.set('auth_flow',userId?'link':'signin');
  if(userId)win.sessionStorage.setItem(pendingKey,JSON.stringify({userId,provider,at:Date.now()}));
  try{await startSocialAuth(db,provider,{userId,redirectTo:redirect.href});}catch(e){if(userId)win.sessionStorage.removeItem(pendingKey);throw e;}
 }
 function mount(container,user){
  container.replaceChildren();if(user){const title=doc.createElement('h3');title.textContent=user?'Linked sign-in accounts':'Sign in or create an account';container.append(title);
  const note=doc.createElement('p');note.className='social-auth-note';note.textContent=user?'Link another way to sign in. Your projects and company access stay with this account.':'New here? Your first sign-in creates your account. Existing users: use your current email, or sign in first and link a different account in Settings.';container.append(note);}
  const list=doc.createElement('div');list.className='social-auth-buttons';container.append(list);
  const status=doc.createElement('p');status.setAttribute('role','status');container.append(status);
  const buttons=socialProviders.map(provider=>{const b=doc.createElement('button');b.type='button';b.className='social-auth-button';const icon=doc.createElement('span');icon.setAttribute('aria-hidden','true');icon.className='social-auth-symbol social-'+provider.id;if(provider.logo){const image=doc.createElement('img');image.src=new URL('provider-logos/'+provider.logo,new URL('./',win.location.href)).href;image.alt='';image.width=image.height=20;icon.append(image);}else icon.textContent=provider.symbol;b.append(icon,doc.createTextNode((user?'Link ':'Continue with ')+provider.name));b.disabled=true;b.hidden=true;list.append(b);return {b,provider};});
  void settings().then(data=>{if(!container.isConnected)return;if(!user&&!socialProviders.some(p=>data.external?.[p.id])){container.hidden=true;return;}container.hidden=false;for(const {b,provider} of buttons){const identity=user?.identities?.find(i=>i.provider===provider.id);if(identity){b.hidden=false;b.append(doc.createTextNode(' · Linked'));b.title=identity.identity_data?.email||'Linked to this account';continue;}if(!data.external?.[provider.id]){b.append(doc.createTextNode(' · Coming soon'));continue;}b.hidden=false;b.disabled=false;b.onclick=async()=>{if(container.closest('dialog')?.dataset.profileDirty==='true'){status.textContent='Save your account changes before linking a sign-in provider.';return;}buttons.forEach(x=>x.b.disabled=true);status.textContent='Opening '+provider.name+'…';try{await start(provider.id,user?.id);}catch(e){status.textContent=e.message||'Sign-in could not start.';buttons.forEach(x=>{x.b.disabled=!!user?.identities?.some(i=>i.provider===x.provider.id)||!data.external?.[x.provider.id];});}};}}).catch(e=>status.textContent=e.message);
 }
 async function finish(user){
  if(!flow||finished)return;finished=true;
  const clean=new URL(win.location.href);clean.searchParams.delete('auth_flow');win.history.replaceState(win.history.state,'',clean.href);
  if(flow==='link'){
   let pending;try{pending=JSON.parse(win.sessionStorage.getItem(pendingKey));}catch{}win.sessionStorage.removeItem(pendingKey);
   if(callbackError){notify('Account was not linked. '+callbackError);return;}
   if(!pending||Date.now()-pending.at>30*60*1000||!user||user.id!==pending.userId){notify('Could not confirm the account link. Sign in to your original account and check Account settings.');return;}
   const result=await db.auth.getUser();if(result.error||result.data.user?.id!==pending.userId){notify('Could not verify your linked account. Reopen Account settings.');return;}
   if(!result.data.user.identities?.some(i=>i.provider===pending.provider)){notify('The provider was not linked. Please try again in Account settings.');return;}
   notify('Sign-in account linked. Your projects and company access are unchanged.');openAccount(result.data.user);
  }else if(callbackError)notify('Sign-in could not finish. '+callbackError);
 }
 return {mount,finish,isCallback:!!flow};
}
