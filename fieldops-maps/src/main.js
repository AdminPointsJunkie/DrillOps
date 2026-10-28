import './explore.css';
import {installMapExplorer} from './map-explorer.js';
import {featureInfo} from './explore-data.js';
import {installFieldTools,annotationLayer,editAnnotation} from './field-tools.js';
import {publishedProjects,publishedLayers} from './published-projects.js';
import {openAttributeStyle} from './attribute-style-dialog.js';
import {readAuthLink,installPasswordSetup} from './password-setup.js';
import {installAccounts} from './accounts.js';
import {installRegistration} from './registration.js';
import {createSaveStatus} from './save-status.js';
import {syncProjectRelease} from './operator-sync.js';
import {transferProject,CLOUD_FILE_LIMIT} from './cloud-transfer.js';
import {installSidebarResize} from './sidebar-resize.js';
import {orderPanes} from './pane-order.js';
import {pointLabels} from './point-labels.js';
import {cachedConversion} from './conversion-cache.js';
import {nodeId,flattenTree,parentGroup,removeNode,moveNode,normaliseTree} from './layer-tree.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import './workspace.css';
import './workspaces.css';
import {installWorkspaceLayout} from './workspace-layout.js';
import {createClient} from '@supabase/supabase-js';
import {SUPABASE_URL,SUPABASE_KEY,LOCAL_TESTING} from './config.js';
import {xyzSettings,xyzLayer} from './xyz.js';
import {createLocalWorkspace} from './local-workspace.js';
import {inspect,convert} from './importer.js';
import {errorText} from './geo.js';
import {importCRS,projectCRS} from './project.js';
import {installBasemaps} from './basemaps.js';
import {vectorStyle,pointMarker,styleControls,visibilityIcon} from './layer-style.js';
const authLink=readAuthLink(location.href);
const db=LOCAL_TESTING?createLocalWorkspace():createClient(SUPABASE_URL,SUPABASE_KEY);
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name)=>({layers:'▱',plus:'＋',upload:'↑',close:'×',refresh:'↻',locate:'◎',fit:'⤢',cloud:'☁',arrow:'→',check:'✓'}[name]||name);
let user=null,activeMap=null,layers=[],queue=[],crsList=[],busy=false,reviewIndex=null,preview=null;
let layerTree=[],layoutPending=0,layoutSave=Promise.resolve();
let workspaceLayout=null,workspaceContext=null,currentWorkspace=null;
let explorer=null,fieldTools=null,geometryEditor=null,geometryEditingId=null;
const isReadOnly=()=>!LOCAL_TESTING&&!!user&&(!workspaceContext||!currentWorkspace||!['owner','admin','editor'].includes(currentWorkspace.role));
const isAdmin=()=>LOCAL_TESTING||!!user&&!!workspaceContext&&(workspaceContext.platform_admin||['owner','admin'].includes(currentWorkspace?.role));
const canEditLayer=l=>!isReadOnly()&&(!l?.metadata?.annotation||isAdmin());
let syncing=false,syncDirty=false,syncError=false;const saves=createSaveStatus(()=>{syncDirty=true;refreshSaveStatus();});
const rendered=new Map();const colours=['#147d72','#c17d28','#6c61aa','#ce6359','#3087ba'];
$('#app').innerHTML=`
<header><a class="brand" href="/maps/"><span>DrillOps <span class="brand-maps">FieldMaps</span><small>DRILLOPS ECOSYSTEM</small></span></a><div class="header-context"><span class="status-dot"></span><span id="cloud-state">Workspace</span></div><button id="browser-projects" class="subtle" hidden>Import browser projects</button><button id="set-password" class="subtle" hidden>Set password</button><button id="workspace-invitations" class="subtle" hidden>Invitations</button><button id="people" class="subtle" hidden>People &amp; access</button><button id="get-started" class="primary" ${LOCAL_TESTING?'hidden':''}>Get started</button><button id="account" class="subtle" ${LOCAL_TESTING?'hidden':''}>Sign in <span>↗</span></button></header>
<main><aside id="sidebar"><div class="company-switcher" hidden><label>COMPANY<select id="company-select" aria-label="Company workspace"></select></label><small id="company-role"></small><button id="start-company" class="secondary" hidden>Set up my company</button></div><div class="workspace-label">PROJECTS</div><div class="map-picker"><select id="map-select" aria-label="Project"><option value="">Unsaved project</option></select><button id="project-settings" class="square" title="Project settings" aria-label="Project settings" disabled><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3-.6 2.3-2 .9-2.2-.6-2 3.4 1.6 1.7v2.6L2.2 15l2 3.4 2.2-.6 2 .9L9 21h4l.6-2.3 2-.9 2.2.6 2-3.4-1.6-1.7v-2.6L19.8 9l-2-3.4-2.2.6-2-.9L13 3z"/><circle cx="11" cy="12" r="3"/></svg></button><button id="new-map" class="square" title="New project" aria-label="New project">＋</button></div><p id="project-default" class="field-note">No default CRS set</p><div class="sync-controls"><div><span id="save-status" role="status" aria-live="polite">Sign in to save</span><small id="sync-status"></small></div><button id="retry-save" class="small-button" hidden>Retry</button><button id="sync-project" class="primary" disabled title="Save and publish this project for read-only operator access">SYNC</button></div><div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Upload GIS files"><div class="upload-symbol">↑</div><strong>Bring your layers together</strong><p>Drop GIS files here, or <u>browse files</u></p><span>DXF · SHP · CSV · KML/KMZ · GeoTIFF · GeoPackage</span></div><button id="add-xyz" class="secondary add-xyz">＋ Add XYZ tile link</button><input type="file" id="files" multiple hidden><div id="import-job" class="import-job" role="status" aria-live="polite" hidden></div><div id="queue"></div><div class="tabs"><span class="active">Layers <b id="layer-count">0</b></span><button id="new-group" title="New layer group">＋ Group</button><button id="refresh">↻ Refresh</button></div><div id="layers"></div><div class="sidebar-bottom"><span class="mini-icon">▧</span><div><strong>Built for the field</strong><p>${LOCAL_TESTING?'Saved on this device. No account needed.':'Save to your account. Open on your phone.'}</p></div></div></aside><div id="sidebar-resizer" role="separator" aria-label="Resize layers sidebar" aria-orientation="vertical" aria-controls="sidebar" tabindex="0" title="Drag to resize sidebar · double-click to reset"></div>
<section class="map-area"><div id="map"></div><div class="map-title"><h1 id="map-name">Untitled project</h1><p id="map-subtitle">A clear view of all your spatial data.</p></div><div class="basemap-picker"><label for="basemap">View</label><select id="basemap" aria-label="Basemap"><option value="street">Street</option><option value="satellite">Satellite</option><option value="hybrid">Hybrid</option></select></div><div class="map-tools"><button id="mobile-layers" class="square" aria-label="Toggle layers">▱</button><button id="fit" class="square" aria-label="Fit all layers" title="Fit all layers">⤢</button><button id="locate" class="square" aria-label="Show my location" title="Show my location">◎</button><button id="open-table" class="square" title="Attribute table" aria-label="Attribute table">▦</button><button id="open-search" class="square" title="Find a hole or asset" aria-label="Find a hole or asset">⌕</button><button id="open-filter" class="square" title="Filter features" aria-label="Filter features">⏷</button><button id="open-drawing" class="square" title="Draw and edit layers" aria-label="Draw and edit layers">✍</button><button id="open-measure" class="square" title="Measure distance or area" aria-label="Measure distance or area">↔</button><button id="open-annotation" class="square" title="Add annotation" aria-label="Add annotation" hidden>✎</button><button id="identify" class="square" aria-label="Feature information" title="Feature information" aria-pressed="false">i</button><button id="help" class="square" aria-label="Import help" title="Import help">?</button></div><section id="feature-info" class="feature-info" aria-label="Feature information panel" hidden><div class="info-heading"><strong id="feature-info-title">Feature information</strong><button id="close-info" aria-label="Close feature information">×</button></div><div id="feature-info-content">Click a point, line or shape on the map to inspect its attributes.</div></section><div id="empty-map"><span class="empty-icon">▱</span><h2>Your map starts here.</h2><p>Add a survey, a boundary, or an entire project.<br>We’ll help put every layer in the right place.</p><button id="add-files" class="primary">＋ Add your first layers</button><small>Review coordinates before anything is saved.</small></div><div class="map-bottom"><div class="basemap-label"><span class="status-dot"></span> <span id="basemap-name">OpenStreetMap</span> <span class="divider">|</span> WGS 84 display</div><span id="coordinates">Move across the map to see coordinates</span></div></section></main>
<div id="toast" role="status" aria-live="polite" hidden></div>
<dialog id="password-dialog"><form id="password-form"><div class="dialog-heading"><h2>Set your password</h2><button type="button" class="square" data-close="password-dialog" aria-label="Close password settings">×</button></div><p class="field-note">Choose your password for future sign-ins.</p><label>New password<input id="new-password" type="password" minlength="12" required autocomplete="new-password"></label><label>Confirm password<input id="confirm-password" type="password" minlength="12" required autocomplete="new-password"></label><div id="password-error" class="error" role="alert"></div><div class="dialog-actions"><button id="save-password" class="primary" type="submit">Save password</button></div></form></dialog><dialog id="browser-import"><form id="browser-import-form"><div class="dialog-heading"><h2>Import browser projects</h2><button type="button" class="square" data-close="browser-import" aria-label="Close browser import">×</button></div><p class="field-note">Copy a project from this browser to your signed-in account. The browser copy stays intact. Cloud storage currently accepts files up to 50 MB each.</p><label>Browser project<select id="browser-project"></select></label><div id="browser-import-status" role="status"></div><div class="dialog-actions"><button type="submit" id="browser-import-submit" class="primary">Copy to my account</button></div></form></dialog><dialog id="review"><form id="review-form"><div class="dialog-heading"><div><span class="eyebrow">IMPORT REVIEW</span><h2 id="review-title">Review layer</h2></div><button type="button" class="square" data-close="review" aria-label="Close review">×</button></div><div id="review-summary" class="info-strip"></div><label>Layer name<input id="layer-name" required maxlength="160"></label><label>Source coordinate system <span class="required">Required</span><input id="crs-search" placeholder="Search EPSG number or description…" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="crs-results"></label><div id="crs-results" role="listbox" hidden></div><div id="crs-selected" class="selected-crs"></div><p id="import-crs-note" class="field-note"></p><button type="button" id="use-embedded" class="secondary" hidden>Use file CRS instead</button><div id="csv-fields" class="form-grid" hidden><label>X / longitude / easting<select id="csv-x"></select></label><label>Y / latitude / northing<select id="csv-y"></select></label></div><label>Height reference<select id="vertical"><option selected>RL</option><option>Unknown</option><option>AHD — Australian Height Datum</option><option>Ellipsoidal height</option><option>Local survey height</option><option>Other — recorded in source</option></select></label><p class="field-note">Heights are preserved as supplied. This version does not transform vertical datums.</p><details><summary>Advanced coordinates & local grids</summary><label>Custom CRS definition (WKT or PROJ)<textarea id="custom-crs" rows="2" placeholder="Optional: overrides the selected EPSG system"></textarea></label><label>Source coordinate epoch<input id="epoch" type="number" step="0.001" min="1900" max="2200" placeholder="For example, 2020.0"></label><label>Explicit PROJ transformation pipeline<textarea id="pipeline" rows="2" placeholder="Optional: expert-supplied operation"></textarea></label><label>Local-grid control points<textarea id="gcps" rows="3" placeholder="localX, localY, targetX, targetY&#10;At least 3 non-collinear points"></textarea></label><p class="field-note">Target X/Y must use your selected source CRS. A first-order fit positions local CAD or vector coordinates; verify against known points. Advanced settings apply to vectors.</p></details><div class="notice">Confirm the datum and zone, then check the map preview. Missing transformation grids can prevent import. Display alignment is not a survey-accuracy certification.</div><div id="review-error" class="error" role="alert"></div><div class="dialog-actions"><button type="button" id="preview-layer" class="secondary">Preview on map</button><button type="submit" id="import-layer" class="primary">Import layer →</button></div></form></dialog>
<dialog id="xyz-dialog"><form id="xyz-form"><div class="dialog-heading"><h2 id="xyz-title">Add XYZ tiles</h2><button type="button" class="square" data-close="xyz-dialog" aria-label="Close XYZ tiles">×</button></div><label>Layer name<input id="xyz-name" required maxlength="160" placeholder="e.g. Site aerial imagery"></label><label>XYZ tile URL<input id="xyz-url" required type="text" spellcheck="false" placeholder="https://example.com/tiles/{z}/{x}/{y}.png"></label><p class="field-note">Paste a Web Mercator (EPSG:3857) XYZ image tile link, including {z}, {x} and {y}. Optional {s} subdomains and {r} retina suffix are supported. Tiles load directly from your provider; this does not upload a GeoTIFF.</p><label>Attribution<input id="xyz-attribution" maxlength="500" placeholder="Provider credit / copyright"></label><div class="form-grid"><label>Minimum zoom<input id="xyz-min" type="number" min="0" max="22" value="0" required></label><label>Maximum native zoom<input id="xyz-max" type="number" min="0" max="22" value="19" required></label></div><p class="field-note">Use the zoom range supplied by your provider. Show on map returns to the map position where you added the link. URL keys are saved with the project; use browser-safe keys only.</p><div id="xyz-error" class="error" role="alert"></div><div class="dialog-actions"><button id="xyz-submit" class="primary" type="submit">Add tiles</button></div></form></dialog><dialog id="auth"><form id="auth-form"><div class="dialog-heading"><div><span class="eyebrow">YOUR SHARED WORKSPACE</span><h2>Take your maps with you.</h2></div><button type="button" class="square" data-close="auth" aria-label="Close sign in">×</button></div><p>Use the same account on your computer and phone to access your saved maps.</p><label>Email<input type="email" id="email" required autocomplete="email"></label><label>Password<input type="password" id="password" minlength="8" required autocomplete="current-password"></label><div id="auth-error" class="error" role="alert"></div><div class="dialog-actions"><button id="email-link" type="button" class="secondary">Email sign-in link</button><button id="signup" type="button" class="secondary">Create account</button><button type="submit" class="primary">Sign in →</button></div></form></dialog>
<dialog id="name-dialog"><form id="name-form"><div class="dialog-heading"><h2 id="project-dialog-title">New project</h2><button type="button" class="square" data-close="name-dialog" aria-label="Close project settings">×</button></div><label>Project name<input id="new-name" required maxlength="160" placeholder="e.g. Ironbark exploration"></label><label>Default coordinate system<input id="project-crs" list="project-crs-options" autocomplete="off" placeholder="Search EPSG number or name (optional)"></label><datalist id="project-crs-options"></datalist><p class="field-note">Prepopulated for each import into this project. You can choose a different CRS when reviewing a file. Leave blank to use the file’s CRS.</p><div id="project-error" class="error" role="alert"></div><div class="dialog-actions"><button type="submit" id="save-project" class="primary">Save project</button></div></form></dialog>
<dialog id="group-dialog"><form id="group-form"><div class="dialog-heading"><h2 id="group-title">New group</h2><button type="button" class="square" data-close="group-dialog" aria-label="Close group">×</button></div><label>Group name<input id="group-name" required maxlength="100" placeholder="e.g. Survey or Imagery"></label><div class="dialog-actions"><button class="primary" type="submit">Save group</button></div></form></dialog><dialog id="help-dialog"><div class="dialog-heading"><h2>From file to field</h2><button class="square" data-close="help-dialog" aria-label="Close help">×</button></div><ol><li>${LOCAL_TESTING?'Create a project without signing in. Projects stay in this browser.':'Sign in and create a project.'} Set its default CRS in Project settings, then switch projects using the selector.</li><li>Choose Street, Satellite or Hybrid from the View selector.</li><li>Add files together. For shapefiles, include .shp, .shx, .dbf and .prj, or upload a ZIP.</li><li>Review each layer. Search by EPSG code or description, or keep the embedded definition.</li><li>Preview its location, then import. ${LOCAL_TESTING?'Save in this browser to keep working after a refresh.':'Sign in to save to Supabase and open it on another device.'}</li></ol><p>Up to ${LOCAL_TESTING?'250 MB per GeoTIFF, 50 MB per other file':'50 MB per file for cloud storage'}, 300 MB per batch, and 20,000 features per vector layer. Raster imports run in the background after review; keep the tab open until complete. Raster display previews are reduced to 1,536 pixels on the longest side; originals are retained when saved.</p><p>KML and KMZ support points, lines and polygons, including names and descriptions. Original Google Earth icons, image overlays, tours and network links are not imported; apply map styling after import.</p><p>Supported formats depend on the bundled GDAL driver. DXF is supported; DWG is not guaranteed. Ungeoreferenced images need a world file or georeferencing before import.</p><p>Refresh retrieves saved changes. Offline downloads, live collaboration, survey-grade vertical transformations, and large-raster tiling are not yet included.</p></dialog>`;
const map=L.map('map',{zoomControl:false,preferCanvas:false}).setView([-25.5,134],4);
installSidebarResize($('#sidebar-resizer'),$('#sidebar'),()=>map.invalidateSize({pan:false,debounceMoveend:true}));
installBasemaps(L,map,$('#basemap'),$('#basemap-name'));
L.control.zoom({position:'bottomright'}).addTo(map);L.control.scale({position:'bottomleft',imperial:false}).addTo(map);
map.on('mousemove',e=>$('#coordinates').textContent=`${Math.abs(e.latlng.lat).toFixed(5)}° ${e.latlng.lat<0?'S':'N'}   ${Math.abs(e.latlng.lng).toFixed(5)}° ${e.latlng.lng<0?'W':'E'}`);
fetch(import.meta.env.BASE_URL+'crs.json').then(r=>r.json()).then(r=>{crsList=r;renderProjectCRS();}).catch(()=>toast('The EPSG catalogue could not load. Reload the page.'));
let toastTimer;function toast(msg){clearTimeout(toastTimer);$('#toast').textContent=msg;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
function setBusy(value,message){busy=value;refreshSaveStatus();$('#cloud-state').textContent=message||(LOCAL_TESTING?'Testing · saved in this browser':user?(workspaceContext?.platform_admin?'Platform admin':currentWorkspace?currentWorkspace.name+' · '+currentWorkspace.role:'Cloud workspace'):'Sign in to save projects');$('#files').disabled=value;}
function popup(feature,item){return item?featureInfo(item,feature,document):document.createElement('div');}
function featureClicked(item,f){if(fieldTools?.drawing||geometryEditor?.active)return;const index=item.fc.features.indexOf(f);if(explorer){explorer.select(item,index,false);return;}$('#feature-info-title').textContent=item.name;$('#feature-info-content').replaceChildren(popup(f,item));}
function makeLayer(item){const pane=layerPane(item);if(item.metadata?.xyz)return xyzLayer(L,item,toast,{pane});if(item.kind==='raster')return L.imageOverlay(item.url,[[item.bounds[1],item.bounds[0]],[item.bounds[3],item.bounds[2]]],{pane,opacity:item.opacity??0.8});const fc={...item.fc,features:item.fc.features.filter(f=>!explorer||explorer.acceptFeature(item,f))};if(item.metadata?.annotation)return annotationLayer(L,{...item,fc},{pane,onClick:f=>featureClicked(item,f)});return L.geoJSON(fc,{pane,style:f=>vectorStyle(item,f),pointToLayer:(f,ll)=>pointMarker(L,item,ll,{pane},f),onEachFeature:(f,l)=>l.on('click',()=>featureClicked(item,f))});}
function redrawLayer(l){const old=rendered.get(l.id);if(old)map.removeLayer(old);const next=makeLayer(l);rendered.set(l.id,next);if(isVisible(l))next.addTo(map);syncStack();}
function updateEmpty(){refreshSaveStatus();$('#empty-map').hidden=layers.length>0||!!preview;$('#layer-count').textContent=layers.length;$('#map-subtitle').textContent=layers.length?`${layers.length} layer${layers.length===1?'':'s'} · ${layers.filter(l=>l.saved).length} saved ${LOCAL_TESTING?'in this browser':'to your account'}`:'A clear view of all your spatial data.';}
function addLayer(item){layers.push(item);if(!flattenTree(layerTree).includes(item.id))layerTree.unshift(item.id);const ml=makeLayer(item);rendered.set(item.id,ml);if(isVisible(item))ml.addTo(map);renderLayers();updateEmpty();}
function fit(){const bounds=L.latLngBounds([]);for(const l of rendered.values())if(l.getBounds)bounds.extend(l.getBounds());if(preview)bounds.extend(preview.getBounds());if(bounds.isValid())map.fitBounds(bounds,{padding:[55,55],maxZoom:17});}
function layerCard(l){return `<article class="layer-card ${l.metadata?.annotation?'annotation-card':''}" data-id="${l.id}" data-node="${l.id}"><div class="layer-top"><button class="drag-handle" draggable="true" data-drag="${l.id}" title="Drag to reorder" aria-label="Drag ${esc(l.name)}">⠿</button><button class="layer-visibility" data-action="visibility" aria-label="Toggle visibility for ${esc(l.name)}" aria-pressed="${l.visible!==false}" title="${l.visible!==false?'Hide':'Show'} layer">${visibilityIcon(l.visible!==false)}</button><span class="geometry-symbol" style="color:${l.color}">${l.kind==='raster'?'▧':'◇'}</span><div><strong>${esc(l.name)}</strong><small>${l.metadata?.xyz?'XYZ tiles':l.kind==='raster'?'Raster preview':`${l.feature_count??l.fc?.features.length} features`} · ${l.saved?(LOCAL_TESTING?'Saved on this device':'Cloud saved'):'Unsaved'}</small></div><button data-action="settings" class="small-button" title="Layer settings" aria-label="Settings for ${esc(l.name)}">⚙</button><button data-action="zoom" class="small-button layer-zoom" aria-label="Show ${esc(l.name)} on map" title="Show on map"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></svg></button></div><div class="layer-bottom">${l.kind==='raster'?`<label class="raster-opacity">Opacity<input type="range" min="0" max="1" step="0.05" value="${l.opacity??.8}" data-action="opacity" aria-label="Layer opacity"></label>`:''}${l.metadata?.xyz?'<button data-action="edit-xyz" class="small-button" title="Edit tile link">Edit tiles</button>':`<button data-action="export" class="small-button" title="Download ${l.kind==='raster'?'preview':'GeoJSON'}">↓</button>`}${!l.saved?'<button data-action="save" class="save-chip">Save</button>':''}<button data-action="remove" class="small-button" title="Remove from this view">×</button></div>${layerOptionButtons(l)}${l.kind==='vector'&&!l.metadata?.annotation?styleControls(l):''}${organiseControls(l)}<div class="crs-tag">${esc(l.crsLabel||l.source_crs.match(/EPSG:\d+/)?.[0]||'Embedded CRS')} · ${esc(l.vertical_datum||'Height unknown')}</div></article>`;}

$('#layers').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(!b.closest('[data-id]'))return;const l=layers.find(l=>l.id===b.closest('[data-id]').dataset.id);if(!l)return;const action=b.dataset.action;if(action==='close-panel'){b.closest('[data-layer-panel]').hidden=true;for(const button of b.closest('[data-id]').querySelectorAll('[data-layer-options]'))button.setAttribute('aria-expanded','false');return;}if(action==='geometry'&&canEditLayer(l)){await openDrawing(l);return;}if(b.dataset.layerOptions){const card=b.closest('[data-id]'),name=b.dataset.layerOptions,opening=b.getAttribute('aria-expanded')!=='true';for(const button of $('#layers').querySelectorAll('[data-layer-options]'))button.setAttribute('aria-expanded',String(opening&&button===b));for(const panel of $('#layers').querySelectorAll('[data-layer-panel]'))panel.hidden=!(opening&&card.contains(panel)&&panel.dataset.layerPanel===name);return;}if(action==='settings'&&canEditLayer(l)){if(l.metadata?.annotation)openAnnotationSettings(l);else if(l.metadata?.manual)await openDrawing(l);else await openLayerSettings(l);}if(action==='edit-xyz')openXYZ(l);if(action==='visibility')await setVisibility(l,l.visible===false,b.closest('[data-id]'));if(action==='zoom'){const group=parentGroup(layerTree,l.id);if(group&&group.visible===false){group.visible=true;saveLayout();syncStack();}if(l.visible===false)await setVisibility(l,true,b.closest('[data-id]'));if(l.metadata?.xyz){const view=l.metadata.xyzView;map.setView(view.center,Math.max(view.zoom,l.metadata.xyz.minZoom));}else{const bounds=rendered.get(l.id).getBounds();if(bounds.isValid?.()===false)toast('No features match this layer’s filters. Reset the view or change the filters.');else map.fitBounds(bounds,{padding:[40,40],maxZoom:17});}}if(action==='remove'){map.removeLayer(rendered.get(l.id));rendered.delete(l.id);layers=layers.filter(x=>x!==l);renderLayers();updateEmpty();toast(l.saved?'Layer hidden from this view. Refresh restores saved layers.':'Unsaved layer removed.');}if(action==='save')await saveLayer(l).catch(e=>toast(errorText(e)));if(action==='export'){const a=document.createElement('a');a.href=l.kind==='raster'?l.url:URL.createObjectURL(new Blob([JSON.stringify(l.fc)],{type:'application/geo+json'}));a.download=l.name+(l.kind==='raster'?'.png':'.geojson');a.click();if(l.kind!=='raster')setTimeout(()=>URL.revokeObjectURL(a.href),1000);}});
async function setVisibility(l,visible,card){
 const button=card.querySelector('[data-action=visibility]');button.innerHTML=visibilityIcon(visible);button.setAttribute('aria-pressed',String(visible));button.title=visible?'Hide layer':'Show layer';
 await changeLayerStyle({target:{closest:()=>card,dataset:{action:'visibility'},checked:visible}});
}
function layerPane(item){
 if(!item._pane)item._pane='data-'+crypto.randomUUID();
 if(!map.getPane(item._pane))map.createPane(item._pane).style.zIndex='599';
 return item._pane;
}
function isVisible(item){return item.id!==geometryEditingId&&item.visible!==false&&parentGroup(layerTree,item.id)?.visible!==false;}
function syncStack(){
 const ids=flattenTree(layerTree).filter(id=>rendered.has(id));
 orderPanes(ids.map(id=>map.getPane(layers.find(l=>l.id===id)._pane)));
 ids.forEach(id=>{const l=layers.find(l=>l.id===id),ml=rendered.get(id);
  if(isVisible(l)){if(!map.hasLayer(ml))ml.addTo(map);}else if(map.hasLayer(ml))map.removeLayer(ml);
 });
 refreshLabels();explorer?.refresh();
}
function refreshLabels(){const bounds=map.getBounds().pad(.1);for(const l of layers)if(isVisible(l)&&l.kind==='vector'&&!l.metadata?.annotation)pointLabels(rendered.get(l.id),l,bounds,document);}
map.on('moveend zoomend',refreshLabels);
function refreshSaveStatus(){
 const status=$('#save-status');if(!status)return;
 if(isReadOnly()){status.textContent=activeMap?'Published · read only':'Choose a published project';$('#sync-project').disabled=true;$('#retry-save').hidden=true;$('#sync-status').textContent=activeMap?.published_version?`SYNC version ${activeMap.published_version}`:'';return;}
 const state=saves.state(),unsaved=layers.some(l=>!l.saved),failed=state.failed||layers.some(l=>l.saveError);
 status.textContent=syncing?'Syncing…':state.pending||layers.some(l=>l.saving)||layoutPending?'Saving…':failed?'Save failed':syncError?'Sync failed — retry SYNC':unsaved||queue.length?'Unsaved changes':!user?'Sign in to save':!activeMap?'Choose a project':LOCAL_TESTING?'Saved in this browser':'Saved';
 $('#retry-save').hidden=!failed;$('#retry-save').disabled=syncing||state.pending;
 $('#sync-project').disabled=LOCAL_TESTING||!user||!activeMap||busy||syncing||queue.length>0;
 const date=activeMap?.last_synced_at;
 $('#sync-status').textContent=!activeMap?'':date?`${syncDirty||Number(activeMap.draft_revision)!==Number(activeMap.last_synced_revision)?'Changes not synced · ':''}Last sync ${new Date(date).toLocaleString()}`:'Not synced to operators';
}
async function retrySaves(){await saves.retry();for(const l of layers.filter(l=>!l.saved))await saveLayer(l);refreshSaveStatus();}
$('#retry-save').onclick=()=>retrySaves().catch(e=>toast('Save failed: '+errorText(e)));
$('#sync-project').onclick=async()=>{
 if(isReadOnly()||syncing||busy||!activeMap||!user)return;
 if(geometryEditor?.pending)return toast('Save or discard drawing edits before syncing.');
 if(queue.length)return toast('Finish or discard queued imports before syncing.');
 syncing=true;syncError=false;setBusy(true,'Syncing project…');$('#sidebar').inert=true;refreshSaveStatus();
 try{
  await retrySaves();await saves.flush();await saveLayout();await saves.flush();
  const release=await syncProjectRelease(db,activeMap.id,user.id,message=>$('#save-status').textContent=message);
  activeMap.last_synced_at=release.published_at;activeMap.last_synced_revision=release.source_revision;activeMap.draft_revision=release.source_revision;syncDirty=false;
  toast(`SYNC complete — version ${release.version} is ready for assigned operators.`);
 }catch(e){syncError=true;toast('SYNC could not be confirmed. Click SYNC to retry safely. '+errorText(e));}
 finally{syncing=false;setBusy(false);$('#sidebar').inert=false;refreshSaveStatus();}
};
function readLayout(){
 if(activeMap?.layer_layout)return activeMap.layer_layout;
 try{return JSON.parse(localStorage.getItem(`maps-layout:${user?.id}:${activeMap?.id}`)||'[]');}catch{return [];}
}
function saveLayout(){
 if(!activeMap||isReadOnly())return Promise.resolve();
 const project=activeMap,snapshot=structuredClone(layerTree);project.layer_layout=snapshot;layoutPending++;
 refreshSaveStatus();const task=saves.run(`layout:${project.id}`,async()=>{
  const{error}=await db.from('maps').update({layer_layout:snapshot}).eq('id',project.id);if(error)throw error;
 }).catch(e=>toast('Layer arrangement could not save: '+errorText(e))).finally(()=>{layoutPending--;refreshSaveStatus();});
 layoutSave=task;return task;
}
function replaceTreeId(oldID,newID){const list=parentGroup(layerTree,oldID)?.children||layerTree;const i=list.indexOf(oldID);if(i!==-1)list[i]=newID;}
function layerOptionButtons(l){
 const svg=paths=>`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
 return `<div class="layer-option-buttons">${l.kind==='vector'&&!l.metadata?.annotation?'<button data-action="geometry" class="geometry-edit-button" title="Edit geometry" aria-label="Edit geometry">✍</button>':''}${l.kind==='vector'&&!l.metadata?.annotation?`<button type="button" data-layer-options="style" aria-expanded="false" aria-label="Style layer" title="Style layer">${svg('<path d="m14 4 6 6-9 9H5v-6zM12 6l6 6M4 22h16"/>')}</button>`:''}<button type="button" data-layer-options="organise" aria-expanded="false" aria-label="Organise layer" title="Organise layer">${svg('<path d="M3 6V3h6l2 3h10v15H3zM7 11h10M7 15h10"/>')}</button></div>`;
}
function organiseControls(l){return `<div class="organise-controls" data-layer-panel="organise" hidden><div class="organise-row"><button type="button" data-move="${l.id}" data-direction="-1" aria-label="Move ${esc(l.name)} up">↑ Up</button><button type="button" data-move="${l.id}" data-direction="1" aria-label="Move ${esc(l.name)} down">↓ Down</button></div><label>Group<select data-membership="${l.id}" aria-label="Group for ${esc(l.name)}"><option value="">Ungrouped</option>${layerTree.filter(n=>typeof n!=='string').map(g=>`<option value="${g.id}" ${g.children.includes(l.id)?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label></div>`;}
function renderLayers(){
 const card=id=>{const l=layers.find(l=>l.id===id);return l?layerCard(l):'';};
 $('#layers').innerHTML='<p class="order-hint">Top of list draws on top · drag ⠿ to arrange</p>'+layerTree.map(n=>typeof n==='string'?card(n):`<section class="layer-group" data-group="${n.id}"><div class="group-heading" data-group-drop="${n.id}" data-node="${n.id}"><button class="drag-handle" draggable="true" data-drag="${n.id}" aria-label="Drag group ${esc(n.name)}">⠿</button><button class="group-collapse" data-group-action="collapse" aria-expanded="${!n.collapsed}">${n.collapsed?'▸':'▾'} ${esc(n.name)} <small>${n.children.filter(id=>layers.some(l=>l.id===id)).length}</small></button><button class="layer-visibility" data-group-action="visibility" aria-label="Toggle group ${esc(n.name)}" aria-pressed="${n.visible!==false}">${visibilityIcon(n.visible!==false)}</button><button data-group-action="rename" title="Rename group" aria-label="Rename group ${esc(n.name)}">✎</button></div><div class="group-contents" ${n.collapsed?'hidden':''}>${n.children.map(card).join('')}<div class="group-drop-zone" data-group-drop="${n.id}">Drop layers into this group</div><div class="group-actions"><button data-move="${n.id}" data-direction="-1" aria-label="Move group ${esc(n.name)} up">↑</button><button data-move="${n.id}" data-direction="1" aria-label="Move group ${esc(n.name)} down">↓</button><button data-group-action="remove">Ungroup</button></div></div></section>`).join('')+'<div class="root-drop-zone" data-root-drop="true">Drop here to move outside groups</div>';
 syncStack();workspaceLayout?.refresh();
}
function arrangementChanged(){renderLayers();saveLayout();}
let editingGroup=null;
function groupDialog(group=null){if(busy||layers.some(l=>l.saving))return toast('Wait for the import or save to finish.');editingGroup=group;$('#group-name').value=group?.name||'';$('#group-title').textContent=group?'Rename group':'New group';$('#group-dialog').showModal();}
$('#new-group').onclick=()=>groupDialog();
$('#group-form').onsubmit=e=>{e.preventDefault();const name=$('#group-name').value.trim();if(!name)return;if(editingGroup)editingGroup.name=name;else layerTree.unshift({id:'group-'+crypto.randomUUID(),name,children:[],visible:true,collapsed:false});$('#group-dialog').close();arrangementChanged();};
$('#layers').addEventListener('click',e=>{
 if(busy||layers.some(l=>l.saving))return;
 const move=e.target.closest('[data-move]');
 if(move){const id=move.dataset.move,list=parentGroup(layerTree,id)?.children||layerTree,index=list.findIndex(n=>nodeId(n)===id),other=list[index+Number(move.dataset.direction)];if(other){moveNode(layerTree,id,nodeId(other),Number(move.dataset.direction)<0?'before':'after');arrangementChanged();}return;}
 const button=e.target.closest('[data-group-action]');if(!button)return;
 const group=layerTree.find(n=>typeof n!=='string'&&n.id===button.closest('[data-group]').dataset.group);if(!group)return;
 const action=button.dataset.groupAction;
 if(action==='rename')return groupDialog(group);
 if(action==='collapse')group.collapsed=!group.collapsed;
 if(action==='visibility')group.visible=group.visible===false;
 if(action==='remove'){const index=layerTree.indexOf(group);layerTree.splice(index,1,...group.children);}
 arrangementChanged();
});
$('#layers').addEventListener('change',e=>{if(e.target.dataset.membership){if(busy||layers.some(l=>l.saving)){renderLayers();return;}moveNode(layerTree,e.target.dataset.membership,e.target.value,e.target.value?'inside':'after');arrangementChanged();}});
let draggedNode=null;
let pointerDrag=null;
$('#layers').addEventListener('pointerdown',e=>{
 const handle=e.target.closest('[data-drag]');if(!handle||e.button!==0||busy||layers.some(l=>l.saving))return;
 pointerDrag={id:handle.dataset.drag,x:e.clientX,y:e.clientY,pointer:e.pointerId,handle,started:false};handle.setPointerCapture(e.pointerId);
});
$('#layers').addEventListener('pointermove',e=>{
 if(!pointerDrag||pointerDrag.pointer!==e.pointerId)return;
 if(!pointerDrag.started&&Math.hypot(e.clientX-pointerDrag.x,e.clientY-pointerDrag.y)<5)return;
 pointerDrag.started=true;draggedNode=pointerDrag.id;e.preventDefault();$('#layers').classList.add('reordering');clearDropMarks();
 const target=dropTarget({target:document.elementFromPoint(e.clientX,e.clientY),clientY:e.clientY});if(target)target.el.classList.add('drop-'+target.position);
 const side=$('#sidebar'),rect=side.getBoundingClientRect();if(e.clientY<rect.top+35)side.scrollTop-=12;else if(e.clientY>rect.bottom-35)side.scrollTop+=12;
});
function finishPointerDrag(e){
 if(!pointerDrag)return;const drag=pointerDrag;pointerDrag=null;
 if(drag.handle.hasPointerCapture(e.pointerId))drag.handle.releasePointerCapture(e.pointerId);
 if(drag.started&&e.type==='pointerup'){const target=dropTarget({target:document.elementFromPoint(e.clientX,e.clientY),clientY:e.clientY});if(target&&moveNode(layerTree,drag.id,target.id,target.position))arrangementChanged();}
 draggedNode=null;clearDropMarks();$('#layers').classList.remove('reordering');
}
$('#layers').addEventListener('pointerup',finishPointerDrag);$('#layers').addEventListener('pointercancel',finishPointerDrag);
$('#layers').addEventListener('dragstart',e=>{if(pointerDrag){e.preventDefault();}},true);
$('#layers').addEventListener('dragstart',e=>{const handle=e.target.closest('[data-drag]');if(!handle)return;if(busy||layers.some(l=>l.saving)){e.preventDefault();return;}draggedNode=handle.dataset.drag;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedNode);$('#layers').classList.add('reordering');});
function clearDropMarks(){for(const el of $('#layers').querySelectorAll('.drop-before,.drop-after,.drop-inside'))el.classList.remove('drop-before','drop-after','drop-inside');}
function dropTarget(e){
 if(!e.target)return;
 const card=e.target.closest('.layer-card');if(card)return {id:card.dataset.id,position:e.clientY<card.getBoundingClientRect().top+card.getBoundingClientRect().height/2?'before':'after',el:card};
 const group=e.target.closest('[data-group-drop]');if(group)return {id:group.dataset.groupDrop,position:typeof layerTree.find(n=>nodeId(n)===draggedNode)==='object'?'before':'inside',el:group};
 const root=e.target.closest('[data-root-drop]');if(root)return {id:null,position:'after',el:root};
}
$('#layers').addEventListener('dragover',e=>{if(!draggedNode)return;e.preventDefault();e.dataTransfer.dropEffect='move';clearDropMarks();const target=dropTarget(e);if(target)target.el.classList.add('drop-'+target.position);});
$('#layers').addEventListener('drop',e=>{if(!draggedNode)return;e.preventDefault();e.stopPropagation();const target=dropTarget(e);if(target&&moveNode(layerTree,draggedNode,target.id,target.position))arrangementChanged();draggedNode=null;clearDropMarks();$('#layers').classList.remove('reordering');});
$('#layers').addEventListener('dragend',()=>{draggedNode=null;clearDropMarks();$('#layers').classList.remove('reordering');});
const styleNumbers=new Set(['pointSize','lineWidth','fillOpacity']);
const styleKeys=new Set(['symbol','pointSize','lineStyle','lineWidth','fillColor','fillOpacity','labelField','rules','view','popup']);
const styleSaves=new Map();
$('#layers').addEventListener('click',e=>{
 const button=e.target.closest('[data-action="attribute-style"]');if(!button||busy)return;
 const card=button.closest('[data-id]'),layer=layers.find(l=>l.id===card?.dataset.id);if(!layer||layer.saving||!canEditLayer(layer))return;
 openAttributeStyle(layer,async rules=>{if(!layers.includes(layer))throw new Error('This layer is no longer open.');await changeLayerStyle({target:{closest:()=>card,dataset:{action:'rules'},value:rules}});renderLayers();});
});
async function changeLayerStyle(e){
 const card=e.target.closest('[data-id]');if(!card)return;
 const l=layers.find(l=>l.id===card.dataset.id),action=e.target.dataset.action;if(!l||(!canEditLayer(l)&&action!=='visibility'))return;
 if(action==='visibility')l.visible=e.target.checked;
 else if(action==='color'||action==='opacity')l[action]=action==='opacity'?Number(e.target.value):e.target.value;
 else if(styleKeys.has(action)){l.metadata={...l.metadata,style:{...l.metadata?.style,[action]:styleNumbers.has(action)?Number(e.target.value):e.target.value}};}
 else return;
 if(e.target.type==='range'){const output=e.target.parentElement.querySelector('output');if(output)output.textContent=Math.round(Number(e.target.value)*100)+'%';}
 map.removeLayer(rendered.get(l.id));const next=makeLayer(l);rendered.set(l.id,next);if(isVisible(l))next.addTo(map);syncStack();
 if(l.saved&&canEditLayer(l)){
  const payload={visible:l.visible!==false,color:l.color,opacity:l.opacity??.8,metadata:l.metadata||{}};
  const save=saves.run(`style:${l.id}`,async()=>{const {error}=await db.from('layers').update(payload).eq('id',l.id);if(error)throw error;}).catch(error=>toast('Style changed here, but could not save: '+error.message));
  styleSaves.set(l.id,save);await save;if(styleSaves.get(l.id)===save)styleSaves.delete(l.id);
 }
}
$('#layers').addEventListener('input',e=>{if(e.target.type==='number'){if(e.target.value!==''&&e.target.validity.valid)changeLayerStyle(e).catch(error=>toast(errorText(error)));return;}if(e.target.type==='range'||e.target.type==='color'){
 const card=e.target.closest('[data-id]'),l=layers.find(l=>l.id===card?.dataset.id);if(!l)return;
 const action=e.target.dataset.action;if(!canEditLayer(l))return;
 if(action==='color'||action==='opacity')l[action]=action==='opacity'?Number(e.target.value):e.target.value;
 else if(action==='fillColor'||action==='fillOpacity')l.metadata={...l.metadata,style:{...l.metadata?.style,[action]:action==='fillOpacity'?Number(e.target.value):e.target.value}};
 const output=e.target.parentElement.querySelector('output');if(output)output.textContent=Math.round(Number(e.target.value)*100)+'%';
 map.removeLayer(rendered.get(l.id));const next=makeLayer(l);rendered.set(l.id,next);if(isVisible(l))next.addTo(map);syncStack();
}});
$('#layers').addEventListener('change',e=>changeLayerStyle(e).catch(error=>toast(errorText(error))));
function renderQueue(){$('#queue').innerHTML=queue.length?`<div class="list-heading">IMPORT QUEUE <span>${queue.length}</span></div>`+queue.map((q,i)=>`<div class="queue-item"><div><strong>${esc(q.name)}</strong><small>${esc(q.format)} · ${q.source?'CRS detected':'Choose coordinate system'}</small></div><button class="review-button" data-index="${i}">Review →</button><button class="small-button" data-discard="${i}" aria-label="Discard ${esc(q.name)} from import queue">×</button></div>`).join(''):'';}
async function handleFiles(files){if(isReadOnly()||busy||!files.length)return;if(!LOCAL_TESTING&&[...files].some(f=>f.size>CLOUD_FILE_LIMIT))return toast('Cloud storage currently accepts files up to 50 MB each. Use an XYZ tile link for larger imagery.');setBusy(true,'Loading GIS engine…');importJob('Reading files','Loading GIS engine…');toast('Loading files and inspecting their coordinate systems…');try{const result=await inspect(files,m=>{$('#cloud-state').textContent=m;importJob('Reading files',m);});queue.push(...result.items);renderQueue();if(result.errors.length){$('#review-error').textContent='';toast(result.errors.join('\n'));$('#queue').insertAdjacentHTML('beforeend',`<div class="error import-errors">${result.errors.map(esc).join('<br>')}</div>`);}if(result.items.length){setBusy(false);openReview(queue.length-result.items.length);}}catch(e){toast(errorText(e))}finally{setBusy(false);$('#files').value='';$('#import-job').hidden=true;}}
$('#files').onchange=e=>handleFiles(e.target.files);for(const selector of ['#dropzone','#add-files'])$(selector).onclick=()=>{if(!busy)$('#files').click();};$('#dropzone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#files').click();}};
let dragDepth=0;document.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;$('#dropzone').classList.add('dragging')}});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',()=>{if(--dragDepth<=0)$('#dropzone').classList.remove('dragging')});document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('#dropzone').classList.remove('dragging');handleFiles(e.dataTransfer.files)});
$('#queue').onclick=e=>{if(busy)return;const discard=e.target.closest('[data-discard]');if(discard){queue.splice(Number(discard.dataset.discard),1);if(preview){map.removeLayer(preview);preview=null;}renderQueue();updateEmpty();return;}const b=e.target.closest('[data-index]');if(b)openReview(Number(b.dataset.index));};
let selectedCRS='',selectedLabel='';
function selectCRS(code,label){selectedCRS=code;selectedLabel=label;$('#crs-search').value=label;$('#crs-selected').textContent=code?`✓ ${label}`:'Choose an EPSG system or enter a custom definition below.';$('#crs-results').hidden=true;$('#crs-search').setAttribute('aria-expanded','false');}
function openReview(i){if(busy)return;reviewIndex=i;const q=queue[i];$('#review-form').reset();$('#review-title').textContent=q.name;$('#layer-name').value=q.name;$('#review-summary').textContent=`${q.format} · ${q.kind==='raster'?`${q.info.size?.join(' × ')} pixels`:`${q.count.toLocaleString()} features`}`;$('#review-error').textContent='';$('#csv-fields').hidden=!q.rows;
 let label='';if(q.source){const codes=[...q.source.matchAll(/(?:ID|AUTHORITY)\["EPSG",\s*"?(\d+)/g)];const code=codes.at(-1)?.[1];label=code?`EPSG:${code} — ${crsList.find(c=>c.code==='EPSG:'+code)?.name||'Embedded definition'}`:q.source.match(/^[^\[]+\["([^"]+)/)?.[1]||'Embedded coordinate system';}
 const initial=importCRS(/^(KML|KMZ)$/.test(q.format)?null:activeMap,q.source,label);selectCRS(initial.code,initial.label);
 $('#import-crs-note').textContent=initial.fromProject?`Project default: ${initial.label}. You can change it for this import.${q.source?' This file also contains an embedded CRS: '+label+'.':''}`:'';
 $('#use-embedded').hidden=!q.source||!initial.fromProject;$('#use-embedded').onclick=()=>{selectCRS(q.source,label);$('#custom-crs').value='';$('#import-crs-note').textContent='Using the file’s embedded CRS for this import.';};
 if(/^(KML|KMZ)$/.test(q.format))$('#import-crs-note').textContent='KML/KMZ coordinates use WGS 84. The file CRS is preselected.';
 if(q.rows){for(const s of ['#csv-x','#csv-y'])$(s).innerHTML=q.fields.map(f=>`<option>${esc(f)}</option>`).join('');$('#csv-x').value=q.fields.find(f=>/^(lon|lng|longitude|easting|x)$/i.test(f))||q.fields[0];$('#csv-y').value=q.fields.find(f=>/^(lat|latitude|northing|y)$/i.test(f))||q.fields[1]||q.fields[0];}
 if(q.review){const r=q.review;selectCRS(r.selectedCRS,r.selectedLabel);$('#layer-name').value=r.name;$('#custom-crs').value=r.custom;$('#vertical').value=r.vertical;$('#csv-x').value=r.x;$('#csv-y').value=r.y;$('#epoch').value=r.epoch;$('#pipeline').value=r.pipeline;$('#gcps').value=r.gcps;}
 if(q.editLayer){$('#import-crs-note').textContent='Editing this layer’s source settings. Save to rebuild it from the original file.';$('#use-embedded').hidden=true;}$('#import-layer').textContent=q.editLayer?'Save layer settings':'Import layer →';$('#review').showModal();}
$('#crs-search').oninput=()=>{selectedCRS='';selectedLabel='';$('#crs-selected').textContent='Select a result to confirm the coordinate system.';const term=$('#crs-search').value.toLowerCase().trim();const terms=term.replace('epsg:','').split(/\s+/);let matches=crsList.filter(c=>terms.every(t=>(c.code+' '+c.name).toLowerCase().includes(t)));matches.sort((a,b)=>Number(b.code.toLowerCase()==='epsg:'+term)-Number(a.code.toLowerCase()==='epsg:'+term));matches=matches.slice(0,40);$('#crs-results').innerHTML=matches.map(c=>`<button type="button" role="option" data-code="${c.code}"><b>${c.code}</b><span>${esc(c.name)}</span></button>`).join('')||'<p>No matching EPSG reference. You can enter WKT or PROJ under advanced settings.</p>';$('#crs-results').hidden=false;$('#crs-search').setAttribute('aria-expanded','true');};
$('#crs-results').onclick=e=>{const b=e.target.closest('[data-code]');if(b){const c=crsList.find(c=>c.code===b.dataset.code);selectCRS(c.code,`${c.code} — ${c.name}`);}};
function settings(){if(queue[reviewIndex].rows&&$('#csv-x').value===$('#csv-y').value)throw Error('Choose different columns for X and Y.');return {crs:$('#custom-crs').value.trim()||selectedCRS,x:$('#csv-x').value,y:$('#csv-y').value,epoch:$('#epoch').value,pipeline:$('#pipeline').value.trim(),gcps:$('#gcps').value.trim()};}
async function convertCurrent(progress){const q=queue[reviewIndex];const s=settings();q.review={selectedCRS,selectedLabel,name:$('#layer-name').value,custom:$('#custom-crs').value,vertical:$('#vertical').value,...s};const name=$('#layer-name').value||q.name,crsLabel=$('#custom-crs').value?'Custom definition':selectedLabel,vertical_datum=$('#vertical').value;const data=await cachedConversion(q,s,convert,progress);return {id:crypto.randomUUID(),name,kind:q.kind,color:colours[layers.length%colours.length],opacity:.85,visible:true,source_crs:s.crs,crsLabel,vertical_datum,metadata:{format:q.format,import_settings:{...q.review},source_layer:q.layerName,source_names:q.files.map(f=>f.name),source_epoch:s.epoch||null,pipeline:s.pipeline||null,control_points:s.gcps||null,height_transformation:'none',engine:'GDAL 3.8 / PROJ 9.3 browser',display_only:true},files:q.files,...data,url:data.blob?URL.createObjectURL(data.blob):null,saved:false};}
async function openLayerSettings(layer){
 if(busy||layer.saving)return toast('Wait for the current import or save to finish.');
 if(layer.metadata?.xyz)return openXYZ(layer);
 const existing=queue.findIndex(q=>q.editLayer===layer);if(existing>=0)return openReview(existing);
 setBusy(true,'Opening original layer settings…');
 try{
  let files=layer.files;
  if(!files?.length){files=[];for(const [i,path] of (layer.original_paths||[]).filter(p=>p!==layer.raster_path&&!p.endsWith('/display.png')).entries()){
   const {data,error}=await db.storage.from('gis-files').download(path);if(error)throw error;
   files.push(new File([data],layer.metadata?.source_names?.[i]||path.split('/').at(-1)));
  }}
  if(!files.length)throw Error('The original file is unavailable. Import the source file again to change its coordinate settings.');
  const result=await inspect(files,message=>$('#cloud-state').textContent=message);
  const candidates=result.items.filter(q=>q.kind===layer.kind);
  const q=candidates.find(q=>q.layerName&&q.layerName===layer.metadata?.source_layer)|| (candidates.length===1?candidates[0]:candidates.find(q=>q.name===layer.name));
  if(!q)throw Error(result.errors.join('\n')||'Could not identify the original dataset. Import the source file again.');
  const m=layer.metadata||{};
  q.editLayer=layer;q.review={selectedCRS:layer.source_crs,selectedLabel:layer.crsLabel||layer.source_crs,custom:'',epoch:m.source_epoch||'',pipeline:m.pipeline||'',gcps:m.control_points||'',x:q.fields?.find(f=>/^(lon|lng|longitude|easting|x)$/i.test(f))||q.fields?.[0],y:q.fields?.find(f=>/^(lat|latitude|northing|y)$/i.test(f))||q.fields?.[1],...m.import_settings,name:layer.name,vertical:layer.vertical_datum||'Unknown'};
  queue.push(q);renderQueue();setBusy(false);openReview(queue.length-1);
 }catch(e){toast(errorText(e));}finally{setBusy(false);}
}
async function replaceLayer(old,next){
 const metadata={...old.metadata,...next.metadata,style:old.metadata?.style,crs_label:next.crsLabel};
 const payload={name:next.name,source_crs:next.source_crs,vertical_datum:next.vertical_datum,metadata,bounds:next.bounds};
 let rasterPath;
 if(old.saved){
  await styleSaves.get(old.id);
  if(next.kind==='vector'&&LOCAL_TESTING){payload.fc=next.fc;payload.feature_count=next.fc.features.length;}
  else if(next.kind==='raster'){rasterPath=`${user.id}/${crypto.randomUUID()}/display.png`;const {error}=await db.storage.from('gis-files').upload(rasterPath,next.blob);if(error)throw error;payload.raster_path=rasterPath;}
  const {error}=next.kind==='vector'&&!LOCAL_TESTING?await db.rpc('replace_vector',{p_layer_id:old.id,p_layer:payload,p_features:next.fc.features}):await db.from('layers').update(payload).eq('id',old.id).select('id').single();
  if(error){if(rasterPath)await db.storage.from('gis-files').remove([rasterPath]);throw error;}
 }
 const oldURL=old.url,oldRaster=old.raster_path;
 syncDirty=true;map.removeLayer(rendered.get(old.id));Object.assign(old,payload,{fc:next.fc,blob:next.blob,url:next.url,files:next.files});
 const ml=makeLayer(old);rendered.set(old.id,ml);if(isVisible(old))ml.addTo(map);renderLayers();updateEmpty();
 if(oldURL?.startsWith('blob:'))URL.revokeObjectURL(oldURL);
 if(rasterPath&&oldRaster)await db.storage.from('gis-files').remove([oldRaster]);
}
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
   if(q.editLayer)await replaceLayer(q.editLayer,l);else addLayer(l);queue.splice(queue.indexOf(q),1);renderQueue();$('#review').close();if(!background)fit();
   if(user&&!q.editLayer){try{await saveLayer(l,progress);}catch(e){if(background)importJob(l.name,'Imported, but saving failed: '+errorText(e)+' Use Save on the layer to retry.',false);toast('Imported; saving needs attention: '+errorText(e));return;}}
   else toast(q.editLayer?'Layer settings saved.':'Layer imported. Sign in and save to access it on your phone.');
   if(background)importJob(l.name,'Import complete. Use the target icon beside the layer to show it on the map.',false);
  }
 }catch(e){if(background){importJob(q.name,'Import failed: '+errorText(e)+' Select Review to retry.',false);toast('Raster import failed. Your file remains in the import queue.');}else $('#review-error').textContent=errorText(e);}
 finally{setBusy(false);$('#import-layer').disabled=$('#preview-layer').disabled=false;}
}
$('#preview-layer').onclick=()=>reviewAction(true);$('#review-form').onsubmit=e=>{e.preventDefault();reviewAction(false);};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>document.getElementById(b.dataset.close).close();
let editingXYZ=null;
function openXYZ(layer=null){
 if(isReadOnly())return;
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
   syncDirty=true;Object.assign(l,{name,metadata});refreshSaveStatus();map.removeLayer(rendered.get(l.id));const next=makeLayer(l);rendered.set(l.id,next);if(isVisible(l))next.addTo(map);syncStack();renderLayers();
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
let identifyActive=false;
function identify(value){identifyActive=value;$('#identify').setAttribute('aria-pressed',String(value));$('#feature-info').hidden=!value;$('#map').classList.toggle('identifying',value);if(value){map.closePopup();$('#feature-info-title').textContent='Feature information';$('#feature-info-content').textContent='Click a point, line or shape on the map to inspect its attributes.';}}
$('#identify').onclick=()=>identify(!identifyActive);$('#close-info').onclick=()=>identify(false);
$('#fit').onclick=fit;$('#help').onclick=()=>$('#help-dialog').showModal();$('#mobile-layers').onclick=()=>$('#sidebar').classList.toggle('mobile-open');
let locationMarker;$('#locate').onclick=()=>{if(!navigator.geolocation)return toast('Location is unavailable in this browser.');navigator.geolocation.getCurrentPosition(p=>{if(locationMarker)map.removeLayer(locationMarker);locationMarker=L.circle([p.coords.latitude,p.coords.longitude],{radius:p.coords.accuracy,color:'#3087ba',fillOpacity:.15}).addTo(map).bindPopup(`GPS accuracy: approximately ${Math.round(p.coords.accuracy)} m`);map.setView(locationMarker.getLatLng(),16)},e=>toast(e.message),{enableHighAccuracy:true,timeout:15000});};
$('#account').onclick=async()=>{if(user&&(geometryEditor?.pending||fieldTools?.pending||busy||layoutPending||styleSaves.size||saves.state().failed||queue.length||layers.some(l=>!l.saved||l.saving)))return toast('Finish pending imports and saves before signing out.');if(user){const {error}=await db.auth.signOut();if(error)return toast(errorText(error));clearMap();activeMap=null;$('#map-select').innerHTML='<option value="">Unsaved project</option>';syncProject();queue=[];renderQueue();toast('Signed out.')}else registration.open(false);};
const registration=installRegistration(db,{getUser:()=>user,onCreated:refreshWorkspaces});
$('#get-started').onclick=()=>registration.open(true);
$('#start-company').onclick=()=>registration.showSetup();
let browserBackup,browserProjects=[];
$('#browser-projects').onclick=async()=>{
 if(!user||busy||layoutPending||styleSaves.size||queue.length||layers.some(l=>!l.saved||l.saving))return toast('Finish current imports and saves first.');
 try{
  browserBackup??=createLocalWorkspace();const {data,error}=await browserBackup.from('maps').select('*').order('created_at');if(error)throw error;
  browserProjects=data;$('#browser-project').innerHTML=data.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('#browser-import-status').textContent=data.length?'Choose a project to copy.':'No saved projects were found in this browser.';$('#browser-import-submit').disabled=!data.length;$('#browser-import').showModal();
 }catch(e){toast(errorText(e));}
};
$('#browser-import-form').onsubmit=async e=>{
 e.preventDefault();if(busy||!user)return;
 const project=browserProjects.find(p=>p.id===$('#browser-project').value);if(!project)return;
 setBusy(true,'Copying browser project to your account…');$('#browser-import-submit').disabled=true;
 try{
  const id=await transferProject(browserBackup,db,project,user.id,message=>$('#browser-import-status').textContent=message,currentWorkspace?.id);
  maps=await listMaps();$('#browser-import').close();setBusy(false);await loadMap(id);toast('Project copied to your account. The browser backup is unchanged.');
 }catch(e){$('#browser-import-status').textContent=errorText(e);}
 finally{setBusy(false);$('#browser-import-submit').disabled=false;}
};
async function listMaps(){
 if(!LOCAL_TESTING&&workspaceContext&&!currentWorkspace){$('#map-select').innerHTML='<option value="">No project selected</option>';return [];}
 let result;if(isReadOnly())result={data:await publishedProjects(db)};else{let request=db.from('maps').select('*');if(!LOCAL_TESTING&&currentWorkspace)request=request.eq('workspace_id',currentWorkspace.id);result=await request.order('created_at');}
 if(result.error)throw result.error;const data=!LOCAL_TESTING&&workspaceContext?(result.data||[]).filter(m=>m.workspace_id===currentWorkspace?.id):result.data||[];
 $('#map-select').innerHTML='<option value="">Unsaved project</option>'+data.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');if(activeMap)$('#map-select').value=activeMap.id;return data;
}
const accountUI=installAccounts(db,()=>user,document,{getWorkspace:()=>currentWorkspace,getContext:()=>workspaceContext||{},onChanged:refreshWorkspaces,canOpen:()=>{if(workspacePending()){toast('Finish pending edits and saves before changing workspace access.');return false;}return true;}});
const passwordSetup=installPasswordSetup(db,authLink,()=>user,toast);
let maps=[];db.auth.onAuthStateChange((event,session)=>{const previousUser=user;user=session?.user||null;if(previousUser?.id!==user?.id){workspaceContext=null;currentWorkspace=null;}updateAccess();$('#get-started').hidden=LOCAL_TESTING||!!user;if(!user){registration.reset();accountUI.close();workspaceContext=null;currentWorkspace=null;renderWorkspaces();}if(previousUser&&(previousUser.id!==user?.id||previousUser.app_metadata?.maps_role!==user?.app_metadata?.maps_role)){clearMap();activeMap=null;queue=[];renderQueue();syncProject();}if(!LOCAL_TESTING)setTimeout(()=>passwordSetup.onSession(event,session),0);$('#browser-projects').hidden=true;$('#account').innerHTML=user?'Sign out ↗':'Sign in ↗';$('#cloud-state').textContent=LOCAL_TESTING?'Testing · saved in this browser':user?(workspaceContext?.platform_admin?'Platform admin':currentWorkspace?currentWorkspace.name+' · '+currentWorkspace.role:'Cloud workspace'):'Sign in to save projects';refreshSaveStatus();if(user)setTimeout(async()=>{try{if(!LOCAL_TESTING&&db.rpc){await loadWorkspaces();updateAccess();}maps=await listMaps();if(!activeMap&&!layers.length&&maps.length)await loadMap(maps[0].id);}catch(e){toast(errorText(e));}},0);});
let editingProject=false;
function syncProject(){
 refreshSaveStatus();
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
 if(isReadOnly())return;
 if(geometryEditor?.pending||fieldTools?.pending||(busy&&!fromImport)||layoutPending||styleSaves.size||saves.state().failed||layers.some(l=>l.saving))return toast('Wait for the current import or save to finish.');
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
  const payload={name,...projectCRS($('#project-crs').value,crsList)};if(!editingProject&&!LOCAL_TESTING){if(!currentWorkspace)throw Error('Select a company workspace first.');payload.workspace_id=currentWorkspace.id;}
  const request=editingProject?db.from('maps').update(payload).eq('id',activeMap.id):db.from('maps').insert(payload);
  const {data,error}=await request.select().single();if(error)throw error;
  if(!editingProject&&activeMap)clearMap();
  activeMap=data;await saveLayout();syncProject();$('#name-dialog').close();
  maps=await listMaps();toast(editingProject?'Project settings saved.':'Project created. Import layers or save your existing layers to this project.');
 }catch(e){$('#project-error').textContent=errorText(e);toast(errorText(e));}finally{button.disabled=false;}
};
async function ensureMap(){if(activeMap)return;if(!user){$('#auth').showModal();throw Error('Sign in, then select Save on the layer.');}openProject(false,true);throw Error('Create a project, then select Save on the layer.');}
async function saveLayer(l,progress=()=>{}){if(!canEditLayer(l))throw Error('This account cannot save changes to this layer.');if(l.saving)return;await ensureMap();if(l.saved)return;l.saving=true;l.saveError=null;refreshSaveStatus();const paths=[];try{
 if(!LOCAL_TESTING&&(l.files||[]).some(f=>f.size>CLOUD_FILE_LIMIT))throw Error('Cloud storage currently accepts files up to 50 MB each.');
 toast(LOCAL_TESTING?'Saving original files and layer in this browser…':'Saving original files and layer to Supabase…');const prefix=`${user.id}/${crypto.randomUUID()}`;
 let fileNumber=0;for(const file of l.files||[]){progress(`${LOCAL_TESTING?'Saving':'Uploading'} original file ${++fileNumber} of ${l.files.length}: ${file.name}`);const path=`${prefix}/${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const{error}=await db.storage.from('gis-files').upload(path,file,{contentType:file.type||'application/octet-stream'});if(error)throw error;paths.push(path);}
 progress('Saving layer details and display preview…');const payload={map_id:activeMap.id,name:l.name,kind:l.kind,source_crs:l.source_crs,vertical_datum:l.vertical_datum,metadata:{...l.metadata,crs_label:l.crsLabel},color:l.color,opacity:l.opacity??.85,visible:l.visible!==false,bounds:l.bounds,original_paths:paths};let newID;
 if(l.metadata?.xyz){const{data,error}=await db.from('layers').insert(payload).select().single();if(error)throw error;newID=data.id;}else if(l.kind==='vector'){const{data,error}=await db.rpc('import_vector',{p_layer:payload,p_features:l.fc.features});if(error)throw error;newID=data;}else{const path=`${prefix}/display.png`;const {error:uploadError}=await db.storage.from('gis-files').upload(path,l.blob,{contentType:'image/png'});if(uploadError)throw uploadError;paths.push(path);const{data,error}=await db.from('layers').insert({...payload,raster_path:path}).select().single();if(error)throw error;newID=data.id;}
 if(l.kind==='raster'&&!l.metadata?.xyz)l.raster_path=paths.at(-1);
 const oldID=l.id;replaceTreeId(oldID,newID);explorer?.rekey(oldID,newID);l.id=newID;l.saved=true;l.original_paths=paths;rendered.set(l.id,rendered.get(oldID));rendered.delete(oldID);await saveLayout();renderLayers();updateEmpty();toast(LOCAL_TESTING?'Saved in this browser.':'Saved to Supabase. Open this map on your phone to see it.');
 }catch(e){l.saveError=e;if(paths.length)await db.storage.from('gis-files').remove(paths);throw e;}finally{l.saving=false;refreshSaveStatus();}}
function clearMap(){explorer?.reset();fieldTools?.reset();geometryEditor?.reset();saves.clear();syncDirty=false;syncError=false;layerTree=[];for(const l of rendered.values())map.removeLayer(l);rendered.clear();for(const l of layers)if(l.url?.startsWith('blob:'))URL.revokeObjectURL(l.url);layers=[];if(preview){map.removeLayer(preview);preview=null;}renderLayers();updateEmpty();}
async function loadMap(id){if(!id){$('#map-select').value=activeMap?.id||'';return;}if(geometryEditor?.pending||fieldTools?.pending||busy||layoutPending||styleSaves.size||saves.state().failed||layers.some(l=>l.saving)){$('#map-select').value=activeMap?.id||'';return;}if(layers.some(l=>!l.saved)||queue.length){toast('Finish queued imports and save or remove unsaved layers before switching or refreshing projects.');$('#map-select').value=activeMap?.id||'';return;}setBusy(true,'Refreshing saved layers…');try{if(isReadOnly()){const project=maps.find(p=>p.id===id);if(!project)throw Error('Choose an assigned published project.');const result=await publishedLayers(db,project);clearMap();activeMap=result.project;layerTree=normaliseTree(readLayout(),result.layers.map(l=>l.id));result.layers.forEach(addLayer);syncProject();$('#map-select').value=id;fit();return;}const{data,error}=await db.from('layers').select('*').eq('map_id',id).order('created_at');if(error)throw error;const loaded=[];for(const l of data){if(l.kind==='vector'){const result=await db.rpc('layer_geojson',{p_layer_id:l.id});if(result.error)throw result.error;l.fc=result.data;}else if(!l.metadata?.xyz){const result=await db.storage.from('gis-files').download(l.raster_path);if(result.error)throw result.error;l.url=URL.createObjectURL(result.data);}l.saved=true;l.crsLabel=l.metadata?.crs_label;loaded.push(l);}clearMap();activeMap=maps.find(m=>m.id===id);layerTree=normaliseTree(readLayout(),loaded.map(l=>l.id));loaded.forEach(addLayer);syncProject();$('#map-select').value=id;fit();toast(LOCAL_TESTING?'Project refreshed from this browser.':'Map refreshed from Supabase.');}catch(e){toast(errorText(e));}finally{setBusy(false);}}
$('#map-select').onchange=e=>loadMap(e.target.value);$('#refresh').onclick=async()=>{if(!user){$('#auth').showModal();return;}try{maps=await listMaps();if(activeMap)await loadMap(activeMap.id);else toast('Choose a project.');}catch(e){toast(errorText(e))}};
renderLayers();
window.addEventListener('beforeunload',e=>{if(geometryEditor?.pending||fieldTools?.pending||busy||layoutPending||queue.length||styleSaves.size||saves.state().failed||layers.some(l=>!l.saved||l.saving)){e.preventDefault();e.returnValue='';}});

function updateAccess(){document.body.classList.toggle('viewer-mode',isReadOnly());document.body.classList.toggle('admin-mode',isAdmin());$('#people').hidden=LOCAL_TESTING||!isAdmin();$('#workspace-invitations').hidden=!user||!workspaceContext?.invitations?.length;$('#open-annotation').hidden=!isAdmin();$('#open-drawing').hidden=isReadOnly();}
async function saveStylePart(l,key,value){if(!canEditLayer(l))throw Error('This layer is read only.');const card=[...document.querySelectorAll('.layer-card')].find(c=>c.dataset.id===l.id);if(!card)throw Error('Layer is no longer open.');await changeLayerStyle({target:{closest:()=>card,dataset:{action:key},value}});renderLayers();if(saves.state().failed)throw Error('Changed here, but cloud saving failed. Use Retry before SYNC.');toast(l.saved?'Settings saved. SYNC to publish these defaults.':'Settings applied. Save the layer to keep them.');}
function openAnnotationSettings(l){if(!isAdmin())return;editAnnotation(l,{canAnnotate:isAdmin,save:async(layer,values)=>{const next={...layer,name:values.name,fc:structuredClone(layer.fc)};next.fc.features[0].properties.note=values.note;next.metadata={...layer.metadata,annotation:{...layer.metadata.annotation}};await replaceLayer(layer,next);await changeLayerStyle({target:{closest:()=>[...document.querySelectorAll('.layer-card')].find(c=>c.dataset.id===layer.id),dataset:{action:'color'},value:values.color}});renderLayers();},remove:async layer=>{if(layer.saved){const {error}=await db.from('layers').delete().eq('id',layer.id);if(error)throw error;}map.removeLayer(rendered.get(layer.id));rendered.delete(layer.id);layers=layers.filter(l=>l!==layer);removeNode(layerTree,layer.id);await saveLayout();renderLayers();updateEmpty();syncDirty=true;refreshSaveStatus();}});}
explorer=installMapExplorer({L,map,getLayers:()=>layers,isVisible,canEdit:canEditLayer,redraw:redrawLayer,saveStyle:saveStylePart,showInfo:(title,content)=>{identifyActive=true;$('#identify').setAttribute('aria-pressed','true');$('#feature-info').hidden=false;$('#feature-info-title').textContent=title;$('#feature-info-content').replaceChildren(content);}});
fieldTools=installFieldTools({L,map,canAnnotate:isAdmin,hasProject:()=>!!activeMap,onAnnotation:async({name,color,type,feature,bounds})=>{if(!isAdmin())throw Error('Only admins can add annotations.');const l={id:crypto.randomUUID(),name,color,kind:'vector',source_crs:'EPSG:4326',crsLabel:'WGS 84 · annotation',vertical_datum:'Not applicable',metadata:{annotation:{type},style:{}},opacity:.9,visible:true,saved:false,files:[],bounds,fc:{type:'FeatureCollection',features:[feature]}};addLayer(l);try{await saveLayer(l);}catch(error){toast('Annotation added; use Save or Retry: '+errorText(error));}},notify:toast});
$('#open-table').onclick=()=>explorer.openTable();$('#open-search').onclick=()=>explorer.openSearch();$('#open-filter').onclick=()=>explorer.openFilter();$('#open-measure').onclick=()=>{if(geometryEditor?.active)return toast('Close drawing tools first.');identify(false);fieldTools.open('measure');};$('#open-annotation').onclick=()=>{if(geometryEditor?.active)return toast('Close drawing tools first.');identify(false);fieldTools.open('annotation');};
updateAccess();explorer.refresh();

async function openDrawing(target){
 if(isReadOnly()||busy||syncing)return;
 if(fieldTools?.pending)return toast('Finish the current annotation first.');
 if(!activeMap){await ensureMap();return;}
 fieldTools?.reset();identify(false);
 if(!geometryEditor){const {installGeometryEditor}=await import('./geometry-editor.js');geometryEditor=installGeometryEditor({L,map,getLayers:()=>layers,isVisible,canEdit:l=>canEditLayer(l)&&!busy&&!syncing,notify:toast,onPreviewLayer:l=>{geometryEditingId=l?.id||null;syncStack();},save:async(old,values)=>{
  if(!canEditLayer(old))throw Error('Your account cannot edit this layer.');
  setBusy(true,'Saving drawing…');
  try{if(old){await replaceLayer(old,{...old,...values});old.feature_count=values.fc.features.length;if(!old.saved)await saveLayer(old);}
  else{const l={id:crypto.randomUUID(),...values,kind:'vector',source_crs:'EPSG:4326',crsLabel:'WGS 84 · drawn on map',vertical_datum:'RL',metadata:{manual:true,style:{}},color:'#147d72',opacity:.9,visible:true,saved:false,files:[]};addLayer(l);try{await saveLayer(l);}catch(e){if(l.saved){toast('Geometry saved; retry pending project layout saves.');return;}map.removeLayer(rendered.get(l.id));rendered.delete(l.id);layers=layers.filter(x=>x!==l);removeNode(layerTree,l.id);renderLayers();updateEmpty();throw e;}}
  renderLayers();refreshSaveStatus();}finally{setBusy(false);}
 }});}
 geometryEditor.open(target);
}
$('#open-drawing').onclick=()=>openDrawing().catch(e=>toast(errorText(e)));

workspaceLayout=installWorkspaceLayout();

function workspacePending(){return geometryEditor?.pending||fieldTools?.pending||busy||layoutPending||styleSaves.size||saves.state().failed||queue.length||layers.some(l=>!l.saved||l.saving);}
function renderWorkspaces(){
 $('.company-switcher').hidden=LOCAL_TESTING||!user;$('#company-select').innerHTML=(workspaceContext?.workspaces||[]).map(w=>`<option value="${esc(w.id)}">${esc(w.name)}${w.status==='suspended'?' · Suspended':''}</option>`).join('')||'<option value="">No workspace access</option>';
 $('#company-select').value=currentWorkspace?.id||'';$('#company-role').textContent=workspaceContext?.platform_admin?'DrillOps platform admin':currentWorkspace?`${currentWorkspace.role[0].toUpperCase()+currentWorkspace.role.slice(1)} · Company workspace`:workspaceContext?.can_create_company?'Set up your company to get started':'Accept an invitation or contact your company admin';
 $('#start-company').hidden=!workspaceContext?.can_create_company||!!workspaceContext?.invitations?.length;
 $('#workspace-invitations').hidden=!user||!workspaceContext?.invitations?.length;$('#workspace-invitations').textContent=`Invitations (${workspaceContext?.invitations?.length||0})`;
}
async function loadWorkspaces(preferred){
 const accountId=user?.id;if(!accountId)return;let {data,error}=await db.rpc('workspace_context');if(user?.id!==accountId)return;if(error)throw error;if(!data?.workspaces)throw Error('Workspace access could not load. Reload the page.');
 const created=await registration.ensureWorkspace(data,user);if(user?.id!==accountId)return;if(created){const result=await db.rpc('workspace_context');if(result.error)throw result.error;if(user?.id!==accountId)return;data=result.data;preferred=created;}
 const previous=currentWorkspace;workspaceContext=data;let selected=preferred||currentWorkspace?.id;try{selected||=localStorage.getItem('drillops-company:'+accountId);}catch{}
 currentWorkspace=data.workspaces.find(w=>w.id===selected)||data.workspaces[0]||null;if(previous&&(previous.id!==currentWorkspace?.id||previous.role!==currentWorkspace?.role)){clearMap();activeMap=null;syncProject();}renderWorkspaces();updateAccess();refreshSaveStatus();if(!busy)setBusy(false);
}
async function refreshWorkspaces(preferred){
 const previous=currentWorkspace?.id;await loadWorkspaces(preferred);if(previous!==currentWorkspace?.id){clearMap();activeMap=null;syncProject();}
 maps=await listMaps();if(activeMap&&!maps.some(m=>m.id===activeMap.id)){clearMap();activeMap=null;syncProject();}if(!activeMap&&maps.length)await loadMap(maps[0].id);setBusy(false);
}
$('#company-select').onchange=async e=>{
 if(workspacePending()){$('#company-select').value=currentWorkspace?.id||'';return toast('Save or discard pending edits before switching company.');}
 const next=workspaceContext?.workspaces.find(w=>w.id===e.target.value);if(!next)return;
 accountUI.close();clearMap();activeMap=null;currentWorkspace=next;syncProject();renderWorkspaces();updateAccess();try{localStorage.setItem('drillops-company:'+user.id,next.id);}catch{}
 try{maps=await listMaps();if(maps.length)await loadMap(maps[0].id);setBusy(false);}catch(e){toast(errorText(e));}
};
$('#workspace-invitations').onclick=()=>accountUI.openInvitations(workspaceContext?.invitations||[]);

if(!LOCAL_TESTING&&new URLSearchParams(location.search).get('signup')==='1')registration.open(true);
