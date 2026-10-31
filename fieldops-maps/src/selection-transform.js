import {featureBounds} from './explore-data.js';
const r=Math.PI/180;
const project=([x,y])=>{if(Math.abs(y)>85)throw Error('Rotation and scaling are supported between 85°S and 85°N.');return [x*r,Math.log(Math.tan(Math.PI/4+y*r/2))];};
export function transformSelection(items,degrees=0,scale=1){
 if(!Number.isFinite(degrees)||!Number.isFinite(scale)||scale<.01||scale>100)throw Error('Enter a valid rotation and a scale between 1% and 10000%.');
 const bounds=items.map(s=>featureBounds(s.layer.fc.features[s.index])).filter(Boolean);if(!bounds.length)throw Error('Select geometry first.');
 const a=project([Math.min(...bounds.map(b=>b[0])),Math.min(...bounds.map(b=>b[1]))]),b=project([Math.max(...bounds.map(b=>b[2])),Math.max(...bounds.map(b=>b[3]))]),center=[(a[0]+b[0])/2,(a[1]+b[1])/2],angle=-degrees*r;
 const point=c=>{const p=project(c),x=(p[0]-center[0])*scale,y=(p[1]-center[1])*scale;const lng=(center[0]+x*Math.cos(angle)-y*Math.sin(angle))/r,lat=(2*Math.atan(Math.exp(center[1]+x*Math.sin(angle)+y*Math.cos(angle)))-Math.PI/2)/r;if(Math.abs(lng)>180||Math.abs(lat)>85)throw Error('The transformed features would leave the supported map area.');return [lng,lat,...c.slice(2)];};
 const coords=c=>typeof c[0]==='number'?point(c):c.map(coords);
 return items.map(s=>{const feature=structuredClone(s.layer.fc.features[s.index]);const visit=g=>{if(g.type==='GeometryCollection')g.geometries.forEach(visit);else g.coordinates=coords(g.coordinates);};visit(feature.geometry);if(feature.geometry.type==='Point'&&s.layer.metadata?.annotation){feature.properties??={};feature.properties._fieldmaps_rotation=((Number(feature.properties._fieldmaps_rotation)||0)+degrees)%360;}return {...s,feature};});
}
