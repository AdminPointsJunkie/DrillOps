export function fileLayerName(files,datasetPath='',internalName='',multiple=false){
 const basename=value=>String(value).split(/[\\/]/).pop();
 const stem=value=>basename(value).replace(/\.[^.]+$/,'');
 const primary=files.find(f=>/\.(zip|shp|dxf|dwg|gpkg|geojson|json|kml|kmz|gpx|csv|tif|tiff|img|vrt|asc|png|jpg|jpeg|jp2)$/i.test(f.name));
 const pathName=basename(datasetPath);
 const matched=files.find(f=>f.name===pathName);
 const name=stem((files.length===1?files[0]:matched||primary||files[0])?.name||pathName||internalName);
 return multiple&&internalName?`${name} — ${internalName}`:name;
}
