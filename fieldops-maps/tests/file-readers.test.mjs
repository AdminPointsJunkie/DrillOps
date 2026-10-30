import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as XLSX from 'xlsx';
import {parquetWriteBuffer} from 'hyparquet-writer';
import {Encoder,Profile} from '@garmin/fitsdk';
import {readSpecial,readSequence,fitFeatures} from '../src/file-readers.js';
import {groupFiles,unsupportedReason} from '../src/import-formats.js';
import {safeArchivePath} from '../src/archive-files.js';
import {imageBounds} from '../src/image-import.js';
const feature={type:'Feature',properties:{name:'Collar'},geometry:{type:'Point',coordinates:[153,-27]}};
test('all sequence aliases preserve features and reject malformed records',async()=>{
 for(const ext of ['geojsonl','geojsons','geojsonseq','jsonl','ndjson']){const [item]=await readSpecial(new File(['\x1e'+JSON.stringify(feature)+'\n'+JSON.stringify(feature)],'collars.'+ext));assert.equal(item.fc.features.length,2);assert.deepEqual(item.fc.features[0],feature);}
 assert.throws(()=>readSequence('{}'),/not GeoJSON/);assert.throws(()=>readSequence('{'),/Invalid GeoJSON/);
});
test('Excel formats create one dataset per populated sheet and retain values',async()=>{
 for(const ext of ['xlsx','xls','xlsm','ods']){const book=XLSX.utils.book_new();for(const name of ['Collars','Access'])XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{name,longitude:153,latitude:-27}]),name);
 const bytes=XLSX.write(book,{type:'array',bookType:ext});const items=await readSpecial(new File([bytes],'survey.'+ext));assert.equal(items.length,2);assert.equal(items[1].layerName,'Access');assert.equal(items[0].rows[0].longitude,153);}
});
test('delimited formats detect columns without discarding text attributes',async()=>{
 for(const [ext,separator] of [['csv',','],['tsv','\t'],['psv','|'],['txt',';']]){const [item]=await readSpecial(new File([['name','longitude','latitude'].join(separator)+'\n'+['A','153','-27'].join(separator)],'points.'+ext));assert.deepEqual(item.fields,['name','longitude','latitude']);assert.equal(item.rows[0].name,'A');}
});
test('TCX imports actual XML track positions',async()=>{
 globalThis.DOMParser=new JSDOM().window.DOMParser;
 const xml='<TrainingCenterDatabase><Activities><Activity Sport="Biking"><Id>2026-01-01T00:00:00Z</Id><Lap><Track>'+[153,153.01].map(lon=>`<Trackpoint><Time>2026-01-01T00:00:00Z</Time><Position><LatitudeDegrees>-27</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position></Trackpoint>`).join('')+'</Track></Lap></Activity></Activities></TrainingCenterDatabase>';
 const [item]=await readSpecial(new File([xml],'track.tcx'));assert.equal(item.fc.features[0].geometry.type,'LineString');assert.equal(item.fc.features[0].geometry.coordinates[0][0],153);
});
test('FIT decoder reads binary positions and does not connect missing-GPS gaps',async()=>{
 const encoder=new Encoder();for(const lon of [153,153.01])encoder.onMesg(Profile.MesgNum.RECORD,{positionLat:Math.round(-27*2147483648/180),positionLong:Math.round(lon*2147483648/180)});
 const [item]=await readSpecial(new File([encoder.close()],'track.fit'));assert.equal(item.fc.features[0].geometry.type,'LineString');assert.ok(Math.abs(item.fc.features[0].geometry.coordinates[0][0]-153)<.000001);
 assert.throws(()=>fitFeatures({}),/no GPS/);assert.equal(fitFeatures({recordMesgs:[{positionLat:0,positionLong:0},{},{positionLat:1,positionLong:1}]}).features.length,2);
});
test('GeoParquet decodes WKB, attributes and explicit source CRS',async()=>{
 const wkb=new Uint8Array(21),view=new DataView(wkb.buffer);view.setUint8(0,1);view.setUint32(1,1,true);view.setFloat64(5,153,true);view.setFloat64(13,-27,true);
 const bytes=parquetWriteBuffer({columnData:[{name:'geometry',type:'BYTE_ARRAY',data:[wkb]},{name:'name',type:'STRING',data:['Collar']}],kvMetadata:[{key:'geo',value:JSON.stringify({version:'1.1.0',primary_column:'geometry',columns:{geometry:{encoding:'WKB',geometry_types:['Point']}}})}]});
 const [item]=await readSpecial(new File([bytes],'points.parquet'));assert.deepEqual(item.fc.features[0].geometry,feature.geometry);assert.equal(item.fc.features[0].properties.name,'Collar');assert.equal(item.source,'EPSG:4326');
});
test('sidecar grouping isolates same-name datasets in different folders',()=>{
 const files=['a/roads.shp','a/roads.dbf','a/roads.shx','b/roads.shp','b/roads.dbf','air.png','air.pgw'].map(name=>new File([],name));const groups=groupFiles(files);assert.deepEqual(groups.map(g=>g.map(f=>f.name)),[['a/roads.shp','a/roads.dbf','a/roads.shx'],['b/roads.shp','b/roads.dbf'],['air.png','air.pgw']]);
});
test('archive paths and unsupported project files fail explicitly',()=>{
 for(const path of ['../file','/file','C:/file','dir/__proto__/polluted'])assert.throws(()=>safeArchivePath(path),/unsafe/);
 assert.equal(safeArchivePath('data/roads.shp'),'data/roads.shp');assert.match(unsupportedReason('x.qgz'),/source data/);assert.match(unsupportedReason('x.gpi'),/not yet/);
});
test('image placement preserves centre and changes footprint on rotation',()=>{
 const a=imageBounds({lng:153,lat:-27,width:100,rotation:0},2),b=imageBounds({lng:153,lat:-27,width:100,rotation:90},2);assert.ok(Math.abs((a[0]+a[2])/2-153)<1e-9);assert.ok(a[2]-a[0]>b[2]-b[0]);assert.throws(()=>imageBounds({lng:0,lat:85,width:100},2),/valid location/);
});
test('VRT resolves local sources without making network requests and rejects executable functions',async()=>{
 const {prepareVRT}=await import('../src/vrt-import.js');const window=new JSDOM().window;globalThis.DOMParser=window.DOMParser;globalThis.XMLSerializer=window.XMLSerializer;
 const image=new File(['raster'],'image.tif'),vrt=new File(['<VRTDataset><VRTRasterBand><SimpleSource><SourceFilename>image.tif</SourceFilename></SimpleSource></VRTRasterBand></VRTDataset>'],'map.vrt');
 const files=await prepareVRT(vrt,[image]);assert.equal(files.length,2);assert.match(await files[0].text(),/vrt_source_0.tif/);assert.equal(await files[1].text(),'raster');
 await assert.rejects(()=>prepareVRT(new File(['<VRTDataset><PixelFunctionCode>bad</PixelFunctionCode></VRTDataset>'],'bad.vrt')),/pixel functions/);
 await assert.rejects(()=>prepareVRT(vrt,[]),/Include image.tif/);
});
test('table joins retain geometry and unmatched records, and reject ambiguous matches',async()=>{
 const {joinRows}=await import('../src/table-join.js');const fc={type:'FeatureCollection',features:[feature,{...feature,properties:{name:'Other'}}]};
 const result=joinRows(fc,[{name:'Collar',depth:100}],'name','name');assert.equal(result.matched,1);assert.equal(result.fc.features[0].properties.table_depth,100);assert.deepEqual(result.fc.features[1],fc.features[1]);assert.equal(fc.features[0].properties.table_depth,undefined);
 assert.throws(()=>joinRows(fc,[{name:'Collar'},{name:'Collar'}],'name','name'),/duplicate/);assert.throws(()=>joinRows(fc,[{name:'Unknown'}],'name','name'),/No matching/);
});
