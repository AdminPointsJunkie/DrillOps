import {openSTACLibrary,stacSources} from './stac-library.js';
import {openUSGSLibrary} from './usgs-library.js';
import {xyzLayer} from './xyz.js';
import {publicSources} from './public-sources.js';
import {openQGlobe} from './qglobe.js';
import {vectorStyle,pointMarker} from './layer-style.js';
import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {dataLibrary,loadLibrary,publicTileLayer} from './public-data.js';
import {workspaceIcon} from './workspace-layout.js';
const category=x=>x.category||({countries:'Boundaries',states:'Boundaries',rivers:'Water',lakes:'Water',graticule:'Reference'})[x.id]||'General';
export function openDataLibrary({L,canCreate,getScope,onResult,workspaceLibrary,getUser=()=>null,getWorkspace=()=>null,onWorkspaceResult,getBounds,favourites}){
 if(!canCreate())return;const scope=getScope(),abort=new AbortController();let closed=false,tab='project',rows=[],selected=null,prepared=null,previewMap=null,previewURL=null,request=0,stars=[],starBusy=false;
 const d=toolDialog('Layer library',`<div class="library-bar"><div role="tablist" aria-label="Library source"><button type="button" role="tab" data-tab="favourites">★ Favourites</button><button type="button" role="tab" data-tab="yours">Your Layers</button><button type="button" role="tab" data-tab="shared">Shared with You</button><button type="button" role="tab" data-tab="project">Shared Project Layers</button><button type="button" role="tab" data-tab="public">Public Data</button><button type="button" role="tab" data-tab="archived">Archived</button></div></div><div class="library-find"><input type="search" data-search aria-label="Search layers" placeholder="Search layers…"><select data-category aria-label="Category"><option value="">All categories</option></select></div><div class="library-body"><div class="library-catalog" data-catalog aria-label="Available layers"></div><section class="library-detail" data-detail><div class="library-placeholder">Choose a layer to preview</div></section></div><p class="library-footer" data-footer></p>`);
 d.classList.add('layer-library');d.querySelector('.dialog-actions').hidden=true;const q=s=>d.querySelector(s);
 const valid=()=>{if(closed||scope!==getScope()||!canCreate())throw Error('The project changed. Reopen the library.');};
 function clearPreview(){request++;previewMap?.remove();previewMap=null;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;prepared=null;}
 const publicItem=item=>dataLibrary.includes(item);
 const key=item=>'layer:'+(publicItem(item)?'public:':'workspace:')+item.id;
 const isStar=k=>stars.some(x=>x.key===k);
 const starButton=(k,name)=>`<button type="button" class="library-star" data-star="${esc(k)}" aria-pressed="${isStar(k)}" aria-label="${isStar(k)?'Remove from':'Add to'} favourites: ${esc(name)}" title="${isStar(k)?'Remove favourite':'Add favourite'}">${isStar(k)?'★':'☆'}</button>`;
 function items(){return librarySection(rows,tab,{userId:getUser()?.id,workspaceId:getWorkspace()?.id,publicRows:dataLibrary,isFavourite:x=>isStar(key(x))});}
 async function toggle(record){if(starBusy||!favourites)return;starBusy=true;try{valid();const next=isStar(record.key)?stars.filter(x=>x.key!==record.key):[...stars,record];if(next.length>300)throw Error('You can save up to 300 favourites per workspace.');await favourites.save(next);valid();stars=next;draw(true);return true;}catch(e){q('.error').textContent=e.message;return false;}finally{starBusy=false;}}

 function draw(reset=false){
  d.dataset.publicBrowse=String(tab==='public'&&!selected);
  if(reset){q('[data-category]').innerHTML='<option value="">All categories</option>'+[...new Set([...items().map(category),...(['public','favourites'].includes(tab)?['Public services']:[])])].sort().map(v=>`<option>${esc(v)}</option>`).join('');}
  d.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
  const term=q('[data-search]').value.toLowerCase(),cat=q('[data-category]').value;
  const list=items().filter(x=>(!cat||category(x)===cat)&&`${x.name} ${x.description} ${category(x)}`.toLowerCase().includes(term));
  q('[data-catalog]').innerHTML=list.length?list.map(x=>`<div class="library-favourite-row"><button type="button" class="library-card" data-layer="${esc(x.id)}" aria-pressed="${selected?.id===x.id}"><span class="library-type-icon">${workspaceIcon(x.kind==='raster'?'dashboard':'layers')}</span><span><strong>${esc(x.name)}</strong><small>${esc(category(x))} · ${publicItem(x)?esc(x.source):x.source_layer_id?esc(x.description):x.presentation?.drawing?'Original DWG drawing':x.kind==='vector'?`${x.feature_count.toLocaleString()} features`:x.kind==='tiles'?'Tile service':'Imagery'}</small></span></button>${starButton(key(x),x.name)}</div>`).join(''):`<div class="library-empty"><strong>${term||cat?'No matching layers':tab==='archived'?'No archived layers':tab==='favourites'?'No favourites yet':'No layers yet'}</strong><p>${term||cat?'Try another search or category.':tab==='archived'?'Archived layers can be restored here.':tab==='favourites'?'Star layers or public sources to find them here.':'Right-click a map layer and choose Add to library.'}</p></div>`;
  if(['public','favourites'].includes(tab)&&(!cat||cat==='Public services'))q('[data-catalog]').insertAdjacentHTML('afterbegin',publicSources.filter(x=>(tab!=='favourites'||isStar('source:'+x.id))&&`${x.name} ${x.region} ${x.description}`.toLowerCase().includes(term)).map(x=>`<div class="library-favourite-row"><button type="button" class="library-card ${x.thumbnail?'library-source-featured':''}" data-source="${esc(x.id)}">${x.thumbnail?`<div class="library-source-photo"><img src="${esc(x.thumbnail)}" alt="${esc(x.credit)}" loading="lazy" referrerpolicy="no-referrer"><small>${esc(x.credit)}</small></div>`:'<span>🌐</span>'}<span><strong>${esc(x.name)}</strong><small>${esc(x.region)} · ${esc(x.description)}</small></span></button>${starButton('source:'+x.id,x.name)}</div>`).join(''));
  if(tab==='favourites'&&(!cat||cat==='Public services'))q('[data-catalog]').insertAdjacentHTML('afterbegin',stars.filter(x=>x.kind==='service'&&publicSources.some(p=>p.id===x.sourceId)&&x.name.toLowerCase().includes(term)).map(x=>`<div class="library-favourite-row"><button type="button" class="library-card" data-service="${esc(x.key)}"><span>▧</span><span><strong>${esc(x.name)}</strong><small>${esc(publicSources.find(p=>p.id===x.sourceId).name)}</small></span></button>${starButton(x.key,x.name)}</div>`).join(''));
  if(q('[data-source],[data-service]'))q('.library-empty')?.remove();
  q('[data-footer]').textContent=tab==='public'?'Reference boundaries are generalised, not survey boundaries.':'';
 }
 async function refresh(){q('[data-catalog]').textContent='Loading layers…';try{stars=favourites?await favourites.list():[];if(!workspaceLibrary)tab='public';else rows=await workspaceLibrary.list();valid();draw(true);}catch(e){q('.error').textContent=e.message;draw(true);}}
 async function choose(item){
  clearPreview();const version=request;selected=item;draw();q('[data-detail]').innerHTML='<div class="library-placeholder">Loading preview…</div>';q('.error').textContent='';
  try{
   const layer=publicItem(item)?item.kind==='tiles'?publicTileLayer(item.id):{kind:'vector',fc:await loadLibrary(item.id,{signal:abort.signal}),color:({countries:'#b98945',states:'#9567b5',rivers:'#248eb0',lakes:'#318eca',graticule:'#7b8596'})[item.id],metadata:{style:{fillOpacity:.5}}}:await workspaceLibrary.load(item);
   valid();if(version!==request)return;prepared=layer;
   q('[data-detail]').innerHTML=`<div class="library-map" data-preview aria-label="Layer preview"></div><div class="library-description"><h3>${esc(item.name)}</h3><p>${esc(item.description||(layer.drawing?'Original DWG drawing':'Library layer'))}</p><small>${esc(category(item))}${item.created_at?' · Saved '+esc(new Date(item.created_at).toLocaleDateString()):' · '+esc(item.license)}</small>${publicItem(item)?`<p><a href="${esc(item.sourceUrl||'https://www.naturalearthdata.com/about/terms-of-use/')}" target="_blank" rel="noopener noreferrer">Source ↗</a></p>`:''}<div class="library-detail-actions"><button type="button" class="primary" data-add-library ${tab==='archived'?'hidden':''}>＋ Add to map</button>${!publicItem(item)&&workspaceLibrary.canManage(item)?`<button type="button" data-share-library ${tab==='archived'?'hidden':''}>Share…</button><button type="button" data-archive>${tab==='archived'?'Restore':'Archive'}</button>`:''}</div><small>${layer.drawing?'Import this drawing into a project or select it when resolving linked drawings.':publicItem(item)?item.kind==='tiles'?'Shaded relief · not an analysis DEM.':'Editable reference data.':'Styles are copied. Changes to this map will not alter the library.'}</small></div>`;
   if(layer.drawing){q('[data-preview]').innerHTML=`<div class="library-placeholder"><strong>DWG drawing</strong><small>${esc(layer.files[0].name)}</small><small>Original CAD file · ${(layer.files[0].size/1024/1024).toFixed(1)} MB</small></div>`;q('[data-add-library]').textContent='Import drawing';}
   else if(layer.metadata?.xyz){previewMap=L.map(q('[data-preview]'),{scrollWheelZoom:false});xyzLayer(L,layer).addTo(previewMap);previewMap.setView([-25,134],3);}
   else{
    previewMap=L.map(q('[data-preview]'),{zoomControl:true,attributionControl:false,scrollWheelZoom:false});
    if(layer.fc){const geo=L.geoJSON(layer.fc,{style:f=>vectorStyle(layer,f),pointToLayer:(f,latlng)=>pointMarker(L,layer,latlng,{},f)}).addTo(previewMap);const bounds=geo.getBounds();bounds.isValid()?previewMap.fitBounds(bounds,{padding:[18,18],maxZoom:16}):previewMap.setView([0,0],1);}
    else if(layer.blob&&layer.bounds){previewURL=URL.createObjectURL(layer.blob);const [w,s,e,n]=layer.bounds,bounds=[[s,w],[n,e]];L.imageOverlay(previewURL,bounds).addTo(previewMap);previewMap.fitBounds(bounds);}
   }
  }catch(e){if(version===request&&!closed){q('[data-detail]').innerHTML='<div class="library-placeholder">Preview unavailable</div>';q('.error').textContent=e.message;}}
 }
 q('[data-search]').oninput=()=>draw();q('[data-category]').onchange=()=>draw();
 d.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{clearPreview();selected=null;tab=b.dataset.tab;q('[data-detail]').innerHTML='<div class="library-placeholder">Choose a layer to preview</div>';q('.error').textContent='';draw(true);});
 q('[data-catalog]').onclick=e=>{const star=e.target.closest('[data-star]');if(star){const k=star.dataset.star;void toggle(stars.find(x=>x.key===k)||{key:k,kind:k.startsWith('source:')?'source':'layer'});return;}const sourceButton=e.target.closest('[data-source]'),serviceButton=e.target.closest('[data-service]'),service=serviceButton?stars.find(x=>x.key===serviceButton.dataset.service):null;if(sourceButton||service){const source=publicSources.find(x=>x.id===(service?.sourceId||sourceButton.dataset.source));const openSource=source.catalogue==='usgs'?openUSGSLibrary:stacSources[source.catalogue]?openSTACLibrary:openQGlobe;openSource({L,getBounds,valid,source:publicSources.find(x=>x.id===(service?.sourceId||sourceButton.dataset.source)),initialItem:service?{name:service.name,path:service.path,layer:true,image:service.image}:null,isFavourite:isStar,onFavourite:async record=>{if(!await toggle(record))throw Error('Favourite could not save. Please retry.');return isStar(record.key);},onRasterResult:async layer=>{valid();await onWorkspaceResult(layer);d.close();},onResult:async(...args)=>{valid();await onResult(...args);d.close();}});return;}const b=e.target.closest('[data-layer]');if(b)void choose(items().find(x=>x.id===b.dataset.layer));};
 q('[data-detail]').onclick=async e=>{
  if(e.target.closest('[data-share-library]')){openLibrarySharing(workspaceLibrary,selected);return;}
  const action=e.target.closest('[data-add-library],[data-archive]');if(!action)return;action.disabled=true;
  try{valid();if(action.hasAttribute('data-archive')){await workspaceLibrary.archive(selected,tab!=='archived');valid();clearPreview();selected=null;q('[data-detail]').innerHTML='<div class="library-placeholder">Library updated</div>';await refresh();}
   else{if(!prepared)throw Error('Wait for the preview.');if(publicItem(selected)&&selected.kind!=='tiles')await onResult(structuredClone(prepared.fc),selected.name,{color:prepared.color,metadata:{reference:{...selected},style:{fillOpacity:.5}}});else{const layer=prepared;if(layer.drawing)d.close();await onWorkspaceResult(layer);}d.close();}}
  catch(e){q('.error').textContent=e.message;}finally{action.disabled=false;}
 };
 d.addEventListener('close',()=>{closed=true;abort.abort();clearPreview();});void refresh();return d;
}

