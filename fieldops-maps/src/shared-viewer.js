import {installBasemaps} from './basemaps.js';
import {applyMapConstraints} from './project-controls.js';
import {installViewerTable,downloadMapData} from './viewer-data.js';
import {xyzLayer} from './xyz.js';
import L from 'leaflet';import 'leaflet/dist/leaflet.css';
import {SUPABASE_URL,SUPABASE_KEY} from './config.js';
import {vectorStyle,pointMarker} from './layer-style.js';
import {annotationLayer} from './field-tools.js';
import {pointLabels} from './point-labels.js';
import {matchesView,featureInfo} from './explore-data.js';
import './shared-viewer.css';
const $=s=>document.querySelector(s),token=location.hash.slice(1),map=L.map('map').setView([-25,134],4);
const baseSelect=document.createElement('select'),baseLabel=document.createElement('span'),basemaps=installBasemaps(L,map,baseSelect,baseLabel);
let version=null,rendered=[],loading=false,currentProject=null;
const table=installViewerTable({getLayers:()=>rendered.map(r=>r.item)}),tableButton=document.createElement('button'),copyButton=document.createElement('button'),description=document.createElement('p');tableButton.textContent='Open table';copyButton.textContent='Download map data';tableButton.hidden=copyButton.hidden=true;tableButton.onclick=()=>{if(currentProject?.map_settings?.table?.enabled!==false)table.open();};copyButton.onclick=()=>downloadMapData(currentProject,rendered.map(r=>r.item));document.querySelector('aside').append(description,tableButton,copyButton);
function clear(){for(const r of rendered)map.removeLayer(r.layer);rendered=[];$('#shared-layers').replaceChildren();table.close();tableButton.hidden=copyButton.hidden=true;currentProject=null;}
function details(feature){const box=document.createElement('div');for(const [name,value] of Object.entries(feature.properties||{})){if(name.startsWith('_'))continue;const row=document.createElement('p'),b=document.createElement('b');b.textContent=name+': ';row.append(b,document.createTextNode(typeof value==='object'?JSON.stringify(value):String(value??'')));box.append(row);}return box;}
async function refresh(){if(loading)return;loading=true;try{
 const response=await fetch(SUPABASE_URL+'/functions/v1/maps-public',{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_KEY},body:JSON.stringify({token}),cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Shared map unavailable');
 $('#title').textContent=data.project?.name||'Shared map';$('#version').textContent='Synced '+new Date(data.published_at).toLocaleString();$('#message').textContent='Pan, zoom, toggle layers and click features to view details.';
 if(version===data.version)return;const first=version===null;clear();version=data.version;currentProject=data.project;description.textContent=currentProject?.map_settings?.description||'';tableButton.hidden=currentProject?.map_settings?.table?.enabled===false;copyButton.hidden=currentProject?.map_settings?.allowDuplicate===false;basemaps.apply(currentProject?.map_settings?.basemap);applyMapConstraints(map,currentProject?.map_settings);const all=L.latLngBounds([]);
 const order=(data.layer_layout||[]).flatMap(n=>typeof n==='string'?[n]:n.children||[]),items=[...(data.layers||[])].sort((a,b)=>order.indexOf(b.id)-order.indexOf(a.id));
 for(const item of items){let layer;
  if(item.metadata?.xyz){layer=xyzLayer(L,item,message=>$('#message').textContent=message);}
  else if(item.kind==='raster'&&item.url){layer=L.imageOverlay(item.url,[[item.bounds[1],item.bounds[0]],[item.bounds[3],item.bounds[2]]],{opacity:item.opacity??.85});}
  else if(item.metadata?.annotation){layer=annotationLayer(L,item,{onClick:(f,e)=>L.popup().setLatLng(e.latlng).setContent(featureInfo(item,f,document)).openOn(map)});}
  else if(item.fc){const fc={...item.fc,features:item.fc.features.filter(f=>matchesView(item,f,item.metadata?.style?.view||{}))};layer=L.geoJSON(fc,{style:f=>vectorStyle(item,f),pointToLayer:(f,ll)=>pointMarker(L,item,ll,{},f),onEachFeature:(f,l)=>l.bindPopup(()=>featureInfo(item,f,document))});}
  if(!layer)continue;const group=(data.layer_layout||[]).find(g=>g.children?.includes(item.id)),shown=item.visible!==false&&group?.visible!==false;if(shown)layer.addTo(map);if(layer.getBounds)all.extend(layer.getBounds());rendered.push({layer,item});
  const label=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=shown;checkbox.onchange=()=>checkbox.checked?layer.addTo(map):map.removeLayer(layer);label.append(checkbox,document.createTextNode(item.name));$('#shared-layers').prepend(label);
 }if(currentProject?.map_settings?.table?.enabled!==false&&currentProject?.map_settings?.table?.defaultLayer)table.open(currentProject.map_settings.table.defaultLayer);if(first&&all.isValid())map.fitBounds(all,{padding:[30,30],maxZoom:17});
 }catch(e){clear();version=null;$('#title').textContent='Shared map';$('#message').textContent=e.message;}finally{loading=false;}}
map.on('moveend',()=>rendered.forEach(({layer,item})=>{if(map.hasLayer(layer))pointLabels(layer,item,map.getBounds(),document);}));
refresh();setInterval(refresh,30000);
