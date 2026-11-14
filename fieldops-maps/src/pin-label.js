import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
export function setPinLabel(feature,text,visible=true){
 if(feature.geometry?.type!=='Point')throw Error('Choose a single pin.');
 const next=structuredClone(feature),properties=next.properties??={};text=String(text||'').trim();
 if(text.length>200)throw Error('Keep the pin label to 200 characters or fewer.');
 if(text){properties._fieldmaps_pin_label=text;properties._fieldmaps_pin_label_visible=visible;}
 else{delete properties._fieldmaps_pin_label;delete properties._fieldmaps_pin_label_visible;}
 return next;
}
export function editPinLabel(feature,onApply){
 const p=feature.properties||{},d=toolDialog('Label pin',`<label>Label<input name="pin-label" maxlength="200" value="${esc(p._fieldmaps_pin_label||'')}" placeholder="For example, Water point"></label><label>Display<select name="pin-label-visible"><option value="show">Show beside pin</option><option value="hide" ${p._fieldmaps_pin_label_visible===false?'selected':''}>Hide label</option></select></label><p class="field-note">This label applies to this pin only. Leave blank to use the layer’s normal labels. Text appearance follows the layer’s label settings.</p>`);
 d.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=d.querySelector('[type=submit]');button.disabled=true;try{await onApply(setPinLabel(feature,d.querySelector('[name=pin-label]').value,d.querySelector('[name=pin-label-visible]').value==='show'));d.close();}catch(error){d.querySelector('.error').textContent=error.message;}finally{button.disabled=false;}};return d;
}
