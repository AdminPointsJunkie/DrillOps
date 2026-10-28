import {attributeFields as readFields,categoryKey} from './attribute-style.js';
const fieldCache=new WeakMap(),categoryCache=new WeakMap(),collator=new Intl.Collator(undefined,{numeric:true});
export function attributeFields(fc){if(!fc)return [];if(!fieldCache.has(fc))fieldCache.set(fc,readFields(fc));return fieldCache.get(fc);}
export const textValue=v=>v==null?'':typeof v==='object'?JSON.stringify(v):String(v);
export const numericValue=v=>v==null||String(v).trim()===''?NaN:Number(v);
export const filterOperators={eq:'equals',ne:'does not equal',contains:'contains',starts:'starts with',gt:'greater than',gte:'at least',lt:'less than',lte:'at most',empty:'is empty',notempty:'is not empty'};
export function matchesFilter(feature,filter){
 const conditions=filter?.conditions||[];if(!conditions.length)return true;
 const results=conditions.map(c=>{
  const value=feature.properties?.[c.field],a=textValue(value).toLowerCase(),b=textValue(c.value).toLowerCase();
  switch(c.op){case 'eq':return a===b;case 'ne':return a!==b;case 'contains':return a.includes(b);case 'starts':return a.startsWith(b);case 'gt':return numericValue(value)>numericValue(c.value);case 'gte':return numericValue(value)>=numericValue(c.value);case 'lt':return numericValue(value)<numericValue(c.value);case 'lte':return numericValue(value)<=numericValue(c.value);case 'empty':return a.trim()==='';case 'notempty':return a.trim()!=='';default:return false;}
 });return filter.match==='any'?results.some(Boolean):results.every(Boolean);
}
export function featureClass(layer,feature){
 const rules=layer.metadata?.style?.rules;if(!rules||!['categorized','graduated'].includes(rules.mode))return 'all';
 const value=feature.properties?.[rules.field];
 if(rules.mode==='categorized'){if(!categoryCache.has(rules))categoryCache.set(rules,new Set((rules.classes||[]).map(c=>c.key)));const key=categoryKey(value);return categoryCache.get(rules).has(key)?key:'other';}
 const index=(rules.classes||[]).findIndex((c,i)=>numericValue(value)>=c.min&&(numericValue(value)<c.max||(i===rules.classes.length-1&&numericValue(value)<=c.max)));
 return index<0?'other':rules.mode==='categorized'?rules.classes[index].key:`range:${index}`;
}
export function matchesView(layer,feature,view={}){
 return matchesFilter(feature,view.filter)&&!(view.hiddenClasses||[]).includes(featureClass(layer,feature))&&(!view.search||Object.values(feature.properties||{}).some(v=>textValue(v).toLowerCase().includes(view.search.toLowerCase())));
}
export function legendItems(layer,view={}){
 const rules=layer.metadata?.style?.rules,base={color:layer.color||'#147d72',symbol:layer.metadata?.style?.symbol||'circle',pointSize:layer.metadata?.style?.pointSize||12};
 const entries=rules&&['categorized','graduated'].includes(rules.mode)?[...(rules.classes||[]).map((c,i)=>({...base,...c,key:rules.mode==='categorized'?c.key:`range:${i}`,label:c.label??`${Number(c.min).toLocaleString()} – ${Number(c.max).toLocaleString()}`})),{...base,key:'other',label:'Other / missing values'}]:[{...base,key:'all',label:rules?.mode==='expression'?'Formula style':layer.name}];
 const counts=new Map();for(const f of layer.fc?.features||[])if(matchesFilter(f,view.filter)&&(!view.search||Object.values(f.properties||{}).some(v=>textValue(v).toLowerCase().includes(view.search.toLowerCase())))){const key=featureClass(layer,f);counts.set(key,(counts.get(key)||0)+1);}
 return entries.map(c=>({...c,count:counts.get(c.key)||0,visible:!(view.hiddenClasses||[]).includes(c.key)}));
}
export function featureBounds(feature){
 const bounds=[Infinity,Infinity,-Infinity,-Infinity];
 function coords(c){if(!Array.isArray(c))return;if(typeof c[0]==='number'){if(Number.isFinite(c[0])&&Number.isFinite(c[1])){bounds[0]=Math.min(bounds[0],c[0]);bounds[1]=Math.min(bounds[1],c[1]);bounds[2]=Math.max(bounds[2],c[0]);bounds[3]=Math.max(bounds[3],c[1]);}}else c.forEach(coords);}
 function visit(g){if(g?.type==='GeometryCollection')g.geometries.forEach(visit);else coords(g?.coordinates);}visit(feature?.geometry);return Number.isFinite(bounds[0])?bounds:null;
}
export function tableRows(layer,view,{field='',direction=1,search='',bounds=null}={}){
 return (layer.fc?.features||[]).map((feature,index)=>({feature,index})).filter(({feature})=>{
  if(!matchesView(layer,feature,view))return false;
  if(search&&!Object.values(feature.properties||{}).some(v=>textValue(v).toLowerCase().includes(search.toLowerCase())))return false;
  if(bounds){const b=featureBounds(feature);if(!b||b[2]<bounds[0]||b[0]>bounds[2]||b[3]<bounds[1]||b[1]>bounds[3])return false;}return true;
 }).sort((a,b)=>{if(!field)return a.index-b.index;const x=a.feature.properties?.[field],y=b.feature.properties?.[field],nx=numericValue(x),ny=numericValue(y);return direction*(Number.isFinite(nx)&&Number.isFinite(ny)?nx-ny:collator.compare(textValue(x),textValue(y)));});
}
export function displayFields(layer){
 const fields=attributeFields(layer.fc),configured=layer.metadata?.style?.popup?.fields;
 return configured?configured.filter(c=>fields.includes(c.field)&&c.visible!==false):fields.map(field=>({field,label:field,visible:true}));
}
export function featureTitle(layer,feature,index){const key=layer.metadata?.style?.popup?.titleField||attributeFields(layer.fc).find(f=>/^(hole.?id|name|id|label)$/i.test(f));return textValue(feature.properties?.[key])||`${layer.name} · ${index+1}`;}
export function featureInfo(layer,feature,document){
 const el=document.createElement('div');el.className='feature-popup';const table=document.createElement('table');
 for(const {field,label} of displayFields(layer)){const tr=document.createElement('tr');for(const value of [label||field,textValue(feature.properties?.[field])||'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);}el.append(table);return el;
}
const radians=Math.PI/180,R=6371008.8;
export function measureDistance(points){let sum=0;for(let i=1;i<points.length;i++){const [x,y]=points[i-1],[xx,yy]=points[i],a=Math.sin((yy-y)*radians/2)**2+Math.cos(y*radians)*Math.cos(yy*radians)*Math.sin((xx-x)*radians/2)**2;sum+=2*R*Math.atan2(Math.sqrt(Math.min(1,a)),Math.sqrt(Math.max(0,1-a)));}return sum;}
export function measureArea(points){if(points.length<3)return 0;let sum=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];let dx=(b[0]-a[0])*radians;while(dx>Math.PI)dx-=2*Math.PI;while(dx< -Math.PI)dx+=2*Math.PI;sum+=dx*(2+Math.sin(a[1]*radians)+Math.sin(b[1]*radians));}const area=Math.abs(sum)*R*R/2;return Math.min(area,4*Math.PI*R*R-area);}
export const distanceText=m=>m<1000?`${m.toFixed(1)} m`:`${(m/1000).toFixed(2)} km`;
export const areaText=m=>`${(m/10000).toFixed(3)} ha · ${m.toFixed(0)} m²`;
