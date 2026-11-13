export function coordinate(value) {
 const s=normaliseCoordinate(value);
 if(!s) throw Error('A coordinate is blank.');
 if(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s)){const n=Number(s);if(!Number.isFinite(n))throw Error('Coordinate is not a finite number.');return n;}
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
export function normaliseCoordinate(value){
 let s=String(value??'').trim().replace(/\u2212/g,'-').replace(/[\u200B\uFEFF]/g,'').replace(/^'(?=[+\-\d.])/,'');
 // Only accept complete thousands groups; never guess decimal commas or remove arbitrary text.
 if(/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s))s=s.replaceAll(',','');
 if(/^[+-]?\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:\.\d+)?$/.test(s))s=s.replace(/[ \u00A0\u202F]/g,'');
 return s;
}
export function analyzeCSVRows(rows,x,y,{rowNumbers=[],rowIssues=[],geographic=false}={}){
 if(rows.length>20000)throw Error('CSV supports up to 20,000 points per layer. Split this file before importing.');
 const features=[],issues=[],repairs=[];
 for(const [i,r] of rows.entries()){
  const row=rowNumbers[i]??i+2;
  try{
   if(rowIssues[i])throw Error(rowIssues[i]);
   const coords=[coordinate(r[x]),coordinate(r[y])];
   if(geographic&&(Math.abs(coords[0])>180||Math.abs(coords[1])>90))throw Error('Coordinates fall outside longitude/latitude limits. Check the CRS and columns.');
   features.push({type:'Feature',properties:r,geometry:{type:'Point',coordinates:coords}});
   const changed=[x,y].filter(k=>String(r[k]??'')!==normaliseCoordinate(r[k]));
   if(changed.length)repairs.push({row,reason:`Cleaned coordinate formatting in ${changed.join(', ')}.`});
  }catch(e){issues.push({row,index:i,reason:e.message,values:r});}
 }
 return {fc:{type:'FeatureCollection',features},issues,repairs,total:rows.length};
}
export function csvGeoJSON(rows,x,y,options={}){
 const result=analyzeCSVRows(rows,x,y,options);
 if(result.issues.length&&!options.skipInvalid)throw Error(`CSV row ${result.issues[0].row}: ${result.issues[0].reason} ${result.issues.length} invalid row(s); enable Skip invalid rows to import the rest.`);
 if(!result.fc.features.length)throw Error('No usable coordinate rows remain. Check the coordinate columns and source CRS.');
 return result.fc;
}
export function errorText(e){return e?.message||e?.error|| (Array.isArray(e)?e.map(errorText).join('; '):String(e));}
export function preserveCollapsedDXFLines(fc){
 for(const f of fc.features||[]){const g=f.geometry,c=g?.coordinates;
  if(g?.type==='LineString'&&c.length>=2&&c.every(p=>p.length===c[0].length&&p.every((v,i)=>Number.isFinite(v)&&v===c[0][i]))){
   f.geometry={type:'Point',coordinates:[...c[0]]};
   f.properties={...f.properties,_drillops_geometry_note:'Collapsed DXF line preserved as a point'};
  }
 }return fc;
}
