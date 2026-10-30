import test from 'node:test';
import assert from 'node:assert/strict';
import {standardPage,resizePage,exportSize,imageExportSize,tokens,moveItem} from '../src/print-model.js';
const context={title:'Exploration map',description:'Current plan',center:[-27,153],zoom:12,layers:[{id:'one'}]};
test('standard layout includes linked map, legend and locator with printable furniture',()=>{const page=standardPage(context),map=page.items.find(i=>i.type==='map');assert.equal(map.north,true);assert.equal(map.scale,true);for(const item of page.items.filter(i=>['legend','locator'].includes(i.type)))assert.equal(item.target,map.id);assert.deepEqual(map.layers,['one']);});
test('changing paper size scales all items; movement and resize stay on page',()=>{const page=standardPage(context),item=page.items[0],before=item.w;resizePage(page,594,420);assert.equal(item.w,before*2);moveItem(item,-1000,-1000,page);assert.equal(item.x,0);assert.equal(item.y,0);moveItem(item,10000,10000,page,true);assert.equal(item.w,page.width);assert.equal(item.h,page.height);});
test('large posters respect pixel and memory ceilings without silently promising requested DPI',()=>{const dimensions=exportSize(2540,2540,600);assert.ok(dimensions.width<=16384);assert.ok(dimensions.width*dimensions.height<=32000000);assert.equal(dimensions.reduced,true);assert.throws(()=>exportSize(2541,300,300));assert.equal(exportSize(210,297,150).reduced,false);});
test('quick export preserves selected aspect ratio and reports resolution limits',()=>{const d=imageExportSize(1920,1080,2);assert.equal(d.width,3840);assert.equal(d.height,2160);assert.equal(d.reduced,false);assert.ok(imageExportSize(9600,9600,4).reduced);assert.throws(()=>imageExportSize(50,1080,2));});
test('text tokens render current map values without interpreting HTML',()=>{assert.equal(tokens('{{ map.title }} — {{ map.description }}',context),'Exploration map — Current plan');assert.equal(tokens('{{ map.title }}',{title:'<script>text</script>'}),'<script>text</script>');});

test('sample layouts keep map frames and all page items inside printable margins',async()=>{
 const {sampleLayouts}=await import('../src/print-model.js');
 const templates=sampleLayouts({center:[-27,153],zoom:12,layers:[{id:'one'}]});
 assert.equal(templates.length,3);
 for(const {page} of templates){for(const item of page.items){assert.ok(item.x>=0&&item.y>=0);assert.ok(item.x+item.w<=page.width);assert.ok(item.y+item.h<=page.height);if(item.type==='map')assert.equal(item.frame,true);}}
});
