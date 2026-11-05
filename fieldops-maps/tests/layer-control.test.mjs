import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installLayerControl,legendContents} from '../src/layer-control.js';
function setup(edit=true){
 const dom=new JSDOM(`<aside id="sidebar"><div class="tabs"><span class="active">Layers <b id="layer-count">1</b></span></div><div id="layers"><article class="layer-card" data-id="one"><div class="layer-top"><span class="geometry-symbol"></span><div><strong>Survey</strong></div><button data-action="visibility"></button><button data-action="settings"></button><button data-action="zoom"></button></div><button data-action="geometry"></button><button data-layer-options="style"></button><button data-layer-options="organise"></button><button data-action="export"></button></article></div></aside>`);
 const doc=dom.window.document,layer={id:'one',name:'Survey',kind:'vector',color:'#12ab34',fc:{features:[{geometry:{type:'Point'}}]}};
 let busy=false;const ui=installLayerControl({getLayers:()=>[layer],canEdit:()=>edit,isBusy:()=>busy,doc});
 return {dom,doc,ui,layer,busy:value=>busy=value};
}
test('right-click and more menu invoke existing editing actions; Escape restores focus',()=>{
 const {dom,doc,ui}=setup();let clicked=0;doc.querySelector('[data-action=geometry]').onclick=()=>clicked++;
 const row=doc.querySelector('.layer-card');row.dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:50}));
 const menu=doc.querySelector('[role=menu]');assert.equal(menu.hidden,false);assert.equal(row.classList.contains('selected'),true);
 [...menu.querySelectorAll('button')].find(b=>b.textContent==='Edit geometry…').click();assert.equal(clicked,1);assert.equal(menu.hidden,true);
 doc.querySelector('.layer-more').click();menu.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(doc.activeElement.textContent,'Actions');menu.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(doc.activeElement.parentElement.open,true);menu.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(doc.activeElement,doc.querySelector('.layer-more'));
 ui.refresh();assert.equal(doc.querySelectorAll('.layer-more').length,1);dom.window.close();
});
test('read-only users cannot access edit actions; busy work prevents menu opening',()=>{
 const {dom,doc,busy}=setup(false);doc.querySelector('.layer-more').click();const menu=doc.querySelector('[role=menu]');assert.doesNotMatch(menu.textContent,/Edit|Style|Organise/);assert.match(menu.textContent,/Zoom to fit/);
 menu.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));busy(true);doc.querySelector('.layer-more').click();assert.equal(menu.hidden,true);dom.window.close();
});
test('tabs support keyboard navigation and category labels are escaped',()=>{
 const {dom,doc,layer}=setup();doc.querySelector('#layer-tab-list').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(doc.querySelector('#sidebar').dataset.layerView,'legend');assert.equal(doc.querySelector('#layer-tab-legend').getAttribute('aria-selected'),'true');
 layer.metadata={style:{rules:{mode:'categorized',field:'Type',classes:[{label:'<script>bad</script>',color:'#ff0000'}]}}};assert.match(legendContents(layer),/&lt;script&gt;/);assert.doesNotMatch(legendContents(layer),/<script>/);dom.window.close();
});
test('Focused layer shortcuts invoke copying and visibility, without intercepting text fields',async()=>{
 const {dom,doc,layer}=setup();dom.window.close();
 const d=new JSDOM('<aside id="sidebar"><div class="tabs"><span class="active"><b id="layer-count"></b></span></div><div id="layers"><article class="layer-card" data-id="one"><div class="layer-top"><span class="geometry-symbol"></span><strong>Survey</strong><button class="layer-visibility" data-action="visibility"></button></div><input></article></div></aside>');let copied=0,visible=true;installLayerControl({doc:d.window.document,getLayers:()=>[layer],canEdit:()=>true,isBusy:()=>false,onCopy:()=>copied++,onVisibility:(_l,value)=>visible=value});const row=d.window.document.querySelector('article');row.dispatchEvent(new d.window.KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true}));row.dispatchEvent(new d.window.KeyboardEvent('keydown',{key:'h',bubbles:true,cancelable:true}));await Promise.resolve();assert.equal(copied,1);assert.equal(visible,false);row.querySelector('input').dispatchEvent(new d.window.KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true}));await Promise.resolve();assert.equal(copied,1);d.window.close();
});
