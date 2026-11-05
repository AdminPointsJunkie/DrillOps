import test from 'node:test';
import assert from 'node:assert/strict';
import { importCRS, projectCRS } from '../src/project.js';
const catalogue = [{code:'EPSG:7856', name:'GDA2020 / MGA zone 56'}, {code:'EPSG:4326', name:'WGS 84'}];
test('missing file CRS falls back to the project without changing the project', () => {
  const project = projectCRS('7856', catalogue);
  const choice = importCRS(project);
  assert.equal(choice.code, 'EPSG:7856');
  assert.equal(choice.fromProject, true);
  assert.match(choice.label, /GDA2020/);
  assert.equal(importCRS(project, '   ').code, 'EPSG:7856');
  choice.code = 'EPSG:4326';
  assert.equal(project.default_crs, 'EPSG:7856');
  assert.equal(importCRS(projectCRS('4326', catalogue)).code, 'EPSG:4326');
});
test('a file CRS takes precedence over the project fallback', () => {
  const choice = importCRS(projectCRS('7856', catalogue), 'EPSG:4326', 'WGS 84');
  assert.deepEqual(choice, {code:'EPSG:4326',label:'WGS 84',fromProject:false});
});
test('existing projects without defaults retain embedded CRS and missing CRS remains unset', () => {
  assert.equal(importCRS({}, 'embedded WKT', 'Embedded').code, 'embedded WKT');
  assert.equal(importCRS(null).code, '');
});
test('project CRS accepts catalogue codes and names, can be cleared, and rejects unconfirmed search text', () => {
  assert.equal(projectCRS('EPSG:7856 — GDA2020 / MGA zone 56', catalogue).default_crs, 'EPSG:7856');
  assert.equal(projectCRS('', catalogue).default_crs, null);
  assert.throws(() => projectCRS('MGA', catalogue));
});
