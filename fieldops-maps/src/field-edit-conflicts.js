const copy=v=>v===undefined?undefined:structuredClone(v);
const canonical=v=>v===undefined?'undefined':JSON.stringify(v,(_k,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const equal=(a,b)=>canonical(a)===canonical(b);
export function mergeFeatureSnapshots(base,local,remote){
 const conflicts=[],result=[];
 const known=new Set(base.map(f=>String(f.id)));
 const b=new Map(base.map(f=>[String(f.id),f])),r=new Map(remote.map(f=>[String(f.id),f]));
 const l=new Map();local.forEach((f,i)=>l.set(f.id!==undefined&&known.has(String(f.id))?String(f.id):`new:${i}`,f));
 for(const id of new Set([...b.keys(),...r.keys(),...l.keys()])){
  const before=b.get(id),mine=l.get(id),theirs=r.get(id);
  const slot={feature:undefined};result.push(slot);
  if(equal(mine,before)){slot.feature=copy(theirs);continue;}
  if(equal(theirs,before)||equal(mine,theirs)){slot.feature=copy(mine);continue;}
  const label=mine?.properties?.name||theirs?.properties?.name||`Feature ${id}`;
  if(!before||!mine||!theirs){
   slot.feature=copy(theirs);conflicts.push({label,field:'Feature deleted or replaced',base:before,local:mine,remote:theirs,choose:side=>slot.feature=copy(side==='local'?mine:theirs)});continue;
  }
  slot.feature=copy(theirs);slot.feature.properties??={};
  for(const key of new Set([...Object.keys(before.properties||{}),...Object.keys(mine.properties||{})])){
   const a=before.properties?.[key],x=mine.properties?.[key],y=theirs.properties?.[key];if(equal(x,a))continue;
   const assign=value=>{if(value===undefined)delete slot.feature.properties[key];else slot.feature.properties[key]=copy(value);};
   if(!equal(y,a)&&!equal(x,y))conflicts.push({label,field:key,base:a,local:x,remote:y,choose:side=>assign(side==='local'?x:y)});else assign(x);
  }
  if(!equal(mine.geometry,before.geometry)){
   if(!equal(theirs.geometry,before.geometry)&&!equal(mine.geometry,theirs.geometry))conflicts.push({label,field:'Geometry',base:before.geometry,local:mine.geometry,remote:theirs.geometry,choose:side=>slot.feature.geometry=copy(side==='local'?mine.geometry:theirs.geometry)});
   else slot.feature.geometry=copy(mine.geometry);
  }
 }
 return {conflicts,features:()=>result.map(v=>v.feature).filter(Boolean)};
}
export function resolveEditConflicts(conflicts,doc=document){
 if(!conflicts.length)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const dialog=doc.createElement('dialog');dialog.className='field-edit-conflicts';
  const title=doc.createElement('h2');title.textContent='Review changes from another device';dialog.append(title);
  const intro=doc.createElement('p');intro.textContent='Independent changes have been merged. Choose which version to keep for each clash. Nothing is saved until you confirm.';dialog.append(intro);
  const choices=[];
  for(const conflict of conflicts){
   const section=doc.createElement('section'),heading=doc.createElement('h3');heading.textContent=`${conflict.label} · ${conflict.field}`;section.append(heading);
   for(const [name,value] of [['Original',conflict.base],['Your edit',conflict.local],['FieldMaps now',conflict.remote]]){
    const details=doc.createElement('details'),summary=doc.createElement('summary'),pre=doc.createElement('pre');summary.textContent=name;pre.textContent=value===undefined?'Deleted / not present':typeof value==='string'?value:JSON.stringify(value,null,2);details.append(summary,pre);section.append(details);
   }
   const label=doc.createElement('label');label.textContent='Keep ';const select=doc.createElement('select');
   for(const [value,text] of [['remote','FieldMaps version'],['local','My edit']]){const option=doc.createElement('option');option.value=value;option.textContent=text;select.append(option);}label.append(select);section.append(label);choices.push([conflict,select]);dialog.append(section);
  }
  const actions=doc.createElement('div');actions.className='workspace-actions';const cancel=doc.createElement('button');cancel.textContent='Cancel · keep edits unsaved';const save=doc.createElement('button');save.textContent='Save resolved edits';save.className='primary';actions.append(cancel,save);dialog.append(actions);
  const close=()=>{dialog.close();dialog.remove();};
  const cancelled=()=>{close();reject(Error('Save cancelled. Your edits are still available in the editor.'));};
  cancel.onclick=cancelled;dialog.oncancel=e=>{e.preventDefault();cancelled();};
  save.onclick=()=>{for(const [conflict,select] of choices)conflict.choose(select.value);close();resolve();};
  doc.body.append(dialog);dialog.showModal();
 });
}
