import osmToGeoJSON from 'osmtogeojson';
export const dataLibrary=[
 {id:'countries',name:'Countries',description:'Natural Earth · 1:110m · generalised country boundaries',source:'Natural Earth',license:'Public domain'},
 {id:'states',name:'States and provinces',description:'Natural Earth · 1:50m · selected countries, not worldwide coverage',source:'Natural Earth',license:'Public domain'},
 {id:'rivers',name:'Major rivers',description:'Natural Earth · 1:110m · major rivers and lake centre lines',source:'Natural Earth',license:'Public domain'},
 {id:'lakes',name:'Major lakes',description:'Natural Earth · 1:110m · generalised lakes',source:'Natural Earth',license:'Public domain'},
 {id:'graticule',name:'Latitude / longitude grid',description:'10° graticule · editable WGS 84 lines',source:'Generated WGS 84 graticule',license:'Public domain'}
];
export function graticule(){const features=[];const line=(coordinates,name)=>features.push({type:'Feature',properties:{name},geometry:{type:'LineString',coordinates}});for(let x=-180;x<=180;x+=10)line(Array.from({length:171},(_,i)=>[x,i-85]),`${x}° longitude`);for(let y=-80;y<=80;y+=10)line(Array.from({length:361},(_,i)=>[i-180,y]),`${y}° latitude`);return {type:'FeatureCollection',features};}
export async function loadLibrary(id,{signal,fetcher=fetch}={}){if(!dataLibrary.some(d=>d.id===id))throw Error('Unknown dataset.');if(id==='graticule')return graticule();const response=await fetcher(`${import.meta.env?.BASE_URL||'/maps/'}library/${id}.geojson`,{signal});if(!response.ok)throw Error('The reference dataset could not load. Please retry.');const fc=await response.json();if(fc.type!=='FeatureCollection'||!Array.isArray(fc.features))throw Error('Invalid reference dataset.');return fc;}
export function boundaryQuery(kind,bounds){
 if(!['buildings','local'].includes(kind))throw Error('Choose a boundary type.');
 const [w,s,e,n]=bounds,limit=kind==='buildings'?.025:.35;
 if(bounds.length!==4||!bounds.every(Number.isFinite)||w< -180||e>180||s< -85||n>85||w>=e||s>=n||e-w>limit||n-s>limit)throw Error(kind==='buildings'?'Zoom in to a neighbourhood before loading buildings.':'Zoom in to a town or district before loading local boundaries.');
 const box=[s,w,n,e].join(',');return `[out:json][timeout:25][maxsize:16777216];(${kind==='buildings'?`way[building](${box});relation[building](${box});`:`relation[boundary=administrative][admin_level~"^[6-9]$|^10$"](${box});`});out geom;`;
}
export function osmBoundaries(json){if(json.remark)throw Error('The boundary service returned an incomplete result. Zoom in and retry.');const fc=osmToGeoJSON(json);fc.features=fc.features.filter(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type)&&!f.properties?.tainted).map(f=>({...f,properties:{...f.properties,name:f.properties?.name||f.properties?.['addr:street']||'Unnamed boundary',source:'OpenStreetMap contributors',license:'ODbL 1.0',source_url:'https://www.openstreetmap.org/'+f.id}}));return fc;}
export async function loadLocalBoundaries(kind,bounds,{signal,fetcher=fetch}={}){const query=boundaryQuery(kind,bounds);const response=await fetcher('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal});if(!response.ok)throw Error(response.status===429?'The free boundary service is busy. Please retry later.':'Boundaries could not load. Try a smaller area or retry later.');const text=await response.text();if(text.length>20_000_000)throw Error('Too much boundary data. Zoom in and retry.');return osmBoundaries(JSON.parse(text));}
