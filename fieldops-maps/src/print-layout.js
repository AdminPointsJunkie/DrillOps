import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './print-layout.css';
import {sizes,standardPage,resizePage,exportSize,imageExportSize,tokens,moveItem} from './print-model.js';
import {readPrintLayout,writePrintLayout} from './print-storage.js';
import {vectorStyle,pointMarker} from './layer-style.js';
import {annotationLayer} from './field-tools.js';
import {pointLabels} from './point-labels.js';
import {readImages} from './image-import.js';
const px=96/25.4,esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function openPrintEditor(context,{quick=false}={}){
 const key=`${quick?'export':'pages'}:${context.userId||'guest'}:${context.projectId||'unsaved'}`,templateKey=`templates:${context.userId||'guest'}`;
 let pages=quick?[standardPage(context)]:await readPrintLayout(key)||[standardPage(context)],page=pages[0],selected=null,maps=new Map(),saving=Promise.resolve(),saveTimer,closed=false,editing=null,exporting=false;
 if(quick){const [width,height]=context.viewSize||[1000,700];page.width=Math.max(96,Math.min(9600,width))/px;page.height=Math.max(96,Math.min(9600,height))/px;page.format='PNG';page.resolution=2;page.quality=.92;page.title=true;page.description=false;
  const m=page.items.find(i=>i.type==='map'),legend=page.items.find(i=>i.type==='legend');Object.assign(m,{x:0,y:0,w:page.width,h:page.height,north:false});Object.assign(legend,{x:Math.max(0,page.width-65),y:8,w:Math.min(60,page.width),h:Math.min(Math.max(25,18+context.layers.length*7),page.height-16)});page.items=[m,legend];}
 const root=document.createElement('section');root.className='print-editor';root.setAttribute('aria-label','Print layout editor');
 root.innerHTML=`<div class="print-toolbar"><strong>Print layouts</strong>${['Map','Locator','Legend','Text','Image','Section'].map(t=>`<button data-add="${t.toLowerCase()}">${t}</button>`).join('')}<button data-command="save-template">Save layout</button><button data-command="templates">Use layout</button><button data-command="close">Close</button></div><div class="print-body"><aside class="print-pages"></aside><div class="print-stage"><div class="print-sheet"></div></div><aside class="print-settings"></aside></div><input class="print-image-input" type="file" accept="image/*,.heic,.heif" hidden>`;
 if(quick){root.classList.add('quick-export');root.querySelector('.print-toolbar strong').textContent='Export as image';for(const el of root.querySelectorAll('[data-add],[data-command=save-template],[data-command=templates]'))el.hidden=true;}
 root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');const previousFocus=document.activeElement;const app=document.querySelector('#app');if(app)app.inert=true;
 document.body.append(root);const sheet=root.querySelector('.print-sheet'),settings=root.querySelector('.print-settings'),sidebar=root.querySelector('.print-pages');
 const activeMaps=()=>page.items.filter(i=>i.type==='map');const targetFor=item=>activeMaps().find(m=>m.id===item.target)||activeMaps()[0];
 function status(message){const el=settings.querySelector('.print-status');if(el)el.textContent=message;}
 function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{const snapshot=structuredClone(pages);saving=saving.then(()=>writePrintLayout(key,snapshot)).catch(e=>status('Could not save layouts on this device: '+e.message));},250);}
 function stopEditing(){editing=null;for(const [id,m]of maps){m.dragging.disable();m.scrollWheelZoom.disable();root.querySelector(`[data-item="${id}"]`)?.classList.remove('editing');}}
 function cleanupMaps(){for(const m of maps.values())m.remove();maps.clear();}
 function select(id){page.items=page.items.filter(i=>i.id===id||i.type!=='text'||i.text.trim());selected=id;stopEditing();for(const el of sheet.querySelectorAll('.print-item'))el.classList.toggle('selected',el.dataset.item===id);renderSettings();}
 function renderPages(){if(quick){sidebar.hidden=true;return;}sidebar.innerHTML=pages.map(p=>`<button data-page="${p.id}" ${p===page?'aria-current="page"':''}>${esc(p.name)}</button>`).join('')+'<button data-page-add>＋ Add page</button><p class="print-help">Pages save on this device for this project. Export each page separately.</p>';}
 function renderSheet(){
  cleanupMaps();sheet.style.width=page.width*px+'px';sheet.style.height=page.height*px+'px';sheet.replaceChildren();
  for(const item of [...page.items].sort((a,b)=>Number(b.type==='section')-Number(a.type==='section'))){
   if(item.hidden)continue;const el=document.createElement('div');el.className='print-item'+(item.id===selected?' selected':'');el.dataset.item=item.id;el.style.cssText=`left:${item.x*px}px;top:${item.y*px}px;width:${item.w*px}px;height:${item.h*px}px;`;
   const content=document.createElement('div');content.className='print-content';el.append(content);const resize=document.createElement('span');resize.className='resize';resize.setAttribute('aria-label','Resize item');el.append(resize);sheet.append(el);
   if(item.type==='text'){const text=document.createElement('div');text.className='print-text';text.style.fontSize=(item.fontSize||14)+'px';text.textContent=tokens(item.text,context);content.append(text);}
   else if(item.type==='section'){content.style.background=item.color||'#e8eee9';}
   else if(item.type==='image'){const image=document.createElement('img');image.className='print-logo';image.src=item.src;image.alt='Layout image';content.append(image);}
   else if(item.type==='legend'){const target=targetFor(item),shown=context.layers.filter(l=>(target?.layers||[]).includes(l.id)&&!(item.hiddenLayers||[]).includes(l.id));content.innerHTML=`<div class="print-legend"><strong>${quick&&page.title?esc(context.title):'Legend'}</strong>${quick&&page.description?`<p>${esc(context.description||'')}</p>`:''}${shown.map(l=>`<div class="print-legend-row"><i style="background:${/^#[\da-f]{3,8}$/i.test(l.color)?l.color:'#38624a'}"></i><span>${esc(l.name)}</span></div>`).join('')}</div>`;}
   else if(item.type==='map'||item.type==='locator')renderMap(item,content);
  }
 }
 function renderMap(item,content){
  const target=item.type==='locator'?targetFor(item):item;if(!target){content.textContent='Add a map view first.';return;}
  const container=document.createElement('div');container.className='print-map';content.append(container);
  const m=L.map(container,{zoomControl:false,attributionControl:true,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false});maps.set(item.id,m);
  m.setView(target.center||context.center,Math.max(0,(target.zoom??context.zoom)-(item.type==='locator'?4:0)));
  const type=item.basemap||context.basemap||'street';const url=type==='street'?'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png':'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  L.tileLayer(url,{crossOrigin:'anonymous',maxNativeZoom:type==='street'?19:17,maxZoom:22,attribution:type==='street'?'© OpenStreetMap contributors':'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community'}).addTo(m);
  if(type==='hybrid')L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{crossOrigin:'anonymous',maxNativeZoom:17,maxZoom:22,attribution:'Labels © Esri, HERE, Garmin, OpenStreetMap contributors'}).addTo(m);
  if(item.type==='map'){
   for(const l of context.layers.filter(l=>(item.layers||[]).includes(l.id)).slice().reverse()){
    let ml;const pane='print-'+l.id;m.createPane(pane).style.zIndex=400+context.layers.length-context.layers.indexOf(l);
    if(l.metadata?.xyz)ml=L.tileLayer(l.metadata.xyz.url,{pane,crossOrigin:'anonymous',opacity:l.opacity??1,maxNativeZoom:l.metadata.xyz.maxZoom,maxZoom:22,attribution:esc(l.metadata.xyz.attribution)});
    else if(l.kind==='raster')ml=L.imageOverlay(l.url,[[l.bounds[1],l.bounds[0]],[l.bounds[3],l.bounds[2]]],{pane,opacity:l.opacity??.8,crossOrigin:'anonymous'});
    else if(l.metadata?.annotation)ml=annotationLayer(L,l,{pane});
    else ml=L.geoJSON(l.fc,{pane,style:f=>vectorStyle(l,f),pointToLayer:(f,ll)=>pointMarker(L,l,ll,{pane},f)});
    ml.addTo(m);if(l.kind==='vector'&&!l.metadata?.annotation)pointLabels(ml,l,m.getBounds(),document);
   }
   if(item.scale)L.control.scale({position:'bottomleft',metric:item.measurement!=='us',imperial:item.measurement==='us'}).addTo(m);
   if(item.north){const arrow=document.createElement('div');arrow.className='print-north';arrow.textContent='N\n▲';content.append(arrow);}
   m.on('moveend',()=>{if(!quick&&editing!==item.id)return;item.center=[m.getCenter().lat,m.getCenter().lng];item.zoom=m.getZoom();persist();});
  }else{
   const targetMap=maps.get(target.id);if(targetMap)L.rectangle(targetMap.getBounds(),{color:'#c33',weight:2,fillOpacity:.08}).addTo(m);
  }
  const cover=document.createElement('div');cover.className='print-map-edit';content.append(cover);if(quick&&item.type==='map'){cover.style.display='none';m.dragging.enable();m.scrollWheelZoom.enable();L.control.zoom({position:'topright'}).addTo(m);}
 }
 function field(label,html){return `<label>${label}${html}</label>`;}
 function number(label,name,value,min=0,max=2540){return field(label,`<input type="number" data-field="${name}" value="${value}" min="${min}" max="${max}" step="any">`);}
 function renderSettings(){
  const item=quick?null:page.items.find(i=>i.id===selected);let body='';
  if(quick){const m=activeMaps()[0],legend=page.items.find(i=>i.type==='legend');body='<h3>Export image</h3>'+field('Width (px)',`<input type="number" data-quick="width" min="96" max="9600" value="${Math.round(page.width*px)}">`)+field('Height (px)',`<input type="number" data-quick="height" min="96" max="9600" value="${Math.round(page.height*px)}">`)+field('Resolution',`<select data-page-field="resolution">${[1,2,3,4].map(v=>`<option value="${v}" ${page.resolution===v?'selected':''}>${v}×</option>`).join('')}</select>`)+field('Format',`<select data-page-field="format">${['PNG','JPG','PDF'].map(v=>`<option ${page.format===v?'selected':''}>${v}</option>`).join('')}</select>`);
   if(page.format==='JPG')body+=field('JPG quality',`<input type="range" min="0.1" max="1" step="0.05" data-page-field="quality" value="${page.quality}">`);
   for(const [name,label,checked]of [['legend','Legend',!legend.hidden],['scale','Scale bar',m.scale],['title','Map title',page.title],['description','Description',page.description]])body+=`<label><input type="checkbox" data-quick="${name}" ${checked?'checked':''}>${label}</label>`;
   body+=field('Scale units',`<select data-quick="measurement"><option value="metric">Metric</option><option value="us" ${m.measurement==='us'?'selected':''}>US</option></select>`)+'<p class="print-help">Drag or scroll inside the preview to pan and zoom. Drag the legend or its corner to move or resize it.</p>';
  }else if(item){body=`<h3>${esc(item.type[0].toUpperCase()+item.type.slice(1))}</h3>`+number('X (mm)','x',item.x)+number('Y (mm)','y',item.y)+number('Width (mm)','w',item.w,5)+number('Height (mm)','h',item.h,5);
   if(item.type==='text')body+=field('Text and tokens',`<textarea data-field="text" rows="4">${esc(item.text)}</textarea>`)+number('Text size (px)','fontSize',item.fontSize||14,6,200)+'<p class="print-help">Tokens: {{ map.title }}, {{ map.description }}, {{ current.date }}</p>';
   if(item.type==='section')body+=field('Background',`<input type="color" data-field="color" value="${item.color||'#e8eee9'}">`);
   if(item.type==='map'){body+='<p class="print-help">Double-click the map to pan and zoom. Press Esc when finished.</p>'+field('Basemap',`<select data-field="basemap">${['street','satellite','hybrid'].map(v=>`<option value="${v}" ${(item.basemap||context.basemap)===v?'selected':''}>${v}</option>`).join('')}</select>`);
    for(const [name,label] of [['north','North arrow'],['scale','Scale bar']])body+=`<label><input type="checkbox" data-field="${name}" ${item[name]?'checked':''}>${label}</label>`;
    body+=field('Scale units',`<select data-field="measurement"><option value="metric">Metric</option><option value="us" ${item.measurement==='us'?'selected':''}>US</option></select>`)+`<div class="print-layer-list"><strong>Layers</strong>${context.layers.map(l=>`<label><input type="checkbox" data-layer="${l.id}" ${(item.layers||[]).includes(l.id)?'checked':''}>${esc(l.name)}</label>`).join('')}</div>`;
   }
   if(['legend','locator'].includes(item.type))body+=field('Target map',`<select data-field="target">${activeMaps().map((m,i)=>`<option value="${m.id}" ${targetFor(item)?.id===m.id?'selected':''}>Map ${i+1}</option>`).join('')}</select>`);
   if(item.type==='legend')body+=`<div class="print-layer-list"><strong>Include in legend</strong>${context.layers.filter(l=>(targetFor(item)?.layers||[]).includes(l.id)).map(l=>`<label><input type="checkbox" data-legend="${l.id}" ${!(item.hiddenLayers||[]).includes(l.id)?'checked':''}>${esc(l.name)}</label>`).join('')}</div>`;
   body+='<button data-command="duplicate">Duplicate</button><button data-command="delete">Delete item</button><button data-command="page-settings">Page settings</button>';
  }else{
   body='<h3>Page settings</h3>'+field('Page name',`<input data-page-field="name" value="${esc(page.name)}">`)+field('Page size',`<select data-size><option value="custom">Custom</option>${Object.keys(sizes).map(v=>`<option value="${v}">${v==='Tabloid'?'11 × 17':v}</option>`).join('')}</select>`)+field('Display units',`<select data-page-field="units">${['mm','cm','in','px'].map(v=>`<option ${page.units===v?'selected':''}>${v}</option>`).join('')}</select>`);
   const unit=page.units||'mm',factor={mm:1,cm:10,in:25.4,px:25.4/96}[unit];body+=field(`Width (${unit})`,`<input type="number" data-dimension="width" value="${+(page.width/factor).toFixed(3)}" min="${25.4/factor}" max="${2540/factor}" step="any">`)+field(`Height (${unit})`,`<input type="number" data-dimension="height" value="${+(page.height/factor).toFixed(3)}" min="${25.4/factor}" max="${2540/factor}" step="any">`)+'<button data-command="orientation">Swap orientation</button>';
   body+=field('Format',`<select data-page-field="format">${['PDF','PNG','JPG'].map(v=>`<option ${page.format===v?'selected':''}>${v}</option>`).join('')}</select>`)+field('DPI',`<select data-page-field="dpi">${[150,300,600].map(v=>`<option ${page.dpi===v?'selected':''}>${v}</option>`).join('')}</select>`)+'<button data-command="delete-page">Delete page</button>';
  }
  const dimensions=quick?imageExportSize(Math.round(page.width*px),Math.round(page.height*px),page.resolution):exportSize(page.width,page.height,page.dpi);body+=`<p class="print-status" role="status">${dimensions.width} × ${dimensions.height} px${dimensions.reduced?` · Reduced to ${dimensions.dpi} DPI to stay within this browser’s 32-megapixel / 16,384-pixel limit.`:''}</p><button class="print-export" data-command="export">Export ${page.format}</button><p class="print-help">Basemap and data credits are retained. PDFs contain a raster page. Layouts and reusable templates save on this device, not to the workspace.</p>`;settings.innerHTML=body;
 }
 function render(){renderPages();renderSheet();renderSettings();}
 function add(type){if(type==='image'){root.querySelector('.print-image-input').click();return;}const item={id:crypto.randomUUID(),type,x:15,y:30,w:type==='map'?150:70,h:type==='map'?100:40};if(type==='map')Object.assign(item,{center:context.center,zoom:context.zoom,layers:context.layers.map(l=>l.id),north:true,scale:true,measurement:'metric'});if(type==='text')Object.assign(item,{text:'Title {{ map.title }}',fontSize:20,h:15});if(type==='section')item.color='#e8eee9';if(['legend','locator'].includes(type))item.target=activeMaps()[0]?.id;page.items.push(item);selected=item.id;render();persist();}
 root.querySelector('.print-image-input').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const [image]=await readImages(file);const reader=new FileReader();const src=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(image.image.blob);});const item={id:crypto.randomUUID(),type:'image',x:15,y:15,w:50,h:50*image.image.height/image.image.width,src};page.items.push(item);selected=item.id;render();persist();}catch(error){status(error.message);}finally{e.target.value='';}};
 root.addEventListener('input',e=>{
  if(e.target.dataset.pageField==='name'){page.name=e.target.value;const button=sidebar.querySelector(`[data-page="${page.id}"]`);if(button)button.textContent=page.name;persist();}
  if(e.target.dataset.field==='text'){const item=page.items.find(i=>i.id===selected);if(item){item.text=e.target.value;const text=sheet.querySelector(`[data-item="${item.id}"] .print-text`);if(text)text.textContent=tokens(item.text,context);persist();}}
  if(e.target.dataset.pageField==='quality'){page.quality=Number(e.target.value);persist();}
 });
 root.addEventListener('change',e=>{try{
  const item=page.items.find(i=>i.id===selected),field=e.target.dataset.field;
  if(field&&item){item[field]=e.target.type==='checkbox'?e.target.checked:e.target.type==='number'?Number(e.target.value):e.target.value;if(['x','y','w','h'].includes(field)){if(!Number.isFinite(item[field]))throw Error('Enter a valid dimension.');item.w=Math.min(Math.max(5,item.w),page.width);item.h=Math.min(Math.max(5,item.h),page.height);moveItem(item,0,0,page);}}
  if(e.target.dataset.layer&&item){item.layers=e.target.checked?[...new Set([...item.layers,e.target.dataset.layer])]:item.layers.filter(id=>id!==e.target.dataset.layer);}
  if(e.target.dataset.legend&&item){item.hiddenLayers=e.target.checked?(item.hiddenLayers||[]).filter(id=>id!==e.target.dataset.legend):[...(item.hiddenLayers||[]),e.target.dataset.legend];}
  if(e.target.dataset.pageField){const field=e.target.dataset.pageField;page[field]=['dpi','resolution','quality'].includes(field)?Number(e.target.value):e.target.value;}
  if(e.target.dataset.quick){const field=e.target.dataset.quick,m=activeMaps()[0],legend=page.items.find(i=>i.type==='legend');if(['width','height'].includes(field)){const value=Number(e.target.value);if(value<96||value>9600||!Number.isFinite(value))throw Error('Choose 96–9,600 pixels.');page[field]=value/px;m.w=page.width;m.h=page.height;moveItem(legend,0,0,page);}else if(field==='legend')legend.hidden=!e.target.checked;else if(field==='scale')m.scale=e.target.checked;else if(field==='measurement')m.measurement=e.target.value;else page[field]=e.target.checked;}
  if(e.target.dataset.dimension){const factor={mm:1,cm:10,in:25.4,px:25.4/96}[page.units||'mm'],value=Number(e.target.value)*factor;if(!Number.isFinite(value)||value<25.4||value>2540)throw Error('Page dimensions must be between 1 and 100 inches.');resizePage(page,e.target.dataset.dimension==='width'?value:page.width,e.target.dataset.dimension==='height'?value:page.height);}
  if(e.target.hasAttribute('data-size')&&sizes[e.target.value])resizePage(page,...sizes[e.target.value]);
  render();persist();
 }catch(error){renderSettings();status(error.message);}});
 let drag;
 sheet.addEventListener('pointerdown',e=>{if(exporting||e.button!==0||editing)return;const el=e.target.closest('.print-item');if(quick&&el?.dataset.item===activeMaps()[0]?.id){select(null);return;}if(!el){select(null);return;}const item=page.items.find(i=>i.id===el.dataset.item);select(item.id);drag={item,startX:e.clientX,startY:e.clientY,start:structuredClone(item),resize:e.target.classList.contains('resize')};sheet.setPointerCapture(e.pointerId);e.preventDefault();});
 sheet.addEventListener('pointermove',e=>{if(!drag)return;Object.assign(drag.item,{x:drag.start.x,y:drag.start.y,w:drag.start.w,h:drag.start.h});moveItem(drag.item,(e.clientX-drag.startX)/px,(e.clientY-drag.startY)/px,page,drag.resize);const el=sheet.querySelector(`[data-item="${drag.item.id}"]`);Object.assign(el.style,{left:drag.item.x*px+'px',top:drag.item.y*px+'px',width:drag.item.w*px+'px',height:drag.item.h*px+'px'});});
 const finishDrag=()=>{if(!drag)return;drag=null;renderSheet();renderSettings();persist();};sheet.addEventListener('pointerup',finishDrag);sheet.addEventListener('pointercancel',finishDrag);
 sheet.addEventListener('dblclick',e=>{const item=page.items.find(i=>i.id===e.target.closest('.print-item')?.dataset.item);if(item?.type!=='map')return;select(item.id);editing=item.id;const m=maps.get(item.id);m.dragging.enable();m.scrollWheelZoom.enable();root.querySelector(`[data-item="${item.id}"]`).classList.add('editing');status('Pan or zoom this map. Press Esc when finished.');});
 async function exportPage(){
  if(exporting)return;exporting=true;stopEditing();root.classList.add('print-exporting');for(const b of root.querySelectorAll('button,input,select,textarea'))b.disabled=true;status('Preparing export. Keep this tab visible…');
  try{
   await document.fonts.ready;for(const m of maps.values())m.invalidateSize();
   const start=Date.now();while([...maps.values()].some(m=>{let loading=false;m.eachLayer(l=>{if(l.isLoading?.())loading=true;});return loading;})){if(Date.now()-start>15000)throw Error('Some map tiles are still loading. Wait or choose another basemap, then retry.');await sleep(100);}
   const broken=[...sheet.querySelectorAll('img')].some(i=>!i.complete||!i.naturalWidth);if(broken)throw Error('Some map images could not load. Choose another basemap or remove the unavailable layer before exporting.');
   const {toCanvas}=await import('html-to-image');const dimensions=quick?imageExportSize(Math.round(page.width*px),Math.round(page.height*px),page.resolution):exportSize(page.width,page.height,page.dpi);
   const canvas=await toCanvas(sheet,{backgroundColor:'#ffffff',pixelRatio:dimensions.width/(page.width*px),skipAutoScale:true,filter:node=>!node.classList?.contains('resize')&&!node.classList?.contains('print-map-edit')&&!node.classList?.contains('leaflet-control-zoom'),fontEmbedCSS:''});
   const filename=(context.title+(quick?'':' — '+page.name)).replace(/[^\p{L}\p{N} ._-]/gu,'_');
   if(page.format==='PDF'){const {jsPDF}=await import('jspdf');const pdf=new jsPDF({orientation:page.width>page.height?'landscape':'portrait',unit:'mm',format:[page.width,page.height],compress:true});pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,page.width,page.height);pdf.save(filename+'.pdf');}
   else{const type=page.format==='JPG'?'image/jpeg':'image/png',blob=await new Promise(r=>canvas.toBlob(r,type,page.quality??.95));if(!blob)throw Error('This browser could not encode the page. Choose a lower DPI.');const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=filename+(page.format==='JPG'?'.jpg':'.png');a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
   status(`Exported ${page.name} at ${dimensions.dpi} DPI.`);
  }catch(error){status('Export failed: '+error.message+' A tile provider may block image export.');}
  finally{exporting=false;root.classList.remove('print-exporting');for(const b of root.querySelectorAll('button,input,select,textarea'))b.disabled=false;}
 }
 function duplicate(){const item=page.items.find(i=>i.id===selected);if(!item)return;const copy=structuredClone(item);copy.id=crypto.randomUUID();moveItem(copy,5,5,page);page.items.push(copy);selected=copy.id;render();persist();}
 async function close(){if(exporting)return;closed=true;clearTimeout(saveTimer);await saving;try{await writePrintLayout(key,pages);}catch{}cleanupMaps();document.removeEventListener('keydown',keyboard);root.remove();if(app)app.inert=false;previousFocus?.focus();context.onClose?.();}
 function keyboard(e){if(closed)return;if(e.key==='Escape'){e.preventDefault();if(editing){stopEditing();renderSheet();persist();}else select(null);}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='p'){e.preventDefault();void exportPage();}}
 document.addEventListener('keydown',keyboard);
 root.addEventListener('click',async e=>{const addType=e.target.closest('[data-add]')?.dataset.add;if(addType){add(addType);return;}const pageId=e.target.closest('[data-page]')?.dataset.page;if(pageId){stopEditing();page=pages.find(p=>p.id===pageId);selected=null;render();return;}if(e.target.closest('[data-page-add]')){page=standardPage(context);page.name='Page '+(pages.length+1);pages.push(page);selected=null;render();persist();return;}
  const command=e.target.closest('[data-command]')?.dataset.command;if(!command)return;
  if(command==='close')return close();if(command==='export')return exportPage();if(command==='duplicate')return duplicate();
  if(command==='page-settings'){select(null);return;}if(command==='delete'){page.items=page.items.filter(i=>i.id!==selected);selected=null;}
  if(command==='orientation')resizePage(page,page.height,page.width);
  if(command==='delete-page'){if(pages.length===1){status('Keep at least one page.');return;}pages=pages.filter(p=>p!==page);page=pages[0];selected=null;}
  if(command==='save-template'){const name=prompt('Layout name');if(!name?.trim())return;const templates=await readPrintLayout(templateKey)||[];templates.push({name:name.trim(),page:structuredClone(page)});await writePrintLayout(templateKey,templates);status('Reusable layout saved on this device.');return;}
  if(command==='templates'){const templates=await readPrintLayout(templateKey)||[];if(!templates.length){status('Save a layout first.');return;}const choice=prompt('Choose a layout number:\n'+templates.map((t,i)=>`${i+1}. ${t.name}`).join('\n'));const template=templates[Number(choice)-1];if(!template)return;const copy=structuredClone(template.page);copy.id=crypto.randomUUID();copy.name=template.name;for(const item of copy.items)if(item.type==='map'){item.center=context.center;item.zoom=context.zoom;item.layers=context.layers.map(l=>l.id);}pages.push(copy);page=copy;selected=null;}
  render();persist();
 });
 render();return {close};
}
