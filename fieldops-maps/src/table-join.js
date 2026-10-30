export function joinRows(fc,rows,featureKey,rowKey,prefix='table_'){
 const index=new Map();for(const row of rows){const key=String(row[rowKey]??'').trim();if(!key)continue;if(index.has(key))throw Error(`The table contains duplicate join value "${key}". Choose a unique column.`);index.set(key,row);}
 let matched=0;const features=fc.features.map(feature=>{const row=index.get(String(feature.properties?.[featureKey]??'').trim());if(!row)return structuredClone(feature);matched++;const properties={...feature.properties};for(const [key,value] of Object.entries(row)){const name=prefix+key;if(Object.hasOwn(properties,name))throw Error(`The field "${name}" already exists. Rename the source column before joining.`);properties[name]=value;}return {...structuredClone(feature),properties};});
 if(!matched)throw Error('No matching records were found. Check the join columns.');return {fc:{type:'FeatureCollection',features},matched};
}
