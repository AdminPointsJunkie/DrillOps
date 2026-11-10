import {distance, bearing, destination, point} from '@turf/turf';
const metres=(a,b)=>distance(point(a),point(b),{units:'meters'});
export function stations(length,spacing,limit=5000){
 if(!Number.isFinite(length)||length<=0||!Number.isFinite(spacing)||spacing<=0)throw Error('Use a positive distance and spacing.');
 const count=Math.ceil(length/spacing)+1;if(count>limit)throw Error(`Too many samples (${count.toLocaleString()}). Increase spacing; limit ${limit.toLocaleString()}.`);
 return Array.from({length:count},(_,i)=>Math.min(i*spacing,length));
}
export function alignment(coords){
 if(coords.length<2||coords.some(c=>!c.slice(0,2).every(Number.isFinite)||Math.abs(c[1])>90||Math.abs(c[0])>180))throw Error('Choose a valid line with at least two vertices.');
 const vertices=[coords[0].slice(0,2)],chain=[0];
 for(const c of coords.slice(1)){const d=metres(vertices.at(-1),c);if(d>.001){chain.push(chain.at(-1)+d);vertices.push(c.slice(0,2));}}
 const length=chain.at(-1);if(!length)throw Error('The line has no length.');
 return {length,at(s){s=Math.max(0,Math.min(length,s));let i=1;while(i<chain.length-1&&chain[i]<s)i++;const heading=bearing(point(vertices[i-1]),point(vertices[i]));return {coordinate:destination(point(vertices[i-1]),s-chain[i-1],heading,{units:'meters'}).geometry.coordinates,heading};}};
}
export async function profile(coords,spacing,sample,check=()=>{}){
 const route=alignment(coords),rows=[];
 for(const station of stations(route.length,spacing)){check();const {coordinate}=route.at(station);rows.push({station,coordinate,elevation:await sample(coordinate)});}
 return rows;
}
export async function crossSections(coords,{interval,width,spacing},sample,check=()=>{}){
 const route=alignment(coords),centres=stations(route.length,interval,200),offsets=stations(width,spacing);
 if(centres.length*offsets.length>20000)throw Error('Cross-sections exceed 20,000 samples. Increase spacing or reduce width.');
 const sections=[];
 for(const chainage of centres){const {coordinate,heading}=route.at(chainage),rows=[];
  for(const x of offsets){check();const station=x-width/2,coordinate2=destination(point(coordinate),Math.abs(station),heading+(station<0?-90:90),{units:'meters'}).geometry.coordinates;rows.push({station,coordinate:coordinate2,elevation:await sample(coordinate2)});}
  sections.push({chainage,rows});
 }return sections;
}
export function summary(rows){
 const valid=rows.filter(r=>Number.isFinite(r.elevation));let ascent=0,descent=0,maxGrade=0;
 for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i];if(!Number.isFinite(a.elevation)||!Number.isFinite(b.elevation))continue;const dz=b.elevation-a.elevation,dx=b.station-a.station;if(dz>0)ascent+=dz;else descent-=dz;if(dx>0)maxGrade=Math.max(maxGrade,Math.abs(100*dz/dx));}
 return {valid:valid.length,total:rows.length,min:valid.length?Math.min(...valid.map(r=>r.elevation)):null,max:valid.length?Math.max(...valid.map(r=>r.elevation)):null,ascent,descent,maxGrade};
}
export function profileFeatures(sections){
 const features=[];for(const {chainage,rows} of sections){let run=[];const flush=()=>{if(run.length>1)features.push({type:'Feature',properties:{chainage_m:chainage,'KML altitude mode':'absolute'},geometry:{type:'LineString',coordinates:run}});run=[];};for(const r of rows){if(Number.isFinite(r.elevation))run.push([...r.coordinate,r.elevation]);else flush();}flush();}
 return {type:'FeatureCollection',features};
}
export function profileCSV(sections){return 'chainage_m,offset_or_distance_m,longitude,latitude,elevation_m\r\n'+sections.flatMap(s=>s.rows.map(r=>[s.chainage,r.station,...r.coordinate,r.elevation??''].join(','))).join('\r\n');}
export async function terrainPoint(coordinate,step,sample){
 if(!(step>0))throw Error('Slope baseline must be positive.');
 const [z,n,e,s,w]=await Promise.all([sample(coordinate),...[0,90,180,270].map(h=>sample(destination(point(coordinate),step,h,{units:'meters'}).geometry.coordinates))]);
 if([n,e,s,w].some(v=>!Number.isFinite(v)))return {elevation:z,slope:null,aspect:null};
 const dx=(e-w)/(2*step),dy=(n-s)/(2*step),gradient=Math.hypot(dx,dy);
 return {elevation:z,slope:Math.atan(gradient)*180/Math.PI,aspect:gradient<1e-10?null:(Math.atan2(-dx,-dy)*180/Math.PI+360)%360};
}
export async function surfaceMesh(dem,check=()=>{}){
 const nx=Math.min(64,dem.width),ny=Math.min(64,dem.height),grid=[];
 for(let y=0;y<ny;y++){const row=[];for(let x=0;x<nx;x++){check();const coordinate=dem.coordinate(x*(dem.width-1)/(nx-1),y*(dem.height-1)/(ny-1));row.push({coordinate,elevation:await dem.sample(coordinate)});}grid.push(row);}
 const features=[];for(let y=1;y<ny;y++)for(let x=1;x<nx;x++){const a=grid[y-1][x-1],b=grid[y-1][x],c=grid[y][x],d=grid[y][x-1];for(const tri of [[a,b,c],[a,c,d]])if(tri.every(p=>Number.isFinite(p.elevation))){const ring=tri.map(p=>[...p.coordinate,p.elevation]);features.push({type:'Feature',properties:{elevation_m:tri.reduce((s,p)=>s+p.elevation,0)/3,'KML altitude mode':'absolute'},geometry:{type:'Polygon',coordinates:[[...ring,ring[0]]]}});}}
 return {type:'FeatureCollection',features};
}
