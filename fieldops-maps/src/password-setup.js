export function readAuthLink(href){
 const url=new URL(href),hash=new URLSearchParams(url.hash.slice(1));
 return {type:hash.get('type')||url.searchParams.get('type'),error:hash.get('error_code')||hash.get('error')||url.searchParams.get('error_code')||url.searchParams.get('error'),hasTokens:hash.has('access_token')};
}
export function installPasswordSetup(db,context,getUser,toast,doc=document){
 const $=s=>doc.querySelector(s),dialog=$('#password-dialog'),button=$('#set-password');let checkedUser=null,openedUser=null,saving=false;
 function open(recovery=false){$('#password-form').reset();$('#password-error').textContent='';dialog.querySelector('h2').textContent=recovery?'Reset your password':'Create your password';dialog.querySelector('.field-note').textContent=`${getUser()?.email||'Your account'} — choose a password of at least 12 characters.`;if(!dialog.open)dialog.showModal();$('#new-password').focus();}
 button.textContent='Finish account setup';button.onclick=()=>open();
 const errorDialog=doc.createElement('dialog');errorDialog.id='auth-link-error';errorDialog.innerHTML='<h2>This sign-in link could not be used</h2><p>The link has expired, was already used, or is invalid. Ask your admin to resend the invitation, then open the newest email promptly.</p><p>If you already accepted your invitation, request a new email sign-in link to finish creating your password.</p><button class="primary" id="link-sign-in">Go to sign in</button> <button class="secondary" id="link-close">Close</button>';doc.body.append(errorDialog);
 errorDialog.querySelector('#link-close').onclick=()=>errorDialog.close();errorDialog.querySelector('#link-sign-in').onclick=()=>{errorDialog.close();$('#auth').showModal();$('#auth-error').textContent='Enter your email, then choose Email sign-in link.';};
 if(context.error)errorDialog.showModal();
 $('#password-form').onsubmit=async e=>{
  e.preventDefault();if(saving||!getUser()||!$('#password-form').reportValidity())return;
  if($('#new-password').value!==$('#confirm-password').value){$('#password-error').textContent='Passwords do not match.';return;}
  saving=true;$('#save-password').disabled=true;$('#password-error').textContent='';
  try{const {error}=await db.auth.updateUser({password:$('#new-password').value});if(error)throw error;button.hidden=true;checkedUser=getUser()?.id;$('#password-form').reset();dialog.close();toast('Password created. Your account is ready. Use your email and password next time.');}
  catch(e){$('#password-error').textContent=e.message||String(e);}finally{saving=false;$('#save-password').disabled=false;}
 };
 return {async onSession(event,session){
  const user=session?.user;if(!user){checkedUser=null;openedUser=null;button.hidden=true;dialog.close();$('#password-form').reset();return;}
  if(event==='PASSWORD_RECOVERY'||(!context.error&&context.hasTokens&&['invite','recovery'].includes(context.type)&&openedUser!==user.id)){openedUser=user.id;button.hidden=false;open(context.type==='recovery'||event==='PASSWORD_RECOVERY');}
  if(checkedUser===user.id||saving)return;checkedUser=user.id;
  try{const {data,error}=await db.rpc('maps_needs_password');if(error)throw error;if(getUser()?.id!==user.id)return;if(data===true){button.hidden=false;if(openedUser!==user.id){openedUser=user.id;open();}}}
  catch(e){checkedUser=null;toast('Could not check account setup. Refresh to retry. '+(e.message||String(e)));}
 }};
}
