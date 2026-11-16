import {installPasswordVisibility} from './password-controls.js';
import {TERMS_VERSION,MARKETING_LABEL,validPhone} from './signup-consent.js';
export function installOperatorSignup({db,doc=document}){
 const form=doc.querySelector('#operator-signup'),status=doc.querySelector('#operator-status');let working=false;
 installPasswordVisibility(form);
 doc.querySelector('#marketing-label').textContent=MARKETING_LABEL;
 const showExistingSession=(session)=>{form.reset();form.hidden=true;const appOnly=session?.user?.app_metadata?.fieldmaps_app_only===true;status.textContent=appOnly?'Your account is ready. Open the FieldMaps iPhone app and sign in. Your Argo NR operator access is app-only.':'You’re already signed in. Continue with your existing account.';const link=doc.querySelector('.signin');link.href=appOnly?'https://apps.apple.com/au/app/id6796881116':'/maps/';link.textContent=appOnly?'Download or open FieldMaps':'Open your workspace';};
 // Check before asking an existing user to fill in another registration form.
 void db.auth.getSession().then(({data,error})=>{if(!error&&data?.session)showExistingSession(data.session);}).catch(()=>{});
 form.elements.phone.oninput=()=>form.elements.phone.setCustomValidity('');
 form.onsubmit=async e=>{e.preventDefault();if(working||!form.reportValidity())return;
  const f=form.elements;if(!validPhone(f.phone.value)){f.phone.setCustomValidity('Enter a valid phone number.');f.phone.reportValidity();return;}
  working=true;const button=form.querySelector('[type=submit]');button.disabled=true;status.textContent='';
  try{
   const existing=await db.auth.getSession();if(existing.error)throw existing.error;
   if(existing.data.session){showExistingSession(existing.data.session);return;}
   const {data,error}=await db.auth.signUp({email:f.email.value.trim(),password:f.password.value,options:{emailRedirectTo:'https://www.drillops.com.au/maps/',data:{fieldmaps_signup:'operator',full_name:f.name.value.trim(),contact_phone:f.phone.value.trim(),terms_version:f.terms.checked?TERMS_VERSION:null,marketing_opt_in:f.marketing.checked}}});
   if(error&&['user_already_exists','email_exists','identity_already_exists'].includes(error.code)){
    f.password.value='';form.hidden=true;status.textContent='Sign in to the FieldMaps iPhone app with your existing account.';return;
   }
   if(error)throw error;
   if(data?.user?.identities?.length===0){f.password.value='';form.hidden=true;status.textContent='Sign in to the FieldMaps iPhone app if you already have an account. Otherwise, check your email for confirmation.';return;}
   f.password.value='';form.hidden=true;status.textContent='Check your email to confirm your account. Then sign in to the FieldMaps iPhone app. New operator accounts automatically join Argo NR with app-only access.';
  }catch(error){status.textContent=error.message||'Could not create your account. Please try again.';}finally{working=false;button.disabled=false;}
 };
}
