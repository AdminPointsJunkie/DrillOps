import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../docs/workspace/navigation.js',import.meta.url),'utf8').split('const WORKSPACE_PAGES')[0];
const rows=[
 {name:'Imports',eos_imports_enabled:true,eos_reports_enabled:false},
 {name:'Reports',eos_imports_enabled:false,eos_reports_enabled:true},
 {name:'Both',eos_imports_enabled:true,eos_reports_enabled:true},
 {name:'Neither',eos_imports_enabled:false,eos_reports_enabled:false},
 {name:'Day rates',eos_imports_enabled:false,eos_reports_enabled:false,eos_day_rates_enabled:true},
 {name:'Inactive',active:false,eos_imports_enabled:true,eos_reports_enabled:true},
 {name:'Company',eos_imports_enabled:true,eos_reports_enabled:true},
];
for(const app of ['eos','account','project']){
 const context={document:{body:{dataset:{workspaceArea:app}}}};vm.createContext(context);vm.runInContext(source,context);
 for(const [listing,expected] of [['imports',['Imports','Both']],['reports',['Reports','Both']],['day-rates',['Day rates']],['any',['Imports','Reports','Both','Day rates']]]){
  assert.deepEqual(Array.from(context.contractorsForApp(rows,'name',listing),r=>r.name),app==='eos'?expected:rows.map(r=>r.name));
 }
 assert.equal(context.eosContractorListing('importer'),'imports');
 assert.equal(context.eosContractorListing('activities'),'imports');
 assert.equal(context.eosContractorListing('reports'),'reports');
 assert.equal(context.eosContractorListing('app-home'),'reports');
 assert.equal(context.eosContractorListing('rates'),'any');
 assert.equal(context.eosContractorListing('day-rates'),'day-rates');
 assert.equal(context.contractorsForApp([{name:'Custom contractor',eos_imports_enabled:true,eos_reports_enabled:true}]).length,1);
}
console.log('Independent, configurable EOS listings preserve Account and Project supplier lists.');
