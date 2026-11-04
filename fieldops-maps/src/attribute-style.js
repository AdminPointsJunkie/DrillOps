import {compileExpression} from './style-expression.js';
export const attributeSymbols=['circle','square','triangle','diamond','cross'];
export const attributeFields=fc=>[...new Set((fc?.features||[]).flatMap(f=>Object.keys(f.properties||{})))].filter(key=>!key.startsWith('_fieldmaps_'));
export const stylePalettes={categorical:['#147d72','#c17d28','#6c61aa','#ce6359','#3087ba','#ad397d','#638c30','#805443'],green:['#e5f5e0','#a1d99b','#74c476','#31a354','#006d2c'],blue:['#eff3ff','#bdd7e7','#6baed6','#3182bd','#08519c'],heat:['#ffffb2','#fecc5c','#fd8d3c','#f03b20','#bd0026']};
const palette=['#147d72','#c17d28','#6c61aa','#ce6359','#3087ba','#ad397d','#638c30','#805443'];
const numeric=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v));
export const categoryKey=v=>v===null||v===undefined?'null':`${typeof v}:${String(v)}`;
export function classifyFeatures(fc,field,mode,count=5,method='equal',paletteName='categorical'){
 const values=(fc?.features||[]).map(f=>f.properties?.[field]);
 const colors=stylePalettes[paletteName]||palette;
 const style=(i,total=count)=>({color:colors[paletteName==='categorical'?i%colors.length:Math.round(i*(colors.length-1)/Math.max(1,total-1))],symbol:'circle',pointSize:12});
 if(mode==='categorized'){
  const distinct=new Map();for(const v of values){const key=categoryKey(v);if(!distinct.has(key))distinct.set(key,v);if(distinct.size>100)throw new Error('More than 100 unique values. Choose a different column or numeric ranges.');}
  return [...distinct].map(([key,v],i)=>({key,label:v===null||v===undefined?'(missing)':v===''?'(empty)':String(v),...style(i,distinct.size)}));
 }
 if(mode!=='graduated')throw new Error('Choose categories or numeric ranges.');
 const numbers=values.filter(numeric).map(Number);if(!numbers.length)throw new Error('This column has no numeric values.');
 let min=Infinity,max=-Infinity;for(const n of numbers){min=Math.min(min,n);max=Math.max(max,n);}
 count=Math.max(2,Math.min(12,Math.round(Number(count)||5)));if(min===max)count=1;
 if(method==='quantile'){
  numbers.sort((a,b)=>a-b);const breaks=[min];for(let i=1;i<count;i++){const at=Math.min(numbers.length-2,Math.ceil(i*numbers.length/count)-1);if(at<0||numbers[at]===numbers[at+1])continue;const value=numbers[at]/2+numbers[at+1]/2;if(value>breaks.at(-1)&&value<max)breaks.push(value);}breaks.push(max);
  return breaks.slice(0,-1).map((value,i)=>({min:value,max:breaks[i+1],...style(i,breaks.length-1)}));
 }
 if(method!=='equal')throw Error('Choose equal intervals or quantiles.');
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
