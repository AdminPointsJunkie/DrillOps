import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {coordinateInput,clusterPhotos,pinScope,createPersonalPinStore} from './photo-location-model.js';
import './photo-locations.css';

export async function downscaleLocalPhoto(file){
 if(file.size>50*1024*1024)throw Error(`${file.name} exceeds 50 MB.`);
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose JPEG, PNG or WebP photos. Export HEIC photos as JPEG first.');
 const bitmap=await createImageBitmap(file);
 try{
  const render=async(side,quality)=>{const ratio=Math.min(1,side/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',quality));if(!blob)throw Error('Photo could not be resized.');return blob;};
  return {id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,'')+'.jpg',blob:await render(2048,.85),thumbnail:await render(256,.75)};
 }finally{bitmap.close();}
}
export function installPhotoLocations({L,map,getScope,getLayers,isVisible,acceptFeature,download,featureSearch,getEngine,canStart=()=>true,toast}){
 const storage=createPersonalPinStore(),photos=L.layerGroup().addTo(map),pins=L.layerGroup().addTo(map);
 let scope=null,local=[],shown=true,revision=0,timer,dialogs=new Set(),urls=[],searchMarker,request,lastRequest=0;
 const cachedPlaces=new Map(),imageCache=new Map();
 let downloading=0;const waiting=[];
 async function cachedDownload(path){
  const at=scope;
  if(imageCache.has(path))return imageCache.get(path);
  if(downloading>=4)await new Promise(resolve=>waiting.push(resolve));
  downloading++;
  try{if(!valid(at))throw Error('Project changed.');const value=await download(path);if(valid(at)&&value.size<=2*1024*1024){if(imageCache.size>=64)imageCache.delete(imageCache.keys().next().value);imageCache.set(path,value);}return value;}
  finally{downloading--;waiting.shift()?.();}
 }
 const button=(title,text,run)=>{const b=document.createElement('button');b.type='button';b.className='square';b.title=title;b.setAttribute('aria-label',title);b.textContent=text;b.onclick=run;return b;};
 const photoButton=button('Photo locations and saved pins','▣',openPhotos);document.querySelector('.map-tools')?.append(photoButton);
 const toggle=document.createElement('label');toggle.className='photo-layer-toggle';toggle.innerHTML='<input type="checkbox" checked> Photo locations';toggle.querySelector('input').onchange=e=>{shown=e.target.checked;draw();};document.querySelector('#layers')?.before(toggle);
 function dialog(title,body){const d=toolDialog(title,body);dialogs.add(d);d.addEventListener('close',()=>dialogs.delete(d),{once:true});return d;}
 function valid(at){return at===scope&&at===getScope();}
 async function refresh(){
  const next=getScope();if(next!==scope){scope=next;imageCache.clear();revision++;local=[];shown=true;toggle.querySelector('input').checked=true;photos.clearLayers();pins.clearLayers();urls.forEach(URL.revokeObjectURL);urls=[];for(const d of dialogs)d.close();request?.abort();if(searchMarker)map.removeLayer(searchMarker);searchMarker=null;const at=scope;try{const values=await storage.list(at);if(valid(at)){local=values;draw();}}catch(e){if(valid(at))toast(e.message);}return;}
  clearTimeout(timer);timer=setTimeout(draw,80);
 }
 function entries(){
  const rows=[];
  for(const pin of local)for(const file of pin.photos||[])rows.push({id:file.id,lat:pin.lat,lng:pin.lng,file,pin,name:pin.name});
  for(const layer of getLayers())if(isVisible(layer)&&Number(layer.opacity??1)>0)for(const feature of layer.fc?.features||[]){
   if(feature.geometry?.type!=='Point'||!acceptFeature(layer,feature))continue;
   const [lng,lat]=feature.geometry.coordinates;if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
   for(const file of feature.properties?._fieldmaps_files||[])if(typeof file.path==='string'&&(/^image\//i.test(file.type||'')||/\.(jpg|jpeg|png|heic|webp)$/i.test(file.name||'')))rows.push({id:file.path,lat,lng,file,name:layer.name});
  }
  return rows;
 }
 async function photoURL(entry,thumb,own){const blob=entry.file.blob?(thumb?entry.file.thumbnail||entry.file.blob:entry.file.blob):await cachedDownload(thumb?entry.file.thumbnail_path||entry.file.path:entry.file.path);const url=URL.createObjectURL(blob);own.push(url);return url;}
 function draw(){
  if(scope!==getScope()){void refresh();return;}
  const token=++revision;photos.clearLayers();pins.clearLayers();urls.forEach(URL.revokeObjectURL);urls=[];const owned=urls;
  for(const pin of local){const marker=L.circleMarker([pin.lat,pin.lng],{radius:7,color:'#fff',weight:2,fillColor:'#db7d31',fillOpacity:1}).addTo(pins);marker.on('click',()=>editPin(pin));}
  if(!shown)return;
  const visible=entries().filter(p=>map.getBounds().pad(.2).contains([p.lat,p.lng]));
  const groups=clusterPhotos(visible,p=>map.project([p.lat,p.lng],map.getZoom()));
  for(const group of groups){
   const unique=[...new Map(group.map(p=>[p.id,p])).values()],first=unique[0],lat=group.reduce((s,p)=>s+p.lat,0)/group.length,lng=group.reduce((s,p)=>s+p.lng,0)/group.length;
   const marker=L.marker([lat,lng],{icon:L.divIcon({className:'photo-map-marker',html:`<span class="photo-placeholder">▣</span><span class="photo-count">${unique.length}</span>`,iconSize:[58,58],iconAnchor:[29,29]}),title:`${unique.length} photos`,keyboard:true}).addTo(photos);
   marker.on('click',()=>gallery(unique));
   void photoURL(first,true,owned).then(url=>{if(token!==revision){URL.revokeObjectURL(url);return;}const el=marker.getElement();if(el){const img=document.createElement('img');img.src=url;img.alt='';el.querySelector('.photo-placeholder')?.replaceWith(img);}}).catch(()=>{});
  }
 }
 function gallery(items){
  const at=scope,owned=[],d=dialog(`${items.length} photos`,'<div class="photo-grid"></div><div class="photo-full" hidden></div>');d.querySelector('[type=submit]').remove();
  d.addEventListener('close',()=>owned.forEach(URL.revokeObjectURL),{once:true});
  for(const item of items){const b=document.createElement('button');b.type='button';b.textContent=item.file.name||item.name;b.className='photo-grid-tile';d.querySelector('.photo-grid').append(b);
   void photoURL(item,true,owned).then(url=>{if(!d.open||!valid(at)){URL.revokeObjectURL(url);return;}const img=document.createElement('img');img.src=url;img.alt=item.file.name||item.name;b.replaceChildren(img);}).catch(()=>{b.textContent='Preview unavailable — tap to retry';});
   b.onclick=async()=>{b.disabled=true;try{const url=await photoURL(item,false,owned);if(!d.open||!valid(at)){URL.revokeObjectURL(url);return;}const full=d.querySelector('.photo-full');full.replaceChildren();const img=document.createElement('img');img.src=url;img.alt=item.file.name||item.name;const close=button('Back to photos','Back',()=>{full.hidden=true;});const save=document.createElement('a');save.href=url;save.download=item.file.name||'photo.jpg';save.textContent='Save a copy';full.append(close,save,img);full.hidden=false;}catch(e){d.querySelector('.error').textContent='Photo unavailable. Check your connection and try again.';}finally{b.disabled=false;}};
  }
 }
 function openPhotos(){
  const d=dialog('Photo locations',`<label><input data-show type="checkbox" ${shown?'checked':''}> Show photo locations</label><p>Photos group together as you zoom out. Tap a preview to browse.</p><button type="button" data-pin>Drop a pin at map centre</button><p class="field-note">New pins and downscaled photos are saved in this browser on this device. Nothing uploads automatically. Clearing browser data removes them.</p><div data-pins></div>`);
  d.querySelector('[type=submit]').remove();d.querySelector('[data-show]').onchange=e=>{shown=e.target.checked;toggle.querySelector('input').checked=shown;draw();};
  d.querySelector('[data-pin]').onclick=()=>{if(!scope)return toast('Sign in and choose a project first.');if(!canStart())return;const c=map.getCenter();d.close();editPin({id:crypto.randomUUID(),name:'',note:'',lat:c.lat,lng:c.lng,photos:[]});};
  for(const pin of local){const row=document.createElement('div'),edit=document.createElement('button'),locate=document.createElement('button');edit.type=locate.type='button';edit.textContent=pin.name;locate.textContent='Show on map';edit.onclick=()=>{d.close();editPin(pin);};locate.onclick=()=>{map.setView([pin.lat,pin.lng],18);d.close();};row.append(edit,locate);d.querySelector('[data-pins]').append(row);}
 }
 function editPin(original){
  const at=scope,pin={...original,photos:[...(original.photos||[])]},owned=[];
  const d=dialog('Saved pin',`<label>Name<input name="name" value="${esc(pin.name)}" maxlength="160" required></label><label>Notes<textarea name="note" maxlength="4000">${esc(pin.note)}</textarea></label><p>${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}</p><label>Add selected photos<input data-photos type="file" accept="image/jpeg,image/png,image/webp" multiple></label><small>Up to 10 photos. Copies are reduced to 2048 pixels; originals are unchanged. Saved only in this browser.</small><div class="photo-edit-list"></div><button type="button" data-delete>Delete pin</button>`);
  const q=s=>d.querySelector(s);q('[type=submit]').textContent='Save on this device';let busy=false;
  d.addEventListener('close',()=>owned.forEach(URL.revokeObjectURL),{once:true});
  function render(){owned.forEach(URL.revokeObjectURL);owned.length=0;q('.photo-edit-list').replaceChildren();for(const photo of pin.photos){const row=document.createElement('div'),img=document.createElement('img'),remove=document.createElement('button');img.src=URL.createObjectURL(photo.thumbnail||photo.blob);owned.push(img.src);img.alt=photo.name;remove.type='button';remove.textContent='Remove';remove.onclick=()=>{pin.photos=pin.photos.filter(p=>p.id!==photo.id);render();};row.append(img,remove);q('.photo-edit-list').append(row);}}
  const lock=value=>{busy=value;q('[type=submit]').disabled=value;q('[data-photos]').disabled=value;q('[data-delete]').disabled=value;};
  q('[data-photos]').onchange=async e=>{const files=[...e.target.files];e.target.value='';lock(true);try{if(files.length+pin.photos.length>10)throw Error('Choose up to 10 photos per pin.');const prepared=[];for(const file of files)prepared.push(await downscaleLocalPhoto(file));if(!valid(at)||!d.open)return;pin.photos.push(...prepared);render();q('.error').textContent='';}catch(error){q('.error').textContent=error.message;}finally{lock(false);}};
  q('form').onsubmit=async e=>{e.preventDefault();if(busy)return;lock(true);try{if(!valid(at))throw Error('Project changed. Reopen the pin.');pin.name=q('[name=name]').value.trim();pin.note=q('[name=note]').value;await storage.save(at,pin);if(valid(at)){const values=await storage.list(at);if(valid(at)){local=values;draw();}}d.close();}catch(error){q('.error').textContent=error.message;}finally{lock(false);}};
  q('[data-delete]').hidden=!local.some(p=>p.id===pin.id);q('[data-delete]').onclick=async()=>{if(!valid(at)||!confirm('Delete this local pin and its photos?'))return;lock(true);try{await storage.remove(at,pin.id);if(valid(at)){const values=await storage.list(at);if(valid(at)){local=values;draw();}}d.close();}catch(e){q('.error').textContent=e.message;}finally{lock(false);}};render();
 }
 function showLocation(lat,lng,name){if(!canStart())return;if(searchMarker)map.removeLayer(searchMarker);searchMarker=L.circleMarker([lat,lng],{radius:10,color:'#2870c7',fillOpacity:.4}).addTo(map);searchMarker.bindTooltip(name,{permanent:true});map.setView([lat,lng],17);}
 function openSearch(){
  const at=scope,d=dialog('Find location','<label>Search type<select name="mode"><option value="place">Place or address</option><option value="latlon">Latitude / longitude</option><option value="mga">MGA coordinates</option></select></label><label>Location<input name="query" required placeholder="Place name or address" maxlength="200"></label><div data-mga hidden><label>Zone<select name="zone">'+Array.from({length:11},(_,i)=>`<option ${i===7?'selected':''}>${48+i}</option>`).join('')+'</select></label><label>Datum<select name="datum"><option value="2020">GDA2020</option><option value="1994">GDA94</option></select></label></div><p data-hint>Place searches send your search text to Photon and require internet. © OpenStreetMap contributors.</p><button type="button" data-feature>Find a drill hole or project feature</button><div data-results></div>');
  const q=s=>d.querySelector(s);q('[type=submit]').textContent='Search';let generation=0;
  const cancel=()=>{generation++;request?.abort();q('[type=submit]').disabled=false;q('[data-results]').replaceChildren();};
  d.addEventListener('close',cancel,{once:true});q('[name=query]').oninput=cancel;q('[name=mode]').onchange=()=>{cancel();const mode=q('[name=mode]').value;q('[data-mga]').hidden=mode!=='mga';q('[name=query]').placeholder=mode==='place'?'Place name or address':mode==='latlon'?'-27.47, 153.03':'618703, 7579404';q('[data-hint]').textContent=mode==='place'?'Place searches send your search text to Photon and require internet. © OpenStreetMap contributors.':mode==='latlon'?'Decimal degrees, latitude first.':'Metres, easting first. Choose the correct zone and datum.';};
  q('[data-feature]').onclick=()=>{d.close();featureSearch();};
  q('form').onsubmit=async e=>{e.preventDefault();cancel();const token=generation,query=q('[name=query]').value.trim(),mode=q('[name=mode]').value;q('.error').textContent='';q('[type=submit]').disabled=true;
   try{
    if(mode!=='place'){let point=coordinateInput(query,mode,Number(q('[name=zone]').value),Number(q('[name=datum]').value));if(mode==='mga'){const output=await (await getEngine()).gdaltransform([[point.x,point.y]],['-s_srs',`EPSG:${point.epsg}`,'-t_srs','EPSG:4326','-output_xy']);point={lng:output?.[0]?.[0],lat:output?.[0]?.[1]};if(!Number.isFinite(point.lat)||!Number.isFinite(point.lng)||Math.abs(point.lat)>90||Math.abs(point.lng)>180)throw Error('Coordinate conversion unavailable.');}if(token!==generation||!valid(at))return;showLocation(point.lat,point.lng,query);d.close();return;}
    if(query.length<2)throw Error('Enter at least two characters.');let found=cachedPlaces.get(query);
    if(!found){if(Date.now()-lastRequest<1500)throw Error('Please wait a moment before searching again.');lastRequest=Date.now();request=new AbortController();const timeout=setTimeout(()=>request?.abort(),12000);try{const response=await fetch('https://photon.komoot.io/api/?'+new URLSearchParams({q:query,limit:'6'}),{signal:request.signal,credentials:'omit'});if(!response.ok)throw Error('Place search unavailable. Try coordinates or project features.');found=(await response.json()).features||[];if(cachedPlaces.size>50)cachedPlaces.clear();cachedPlaces.set(query,found);}finally{clearTimeout(timeout);}}
    if(token!==generation||!d.open||!valid(at))return;if(!found.length)throw Error('No places found. Try a nearby town or coordinates.');for(const result of found){const [lng,lat]=result.geometry?.coordinates||[];if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;const p=result.properties||{},title=[p.name,p.street,p.city,p.state,p.country].filter(Boolean).join(', '),b=document.createElement('button');b.type='button';b.textContent=title;b.onclick=()=>{showLocation(lat,lng,title);d.close();};q('[data-results]').append(b);}
   }catch(error){if(token===generation&&d.open)q('.error').textContent=error.name==='AbortError'?'Search timed out. Try again or use coordinates.':error.message;}finally{if(token===generation&&d.open)q('[type=submit]').disabled=false;}
  };
 }
 map.on('moveend',draw);void refresh();return {refresh,openSearch,openPhotos};
}
