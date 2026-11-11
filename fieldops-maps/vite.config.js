import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({base:'/maps/',worker:{format:'es'},build:{chunkSizeWarningLimit:650,rollupOptions:{input:{share:fileURLToPath(new URL('./share.html',import.meta.url)),cloudRedirect:fileURLToPath(new URL('./cloud-redirect.html',import.meta.url)),maps:fileURLToPath(new URL('./index.html',import.meta.url)),setup:fileURLToPath(new URL('./setup.html',import.meta.url))}}}});
