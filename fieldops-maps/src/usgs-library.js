import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {openQGlobe} from './qglobe.js';
export const usgsCatalogueURL='https://tnmaccess.nationalmap.gov/api/v1/map_services';
export function catalogueRows(data){
 if(!Array.isArray(data)||!data.length)throw Error('USGS catalogue unavailable.');
 return data.flatMap((item,index)=>{
  let url;try{url=new URL(item.serviceLink);}catch{return [];}
  if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)(gov|arcgis\.com|arcgisonline\.com)$/.test(url.hostname))return [];
  const match=url.pathname.match(/^(.*\/rest\/services)\/(.+\/(?:MapServer|ImageServer|FeatureServer))\/?$/i);
  return [{id:String(index),name:String(item.displayName||'USGS dataset'),thumbnail:typeof item.thumbnailUrl==='string'&&item.thumbnailUrl.startsWith('https://')?item.thumbnailUrl:null,category:String(item.serviceListCategory||'Other services').replace(/\s*\(.*\)$/,''),url:url.href,deprecated:!!item.isDeprecated,notice:String(item.deprecationNotice||''),source:match?{id:'usgs-catalogue-'+index,name:String(item.displayName),root:url.origin+match[1],startPath:match[2]}:null}];
 });
}
export async function loadUSGSCatalogue({fetcher=fetch,signal}={}){
 try{const r=await fetcher(usgsCatalogueURL,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});if(!r.ok)throw Error('Unavailable');return {rows:catalogueRows(await r.json()),cached:false};}
 catch(error){if(signal?.aborted)throw error;const r=await fetcher(`${import.meta.env?.BASE_URL||'/maps/'}library/usgs-services.json`,{signal});if(!r.ok)throw Error('USGS catalogue could not load. Please retry.');return {rows:catalogueRows(await r.json()),cached:true};}
}
export function openUSGSLibrary(options){
 const {valid}=options,abort=new AbortController();let closed=false,rows=[];
 const d=toolDialog('USGS data',`<div class="usgs-portals"><a href="https://data.usgs.gov/datacatalog/" target="_blank" rel="noopener noreferrer">All research datasets ↗</a><a href="https://apps.nationalmap.gov/downloader/" target="_blank" rel="noopener noreferrer">DEM, LiDAR and map downloads ↗</a><a href="https://earthexplorer.usgs.gov/" target="_blank" rel="noopener noreferrer">Landsat and imagery ↗</a></div><div class="library-find"><input type="search" data-search placeholder="Search USGS data…" aria-label="Search USGS data"><select data-category aria-label="USGS category"><option value="">All categories</option></select></div><small data-count role="status">Loading catalogue…</small><div class="usgs-catalogue" data-catalogue></div><small data-source>National Map catalogue · includes partner agencies</small>`);
 d.classList.add('usgs-library');d.querySelector('.dialog-actions').hidden=true;const q=s=>d.querySelector(s);
 const check=()=>{valid();if(closed)throw Error('Library closed.');};
 function draw(){const term=q('[data-search]').value.toLowerCase(),category=q('[data-category]').value,shown=rows.filter(r=>(!category||r.category===category)&&`${r.name} ${r.category}`.toLowerCase().includes(term));q('[data-count]').textContent=`${shown.length} services and data sources`;q('[data-catalogue]').innerHTML=shown.map(r=>`<div class="usgs-catalogue-row">${r.thumbnail?`<img class="usgs-thumb" src="${esc(r.thumbnail)}" loading="lazy" alt="${esc(r.name)} preview">`:''}<div><strong>${esc(r.name)}</strong><small>${esc(r.category)}${r.deprecated?' · Legacy':''}</small></div>${r.source?`<button type="button" data-browse="${r.id}">Browse layers</button>`:`<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`}</div>`).join('')||'<p>No matching datasets.</p>';}
 q('[data-search]').oninput=q('[data-category]').onchange=draw;
 q('[data-catalogue]').onclick=e=>{const button=e.target.closest('[data-browse]');if(!button)return;try{check();const row=rows.find(r=>r.id===button.dataset.browse);openQGlobe({...options,source:row.source,onFavourite:undefined,initialItem:null,valid:check,onResult:async(...args)=>{check();await options.onResult(...args);d.close();},onRasterResult:async layer=>{check();await options.onRasterResult(layer);d.close();}});}catch(error){q('.error').textContent=error.message;}};
 void loadUSGSCatalogue({signal:abort.signal}).then(result=>{check();rows=result.rows;q('[data-category]').innerHTML='<option value="">All categories</option>'+[...new Set(rows.map(r=>r.category))].sort().map(c=>`<option>${esc(c)}</option>`).join('');if(result.cached)q('[data-source]').textContent='Saved catalogue · live list unavailable';draw();}).catch(error=>{if(!closed){q('[data-count]').textContent='';q('.error').textContent=error.message;}});
 d.addEventListener('close',()=>{closed=true;abort.abort();});return d;
}
