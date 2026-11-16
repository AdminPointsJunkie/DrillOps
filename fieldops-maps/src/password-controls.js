const eye='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
export function installPasswordVisibility(root){
 for(const input of root.querySelectorAll('input[type=password]')){
  if(input.closest('.password-control'))continue;
  const doc=input.ownerDocument,wrap=doc.createElement('span'),button=doc.createElement('button');
  wrap.className='password-control';input.before(wrap);wrap.append(input);button.type='button';button.className='password-toggle';button.innerHTML=eye;wrap.append(button);
  const hide=()=>{input.type='password';button.setAttribute('aria-label','Show password');button.setAttribute('aria-pressed','false');button.title='Show password';};
  button.onclick=()=>{const visible=input.type==='password';input.type=visible?'text':'password';button.setAttribute('aria-label',visible?'Hide password':'Show password');button.setAttribute('aria-pressed',String(visible));button.title=visible?'Hide password':'Show password';};
  input.form?.addEventListener('reset',hide);root.closest?.('dialog')?.addEventListener('close',hide);hide();
 }
}
export const PASSWORD_RESET_REDIRECT='https://www.drillops.com.au/maps/';
export async function sendPasswordReset(db,email){
 const {error}=await db.auth.resetPasswordForEmail(email.trim(),{redirectTo:PASSWORD_RESET_REDIRECT});
 if(error)throw error;
}
export function installResetRequest(db,doc=document){
 const form=doc.querySelector('#reset-request'),status=doc.querySelector('#reset-status'),button=form.querySelector('[type=submit]');let busy=false;
 form.onsubmit=async e=>{e.preventDefault();if(busy||!form.reportValidity())return;busy=true;button.disabled=true;status.textContent='Sending reset link…';try{await sendPasswordReset(db,form.elements.email.value);status.textContent='If an account exists for this email, a password reset link is on its way. Check your inbox and spam folder.';}catch(e){status.textContent=e.message||'Could not send the reset link. Please try again.';}finally{busy=false;button.disabled=false;}};
}
