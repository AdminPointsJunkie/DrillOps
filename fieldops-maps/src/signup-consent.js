import {escapeHTML as esc} from './explore-dialogs.js';
export const TERMS_VERSION='2026-11-12';
export const accountBrand='<div class="signup-brand"><span>DrillOps</span></div>';
export const MARKETING_LABEL='I consent to DrillOps using my contact details to send me marketing communications.';
export function validPhone(phone){return String(phone).replace(/\D/g,'').length>=7&&String(phone).replace(/\D/g,'').length<=15&&String(phone).length<=50;}
export function installSignupConsent({db,doc=document,getUser,onSaved=()=>{},onSignOut=()=>db.auth.signOut()}){
 let dialog,sequence=0,checkedUser=null,preferences,pending;
 const close=()=>{dialog?.close();dialog?.remove();dialog=null;};
 async function rpc(name,args){const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data;}
 function frame(title,content){close();const d=doc.createElement('dialog');d.className='signup-consent';d.setAttribute('aria-labelledby','signup-consent-title');d.innerHTML=`<form>${accountBrand}<div class="dialog-heading"><h2 id="signup-consent-title">${title}</h2></div>${content}<p data-status role="status"></p><div class="dialog-actions"><button type="button" data-exit class="secondary">Sign out</button><button type="submit" class="primary">Continue</button></div></form>`;doc.body.append(d);dialog=d;d.showModal();d.addEventListener('cancel',e=>e.preventDefault());d.querySelector('[data-exit]').onclick=()=>void onSignOut();return d;}
 function check(user){
  if(!user){sequence++;pending=null;checkedUser=null;preferences=null;close();return Promise.resolve(false);}
  if(checkedUser===user.id)return Promise.resolve(true);
  if(pending?.userId===user.id)return pending.promise;
  if(dialog?.dataset.onboarding===user.id)return Promise.resolve(false);
  const ticket=++sequence;close();
  const request={userId:user.id};pending=request;
  request.promise=performCheck(user,ticket).finally(()=>{if(pending===request)pending=null;});
  return request.promise;
 }
 async function performCheck(user,ticket){
  let d;
  try{const state=await rpc('fieldmaps_signup_status');if(ticket!==sequence||getUser()?.id!==user.id)return false;preferences=state;if(state.complete){checkedUser=user.id;return true;}
   d=frame('Your DrillOps account','');d.dataset.onboarding=user.id;
   const m=user.user_metadata||{};
   d.querySelector('form').innerHTML=`${accountBrand}<div class="dialog-heading"><div><h2 id="signup-consent-title">Your DrillOps account</h2><p class="signup-subtitle">A few details to get started.</p></div></div><label>Full name<input name="name" required maxlength="120" autocomplete="name" value="${esc(m.full_name||m.name||'')}"></label><label>Email<input type="email" name="email" readonly value="${esc(user.email||'')}"></label><label>Phone number<input name="phone" type="tel" required maxlength="50" autocomplete="tel" value="${esc(m.contact_phone||'')}"></label><p class="signup-notice">Your details are used for account support and service updates. <a href="/privacy.html" target="_blank" rel="noopener">Privacy policy</a></p><label class="consent-option"><input name="terms" type="checkbox" required><span>I agree to the <a href="/fieldmaps-terms.html" target="_blank" rel="noopener">Terms of Service</a>.</span></label><label class="consent-option"><input name="marketing" type="checkbox"><span>${MARKETING_LABEL}</span></label><p data-status role="status"></p><div class="dialog-actions"><button type="button" data-exit class="secondary">Sign out</button><button type="submit" class="primary">Continue</button></div>`;
   d.querySelector('[data-exit]').onclick=()=>void onSignOut();const form=d.querySelector('form');form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity()||getUser()?.id!==user.id)return;const f=form.elements;if(!validPhone(f.phone.value)){f.phone.setCustomValidity('Enter a valid phone number.');f.phone.reportValidity();return;}const submit=d.querySelector('[type=submit]');submit.disabled=true;try{preferences=await rpc('complete_fieldmaps_signup',{p_name:f.name.value.trim(),p_phone:f.phone.value.trim(),p_terms_version:f.terms.checked?TERMS_VERSION:null,p_marketing:f.marketing.checked});if(getUser()?.id!==user.id)return;user.user_metadata={...user.user_metadata,full_name:f.name.value.trim(),contact_phone:f.phone.value.trim(),marketing_opt_in:f.marketing.checked};checkedUser=user.id;close();onSaved(user);}catch(error){d.querySelector('[data-status]').textContent=error.message;}finally{submit.disabled=false;}};form.elements.phone.oninput=()=>form.elements.phone.setCustomValidity('');return false;
  }catch(error){if(ticket!==sequence||getUser()?.id!==user.id)return false;d=frame('Could not check your account','');d.dataset.onboarding=user.id;d.querySelector('[data-status]').textContent=error.message||'Could not check your account.';const retry=d.querySelector('[type=submit]');retry.hidden=false;retry.textContent='Retry';d.querySelector('form').onsubmit=e=>{e.preventDefault();delete d.dataset.onboarding;void check(getUser());};return false;}
 }
 async function openSettings(){const user=getUser();if(!user)return;const state=await rpc('fieldmaps_signup_status');if(getUser()?.id!==user.id)return;if(!state.complete){checkedUser=null;return check(user);}preferences=state;
  const d=frame('Workspace settings',`<label class="consent-option"><input name="enabled" type="checkbox" ${state.marketing_enabled?'checked':''}><span>Marketing communications</span></label><p class="signup-notice">Off stops marketing for your workspace. Account and service messages still arrive.</p><label class="consent-option"><input name="marketing" type="checkbox" ${state.marketing_opt_in?'checked':''}><span>${MARKETING_LABEL}</span></label><p class="signup-notice"><a href="/fieldmaps-terms.html" target="_blank" rel="noopener">Terms of Service</a> · <a href="/privacy.html" target="_blank" rel="noopener">Privacy policy</a></p>`);d.querySelector('[data-exit]').textContent='Cancel';d.querySelector('[data-exit]').onclick=close;d.addEventListener('cancel',close);d.querySelector('[type=submit]').textContent='Save';const form=d.querySelector('form');form.onsubmit=async e=>{e.preventDefault();if(getUser()?.id!==user.id)return close();const button=d.querySelector('[type=submit]');button.disabled=true;try{preferences=await rpc('set_fieldmaps_marketing',{p_opt_in:form.elements.marketing.checked,p_enabled:form.elements.enabled.checked});user.user_metadata={...user.user_metadata,marketing_opt_in:preferences.marketing_opt_in,marketing_enabled:preferences.marketing_enabled};onSaved(user);close();}catch(error){d.querySelector('[data-status]').textContent=error.message;}finally{button.disabled=false;}};
 }
 return {check,openSettings,reset(){sequence++;pending=null;checkedUser=null;preferences=null;close();}};
}
