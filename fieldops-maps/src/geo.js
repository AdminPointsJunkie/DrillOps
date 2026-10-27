export function coordinate(value) {
 const s=String(value??'').trim();
 if(!s) throw Error('A coordinate is blank.');
 if(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
 const m=s.match(/^([+-]?\d+(?:\.\d+)?)\s*[°d\s]\s*(\d+(?:\.\d+)?)\s*['′m\s]\s*(?:(\d+(?:\.\d+)?)\s*["″s]?)?\s*([NSEW])?$/i);
 if(!m) throw Error(`Cannot read coordinate: ${s}`);
 const min=Number(m[2]),sec=Number(m[3]||0);if(min>=60||sec>=60)throw Error('Minutes and seconds must be below 60.');
 return (Number(m[1])<0||/[SW]/i.test(m[4]||'')?-1:1)*(Math.abs(Number(m[1]))+min/60+sec/3600);
}
export function validateCollection(fc) {
 if(fc.type!=='FeatureCollection'||!Array.isArray(fc.features)||!fc.features.length)throw Error('No spatial features were found in this layer.');
 if(fc.features.length>20000)throw Error('This first version supports up to 20,000 features per layer. Split this layer before importing.');
 let bbox=[Infinity,Infinity,-Infinity,-Infinity];
 function visit(c){if(!Array.isArray(c))throw Error('Invalid geometry coordinates.');if(typeof c[0]==='number'){if(c.length<2||!c.every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90)throw Error('Coordinates fall outside longitude/latitude limits. Check the source CRS and coordinate columns.');bbox=[Math.min(bbox[0],c[0]),Math.min(bbox[1],c[1]),Math.max(bbox[2],c[0]),Math.max(bbox[3],c[1])];}else c.forEach(visit);}
 function geom(g){if(!g)throw Error('A feature has no geometry. No features have been silently skipped.');if(g.type==='GeometryCollection')g.geometries.forEach(geom);else visit(g.coordinates);}
 fc.features.forEach(f=>geom(f.geometry));if(!bbox.every(Number.isFinite))throw Error('Empty geometry.');return bbox;
}
export function csvGeoJSON(rows,x,y){if(rows.length>20000)throw Error('CSV supports up to 20,000 points per layer. Split this file before importing.');if(!rows.length)throw Error('The CSV contains no point rows.');return {type:'FeatureCollection',features:rows.map((r,i)=>{try{return{type:'Feature',properties:r,geometry:{type:'Point',coordinates:[coordinate(r[x]),coordinate(r[y])]}}}catch(e){throw Error(`CSV row ${i+2}: ${e.message}`)}})};}
export function errorText(e){return e?.message||e?.error|| (Array.isArray(e)?e.map(errorText).join('; '):String(e));}
export function preserveCollapsedDXFLines(fc){
 for(const f of fc.features||[]){const g=f.geometry,c=g?.coordinates;
  if(g?.type==='LineString'&&c.length>=2&&c.every(p=>p.length===c[0].length&&p.every((v,i)=>Number.isFinite(v)&&v===c[0][i]))){
   f.geometry={type:'Point',coordinates:[...c[0]]};
   f.properties={...f.properties,_drillops_geometry_note:'Collapsed DXF line preserved as a point'};
  }
 }return fc;
}
