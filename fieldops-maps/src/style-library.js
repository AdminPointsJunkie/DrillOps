import {labelFields} from './label-style.js';
import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {attributeFields,attributeEvaluator} from './attribute-style.js';
export function styleSnapshot(layer){const style=structuredClone(layer.metadata?.style||{});delete style.view;delete style.popup;return {color:layer.color,opacity:layer.opacity??.85,style};}
export function validateStyleTarget(snapshot,layer){
 const fields=attributeFields(layer.fc),s=snapshot.style||{};
 for(const field of labelFields({metadata:{style:s}}))if(!fields.includes(field))throw Error(layer.name+': missing label column '+field);
 if(s.rules?.field&&!fields.includes(s.rules.field))throw Error(layer.name+': missing styling column '+s.rules.field);
 attributeEvaluator(s.rules,fields);
}
export async function openStyleLibrary(layer,{db,workspace,getLayers,canEdit,apply}){
 let snapshot=styleSnapshot(layer);const {data,error}=await db.from('map_style_presets').select('*').eq('workspace_id',workspace).order('created_at');if(error)throw error;
 const presets=data||[],targets=getLayers().filter(l=>l.kind==='vector'&&!l.metadata?.annotation&&canEdit(l));
 const d=toolDialog('Presets & bulk styling',`<p>Copy ${esc(layer.name)}’s presentation or choose a shared workspace preset. Filters and popup settings stay specific to each layer.</p><label>Style<select name="preset"><option value="">Current layer style</option>${presets.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><label>Save current layer as preset<input name="presetName" maxlength="100" placeholder="e.g. Boreholes — status"></label><button type="button" data-save>▧ Save workspace preset</button><p data-status aria-live="polite"></p><label><input type="checkbox" data-all> Select all layers</label><div class="bulk-style-layers">${targets.map(l=>`<label><input type="checkbox" name="target" value="${esc(l.id)}" ${l.id===layer.id?'checked':''}>${esc(l.name)}</label>`).join('')}</div><p>Layers using a missing column cannot receive this style. Save and Sync remain separate.</p>`),q=s=>d.querySelector(s);
 q('[type=submit]').textContent='Apply to selected layers';q('[name=preset]').onchange=()=>snapshot=structuredClone(presets.find(p=>p.id===q('[name=preset]').value)?.style||styleSnapshot(layer));
 q('[data-all]').onchange=e=>d.querySelectorAll('[name=target]').forEach(c=>c.checked=e.target.checked);
 q('[data-save]').onclick=async()=>{const name=q('[name=presetName]').value.trim();if(!name)return q('.error').textContent='Enter a preset name.';q('[data-save]').disabled=true;try{if(!canEdit(layer))throw Error('Project access changed');const {data,error}=await db.from('map_style_presets').insert({workspace_id:workspace,name,style:styleSnapshot(layer)}).select('*').single();if(error)throw error;presets.push(data);const o=document.createElement('option');o.value=data.id;o.textContent=data.name;q('[name=preset]').append(o);q('[data-status]').textContent='Preset saved for this workspace.';}catch(e){q('.error').textContent=e.message;}finally{q('[data-save]').disabled=false;}};
 q('form').onsubmit=async e=>{e.preventDefault();q('.error').textContent='';const b=q('[type=submit]');b.disabled=true;try{const chosen=[...d.querySelectorAll('[name=target]:checked')].map(c=>getLayers().find(l=>l.id===c.value));if(!chosen.length||chosen.some(l=>!l||!canEdit(l)))throw Error('Select editable layers in the current project.');chosen.forEach(l=>validateStyleTarget(snapshot,l));await apply(chosen,snapshot);d.close();}catch(e){q('.error').textContent=e.message;}finally{b.disabled=false;}};return d;
}