export function librarySection(rows,tab,{userId,workspaceId,publicRows=[],isFavourite=()=>false}){
 if(tab==='public')return publicRows;
 if(tab==='archived')return rows.filter(r=>r.archived);
 const active=rows.filter(r=>!r.archived);
 if(tab==='favourites')return [...publicRows,...active].filter(isFavourite);
 if(tab==='yours')return active.filter(r=>r.created_by===userId&&r.visibility==='private');
 if(tab==='shared')return active.filter(r=>r.shared_direct&&r.created_by!==userId);
 return active.filter(r=>r.workspace_id===workspaceId&&r.visibility!=='private');
}
function openLibrarySharing(library,row){
 const d=toolDialog('Share '+row.name,`<label>Email<input name="email" type="email" required placeholder="name@example.com"></label><div data-people></div>`),q=s=>d.querySelector(s);q('[type=submit]').textContent='Share';
 const draw=people=>{q('[data-people]').innerHTML=people.map(p=>`<div class="library-share-person"><span>${esc(p.email)}</span><button type="button" data-revoke="${esc(p.id)}">Remove</button></div>`).join('');};
 const run=async action=>{q('[type=submit]').disabled=true;q('.error').textContent='';try{draw(await action());}catch(e){q('.error').textContent=e.message;}finally{q('[type=submit]').disabled=false;}};
 void run(()=>library.sharing(row));q('form').onsubmit=e=>{e.preventDefault();void run(()=>library.sharing(row,'grant',q('[name=email]').value));};q('[data-people]').onclick=e=>{const b=e.target.closest('[data-revoke]');if(b){b.disabled=true;void run(()=>library.sharing(row,'revoke',null,b.dataset.revoke));}};
}
