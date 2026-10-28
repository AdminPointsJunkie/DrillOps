import {compileExpression} from './style-expression.js';
export const attributeSymbols=['circle','square','triangle','diamond','cross'];
export const attributeFields=fc=>[...new Set((fc?.features||[]).flatMap(f=>Object.keys(f.properties||{})))];
const palette=['#147d72','#c17d28','#6c61aa','#ce6359','#3087ba','#ad397d','#638c30','#805443'];
const numeric=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v));
export const categoryKey=v=>v===null||v===undefined?'null':`${typeof v}:${String(v)}`;
export function classifyFeatures(fc,field,mode,count=5){
 const values=(fc?.features||[]).map(f=>f.properties?.[field]);
 const style=i=>({color:palette[i%palette.length],symbol:'circle',pointSize:12});
 if(mode==='categorized'){
  const distinct=new Map();for(const v of values){const key=categoryKey(v);if(!distinct.has(key))distinct.set(key,v);if(distinct.size>100)throw new Error('More than 100 unique values. Choose a different column or numeric ranges.');}
  return [...distinct].map(([key,v],i)=>({key,label:v===null||v===undefined?'(missing)':v===''?'(empty)':String(v),...style(i)}));
 }
 if(mode!=='graduated')throw new Error('Choose categories or numeric ranges.');
 const numbers=values.filter(numeric).map(Number);if(!numbers.length)throw new Error('This column has no numeric values.');
 let min=Infinity,max=-Infinity;for(const n of numbers){min=Math.min(min,n);max=Math.max(max,n);}
 count=Math.max(2,Math.min(12,Math.round(Number(count)||5)));if(min===max)count=1;
 return Array.from({length:count},(_,i)=>({min:min+(max-min)*i/count,max:i===count-1?max:min+(max-min)*(i+1)/count,...style(i)}));
}
function validStyle(value){
 const result={};if(/^#[0-9a-f]{6}$/i.test(value.color))result.color=value.color;
 if(attributeSymbols.includes(value.symbol))result.symbol=value.symbol;
 if(numeric(value.pointSize))result.pointSize=Math.max(4,Math.min(48,Number(value.pointSize)));
 return result;
}
const cache=new WeakMap();
export function attributeEvaluator(rules,fields){
 if(!rules||rules.mode==='single')return ()=>({});
 if(rules.mode==='expression'){
  const compiled=Object.entries(rules.expressions||{}).filter(([,v])=>String(v).trim()).map(([k,v])=>[k,compileExpression(v,fields)]);
  return props=>validStyle(Object.fromEntries(compiled.map(([k,fn])=>[k,fn(props)])));
 }
 const classes=rules.classes||[],byKey=new Map(classes.map(c=>[c.key,c]));
 return props=>{
  const value=props?.[rules.field];
  const match=rules.mode==='categorized'?byKey.get(categoryKey(value)):numeric(value)?classes.find((c,i)=>Number(value)>=c.min&&(Number(value)<c.max||(i===classes.length-1&&Number(value)<=c.max))):null;
  return match?validStyle(match):{};
 };
}
export function featureAppearance(layer,feature){
 const rules=layer.metadata?.style?.rules;if(!rules||!feature)return layer;
 let evaluate=cache.get(rules);if(!evaluate){try{evaluate=attributeEvaluator(rules,attributeFields(layer.fc));}catch{evaluate=()=>({});}cache.set(rules,evaluate);}
 const style=evaluate(feature.properties||{});
 return {...layer,color:style.color||layer.color,metadata:{...layer.metadata,style:{...layer.metadata?.style,...style}}};
}
