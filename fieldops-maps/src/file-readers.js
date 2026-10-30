import Papa from 'papaparse';
export const ROW_LIMIT=20000;
const stem=name=>name.replace(/\.[^.]+$/,'');
const collection=features=>({type:'FeatureCollection',features});
export function jsonSafe(value){return JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));}
export function readSequence(text){
 const features=[];
 for(const [i,line] of text.replace(/^\uFEFF/,'').split(/[\r\n\x1e]+/).entries()){
  if(!line.trim())continue;
  let value;try{value=JSON.parse(line);}catch{throw Error(`Invalid GeoJSON record at line ${i+1}.`);}
  if(value.type==='FeatureCollection')features.push(...value.features);
  else if(value.type==='Feature')features.push(value);
  else if(value.type&&('coordinates' in value||value.type==='GeometryCollection'))features.push({type:'Feature',properties:{},geometry:value});
  else throw Error(`Record ${i+1} is not GeoJSON.`);
  if(features.length>ROW_LIMIT)throw Error('Split this file into layers of at most 20,000 features.');
 }
 if(!features.length)throw Error('The GeoJSON sequence contains no features.');
 return collection(features);
}
export function tableItem(name,rows,files,format,layerName){
 if(!rows.length)throw Error(`${name} contains no data rows.`);
 if(rows.length>ROW_LIMIT)throw Error(`${name}: split this table into at most 20,000 rows per sheet.`);
 const fields=[...new Set(rows.flatMap(Object.keys))];
 if(!fields.length)throw Error(`${name} contains no column headings.`);
 return {name,kind:'vector',format,files,rows:jsonSafe(rows),fields,layerName,source:'',count:rows.length};
}
export function fitFeatures(messages){
 const position=r=>Number.isFinite(r.positionLong)&&Number.isFinite(r.positionLat)&&Math.abs(r.positionLat)<=1073741824&&Math.abs(r.positionLong)<=2147483648?[r.positionLong*180/2147483648,r.positionLat*180/2147483648]:null;
 const features=[],segments=[];let segment=[];
 for(const r of messages.recordMesgs||[]){const c=position(r);if(c)segment.push(c);else if(segment.length){segments.push(segment);segment=[];}}
 if(segment.length)segments.push(segment);
 for(const coordinates of segments)features.push({type:'Feature',properties:{name:'Track'},geometry:coordinates.length===1?{type:'Point',coordinates:coordinates[0]}:{type:'LineString',coordinates}});
 for(const r of [...messages.coursePointMesgs||[],...messages.locationMesgs||[]]){const c=position(r);if(c)features.push({type:'Feature',properties:jsonSafe(r),geometry:{type:'Point',coordinates:c}});}
 if(!features.length)throw Error('This FIT file has no GPS positions. Indoor activities cannot be placed on a map.');
 return collection(features);
}
export async function readSpecial(file,files=[file]){
 const ext=file.name.split('.').at(-1).toLowerCase(),name=stem(file.name);
 const vector=(fc,format,source='EPSG:4326')=>[{name,kind:'vector',format,files,fc,source,count:fc.features.length}];
 if(['geojsonl','geojsons','geojsonseq','ndjson','jsonl'].includes(ext))return vector(readSequence(await file.text()),'GeoJSONSeq');
 if(['csv','tsv','psv','txt'].includes(ext)){
  const delimiter=ext==='tsv'?'\t':ext==='psv'?'|':'';
  const parsed=Papa.parse(await file.text(),{header:true,skipEmptyLines:'greedy',delimiter});
  if(parsed.errors.length)throw Error(parsed.errors[0].message);
  return [tableItem(name,parsed.data,files,ext.toUpperCase())];
 }
 if(['xlsx','xls','xlsm','numbers','ods'].includes(ext)){
  const XLSX=await import('xlsx');const book=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,sheetRows:ROW_LIMIT+2});
  const items=[];
  for(const sheetName of book.SheetNames){const sheet=book.Sheets[sheetName];if(!sheet['!ref'])continue;
   const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);if(range.e.r-range.s.r>ROW_LIMIT)throw Error(`${sheetName}: split this sheet into at most 20,000 rows.`);
   const rows=XLSX.utils.sheet_to_json(sheet,{defval:null});if(!rows.length)continue;
   items.push(tableItem(book.SheetNames.length>1?`${name} — ${sheetName}`:name,rows,files,ext.toUpperCase(),sheetName));
  }
  if(!items.length)throw Error('This workbook contains no data rows.');return items;
 }
 if(ext==='tcx'){
  const {tcx}=await import('@tmcw/togeojson');const doc=new DOMParser().parseFromString(await file.text(),'application/xml');
  if(doc.querySelector('parsererror'))throw Error('Invalid TCX XML.');const fc=tcx(doc);if(!fc.features.length)throw Error('This TCX file has no GPS positions.');return vector(fc,'TCX');
 }
 if(ext==='fit'){
  const {Decoder,Stream}=await import('@garmin/fitsdk');const decoder=new Decoder(Stream.fromArrayBuffer(await file.arrayBuffer()));
  if(!decoder.isFIT()||!decoder.checkIntegrity())throw Error('Invalid or damaged FIT file.');
  const {messages,errors}=decoder.read();if(errors.length)throw Error(`Could not decode FIT: ${errors[0]}`);return vector(fitFeatures(messages),'FIT');
 }
 if(ext==='parquet'){
  const {parquetMetadataAsync,parquetReadObjects}=await import('hyparquet');const {compressors}=await import('hyparquet-compressors');
  const buffer={byteLength:file.size,slice:(start,end)=>file.slice(start,end).arrayBuffer()};const metadata=await parquetMetadataAsync(buffer);
  if(Number(metadata.num_rows)>ROW_LIMIT)throw Error('Split this GeoParquet file into at most 20,000 rows.');
  const entry=metadata.key_value_metadata?.find(v=>v.key==='geo');const geo=entry?JSON.parse(entry.value):null;
  const column=geo?.primary_column||metadata.schema.find(s=>['GEOMETRY','GEOGRAPHY'].includes(s.logical_type?.type))?.name;
  if(!column)throw Error('This Parquet file has no GeoParquet geometry metadata. Export as GeoParquet with a geometry column.');
  const columnMeta=geo?.columns?.[column];if(columnMeta?.encoding&&columnMeta.encoding!=='WKB')throw Error('Export GeoParquet using WKB geometry encoding.');
  const rows=await parquetReadObjects({file:buffer,metadata,compressors});
  const features=rows.map(row=>{const {[column]:geometry,...properties}=row;if(geometry!==null&&(!geometry||typeof geometry.type!=='string'))throw Error('Could not decode GeoParquet geometry.');return {type:'Feature',geometry,properties:jsonSafe(properties)};});
  const crs=columnMeta?.crs;const logical=metadata.schema.find(s=>s.name===column)?.logical_type;
  const source=crs?JSON.stringify(crs):crs===null?'':logical?.crs||'EPSG:4326';
  return vector(collection(features),'GeoParquet',source);
 }
 return null;
}
