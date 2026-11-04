import test from 'node:test';
import assert from 'node:assert/strict';
import {textFormat,textBoxSVG} from '../src/print-text.js';
test('text formatting retains safe defaults and bounds saved values',()=>{
 assert.equal(textFormat({}).color,'#283746');assert.equal(textFormat({}).padding,2);
 const f=textFormat({fontFamily:'bad',fontSize:900,textPadding:-10,lineHeight:5,textColor:'red" onload="bad'});
 assert.equal(f.font,'sans');assert.equal(f.size,200);assert.equal(f.padding,0);assert.equal(f.lineHeight,3);assert.equal(f.color,'#283746');
});
test('formatted SVG includes colour font alignment underline background and escaped tokens',()=>{
 const svg=textBoxSVG({text:'{{ map.title }}',fontFamily:'serif',bold:true,italic:true,underline:true,textAlign:'center',textColor:'#ff0000',textBackground:true,backgroundColor:'#eeeeee',fontSize:20,textPadding:8},{title:'A & <B>'},200,100);
 for(const part of ['Times New Roman','font-weight="bold"','font-style="italic"','fill="#ff0000"','fill="#eeeeee"','text-anchor="middle"','A &amp; &lt;B&gt;','stroke="#ff0000"'])assert.ok(svg.includes(part),part);
});
test('line spacing and wrapping keep paragraph breaks',()=>{
 const svg=textBoxSVG({text:'One\nTwo',fontSize:10,lineHeight:2,textPadding:4},{},200,100);
 assert.ok(svg.includes('y="14"'));assert.ok(svg.includes('y="34"'));
 assert.ok((textBoxSVG({text:'abcdefghijk',fontSize:10},{},20,100).match(/<text /g)||[]).length>1);
});
