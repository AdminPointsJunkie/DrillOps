import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readSpecial} from '../src/file-readers.js';
import {columnOptions,coordinateColumns} from '../src/table-columns.js';
import {csvGeoJSON} from '../src/geo.js';

test('CSV headings survive the actual dropdown and coordinate conversion',async()=>{
 const csv='Hole ,Purpose,East,North ,RL\r\nBC2221,Structure,618661.5692,7579496.341,\r\nBC2222,Structure,618735.1998,7579301.839,\r\n';
 const [item]=await readSpecial(new File([csv],'collars.csv'));
 const defaults=coordinateColumns(item.fields);
 const document=new JSDOM('<select id="x"></select><select id="y"></select>').window.document;
 for(const axis of ['x','y']){const select=document.getElementById(axis);select.innerHTML=columnOptions(item.fields);select.value=defaults[axis];}
 const fc=csvGeoJSON(item.rows,document.getElementById('x').value,document.getElementById('y').value);
 assert.equal(defaults.y,'North ');
 assert.equal(fc.features.length,2);
 assert.deepEqual(fc.features[0].geometry.coordinates,[618661.5692,7579496.341]);
 assert.equal(fc.features[0].properties['Hole '],'BC2221');
 assert.equal(fc.features[0].properties.RL,'');
});

test('dropdown preserves distinct whitespace keys and escapes markup',()=>{
 const fields=['North','North ','\t North\u00a0','A"<&>'];
 const select=new JSDOM('<select></select>').window.document.querySelector('select');
 select.innerHTML=columnOptions(fields);
 assert.deepEqual([...select.options].map(o=>o.value),fields);
 for(const key of fields){select.value=key;assert.equal(select.value,key);}
 assert.deepEqual(coordinateColumns(['ID',' NORTH\u00a0',' east ']),{x:' east ',y:' NORTH\u00a0'});
});

test('coordinate failures identify the row and column without dropping records',()=>{
 assert.throws(()=>csvGeoJSON([{East:'1',North:'2'},{East:'3',North:''}],'East','North'),/row 3, column "North": A coordinate is blank/);
 assert.throws(()=>csvGeoJSON([{'North ':'2',East:'1'}],'East','North'),/column "North" is missing/);
 assert.throws(()=>csvGeoJSON([{East:'bad',North:'2'}],'East','North'),/column "East": Cannot read coordinate/);
 assert.throws(()=>csvGeoJSON([{East:'9'.repeat(400),North:'2'}],'East','North'),/finite number/);
 assert.deepEqual(csvGeoJSON([{East:'0',North:'0'}],'East','North').features[0].geometry.coordinates,[0,0]);
});
