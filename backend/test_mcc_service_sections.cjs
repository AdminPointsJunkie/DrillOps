const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/report.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const functions = "const MCC_COST_STAGES=['Initial Site Prep','Rehab','Operational Misc','Needs Review'];\n" + ['noteField','workDescription','mccCostStage','mccCostStageSelect','mccCostStageNotes','mccHoleCostGroups','renderMccHoleCosts','mccServiceSection', 'renderMccSiteServiceLineItems'].map(name => {
  const start = html.indexOf('function ' + name + '(');
  return html.slice(start, html.indexOf('\n}', start) + 2);
}).join('\n');
const holeBody={innerHTML:''}, holeSection={style:{}};
const body = { innerHTML: '', closest: () => ({querySelector: () => ({innerHTML: ''})}), querySelectorAll: () => [] };
const context = {
  document: {getElementById: id => id==='mcc-hole-cost-body'?holeBody:id==='mcc-hole-cost-section'?holeSection:body},
  mccEquipment: row => row.equipment || '', noteField: (row, field) => (row.fields || {})[field] || '',
  mccAllocationPercent: row => row.allocation_percent ?? 100,
  mccAllocatedCost: row => (row.line_cost || 0) * (row.allocation_percent ?? 100) / 100,
  num: Number, cur: n => '$' + n.toFixed(2), esc: String, attr: String,
  mccWorkGroupSelect: () => '', mccPlannedHoleSelect: () => '', mccPerson: () => '',
  mccQuantityDisplay: () => '', workDescription: () => '', parseClockMinutes: () => 0
};
vm.createContext(context);
vm.runInContext(functions, context);
for (const row of [{code:'MCC_BODY_WATER_TRUCK'}, {equipment:'Watercart'}, {equipment:'WT01'}, {location:'ARG-004 - SIS'}, {notes:'Work | Schedule item: Water Cart'}, {notes:'Work | Linked equipment: WT01 - Water Truck'}]) assert.equal(context.mccServiceSection(row), 'Water Cart');
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

for (const [notes,label] of [['Initial site prep','Initial Site Prep'],['Clearing drill pad','Initial Site Prep'],['Rehabilitation of pad','Rehab'],['Topsoil spreading','Rehab'],['Dust suppression','Operational Misc'],['Access maintenance','Operational Misc'],['Site prep and rehab','Needs Review'],['General works','Needs Review'],['Rehab | Cost stage: Initial Site Prep','Initial Site Prep']]) assert.equal(context.mccCostStage({notes}).label,label,notes);
const original={notes:'Rehab | Equipment: Excavator | Cost stage: Rehab'};
const edited=context.mccCostStageNotes(original,'Operational Misc');
assert.equal(edited,'Rehab | Equipment: Excavator | Cost stage: Operational Misc');
assert.equal(original.notes,'Rehab | Equipment: Excavator | Cost stage: Rehab');
const charges=[
 {id:1,hole_num:'IB-26-001',line_cost:100,allocation_percent:50,code:'MCC_WATER_TRUCK',notes:'Dust suppression'},
 {id:2,hole_num:'IB-26-001',line_cost:200,notes:'Initial site prep'},
 {id:3,hole_num:'IB-26-001',line_cost:80,notes:'Rehab'},
 {id:4,hole_num:'IB-26-001',site_name:'IB-26-001, IB-26-002',line_cost:40,notes:'Works'},
 {id:5,line_cost:null,notes:'Works'}
];
const groups=context.mccHoleCostGroups(charges);
assert.equal(groups.length,3);
assert.equal(groups.find(([hole])=>hole==='IB-26-001')[1].length,3);
assert.equal(groups.find(([hole])=>hole.startsWith('Shared:'))[1].length,1);
assert.equal(groups.find(([hole])=>hole==='Unassigned')[1].length,1);
context.renderMccHoleCosts(charges);
assert.equal(holeSection.style.display,'block');
assert.match(holeBody.innerHTML,/IB-26-001 total<\/th><td>\$200.00<\/td><td>\$80.00<\/td><td>\$50.00<\/td><td>\$0.00<\/td><td>\$330.00/);
assert.match(holeBody.innerHTML,/Report total<\/th><td>\$200.00<\/td><td>\$80.00<\/td><td>\$50.00<\/td><td>\$40.00<\/td><td>\$370.00<\/td><td>1/);
context.renderMccHoleCosts([]);
assert.match(holeBody.innerHTML,/No charges recorded/);
console.log('Cost per hole: stage recognition, overrides, shared/unassigned holes and reconciled totals passed.');
