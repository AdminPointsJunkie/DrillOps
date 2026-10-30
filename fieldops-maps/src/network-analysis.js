import {distance,point} from '@turf/turf';
const metres=(a,b)=>distance(point(a),point(b),{units:'meters'});
function coordinate(c){if(!Array.isArray(c)||c.length<2||!c.slice(0,2).every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90)throw Error('Enter valid longitude and latitude.');return c.slice(0,2);}
export function networkAnalysis({source,origin,destination}){
 origin=coordinate(origin);destination=coordinate(destination);
 const nodes=[],lookup=new Map(),edges=[];
 function node(c){coordinate(c);const key=c.slice(0,2).join(',');if(!lookup.has(key)){if(nodes.length>=5000)throw Error('Use a road network with up to 5,000 vertices.');lookup.set(key,nodes.length);nodes.push({c:c.slice(),links:[]});}return lookup.get(key);}
 for(const f of source?.features||[]){const g=f.geometry;if(!['LineString','MultiLineString'].includes(g?.type))throw Error('Choose a line layer containing roads or tracks.');for(const line of g.type==='LineString'?[g.coordinates]:g.coordinates){for(let i=1;i<line.length;i++){const a=node(line[i-1]),b=node(line[i]),length=metres(nodes[a].c,nodes[b].c);if(!length)continue;const edge={a,b,length,properties:f.properties};if(edges.length>=100000)throw Error('Use a network with up to 100,000 segments.');edges.push(edge);nodes[a].links.push({to:b,length});nodes[b].links.push({to:a,length});}}}
 if(!edges.length)throw Error('The network has no usable road segments.');
 function nearest(c){let best=Infinity,id=-1;nodes.forEach((n,i)=>{const d=metres(c,n.c);if(d<best){best=d;id=i;}});if(best>250)throw Error('Choose a position within 250 metres of a road vertex.');return {id,snap:best};}
 const start=nearest(origin),end=nearest(destination),dist=nodes.map(()=>Infinity),previous=[],done=new Set();dist[start.id]=0;
 // A bounded Dijkstra search runs in the analysis worker, never on the map thread.
 for(let k=0;k<nodes.length;k++){let u=-1;for(let i=0;i<nodes.length;i++)if(!done.has(i)&&(u<0||dist[i]<dist[u]))u=i;if(u<0||!Number.isFinite(dist[u]))break;done.add(u);for(const link of nodes[u].links)if(dist[u]+link.length<dist[link.to]){dist[link.to]=dist[u]+link.length;previous[link.to]=u;}}
 const common={method:'Imported network; shared vertices; two-way routing',origin_snap_m:Math.round(start.snap)};
 if(end){if(!Number.isFinite(dist[end.id]))throw Error('No connected route exists. Road intersections must share a vertex.');if(end.id===start.id)throw Error('Start and destination snap to the same vertex. Choose a more distant destination.');const path=[];for(let i=end.id;i!==undefined;i=previous[i])path.unshift(nodes[i].c);return {type:'FeatureCollection',features:[{type:'Feature',properties:{...common,distance_m:dist[end.id],destination_snap_m:Math.round(end.snap)},geometry:{type:'LineString',coordinates:path}}]};}
}
