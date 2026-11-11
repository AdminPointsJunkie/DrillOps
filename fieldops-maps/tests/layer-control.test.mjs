import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installLayerControl,legendContents} from '../src/layer-control.js';
function setup(edit=true,canShowList=()=>true){
 const dom=new JSDOM(`<aside id="sidebar"><div class="tabs"><span class="active">Layers <b id="layer-count">1</b></span></div><div id="layers"><article class="layer-card" data-id="one"><div class="layer-top"><span class="geometry-symbol"></span><div><strong>Survey</strong></div><button data-action="visibility"></button><button data-action="settings"></button><button data-action="zoom"></button></div><button data-action="geometry"></button><button data-layer-options="style"></button><button data-layer-options="organise"></button><button data-action="export"></button></article></div></aside>`);
 const doc=dom.window.document,layer={id:'one',name:'Survey',kind:'vector',color:'#12ab34',fc:{features:[{geometry:{type:'Point'}}]}};
 let busy=false;const ui=installLayerControl({getLayers:()=>[layer],canEdit:()=>edit,canShowList,isBusy:()=>busy,doc});
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
test('clicking row or symbol opens editor once; settings fallback and permission guards work',()=>{
 const {dom,doc,layer,busy}=setup();const card=doc.querySelector('.layer-card'),style=card.querySelector('[data-layer-options=style]'),panel=doc.createElement('section');panel.dataset.layerPanel='style';panel.hidden=true;card.append(panel);let opens=0,settings=0;style.onclick=()=>{opens++;panel.hidden=false;};
 card.querySelector('.geometry-symbol').click();card.querySelector('.layer-top strong').click();assert.equal(panel.hidden,false);assert.equal(style.getAttribute('aria-expanded'),'true');panel.hidden=true;card.querySelector('.layer-key').click();assert.equal(panel.hidden,false);
 card.querySelector('[data-action=settings]').onclick=()=>settings++;style.remove();layer.kind='raster';card.querySelector('.layer-top').click();assert.equal(settings,1);
 busy(true);card.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(settings,1);dom.window.close();
 const read=setup(false);let count=0;read.doc.querySelector('[data-layer-options=style]').onclick=()=>count++;read.doc.querySelector('.layer-card').dispatchEvent(new read.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(count,0);read.dom.window.close();
});

test('view mode forces legend and prevents List keyboard access; editing restores tabs',()=>{
 let editing=false;const {dom,doc,ui}=setup(true,()=>editing),sidebar=doc.querySelector('#sidebar'),list=doc.querySelector('#layer-tab-list'),legend=doc.querySelector('#layer-tab-legend');
 assert.equal(sidebar.dataset.layerView,'legend');assert.equal(list.hidden,true);assert.equal(list.disabled,true);
 legend.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(sidebar.dataset.layerView,'legend');assert.equal(doc.activeElement,legend);
 editing=true;ui.refresh();assert.equal(list.hidden,false);assert.equal(list.disabled,false);assert.equal(sidebar.dataset.layerView,'list');
 editing=false;ui.refresh();assert.equal(sidebar.dataset.layerView,'legend');assert.equal(list.hidden,true);
 editing=true;ui.refresh();legend.click();editing=false;ui.refresh();editing=true;ui.refresh();assert.equal(sidebar.dataset.layerView,'legend');dom.window.close();
});
