import {layerStyle,geometryKinds,vectorStyle} from './layer-style.js';
import {featureAppearance,categoryKey} from './attribute-style.js';
export const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const bearing=value=>((Number(value)||0)%360+360)%360;
export function rotatePoint(x,y,degrees){const a=degrees*Math.PI/180;return [x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];}
export function framePoint(map,latlng){const p=map.latLngToContainerPoint(latlng),f=map._printFrame,s=map.getSize();if(!f)return [p.x,p.y];const [x,y]=rotatePoint(p.x-s.x/2,p.y-s.y/2,f.bearing);return [x+f.width/2,y+f.height/2];}
export function frameLatLng(map,x,y){const f=map._printFrame,s=map.getSize(),[dx,dy]=rotatePoint(x-f.width/2,y-f.height/2,-f.bearing);return map.containerPointToLatLng([dx+s.x/2,dy+s.y/2]);}
export function footprint(map){const f=map._printFrame;return [[0,0],[f.width,0],[f.width,f.height],[0,f.height]].map(p=>frameLatLng(map,...p));}
const n=value=>Number(Number(value).toFixed(3));
export function symbolSVG(style,x,y){const size=style.pointSize||12,r=size/2,color=xml(style.color||'#147d72'),attrs=`fill="${color}" stroke="white" stroke-width="1.5" opacity="${style.opacity??1}"`;
 if(style.symbol==='circle'||!style.symbol)return `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" ${attrs}/>`;
 const paths={square:'M2 2H22V22H2Z',triangle:'M12 2L22 22H2Z',diamond:'M12 1L23 12L12 23L1 12Z',cross:'M8 2H16V8H22V16H16V22H8V16H2V8H8Z'};
 return `<svg x="${n(x-r)}" y="${n(y-r)}" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${paths[style.symbol]||paths.square}" ${attrs}/></svg>`;
}
export function legendEntries(layer){
 const rules=layer.metadata?.style?.rules,features=layer.fc?.features||[],kinds=[...geometryKinds(layer.fc)],base=layerStyle(layer);
 const entry=(key,label,appearance,count)=>({...base,color:layer.color,...appearance,key:`${layer.id}:${key}`,label,count,kinds:kinds.length?kinds:['raster']});
 if(!rules||rules.mode==='single')return [entry('single',layer.name,{},features.length)];
 if(['categorized','graduated'].includes(rules.mode)){
  const classes=rules.classes||[],counts=classes.map(()=>0);let missing=0;
  for(const f of features){const v=f.properties?.[rules.field],i=rules.mode==='categorized'?classes.findIndex(c=>c.key===categoryKey(v)):v==null||String(v).trim()===''||!Number.isFinite(Number(v))?-1:classes.findIndex((c,i)=>Number(v)>=c.min&&(Number(v)<c.max||(i===classes.length-1&&Number(v)<=c.max)));if(i<0)missing++;else counts[i]++;}
  const entries=classes.map((c,i)=>entry(String(i),c.label||(rules.mode==='graduated'?`${c.min} – ${c.max}${i===classes.length-1?' (inclusive)':''}`:c.key),c,counts[i]));
  if(missing)entries.push(entry('other','Other / missing',{},missing));return entries;
 }
 // Expression rules may produce continuous styles: enumerate the actual displayed combinations.
 const styles=new Map();for(const f of features){const a=featureAppearance(layer,f),s=layerStyle(a),key=[a.color,s.symbol,s.pointSize].join('/');const existing=styles.get(key);if(existing)existing.count++;else styles.set(key,entry(key,`${a.color} · ${s.symbol} · ${s.pointSize}px`,{...s,color:a.color},1));}
 return [...styles.values()];
}
export function wrapText(text,maxWidth,size=12){const result=[];for(const paragraph of String(text??'').split('\n')){let line='';for(const char of paragraph){if((line.length+1)*size*.56>maxWidth&&line){result.push(line);line='';}line+=char;}result.push(line);}return result;}
export function textSVG(text,x,y,width,size=12,extra=''){return wrapText(text,width,size).map((line,i)=>`<text x="${x}" y="${y+i*size*1.25}" font-family="Arial" font-size="${size}" fill="#17382b" ${extra}>${xml(line)}</text>`).join('');}
export function legendSVG(layers,item,width,height,{title='Legend',description=''}={}){
 const size=item.fontSize||12;let y=10+size,out=`<rect width="${width}" height="${height}" fill="white" fill-opacity=".94"/>`;
 out+=textSVG(title,8,y,width-16,size,'font-weight="bold"');y+=wrapText(title,width-16,size).length*size*1.25+7;
 if(description){out+=textSVG(description,8,y,width-16,size);y+=wrapText(description,width-16,size).length*size*1.25+7;}
 for(const layer of layers){if(item.hiddenLayers?.includes(layer.id))continue;const entries=legendEntries(layer).filter(e=>!item.hiddenEntries?.includes(e.key)),classified=layer.metadata?.style?.rules&&layer.metadata.style.rules.mode!=='single';
  if(classified){out+=textSVG(layer.name,8,y,width-16,size,'font-weight="bold"');y+=wrapText(layer.name,width-16,size).length*size*1.25+5;}
  for(const entry of entries){const label=(item.entryLabels?.[entry.key]??entry.label)+(item.showCounts?` (${entry.count})`:''),lines=wrapText(label,width-52,size),row=Math.max(size*1.25*lines.length,entry.kinds.includes('point')?entry.pointSize+4:18),cy=y+row/2-size*.35;
   if(entry.kinds.includes('point'))out+=symbolSVG(entry,24,cy);
   else if(entry.kinds.includes('shape')||entry.kinds.includes('raster'))out+=`<rect x="10" y="${cy-6}" width="28" height="12" fill="${xml(entry.fillColor||entry.color)}" fill-opacity="${entry.kinds.includes('raster')?1:entry.fillOpacity}" stroke="${xml(entry.color)}" stroke-width="${entry.lineWidth}" stroke-dasharray="${entry.lineStyle==='dashed'?'8 6':entry.lineStyle==='dotted'?'2 5':'none'}"/>`;
   else out+=`<path d="M10 ${cy}H38" fill="none" stroke="${xml(entry.color)}" stroke-width="${entry.lineWidth}" stroke-dasharray="${entry.lineStyle==='dashed'?'8 6':entry.lineStyle==='dotted'?'2 5':'none'}" opacity="${entry.opacity}"/>`;
   out+=textSVG(label,46,y+size*.65,width-52,size);y+=row+5;
  }y+=5;
 }
 return {markup:out,height:y+4,overflow:y+4>height};
}
export function geometrySVG(geometry,project,style){
 if(!geometry)return '';const {type,coordinates:c}=geometry;if(type==='GeometryCollection')return geometry.geometries.map(g=>geometrySVG(g,project,style)).join('');
 if(type==='Point'){const p=project(c);return p.every(Number.isFinite)?`<g transform="rotate(${style.bearing||0} ${p[0]} ${p[1]})">${symbolSVG(style,...p)}</g>`:'';}
 if(type==='MultiPoint')return c.map(p=>geometrySVG({type:'Point',coordinates:p},project,style)).join('');
 const line=points=>points.map((p,i)=>{const [x,y]=project(p);return `${i?'L':'M'}${n(x)} ${n(y)}`;}).join('');
 const polygon=type.includes('Polygon'),d=type==='LineString'?line(c):type==='MultiLineString'?c.map(line).join(''):type==='Polygon'?c.map(r=>line(r)+'Z').join(''):type==='MultiPolygon'?c.flatMap(p=>p.map(r=>line(r)+'Z')).join(''):'';
 if(!d||/NaN|Infinity/.test(d))return '';return `<path d="${d}" fill="${polygon?xml(style.fillColor||style.color):'none'}" fill-opacity="${style.fillOpacity??.2}" fill-rule="evenodd" stroke="${xml(style.color)}" stroke-width="${style.weight??style.lineWidth??2}" stroke-opacity="${style.opacity??1}" stroke-linejoin="round" stroke-linecap="round"${style.dashArray?` stroke-dasharray="${style.dashArray}"`:''}/>`;
}
export function layerSVG(layer,map){let result='',labels=0;const project=c=>framePoint(map,[c[1],c[0]]),f=map._printFrame;
 for(const feature of layer.fc?.features||[]){const appearance=featureAppearance(layer,feature),s=layerStyle(appearance),v=vectorStyle(layer,feature),annotation=layer.metadata?.annotation;
  if(annotation?.type!=='text')result+=geometrySVG(feature.geometry,project,{...s,...v,...(annotation?.type==='highlighter'?{weight:12,opacity:.35*(layer.opacity??.85)}:annotation?.type==='marker'?{weight:3}:{}),color:appearance.color,bearing:f.bearing});
  const g=feature.geometry;let points=g?.type==='Point'?[g.coordinates]:g?.type==='MultiPoint'?g.coordinates:[];
  if(annotation&&g?.type==='LineString')points=[g.coordinates.at(-1)];
  if(annotation&&g?.type==='Polygon')points=[g.coordinates[0][0]];
  const value=annotation?(annotation.type==='highlighter'?null:feature.properties?.note||layer.name):feature.properties?.[layer.metadata?.style?.labelField];
  if(value!=null&&String(value)!=='')for(const c of points){const [x,y]=project(c);if(x<0||y<0||x>f.width||y>f.height||labels>=500)continue;labels++;result+=`<g transform="translate(${x} ${y}) rotate(${f.bearing||0})">${textSVG(typeof value==='object'?JSON.stringify(value):String(value),8,-5,300,annotation?.type==='text'?20:11)}</g>`;}
  if(annotation?.type==='arrow'&&g?.type==='LineString'&&g.coordinates.length>1){const a=project(g.coordinates.at(-2)),b=project(g.coordinates.at(-1)),angle=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;result+=`<path d="M0 0L-14 -6L-14 6Z" transform="translate(${b[0]} ${b[1]}) rotate(${angle})" fill="${xml(layer.color)}"/>`;}
 }return result;
}
