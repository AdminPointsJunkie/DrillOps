export function invitationEmails(value){
 const emails=[...new Set(value.split(/[,;\s]+/).map(v=>v.trim().toLowerCase()).filter(Boolean))];
 if(!emails.length)throw Error('Enter at least one email address.');
 if(emails.length>25)throw Error('Invite up to 25 people at a time.');
 const invalid=emails.filter(v=>v.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
 if(invalid.length)throw Error('Check these email addresses: '+invalid.join(', '));
 return emails;
}
export function openInviteDialog({doc=document,name,roleOptions,projectChecks,create,send,onChanged}){
 const dialog=doc.createElement('dialog');dialog.className='invite-dialog';dialog.setAttribute('aria-labelledby','invite-heading');
 dialog.innerHTML='<form><header><h2 id="invite-heading"></h2><button type="button" data-close aria-label="Close invitations">×</button></header><p>Add email addresses separated by commas. Invitations expire after 7 days.</p><div class="invite-fields"><label>Emails<textarea name="emails" rows="2" required placeholder="alex@example.com, sam@example.com"></textarea></label><label>Role<select name="role">'+roleOptions+'</select></label></div><p data-role-help></p><details data-projects><summary>Assign projects</summary>'+projectChecks+'</details><p data-result role="status" aria-live="polite"></p><footer><button type="button" data-close>Cancel</button><button class="primary" type="submit">Send invitations</button></footer></form>';
 dialog.querySelector('h2').textContent='Invite members to '+name;doc.body.append(dialog);
 const form=dialog.querySelector('form'),result=dialog.querySelector('[data-result]');let busy=false,attempted=false;
 const close=()=>{if(!busy)dialog.close();};dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);
 dialog.oncancel=e=>{if(busy)e.preventDefault();};dialog.onclose=()=>{dialog.remove();if(attempted)onChanged();};
 function role(){const limited=['operator','editor'].includes(form.elements.role.value);dialog.querySelector('[data-projects]').hidden=!limited;dialog.querySelector('[data-role-help]').textContent=limited?'Access applies to assigned projects. Operators can view published maps; editors can edit.':'This role can manage the workspace and all its projects.';}form.elements.role.onchange=role;role();
 form.onsubmit=async e=>{e.preventDefault();if(busy)return;let emails;try{emails=invitationEmails(form.elements.emails.value);}catch(e){result.textContent=e.message;return;}
  const role=form.elements.role.value,projects=['editor','operator'].includes(role)?[...form.querySelectorAll('[name=project]:checked')].map(e=>e.value):[];
  busy=true;attempted=true;form.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);const messages=[];
  for(const email of emails){result.textContent='Sending invitation to '+email+'…';let created=false;try{const invitation=await create({email,name:'',role,projects});created=true;await send(invitation.id);messages.push(email+': sent.');}catch(error){messages.push(email+': '+(created?'Created, but email delivery failed. Use Resend in Invitations. ':'Not confirmed. Check Invitations before retrying. ')+(error.message||String(error)));}}
  result.textContent=messages.join('\n');form.elements.emails.value='';busy=false;form.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=false);dialog.querySelector('footer [data-close]').textContent='Done';
 };dialog.showModal();form.elements.emails.focus();return dialog;
}
