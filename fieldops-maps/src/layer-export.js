import {zipSync,strToU8} from 'fflate';
export const exportName=name=>String(name||'layer').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,100)||'layer';
export function geometryGroups(fc){
 const groups={};
 for(const feature of fc?.features||[]){
  function add(geometry){
   if(geometry?.type==='GeometryCollection'){if(!geometry.geometries.length)throw Error('A feature has no geometry.');geometry.geometries.forEach(add);return;}
   const kind={Point:'points',MultiPoint:'points',LineString:'lines',MultiLineString:'lines',Polygon:'polygons',MultiPolygon:'polygons'}[geometry?.type];
   if(!kind)throw Error('A feature has missing or unsupported geometry. Fix it before exporting.');
   (groups[kind]??=[]).push({...feature,geometry});
  }add(feature.geometry);
 }
 if(!Object.keys(groups).length)throw Error('This layer has no features to export.');
 return groups;
}
export function shapefileFields(fc){
 const names=[...new Set(fc.features.flatMap(f=>Object.keys(f.properties||{})))],mapping=Object.create(null),used=new Set();
 for(const name of names){const base=(name.replace(/[^a-z0-9_]/gi,'_')||'field').slice(0,10);let candidate=base,n=1;while(used.has(candidate.toLowerCase())){const suffix=String(n++);candidate=base.slice(0,10-suffix.length)+suffix;}used.add(candidate.toLowerCase());mapping[name]=candidate;}
 const features=fc.features.map(f=>({...f,properties:Object.fromEntries(names.map(name=>{
  let value=f.properties?.[name]??null;if(typeof value==='object'&&value!==null)value=JSON.stringify(value);if(typeof value==='boolean')value=value?1:0;
  if(typeof value==='string'&&new TextEncoder().encode(value).length>254)throw Error(`“${name}” contains text longer than Shapefile supports. Use GeoJSON or shorten the value.`);
  return [mapping[name],value];
 }))}));
 return {fc:{type:'FeatureCollection',features},mapping};
}
export async function exportVector(layer,{format='geojson',crs='EPSG:4326'}={},engine){
 const name=exportName(layer.name),original=structuredClone(layer.fc);geometryGroups(original);
 if(format==='geojson')return {name:name+'.geojson',blob:new Blob([JSON.stringify(original)],{type:'application/geo+json'})};
 if(!['dxf','shp','kml'].includes(format))throw Error('Choose a supported export format.');
 const target=format==='kml'?'EPSG:4326':String(crs).trim();if(!target)throw Error('Choose an export coordinate system.');
 const G=await engine(),id=crypto.randomUUID().replaceAll('-',''),archive={};
 let source=original,mapping;
 if(format==='shp')({fc:source,mapping}=shapefileFields(original));
 if(format==='dxf')source={type:'FeatureCollection',features:original.features.map(f=>({...f,properties:{Layer:String(f.properties?.Layer||name).replace(/[<>/\\":;?*|=]/g,'_')}}))};
 const groups=format==='shp'?geometryGroups(source):{layer:source.features};
 let result;
 for(const [kind,features] of Object.entries(groups)){
  const opened=await G.open(new File([JSON.stringify({type:'FeatureCollection',features})],`export_${id}_${kind}.geojson`));
  const ds=opened.datasets?.[0];if(!ds)throw Error('Could not read the layer for export.');
  try{
   const opts=['-f',{dxf:'DXF',shp:'ESRI Shapefile',kml:'KML'}[format],'-s_srs','EPSG:4326','-t_srs',target];
   if(format==='shp')opts.push('-nlt','PROMOTE_TO_MULTI','-lco','ENCODING=UTF-8');
   if(format==='dxf')opts.push('-select','Layer');
   const output=await G.ogr2ogr(ds,opts,`export_${id}_${kind}`);
   if(format==='shp'){
    const entries=output.all||[output],extensions=new Set();
    for(const file of entries){const ext=file.local.split('.').at(-1).toLowerCase();extensions.add(ext);archive[`${name}_${kind}.${ext}`]=await G.getFileBytes(file);}
    for(const ext of ['shp','shx','dbf','prj'])if(!extensions.has(ext))throw Error('Shapefile export is missing its .'+ext+' file. No download was created.');
    archive[`${name}_${kind}.cpg`]=strToU8('UTF-8');
   }else{let bytes=await G.getFileBytes(output);if(format==='dxf'){let text=new TextDecoder().decode(bytes);const unit=/\$INSUNITS\s+70\s+[^\r\n]+/;text=unit.test(text)?text.replace(unit,'$INSUNITS\n 70\n0'):text.replace(/(2\s*\r?\nHEADER\s*\r?\n)/,match=>match+'  9\n$INSUNITS\n 70\n0\n');bytes=strToU8(text);}if(!bytes.length)throw Error('The export is empty.');result={name:name+'.'+format,blob:new Blob([bytes],{type:format==='kml'?'application/vnd.google-earth.kml+xml':'application/dxf'})};}
  }finally{await G.close(ds);}
 }
 if(format==='shp'){
  archive['fields.json']=strToU8(JSON.stringify(mapping,null,2));
  archive['README.txt']=strToU8(`Layer: ${layer.name}\nCRS: ${target}\nMixed geometry is separated into points, lines and polygons. Keep each .shp, .shx, .dbf, .prj and .cpg together.\nField names are limited to 10 characters; fields.json maps original names to exported names. Boolean values are 1/0; object and array values are JSON text.\nExports contain the entire current layer, including features hidden by filters.\n`);
  result={name:name+'.zip',blob:new Blob([zipSync(archive)],{type:'application/zip'})};
 }
 return result;
}
export function openLayerExport(layer,{engine,catalogue=[],project=null,onBusy=()=>{}}){
 const dialog=document.createElement('dialog');dialog.innerHTML='<form><div class="dialog-heading"><h2>Export layer</h2><button type="button" class="square" aria-label="Close export">×</button></div><p data-name></p><label>Format<select name="format"><option value="geojson">GeoJSON</option><option value="dxf">DXF · AutoCAD</option><option value="shp">Shapefile · ZIP</option><option value="kml">KML · Google Earth</option></select></label><div data-crs><label>Find coordinate system<input type="search" name="crsSearch" placeholder="Search EPSG code or name…"></label><label>Export coordinate system<select name="crs" required></select></label></div><p class="field-note" data-note></p><p class="field-note">Exports the entire current layer, including features hidden by filters. Source files and map styling are not included.</p><div class="error" role="alert"></div><div class="dialog-actions"><button class="primary" type="submit">↓ Download</button></div></form>';
 document.body.append(dialog);const q=s=>dialog.querySelector(s),form=q('form');q('[data-name]').textContent=layer.name;const projectCode=project?.default_crs,source=projectCode||layer.source_crs||'EPSG:4326';
 const entries=new Map([['EPSG:4326',{code:'EPSG:4326',name:'WGS 84 — longitude / latitude'}],...catalogue.map(entry=>[entry.code,entry])]);
 if(!entries.has(source))entries.set(source,{code:source,name:projectCode?(project.default_crs_label||projectCode):(layer.crsLabel||'Layer source coordinate system'),custom:!/^EPSG:\d+$/i.test(source)});
 let selected=source;
 const renderCRS=()=>{const words=form.elements.crsSearch.value.toLowerCase().trim().split(/\s+/).filter(Boolean);const pinned=[...new Set([projectCode,selected].filter(Boolean))];const options=[...pinned.map(code=>entries.get(code)),...[...entries.values()].filter(entry=>!pinned.includes(entry.code)&&words.every(word=>(entry.code+' '+entry.name).toLowerCase().includes(word)))];form.elements.crs.replaceChildren(...options.map(entry=>{const option=document.createElement('option');option.value=entry.code;option.textContent=entry.custom?entry.name:entry.code+' — '+entry.name;if(entry.code===projectCode)option.textContent+=' (Project)';return option;}));form.elements.crs.value=selected;};
 form.elements.crsSearch.oninput=renderCRS;form.elements.crs.onchange=()=>{selected=form.elements.crs.value;};renderCRS();
 if(!catalogue.length)fetch(import.meta.env.BASE_URL+'crs.json').then(response=>{if(!response.ok)throw Error();return response.json();}).then(rows=>{for(const entry of rows)entries.set(entry.code,entry);if(dialog.isConnected)renderCRS();}).catch(()=>{if(dialog.isConnected)q('[role=alert]').textContent='The coordinate catalogue could not load. Reopen this window to try again.';});
 const update=()=>{const format=form.elements.format.value,needsCRS=['shp','dxf'].includes(format);q('[data-crs]').hidden=!needsCRS;form.elements.crs.disabled=!needsCRS;q('[data-note]').textContent={geojson:'WGS 84 longitude/latitude with attributes.',kml:'WGS 84 longitude/latitude for Google Earth, with attributes.',shp:'Points, lines and polygons are separated when needed. Field names are shortened to 10 characters; a field-name guide is included.',dxf:'Geometry and CAD layer names. Other attributes and map styling are not included. Choose a projected CRS for easting/northing coordinates; EPSG:4326 uses degrees. DXF drawing units are marked unitless; coordinate values follow your chosen CRS.'}[format];};form.elements.format.onchange=update;update();
 q('[aria-label="Close export"]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
 form.onsubmit=async e=>{e.preventDefault();const button=q('[type=submit]');button.disabled=true;button.textContent='Preparing…';q('[role=alert]').textContent='';onBusy(true);
 try{const result=await exportVector(layer,{format:form.elements.format.value,crs:form.elements.crs.value},engine);const url=URL.createObjectURL(result.blob),a=document.createElement('a');a.href=url;a.download=result.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);dialog.close();}catch(error){q('[role=alert]').textContent=error.message;}finally{onBusy(false);button.disabled=false;button.textContent='↓ Download';}};
 dialog.showModal();return dialog;
}
