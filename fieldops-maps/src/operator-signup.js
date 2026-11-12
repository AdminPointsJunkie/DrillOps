import {TERMS_VERSION,MARKETING_LABEL,validPhone} from './signup-consent.js';
export function installOperatorSignup({db,doc=document}){
 const form=doc.querySelector('#operator-signup'),status=doc.querySelector('#operator-status');let working=false;
 doc.querySelector('#marketing-label').textContent=MARKETING_LABEL;
 form.elements.phone.oninput=()=>form.elements.phone.setCustomValidity('');
 form.onsubmit=async e=>{e.preventDefault();if(working||!form.reportValidity())return;
  const f=form.elements;if(!validPhone(f.phone.value)){f.phone.setCustomValidity('Enter a valid phone number.');f.phone.reportValidity();return;}
  working=true;const button=form.querySelector('button');button.disabled=true;status.textContent='';
  try{
   const existing=await db.auth.getSession();if(existing.error)throw existing.error;
   if(existing.data.session){status.textContent='You’re already signed in. Sign out before creating another account.';return;}
   const {error}=await db.auth.signUp({email:f.email.value.trim(),password:f.password.value,options:{emailRedirectTo:'https://www.drillops.com.au/maps/',data:{fieldmaps_signup:'operator',full_name:f.name.value.trim(),contact_phone:f.phone.value.trim(),terms_version:f.terms.checked?TERMS_VERSION:null,marketing_opt_in:f.marketing.checked}}});
   if(error)throw error;
   f.password.value='';form.hidden=true;status.textContent='Check your email to confirm your account. If you already have an account, sign in below.';
  }catch(error){status.textContent=error.message||'Could not create your account. Please try again.';}finally{working=false;button.disabled=false;}
 };
}
