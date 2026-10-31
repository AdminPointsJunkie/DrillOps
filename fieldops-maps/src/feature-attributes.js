import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
export function editFeatureAttributes(features,onApply){
 const fields=[...new Set(features.flatMap(f=>Object.keys(f.properties||{})))].filter(k=>!k.startsWith('_'));
 const d=toolDialog(features.length===1?'Feature attributes':`Attributes · ${features.length} selected`, '<p>Change a value to apply it to the selected features. Unchanged fields are kept.</p><div data-fields></div><button type="button" data-add>Add attribute</button>'),q=s=>d.querySelector(s);
 const changes=new Map();
 function addRow(name,value,mixed=false){
  const row=document.createElement('label');row.innerHTML=`<span>${esc(name)}</span><input aria-label="${esc(name)}" placeholder="${mixed?'Mixed values':''}">`;
  const input=row.querySelector('input');input.value=mixed?'':String(value??'');
  const type=typeof value;
  if(value!==null&&type==='object'){input.value='Structured value (kept unchanged)';input.disabled=true;}
  else input.oninput=()=>{let next=input.value;if(type==='number'){if(next.trim()===''||!Number.isFinite(Number(next))){input.setCustomValidity('Enter a number.');return;}next=Number(next);}else if(type==='boolean'){if(!['true','false'].includes(next.toLowerCase())){input.setCustomValidity('Enter true or false.');return;}next=next.toLowerCase()==='true';}input.setCustomValidity('');changes.set(name,next);};
  q('[data-fields]').append(row);
 }
 for(const field of fields){const value=features[0]?.properties?.[field],mixed=features.some(f=>JSON.stringify(f.properties?.[field])!==JSON.stringify(value));addRow(field,value,mixed);}
 q('[data-add]').onclick=()=>{const label=document.createElement('label');label.innerHTML='<span>New attribute name</span><input maxlength="120"><button type="button">Add</button>';q('[data-fields]').append(label);label.querySelector('button').onclick=()=>{const name=label.querySelector('input').value.trim();if(!name||name.startsWith('_')||['__proto__','prototype','constructor'].includes(name)||fields.includes(name)){q('.error').textContent='Choose a unique attribute name without a leading underscore.';return;}fields.push(name);label.remove();changes.set(name,'');addRow(name,'');};};
 q('form').onsubmit=async e=>{e.preventDefault();q('[type=submit]').disabled=true;try{await onApply(Object.fromEntries(changes));d.close();}catch(error){q('.error').textContent=error.message;}finally{q('[type=submit]').disabled=false;}};return d;
}
