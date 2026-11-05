import {publicSources} from './public-sources.js';
import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
export const qglobeRoot='https://spatial-gis.information.qld.gov.au/arcgis/rest/services';
const pathURL=(path,root=qglobeRoot)=>root+(path?'/'+path.split('/').map(encodeURIComponent).join('/'):'');
async function json(url,{signal,fetcher=fetch}={}){
 const r=await fetcher(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});if(!r.ok)throw Error('The public service is unavailable. Please retry.');
 const text=await r.text();if(text.length>25_000_000)throw Error('Too much data. Zoom in and retry.');
 const data=JSON.parse(text);if(data.error)throw Error(data.error.message||'The service could not complete this request.');return data;
}
export async function qglobeDirectory(path='',options={}){return json(pathURL(path,options.root)+'?f=json',options);}
export function qglobeBounds(bounds){
 if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite))throw Error('Open a map before loading public data.');
 const [w,s,e,n]=bounds;if(w< -180||e>180||s< -90||n>90||w>=e||s>=n||e-w>2||n-s>2)throw Error('Zoom into your project area (less than 2° across) and reopen this source.');return bounds.join(',');
}
export async function qglobeFeatures(path,bounds,options={}){
 const geometry=qglobeBounds(bounds),base=pathURL(path,options.root)+'/query';
 const area={where:'1=1',geometry,geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects'};
 const count=await json(base+'?'+new URLSearchParams({...area,f:'json',returnCountOnly:'true'}),options);
 if(!Number.isInteger(count.count))throw Error('This layer does not support feature downloads.');
 if(count.count>5000)throw Error('More than 5,000 features in this area. Zoom in and retry.');
 if(!count.count)throw Error('No features in the current map area. Move your map into the source’s coverage and try again.');
 const fc=await json(base+'?'+new URLSearchParams({...area,f:'geojson',outSR:'4326',outFields:'*',returnGeometry:'true'}),options);
 if(fc.exceededTransferLimit||fc.properties?.exceededTransferLimit||fc.type!=='FeatureCollection'||fc.features?.length!==count.count)throw Error('The service returned an incomplete result. Zoom in and retry.');return fc;
}
export function qglobePreview(path,bounds,root=qglobeRoot){
 const match=path.match(/^(.*)\/MapServer\/(\d+)$/);if(!match)return null;
 return pathURL(match[1]+'/MapServer',root)+'/export?'+new URLSearchParams({f:'image',bbox:bounds.join(','),bboxSR:'4326',imageSR:'4326',size:'720,420',format:'png32',transparent:'true',adjustAspectRatio:'false',layers:'show:'+match[2]});
}
export function openQGlobe({L,getBounds,valid,onResult,onRasterResult,source=publicSources[0],initialItem=null,isFavourite=()=>false,onFavourite}){
 const root=source.root,url=path=>pathURL(path,root),options={root};
 const bounds=getBounds(),abort=new AbortController();let version=0,closed=false,history=[],entries=[],map=null,prepared=null;
 const d=toolDialog(source.name+' · Public layers',`<p>Browse ${esc(source.name)}. Check each layer’s source and usage terms. Imports cover the current map area. Features are editable; map images preserve source colours. Neither updates automatically.</p><div class="library-find"><button type="button" data-back>← Back</button><input type="search" data-find placeholder="Search this folder…" aria-label="Search public source folder"></div><p data-path></p><div class="library-body"><div class="library-catalog" data-list></div><section class="library-detail" data-detail>Choose a folder or service</section></div>`);d.classList.add('layer-library');
 const q=s=>d.querySelector(s),add=q('[type=submit]');add.textContent='＋ Add to map';add.disabled=true;
 const check=()=>{valid();if(closed)throw Error('Library closed.');};
 function clear(){version++;prepared=null;add.disabled=true;map?.remove();map=null;q('.error').textContent='';}
 const favouriteRecord=item=>({key:'service:'+source.id+':'+item.path,kind:'service',sourceId:source.id,path:item.path,name:item.name,image:!!item.image});
 function draw(){const term=q('[data-find]').value.toLowerCase();q('[data-list]').innerHTML=entries.filter(x=>x.name.toLowerCase().includes(term)).map(x=>`<div class="library-favourite-row"><button type="button" class="library-card" data-index="${entries.indexOf(x)}"><span>${x.layer?'▧':'▣'}</span><span><strong>${esc(x.name)}</strong><small>${esc(x.type)}</small></span></button>${x.layer&&onFavourite?`<button type="button" class="library-star" data-favourite="${entries.indexOf(x)}" aria-label="${isFavourite(favouriteRecord(x).key)?'Remove from':'Add to'} favourites: ${esc(x.name)}" aria-pressed="${isFavourite(favouriteRecord(x).key)}">${isFavourite(favouriteRecord(x).key)?'★':'☆'}</button>`:''}</div>`).join('')||'<p>No matching supported layers.</p>';}
 async function browse(path='',push=true){clear();const run=version;q('[data-list]').textContent='Loading…';try{const data=await qglobeDirectory(path,{...options,signal:abort.signal});check();if(run!==version)return;if(push)history.push(path);q('[data-path]').textContent=path||source.name;q('[data-back]').disabled=history.length<2;q('[data-find]').value='';
 entries=[...(/\/(MapServer|ImageServer)$/.test(path)?[{name:data.mapName||data.name||path.split('/').at(-2),path,type:'Map image · current area',layer:true,image:true}]:[]),...(data.folders||[]).map(name=>({name,path:name,type:'Folder'})),...(data.services||[]).filter(x=>['MapServer','FeatureServer','ImageServer'].includes(x.type)).map(x=>({name:x.name.split('/').at(-1),path:x.name+'/'+x.type,type:x.type})),...(data.layers||[]).filter(x=>!x.subLayerIds?.length).map(x=>({name:x.name,path:path+'/'+x.id,type:'Layer',layer:true}))];draw();q('[data-detail]').textContent='Choose a layer to preview in colour.';
 }catch(e){if(run===version&&!closed){q('.error').textContent=e.message;q('[data-list]').textContent='Unable to load this folder. Use Back to try another.';q('[data-back]').disabled=history.length<1;}}}
 async function choose(item){clear();const run=version;q('[data-detail]').textContent='Loading colour preview…';try{qglobeBounds(bounds);const info=await qglobeDirectory(item.path,{...options,signal:abort.signal});check();if(run!==version)return;
 const preview=item.image?url(item.path)+(item.path.endsWith('/ImageServer')?'/exportImage?':'/export?')+new URLSearchParams({f:'image',bbox:bounds.join(','),bboxSR:'4326',imageSR:'4326',size:'1440,840',format:'png32',transparent:'true',adjustAspectRatio:'false'}):qglobePreview(item.path,bounds,root);q('[data-detail]').innerHTML=`<div class="library-map" data-vector aria-label="Colour layer preview"></div><div class="library-description"><h3>${esc(item.name)}</h3><p>${esc((info.description||'').replace(/<[^>]*>/g,' ').slice(0,1000))}</p><small>${esc(info.copyrightText||source.name+' · check source usage terms')}</small><p><a href="${esc(url(item.path))}" target="_blank" rel="noopener noreferrer">Source and usage terms ↗</a></p><p data-count>Loading features in current map area…</p></div>`;
 map=L.map(q('[data-vector]'),{scrollWheelZoom:false});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);map.fitBounds([[bounds[1],bounds[0]],[bounds[3],bounds[2]]]);if(preview)L.imageOverlay(preview,[[bounds[1],bounds[0]],[bounds[3],bounds[2]]],{attribution:esc(source.name)}).on('error',()=>{if(run===version&&!closed)q('.error').textContent='Source preview unavailable. Feature import can still be used.';}).addTo(map);
 if(item.image){prepared={item,preview};q('[data-count]').textContent='Rendered map image of current area · source colours · not editable features';add.disabled=!onRasterResult;return;}
 const fc=await qglobeFeatures(item.path,bounds,{...options,signal:abort.signal});check();if(run!==version)return;
 const rgba=info.drawingInfo?.renderer?.symbol?.color,color=Array.isArray(rgba)?'#'+rgba.slice(0,3).map(x=>Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join(''):'#248eb0';
 if(!preview){L.geoJSON(fc,{style:{color,fillColor:color,fillOpacity:.45},pointToLayer:(_,ll)=>L.circleMarker(ll,{radius:5,color,fillOpacity:.85})}).addTo(map);map.fitBounds([[bounds[1],bounds[0]],[bounds[3],bounds[2]]]);}
 prepared={fc,item,color};q('[data-count]').textContent=fc.features.length.toLocaleString()+(fc.features.length===1?' feature':' features')+' · current map area';add.disabled=false;
 }catch(e){if(run===version&&!closed){q('.error').textContent=e.message;const count=q('[data-count]');if(count)count.textContent='Import unavailable.';else q('[data-detail]').textContent='Preview unavailable.';}}}
 q('[data-list]').onclick=async e=>{const star=e.target.closest('[data-favourite]');if(star){star.disabled=true;try{check();await onFavourite(favouriteRecord(entries[Number(star.dataset.favourite)]));check();draw();}catch(e){q('.error').textContent=e.message;}return;}const b=e.target.closest('[data-index]');if(b){const item=entries[Number(b.dataset.index)];void(item.layer?choose(item):browse(item.path));}};
 q('[data-find]').oninput=draw;q('[data-back]').onclick=()=>{if(history.length>1)history.pop();void browse(history.at(-1)||'',false);};
 q('form').onsubmit=async e=>{e.preventDefault();if(!prepared)return;add.disabled=true;try{check();const {fc,item,color,preview}=prepared;if(item.image){const response=await fetch(preview,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(45000)])});if(!response.ok)throw Error('Map image could not download.');const blob=await response.blob();if(!blob.type.startsWith('image/')||blob.size>50_000_000)throw Error('Invalid or oversized map image.');check();await onRasterResult({id:crypto.randomUUID(),name:item.name,kind:'raster',blob,bounds,source_crs:'EPSG:4326',crsLabel:'WGS 84',metadata:{reference:{source:source.name,url:url(item.path),downloaded_at:new Date().toISOString()}},visible:true,opacity:1,saved:false,files:[]});d.close();return;}await onResult(fc,item.name,{color,metadata:{reference:{source:source.name,url:url(item.path),bounds,downloaded_at:new Date().toISOString()},style:{fillColor:color,fillOpacity:.45}}});d.close();}catch(e){q('.error').textContent=e.message;add.disabled=false;}};
 d.addEventListener('close',()=>{closed=true;abort.abort();clear();});if(initialItem){entries=[initialItem];history=[''];draw();void choose(initialItem);}else void browse();return d;
}
