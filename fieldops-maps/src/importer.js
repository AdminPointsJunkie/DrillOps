import {installProjGrid} from './proj-grid.js';
import {readDWGReferences} from './cad-references.js';
import {convertDWG,preserveCADColours} from './dwg-import.js';
import {repairDXFHatches} from './dxf-hatches.js';
import initGdalJs from 'gdal3.js';
const workerUrl=import.meta.env.BASE_URL+'gdal-worker.js';
import dataUrl from 'gdal3.js/dist/package/gdal3WebAssembly.data?url';
import {prepareVRT} from './vrt-import.js';
import {imagePattern,readImages,convertImage} from './image-import.js';
import {readSpecial} from './file-readers.js';
import {archivePattern,unpackArchive} from './archive-files.js';
import {groupFiles,unsupportedReason} from './import-formats.js';
import {csvGeoJSON,validateCollection,errorText,preserveCollapsedDXFLines} from './geo.js';
import {fileLayerName} from './layer-name.js';
let engine;
export const gdal=()=>engine??=(async()=>{const r=await fetch(import.meta.env.BASE_URL+'gdal-engine.bin');if(!r.ok)throw Error('Could not load the GIS engine. Reload and try again.');const bytes=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();const wasmUrl=URL.createObjectURL(new Blob([bytes],{type:'application/wasm'}));const gridResponse=await fetch(import.meta.env.BASE_URL+'proj/au_icsm_National_84_02_07_01.tif');if(!gridResponse.ok)throw Error('Could not load the AGD84 coordinate grid. Reload and retry.');const grid=new File([await gridResponse.blob()],'au_icsm_National_84_02_07_01.tif');return installProjGrid(await initGdalJs({paths:{wasm:wasmUrl,data:dataUrl,js:workerUrl},env:{PROJ_DATA:'/usr/share/proj:/input',DXF_MERGE_BLOCK_GEOMETRIES:'FALSE',PROJ_ONLY_BEST_DEFAULT:'YES',PROJ_NETWORK:'OFF',OGR_CT_OP_SELECTION:'BEST_ACCURACY'}}),grid);})().catch(e=>{engine=null;throw e;});
const id=()=>crypto.randomUUID().replaceAll('-','');
// GDAL marks sheet/layout entities with PaperSpace=1; model-space entities are NULL or 0.
// Filter before reprojection so sheet coordinates cannot distort extents or fail conversion.
const modelSpaceFilter='PaperSpace IS NULL OR PaperSpace = 0';
export async function inspect(files,progress=()=>{},{engine=gdal,unpack=unpackArchive,dwg=convertDWG,resolveReferences,cadImport}={}){
 const sourceFilesForCAD=[...files],all=cadImport?.references?.length?[sourceFilesForCAD[0]]:[...files];if(all.length>25)throw Error('Select up to 25 files at a time.');
 if(all.some(f=>f.size>(/\.tiff?$/i.test(f.name)?250:50)*1024*1024))throw Error('GeoTIFF files must be 250 MB or smaller; other files must be 50 MB or smaller.');
 if(all.reduce((s,f)=>s+f.size,0)>300*1024*1024)throw Error('Import up to 300 MB per batch.');
 const items=[],errors=[],archiveBudget={remaining:300*1024*1024};
 async function readBatch(batch,originals=null,depth=0){
  for(const group of groupFiles(batch)){
   const primary=group[0];let sourceFiles=originals||group;
   try{
    progress(`Reading ${primary.name}…`);
    const reason=unsupportedReason(primary.name);if(reason)throw Error(reason);
    if(archivePattern.test(primary.name)&&! /\.gdb\.zip$/i.test(primary.name)){
     if(depth>=2)throw Error('Nested archives deeper than two levels must be unpacked first.');
     const extracted=await unpack(primary,archiveBudget),kmz=/\.kmz$/i.test(primary.name);
     // KMZ is a KML package: icons and other resources are not separate map layers.
     const datasets=kmz?extracted.filter(file=>/\.kml$/i.test(file.name)):extracted;
     if(kmz&&!datasets.length)throw Error('This KMZ archive contains no KML files.');
     const start=items.length;
     await readBatch(datasets,originals||[primary],depth+1);
     if(kmz)for(const item of items.slice(start))item.format='KMZ';
     continue;
    }
    if(imagePattern.test(primary.name)&&group.length===1){items.push(...await readImages(primary,sourceFiles));continue;}
    if(/\.kml$/i.test(primary.name)){
     const {readKML}=await import('./kml-import.js');const {fc,details}=readKML(await primary.text());
     validateCollection(fc);
     items.push({name:fileLayerName(group),kind:'vector',format:'KML',files:sourceFiles,fc,kml:details,source:'EPSG:4326',count:fc.features.length});continue;
    }
    const special=await readSpecial(primary,sourceFiles);if(special){items.push(...special);continue;}
    const cad=/\.dwg$/i.test(primary.name)?await readDWGReferences(primary,progress,{dwg,resolveReferences,saved:cadImport,sourceFiles:sourceFilesForCAD}):null;
    if(cad?.references?.length)sourceFiles=cad.originals;
    const G=await engine();
    // Preserve sidecar names within each dataset, without archive directory prefixes.
    const inputs=/\.vrt$/i.test(primary.name)?await prepareVRT(primary,batch):cad?[cad.file]:group;
    const mounted=inputs.map(f=>f.name.includes('/')?new File([f],f.name.split('/').at(-1)):f);
    const result=await G.open(mounted,[],/\.(zip|kmz)$/i.test(primary.name)?['vsizip']:[]);
    let count=0,hasCAD=false;
    for(const ds of result.datasets){
     if(/\.vrt$/i.test(primary.name)&&! /\.vrt$/i.test(ds.path))continue;
     const info=ds.info||await G.getInfo(ds);
     if(ds.type==='raster'){
      const details=await G.getInfo(ds);const transform=info.geoTransform||details.coordinateTransform;
      const hasTransform=!!transform&&transform.join(',')!=='0,1,0,0,0,1';
      const localOnly=/^(GTiff|COG|VRT)$/i.test(info.driverShortName||details.driverName||'')||/\.tiff?$/i.test(primary.name);if(localOnly)for(const file of sourceFiles)if(archivePattern.test(file.name))file.localOnlyArchive=true;
      items.push({localOnly,name:fileLayerName(group,ds.path),kind:'raster',format:info.driverShortName||details.driverName,files:sourceFiles,ds,info,source:info.coordinateSystem?.wkt||details.projectionWkt||'',count:0,hasTransform});count++;
     }else{
      const originalDetail=await G.ogrinfo(ds,['-al','-so']);
      const isCAD=!!cad||originalDetail.driverShortName==='DXF';hasCAD||=isCAD;
      const detail=isCAD?await G.ogrinfo(ds,['-al','-so','-where',modelSpaceFilter]):originalDetail;
      for(const layer of detail.layers||[]){
       if(layer.featureCount===0)continue;
       if(detail.driverShortName==='OSM'){
        const out=await G.ogr2ogr(ds,['-f','GeoJSON','-limit','20001',layer.name],`osm_${id()}`);
        const fc=JSON.parse(new TextDecoder().decode(await G.getFileBytes(out)));if(!fc.features.length)continue;
        if(fc.features.length>20000)throw Error('This OSM layer exceeds 20,000 features. Upload a smaller extract.');
        items.push({name:fileLayerName(group,ds.path,layer.name,true),layerName:layer.name,kind:'vector',format:'OSM',files:sourceFiles,fc,source:'EPSG:4326',count:fc.features.length});count++;continue;
       }
       const source=layer.geometryFields?.[0]?.coordinateSystem?.wkt||'';
       const excludedPaperSpace=isCAD?Math.max(0,(originalDetail.layers.find(l=>l.name===layer.name)?.featureCount||0)-(layer.featureCount||0)):0;
       items.push({name:fileLayerName(group,ds.path,layer.name,detail.layers.length>1),layerName:layer.name,kind:'vector',cad:cad?{warnings:cad.warnings,reader:cad.reader,entityCount:cad.entityCount,references:cad.references}:null,excludedPaperSpace,format:cad?'DWG':/\.kmz$/i.test(primary.name)?'KMZ':detail.driverShortName||'Vector',files:sourceFiles,ds,info:layer,source,count:layer.featureCount||0});count++;
      }
     }
    }
    if(!count)throw Error(hasCAD?'No model-space geometry was found. Page-layout objects are excluded from map imports.':'No supported spatial dataset was found in this file.');
   }catch(e){errors.push(`${primary.name}: ${errorText(e)}`);}
  }
 }
 await readBatch(all);
 // A stable batch group lets multi-table files and workbooks stay together in the legend.
 const counts=new Map();for(const item of items){const key=item.files.map(f=>f.name).join('|');counts.set(key,(counts.get(key)||0)+1);}
 const ids=new Map();for(const item of items){const key=item.files.map(f=>f.name).join('|');if(counts.get(key)>1){if(!ids.has(key))ids.set(key,crypto.randomUUID());item.importGroup={id:ids.get(key),name:item.files[0].name.replace(/\.[^.]+$/,'')};}}
 return {items,errors};
}
export async function convert(item,settings,progress=()=>{}){
 if(item.image)return convertImage(item,settings);
 const source=settings.crs.trim();if(!source)throw Error('Choose the source coordinate system before importing.');
 if(item.kind==='raster'&&!item.hasTransform)throw Error('This raster has no georeferencing. Supply a georeferenced raster or its world file.');
 const csv=item.fc||(item.rows?csvGeoJSON(item.rows,settings.x,settings.y,{skipInvalid:settings.skipInvalid,rowNumbers:item.rowNumbers,rowIssues:item.rowIssues,geographic:/^EPSG:4326$/i.test(source)}):null);
 if(csv&&/^EPSG:4326$/i.test(source)&&!settings.epoch&&!settings.pipeline&&!settings.gcps)return {fc:csv,bounds:validateCollection(csv)};
 progress('Loading coordinate transformation engine…');
 const G=await gdal();let ds=item.ds;
 if(csv)ds=(await G.open(new File([JSON.stringify(csv)],`csv_${id()}.geojson`))).datasets[0];
 const opts=['-s_srs',source,'-t_srs','EPSG:4326','--config','PROJ_ONLY_BEST_DEFAULT','YES'];
 if(settings.epoch)opts.push('-s_coord_epoch',String(settings.epoch));
 if(settings.pipeline)opts.push('-ct',settings.pipeline);
 if(settings.gcps){const rows=settings.gcps.trim().split('\n').filter(Boolean);if(rows.length<3)throw Error('Enter at least three control points.');for(const row of rows){const v=row.split(/[,\s]+/).map(Number);if(v.length!==4||!v.every(Number.isFinite))throw Error('Each control point needs local X, local Y, target X, target Y.');opts.push('-gcp',...v.map(String));}opts.push('-order','1');}
 if(item.kind==='vector'){
 const options=['-f','GeoJSON',...opts,'-lco','RFC7946=YES'];if(item.format==='DWG')options.push('-sql',`SELECT *, OGR_STYLE FROM "${String(item.layerName).replaceAll('"','""')}" WHERE ${modelSpaceFilter}`);else{if(item.format==='DXF')options.push('-where',modelSpaceFilter);if(item.layerName)options.push(item.layerName);}
 progress('Transforming vector coordinates…');
 const out=await G.ogr2ogr(ds,options,`vector_${id()}`);
 const fc=JSON.parse(new TextDecoder().decode(await G.getFileBytes(out)));
 if(['DXF','DWG'].includes(item.format))await repairDXFLayer(fc);
 if(item.format==='DWG')preserveCADColours(fc);
 const bounds=validateCollection(fc);if(csv)await G.close(ds);return {fc,bounds};
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

export async function repairDXFLayer(fc){
 preserveCollapsedDXFLines(fc);
 return repairDXFHatches(fc,async input=>{
  const G=await gdal(),opened=await G.open(new File([JSON.stringify(input)],`hatches_${id()}.geojson`));
  const dataset=opened.datasets?.[0];if(!dataset)throw Error('Could not read CAD hatch boundaries for repair.');
  try{
   const out=await G.ogr2ogr(dataset,['-f','GeoJSON','-makevalid'],`hatches_valid_${id()}`);
   return JSON.parse(new TextDecoder().decode(await G.getFileBytes(out)));
  }finally{await G.close(dataset);}
 });
}
