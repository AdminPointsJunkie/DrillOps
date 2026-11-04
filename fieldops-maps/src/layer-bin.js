const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installLayerBin({db,doc=document,getWorkspace,getProjects,canOpen,isAdmin,onChanged,local=false}){
 const dialog=doc.createElement('dialog');dialog.className='layer-bin';doc.body.append(dialog);let working=false,workspace;
 const request=async(action,id=null,target=null)=>{const {data,error}=await db.rpc('maps_layer_bin',{p_workspace:workspace,p_action:action,p_layer:id,p_target:target});if(error)throw error;return data;};
 async function render(){
  const rows=await request('list'),projects=getProjects();
  dialog.innerHTML='<div class="dialog-heading"><h2>Recently deleted</h2><button type="button" data-close aria-label="Close recently deleted">×</button></div><p>Removed layers stay here for 30 days. Restore them to their original project or another project in this workspace. Use Sync to publish the restored project.</p><p data-message role="status"></p><div data-items>'+rows.map(item=>`<section class="bin-item"><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.project)} · Deleted ${escapeHTML(new Date(item.deleted_at).toLocaleDateString())} · Expires ${escapeHTML(new Date(item.expires_at).toLocaleDateString())}</small><div><select aria-label="Restore ${escapeHTML(item.name)} to project" data-target="${escapeHTML(item.id)}" ${item.can_change?'':'disabled'}>${projects.map(p=>`<option value="${escapeHTML(p.id)}" ${p.id===item.map_id?'selected':''}>${escapeHTML(p.name)}</option>`).join('')}</select><button type="button" data-restore="${escapeHTML(item.id)}" ${item.can_change?'':'disabled'}>Restore</button><button type="button" data-purge="${escapeHTML(item.id)}" ${item.can_change?'':'disabled'}>Delete permanently</button></div></section>`).join('')+'</div>'+(rows.length?'':'<p>The basket is empty.</p>')+`<footer><button type="button" data-empty ${!rows.length||!isAdmin()?'disabled':''}>Empty basket</button></footer>`;
  dialog.querySelector('[data-close]').onclick=()=>{if(!working)dialog.close();};
  const act=async(action,id,target)=>{
   if(working||!canOpen())return;
   if(!local&&getWorkspace()?.id!==workspace){dialog.close();return;}
   if(action!=='restore'&&!doc.defaultView.confirm(action==='empty'?'Permanently delete all items in this workspace’s basket? This cannot be undone.':'Permanently delete this layer? This cannot be undone.'))return;
   working=true;dialog.querySelectorAll('button,select').forEach(e=>e.disabled=true);
   try{const result=await request(action,id,target);await onChanged(result,action);await render();}
   catch(e){dialog.querySelector('[data-message]').textContent=e.message||String(e);}
   finally{working=false;dialog.querySelector('[data-close]').disabled=false;dialog.querySelectorAll('[data-restore],[data-purge],[data-target]').forEach(e=>{const id=e.dataset.restore||e.dataset.purge||e.dataset.target;e.disabled=!rows.find(r=>r.id===id)?.can_change;});dialog.querySelector('[data-empty]').disabled=!isAdmin()||!dialog.querySelector('.bin-item');}
  };
  dialog.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>act('restore',b.dataset.restore,dialog.querySelector(`[data-target="${b.dataset.restore}"]`).value));
  dialog.querySelectorAll('[data-purge]').forEach(b=>b.onclick=()=>act('purge',b.dataset.purge));
  dialog.querySelector('[data-empty]').onclick=()=>act('empty');
 }
 dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
 return {async open(){if(!canOpen())return;workspace=getWorkspace()?.id;if(!workspace&&!local)return;dialog.innerHTML='<p>Loading recently deleted…</p>';dialog.showModal();try{await render();}catch(e){dialog.innerHTML='<p data-message role="alert"></p><button type="button">Close</button>';dialog.querySelector('p').textContent=e.message;dialog.querySelector('button').onclick=()=>dialog.close();}},close(){if(dialog.open)dialog.close();}};
}
