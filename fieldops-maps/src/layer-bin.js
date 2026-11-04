const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=paths=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const restoreIcon=icon('<path d="M3 10a9 9 0 1 1 2 9M3 4v6h6"/>');
const deleteIcon=icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>');
const button=(attribute,label,svg)=>`<button type="button" class="bin-icon" ${attribute} title="${label}" aria-label="${label}">${svg}</button>`;
export function installLayerBin({db,doc=document,getWorkspace,getProjects,canOpen,onChanged,local=false}){
 const dialog=doc.createElement('dialog');dialog.className='layer-bin';dialog.setAttribute('aria-label','Recently deleted');doc.body.append(dialog);
 let working=false,workspace,rows=[];const selected=new Set(),destinations=new Map();
 const request=async(action,id=null,target=null)=>{const {data,error}=await db.rpc('maps_layer_bin',{p_workspace:workspace,p_action:action,p_layer:id,p_target:target});if(error)throw error;return data;};
 function controls(){
  const eligible=rows.filter(r=>r.can_change),count=eligible.filter(r=>selected.has(r.id)).length,all=dialog.querySelector('[data-select-all]');
  all.checked=eligible.length>0&&count===eligible.length;all.indeterminate=count>0&&count<eligible.length;all.disabled=working||!eligible.length;
  dialog.querySelector('[data-selected-count]').textContent=`${count} selected`;
  dialog.querySelector('[data-close]').disabled=working;
  dialog.querySelectorAll('[data-bulk]').forEach(b=>b.disabled=working||!count);
  for(const row of rows){const el=dialog.querySelector(`[data-item="${row.id}"]`);el.querySelectorAll('input,select,button').forEach(e=>e.disabled=working||!row.can_change);el.querySelector('[data-select]').checked=selected.has(row.id);}
 }
 async function render(){
  rows=await request('list');const projects=getProjects();for(const id of selected)if(!rows.some(r=>r.id===id&&r.can_change))selected.delete(id);
  dialog.innerHTML=`<div class="bin-sticky"><div class="dialog-heading"><h2>Recently deleted</h2>${button('data-close','Close recently deleted',icon('<path d="m6 6 12 12M18 6 6 18"/>'))}</div><div class="bin-toolbar"><label class="bin-select-all"><input type="checkbox" data-select-all> Select all</label><span data-selected-count role="status"></span><div class="bin-bulk-actions">${button('data-bulk="restore"','Restore selected layers',restoreIcon)}${button('data-bulk="purge"','Permanently delete selected layers',deleteIcon)}</div></div><p data-message role="status" aria-live="polite"></p></div><p class="bin-help">Items are kept for 30 days. Select layers to restore or permanently delete. Choose a destination beside each layer to restore it to another project.</p><div data-items>`+rows.map(item=>`<section class="bin-item" data-item="${escapeHTML(item.id)}"><input type="checkbox" data-select="${escapeHTML(item.id)}" aria-label="Select ${escapeHTML(item.name)}"><div class="bin-item-content"><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.project)} · Deleted ${escapeHTML(new Date(item.deleted_at).toLocaleDateString())} · Expires ${escapeHTML(new Date(item.expires_at).toLocaleDateString())}</small><div class="bin-row-actions"><select aria-label="Restore ${escapeHTML(item.name)} to project" data-target="${escapeHTML(item.id)}">${projects.map(p=>`<option value="${escapeHTML(p.id)}" ${p.id===(destinations.get(item.id)||item.map_id)?'selected':''}>${escapeHTML(p.name)}</option>`).join('')}</select>${button(`data-restore="${escapeHTML(item.id)}"`,'Restore layer',restoreIcon)}${button(`data-purge="${escapeHTML(item.id)}"`,'Permanently delete layer',deleteIcon)}</div></div></section>`).join('')+'</div>'+(rows.length?'':'<p>The basket is empty.</p>');
  dialog.querySelector('[data-close]').onclick=()=>{if(!working)dialog.close();};
  dialog.querySelector('[data-select-all]').onchange=e=>{for(const row of rows.filter(r=>r.can_change)){if(e.target.checked)selected.add(row.id);else selected.delete(row.id);}controls();};
  dialog.querySelectorAll('[data-select]').forEach(box=>box.onchange=()=>{if(box.checked)selected.add(box.dataset.select);else selected.delete(box.dataset.select);controls();});
  dialog.querySelectorAll('[data-bulk]').forEach(b=>b.onclick=()=>act(b.dataset.bulk,[...selected]));
  dialog.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>act('restore',[b.dataset.restore]));
  dialog.querySelectorAll('[data-purge]').forEach(b=>b.onclick=()=>act('purge',[b.dataset.purge]));
  controls();
 }
 async function act(action,ids){
  if(working||!canOpen())return;if(!local&&getWorkspace()?.id!==workspace){dialog.close();return;}
  const items=rows.filter(r=>ids.includes(r.id)&&r.can_change).map(r=>({...r,target:dialog.querySelector(`[data-target="${r.id}"]`).value}));if(!items.length)return;
  if(action==='purge'&&!doc.defaultView.confirm(`Permanently delete ${items.length===1?'“'+items[0].name+'”':items.length+' selected layers'}? This cannot be undone.`))return;
  for(const item of items)destinations.set(item.id,item.target);
  working=true;controls();let completed=0;const errors=[],changed=new Map();
  try{
   for(const item of items){
    if(!local&&getWorkspace()?.id!==workspace){errors.push('Workspace changed. Remaining items were not processed.');break;}
    dialog.querySelector('[data-message]').textContent=`${action==='restore'?'Restoring':'Deleting'} ${completed+1} of ${items.length}…`;
    try{const result=await request(action,item.id,action==='restore'?item.target:null);selected.delete(item.id);completed++;if(action==='restore')changed.set(result.map_id,result);}
    catch(e){selected.add(item.id);errors.push(item.name+': '+(e.message||String(e)));}
   }
   for(const result of changed.values()){try{await onChanged(result,action);}catch(e){errors.push('Items restored, but the project view could not refresh: '+e.message);}}
   await render();dialog.querySelector('[data-message]').textContent=`${completed} ${completed===1?'layer':'layers'} ${action==='restore'?'restored. Use SYNC to publish.':'permanently deleted.'}`+(errors.length?' '+errors.join(' '):'');
  }catch(e){dialog.querySelector('[data-message]').textContent=e.message||String(e);}
  finally{working=false;controls();}
 }
 dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
 return {async open(){if(!canOpen())return;workspace=getWorkspace()?.id;if(!workspace&&!local)return;selected.clear();destinations.clear();dialog.innerHTML='<p>Loading recently deleted…</p>';dialog.showModal();try{await render();dialog.scrollTop=0;}catch(e){dialog.innerHTML='<p role="alert"></p><button type="button">Close</button>';dialog.querySelector('p').textContent=e.message;dialog.querySelector('button').onclick=()=>dialog.close();}},close(){if(dialog.open)dialog.close();}};
}
