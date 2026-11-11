import {mountSharing} from './project-sharing.js';
import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
export async function openShareMap({db,project,canEdit,local}){
 if(local)throw Error('Save this map to your cloud workspace before sharing.');if(!project?.id||!canEdit())throw Error('Open an editable saved map first.');
 const {data,error}=await db.from('map_view_links').select('*').eq('map_id',project.id).maybeSingle();if(error)throw error;let share=data;
 const url=()=>share?.enabled?`${location.origin}/maps/share.html#${share.token}`:'';
 const d=toolDialog('Share · '+project.name,`<section data-map-sharing></section><h3>Viewing link</h3><label><input type="checkbox" name="enabled" ${share?.enabled?'checked':''}> Anyone with the link can view</label><small>View only · last synced version</small><div class="share-link-row"><input name="url" aria-label="Viewing link" readonly value="${esc(url())}" placeholder="Enable sharing to create a link"><button type="button" data-copy ${share?.enabled?'':'disabled'}>Copy link</button></div><p data-status aria-live="polite"></p>`),q=s=>d.querySelector(s);
 d.classList.add('compact-share');
 try{await mountSharing(q('[data-map-sharing]'),{db,kind:'map',target:project.id});}catch(e){q('[data-map-sharing]').textContent=e.message;}
 q('[type=submit]').textContent='Save';q('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(q('[name=url]').value);q('[data-status]').textContent='Link copied.';}catch{q('[name=url]').select();q('[data-status]').textContent='Select and copy this link.';}};
 q('form').onsubmit=async e=>{e.preventDefault();const button=q('[type=submit]');button.disabled=true;try{if(!canEdit())throw Error('Map access changed');const enabled=q('[name=enabled]').checked;
  const response=share?await db.from('map_view_links').update({enabled}).eq('map_id',project.id).select('*').single():await db.from('map_view_links').insert({map_id:project.id,enabled}).select('*').single();if(response.error)throw response.error;share=response.data;q('[name=url]').value=url();q('[data-copy]').disabled=!enabled;q('[data-status]').textContent=enabled?'Sharing on.':'Sharing is off.';
 }catch(e){q('.error').textContent=e.message;}finally{button.disabled=false;}};return d;
}
