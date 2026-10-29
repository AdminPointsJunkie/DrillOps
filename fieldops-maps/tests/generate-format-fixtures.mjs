import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import * as XLSX from 'xlsx';
import {zipSync} from 'fflate';
const require=createRequire(import.meta.url),G=await require('gdal3.js/node')();
const directory=new URL('./fixtures/formats/',import.meta.url);await mkdir(directory,{recursive:true});
const source=(await G.open(process.cwd()+'/tests/fixtures/points.geojson')).datasets[0];
for(const [format,name,opts] of [['GPKG','points.gpkg',[]],['GPX','points.gpx',['-dsco','GPX_USE_EXTENSIONS=YES']],['OpenFileGDB','points.gdb',[]]]){
 const out=await G.ogr2ogr(source,['-f',format,...opts],name);
 if(format==='OpenFileGDB'){const contents={};for(const f of await G.getOutputFiles())if(f.path.includes('.gdb/'))contents['points.gdb/'+f.path.split('/').at(-1)]=await G.getFileBytes(f.path);await writeFile(new URL('points.gdb.zip',directory),zipSync(contents));}
 else await writeFile(new URL(name,directory),await G.getFileBytes(out));
}
await writeFile(new URL('points.osm',directory),'<osm version="0.6" generator="FieldMaps test"><node id="1" lat="-27" lon="153"><tag k="name" v="Collar"/><tag k="amenity" v="survey_point"/></node></osm>');
await writeFile(new URL('grid.asc',directory),'ncols 2\nnrows 2\nxllcorner 153\nyllcorner -27\ncellsize 0.001\nNODATA_value -9999\n1 2\n3 4\n');
await writeFile(new URL('grid.xyz',directory),'153 -27 1\n153.001 -27 2\n153 -27.001 3\n153.001 -27.001 4\n');
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{longitude:153,latitude:-27,name:'Collar'}]),'Collars');
for(const type of ['xlsx','xls','xlsm'])await writeFile(new URL('points.'+type,directory),XLSX.write(book,{type:'buffer',bookType:type}));
console.log('Format fixtures generated.');

const {default:numbers}=await import('xlsx/dist/xlsx.zahl.mjs');await writeFile(new URL('points.numbers',directory),XLSX.write(book,{type:'buffer',bookType:'numbers',numbers}));
