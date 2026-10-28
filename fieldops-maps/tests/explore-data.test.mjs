import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {matchesFilter,matchesView,legendItems,tableRows,featureBounds,measureDistance,measureArea,featureInfo,displayFields} from '../src/explore-data.js';
import {classifyFeatures} from '../src/attribute-style.js';
import {annotationFeature} from '../src/field-tools.js';
import {publishedLayers,publishedProjects} from '../src/published-projects.js';
const fc={type:'FeatureCollection',features:[['IB-01','Planned','20'],['IB-02','Complete','100'],['IB-03','Planned',null]].map(([Hole_ID,Status,Depth],i)=>({type:'Feature',properties:{Hole_ID,Status,Depth},geometry:{type:'Point',coordinates:[148+i,-22]}}))};
const layer={id:'csv',name:'Holes',color:'#147d72',fc,metadata:{style:{rules:{mode:'categorized',field:'Status',classes:classifyFeatures(fc,'Status','categorized')}}}};
test('filters, legend exclusions, table search and numeric sorting select the same source features',()=>{
 const filter={match:'all',conditions:[{field:'Status',op:'eq',value:'planned'},{field:'Depth',op:'gt',value:'10'}]};
 assert.deepEqual(fc.features.map(f=>matchesFilter(f,filter)),[true,false,false]);
 filter.match='any';assert.deepEqual(fc.features.map(f=>matchesFilter(f,filter)),[true,true,true]);
 const view={hiddenClasses:['string:Complete'],search:'IB-',filter:{conditions:[]}};
 assert.deepEqual(tableRows(layer,view).map(r=>r.index),[0,2]);assert.equal(matchesView(layer,fc.features[1],view),false);
 assert.deepEqual(legendItems(layer,view).map(c=>[c.count,c.visible]),[[2,true],[1,false],[0,true]]);
 assert.deepEqual(tableRows(layer,{}, {field:'Depth',direction:-1}).map(r=>r.index),[1,0,2]);
 assert.deepEqual(tableRows(layer,{}, {bounds:[148.5,-23,149.5,-21]}).map(r=>r.index),[1]);
 assert.equal(fc.features.length,3,'filters never alter the source collection');
});
test('popup field aliases, order and hiding apply without interpreting attribute HTML',()=>{
 const doc=new JSDOM().window.document,l=structuredClone(layer);l.metadata.style.popup={fields:[{field:'Depth',label:'Planned depth',visible:true},{field:'Status',visible:false},{field:'Hole_ID',label:'Hole',visible:true}]};
 assert.deepEqual(displayFields(l).map(f=>f.field),['Depth','Hole_ID']);
 const content=featureInfo(l,{properties:{Depth:'<img src=x onerror=alert(1)>',Status:'Complete',Hole_ID:'IB-01'}},doc);
 assert.equal(content.querySelector('img'),null);assert.match(content.textContent,/Planned depth/);assert.doesNotMatch(content.textContent,/Complete/);
});
test('distance and area use geographic coordinates, including antimeridian and degenerate geometry',()=>{
 assert.ok(Math.abs(measureDistance([[0,0],[1,0]])-111195)<2);
 assert.ok(Math.abs(measureDistance([[179,0],[-179,0]])-222390)<3);
 assert.ok(Math.abs(measureArea([[0,0],[.001,0],[.001,.001],[0,.001]])-12364.35)<1);
 assert.equal(measureArea([[0,0],[1,0]]),0);
 assert.deepEqual(featureBounds({geometry:{type:'GeometryCollection',geometries:[{type:'Point',coordinates:[148,-22]},{type:'LineString',coordinates:[[149,-23],[150,-21]]}]}}),[148,-23,150,-21]);
});
test('annotations retain notes and geometry and reject incomplete shapes',()=>{
 assert.equal(annotationFeature('note',[[148,-22]],'South gate').properties.note,'South gate');
 const polygon=annotationFeature('polygon',[[148,-22],[148.01,-22],[148,-22.01]],'Keep out');
 assert.deepEqual(polygon.geometry.coordinates[0][0],polygon.geometry.coordinates[0].at(-1));
 assert.throws(()=>annotationFeature('arrow',[[148,-22],[148,-22]],''),/distinct/);
 assert.throws(()=>annotationFeature('polygon',[[148,-22],[148,-22],[148,-22]],''),/distinct/);
 assert.throws(()=>annotationFeature('note',[[500,0]],''),/Invalid/);
 assert.throws(()=>annotationFeature('polygon',[[0,0],[3,3],[0,3],[2,0]],''),/cross/);
});
test('operator loader only requests published snapshots and preserves styles, filters and annotations',async()=>{
 const queries=[],project={id:'map',release_id:'release'},manifest={project:{id:'map',name:'Published'},layer_layout:['csv'],layers:[{...layer,kind:'vector',metadata:{...layer.metadata,annotation:{type:'note'}}}]};
 const db={rpc:async name=>{assert.equal(name,'maps_published_projects');return {data:[project]};},from(table){queries.push(table);assert.equal(table,'map_releases');return {select(){return this;},eq(k,v){assert.equal(k,'id');assert.equal(v,'release');return this;},async single(){return {data:{map_id:'map',version:2,published_at:'2026-10-28',manifest}};}};}};
 assert.deepEqual(await publishedProjects(db),[project]);const result=await publishedLayers(db,project);
 assert.deepEqual(queries,['map_releases']);assert.equal(result.project.published_version,2);assert.deepEqual(result.layers[0].metadata,manifest.layers[0].metadata);assert.equal(result.layers[0].saved,true);
 await assert.rejects(()=>publishedLayers(db,{...project,id:'wrong-map'}),/unavailable/);
});
