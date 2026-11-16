import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {openCloudDEM,IRONBARK_DEM_URL} from './lidar-cog.js';

// Display settings live with the saved layer; no analytical session is needed.
export function openDEMLayer({layer=null,canEdit,onApply,loadDEM=openCloudDEM}){
 document.querySelector('.dem-layer-dialog')?.close();
 const initial=layer?.metadata?.cloud_dem||{};
 const d=toolDialog(layer?'DEM display':'Add DEM layer',`
 <p>${layer?'Change how this elevation layer appears on the map.':'Add an elevation layer to Layers. Show, hide and arrange it alongside your other layers.'}</p>
 ${layer?`<p><strong>${esc(layer.name)}</strong></p>`:`<label>DEM collection URL<input type="url" name="url" required value="${esc(IRONBARK_DEM_URL)}" spellcheck="false"></label>`}
 <label>Colours<select name="mode"><option value="colour">Terrain colours</option><option value="grey">Greyscale</option></select></label>
 <label>Opacity<input name="opacity" type="range" min="0" max="1" step="0.05"><output data-opacity></output></label>
 <div class="lidar-grid"><label>Minimum height (m)<input name="min" type="number" step="any" placeholder="Automatic"></label><label>Maximum height (m)<input name="max" type="number" step="any" placeholder="Automatic"></label></div>
 <p>Leave heights blank to use the visible elevation range. Profiles and measurements remain under Analysis → LiDAR terrain tools.</p>
 <p data-status role="status"></p>`);
 d.classList.add('dem-layer-dialog');const q=s=>d.querySelector(s),submit=q('[type=submit]');let closed=false,busy=false;
 q('[name=mode]').value=initial.mode||'colour';q('[name=opacity]').value=layer?.opacity??initial.opacity??.7;
 for(const key of ['min','max'])q(`[name=${key}]`).value=initial[key]??'';
 const showOpacity=()=>q('[data-opacity]').textContent=`${Math.round(Number(q('[name=opacity]').value)*100)}%`;
 q('[name=opacity]').oninput=showOpacity;showOpacity();submit.textContent=layer?'Apply':'Add to Layers';
 d.addEventListener('close',()=>{closed=true;});
 q('form').onsubmit=async e=>{
  e.preventDefault();if(busy||closed)return;let dem;
  try{
   if(!canEdit())throw Error('Project or access changed. Reopen DEM layer settings.');
   const values=Object.fromEntries(['min','max'].map(key=>{const value=q(`[name=${key}]`).value;return [key,value===''?null:Number(value)];}));
   if(Object.values(values).some(value=>value!==null&&!Number.isFinite(value)))throw Error('Enter valid heights.');
   if(values.min!==null&&values.max!==null&&values.max<=values.min)throw Error('Maximum height must exceed minimum height.');
   busy=true;submit.disabled=true;q('.error').textContent='';
   const settings={...initial,...values,mode:q('[name=mode]').value,opacity:Number(q('[name=opacity]').value)};
   let fc=layer?.fc,bounds=layer?.bounds,name=layer?.name;
   if(!layer){
    q('[data-status]').textContent='Loading DEM collection…';dem=await loadDEM(q('[name=url]').value.trim());
    settings.url=dem.url;settings.datum=dem.datum;bounds=dem.bounds;name=dem.name;
    const [w,s,e,n]=bounds;
    fc={type:'FeatureCollection',features:[{type:'Feature',properties:{name,vertical_datum:dem.datum},geometry:{type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}}]};
   }
   if(closed)return;
   if(!canEdit())throw Error('Project or access changed. Reopen DEM layer settings.');
   await onApply({settings,fc,bounds,name});d.close();
  }catch(error){if(!closed){q('.error').textContent=error.message;q('[data-status]').textContent='';}}
  finally{dem?.dispose();busy=false;submit.disabled=false;}
 };
 return d;
}
