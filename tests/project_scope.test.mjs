import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
const names=['normalizeProjectName','projectNamesMatch','rowMatchesActiveProgram','filterRowsForActiveProgram','filterWorkspaceActivities','rowMatchesPeriodProject'];
const functions=names.map(name=>{
  const start=html.indexOf('function '+name+'(');
  assert.ok(start>=0);
  return html.slice(start,html.indexOf('\nfunction ',start+1));
}).join('\n');
function context(project){
  return vm.createContext({activeProjectName:project,activeProgram:'Exploration',activeContractor:'Allianz Drilling'});
}
test('Round 2 register excludes original-project DDRs in both directions',()=>{
  for(const project of ['Carborough Downs','Carborough Downs - Round 2']){
    const c=context(project);vm.runInContext(functions,c);
    c.rows=[{id:1,project:'Carborough Downs',program:'Exploration'},{id:2,project:'Carborough Downs - Round 2',program:'Exploration'},{id:3,project:null,program:'Exploration'}];
    const result=vm.runInContext('filterWorkspaceActivities(rows)',c);
    assert.equal(result.length,1);
    assert.equal(result[0].project,project);
  }
});
test('report totals respect explicit projects even where a hole matches',()=>{
  const c=context('Carborough Downs - Round 2');vm.runInContext(functions,c);
  assert.equal(c.rowMatchesPeriodProject({project:'Carborough Downs'},new Map(),'Carborough Downs - Round 2'),false);
  assert.equal(c.projectNamesMatch(' CARBOROUGH DOWNS – ROUND 2 ','Carborough Downs - Round 2'),true);
  assert.equal(c.projectNamesMatch('',''),false);
  assert.equal(c.projectNamesMatch('Carborough Downs - Round 20','Carborough Downs - Round 2'),false);
});
