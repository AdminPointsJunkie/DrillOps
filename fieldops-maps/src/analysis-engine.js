import {bbox,bboxPolygon,buffer,centroid,union,intersect,difference,booleanPointInPolygon,featureCollection,flatten} from '@turf/turf';
import {joinRows} from './table-join.js';
const fc=features=>({type:'FeatureCollection',features});
const polygons=collection=>collection.features.every(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type));
export function analyse({operation,source,target,field,targetField,distance=100}){
 if(!source?.features?.length)throw Error('Choose a layer containing features.');
 if(source.features.length+(target?.features?.length||0)>20000)throw Error('Browser analysis supports up to 20,000 input features. Split this job into smaller layers.');
 source=structuredClone(source);target=target?structuredClone(target):null;
 const pair=['clip','intersect','subtract','count','join','merge'].includes(operation);
 if(pair&&!target?.features?.length)throw Error('Choose a second layer containing features.');
 const requirePolygons=c=>{if(!polygons(c))throw Error('This operation requires polygon layers.');};
 const combine=c=>c.features.length===1?c.features[0]:union(c);
 let result;
 switch(operation){
 case 'bounds': {const b=bbox(source);if(b[0]===b[2]||b[1]===b[3])throw Error('The layer has no two-dimensional extent.');result=fc([bboxPolygon(b)]);break;}
 case 'centroid':result=fc(source.features.map(f=>centroid(f,{properties:f.properties})));break;
 case 'buffer':if(!Number.isFinite(+distance)||+distance<=0||+distance>100000)throw Error('Enter a buffer distance from above zero to 100,000 metres.');result=buffer(source,+distance,{units:'meters',steps:16});break;
 case 'dissolve':{requirePolygons(source);const groups=new Map();for(const f of source.features){const key=field?JSON.stringify(f.properties?.[field]??null):'all';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}result=fc([...groups.values()].map(features=>({...combine(fc(features)),properties:field?{[field]:features[0].properties?.[field]??null}:{}})));break;}
 case 'clip':case 'subtract':{requirePolygons(source);requirePolygons(target);const mask=combine(target);result=fc(source.features.flatMap(f=>{const g=(operation==='clip'?intersect:difference)(fc([f,mask]));return g?[{...g,properties:f.properties}]:[];}));break;}
 case 'intersect':requirePolygons(source);requirePolygons(target);if(source.features.length*target.features.length>250000)throw Error('Too many feature pairs. Reduce the layer size.');result=fc(source.features.flatMap(a=>target.features.flatMap(b=>{const g=intersect(fc([a,b]));return g?[{...g,properties:{...a.properties,...Object.fromEntries(Object.entries(b.properties||{}).map(([k,v])=>['overlay_'+k,v]))}}]:[];})));break;
 case 'count':{requirePolygons(source);const points=flatten(target);if(!points.features.every(f=>f.geometry?.type==='Point'))throw Error('The second layer must contain points.');if(source.features.length*points.features.length>1000000)throw Error('Too many polygon/point pairs. Reduce the layer size.');result=fc(source.features.map(f=>({...f,properties:{...f.properties,point_count:points.features.filter(p=>booleanPointInPolygon(p,f)).length}})));break;}
 case 'join':if(!field||!targetField)throw Error('Choose both join fields.');result=joinRows(source,target.features.map(f=>f.properties||{}),field,targetField,'joined_').fc;break;
 case 'merge':result=fc([...source.features,...target.features]);break;
 default:throw Error('Unknown analysis operation.');
 }
 if(!result?.features?.length)throw Error('No features remain in the result. The source layers have not changed.');
 return result;
}
