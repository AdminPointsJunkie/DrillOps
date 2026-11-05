import {escapeHTML as esc,toolDialog} from './explore-dialogs.js';
export const marketingLabel='Email me product news, updates and special offers.';
export function profileData(user,fields,now=new Date().toISOString()){
 const old=user.user_metadata||{},opted=fields.marketing===true;
 return {full_name:fields.name.trim(),contact_phone:fields.phone.trim(),job_title:fields.title.trim(),marketing_opt_in:opted,...(old.marketing_opt_in!==opted?{marketing_preference_updated_at:now,marketing_consent_text:marketingLabel,marketing_consent_source:'account-settings'}:{})};
}
export async function saveProfile(db,user,fields,{photo,removePhoto=false}={}){
 const bucket=db.storage.from('profile-photos'),old=user.user_metadata?.avatar_path;
 let uploaded;
 try{
  const data=profileData(user,fields);
  if(photo){uploaded=`${user.id}/${crypto.randomUUID()}.jpg`;const r=await bucket.upload(uploaded,photo,{contentType:'image/jpeg',upsert:false});if(r.error)throw r.error;data.avatar_path=uploaded;}
  else if(removePhoto){data.avatar_path=null;data.avatar_url=null;}
  const current=await db.auth.getUser();if(current.error||current.data.user?.id!==user.id)throw Error('Your sign-in changed. Reopen Account settings and try again.');
  const email=fields.email.trim(),changed=email.toLowerCase()!==user.email?.toLowerCase();
  const result=await db.auth.updateUser({data,...(changed?{email}:{})},{emailRedirectTo:new URL('./',location.href).href});
  if(result.error)throw result.error;
  if(old&&(uploaded||removePhoto)&&old.startsWith(user.id+'/'))await bucket.remove([old]).catch(()=>{});
  return {user:result.data.user,emailPending:!!result.data.user?.new_email};
 }catch(error){if(uploaded)await bucket.remove([uploaded]).catch(()=>{});throw error;}
}
async function resizedPhoto(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a JPG, PNG or WebP image under 5 MB.');
 const bitmap=await createImageBitmap(file);try{const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d'),side=Math.min(bitmap.width,bitmap.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,512,512);ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,512,512);return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not prepare this image.')),'image/jpeg',.85));}finally{bitmap.close();}
}
export function installAccountProfile({db,getUser,onSaved=()=>{},socialAuth}){
 let dialog;
 async function paintAvatar(el,user){
  if(!el)return;const ticket=Symbol();el._avatarTicket=ticket;const name=user?.user_metadata?.full_name||user?.email||'?';el.textContent=name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  const path=user?.user_metadata?.avatar_path;if(!path||!path.startsWith(user.id+'/'))return;
  try{const {data,error}=await db.storage.from('profile-photos').createSignedUrl(path,3600);if(error||!el.isConnected)return;const img=document.createElement('img');img.alt='Your profile photo';img.src=data.signedUrl;img.onload=()=>{if(el.isConnected&&el._avatarTicket===ticket)el.replaceChildren(img);};}catch{}
 }
 function open(){
  const user=getUser();if(!user)return;dialog?.close();const m=user.user_metadata||{};
  const d=toolDialog('Account settings',`<fieldset class="profile-fields"><div class="profile-photo-row"><span class="profile-avatar" data-avatar></span><label>Profile photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label><button type="button" data-remove>Remove photo</button></div><small>JPG, PNG or WebP · up to 5 MB. No photo? Your initials appear in a circle.</small><label>Full name<input name="full_name" required maxlength="120" autocomplete="name" value="${esc(m.full_name||m.name||'')}"></label><label>Email address<input name="email" type="email" required autocomplete="email" value="${esc(user.email||'')}"></label><small>Email changes may require confirmation using links sent to your current and new addresses.</small><label>Phone (optional)<input name="phone" type="tel" maxlength="50" autocomplete="tel" value="${esc(m.contact_phone||'')}"></label><label>Job title (optional)<input name="job_title" maxlength="120" value="${esc(m.job_title||'')}"></label><label class="profile-opt-in"><input name="marketing" type="checkbox" ${m.marketing_opt_in===true?'checked':''}><span>${marketingLabel}</span></label><small>Optional. Change this preference here at any time. Essential account and service emails will still be sent.</small></fieldset><p data-profile-status role="status"></p><section data-social-auth></section>`);
  dialog=d;d.classList.add('account-profile');const q=s=>d.querySelector(s);q('[type=submit]').textContent='Save changes';let photo,removePhoto=false,url,preparing=false;
  d.addEventListener('input',()=>{d.dataset.profileDirty='true';});d.addEventListener('change',()=>{d.dataset.profileDirty='true';});
  socialAuth?.mount(q('[data-social-auth]'),user);
  void paintAvatar(q('[data-avatar]'),user);
  q('[data-remove]').onclick=()=>{d.dataset.profileDirty='true';q('[data-avatar]')._avatarTicket=null;photo=null;removePhoto=true;q('[name=photo]').value='';q('[data-avatar]').textContent=(q('[name=full_name]').value||user.email||'?').slice(0,1).toUpperCase();};
  q('[name=photo]').onchange=async e=>{if(!e.target.files[0])return;preparing=true;q('[type=submit]').disabled=true;try{q('[data-avatar]')._avatarTicket=null;photo=await resizedPhoto(e.target.files[0]);removePhoto=false;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(photo);q('[data-avatar]').innerHTML=`<img src="${url}" alt="Selected profile photo">`;q('.error').textContent='';}catch(err){q('.error').textContent=err.message;e.target.value='';}finally{preparing=false;q('[type=submit]').disabled=false;}};
  d.addEventListener('close',()=>{if(url)URL.revokeObjectURL(url);if(dialog===d)dialog=null;});
  q('form').onsubmit=async e=>{e.preventDefault();if(preparing)return;if(getUser()?.id!==user.id){d.close();return;}q('.error').textContent='';q('[data-profile-status]').textContent='';q('fieldset').disabled=true;q('[type=submit]').disabled=true;
   try{const result=await saveProfile(db,user,{name:q('[name=full_name]').value,email:q('[name=email]').value,phone:q('[name=phone]').value,title:q('[name=job_title]').value,marketing:q('[name=marketing]').checked},{photo,removePhoto});Object.assign(user,result.user);photo=null;removePhoto=false;onSaved(result.user);d.dataset.profileDirty='false';q('[data-profile-status]').textContent=result.emailPending?'Details saved. Check your email to confirm the address change.':'Account settings saved.';}
   catch(err){q('.error').textContent=err.message||'Could not save your account. Try again.';}finally{q('fieldset').disabled=false;q('[type=submit]').disabled=false;}
  };return d;
 }
 return {open,close:()=>dialog?.close(),paintAvatar};
}
