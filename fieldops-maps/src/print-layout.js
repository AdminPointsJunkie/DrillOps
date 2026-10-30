import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './print-layout.css';
import {sizes,standardPage,sampleLayouts,resizePage,exportSize,imageExportSize,tokens,moveItem} from './print-model.js';
import {readPrintLayout,writePrintLayout} from './print-storage.js';
import {vectorStyle,pointMarker} from './layer-style.js';
import {annotationLayer} from './field-tools.js';
import {pointLabels} from './point-labels.js';
import {bearing,rotatePoint,frameLatLng,footprint,legendSVG,legendEntries} from './print-cartography.js';
import {pageSVG,vectorPDF,downloadBlob} from './print-vector.js';
import {logoKey} from './workspace-logo.js';
import {readImages} from './image-import.js';
const px=96/25.4,esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function openPrintEditor(context,{quick=false}={}){
 const key=`${quick?'export':'pages'}:${context.userId||'guest'}:${context.projectId||'unsaved'}`,templateKey=`templates:${context.userId||'guest'}`;
 const workspaceLogo=await readPrintLayout(logoKey(context.userId,context.workspaceId)).catch(()=>null);
 let previewScale=1;
 let pages=quick?[standardPage(context)]:await readPrintLayout(key)||[standardPage(context)],page=pages[0],selected=null,maps=new Map(),saving=Promise.resolve(),saveTimer,closed=false,editing=null,exporting=false;
 if(quick){const [width,height]=context.viewSize||[1000,700];page.width=Math.max(96,Math.min(9600,width))/px;page.height=Math.max(96,Math.min(9600,height))/px;page.format='PNG';page.resolution=2;page.quality=.92;page.title=true;page.description=false;
  const m=page.items.find(i=>i.type==='map'),legend=page.items.find(i=>i.type==='legend');Object.assign(m,{x:0,y:0,w:page.width,h:page.height,north:false});Object.assign(legend,{x:Math.max(0,page.width-65),y:8,w:Math.min(60,page.width),h:Math.min(Math.max(25,18+context.layers.length*7),page.height-16)});page.items=[m,legend];legend.h=Math.min(page.height-legend.y,legendSVG(context.layers,legend,legend.w*px,100000,{title:context.title}).height/px);}
 const root=document.createElement('section');root.className='print-editor';root.setAttribute('aria-label','Print layout editor');
 root.innerHTML=`<div class="print-toolbar"><strong>Print layouts</strong>${['Map','Locator','Legend','Text','Image','Section'].map(t=>`<button data-add="${t.toLowerCase()}">${t}</button>`).join('')}<button data-command="fit-page">Fit page</button><button data-command="actual-size">100%</button><button data-command="workspace-logo">Workspace logo</button><button data-command="save-template">Save layout</button><button data-command="templates">Use layout</button><button data-command="close">Close</button></div><div class="print-body"><aside class="print-pages"></aside><div class="print-stage"><div class="print-sheet"></div></div><aside class="print-settings"></aside></div><input class="print-image-input" type="file" accept="image/*,.heic,.heif" hidden>`;
 if(quick){root.classList.add('quick-export');root.querySelector('.print-toolbar strong').textContent='Export as image';for(const el of root.querySelectorAll('[data-add],[data-command=save-template],[data-command=templates]'))el.hidden=true;}
 root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');const previousFocus=document.activeElement;const app=document.querySelector('#app');if(app)app.inert=true;
 document.body.append(root);const sheet=root.querySelector('.print-sheet'),settings=root.querySelector('.print-settings'),sidebar=root.querySelector('.print-pages');
 const activeMaps=()=>page.items.filter(i=>i.type==='map');const targetFor=item=>activeMaps().find(m=>m.id===item.target)||activeMaps()[0];
 function status(message){const el=settings.querySelector('.print-status');if(el)el.textContent=message;}
 function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{const snapshot=structuredClone(pages);saving=saving.then(()=>writePrintLayout(key,snapshot)).catch(e=>status('Could not save layouts on this device: '+e.message));},250);}
 function stopEditing(){editing=null;for(const [id,m]of maps){if(quick){m._enablePrintEditing?.();continue;}m.dragging.disable();m.scrollWheelZoom.disable();root.querySelector(`[data-item="${id}"]`)?.classList.remove('editing');}}
 function cleanupMaps(){for(const m of maps.values())m.remove();maps.clear();}
 function select(id){page.items=page.items.filter(i=>i.id===id||i.type!=='text'||i.text.trim());selected=id;stopEditing();for(const el of sheet.querySelectorAll('.print-item'))el.classList.toggle('selected',el.dataset.item===id);renderSettings();}
 function renderPages(){if(quick){sidebar.hidden=true;return;}sidebar.innerHTML=pages.map(p=>`<button data-page="${p.id}" ${p===page?'aria-current="page"':''}>${esc(p.name)}</button>`).join('')+'<button data-page-add>＋ Add page</button><p class="print-help">Pages save on this device for this project. Export a page or combine all pages into one PDF.</p>';}
 function fitPage(){const stage=root.querySelector('.print-stage');previewScale=Math.min(1,(stage.clientWidth-40)/(page.width*px),(stage.clientHeight-40)/(page.height*px));previewScale=Math.max(.05,previewScale);sheet.style.zoom=previewScale;}
 function renderSheet(){
  cleanupMaps();sheet.style.width=page.width*px+'px';sheet.style.height=page.height*px+'px';sheet.replaceChildren();
  for(const item of [...page.items].sort((a,b)=>Number(b.type==='section')-Number(a.type==='section'))){
   if(item.hidden)continue;const el=document.createElement('div');el.className='print-item'+(item.id===selected?' selected':'');el.dataset.item=item.id;el.setAttribute('role','group');el.setAttribute('aria-label',item.type+' item');el.style.cssText=`left:${item.x*px}px;top:${item.y*px}px;width:${item.w*px}px;height:${item.h*px}px;`;
   const content=document.createElement('div');content.className='print-content';el.append(content);const resize=document.createElement('span');resize.className='resize';resize.setAttribute('aria-label','Resize item');el.append(resize);sheet.append(el);
   if(item.type==='text'){const text=document.createElement('div');text.className='print-text';text.style.fontSize=(item.fontSize||14)+'px';text.textContent=tokens(item.text,context);content.append(text);}
   else if(item.type==='section'){content.style.background=item.color||'#e8eee9';}
   else if(item.type==='image'){const image=document.createElement('img');image.className='print-logo';image.src=item.src;image.alt='Layout image';content.append(image);}
   else if(item.type==='legend'){const target=targetFor(item),shown=context.layers.filter(l=>(target?.layers||[]).includes(l.id)),legend=legendSVG(shown,item,item.w*px,item.h*px,{title:quick&&page.title?context.title:'Legend',description:quick&&page.description?context.description:''});content.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${item.w*px} ${item.h*px}">${legend.markup}</svg>`;if(legend.overflow){el.dataset.overflow='true';el.title='Legend contents exceed this box. Enlarge the legend before exporting.';}}
   else if(item.type==='map'||item.type==='locator'){renderMap(item,content);if(item.frame){const border=document.createElement('div');border.className='print-neatline';content.append(border);}}
  }
  updateLocators();
 }
 function updateLocators(){for(const item of page.items.filter(i=>i.type==='locator')){const m=maps.get(item.id),target=maps.get(targetFor(item)?.id);if(!m||!target)continue;m.setView(target.getCenter(),Math.max(0,target.getZoom()-4));m._footprint?.remove();m._footprint=L.polygon(footprint(target),{color:'#c33',weight:2,fillOpacity:.08}).addTo(m);}}
 function renderMap(item,content){
  const target=item.type==='locator'?targetFor(item):item;if(!target){content.textContent='Add a map view first.';return;}
  const frame=document.createElement('div');frame.className='print-map-frame';content.append(frame);
  const container=document.createElement('div');container.className='print-map';frame.append(container);
  const width=content.clientWidth,height=content.clientHeight,angle=item.type==='map'?bearing(item.bearing):0,side=angle?Math.ceil(Math.hypot(width,height)):0;
  if(angle)container.style.cssText=`width:${side}px;height:${side}px;left:${(width-side)/2}px;top:${(height-side)/2}px;transform:rotate(${angle}deg)`;
  const m=L.map(container,{zoomControl:false,attributionControl:true,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false});maps.set(item.id,m);m._printFrame={width,height,bearing:angle};content.append(m.getContainer().querySelector('.leaflet-control-container'));
  m.setView(target.center||context.center,Math.max(0,(target.zoom??context.zoom)-(item.type==='locator'?4:0)));
  const type=target.basemap||context.basemap||'street';const url=type==='street'?'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png':'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  if(type!=='none')L.tileLayer(url,{crossOrigin:'anonymous',maxNativeZoom:type==='street'?19:17,maxZoom:22,attribution:type==='street'?'© OpenStreetMap contributors':'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community'}).addTo(m);
  if(type==='hybrid')L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{crossOrigin:'anonymous',maxNativeZoom:17,maxZoom:22,attribution:'Labels © Esri, HERE, Garmin, OpenStreetMap contributors'}).addTo(m);
  if(item.type==='map'){
   for(const l of context.layers.filter(l=>(item.layers||[]).includes(l.id)).slice().reverse()){
    let ml;const pane='print-'+l.id;const layerPane=m.createPane(pane);layerPane.style.zIndex=400+context.layers.length-context.layers.indexOf(l);layerPane.dataset.printLayer=l.id;
    if(l.metadata?.xyz)ml=L.tileLayer(l.metadata.xyz.url,{pane,crossOrigin:'anonymous',opacity:l.opacity??1,maxNativeZoom:l.metadata.xyz.maxZoom,maxZoom:22,attribution:esc(l.metadata.xyz.attribution)});
    else if(l.kind==='raster')ml=L.imageOverlay(l.url,[[l.bounds[1],l.bounds[0]],[l.bounds[3],l.bounds[2]]],{pane,opacity:l.opacity??.8,crossOrigin:'anonymous'});
    else if(l.metadata?.annotation)ml=annotationLayer(L,l,{pane});
    else ml=L.geoJSON(l.fc,{pane,style:f=>vectorStyle(l,f),pointToLayer:(f,ll)=>pointMarker(L,l,ll,{pane},f)});
    ml.addTo(m);if(l.kind==='vector'&&!l.metadata?.annotation)pointLabels(ml,{...l,_pane:pane},m.getBounds(),document);
   }
   if(item.scale)L.control.scale({position:'bottomleft',metric:item.measurement!=='us',imperial:item.measurement==='us'}).addTo(m);
   if(item.north){const arrow=document.createElement('div');arrow.className='print-north';arrow.innerHTML='<span>N<br>▲</span>';arrow.firstChild.style.transform=`rotate(${angle}deg)`;content.append(arrow);}
   m.on('moveend',()=>{if(!quick&&editing!==item.id)return;item.center=[m.getCenter().lat,m.getCenter().lng];item.zoom=m.getZoom();persist();updateLocators();});
  }
  const cover=document.createElement('div');cover.className='print-map-edit';content.append(cover);
  const interactive=()=>!exporting&&(quick||editing===item.id);
  // Rotate pointer movement into the map's unrotated coordinate space.
  let pan;
  frame.addEventListener('pointerdown',e=>{if(!angle||!interactive()||e.button!==0)return;pan=[e.clientX,e.clientY];frame.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();});
  frame.addEventListener('pointermove',e=>{if(!pan)return;const [dx,dy]=rotatePoint(pan[0]-e.clientX,pan[1]-e.clientY,-angle);pan=[e.clientX,e.clientY];m.panBy([dx,dy],{animate:false});});
  const end=()=>{pan=null;};frame.addEventListener('pointerup',end);frame.addEventListener('pointercancel',end);
  frame.addEventListener('wheel',e=>{if(!angle||!interactive())return;e.preventDefault();const r=frame.getBoundingClientRect(),ll=frameLatLng(m,e.clientX-r.left,e.clientY-r.top);m.setZoomAround(ll,m.getZoom()+(e.deltaY<0?1:-1));},{passive:false});
  m._enablePrintEditing=()=>{if(!angle){m.dragging.enable();m.scrollWheelZoom.enable();}};
  if(quick&&item.type==='map'){cover.style.display='none';m._enablePrintEditing();}
  if(item.type==='map'){const zoom=document.createElement('div');zoom.className='print-zoom';zoom.innerHTML='<button type="button" aria-label="Zoom map in">+</button><button type="button" aria-label="Zoom map out">−</button>';const buttons=zoom.querySelectorAll('button');buttons[0].onclick=()=>m.zoomIn();buttons[1].onclick=()=>m.zoomOut();zoom.onpointerdown=e=>e.stopPropagation();content.append(zoom);}

 }
 function field(label,html){return `<label>${label}${html}</label>`;}
 function number(label,name,value,min=0,max=2540){return field(label,`<input type="number" data-field="${name}" value="${value}" min="${min}" max="${max}" step="any">`);}
 function renderSettings(){
  const item=quick?null:page.items.find(i=>i.id===selected);let body='';
  if(quick){const m=activeMaps()[0],legend=page.items.find(i=>i.type==='legend');body='<h3>Export image</h3>'+field('Width (px)',`<input type="number" data-quick="width" min="96" max="9600" value="${Math.round(page.width*px)}">`)+field('Height (px)',`<input type="number" data-quick="height" min="96" max="9600" value="${Math.round(page.height*px)}">`)+field('Resolution',`<select data-page-field="resolution">${[1,2,3,4].map(v=>`<option value="${v}" ${page.resolution===v?'selected':''}>${v}×</option>`).join('')}</select>`)+field('Format',`<select data-page-field="format">${['PNG','JPG','PDF','Vector PDF','SVG'].map(v=>`<option ${page.format===v?'selected':''}>${v}</option>`).join('')}</select>`);
   if(page.format==='JPG')body+=field('JPG quality',`<input type="range" min="0.1" max="1" step="0.05" data-page-field="quality" value="${page.quality}">`);
   for(const [name,label,checked]of [['legend','Legend',!legend.hidden],['scale','Scale bar',m.scale],['frame','Map frame',m.frame],['title','Map title',page.title],['description','Description',page.description]])body+=`<label><input type="checkbox" data-quick="${name}" ${checked?'checked':''}>${label}</label>`;
   body+=field('Map rotation (° clockwise)',`<input type="number" data-quick="bearing" value="${bearing(m.bearing)}" min="0" max="360">`)+ '<button data-command="north">Point north</button><button data-command="fit-legend">Fit legend height</button>';
   body+=field('Scale units',`<select data-quick="measurement"><option value="metric">Metric</option><option value="us" ${m.measurement==='us'?'selected':''}>US</option></select>`)+'<p class="print-help">Drag or scroll inside the preview to pan and zoom. Drag the legend or its corner to move or resize it.</p>';
  }else if(item){body=`<h3>${esc(item.type[0].toUpperCase()+item.type.slice(1))}</h3>`+number('X (mm)','x',item.x)+number('Y (mm)','y',item.y)+number('Width (mm)','w',item.w,5)+number('Height (mm)','h',item.h,5);
   if(item.type==='text')body+=field('Text and tokens',`<textarea data-field="text" rows="4">${esc(item.text)}</textarea>`)+number('Text size (px)','fontSize',item.fontSize||14,6,200)+'<p class="print-help">Tokens: {{ map.title }}, {{ map.description }}, {{ current.date }}</p>';
   if(item.type==='section')body+=field('Background',`<input type="color" data-field="color" value="${item.color||'#e8eee9'}">`);
   if(item.type==='map'){body+='<button data-command="pan-map">Pan / zoom map</button><p class="print-help">Double-click the map to pan and zoom. Press Esc when finished.</p>'+field('Basemap',`<select data-field="basemap">${['street','satellite','hybrid','none'].map(v=>`<option value="${v}" ${(item.basemap||context.basemap)===v?'selected':''}>${v}</option>`).join('')}</select>`);
    body+=number('Map rotation (° clockwise)','bearing',bearing(item.bearing),0,360)+'<button data-command="north">Point north</button>';
    for(const [name,label] of [['north','North arrow'],['scale','Scale bar'],['frame','Map frame']])body+=`<label><input type="checkbox" data-field="${name}" ${item[name]?'checked':''}>${label}</label>`;
    body+=field('Scale units',`<select data-field="measurement"><option value="metric">Metric</option><option value="us" ${item.measurement==='us'?'selected':''}>US</option></select>`)+`<div class="print-layer-list"><strong>Layers</strong>${context.layers.map(l=>`<label><input type="checkbox" data-layer="${l.id}" ${(item.layers||[]).includes(l.id)?'checked':''}>${esc(l.name)}</label>`).join('')}</div>`;
   }
   if(['legend','locator'].includes(item.type))body+=field('Target map',`<select data-field="target">${activeMaps().map((m,i)=>`<option value="${m.id}" ${targetFor(item)?.id===m.id?'selected':''}>Map ${i+1}</option>`).join('')}</select>`);
   if(item.type==='legend'){body+=number('Legend text size','fontSize',item.fontSize||12,6,40)+`<label><input type="checkbox" data-field="showCounts" ${item.showCounts?'checked':''}>Show feature counts</label><div class="print-layer-list"><strong>Legend entries</strong>${context.layers.filter(l=>(targetFor(item)?.layers||[]).includes(l.id)).map(l=>`<label><input type="checkbox" data-legend="${esc(l.id)}" ${!(item.hiddenLayers||[]).includes(l.id)?'checked':''}><b>${esc(l.name)}</b></label>${legendEntries(l).map(entry=>`<label><input type="checkbox" data-entry="${esc(entry.key)}" ${!item.hiddenEntries?.includes(entry.key)?'checked':''}>${esc(entry.label)}<input aria-label="Legend label ${esc(entry.label)}" data-entry-label="${esc(entry.key)}" value="${esc(item.entryLabels?.[entry.key]??entry.label)}"></label>`).join('')}`).join('')}</div><button data-command="fit-legend">Fit legend height</button>`;}

   body+='<button data-command="duplicate">Duplicate</button><button data-command="delete">Delete item</button><button data-command="page-settings">Page settings</button>';
  }else{
   body='<h3>Page settings</h3>'+field('Page name',`<input data-page-field="name" value="${esc(page.name)}">`)+field('Page size',`<select data-size><option value="custom">Custom</option>${Object.keys(sizes).map(v=>`<option value="${v}">${v==='Tabloid'?'11 × 17':v}</option>`).join('')}</select>`)+field('Display units',`<select data-page-field="units">${['mm','cm','in','px'].map(v=>`<option ${page.units===v?'selected':''}>${v}</option>`).join('')}</select>`);
   const unit=page.units||'mm',factor={mm:1,cm:10,in:25.4,px:25.4/96}[unit];body+=field(`Width (${unit})`,`<input type="number" data-dimension="width" value="${+(page.width/factor).toFixed(3)}" min="${25.4/factor}" max="${2540/factor}" step="any">`)+field(`Height (${unit})`,`<input type="number" data-dimension="height" value="${+(page.height/factor).toFixed(3)}" min="${25.4/factor}" max="${2540/factor}" step="any">`)+'<button data-command="orientation">Swap orientation</button>';
   body+=field('Format',`<select data-page-field="format">${['PDF','Vector PDF','SVG','PNG','JPG'].map(v=>`<option ${page.format===v?'selected':''}>${v}</option>`).join('')}</select>`)+field('DPI',`<select data-page-field="dpi">${[150,300,600].map(v=>`<option ${page.dpi===v?'selected':''}>${v}</option>`).join('')}</select>`)+'<button data-command="delete-page">Delete page</button>';
  }
  const dimensions=quick?imageExportSize(Math.round(page.width*px),Math.round(page.height*px),page.resolution):exportSize(page.width,page.height,page.dpi);body+=`<p class="print-status" role="status">${dimensions.width} × ${dimensions.height} px${dimensions.reduced?` · Reduced to ${dimensions.dpi} DPI to stay within this browser’s 32-megapixel / 16,384-pixel limit.`:''}</p><button class="print-export" data-command="export">Export ${page.format}</button>${!quick?'<button class="print-export" data-command="export-all">Export all pages as PDF</button><label>Combined PDF content<select data-page-field="pdfContent"><option value="vector" '+(page.pdfContent!=='raster'?'selected':'')+'>Editable vectors</option><option value="raster" '+(page.pdfContent==='raster'?'selected':'')+'>Raster images</option></select></label>':''}<p class="print-help">SVG and Vector PDF keep geometry and text editable; imagery remains raster. PDF uses a raster page. Credits are retained. Layouts save on this device.</p>`;settings.innerHTML=body;
 }
 function render(){renderPages();renderSheet();renderSettings();if(!exporting)fitPage();}
 function add(type){if(type==='image'){root.querySelector('.print-image-input').click();return;}const item={id:crypto.randomUUID(),type,x:15,y:30,w:type==='map'?150:70,h:type==='map'?100:40};if(type==='map')Object.assign(item,{center:context.center,zoom:context.zoom,layers:context.layers.map(l=>l.id),north:true,scale:true,measurement:'metric'});if(type==='text')Object.assign(item,{text:'Title {{ map.title }}',fontSize:20,h:15});if(type==='section')item.color='#e8eee9';if(['legend','locator'].includes(type))item.target=activeMaps()[0]?.id;page.items.push(item);selected=item.id;render();persist();}
 root.querySelector('.print-image-input').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const [image]=await readImages(file);const reader=new FileReader();const src=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(image.image.blob);});const item={id:crypto.randomUUID(),type:'image',x:15,y:15,w:50,h:50*image.image.height/image.image.width,src};page.items.push(item);selected=item.id;render();persist();}catch(error){status(error.message);}finally{e.target.value='';}};
 root.addEventListener('input',e=>{
  if(e.target.dataset.quick==='bearing'||e.target.dataset.field==='bearing'){const item=quick?activeMaps()[0]:page.items.find(i=>i.id===selected);if(item){item.bearing=bearing(e.target.value);renderSheet();persist();}}
  if(e.target.dataset.pageField==='name'){page.name=e.target.value;const button=sidebar.querySelector(`[data-page="${page.id}"]`);if(button)button.textContent=page.name;persist();}
  if(e.target.dataset.field==='text'){const item=page.items.find(i=>i.id===selected);if(item){item.text=e.target.value;const text=sheet.querySelector(`[data-item="${item.id}"] .print-text`);if(text)text.textContent=tokens(item.text,context);persist();}}
  if(e.target.dataset.entryLabel){const item=page.items.find(i=>i.id===selected);if(item){item.entryLabels={...item.entryLabels,[e.target.dataset.entryLabel]:e.target.value};renderSheet();persist();}}
  if(e.target.dataset.pageField==='quality'){page.quality=Number(e.target.value);persist();}
 });
 root.addEventListener('change',e=>{try{
  const item=page.items.find(i=>i.id===selected),field=e.target.dataset.field;
  if(field&&item){item[field]=e.target.type==='checkbox'?e.target.checked:e.target.type==='number'?Number(e.target.value):e.target.value;if(['x','y','w','h'].includes(field)){if(!Number.isFinite(item[field]))throw Error('Enter a valid dimension.');item.w=Math.min(Math.max(5,item.w),page.width);item.h=Math.min(Math.max(5,item.h),page.height);moveItem(item,0,0,page);}}
  if(e.target.dataset.layer&&item){item.layers=e.target.checked?[...new Set([...item.layers,e.target.dataset.layer])]:item.layers.filter(id=>id!==e.target.dataset.layer);}
  if(e.target.dataset.entry&&item){item.hiddenEntries=e.target.checked?(item.hiddenEntries||[]).filter(k=>k!==e.target.dataset.entry):[...(item.hiddenEntries||[]),e.target.dataset.entry];}
  if(e.target.dataset.entryLabel&&item){item.entryLabels={...item.entryLabels,[e.target.dataset.entryLabel]:e.target.value};}
  if(e.target.dataset.legend&&item){item.hiddenLayers=e.target.checked?(item.hiddenLayers||[]).filter(id=>id!==e.target.dataset.legend):[...(item.hiddenLayers||[]),e.target.dataset.legend];}
  if(e.target.dataset.pageField){const field=e.target.dataset.pageField;page[field]=['dpi','resolution','quality'].includes(field)?Number(e.target.value):e.target.value;}
  if(e.target.dataset.quick){const field=e.target.dataset.quick,m=activeMaps()[0],legend=page.items.find(i=>i.type==='legend');if(['width','height'].includes(field)){const value=Number(e.target.value);if(value<96||value>9600||!Number.isFinite(value))throw Error('Choose 96–9,600 pixels.');page[field]=value/px;m.w=page.width;m.h=page.height;moveItem(legend,0,0,page);}else if(field==='legend')legend.hidden=!e.target.checked;else if(field==='scale'||field==='frame')m[field]=e.target.checked;else if(field==='measurement')m.measurement=e.target.value;else if(field==='bearing')m.bearing=bearing(e.target.value);else page[field]=e.target.checked;}
  if(e.target.dataset.dimension){const factor={mm:1,cm:10,in:25.4,px:25.4/96}[page.units||'mm'],value=Number(e.target.value)*factor;if(!Number.isFinite(value)||value<25.4||value>2540)throw Error('Page dimensions must be between 1 and 100 inches.');resizePage(page,e.target.dataset.dimension==='width'?value:page.width,e.target.dataset.dimension==='height'?value:page.height);}
  if(e.target.hasAttribute('data-size')&&sizes[e.target.value])resizePage(page,...sizes[e.target.value]);
  render();persist();
 }catch(error){renderSettings();status(error.message);}});
 let drag;
 sheet.addEventListener('pointerdown',e=>{if(exporting||e.button!==0||editing)return;const el=e.target.closest('.print-item');if(quick&&el?.dataset.item===activeMaps()[0]?.id){return;}if(!el){select(null);return;}const item=page.items.find(i=>i.id===el.dataset.item);select(item.id);drag={item,startX:e.clientX,startY:e.clientY,start:structuredClone(item),resize:e.target.classList.contains('resize')};sheet.setPointerCapture(e.pointerId);e.preventDefault();});
 sheet.addEventListener('pointermove',e=>{if(!drag)return;Object.assign(drag.item,{x:drag.start.x,y:drag.start.y,w:drag.start.w,h:drag.start.h});moveItem(drag.item,(e.clientX-drag.startX)/(px*previewScale),(e.clientY-drag.startY)/(px*previewScale),page,drag.resize);const el=sheet.querySelector(`[data-item="${drag.item.id}"]`);Object.assign(el.style,{left:drag.item.x*px+'px',top:drag.item.y*px+'px',width:drag.item.w*px+'px',height:drag.item.h*px+'px'});});
 const finishDrag=()=>{if(!drag)return;drag=null;renderSheet();renderSettings();persist();};sheet.addEventListener('pointerup',finishDrag);sheet.addEventListener('pointercancel',finishDrag);
 sheet.addEventListener('dblclick',e=>{const item=page.items.find(i=>i.id===e.target.closest('.print-item')?.dataset.item);if(item?.type!=='map')return;select(item.id);editing=item.id;const m=maps.get(item.id);m._enablePrintEditing();root.querySelector(`[data-item="${item.id}"]`).classList.add('editing');status('Pan or zoom this map. Press Esc when finished.');});
 async function waitForMaps(){
  await document.fonts.ready;for(const m of maps.values())m.invalidateSize();
  const start=Date.now();while([...maps.values()].some(m=>{let loading=false;m.eachLayer(l=>{if(l.isLoading?.())loading=true;});return loading;})){if(Date.now()-start>20000)throw Error('Some map tiles are still loading. Wait or choose another basemap, then retry.');await sleep(100);}
  await Promise.all([...sheet.querySelectorAll('img')].map(img=>img.decode?.().catch(()=>{})));
  if([...sheet.querySelectorAll('img')].some(i=>!i.complete||!i.naturalWidth))throw Error('Some map images could not load. Choose another basemap or remove the unavailable layer.');
  if(sheet.querySelector('[data-overflow]'))throw Error('A legend is clipped. Select it and use Fit legend height, enlarge it, or hide entries before exporting.');
 }
 async function exportPage(all=false){
  if(exporting)return;exporting=true;sheet.style.zoom=1;stopEditing();selected=null;const original=page,selection=all?[...pages]:[page],vector=all?page.pdfContent!=='raster':page.format==='Vector PDF';
  root.classList.add('print-exporting');const busy=()=>{for(const b of root.querySelectorAll('button,input,select,textarea'))b.disabled=true;};busy();
  try{
   let pdf;const pdfOutput=all||page.format.includes('PDF');
   for(let index=0;index<selection.length;index++){
    page=selection[index];render();busy();status(`Preparing page ${index+1} of ${selection.length}. Keep this tab visible…`);await waitForMaps();
    const dimensions=quick?imageExportSize(Math.round(page.width*px),Math.round(page.height*px),page.resolution):exportSize(page.width,page.height,page.dpi),ratio=dimensions.width/(page.width*px);
    if(pdfOutput){if(!pdf){const {jsPDF}=await import('jspdf');pdf=new jsPDF({orientation:page.width>page.height?'landscape':'portrait',unit:'mm',format:[page.width,page.height],compress:true});}else pdf.addPage([page.width,page.height],page.width>page.height?'landscape':'portrait');}
    if(vector||(!all&&page.format==='SVG')){const svg=await pageSVG(page,context,maps,{quick,pixelRatio:ratio});if(pdfOutput)await vectorPDF(pdf,svg,page.width,page.height);else downloadBlob(new Blob([svg],{type:'image/svg+xml'}),filename(page)+'.svg');}
    else{const {toCanvas}=await import('html-to-image');const canvas=await toCanvas(sheet,{style:{margin:'0',boxShadow:'none',zoom:'1'},width:page.width*px,height:page.height*px,backgroundColor:'#ffffff',pixelRatio:ratio,skipAutoScale:true,filter:node=>!['resize','print-map-edit','print-zoom','leaflet-control-zoom'].some(c=>node.classList?.contains(c)),fontEmbedCSS:''});
     if(pdfOutput)pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,page.width,page.height);
     else{const blob=await new Promise(r=>canvas.toBlob(r,page.format==='JPG'?'image/jpeg':'image/png',page.quality??.95));if(!blob)throw Error('This browser could not encode the page. Choose a lower DPI.');downloadBlob(blob,filename(page)+(page.format==='JPG'?'.jpg':'.png'));}
    }
   }
   if(pdf)pdf.save((all?filename(null)+' — All pages':filename(page))+'.pdf');
   page=original;render();status(all?`Exported ${selection.length} pages in one PDF.`:'Export complete.');
  }catch(error){page=original;render();status('Export failed: '+error.message);}
  finally{exporting=false;fitPage();root.classList.remove('print-exporting');for(const b of root.querySelectorAll('button,input,select,textarea'))b.disabled=false;}
 }
 function filename(p){return (context.title+(!quick&&p?' — '+p.name:'')).replace(/[^\p{L}\p{N} ._-]/gu,'_');}

 function duplicate(){const item=page.items.find(i=>i.id===selected);if(!item)return;const copy=structuredClone(item);copy.id=crypto.randomUUID();moveItem(copy,5,5,page);page.items.push(copy);selected=copy.id;render();persist();}
 async function close(){if(exporting)return;closed=true;clearTimeout(saveTimer);await saving;try{await writePrintLayout(key,pages);}catch{}observer.disconnect();cleanupMaps();document.removeEventListener('keydown',keyboard);root.remove();if(app)app.inert=false;previousFocus?.focus();context.onClose?.();}
 function keyboard(e){if(closed)return;if(exporting){if(e.key==='Escape'||((e.metaKey||e.ctrlKey)&&['p','d'].includes(e.key.toLowerCase())))e.preventDefault();return;}if(e.key==='Escape'){e.preventDefault();if(editing){stopEditing();renderSheet();persist();}else select(null);}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='p'){e.preventDefault();void exportPage();}}
 document.addEventListener('keydown',keyboard);
 root.addEventListener('click',async e=>{const addType=e.target.closest('[data-add]')?.dataset.add;if(addType){add(addType);return;}const pageId=e.target.closest('[data-page]')?.dataset.page;if(pageId){stopEditing();page=pages.find(p=>p.id===pageId);selected=null;render();return;}if(e.target.closest('[data-page-add]')){page=standardPage(context);page.name='Page '+(pages.length+1);pages.push(page);selected=null;render();persist();return;}
  const command=e.target.closest('[data-command]')?.dataset.command;if(!command)return;
  if(command==='fit-page'){fitPage();return;}if(command==='actual-size'){previewScale=1;sheet.style.zoom=1;return;}
  if(command==='pan-map'){const item=page.items.find(i=>i.id===selected);if(item?.type==='map'){editing=item.id;maps.get(item.id)._enablePrintEditing();sheet.querySelector(`[data-item="${item.id}"]`).classList.add('editing');status('Drag the map to frame it. Press Esc when finished.');}return;}
  if(command==='workspace-logo'){const placed=page.items.find(i=>i.workspaceLogo);if(placed){placed.hidden=!placed.hidden;render();persist();return;}if(!workspaceLogo){status('Upload a logo in Workspace settings first, then reopen this editor.');return;}const logo={id:crypto.randomUUID(),type:'image',workspaceLogo:true,src:workspaceLogo,x:12,y:8,w:35,h:15};page.items.push(logo);selected=logo.id;render();persist();return;}
  if(command==='close')return close();if(command==='export')return exportPage();if(command==='export-all')return exportPage(true);if(command==='duplicate')return duplicate();
  if(command==='north'){const m=quick?activeMaps()[0]:page.items.find(i=>i.id===selected);if(m)m.bearing=0;}
  if(command==='fit-legend'){const item=quick?page.items.find(i=>i.type==='legend'):page.items.find(i=>i.id===selected);if(item?.type==='legend'){const result=legendSVG(context.layers.filter(l=>targetFor(item)?.layers.includes(l.id)),item,item.w*px,item.h*px,{title:quick&&page.title?context.title:'Legend',description:quick&&page.description?context.description:''});item.h=Math.min(page.height-item.y,result.height/px);}}
  if(command==='page-settings'){select(null);return;}if(command==='delete'){page.items=page.items.filter(i=>i.id!==selected);selected=null;}
  if(command==='orientation')resizePage(page,page.height,page.width);
  if(command==='delete-page'){if(pages.length===1){status('Keep at least one page.');return;}pages=pages.filter(p=>p!==page);page=pages[0];selected=null;}
  if(command==='save-template'){const name=prompt('Layout name');if(!name?.trim())return;const templates=await readPrintLayout(templateKey)||[];templates.push({name:name.trim(),page:structuredClone(page)});await writePrintLayout(templateKey,templates);status('Reusable layout saved on this device.');return;}
  if(command==='templates'){
   const templates=[...sampleLayouts(context),...(await readPrintLayout(templateKey)||[])],picker=document.createElement('dialog');picker.className='print-template-picker';
   picker.innerHTML='<h2>Choose a layout</h2><p>Add a sample or saved layout as a new page, then customise its maps, text, legend and images.</p><div class="print-template-grid">'+templates.map((t,index)=>`<button data-template="${index}"><span class="print-template-thumb" style="aspect-ratio:${t.page.width}/${t.page.height}">${t.page.items.map(item=>`<i style="left:${item.x/t.page.width*100}%;top:${item.y/t.page.height*100}%;width:${item.w/t.page.width*100}%;height:${item.h/t.page.height*100}%;background:${item.type==='map'?'#dce6ed':item.type==='text'?'#8896a2':'#edf0f3'}"></i>`).join('')}</span><strong>${esc(t.name)}</strong></button>`).join('')+'</div><button data-dismiss>Cancel</button>';
   root.append(picker);picker.showModal();picker.oncancel=()=>picker.remove();picker.querySelector('[data-dismiss]').onclick=()=>picker.remove();picker.querySelectorAll('[data-template]').forEach(button=>button.onclick=()=>{const template=templates[Number(button.dataset.template)],copy=structuredClone(template.page);copy.id=crypto.randomUUID();copy.name=template.name;for(const item of copy.items)if(item.type==='map'){item.center=context.center;item.zoom=context.zoom;item.layers=context.layers.map(l=>l.id);}pages.push(copy);page=copy;selected=null;picker.remove();render();persist();});return;
  }
  render();persist();
 });
 const observer=new ResizeObserver(()=>{if(!exporting)fitPage();});observer.observe(root.querySelector('.print-stage'));
 render();return {close};
}
