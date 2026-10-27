import initGdalJs from 'gdal3.js';
const workerUrl=import.meta.env.BASE_URL+'gdal-worker.js';
import dataUrl from 'gdal3.js/dist/package/gdal3WebAssembly.data?url';
import Papa from 'papaparse';
import {csvGeoJSON,validateCollection,errorText} from './geo.js';
import {fileLayerName} from './layer-name.js';
let engine;
export const gdal=()=>engine??=(async()=>{const r=await fetch(import.meta.env.BASE_URL+'gdal-engine.bin');if(!r.ok)throw Error('Could not load the GIS engine. Reload and try again.');const bytes=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();const wasmUrl=URL.createObjectURL(new Blob([bytes],{type:'application/wasm'}));return initGdalJs({paths:{wasm:wasmUrl,data:dataUrl,js:workerUrl},env:{PROJ_ONLY_BEST_DEFAULT:'YES',PROJ_NETWORK:'OFF',OGR_CT_OP_SELECTION:'BEST_ACCURACY'}});})().catch(e=>{engine=null;throw e;});
const id=()=>crypto.randomUUID().replaceAll('-','');
export async function inspect(files,progress){
 const all=[...files];if(all.some(f=>f.size>(/\.tiff?$/i.test(f.name)?250:50)*1024*1024))throw Error('GeoTIFF files must be 250 MB or smaller; other files must be 50 MB or smaller.');
 if(all.reduce((s,f)=>s+f.size,0)>300*1024*1024)throw Error('Import up to 300 MB per batch.');
 if(new Set(all.map(f=>f.name)).size!==all.length)throw Error('Files in one batch must have unique names.');
 const items=[]; const errors=[];
 const ordinary=all.filter(f=>! /\.(csv|zip)$/i.test(f.name));
 const groups=[...all.filter(f=>/\.csv$/i.test(f.name)).map(f=>[f]),...all.filter(f=>/\.zip$/i.test(f.name)).map(f=>[f])];
 if(ordinary.length)groups.push(ordinary);
 for(const group of groups){
 try{
 progress(`Reading ${group[0].name}…`);
 if(group.length===1&&/\.csv$/i.test(group[0].name)){
 const parsed=Papa.parse(await group[0].text(),{header:true,skipEmptyLines:'greedy'});
 if(parsed.errors.length)throw Error(parsed.errors[0].message);
 items.push({name:group[0].name.replace(/\.csv$/i,''),kind:'vector',format:'CSV',files:group,rows:parsed.data,fields:parsed.meta.fields,source:'',count:parsed.data.length});continue;
 }
 const G=await gdal();const result=await G.open(group,[],/\.zip$/i.test(group[0].name)?['vsizip']:[]);
 for(const ds of result.datasets){
 const info=ds.info||await G.getInfo(ds);
 if(ds.type==='raster'){
 const details=await G.getInfo(ds);
 const hasTransform=info.geoTransform && !(info.geoTransform.join(',')==='0,1,0,0,0,1');
 items.push({name:fileLayerName(group,ds.path),kind:'raster',format:info.driverShortName||details.driverName,files:group,ds,info,source:info.coordinateSystem?.wkt||details.projectionWkt||'',count:0,hasTransform});
 }else{
 const info2=await G.ogrinfo(ds,['-al','-so']);
 for(const layer of info2.layers||[]){
 const source=layer.geometryFields?.[0]?.coordinateSystem?.wkt||'';
 items.push({name:fileLayerName(group,ds.path,layer.name,info2.layers.length>1),layerName:layer.name,kind:'vector',format:info2.driverShortName||'Vector',files:group,ds,info:layer,source,count:layer.featureCount||0});
 }
 }
 }
 if(!result.datasets.length)throw Error('No supported GIS dataset was found.');
 }catch(e){errors.push(`${group.map(f=>f.name).join(', ')}: ${errorText(e)}`);}
 }
 return {items,errors};
}
export async function convert(item,settings,progress=()=>{}){
 const G=await gdal();let ds=item.ds;
 const source=settings.crs.trim();if(!source)throw Error('Choose the source coordinate system before importing.');
 if(item.kind==='raster'&&!item.hasTransform)throw Error('This raster has no georeferencing. Supply a georeferenced raster or its world file.');
 if(item.rows){const fc=csvGeoJSON(item.rows,settings.x,settings.y);ds=(await G.open(new File([JSON.stringify(fc)],`csv_${id()}.geojson`))).datasets[0];}
 const opts=['-s_srs',source,'-t_srs','EPSG:4326','--config','PROJ_ONLY_BEST_DEFAULT','YES'];
 if(settings.epoch)opts.push('-s_coord_epoch',String(settings.epoch));
 if(settings.pipeline)opts.push('-ct',settings.pipeline);
 if(settings.gcps){const rows=settings.gcps.trim().split('\n').filter(Boolean);if(rows.length<3)throw Error('Enter at least three control points.');for(const row of rows){const v=row.split(/[,\s]+/).map(Number);if(v.length!==4||!v.every(Number.isFinite))throw Error('Each control point needs local X, local Y, target X, target Y.');opts.push('-gcp',...v.map(String));}opts.push('-order','1');}
 if(item.kind==='vector'){
 const options=['-f','GeoJSON',...opts,'-lco','RFC7946=YES'];if(item.layerName)options.push(item.layerName);
 const out=await G.ogr2ogr(ds,options,`vector_${id()}`);
 const fc=JSON.parse(new TextDecoder().decode(await G.getFileBytes(out)));
 const bounds=validateCollection(fc);return {fc,bounds};
 }
 // Reproject the raster to the map's actual projection before making a bounded display image.
 const rasterOptions=['-of','GTiff','-s_srs',source,'-t_srs','EPSG:3857','-ts',...(item.info.size?.[1]>item.info.size?.[0]?['0','1536']:['1536','0']),'-r','bilinear','-dstalpha','--config','PROJ_ONLY_BEST_DEFAULT','YES'];
 if(settings.pipeline||settings.epoch||settings.gcps)throw Error('Custom pipelines, epochs and control points currently apply to vector imports.');
 progress('Reprojecting raster and building display preview…');
 const warped=await G.gdalwarp(ds,rasterOptions,`warped_${id()}`);
 const wds=(await G.open(warped.local)).datasets[0];
 const wi=await G.getInfo(wds);const points=await G.gdaltransform(wi.corners,['-s_srs','EPSG:3857','-t_srs','EPSG:4326','-output_xy']);
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);const bounds=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
 if(!bounds.every(Number.isFinite)||bounds[0]<-180||bounds[2]>180||bounds[1]<-85.06||bounds[3]>85.06)throw Error('Raster extent cannot be shown on this basemap. Check its CRS.');
 const pngOptions=['-of','PNG','-ot','Byte'];
 if(wi.bandCount>=4)pngOptions.push('-b','1','-b','2','-b','3','-b',String(wi.bandCount));
 if(item.info.bands?.some(b=>b.type!=='Byte'))pngOptions.push('-scale');
 progress('Encoding raster preview…');
 const png=await G.gdal_translate(wds,pngOptions,`preview_${id()}`);
 const blob=new Blob([await G.getFileBytes(png)],{type:'image/png'});await G.close(wds);
 return {blob,bounds};
}
