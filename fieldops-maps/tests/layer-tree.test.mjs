import test from 'node:test';
import assert from 'node:assert/strict';
import {flattenTree,parentGroup,moveNode,normaliseTree} from '../src/layer-tree.js';
import {cachedConversion} from '../src/conversion-cache.js';
import {pointLabels} from '../src/point-labels.js';
import {JSDOM} from 'jsdom';

test('drag ordering across groups and root is deterministic and prevents nested groups',()=>{
 const tree=['points',{id:'survey',name:'Survey',children:['lines','boundary']},'imagery'];
 assert.equal(moveNode(tree,'imagery','points','before'),true);
 assert.deepEqual(flattenTree(tree),['imagery','points','lines','boundary']);
 moveNode(tree,'points','survey','inside');assert.equal(parentGroup(tree,'points').id,'survey');
 moveNode(tree,'boundary','lines','before');assert.deepEqual(flattenTree(tree),['imagery','boundary','lines','points']);
 moveNode(tree,'lines',null);assert.equal(parentGroup(tree,'lines'),undefined);
 const before=JSON.stringify(tree);assert.equal(moveNode(tree,'survey','points','before'),false);assert.equal(JSON.stringify(tree),before);
 moveNode(tree,'survey','imagery','before');assert.deepEqual(flattenTree(tree),['boundary','points','imagery','lines']);
 assert.deepEqual(flattenTree(normaliseTree([...tree,'lines'],['new'])),['boundary','points','imagery','lines','new']);
});

test('preview conversion is reused only when every coordinate option matches; failure remains retryable',async()=>{
 const item={},settings={crs:'EPSG:20355',x:'E',y:'N'},data={fc:{features:[]}};let calls=0;
 const convert=async()=>{calls++;return data;};
 assert.equal(await cachedConversion(item,settings,convert),data);assert.equal(await cachedConversion(item,{...settings},convert),data);assert.equal(calls,1);
 await cachedConversion(item,{...settings,x:'Easting'},convert);assert.equal(calls,2);
 await assert.rejects(cachedConversion(item,{...settings,crs:'invalid'},async()=>{throw Error('bad CRS');}));
 await cachedConversion(item,settings,convert);assert.equal(calls,3);
});

test('CSV labels use text, respect viewport and cap, and can be turned off',()=>{
 const dom=new JSDOM(),markers=Array.from({length:4},(_,i)=>({feature:{properties:{id:i===0?'<script>unsafe</script>':i}},
  getLatLng:()=>i,getTooltip(){return this.tooltip;},bindTooltip(text,options){this.tooltip={text,options};},unbindTooltip(){this.tooltip=null;}}));
 const layer={eachLayer:fn=>markers.forEach(fn)},item={_pane:'points',metadata:{style:{labelField:'id'}}};
 assert.equal(pointLabels(layer,item,{contains:i=>i<3},dom.window.document,2),2);
 assert.equal(markers[0].tooltip.text.innerHTML,'&lt;script&gt;unsafe&lt;/script&gt;');assert.equal(markers[0].tooltip.options.pane,'points');assert.equal(markers[2].tooltip,null);
 item.metadata.style.labelField='';pointLabels(layer,item,{contains:()=>true},dom.window.document);assert.ok(markers.every(m=>!m.tooltip));dom.window.close();
});
