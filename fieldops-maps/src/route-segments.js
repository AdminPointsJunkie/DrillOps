import {measureDistance} from './explore-data.js';

// Consecutive road legs share a request; straight legs never reach the provider.
export async function mixedRoute(points,legs,mode,onlineRoute,isCurrent=()=>true){
 const parts=[];let i=0;
 while(i<points.length-1){
  if(!isCurrent())throw Error('Route changed.');
  if(legs[i]==='straight'){parts.push({coordinates:[points[i],points[i+1]],kind:'straight'});i++;continue;}
  const start=i;while(i<points.length-1&&legs[i]!=='straight')i++;
  const route=await onlineRoute({mode,coordinates:structuredClone(points.slice(start,i+1))});
  if(!isCurrent())throw Error('Route changed.');
  const geometry=route?.features?.[0]?.geometry;
  if(geometry?.type!=='LineString'||geometry.coordinates.length<2)throw Error('No road route was returned.');
  parts.push({coordinates:geometry.coordinates,kind:'road',properties:route.features[0].properties});
 }
 if(parts.length===1&&parts[0].kind==='road')return {type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:parts[0].coordinates},properties:parts[0].properties}]};
 // ORS snaps road endpoints. Join adjacent straight legs at those snapped points,
 // rather than inventing an unmarked connector across a road or obstacle.
 for(let j=0;j<parts.length;j++)if(parts[j].kind==='straight'){
  if(parts[j-1]?.kind==='road')parts[j].coordinates[0]=parts[j-1].coordinates.at(-1);
  if(parts[j+1]?.kind==='road')parts[j].coordinates[1]=parts[j+1].coordinates[0];
 }
 const coordinates=[];for(const part of parts)for(const c of part.coordinates)if(!coordinates.length||c[0]!==coordinates.at(-1)[0]||c[1]!==coordinates.at(-1)[1])coordinates.push(c);
 if(coordinates.length<2)throw Error('Choose different route stops.');
 return {type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates},properties:{mode,method:parts.some(p=>p.kind==='road')?'Roads and straight segments':'Straight line',distance_m:measureDistance(coordinates),...(parts.some(p=>p.kind==='road')?{attribution:'© openrouteservice by HeiGIT | © OpenStreetMap contributors',license:'CC-BY-SA-4.0'}:{})}}]};
}
