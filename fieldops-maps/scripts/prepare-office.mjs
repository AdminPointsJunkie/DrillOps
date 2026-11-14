import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const root='node_modules/@matbee/libreoffice-converter',target='public/office/runtime-2.7.2-fm3';
await mkdir(target,{recursive:true});
await copyFile(`${root}/wasm/soffice.worker.js`,`${target}/soffice.worker.js`);
// Browser initialization can require a fifth pthread before its event loop resumes.
// Pre-create enough workers so synchronous LibreOfficeKit initialization cannot deadlock.
let glue=await readFile(`${root}/wasm/soffice.js`,'utf8');
const pool='var pthreadPoolSize=4;';
if(glue.split(pool).length!==2)throw Error('Review upstream LibreOffice pthread pool before updating.');
await writeFile(`${target}/soffice.js`,glue.replace(pool,'var pthreadPoolSize=8;'));
await copyFile(`${root}/dist/browser.js`,`${target}/browser.js`);
let worker=await readFile(`${root}/dist/browser.worker.global.js`,'utf8');
// Initialize LibreOfficeKit only. Running the standalone main() simultaneously
// competes for its global lock and stalls browser font scanning (upstream PR #21).
const startup='self.Module={mainScriptUrlOrBlob:';
if(worker.split(startup).length!==2)throw Error('Review upstream LibreOffice startup before updating.');
worker=worker.replace(startup,'self.Module={noInitialRun:true,mainScriptUrlOrBlob:');
// Upstream enables every LibreOffice diagnostic even with verbose:false.
// Keep production conversion quiet; tracing every font/file call is expensive.
if(!worker.includes('a.ENV.SAL_LOG="+ALL"'))throw Error('Review LibreOffice logging configuration.');
worker=worker.replace('a.ENV.SAL_LOG="+ALL"','a.ENV.SAL_LOG="-ALL"');
await writeFile(`${target}/browser.worker.global.js`,worker);
const manifest={version:'2.7.2',files:[]};
for(const name of ['soffice.wasm','soffice.data']){
 const source=await readFile(`${root}/wasm/${name}`),compressed=gzipSync(source,{level:9});
 await writeFile(`${target}/${name}.gz.bin`,compressed);manifest.files.push({name,size:source.length,compressedSize:compressed.length});
 console.log(`${name}: ${(compressed.length/1048576).toFixed(1)} MiB download`);
}
await writeFile(`${target}/manifest.json`,JSON.stringify(manifest));
