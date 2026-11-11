import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {isLocalGeoTIFF} from './data-policy.js';
export async function addLayerToLibrary({layer,library,getScope,canSave,notify=()=>{}}){
 const scope=getScope(),valid=()=>{if(scope!==getScope()||!canSave())throw Error('Layer access changed. Reopen Add to library.');};valid();
 if(isLocalGeoTIFF(layer))throw Error('Local-only imagery cannot be added to the library.');
 const visibility=await library.defaultVisibility();valid();
 const d=toolDialog('Add to library',`<label>Name<input name="name" maxlength="160" required value="${esc(layer.name)}"></label><label>Access<select name="visibility"><option value="project">Shared with project</option><option value="private">Only me</option></select></label><label>Category<input name="category" maxlength="60" value="General"></label><small>Saves a copy. Linked attachments are not included.</small>`),q=s=>d.querySelector(s);q('[name=visibility]').value=visibility;q('[type=submit]').textContent='Add to library';
 q('form').onsubmit=async e=>{e.preventDefault();const b=q('[type=submit]');b.disabled=true;try{valid();if(layer._load)await layer._load();valid();await library.save(layer,Object.fromEntries(new FormData(e.target)));d.close();notify('Layer added to library.');}catch(error){q('.error').textContent=error.message;}finally{b.disabled=false;}};
 return d;
}
