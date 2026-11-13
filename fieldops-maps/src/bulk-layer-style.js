import {toolDialog} from './explore-dialogs.js';
import {geometryKinds,layerStyle} from './layer-style.js';
export function openBulkLayerStyle(layers,onApply){
 const kinds=layers.map(l=>geometryKinds(l.fc)),all=kind=>kinds.every(k=>k.has(kind));
 const fields=[['color','Colour','color',layers[0].color||'#315d49'],['opacity','Opacity','number',layers[0].opacity??.85,0,1,.05]];
 if(kinds.every(k=>k.has('line')||k.has('shape')))fields.push(['lineWidth','Line thickness','number',layerStyle(layers[0]).lineWidth,0,12,.5]);
 if(all('point'))fields.push(['pointSize','Point size','number',layerStyle(layers[0]).pointSize,4,48,1]);
 if(all('shape'))fields.push(['fillColor','Fill colour','color',layerStyle(layers[0]).fillColor||'#315d49'],['fillOpacity','Fill opacity','number',layerStyle(layers[0]).fillOpacity,0,1,.05]);
 const d=toolDialog(`Style ${layers.length} layers`,'<p>Choose the properties to apply to every selected layer.</p>'+fields.map(([key,label,type,,min,max,step])=>`<div class="bulk-style-field"><label><input type="checkbox" data-apply="${key}"> ${label}</label><input aria-label="${label}" name="${key}" type="${type}" ${type==='number'?`min="${min}" max="${max}" step="${step}"`:''}></div>`).join('')+(layers.some(l=>l.metadata?.style?.useKMLStyle||l.metadata?.style?.rules?.mode&&l.metadata.style.rules.mode!=='single')?'<p>Applying these properties uses a uniform style instead of attribute or imported KML styling. Labels and other layer settings are kept.</p>':''));
 for(const [key,,,value] of fields){const input=d.querySelector(`[name=${key}]`);input.value=value;input.oninput=()=>{d.querySelector(`[data-apply=${key}]`).checked=true;};}
 const button=d.querySelector('[type=submit]');button.textContent='Apply to selected layers';
 d.querySelector('form').onsubmit=async event=>{event.preventDefault();const changes={};for(const [key,,type] of fields)if(d.querySelector(`[data-apply=${key}]`).checked){const input=d.querySelector(`[name=${key}]`);if(input.value===''||!input.checkValidity()){input.reportValidity();return;}changes[key]=type==='number'?Number(input.value):input.value;}
 if(!Object.keys(changes).length){d.querySelector('.error').textContent='Choose at least one property to apply.';return;}
 button.disabled=true;try{await onApply(changes);d.close();}catch(error){d.querySelector('.error').textContent=error.message;}finally{button.disabled=false;}};
 return d;
}
