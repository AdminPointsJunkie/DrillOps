import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {attributeFields} from './explore-data.js';
export const analysisTools={bounds:'Bounds',buffer:'Buffer',centroid:'Centroid',dissolve:'Dissolve',clip:'Clip polygons',count:'Count points',intersect:'Intersect polygons',join:'Join attributes',merge:'Merge layers',sample:'Sample raster',subtract:'Subtract polygons'};
export function openAnalysis(operation,{getLayers,canCreate,onResult}){
 if(!canCreate())return;
 if(operation==='sample'){import('./raster-sample.js').then(m=>m.openRasterSample({getLayers,canCreate,onResult}));return;}
 const layers=getLayers().filter(l=>l.fc?.features?.length&&!l.metadata?.annotation),pair=['clip','count','intersect','join','merge','subtract'].includes(operation);
 const options=layers.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
 const d=toolDialog(analysisTools[operation],`<p>Create a new layer from the complete source data. Sources stay unchanged. Map filters do not limit analysis.</p>${operation==='centroid'?'<p>Centroids are the mean of vertices and can lie outside concave shapes.</p>':''}${operation==='count'?'<p>Points on polygon boundaries are counted in each touching polygon.</p>':''}<label>Source layer<select name="source">${options}</select></label>${pair?`<label>Second layer<select name="target">${options}</select></label>`:''}${operation==='buffer'?'<label>Distance (metres)<input name="distance" type="number" min="0.01" max="100000" value="100" step="any" required></label>':''}${['join','dissolve'].includes(operation)?'<label>Source field<select name="field"></select></label>':''}${operation==='join'?'<label>Second layer field<select name="targetField"></select></label>':''}<label>Result name<input name="name" value="${esc(analysisTools[operation])} result" maxlength="160" required></label><small>Up to 20,000 input features. Cancel closes and stops a running analysis.</small>`),q=s=>d.querySelector(s);
 const layer=name=>layers.find(l=>l.id===q(`[name=${name}]`)?.value);
 const fields=()=>{for(const [input,name] of [['field','source'],['targetField','target']]){const el=q(`[name=${input}]`);if(el)el.innerHTML=(operation==='dissolve'?'<option value="">All polygons</option>':'')+attributeFields(layer(name)?.fc).map(f=>`<option>${esc(f)}</option>`).join('');}};
 q('[name=source]').onchange=fields;if(pair){q('[name=target]').value=layers[1]?.id||layers[0]?.id||'';q('[name=target]').onchange=fields;}fields();let worker;
 d.addEventListener('close',()=>worker?.terminate());
 q('form').onsubmit=e=>{e.preventDefault();if(!canCreate())return;q('.error').textContent='';const button=q('[type=submit]');button.disabled=true;button.textContent='Processing…';worker=new Worker(new URL('./analysis-worker.js',import.meta.url),{type:'module'});
 const fail=message=>{q('.error').textContent=message;button.disabled=false;button.textContent='Apply';worker.terminate();};worker.onerror=e=>fail(e.message||'Analysis failed. Try a smaller layer.');worker.onmessage=async({data})=>{worker.terminate();if(data.error)return fail(data.error);try{if(!canCreate())throw Error('Project access changed. Run this analysis again.');await onResult(data.result,q('[name=name]').value.trim());d.close();}catch(e){fail(e.message);}};
 worker.postMessage({operation,source:layer('source')?.fc,target:layer('target')?.fc,field:q('[name=field]')?.value,targetField:q('[name=targetField]')?.value,distance:Number(q('[name=distance]')?.value)});
 };return d;
}
