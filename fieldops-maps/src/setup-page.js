import {installPasswordVisibility} from './password-controls.js';
export async function installSetupPage(db,win){
 const doc=win.document,$=s=>doc.querySelector(s),params=new URLSearchParams(win.location.hash.slice(1));
 let token=params.get('token_hash'),target=null,busy=false;const type=params.get('type')==='recovery'?'recovery':'invite',linkName=type==='recovery'?'password reset':'invitation';
 const form=$('#setup-form'),submit=$('#setup-submit'),status=$('#setup-status');
 installPasswordVisibility(form);
 const clean=()=>win.history.replaceState(null,'','/maps/setup.html');
 function unavailable(message){form.hidden=true;status.textContent=message;$('#setup-help').hidden=false;$('#setup-continue').hidden=false;}
 function ready(user){target=user.id;$('#setup-intro').textContent=`Choose a password for ${user.email}.`;if(user.app_metadata?.fieldmaps_app_only){$('#setup-continue').href='https://apps.apple.com/au/app/id6796881116';$('#setup-continue').textContent='Open FieldMaps on your iPhone →';}}
 if(type==='recovery'){doc.querySelector('h1').textContent='Reset your password';submit.textContent='Save password';}
 form.onsubmit=async e=>{
  e.preventDefault();if(busy||!form.reportValidity())return;
  const password=$('#setup-password').value;if(password!==$('#setup-confirm').value){status.textContent='Passwords do not match.';return;}
  busy=true;submit.disabled=true;status.textContent='Saving your password…';
  try{
   if(token){const {data,error}=await db.auth.verifyOtp({token_hash:token,type});if(error)throw error;if(!data?.user||!data.session)throw Error('The '+linkName+' could not be verified.');ready(data.user);token=null;clean();}
   if(!target)throw Error('Open your '+linkName+' email to choose your password.');
   const current=await db.auth.getUser();if(current.error)throw current.error;if(current.data?.user?.id!==target)throw Error('Your signed-in account changed. Reopen your invitation or sign in again.');
   const {error}=await db.auth.updateUser({password});if(error)throw error;
   form.reset();form.hidden=true;status.textContent='Password saved. Use your new password to sign in to FieldMaps.';$('#setup-help').hidden=true;$('#setup-continue').hidden=false;clean();
  }catch(e){status.textContent=e.message||String(e);if(token){status.textContent='This '+linkName+' could not be verified. '+status.textContent;$('#setup-help').hidden=false;}}
  finally{busy=false;submit.disabled=false;}
 };
 if(params.has('error')||params.has('error_code')){clean();unavailable('This link has expired, was already used, or is invalid.');return;}
 // A new invitation displays the form immediately. It is redeemed only on submit,
 // so opening the page (including email scanners) cannot consume the invitation.
 if(token){submit.disabled=false;return;}
 submit.disabled=true;status.textContent='Checking your '+linkName+'…';
 try{
  if(params.has('access_token')){
   const {data,error}=await db.auth.setSession({access_token:params.get('access_token'),refresh_token:params.get('refresh_token')||''});if(error)throw error;if(!data?.user)throw Error('The '+linkName+' could not be verified.');ready(data.user);clean();
  }else{
   const current=await db.auth.getUser();if(current.error||!current.data?.user)throw Error('Open the Create password link in your invitation email.');
   const check=await db.rpc('maps_needs_password');if(check.error)throw check.error;if(check.data!==true)throw Error('This account does not have unfinished password setup. Open a password-reset link to change its password.');ready(current.data.user);
  }
  status.textContent='';
 }catch(e){clean();unavailable(e.message||String(e));}finally{submit.disabled=false;}
}
