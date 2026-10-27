import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
await mkdir('public',{recursive:true});
await writeFile('public/gdal-engine.bin',gzipSync(await readFile('node_modules/gdal3.js/dist/package/gdal3WebAssembly.wasm'),{level:9}));
await writeFile('public/GDAL-LICENSE.txt',await readFile('node_modules/gdal3.js/LICENSE'));
// Upstream locateFile prefixes blob URLs with '/', so permit browser-created WASM URLs.
const worker=await readFile('node_modules/gdal3.js/dist/package/gdal3.js','utf8');
const needle='u||"http"===t.substring(0,4)||"/"===t[0]';
if(!worker.includes(needle))throw Error('GDAL worker changed: review blob URL patch.');
await writeFile('public/gdal-worker.js',worker.replace(needle,'u||"http"===t.substring(0,4)||"blob:"===t.substring(0,5)||"/"===t[0]'));
