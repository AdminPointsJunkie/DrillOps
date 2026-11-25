const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/report.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const functions = ['mccServiceSection', 'renderMccSiteServiceLineItems'].map(name => {
  const start = html.indexOf('function ' + name + '(');
  return html.slice(start, html.indexOf('\n}', start) + 2);
}).join('\n');
const body = { innerHTML: '', closest: () => ({querySelector: () => ({innerHTML: ''})}), querySelectorAll: () => [] };
const context = {
  document: {getElementById: () => body},
  mccEquipment: row => row.equipment || '', noteField: (row, field) => (row.fields || {})[field] || '',
  mccAllocationPercent: row => row.allocation_percent ?? 100,
  mccAllocatedCost: row => (row.line_cost || 0) * (row.allocation_percent ?? 100) / 100,
  num: Number, cur: n => '$' + n.toFixed(2), esc: String, attr: String,
  mccWorkGroupSelect: () => '', mccPlannedHoleSelect: () => '', mccPerson: () => '',
  mccQuantityDisplay: () => '', workDescription: () => '', parseClockMinutes: () => 0
};
vm.createContext(context);
vm.runInContext(functions, context);
for (const row of [{code:'MCC_BODY_WATER_TRUCK'}, {equipment:'Watercart'}, {equipment:'WT01'}, {location:'ARG-004 - SIS'}, {fields:{'Schedule item':'Water Cart'}}]) assert.equal(context.mccServiceSection(row), 'Water Cart');
assert.equal(context.mccServiceSection({code:'MCC_EXCAVATOR',notes:'Waiting for water cart'}), 'Earthworks');
assert.equal(context.mccServiceSection({equipment:'Water pump'}), 'Earthworks');
const rows = [{id:1,code:'MCC_BODY_WATER_TRUCK',line_cost:100,allocation_percent:50},{id:2,code:'MCC_EXCAVATOR',line_cost:200},{id:3,code:'MCC_WATER_TRUCK',line_cost:null}];
context.renderMccSiteServiceLineItems(rows);
assert.match(body.innerHTML, /Water Cart subtotal · 1 unpriced line\(s\)<\/th><td>\$50.00/);
assert.match(body.innerHTML, /Earthworks subtotal<\/th><td>\$200.00/);
for (const row of rows) assert.equal(body.innerHTML.split('data-id="'+row.id+'"').length-1, 1);
assert.ok(body.innerHTML.indexOf('data-id="3"') < body.innerHTML.indexOf('data-id="2"'));
assert.equal(rows[0].allocation_percent, 50);
context.renderMccSiteServiceLineItems([]);
assert.match(body.innerHTML, /No water cart activities recorded/);
assert.match(body.innerHTML, /No earthworks activities recorded/);
console.log('MCC service sections: classification, allocation subtotals, unpriced entries, unique rows, empty sections and script syntax passed.');
