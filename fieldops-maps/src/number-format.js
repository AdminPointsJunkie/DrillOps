export function formatNumber(value,settings){
 if(!settings)return value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
 if(value==null||String(value).trim()===''||typeof value==='boolean')return value==null?'':String(value);
 const n=Number(value);if(!Number.isFinite(n))return String(value);
 const decimals=Math.max(0,Math.min(10,Math.floor(Number(settings.decimals)||0)));
 const text=new Intl.NumberFormat('en-AU',{style:settings.percent?'percent':'decimal',useGrouping:settings.grouping!==false,minimumFractionDigits:settings.trimZeros?0:decimals,maximumFractionDigits:decimals,notation:settings.compact?'compact':'standard'}).format(n);
 return (settings.prefix||'')+text+(settings.suffix||'');
}
export const formatField=(layer,field,value)=>formatNumber(value,layer?.metadata?.style?.numberFormats?.[field]);
