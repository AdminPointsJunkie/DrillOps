import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../docs/workspace/navigation.js',import.meta.url),'utf8').split('const WORKSPACE_PAGES')[0];
for(const app of ['eos','account','project']){
 const context={document:{body:{dataset:{workspaceArea:app}}}};
 vm.createContext(context);vm.runInContext(source,context);
 const rows=['DEPCO Drilling','Mitchells Drilling','Weatherfords','Epiroc'].map(name=>({name}));
 const actual=context.contractorsForApp(rows).map(row=>row.name);
 assert.deepEqual(Array.from(actual),app==='eos'?rows.slice(0,3).map(row=>row.name):rows.map(row=>row.name));
 assert.equal(context.contractorsForApp([{contractor:'Weatherfords'}],'contractor').length,1);
}
console.log('Weatherfords remains a separate selectable EOS contractor');
