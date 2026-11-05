import {isLocalGeoTIFF} from './data-policy.js';
import {vectorStyle,pointMarker} from './layer-style.js';
import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {dataLibrary,loadLibrary} from './public-data.js';
import {workspaceIcon} from './workspace-layout.js';
const category=x=>x.category||({countries:'Boundaries',states:'Boundaries',rivers:'Water',lakes:'Water',graticule:'Reference'})[x.id]||'General';
export function openDataLibrary({L,canCreate,getScope,onResult,workspaceLibrary,getLayers=()=>[],canManage=()=>false,onWorkspaceResult}){
 if(!canCreate())return;const scope=getScope(),abort=new AbortController();let closed=false,tab='workspace',rows=[],selected=null,prepared=null,previewMap=null,previewURL=null,request=0;
 const d=toolDialog('Layer library',`<div class="library-bar"><div role="tablist" aria-label="Library source"><button type="button" role="tab" data-tab="workspace">Workspace</button><button type="button" role="tab" data-tab="public">Public data</button>${canManage()?'<button type="button" role="tab" data-tab="archived">Archived</button>':''}</div>${canManage()?'<button type="button" data-save-layer>＋ Save layer</button>':''}</div><div class="library-find"><input type="search" data-search aria-label="Search layers" placeholder="Search layers…"><select data-category aria-label="Category"><option value="">All categories</option></select></div><div class="library-body"><div class="library-catalog" data-catalog aria-label="Available layers"></div><section class="library-detail" data-detail><div class="library-placeholder">Choose a layer to preview</div></section></div><p class="library-footer" data-footer></p>`);
 d.classList.add('layer-library');d.querySelector('.dialog-actions').hidden=true;const q=s=>d.querySelector(s);
 const valid=()=>{if(closed||scope!==getScope()||!canCreate())throw Error('The project changed. Reopen the library.');};
 function clearPreview(){request++;previewMap?.remove();previewMap=null;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;prepared=null;}
 function items(){return tab==='public'?dataLibrary:rows.filter(x=>!!x.archived===(tab==='archived'));}
 function draw(reset=false){
  if(reset){q('[data-category]').innerHTML='<option value="">All categories</option>'+[...new Set(items().map(category))].sort().map(v=>`<option>${esc(v)}</option>`).join('');}
  d.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
  const term=q('[data-search]').value.toLowerCase(),cat=q('[data-category]').value;
  const list=items().filter(x=>(!cat||category(x)===cat)&&`${x.name} ${x.description} ${category(x)}`.toLowerCase().includes(term));
  q('[data-catalog]').innerHTML=list.length?list.map(x=>`<button type="button" class="library-card" data-layer="${esc(x.id)}" aria-pressed="${selected?.id===x.id}"><span class="library-type-icon">${workspaceIcon(x.kind==='raster'?'dashboard':'layers')}</span><span><strong>${esc(x.name)}</strong><small>${esc(category(x))} · ${tab==='public'?esc(x.source):x.kind==='vector'?`${x.feature_count.toLocaleString()} features`:x.kind==='tiles'?'Tile service':'Imagery'}</small></span></button>`).join(''):`<div class="library-empty"><strong>${term||cat?'No matching layers':tab==='archived'?'No archived layers':'Your workspace library is ready'}</strong><p>${term||cat?'Try another search or category.':tab==='archived'?'Archived layers can be restored here.':'Save a layer from the current map to reuse it across projects.'}</p></div>`;
  q('[data-footer]').textContent=tab==='public'?'Public reference data · Natural Earth boundaries are generalised, not survey or cadastral boundaries.':'Independent copies · Save adds to this project’s draft. Sync publishes to the phone app.';
 }
 async function refresh(){if(!workspaceLibrary){tab='public';draw(true);return;}q('[data-catalog]').textContent='Loading layers…';try{rows=await workspaceLibrary.list();valid();draw(true);}catch(e){q('.error').textContent=e.message;}}
 async function choose(item){
  clearPreview();const version=request;selected=item;draw();q('[data-detail]').innerHTML='<div class="library-placeholder">Loading preview…</div>';q('.error').textContent='';
  try{
   const layer=tab==='public'?{kind:'vector',fc:await loadLibrary(item.id,{signal:abort.signal}),color:'#315d49'}:await workspaceLibrary.load(item);
   valid();if(version!==request)return;prepared=layer;
   q('[data-detail]').innerHTML=`<div class="library-map" data-preview aria-label="Layer preview"></div><div class="library-description"><h3>${esc(item.name)}</h3><p>${esc(item.description||'Reusable workspace layer')}</p><small>${esc(category(item))}${item.created_at?' · Saved '+esc(new Date(item.created_at).toLocaleDateString()):' · '+esc(item.license)}</small>${tab==='public'?'<p><a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer">Source and licence ↗</a></p>':''}<div class="library-detail-actions"><button type="button" class="primary" data-add-library ${tab==='archived'?'hidden':''}>＋ Add to map</button>${canManage()&&tab!=='public'?`<button type="button" data-archive>${tab==='archived'?'Restore':'Archive'}</button>`:''}</div><small>${tab==='public'?'Editable reference data.':'Styles are copied. Changes to this map will not alter the library.'}</small></div>`;
   if(layer.metadata?.xyz){q('[data-preview]').innerHTML='<div class="library-placeholder">Tile service<br><small>Connects to its provider when added to your map.</small></div>';}
   else{
    previewMap=L.map(q('[data-preview]'),{zoomControl:true,attributionControl:false,scrollWheelZoom:false});
    if(layer.fc){const geo=L.geoJSON(layer.fc,{style:f=>vectorStyle(layer,f),pointToLayer:(f,latlng)=>pointMarker(L,layer,latlng,{},f)}).addTo(previewMap);const bounds=geo.getBounds();bounds.isValid()?previewMap.fitBounds(bounds,{padding:[18,18],maxZoom:16}):previewMap.setView([0,0],1);}
    else if(layer.blob&&layer.bounds){previewURL=URL.createObjectURL(layer.blob);const [w,s,e,n]=layer.bounds,bounds=[[s,w],[n,e]];L.imageOverlay(previewURL,bounds).addTo(previewMap);previewMap.fitBounds(bounds);}
   }
  }catch(e){if(version===request&&!closed){q('[data-detail]').innerHTML='<div class="library-placeholder">Preview unavailable</div>';q('.error').textContent=e.message;}}
 }
 q('[data-search]').oninput=()=>draw();q('[data-category]').onchange=()=>draw();
 d.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{clearPreview();selected=null;tab=b.dataset.tab;q('[data-detail]').innerHTML='<div class="library-placeholder">Choose a layer to preview</div>';q('.error').textContent='';draw(true);});
 q('[data-catalog]').onclick=e=>{const b=e.target.closest('[data-layer]');if(b)void choose(items().find(x=>x.id===b.dataset.layer));};
 q('[data-detail]').onclick=async e=>{
  const action=e.target.closest('[data-add-library],[data-archive]');if(!action)return;action.disabled=true;
  try{valid();if(action.hasAttribute('data-archive')){await workspaceLibrary.archive(selected,tab!=='archived');valid();clearPreview();selected=null;q('[data-detail]').innerHTML='<div class="library-placeholder">Library updated</div>';await refresh();}
   else{if(!prepared)throw Error('Wait for the preview.');if(tab==='public')await onResult(structuredClone(prepared.fc),selected.name,{metadata:{reference:{...selected},style:{fillOpacity:.12}}});else await onWorkspaceResult(prepared);d.close();}}
  catch(e){q('.error').textContent=e.message;}finally{action.disabled=false;}
 };
 q('[data-save-layer]')?.addEventListener('click',()=>{
  const layers=getLayers().filter(x=>!isLocalGeoTIFF(x)&&(x.fc||x.metadata?.xyz||x.blob||x.raster_path));
  if(!layers.length){q('.error').textContent='Add a layer to this map first.';return;}
  const save=toolDialog('Save to library',`<label>Layer<select name="layer">${layers.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><label>Name<input name="name" maxlength="160" required value="${esc(layers[0].name)}"></label><label>Category<input name="category" maxlength="60" value="General" list="library-categories"></label><datalist id="library-categories">${['Boundaries','Geology','Infrastructure','Survey','Water','Reference'].map(x=>`<option>${x}</option>`).join('')}</datalist><label>Description<textarea name="description" maxlength="2000" rows="3"></textarea></label><p class="field-note">Saves an independent copy of this layer’s data and styling for workspace editors. Linked feature attachments and original upload files are not copied. Up to 50 MB.</p>`);
  save.querySelector('[type=submit]').textContent='Save to library';save.querySelector('[name=layer]').onchange=e=>save.querySelector('[name=name]').value=layers.find(x=>x.id===e.target.value).name;
  save.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=save.querySelector('[type=submit]');button.disabled=true;try{valid();if(!canManage())throw Error('Workspace admin access required.');const form=new FormData(e.target),layer=layers.find(x=>x.id===form.get('layer'));if(!getLayers().includes(layer))throw Error('The source layer changed. Reopen Save to library.');await workspaceLibrary.save(layer,Object.fromEntries(form));save.close();tab='workspace';await refresh();}catch(e){save.querySelector('.error').textContent=e.message;}finally{button.disabled=false;}};
 });
 d.addEventListener('close',()=>{closed=true;abort.abort();clearPreview();});void refresh();return d;
}
