import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {dataLibrary,loadLibrary} from './public-data.js';
export function openDataLibrary({canCreate,getScope,onResult}){
 if(!canCreate())return;const scope=getScope(),abort=new AbortController();let closed=false;
 const d=toolDialog('Data library',`<p>Free reference layers. Add a layer, then change its colours, labels and geometry like any imported layer.</p><label>Find a dataset<input type="search" data-search placeholder="Countries, rivers, grid…"></label><div data-catalog></div><p>Natural Earth boundaries are generalised reference data, not survey or cadastral boundaries. <a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer">Source and public-domain licence</a></p>`);d.querySelector('[type=submit]').hidden=true;
 function draw(){const text=d.querySelector('[data-search]').value.toLowerCase();const items=dataLibrary.filter(x=>(x.name+' '+x.description).toLowerCase().includes(text));d.querySelector('[data-catalog]').innerHTML=items.map(x=>`<p><strong>${esc(x.name)}</strong><br><small>${esc(x.description)}</small><br><button type="button" data-add="${x.id}">Add ${esc(x.name)}</button></p>`).join('')||'<p>No matching datasets.</p>';}
 d.querySelector('[data-search]').oninput=draw;
 d.querySelector('[data-catalog]').onclick=async e=>{const button=e.target.closest('[data-add]');if(!button)return;const item=dataLibrary.find(x=>x.id===button.dataset.add);d.inert=true;d.querySelector('.error').textContent='';try{const fc=await loadLibrary(item.id,{signal:abort.signal});if(closed)return;if(scope!==getScope()||!canCreate())throw Error('The project changed. Reopen the library.');await onResult(fc,item.name,{metadata:{reference:{...item},style:{fillOpacity:.12}}});d.close();}catch(error){if(!closed)d.querySelector('.error').textContent=error.message;}finally{d.inert=false;}};
 d.addEventListener('close',()=>{closed=true;abort.abort();});draw();return d;
}
