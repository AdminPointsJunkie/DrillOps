export const numberValue=v=>v===null||v===undefined||typeof v==='boolean'||String(v).trim()===''?NaN:Number(v);
export function componentData(features,{type,field,value,aggregate='count',bins=10}){
 const rows=features.map(f=>f.properties||{}),numbers=rows.map(r=>numberValue(r[value||field])).filter(Number.isFinite);
 const reduce=values=>aggregate==='count'?values.length:aggregate==='sum'?values.reduce((a,b)=>a+b,0):aggregate==='min'?values.reduce((a,b)=>Math.min(a,b),Infinity):aggregate==='max'?values.reduce((a,b)=>Math.max(a,b),-Infinity):values.reduce((a,b)=>a+b,0)/values.length;
 if(type==='statistic')return {value:aggregate==='count'?rows.length:numbers.length?reduce(numbers):null,valid:numbers.length};
 if(type==='histogram'){
  if(!numbers.length)return [];const min=numbers.reduce((a,b)=>Math.min(a,b),Infinity),max=numbers.reduce((a,b)=>Math.max(a,b),-Infinity),count=Math.max(1,Math.min(50,Math.floor(bins)||10)),step=max===min?1:(max-min)/count,result=Array.from({length:max===min?1:count},(_,i)=>({label:`${(min+i*step).toPrecision(4)} – ${(min+(i+1)*step).toPrecision(4)}`,x:min+i*step,y:0}));for(const n of numbers)result[Math.min(result.length-1,Math.floor((n-min)/step))].y++;return result;
 }
 const grouped=new Map();for(const row of rows){let key=row[field];if(key===null||key===undefined||key==='')continue;if(type==='time'){const timestamp=Date.parse(String(key));if(!Number.isFinite(timestamp))continue;key=new Date(timestamp).toISOString().slice(0,10);}else if(type==='line'){key=numberValue(key);if(!Number.isFinite(key))continue;}else key=String(key);const n=numberValue(row[value]);if(aggregate!=='count'&&!Number.isFinite(n))continue;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(aggregate==='count'?1:n);}
 return [...grouped].map(([key,values])=>({label:String(key),x:type==='time'?Date.parse(key):type==='line'?key:0,y:reduce(values)})).sort(type==='time'||type==='line'?(a,b)=>a.x-b.x:(a,b)=>b.y-a.y||a.label.localeCompare(b.label));
}
export function componentMatches(feature,configs){return configs.every(c=>{const v=feature.properties?.[c.field];if(c.type==='slider')return c.threshold==null||numberValue(v)>=c.threshold;return !c.selected?.length||c.selected.includes(String(v??''));});}
