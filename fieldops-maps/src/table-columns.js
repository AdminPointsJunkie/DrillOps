import {attributeFields} from './explore-data.js';
import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';

export function removeColumn(fc,name){
 if(!name||name.startsWith('_')||!attributeFields(fc).includes(name))throw Error('Choose an existing data column.');
 const next=structuredClone(fc);for(const feature of next.features)if(feature.properties)delete feature.properties[name];return next;
}
export function updatedFieldTypes(previous={},added={},removed=[]){const types={...previous,...added};for(const name of removed)delete types[name];return types;}
export function openDeleteColumn(layer,onApply){
 const original=layer.fc,fields=attributeFields(original).filter(f=>!f.startsWith('_'));
 const d=toolDialog('Delete column',`<label>Column<select name="column">${fields.map(f=>`<option>${esc(f)}</option>`).join('')}</select></label><p>Delete this column and its values from all ${original.features.length} rows in ${esc(layer.name)}? This includes rows hidden by filters.</p><p>Styles or filters using this column may need updating.</p><label><input type="checkbox" name="confirm"> Yes, delete the selected column and its values.</label>`),q=s=>d.querySelector(s),submit=q('[type=submit]');submit.textContent='Delete column';submit.disabled=true;
 q('[name=confirm]').onchange=()=>{submit.disabled=!fields.length||!q('[name=confirm]').checked;};q('[name=column]').onchange=()=>{q('[name=confirm]').checked=false;submit.disabled=true;};
 q('form').onsubmit=async e=>{e.preventDefault();if(!q('[name=confirm]').checked||!fields.length)return;submit.disabled=true;try{if(layer.fc!==original)throw Error('Layer data changed. Reopen Delete column.');const name=q('[name=column]').value;await onApply(removeColumn(original,name),{},[name]);d.close();}catch(error){q('.error').textContent=error.message;submit.disabled=false;}};return d;
}
