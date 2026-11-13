import test from 'node:test';import assert from 'node:assert/strict';import {installProjGrid} from '../src/proj-grid.js';
import {createRequire} from 'node:module';import {mkdtemp,copyFile,writeFile,unlink,rmdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const name='au_icsm_National_84_02_07_01.tif';
test('grid stays mounted across external opens and is excluded from imported datasets',async()=>{
 const calls=[],closed=[],grid={name};const engine={async open(files,opts,vfs){calls.push({files,opts,vfs});return {datasets:(Array.isArray(files)?files:[files]).map(f=>({path:f.name||f})),errors:[]}},async close(ds){closed.push(ds.path)}};
 installProjGrid(engine,grid);const result=await engine.open({name:'a.geojson'});assert.deepEqual(result.datasets,[{path:'a.geojson'}]);assert.deepEqual(closed,[name]);
 await engine.open('/output/a.geojson');assert.equal(calls.at(-1).files,'/output/a.geojson');
 await engine.open({name:'a.zip'},[],['vsizip']);assert.deepEqual(calls.at(-1).files,['/input/a.zip']);assert.deepEqual(calls.at(-1).vfs,['vsizip']);
 await assert.rejects(engine.open({name}),/reserved/);
});
test('bundled grid enables exact AGD84 transformation and ZIP imports through the real GDAL engine',async()=>{
 const dir=(await mkdtemp(path.join(os.tmpdir(),'fieldmaps-grid-test-'))).replaceAll('\\','/');
 await copyFile(new URL('../public/proj/'+name,import.meta.url),dir+'/'+name);await copyFile(new URL('./fixtures/survey.zip',import.meta.url),dir+'/survey.zip');
 await writeFile(dir+'/point.geojson',JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{id:'test'},geometry:{type:'Point',coordinates:[620012.9,7595939]}}]}));
 try{
 const G=await createRequire(import.meta.url)('gdal3.js/node')({env:{PROJ_DATA:'/usr/share/proj:/input',PROJ_ONLY_BEST_DEFAULT:'YES',PROJ_NETWORK:'OFF'}});
 // Adapt browser File names to a common NODEFS directory; exercise the same mount wrapper.
 const open=G.open.bind(G);G.open=(files,options,vfs)=>open((Array.isArray(files)?files:[files]).map(f=>typeof f==='string'?f:dir+'/'+f.name),options,vfs);installProjGrid(G,{name});
 const points=await G.open({name:'point.geojson'});assert.equal(points.datasets.length,1);
 const out=await G.ogr2ogr(points.datasets[0],['-f','GeoJSON','-s_srs','EPSG:20355','-t_srs','EPSG:4326','-lco','RFC7946=YES'],'grid_test');const fc=JSON.parse(new TextDecoder().decode(await G.getFileBytes(out)));const c=fc.features[0].geometry.coordinates;assert.ok(c[0]>148&&c[0]<149&&c[1]>-22&&c[1]<-21);await G.close(points.datasets[0]);
 const zip=await G.open({name:'survey.zip'},[],['vsizip']);assert.equal(zip.datasets.length,1);assert.equal(zip.datasets[0].type,'vector');await G.close(zip.datasets[0]);
 }finally{for(const file of [name,'survey.zip','point.geojson'])await unlink(dir+'/'+file);await rmdir(dir);}
});
