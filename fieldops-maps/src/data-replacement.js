import {attributeFields} from './attribute-style.js';
import {geometryKinds} from './layer-style.js';
export function replacementSummary(old,next){
 if(old.kind!=='vector'||next.kind!=='vector')throw Error('Replace data requires a vector dataset.');
 const a=[...geometryKinds(old.fc)].sort().join(','),b=[...geometryKinds(next.fc)].sort().join(',');
 if(a!==b)throw Error('The replacement must contain the same geometry types as this layer.');
 const before=attributeFields(old.fc),after=attributeFields(next.fc),removed=before.filter(f=>!after.includes(f)),added=after.filter(f=>!before.includes(f));
 const refs=new Set(),s=old.metadata?.style||{};
 if(s.rules?.field)refs.add(s.rules.field);if(s.labelField)refs.add(s.labelField);
 for(const expr of Object.values(s.rules?.expressions||{}))for(const m of String(expr).matchAll(/\[([^\]]+)\]/g))refs.add(m[1]);
 for(const f of before)if(JSON.stringify(s.view||{}).includes(JSON.stringify(f))||JSON.stringify(s.popup||{}).includes(JSON.stringify(f)))refs.add(f);
 return {before:old.fc.features.length,after:next.fc.features.length,removed,added,missing:[...refs].filter(f=>!after.includes(f)),attachments:old.fc.features.filter(f=>f.properties?._fieldmaps_files?.length).length};
}
export function reuseImportSettings(layer,item){
 const r={selectedCRS:item.source||layer.source_crs||'EPSG:4326',selectedLabel:item.source||layer.crsLabel||'EPSG:4326',custom:'',epoch:'',pipeline:'',gcps:'',...layer.metadata?.import_settings,name:layer.name,vertical:layer.vertical_datum||'Unknown'};
 if(item.fields){if(!item.fields.includes(r.x))delete r.x;if(!item.fields.includes(r.y))delete r.y;}
 return r;
}
export function matchReplacementFeatures(old,next,key){
 const features=structuredClone(next.fc.features);if(!key)return features;
 const index=new Map();for(const f of old.fc.features){const value=f.properties?.[key];if(value==null||value===''||index.has(String(value)))throw Error('The matching column must be filled and unique in the existing data.');index.set(String(value),f);}
 const seen=new Set();for(const f of features){const value=f.properties?.[key];if(value==null||value===''||seen.has(String(value)))throw Error('The matching column must be filled and unique in the new data.');seen.add(String(value));const previous=index.get(String(value));if(previous){for(const [k,v] of Object.entries(previous.properties||{}))if(k.startsWith('_fieldmaps_'))f.properties[k]=structuredClone(v);}}
 return features;
}
