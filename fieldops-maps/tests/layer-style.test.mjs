import test from 'node:test';
import assert from 'node:assert/strict';
import {geometryKinds,layerStyle,vectorStyle,pointMarker,styleControls} from '../src/layer-style.js';
const layer=(types,style={})=>({color:'#123456',opacity:.5,metadata:{style},fc:{features:types.map(type=>({geometry:{type}}))}});
test('controls match point, line, polygon and mixed geometries',()=>{
 assert.match(styleControls(layer(['MultiPoint'])),/Point symbol/);
 assert.doesNotMatch(styleControls(layer(['Point'])),/Fill colour|Line width/);
 assert.match(styleControls(layer(['MultiLineString'])),/Line style/);
 assert.doesNotMatch(styleControls(layer(['LineString'])),/Point symbol|Fill colour/);
 assert.match(styleControls(layer(['MultiPolygon'])),/Fill colour/);
 assert.match(styleControls(layer(['Polygon'])),/Outline style/);
 assert.deepEqual([...geometryKinds({features:[{geometry:{type:'GeometryCollection',geometries:[{type:'Point'},{type:'Polygon'},{type:'LineString'}]}}]})],['point','shape','line']);
});
test('whole-layer opacity multiplies polygon fill and supports fully invisible layers',()=>{
 const l=layer(['Polygon'],{fillOpacity:.6,fillColor:'#abcdef',lineWidth:4,lineStyle:'dashed'});
 assert.deepEqual(vectorStyle(l),{color:'#123456',weight:4,dashArray:'8 6',opacity:.5,fillColor:'#abcdef',fillOpacity:.3});
 l.opacity=0;assert.equal(vectorStyle(l).fillOpacity,0);assert.equal(vectorStyle(l).opacity,0);
});
test('point symbol, size and opacity reach marker rendering; saved settings have safe defaults',()=>{
 const L={marker:(ll,options)=>options,divIcon:options=>options,circleMarker:(ll,options)=>options};
 const marker=pointMarker(L,layer(['Point'],{symbol:'triangle',pointSize:24}),[0,0]);
 assert.equal(marker.opacity,.5);assert.deepEqual(marker.icon.iconSize,[24,24]);assert.match(marker.icon.html,/<path/);
 assert.equal(pointMarker(L,layer(['Point']),[0,0]).fillOpacity,.5);
 assert.equal(layerStyle(layer(['Point'],{symbol:'<bad>',pointSize:999})).symbol,'circle');
 assert.equal(layerStyle(layer(['Point'],{pointSize:999})).pointSize,48);
});
