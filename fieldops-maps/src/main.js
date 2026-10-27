import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import {createClient} from '@supabase/supabase-js';
import {SUPABASE_URL,SUPABASE_KEY,LOCAL_TESTING} from './config.js';
import {xyzSettings,xyzLayer} from './xyz.js';
import {createLocalWorkspace} from './local-workspace.js';
import {inspect,convert} from './importer.js';
import {errorText} from './geo.js';
import {importCRS,projectCRS} from './project.js';
import {installBasemaps} from './basemaps.js';
import {vectorStyle,pointMarker,styleControls,visibilityIcon} from './layer-style.js';
const db=LOCAL_TESTING?createLocalWorkspace():createClient(SUPABASE_URL,SUPABASE_KEY);
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name)=>({layers:'▱',plus:'＋',upload:'↑',close:'×',refresh:'↻',locate:'◎',fit:'⤢',cloud:'☁',arrow:'→',check:'✓'}[name]||name);
let user=null,activeMap=null,layers=[],queue=[],crsList=[],busy=false,reviewIndex=null,preview=null;
const rendered=new Map();const colours=['#147d72','#c17d28','#6c61aa','#ce6359','#3087ba'];
$('#app').innerHTML=`
<header><a class="brand" href="https://www.drillops.com.au/"><span>FieldOps <span class="brand-maps">Maps</span><small>DRILLOPS ECOSYSTEM</small></span></a><div class="header-context"><span class="status-dot"></span><span id="cloud-state">Workspace</span></div><button id="account" class="subtle" ${LOCAL_TESTING?'hidden':''}>Sign in <span>↗</span></button></header>
<main><aside id="sidebar"><div class="workspace-label">PROJECTS</div><div class="map-picker"><select id="map-select" aria-label="Project"><option value="">Unsaved project</option></select><button id="project-settings" class="square" title="Project settings" aria-label="Project settings" disabled><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3-.6 2.3-2 .9-2.2-.6-2 3.4 1.6 1.7v2.6L2.2 15l2 3.4 2.2-.6 2 .9L9 21h4l.6-2.3 2-.9 2.2.6 2-3.4-1.6-1.7v-2.6L19.8 9l-2-3.4-2.2.6-2-.9L13 3z"/><circle cx="11" cy="12" r="3"/></svg></button><button id="new-map" class="square" title="New project" aria-label="New project">＋</button></div><p id="project-default" class="field-note">No default CRS set</p><div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Upload GIS files"><div class="upload-symbol">↑</div><strong>Bring your layers together</strong><p>Drop GIS files here, or <u>browse files</u></p><span>DXF · SHP · CSV · GeoTIFF · GeoPackage</span></div><button id="add-xyz" class="secondary add-xyz">＋ Add XYZ tile link</button><input type="file" id="files" multiple hidden><div id="import-job" class="import-job" role="status" aria-live="polite" hidden></div><div id="queue"></div><div class="tabs"><span class="active">Layers <b id="layer-count">0</b></span><button id="refresh">↻ Refresh</button></div><div id="layers"></div><div class="sidebar-bottom"><span class="mini-icon">▧</span><div><strong>Built for the field</strong><p>${LOCAL_TESTING?'Saved on this device. No account needed.':'Save to your account. Open on your phone.'}</p></div></div></aside>
<section class="map-area"><div id="map"></div><div class="map-title"><span class="eyebrow">MAP WORKSPACE</span><h1 id="map-name">Untitled project</h1><p id="map-subtitle">A clear view of all your spatial data.</p></div><div class="basemap-picker"><label for="basemap">View</label><select id="basemap" aria-label="Basemap"><option value="street">Street</option><option value="satellite">Satellite</option><option value="hybrid">Hybrid</option></select></div><div class="map-tools"><button id="mobile-layers" class="square" aria-label="Toggle layers">▱</button><button id="fit" class="square" aria-label="Fit all layers" title="Fit all layers">⤢</button><button id="locate" class="square" aria-label="Show my location" title="Show my location">◎</button><button id="help" class="square" aria-label="Import help" title="Import help">?</button></div><div id="empty-map"><span class="empty-icon">▱</span><h2>Your map starts here.</h2><p>Add a survey, a boundary, or an entire project.<br>We’ll help put every layer in the right place.</p><button id="add-files" class="primary">＋ Add your first layers</button><small>Review coordinates before anything is saved.</small></div><div class="map-bottom"><div class="basemap-label"><span class="status-dot"></span> <span id="basemap-name">OpenStreetMap</span> <span class="divider">|</span> WGS 84 display</div><span id="coordinates">Move across the map to see coordinates</span></div></section></main>
<div id="toast" role="status" aria-live="polite" hidden></div>
<dialog id="review"><form id="review-form"><div class="dialog-heading"><div><span class="eyebrow">IMPORT REVIEW</span><h2 id="review-title">Review layer</h2></div><button type="button" class="square" data-close="review" aria-label="Close review">×</button></div><div id="review-summary" class="info-strip"></div><label>Layer name<input id="layer-name" required maxlength="160"></label><label>Source coordinate system <span class="required">Required</span><input id="crs-search" placeholder="Search EPSG number or description…" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="crs-results"></label><div id="crs-results" role="listbox" hidden></div><div id="crs-selected" class="selected-crs"></div><p id="import-crs-note" class="field-note"></p><button type="button" id="use-embedded" class="secondary" hidden>Use file CRS instead</button><div id="csv-fields" class="form-grid" hidden><label>X / longitude / easting<select id="csv-x"></select></label><label>Y / latitude / northing<select id="csv-y"></select></label></div><label>Height reference<select id="vertical"><option>Unknown</option><option>AHD — Australian Height Datum</option><option>Ellipsoidal height</option><option>Local survey height</option><option>Other — recorded in source</option></select></label><p class="field-note">Heights are preserved as supplied. This version does not transform vertical datums.</p><details><summary>Advanced coordinates & local grids</summary><label>Custom CRS definition (WKT or PROJ)<textarea id="custom-crs" rows="2" placeholder="Optional: overrides the selected EPSG system"></textarea></label><label>Source coordinate epoch<input id="epoch" type="number" step="0.001" min="1900" max="2200" placeholder="For example, 2020.0"></label><label>Explicit PROJ transformation pipeline<textarea id="pipeline" rows="2" placeholder="Optional: expert-supplied operation"></textarea></label><label>Local-grid control points<textarea id="gcps" rows="3" placeholder="localX, localY, targetX, targetY&#10;At least 3 non-collinear points"></textarea></label><p class="field-note">Target X/Y must use your selected source CRS. A first-order fit positions local CAD or vector coordinates; verify against known points. Advanced settings apply to vectors.</p></details><div class="notice">Confirm the datum and zone, then check the map preview. Missing transformation grids can prevent import. Display alignment is not a survey-accuracy certification.</div><div id="review-error" class="error" role="alert"></div><div class="dialog-actions"><button type="button" id="preview-layer" class="secondary">Preview on map</button><button type="submit" id="import-layer" class="primary">Import layer →</button></div></form></dialog>
<dialog id="xyz-dialog"><form id="xyz-form"><div class="dialog-heading"><h2 id="xyz-title">Add XYZ tiles</h2><button type="button" class="square" data-close="xyz-dialog" aria-label="Close XYZ tiles">×</button></div><label>Layer name<input id="xyz-name" required maxlength="160" placeholder="e.g. Site aerial imagery"></label><label>XYZ tile URL<input id="xyz-url" required type="text" spellcheck="false" placeholder="https://example.com/tiles/{z}/{x}/{y}.png"></label><p class="field-note">Paste a Web Mercator (EPSG:3857) XYZ image tile link, including {z}, {x} and {y}. Optional {s} subdomains and {r} retina suffix are supported. Tiles load directly from your provider; this does not upload a GeoTIFF.</p><label>Attribution<input id="xyz-attribution" maxlength="500" placeholder="Provider credit / copyright"></label><div class="form-grid"><label>Minimum zoom<input id="xyz-min" type="number" min="0" max="22" value="0" required></label><label>Maximum native zoom<input id="xyz-max" type="number" min="0" max="22" value="19" required></label></div><p class="field-note">Use the zoom range supplied by your provider. Show on map returns to the map position where you added the link. URL keys are saved with the project; use browser-safe keys only.</p><div id="xyz-error" class="error" role="alert"></div><div class="dialog-actions"><button id="xyz-submit" class="primary" type="submit">Add tiles</button></div></form></dialog><dialog id="auth"><form id="auth-form"><div class="dialog-heading"><div><span class="eyebrow">YOUR SHARED WORKSPACE</span><h2>Take your maps with you.</h2></div><button type="button" class="square" data-close="auth" aria-label="Close sign in">×</button></div><p>Use the same account on your computer and phone to access your saved maps.</p><label>Email<input type="email" id="email" required autocomplete="email"></label><label>Password<input type="password" id="password" minlength="8" required autocomplete="current-password"></label><div id="auth-error" class="error" role="alert"></div><div class="dialog-actions"><button id="signup" type="button" class="secondary">Create account</button><button type="submit" class="primary">Sign in →</button></div></form></dialog>
<dialog id="name-dialog"><form id="name-form"><div class="dialog-heading"><h2 id="project-dialog-title">New project</h2><button type="button" class="square" data-close="name-dialog" aria-label="Close project settings">×</button></div><label>Project name<input id="new-name" required maxlength="160" placeholder="e.g. Ironbark exploration"></label><label>Default coordinate system<input id="project-crs" list="project-crs-options" autocomplete="off" placeholder="Search EPSG number or name (optional)"></label><datalist id="project-crs-options"></datalist><p class="field-note">Prepopulated for each import into this project. You can choose a different CRS when reviewing a file. Leave blank to use the file’s CRS.</p><div id="project-error" class="error" role="alert"></div><div class="dialog-actions"><button type="submit" id="save-project" class="primary">Save project</button></div></form></dialog>
<dialog id="help-dialog"><div class="dialog-heading"><h2>From file to field</h2><button class="square" data-close="help-dialog" aria-label="Close help">×</button></div><ol><li>${LOCAL_TESTING?'Create a project without signing in. Projects stay in this browser.':'Sign in and create a project.'} Set its default CRS in Project settings, then switch projects using the selector.</li><li>Choose Street, Satellite or Hybrid from the View selector.</li><li>Add files together. For shapefiles, include .shp, .shx, .dbf and .prj, or upload a ZIP.</li><li>Review each layer. Search by EPSG code or description, or keep the embedded definition.</li><li>Preview its location, then import. ${LOCAL_TESTING?'Save in this browser to keep working after a refresh.':'Sign in to save to Supabase and open it on another device.'}</li></ol><p>Up to 250 MB per GeoTIFF, 50 MB per other file, 300 MB per batch, and 20,000 features per vector layer. Raster imports run in the background after review; keep the tab open until complete. Raster display previews are reduced to 1,536 pixels on the longest side; originals are retained when saved.</p><p>Supported formats depend on the bundled GDAL driver. DXF is supported; DWG is not guaranteed. Ungeoreferenced images need a world file or georeferencing before import.</p><p>Refresh retrieves saved changes. Offline downloads, live collaboration, survey-grade vertical transformations, and large-raster tiling are not yet included.</p></dialog>`;
const map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([-25.5,134],4);
installBasemaps(L,map,$('#basemap'),$('#basemap-name'));
L.control.zoom({position:'bottomright'}).addTo(map);L.control.scale({position:'bottomleft',imperial:false}).addTo(map);
map.on('mousemove',e=>$('#coordinates').textContent=`${Math.abs(e.latlng.lat).toFixed(5)}° ${e.latlng.lat<0?'S':'N'}   ${Math.abs(e.latlng.lng).toFixed(5)}° ${e.latlng.lng<0?'W':'E'}`);
fetch(import.meta.env.BASE_URL+'crs.json').then(r=>r.json()).then(r=>{crsList=r;renderProjectCRS();}).catch(()=>toast('The EPSG catalogue could not load. Reload the page.'));
let toastTimer;function toast(msg){clearTimeout(toastTimer);$('#toast').textContent=msg;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
function setBusy(value,message){busy=value;$('#cloud-state').textContent=message||(LOCAL_TESTING?'Testing · saved in this browser':user?'Connected to Supabase':'Personal workspace');$('#files').disabled=value;}
function popup(feature){const el=document.createElement('div');el.className='feature-popup';const heading=document.createElement('strong');heading.textContent='Feature details';el.append(heading);const table=document.createElement('table');for(const [k,v] of Object.entries(feature.properties||{})){const tr=document.createElement('tr');for(const t of [k,typeof v==='object'?JSON.stringify(v):String(v??'—')]){const td=document.createElement('td');td.textContent=t;tr.append(td)}table.append(tr)}el.append(table);return el;}
function makeLayer(item){if(item.metadata?.xyz)return xyzLayer(L,item,toast);if(item.kind==='raster')return L.imageOverlay(item.url,[[item.bounds[1],item.bounds[0]],[item.bounds[3],item.bounds[2]]],{opacity:item.opacity??0.8});return L.geoJSON(item.fc,{style:()=>vectorStyle(item),pointToLayer:(f,ll)=>pointMarker(L,item,ll),onEachFeature:(f,l)=>l.bindPopup(popup(f),{maxWidth:340})});}
function updateEmpty(){$('#empty-map').hidden=layers.length>0||!!preview;$('#layer-count').textContent=layers.length;$('#map-subtitle').textContent=layers.length?`${layers.length} layer${layers.length===1?'':'s'} · ${layers.filter(l=>l.saved).length} saved ${LOCAL_TESTING?'in this browser':'to your account'}`:'A clear view of all your spatial data.';}
function addLayer(item){layers.push(item);const ml=makeLayer(item);rendered.set(item.id,ml);if(item.visible!==false)ml.addTo(map);renderLayers();updateEmpty();}
function fit(){const bounds=L.latLngBounds([]);for(const l of rendered.values())if(l.getBounds)bounds.extend(l.getBounds());if(preview)bounds.extend(preview.getBounds());if(bounds.isValid())map.fitBounds(bounds,{padding:[55,55],maxZoom:17});}
function renderLayers(){$('#layers').innerHTML=layers.length?`<div class="list-heading">MAP LAYERS <span>${layers.length}</span></div>`+layers.map(l=>`<article class="layer-card" data-id="${l.id}"><div class="layer-top"><button class="layer-visibility" data-action="visibility" aria-label="Toggle visibility for ${esc(l.name)}" aria-pressed="${l.visible!==false}" title="${l.visible!==false?'Hide':'Show'} layer">${visibilityIcon(l.visible!==false)}</button><span class="geometry-symbol" style="color:${l.color}">${l.kind==='raster'?'▧':'◇'}</span><div><strong>${esc(l.name)}</strong><small>${l.metadata?.xyz?'XYZ tiles':l.kind==='raster'?'Raster preview':`${l.feature_count??l.fc?.features.length} features`} · ${l.saved?(LOCAL_TESTING?'Saved on this device':'Cloud saved'):'Unsaved'}</small></div><button data-action="zoom" class="small-button layer-zoom" aria-label="Show ${esc(l.name)} on map" title="Show on map"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></svg></button></div><div class="layer-bottom">${l.kind==='raster'?`<label class="raster-opacity">Opacity<input type="range" min="0" max="1" step="0.05" value="${l.opacity??.8}" data-action="opacity" aria-label="Layer opacity"></label>`:''}${l.metadata?.xyz?'<button data-action="edit-xyz" class="small-button" title="Edit tile link">Edit tiles</button>':`<button data-action="export" class="small-button" title="Download ${l.kind==='raster'?'preview':'GeoJSON'}">↓</button>`}${!l.saved?'<button data-action="save" class="save-chip">Save</button>':''}<button data-action="remove" class="small-button" title="Remove from this view">×</button></div>${l.kind==='vector'?styleControls(l):''}<div class="crs-tag">${esc(l.crsLabel||l.source_crs.match(/EPSG:\d+/)?.[0]||'Embedded CRS')} · ${esc(l.vertical_datum||'Height unknown')}</div></article>`).join(''):'<div class="empty-layers"><span>NO LAYERS YET</span><p>Your imported layers will appear here.<br>Turn them on, style them, and inspect features.</p></div>';}
$('#layers').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const l=layers.find(l=>l.id===b.closest('[data-id]').dataset.id);const action=b.dataset.action;if(action==='edit-xyz')openXYZ(l);if(action==='visibility')await setVisibility(l,l.visible===false,b.closest('[data-id]'));if(action==='zoom'){if(l.visible===false)await setVisibility(l,true,b.closest('[data-id]'));if(l.metadata?.xyz){const view=l.metadata.xyzView;map.setView(view.center,Math.max(view.zoom,l.metadata.xyz.minZoom));}else map.fitBounds(rendered.get(l.id).getBounds(),{padding:[40,40],maxZoom:17});}if(action==='remove'){map.removeLayer(rendered.get(l.id));rendered.delete(l.id);layers=layers.filter(x=>x!==l);renderLayers();updateEmpty();toast(l.saved?'Layer hidden from this view. Refresh restores saved layers.':'Unsaved layer removed.');}if(action==='save')await saveLayer(l).catch(e=>toast(errorText(e)));if(action==='export'){const a=document.createElement('a');a.href=l.kind==='raster'?l.url:URL.createObjectURL(new Blob([JSON.stringify(l.fc)],{type:'application/geo+json'}));a.download=l.name+(l.kind==='raster'?'.png':'.geojson');a.click();if(l.kind!=='raster')setTimeout(()=>URL.revokeObjectURL(a.href),1000);}});
async function setVisibility(l,visible,card){
 const button=card.querySelector('[data-action=visibility]');button.innerHTML=visibilityIcon(visible);button.setAttribute('aria-pressed',String(visible));button.title=visible?'Hide layer':'Show layer';
 await changeLayerStyle({target:{closest:()=>card,dataset:{action:'visibility'},checked:visible}});
}
const styleNumbers=new Set(['pointSize','lineWidth','fillOpacity']);
const styleKeys=new Set(['symbol','pointSize','lineStyle','lineWidth','fillColor','fillOpacity']);
const styleSaves=new Map();
async function changeLayerStyle(e){
 const card=e.target.closest('[data-id]');if(!card)return;
 const l=layers.find(l=>l.id===card.dataset.id),action=e.target.dataset.action;if(!l)return;
 if(action==='visibility')l.visible=e.target.checked;
 else if(action==='color'||action==='opacity')l[action]=action==='opacity'?Number(e.target.value):e.target.value;
 else if(styleKeys.has(action)){l.metadata={...l.metadata,style:{...l.metadata?.style,[action]:styleNumbers.has(action)?Number(e.target.value):e.target.value}};}
 else return;
 if(e.target.type==='range'){const output=e.target.parentElement.querySelector('output');if(output)output.textContent=Math.round(Number(e.target.value)*100)+'%';}
 map.removeLayer(rendered.get(l.id));const next=makeLayer(l);rendered.set(l.id,next);if(l.visible!==false)next.addTo(map);
 if(l.saved){
  const payload={visible:l.visible!==false,color:l.color,opacity:l.opacity??.8,metadata:l.metadata||{}};
  const previous=styleSaves.get(l.id)||Promise.resolve();
  const save=previous.catch(()=>{}).then(async()=>{const {error}=await db.from('layers').update(payload).eq('id',l.id);if(error)toast('Style changed here, but could not save: '+error.message);});
  styleSaves.set(l.id,save);await save;if(styleSaves.get(l.id)===save)styleSaves.delete(l.id);
 }
}
$('#layers').addEventListener('input',e=>{if(e.target.type==='number'){if(e.target.value!==''&&e.target.validity.valid)changeLayerStyle(e).catch(error=>toast(errorText(error)));return;}if(e.target.type==='range'||e.target.type==='color'){
 const card=e.target.closest('[data-id]'),l=layers.find(l=>l.id===card?.dataset.id);if(!l)return;
 const action=e.target.dataset.action;
 if(action==='color'||action==='opacity')l[action]=action==='opacity'?Number(e.target.value):e.target.value;
 else if(action==='fillColor'||action==='fillOpacity')l.metadata={...l.metadata,style:{...l.metadata?.style,[action]:action==='fillOpacity'?Number(e.target.value):e.target.value}};
 const output=e.target.parentElement.querySelector('output');if(output)output.textContent=Math.round(Number(e.target.value)*100)+'%';
 map.removeLayer(rendered.get(l.id));const next=makeLayer(l);rendered.set(l.id,next);if(l.visible!==false)next.addTo(map);
}});
$('#layers').addEventListener('change',e=>changeLayerStyle(e).catch(error=>toast(errorText(error))));
function renderQueue(){$('#queue').innerHTML=queue.length?`<div class="list-heading">IMPORT QUEUE <span>${queue.length}</span></div>`+queue.map((q,i)=>`<div class="queue-item"><div><strong>${esc(q.name)}</strong><small>${esc(q.format)} · ${q.source?'CRS detected':'Choose coordinate system'}</small></div><button class="review-button" data-index="${i}">Review →</button><button class="small-button" data-discard="${i}" aria-label="Discard ${esc(q.name)} from import queue">×</button></div>`).join(''):'';}
async function handleFiles(files){if(busy||!files.length)return;setBusy(true,'Loading GIS engine…');importJob('Reading files','Loading GIS engine…');toast('Loading files and inspecting their coordinate systems…');try{const result=await inspect(files,m=>{$('#cloud-state').textContent=m;importJob('Reading files',m);});queue.push(...result.items);renderQueue();if(result.errors.length){$('#review-error').textContent='';toast(result.errors.join('\n'));$('#queue').insertAdjacentHTML('beforeend',`<div class="error import-errors">${result.errors.map(esc).join('<br>')}</div>`);}if(result.items.length){setBusy(false);openReview(queue.length-result.items.length);}}catch(e){toast(errorText(e))}finally{setBusy(false);$('#files').value='';$('#import-job').hidden=true;}}
$('#files').onchange=e=>handleFiles(e.target.files);for(const selector of ['#dropzone','#add-files'])$(selector).onclick=()=>{if(!busy)$('#files').click();};$('#dropzone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#files').click();}};
let dragDepth=0;document.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;$('#dropzone').classList.add('dragging')}});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',()=>{if(--dragDepth<=0)$('#dropzone').classList.remove('dragging')});document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('#dropzone').classList.remove('dragging');handleFiles(e.dataTransfer.files)});
$('#queue').onclick=e=>{if(busy)return;const discard=e.target.closest('[data-discard]');if(discard){queue.splice(Number(discard.dataset.discard),1);if(preview){map.removeLayer(preview);preview=null;}renderQueue();updateEmpty();return;}const b=e.target.closest('[data-index]');if(b)openReview(Number(b.dataset.index));};
let selectedCRS='',selectedLabel='';
function selectCRS(code,label){selectedCRS=code;selectedLabel=label;$('#crs-search').value=label;$('#crs-selected').textContent=code?`✓ ${label}`:'Choose an EPSG system or enter a custom definition below.';$('#crs-results').hidden=true;$('#crs-search').setAttribute('aria-expanded','false');}
function openReview(i){if(busy)return;reviewIndex=i;const q=queue[i];$('#review-form').reset();$('#review-title').textContent=q.name;$('#layer-name').value=q.name;$('#review-summary').textContent=`${q.format} · ${q.kind==='raster'?`${q.info.size?.join(' × ')} pixels`:`${q.count.toLocaleString()} features`}`;$('#review-error').textContent='';$('#csv-fields').hidden=!q.rows;
 let label='';if(q.source){const codes=[...q.source.matchAll(/(?:ID|AUTHORITY)\["EPSG",\s*"?(\d+)/g)];const code=codes.at(-1)?.[1];label=code?`EPSG:${code} — ${crsList.find(c=>c.code==='EPSG:'+code)?.name||'Embedded definition'}`:q.source.match(/^[^\[]+\["([^"]+)/)?.[1]||'Embedded coordinate system';}
 const initial=importCRS(activeMap,q.source,label);selectCRS(initial.code,initial.label);
 $('#import-crs-note').textContent=initial.fromProject?`Project default: ${initial.label}. You can change it for this import.${q.source?' This file also contains an embedded CRS: '+label+'.':''}`:'';
 $('#use-embedded').hidden=!q.source||!initial.fromProject;$('#use-embedded').onclick=()=>{selectCRS(q.source,label);$('#custom-crs').value='';$('#import-crs-note').textContent='Using the file’s embedded CRS for this import.';};
 if(q.rows){for(const s of ['#csv-x','#csv-y'])$(s).innerHTML=q.fields.map(f=>`<option>${esc(f)}</option>`).join('');$('#csv-x').value=q.fields.find(f=>/^(lon|lng|longitude|easting|x)$/i.test(f))||q.fields[0];$('#csv-y').value=q.fields.find(f=>/^(lat|latitude|northing|y)$/i.test(f))||q.fields[1]||q.fields[0];}
 if(q.review){const r=q.review;selectCRS(r.selectedCRS,r.selectedLabel);$('#layer-name').value=r.name;$('#custom-crs').value=r.custom;$('#vertical').value=r.vertical;$('#csv-x').value=r.x;$('#csv-y').value=r.y;$('#epoch').value=r.epoch;$('#pipeline').value=r.pipeline;$('#gcps').value=r.gcps;}
 $('#review').showModal();}
$('#crs-search').oninput=()=>{selectedCRS='';selectedLabel='';$('#crs-selected').textContent='Select a result to confirm the coordinate system.';const term=$('#crs-search').value.toLowerCase().trim();const terms=term.replace('epsg:','').split(/\s+/);let matches=crsList.filter(c=>terms.every(t=>(c.code+' '+c.name).toLowerCase().includes(t)));matches.sort((a,b)=>Number(b.code.toLowerCase()==='epsg:'+term)-Number(a.code.toLowerCase()==='epsg:'+term));matches=matches.slice(0,40);$('#crs-results').innerHTML=matches.map(c=>`<button type="button" role="option" data-code="${c.code}"><b>${c.code}</b><span>${esc(c.name)}</span></button>`).join('')||'<p>No matching EPSG reference. You can enter WKT or PROJ under advanced settings.</p>';$('#crs-results').hidden=false;$('#crs-search').setAttribute('aria-expanded','true');};
$('#crs-results').onclick=e=>{const b=e.target.closest('[data-code]');if(b){const c=crsList.find(c=>c.code===b.dataset.code);selectCRS(c.code,`${c.code} — ${c.name}`);}};
function settings(){if(queue[reviewIndex].rows&&$('#csv-x').value===$('#csv-y').value)throw Error('Choose different columns for X and Y.');return {crs:$('#custom-crs').value.trim()||selectedCRS,x:$('#csv-x').value,y:$('#csv-y').value,epoch:$('#epoch').value,pipeline:$('#pipeline').value.trim(),gcps:$('#gcps').value.trim()};}
async function convertCurrent(progress){const q=queue[reviewIndex];const s=settings();q.review={selectedCRS,selectedLabel,name:$('#layer-name').value,custom:$('#custom-crs').value,vertical:$('#vertical').value,...s};const name=$('#layer-name').value||q.name,crsLabel=$('#custom-crs').value?'Custom definition':selectedLabel,vertical_datum=$('#vertical').value;const data=await convert(q,s,progress);return {id:crypto.randomUUID(),name,kind:q.kind,color:colours[layers.length%colours.length],opacity:.85,visible:true,source_crs:s.crs,crsLabel,vertical_datum,metadata:{format:q.format,source_epoch:s.epoch||null,pipeline:s.pipeline||null,control_points:s.gcps||null,height_transformation:'none',engine:'GDAL 3.8 / PROJ 9.3 browser',display_only:true},files:q.files,...data,url:data.blob?URL.createObjectURL(data.blob):null,saved:false};}
function importJob(name,message,running=true){
 const el=$('#import-job');el.hidden=false;
 el.innerHTML=`<strong>${esc(name)}</strong><p>${esc(message)}</p>${running?'<progress aria-label="Import in progress"></progress><small>Keep this tab open. You can pan, zoom and style existing layers while this runs.</small>':'<button type="button" class="secondary" id="dismiss-job">Dismiss</button>'}`;
 if(!running)$('#dismiss-job').onclick=()=>el.hidden=true;
}
async function reviewAction(isPreview){
 if(busy)return;
 const background=queue[reviewIndex].kind==='raster',q=queue[reviewIndex];
 try{if(!settings().crs.trim())throw Error('Choose the source coordinate system before importing.');}catch(e){$('#review-error').textContent=errorText(e);return;}
 setBusy(true,'Transforming coordinates…');$('#review-error').textContent='';$('#import-layer').disabled=$('#preview-layer').disabled=true;
 const progress=message=>{if(background)importJob(q.review?.name||q.name,message);$('#cloud-state').textContent=message;};
 try{
  const pending=convertCurrent(progress);
  if(background){$('#review').close();progress('Preparing raster in the background…');}
  const l=await pending;
  if(preview){map.removeLayer(preview);preview=null;}
  if(isPreview){
   preview=makeLayer(l).addTo(map);if(!background)map.fitBounds(preview.getBounds(),{padding:[45,45],maxZoom:17});
   $('#review').close();toast('Preview ready. Inspect the position, then select Review again to import.');updateEmpty();
   if(background)importJob(l.name,'Preview ready. Use Fit all layers to see it, then Review to import.',false);
  }else{
   addLayer(l);queue.splice(queue.indexOf(q),1);renderQueue();$('#review').close();if(!background)fit();
   if(user){try{await saveLayer(l,progress);}catch(e){if(background)importJob(l.name,'Imported, but saving failed: '+errorText(e)+' Use Save on the layer to retry.',false);toast('Imported; saving needs attention: '+errorText(e));return;}}
   else toast('Layer imported. Sign in and save to access it on your phone.');
   if(background)importJob(l.name,'Import complete. Use the target icon beside the layer to show it on the map.',false);
  }
 }catch(e){if(background){importJob(q.name,'Import failed: '+errorText(e)+' Select Review to retry.',false);toast('Raster import failed. Your file remains in the import queue.');}else $('#review-error').textContent=errorText(e);}
 finally{setBusy(false);$('#import-layer').disabled=$('#preview-layer').disabled=false;}
}
$('#preview-layer').onclick=()=>reviewAction(true);$('#review-form').onsubmit=e=>{e.preventDefault();reviewAction(false);};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>document.getElementById(b.dataset.close).close();
let editingXYZ=null;
function openXYZ(layer=null){
 if(busy||layers.some(l=>l.saving)||styleSaves.size)return toast('Wait for the current import or save to finish.');
 editingXYZ=layer;$('#xyz-form').reset();$('#xyz-error').textContent='';
 $('#xyz-title').textContent=layer?'Edit XYZ tiles':'Add XYZ tiles';$('#xyz-submit').textContent=layer?'Save tile settings':'Add tiles';
 if(layer){const x=layer.metadata.xyz;$('#xyz-name').value=layer.name;$('#xyz-url').value=x.url;$('#xyz-attribution').value=x.attribution;$('#xyz-min').value=x.minZoom;$('#xyz-max').value=x.maxZoom;}
 $('#xyz-dialog').showModal();
}
$('#add-xyz').onclick=()=>openXYZ();
$('#xyz-form').onsubmit=async e=>{
 e.preventDefault();const button=$('#xyz-submit');if(button.disabled)return;button.disabled=true;$('#xyz-error').textContent='';
 try{
  const xyz=xyzSettings({url:$('#xyz-url').value,attribution:$('#xyz-attribution').value,minZoom:$('#xyz-min').value,maxZoom:$('#xyz-max').value});
  const name=$('#xyz-name').value.trim();if(!name)throw Error('Enter a layer name.');
  if(editingXYZ){
   const l=editingXYZ,metadata={...l.metadata,xyz};
   if(l.saved){const{error}=await db.from('layers').update({name,metadata}).eq('id',l.id);if(error)throw error;}
   Object.assign(l,{name,metadata});map.removeLayer(rendered.get(l.id));const next=makeLayer(l);rendered.set(l.id,next);if(l.visible!==false)next.addTo(map);renderLayers();
  }else{
   const center=map.getCenter(),bounds=map.getBounds();
   const l={id:crypto.randomUUID(),name,kind:'raster',source_crs:'EPSG:3857',crsLabel:'XYZ · Web Mercator',vertical_datum:'Not applicable',color:'#147d72',opacity:1,visible:true,saved:false,
    bounds:[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()],metadata:{xyz,xyzView:{center:[center.lat,center.lng],zoom:map.getZoom()}},files:[]};
   addLayer(l);if(map.getZoom()<xyz.minZoom)map.setView([center.lat,center.lng],xyz.minZoom);
   if(user&&activeMap){try{await saveLayer(l);}catch(error){toast('Tiles added; use Save to retry: '+errorText(error));}}
   else toast('Tiles added. Create a project, then Save to keep this link.');
  }
  $('#xyz-dialog').close();
 }catch(error){$('#xyz-error').textContent=errorText(error);}finally{button.disabled=false;}
};
$('#fit').onclick=fit;$('#help').onclick=()=>$('#help-dialog').showModal();$('#mobile-layers').onclick=()=>$('#sidebar').classList.toggle('mobile-open');
let locationMarker;$('#locate').onclick=()=>{if(!navigator.geolocation)return toast('Location is unavailable in this browser.');navigator.geolocation.getCurrentPosition(p=>{if(locationMarker)map.removeLayer(locationMarker);locationMarker=L.circle([p.coords.latitude,p.coords.longitude],{radius:p.coords.accuracy,color:'#3087ba',fillOpacity:.15}).addTo(map).bindPopup(`GPS accuracy: approximately ${Math.round(p.coords.accuracy)} m`);map.setView(locationMarker.getLatLng(),16)},e=>toast(e.message),{enableHighAccuracy:true,timeout:15000});};
$('#account').onclick=async()=>{if(user){await db.auth.signOut();clearMap();activeMap=null;$('#map-select').innerHTML='<option value="">Unsaved project</option>';syncProject();queue=[];renderQueue();toast('Signed out.')}else $('#auth').showModal();};
async function auth(signup=false){$('#auth-error').textContent='';const email=$('#email').value,password=$('#password').value;if(!$('#auth-form').reportValidity())return;const result=signup?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});if(result.error){$('#auth-error').textContent=result.error.message;return;}if(signup&&!result.data.session){$('#auth-error').textContent='Account created. Confirm your email, then return here and sign in.';return;}$('#auth').close();toast('Signed in. Your maps will be available on any device.');}
$('#auth-form').onsubmit=e=>{e.preventDefault();auth().catch(e=>$('#auth-error').textContent=errorText(e));};$('#signup').onclick=()=>auth(true).catch(e=>$('#auth-error').textContent=errorText(e));
async function listMaps(){const {data,error}=await db.from('maps').select('*').order('created_at');if(error)throw error;$('#map-select').innerHTML='<option value="">Unsaved project</option>'+data.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');if(activeMap)$('#map-select').value=activeMap.id;return data;}
let maps=[];db.auth.onAuthStateChange((event,session)=>{user=session?.user||null;$('#account').innerHTML=user?'Sign out ↗':'Sign in ↗';$('#cloud-state').textContent=LOCAL_TESTING?'Testing · saved in this browser':user?'Connected to Supabase':'Personal workspace';if(user)setTimeout(async()=>{try{maps=await listMaps();if(!activeMap&&!layers.length&&maps.length)await loadMap(maps[0].id);}catch(e){toast(errorText(e));}},0);});
let editingProject=false;
function syncProject(){
 $('#project-settings').disabled=!activeMap;
 $('#map-name').textContent=activeMap?.name||'Untitled project';
 $('#project-default').textContent=activeMap?.default_crs?`Default CRS: ${activeMap.default_crs_label||activeMap.default_crs}`:'No default CRS set';
}
function renderProjectCRS(){
 const words=$('#project-crs').value.toLowerCase().trim().replace('epsg:','').split(/\s+/);
 const matches=crsList.filter(c=>words.every(w=>(c.code+' '+c.name).toLowerCase().includes(w))).slice(0,60);
 $('#project-crs-options').innerHTML=matches.map(c=>`<option value="${esc(c.code+' — '+c.name)}"></option>`).join('');
}
$('#project-crs').oninput=renderProjectCRS;
function openProject(edit=false,fromImport=false){
 if((busy&&!fromImport)||styleSaves.size||layers.some(l=>l.saving))return toast('Wait for the current import or save to finish.');
 if(!user){$('#auth').showModal();return;}
 if(!edit&&activeMap&&(layers.some(l=>!l.saved)||queue.length))return toast('Finish queued imports and save or remove unsaved layers before creating another project.');
 editingProject=edit;$('#name-form').reset();$('#project-error').textContent='';
 $('#project-dialog-title').textContent=edit?'Project settings':'New project';
 $('#new-name').value=edit?activeMap.name:'';
 $('#project-crs').value=edit?(activeMap.default_crs_label||activeMap.default_crs||''):'';
 renderProjectCRS();$('#name-dialog').showModal();
}
$('#new-map').onclick=()=>openProject();
$('#project-settings').onclick=()=>openProject(true);
$('#name-form').onsubmit=async e=>{
 e.preventDefault();const button=$('#save-project');if(button.disabled)return;
 $('#project-error').textContent='';button.disabled=true;
 try{
  const name=$('#new-name').value.trim();if(!name)throw Error('Enter a project name.');
  const payload={name,...projectCRS($('#project-crs').value,crsList)};
  const request=editingProject?db.from('maps').update(payload).eq('id',activeMap.id):db.from('maps').insert(payload);
  const {data,error}=await request.select().single();if(error)throw error;
  if(!editingProject&&activeMap)clearMap();
  activeMap=data;syncProject();$('#name-dialog').close();
  maps=await listMaps();toast(editingProject?'Project settings saved.':'Project created. Import layers or save your existing layers to this project.');
 }catch(e){$('#project-error').textContent=errorText(e);toast(errorText(e));}finally{button.disabled=false;}
};
async function ensureMap(){if(activeMap)return;if(!user){$('#auth').showModal();throw Error('Sign in, then select Save on the layer.');}openProject(false,true);throw Error('Create a project, then select Save on the layer.');}
async function saveLayer(l,progress=()=>{}){if(l.saving)return;await ensureMap();if(l.saved)return;l.saving=true;const paths=[];try{
 toast(LOCAL_TESTING?'Saving original files and layer in this browser…':'Saving original files and layer to Supabase…');const prefix=`${user.id}/${crypto.randomUUID()}`;
 let fileNumber=0;for(const file of l.files||[]){progress(`${LOCAL_TESTING?'Saving':'Uploading'} original file ${++fileNumber} of ${l.files.length}: ${file.name}`);const path=`${prefix}/${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const{error}=await db.storage.from('gis-files').upload(path,file,{contentType:file.type||'application/octet-stream'});if(error)throw error;paths.push(path);}
 progress('Saving layer details and display preview…');const payload={map_id:activeMap.id,name:l.name,kind:l.kind,source_crs:l.source_crs,vertical_datum:l.vertical_datum,metadata:{...l.metadata,crs_label:l.crsLabel},color:l.color,opacity:l.opacity??.85,visible:l.visible!==false,bounds:l.bounds,original_paths:paths};let newID;
 if(l.metadata?.xyz){const{data,error}=await db.from('layers').insert(payload).select().single();if(error)throw error;newID=data.id;}else if(l.kind==='vector'){const{data,error}=await db.rpc('import_vector',{p_layer:payload,p_features:l.fc.features});if(error)throw error;newID=data;}else{const path=`${prefix}/display.png`;const {error:uploadError}=await db.storage.from('gis-files').upload(path,l.blob,{contentType:'image/png'});if(uploadError)throw uploadError;paths.push(path);const{data,error}=await db.from('layers').insert({...payload,raster_path:path}).select().single();if(error)throw error;newID=data.id;}
 const oldID=l.id;l.id=newID;l.saved=true;l.original_paths=paths;rendered.set(l.id,rendered.get(oldID));rendered.delete(oldID);renderLayers();updateEmpty();toast(LOCAL_TESTING?'Saved in this browser.':'Saved to Supabase. Open this map on your phone to see it.');
 }catch(e){if(paths.length)await db.storage.from('gis-files').remove(paths);throw e;}finally{l.saving=false;}}
function clearMap(){for(const l of rendered.values())map.removeLayer(l);rendered.clear();for(const l of layers)if(l.url?.startsWith('blob:'))URL.revokeObjectURL(l.url);layers=[];if(preview){map.removeLayer(preview);preview=null;}renderLayers();updateEmpty();}
async function loadMap(id){if(!id){$('#map-select').value=activeMap?.id||'';return;}if(busy||styleSaves.size||layers.some(l=>l.saving)){$('#map-select').value=activeMap?.id||'';return;}if(layers.some(l=>!l.saved)||queue.length){toast('Finish queued imports and save or remove unsaved layers before switching or refreshing projects.');$('#map-select').value=activeMap?.id||'';return;}setBusy(true,'Refreshing saved layers…');try{const{data,error}=await db.from('layers').select('*').eq('map_id',id).order('created_at');if(error)throw error;const loaded=[];for(const l of data){if(l.kind==='vector'){const result=await db.rpc('layer_geojson',{p_layer_id:l.id});if(result.error)throw result.error;l.fc=result.data;}else if(!l.metadata?.xyz){const result=await db.storage.from('gis-files').download(l.raster_path);if(result.error)throw result.error;l.url=URL.createObjectURL(result.data);}l.saved=true;l.crsLabel=l.metadata?.crs_label;loaded.push(l);}clearMap();activeMap=maps.find(m=>m.id===id);loaded.forEach(addLayer);syncProject();$('#map-select').value=id;fit();toast(LOCAL_TESTING?'Project refreshed from this browser.':'Map refreshed from Supabase.');}catch(e){toast(errorText(e));}finally{setBusy(false);}}
$('#map-select').onchange=e=>loadMap(e.target.value);$('#refresh').onclick=async()=>{if(!user){$('#auth').showModal();return;}try{maps=await listMaps();if(activeMap)await loadMap(activeMap.id);else toast('Choose a project.');}catch(e){toast(errorText(e))}};
renderLayers();
window.addEventListener('beforeunload',e=>{if(busy||queue.length||styleSaves.size||layers.some(l=>!l.saved||l.saving)){e.preventDefault();e.returnValue='';}});
