const sidecar=/\.(shx|dbf|prj|cpg|qix|sbn|sbx|pgw|jgw|jpw|tfw|tifw|wld|aux\.xml)$/i;
const base=name=>name.replace(/\.(aux\.xml|[^.]+)$/i,'').toLowerCase();
export function groupFiles(files){
 const seen=new Set(),groups=[];const names=new Set();
 for(const file of files){if(names.has(file.name))throw Error('Files in one batch must have unique paths.');names.add(file.name);}
 for(const file of files){if(sidecar.test(file.name)||seen.has(file))continue;
  const companions=files.filter(f=>f!==file&&sidecar.test(f.name)&&(base(f.name)===base(file.name)||f.name.toLowerCase()===file.name.toLowerCase()+'.aux.xml'));
  const group=[file,...companions];group.forEach(f=>seen.add(f));groups.push(group);
 }
 for(const file of files)if(!seen.has(file))groups.push([file]);
 return groups;
}
export function unsupportedReason(name){
 const ext=name.split('.').at(-1).toLowerCase();
 if(['qgs','qgz','qgd','qml','qmd','qlr'].includes(ext))return 'This QGIS file contains project settings or styles. Upload its source data files instead.';
 if(['lyr','lyrx'].includes(ext))return 'This ArcGIS layer file references data elsewhere. Upload the referenced Shapefile or geodatabase.';
 if(ext==='ecw')return 'ECW requires a proprietary decoder. Export a GeoTIFF and upload it instead.';
 if(['doc','docx','ppt','pptx','ai'].includes(ext))return 'Export this document to an image or PDF, or export spatial data to GeoPackage or Shapefile.';
 if(ext==='gpi')return 'Garmin GPI needs conversion with GPSBabel to GPX before upload. Direct GPI import is not yet available.';
 return '';
}
