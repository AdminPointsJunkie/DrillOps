import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
export async function mountSharing(container,{db,kind,target,onChanged=()=>{}}){
 const call=async(action,extra={})=>{const r=await db.rpc('share_access',{p_kind:kind,p_target:target,p_action:action,...extra});if(r.error)throw r.error;return r.data||[];};
 let people=await call('list'),working=false;
 function render(){container.innerHTML=`<h3>${kind==='project'?'Project members':'Share this map'}</h3>${kind==='project'?'<p>Access to all maps in this project.</p>':''}<label>Email<input data-share-email type="email" placeholder="name@example.com"></label>${kind==='project'?'<label>Access<select data-share-role><option value="operator">View published maps</option><option value="editor">Edit maps</option></select></label>':''}<button type="button" data-share-add>Share ${kind}</button><p data-share-status role="status"></p><div>${people.map(p=>`<div class="share-person"><span>${esc(p.email)} · ${p.role==='operator'?'View only':esc(p.role)}${p.status==='suspended'?' · Suspended':''}</span>${['owner','admin'].includes(p.role)?'':`<button type="button" data-share-remove="${esc(p.id)}">Remove access</button>`}</div>`).join('')}</div>`;
 container.querySelector('[data-share-add]').onclick=()=>act('grant',{p_email:container.querySelector('[data-share-email]').value.trim(),p_role:container.querySelector('[data-share-role]')?.value||'operator'});
 container.querySelectorAll('[data-share-remove]').forEach(b=>b.onclick=()=>act('revoke',{p_recipient:b.dataset.shareRemove}));}
 async function act(action,extra){if(working)return;working=true;container.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);try{people=await call(action,extra);render();container.querySelector('[data-share-status]').textContent='Access updated.';await onChanged();}catch(e){container.querySelector('[data-share-status]').textContent=e.message;}finally{working=false;container.querySelectorAll('button,input,select').forEach(e=>e.disabled=false);}}
 render();
}
export async function openProjectSharing({db,project,onChanged}){
 const d=toolDialog('Share project · '+project.name,'<section data-sharing></section>');d.querySelector('[type=submit]').remove();d.querySelector('form').onsubmit=e=>e.preventDefault();
 try{await mountSharing(d.querySelector('[data-sharing]'),{db,kind:'project',target:project.id,onChanged});}catch(e){d.querySelector('.error').textContent=e.message;}return d;
}
export function createProjectDialog({db,onCreated}){
 const d=toolDialog('New project','<label>Project name<input name="name" required maxlength="120" autofocus></label>');d.querySelector('[type=submit]').textContent='Create project';
 d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=d.querySelector('[type=submit]');b.disabled=true;try{const r=await db.rpc('create_personal_project',{p_name:d.querySelector('[name=name]').value.trim()});if(r.error)throw r.error;d.close();await onCreated(r.data);}catch(e){d.querySelector('.error').textContent=e.message;}finally{b.disabled=false;}};return d;
}
