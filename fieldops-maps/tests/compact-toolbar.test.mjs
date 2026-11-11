import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {build} from 'esbuild';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const temporary=await mkdtemp(join(tmpdir(),'fieldmaps-toolbar-')),bundle=join(temporary,'toolbar.mjs');await build({entryPoints:[fileURLToPath(new URL('../src/compact-toolbar.js',import.meta.url))],bundle:true,platform:'node',format:'esm',loader:{'.css':'empty'},outfile:bundle});const {configureToolbarIcons,shortcutGuide}=await import(pathToFileURL(bundle));
test('original categories stay visible and toolbar actions use accessible icons',()=>{
 const dom=new JSDOM('<header><div class="toolbar-menus"><button id="open-table" class="square">Table</button><button id="open-search" class="square">Search</button><button id="copy-map-data" hidden>Download map data</button><details class="tool-menu"><summary aria-label="Annotations"><svg></svg></summary><div class="tool-menu-content"><button id="pin">Pin</button></div></details><details class="tool-menu"><summary aria-label="Analysis"><svg></svg></summary><div class="tool-menu-content"><button id="buffer">Buffer</button></div></details><details class="tool-menu"><summary aria-label="Upload"><svg></svg></summary><div class="tool-menu-content"><button id="upload">Upload files</button></div></details><details class="tool-menu"><summary aria-label="Components"><svg></svg></summary><div class="tool-menu-content"><button id="components">Components</button></div></details></div></header><nav class="map-navigation"><button id="help">Import help</button></nav>');
 globalThis.document=dom.window.document;
 const toolbar=document.querySelector('.toolbar-menus'),original=[...toolbar.children].filter(b=>b.id!=='open-search');
 const table=document.getElementById('open-table');let clicks=0;table.onclick=()=>clicks++;
 configureToolbarIcons();
 assert.deepEqual([...toolbar.children],original);
 assert.equal(document.querySelector('.toolbar-more'),null);
 assert.equal(toolbar.classList.contains('compact-toolbar'),false);
 assert.equal(toolbar.querySelectorAll(':scope > .tool-menu').length,4);
 for(const action of [table,document.getElementById('open-search')]){
  assert.equal(action.textContent.trim(),'');assert.ok(action.querySelector('svg'));assert.ok(action.getAttribute('aria-label'));assert.ok(action.title);assert.equal(action.parentElement,action.id==='open-search'?document.querySelector('.map-navigation'):toolbar);
 }
 assert.equal(document.getElementById('help').hidden,true);assert.equal(document.getElementById('help').style.display,'none');
 table.click();assert.equal(clicks,1);
 assert.equal(document.getElementById('copy-map-data').hidden,true);
 assert.equal(document.getElementById('open-search').getAttribute('aria-keyshortcuts'),'Meta+f Control+f /');
 configureToolbarIcons();assert.deepEqual([...toolbar.children],original);assert.equal(table.querySelectorAll('svg').length,1);
 dom.window.close();
});
test('guide covers Mac and Windows save, search and new photo shortcuts',()=>{assert.deepEqual(shortcutGuide.find(x=>x[0]==='Save draft'),['Save draft','⌘ S','Ctrl S']);assert.ok(shortcutGuide.find(x=>x[0].startsWith('Photo locations')&&x[1]==='P'&&x[2]==='P'));assert.ok(shortcutGuide.every(row=>row.length===3&&row.every(Boolean)));});
