import {toolDialog} from './explore-dialogs.js';
export function featureGroups(layer){const groups=new Map();for(const f of layer.fc?.features||[]){const g=f.properties?._fieldmaps_group;if(!g?.id)continue;if(!groups.has(g.id))groups.set(g.id,{...g,count:0});groups.get(g.id).count++;}return [...groups.values()];}
export function appendGroupLegend(legend,layer,{canEdit,onChange}){
 for(const group of featureGroups(layer)){
  const row=document.createElement('div');row.className='feature-group-legend';const label=document.createElement('label'),toggle=document.createElement('input'),icon=document.createElement('span'),name=document.createElement('span'),count=document.createElement('small');
  toggle.type='checkbox';toggle.checked=group.visible!==false;toggle.disabled=!canEdit;toggle.setAttribute('aria-label','Show group '+group.name);icon.textContent=group.icon||'◈';name.textContent=group.name||'Group';count.textContent=group.count;label.append(toggle,icon,name,count);row.append(label);
  toggle.onchange=async()=>{toggle.disabled=true;try{await onChange(group.id,{visible:toggle.checked});}catch(error){toggle.checked=group.visible!==false;message.textContent=error.message;}finally{toggle.disabled=!canEdit;}};
  if(canEdit){const button=document.createElement('button');button.type='button';button.textContent='Edit';button.setAttribute('aria-label','Edit group '+group.name);button.onclick=()=>{
   const d=toolDialog('Group legend','<label>Name<input name="name" required maxlength="100"></label><label>Icon or emoji<input name="icon" maxlength="16" placeholder="◈"></label><p>The name and icon apply to this group across all its layers.</p>');d.querySelector('[name=name]').value=group.name||'Group';d.querySelector('[name=icon]').value=group.icon||'◈';
   d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=d.querySelector('[type=submit]');b.disabled=true;try{const name=d.querySelector('[name=name]').value.trim();if(!name)throw Error('Enter a group name.');await onChange(group.id,{name,icon:d.querySelector('[name=icon]').value.trim()||'◈'});d.close();}catch(error){d.querySelector('.error').textContent=error.message;}finally{b.disabled=false;}};
  };row.append(button);}
  const message=document.createElement('small');message.className='error';message.setAttribute('role','alert');row.append(message);legend.append(row);
 }
}
