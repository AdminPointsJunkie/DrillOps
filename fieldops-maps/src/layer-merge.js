const families={Point:'point',MultiPoint:'point',LineString:'line',MultiLineString:'line',Polygon:'polygon',MultiPolygon:'polygon'};
export function mergeableType(layers){
 if(layers.length<2)return null;
 let type;
 for(const layer of layers){
  if(layer?.kind!=='vector'||layer.metadata?.annotation||!layer.fc?.features?.length)return null;
  for(const feature of layer.fc.features){const family=families[feature.geometry?.type];if(!family||(type&&family!==type))return null;type=family;}
 }
 return type;
}
export function mergeSelectedFeatures(layers){
 if(!mergeableType(layers))throw Error('Select layers of the same geometry type.');
 return {type:'FeatureCollection',features:layers.flatMap(layer=>layer.fc.features.map(source=>{
  const feature=structuredClone(source);delete feature.id;
  if(feature.properties)delete feature.properties._fieldmaps_group;
  return feature;
 }))};
}
