import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import {readKML,projectKMLGeometry} from '../src/kml-import.js';
import {vectorStyle} from '../src/layer-style.js';
const Parser=new JSDOM().window.DOMParser;
const parse=body=>readKML(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`,Parser);
test('nested folders import together with names, style, visibility and heights',()=>{
 const {fc,details}=parse(`<Style id="red"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style><Folder><name>Conductors</name><Folder><name>Hidden</name><visibility>0</visibility><Placemark><name>Wire</name><styleUrl>#red</styleUrl><LineString><coordinates>148,-21,300 148.001,-21.001,310</coordinates></LineString></Placemark></Folder></Folder><Placemark><name>Structure</name><Point><coordinates>148,-21,350</coordinates></Point></Placemark>`);
 assert.equal(fc.features.length,2);assert.equal(details.folders,1);const f=fc.features[0];
 assert.equal(f.properties.Name,'Wire');assert.equal(f.properties['KML folder'],'Conductors / Hidden');assert.equal(f.properties._fieldmaps_kml_visible,false);
 assert.deepEqual(f.geometry.coordinates[1],[148.001,-21.001,310]);
 const style=vectorStyle({color:'#000000',opacity:1,metadata:{style:{useKMLStyle:true}}},f);assert.equal(style.color,'#ff0000');assert.equal(style.weight,4);
});
test('vertical 3D geometry keeps original coordinates when its map projection is a point',()=>{
 const {fc,details}=parse('<Placemark><LineString><coordinates>148,-21,300 148,-21,350</coordinates></LineString></Placemark>');
 const f=fc.features[0];assert.equal(details.projected,1);assert.equal(f.geometry.type,'Point');assert.deepEqual(f.properties._fieldmaps_kml_original_geometry.coordinates,[[148,-21,300],[148,-21,350]]);
});
test('overlapping 3D faces remain separate valid components rather than disappearing',()=>{
 const p={type:'Polygon',coordinates:[[[148,-21,1],[148.01,-21,2],[148.01,-21.01,3],[148,-21,1]]]};
 const source={type:'MultiPolygon',coordinates:[p.coordinates,p.coordinates]},shown=projectKMLGeometry(source);
 assert.equal(shown.type,'GeometryCollection');assert.equal(shown.geometries.length,2);assert.ok(new IsValidOp(new GeoJSONReader().read(shown)).isValid());assert.deepEqual(shown.geometries[0],p);
});
test('unsupported overlays are explicitly counted',()=>{
 const {fc,details}=parse('<ScreenOverlay><name>Logo</name></ScreenOverlay><Placemark><Point><coordinates>148,-21,1</coordinates></Point></Placemark>');assert.equal(fc.features.length,1);assert.equal(details.omitted.ScreenOverlay,1);
});
test('invalid KML and unsupported placemarks fail explicitly',()=>{
 assert.throws(()=>readKML('<kml>',Parser),/valid KML/);assert.throws(()=>parse('<Placemark><name>No geometry</name></Placemark>'),/no supported geometry/);
});
