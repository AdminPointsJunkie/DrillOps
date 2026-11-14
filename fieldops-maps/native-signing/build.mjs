import {build} from 'esbuild';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
if(!process.argv[2])throw Error('Pass the native app Signing directory as the output directory.');
await build({entryPoints:[fileURLToPath(new URL('./entry.js',import.meta.url))],bundle:true,platform:'browser',format:'iife',target:'safari17',outfile:resolve(process.argv[2],'DocumentSigning.js')});
