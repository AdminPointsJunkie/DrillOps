import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../docs/fortem-estimate.js';

const {defaults,calculate,storageKey}=globalThis.FortemEstimate;
const period={from:'2026-10-01',to:'2026-10-07',project:'Burton'};
const settings={...defaults(period),enabled:true};

test('seven calendar days include weekends and one weekly flight',()=>{
  assert.equal(settings.days,7);
  assert.equal(settings.flights,1);
  assert.equal(calculate(settings,0).gross,11170);
  assert.equal(calculate(settings,0).unbilled,11170);
});
test('estimate is opt-in, zero values are retained and invoices are not double counted',()=>{
  assert.equal(calculate(defaults(period),0).unbilled,0);
  assert.deepEqual(calculate(settings,3000),{gross:11170,invoices:3000,unbilled:8170,total:11170});
  assert.deepEqual(calculate(settings,12000),{gross:11170,invoices:12000,unbilled:0,total:12000});
  assert.equal(calculate({...settings,days:0,flights:0},0).gross,0);
  assert.equal(calculate({...settings,geologist:1500,vehicle:0,flightRate:650,days:10,flights:2},0).gross,16300);
});
test('partial weeks, leap dates and invalid ranges are explicit',()=>{
  assert.equal(defaults({...period,to:'2026-10-08'}).flights,2);
  assert.equal(defaults({from:'2028-02-28',to:'2028-03-01'}).days,3);
  assert.equal(defaults({from:'2026-10-08',to:'2026-10-01'}).days,0);
  assert.throws(()=>calculate({...settings,geologist:-1},0));
  assert.throws(()=>calculate({...settings,days:1.5},0));
  assert.throws(()=>calculate({...settings,flights:NaN},0));
});
test('saved scenarios cannot leak across clients, projects, programs or report periods',()=>{
  const scope={...period,client:1,program:'Exploration'};
  for(const [key,value] of Object.entries({client:2,project:'Ironbark',program:'Production',from:'2026-10-02',to:'2026-10-08'})){
    assert.notEqual(storageKey(scope),storageKey({...scope,[key]:value}));
  }
});

const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
test('all portal scripts compile',()=>{
  for(const [,attributes,source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(!attributes.includes('application/ld+json'))new vm.Script(source);
  }
});
function context(){
  const store=new Map();
  const c=vm.createContext({FortemEstimate:globalThis.FortemEstimate,activeClientId:1,activeProgramLabel:()=> 'Exploration',selectedPeriod:()=>period,
    localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},numVal:v=>Number(v)||0,
    contractorSummaryKey:v=>String(v).toLowerCase(),renderPeriodReport:()=>{},toast:()=>{}});
  const start=html.indexOf('function periodFortemEstimate(');
  const end=html.indexOf('function renderFortemEstimateEditor(',start);
  vm.runInContext(html.slice(start,end),c);
  return c;
}
test('save, reload, disable and invoice reconciliation use the same scoped settings',()=>{
  const c=context();
  const elements={enabled:{checked:true}};
  for(const [key,value] of Object.entries(settings))if(key!=='enabled')elements[key]={value:String(value)};
  c.saveFortemEstimate({preventDefault(){},target:{elements,reportValidity:()=>true,querySelector:()=>({textContent:''})}});
  const result=c.periodFortemEstimate(period,[{contractor:'Fortem',total_aud:3000},{contractor:'Other',total_aud:9000}]);
  assert.equal(result.unbilled,8170);
  assert.equal(result.settings.geologist,1400);
  elements.enabled.checked=false;
  c.saveFortemEstimate({preventDefault(){},target:{elements,reportValidity:()=>true,querySelector:()=>({textContent:''})}});
  assert.equal(c.periodFortemEstimate(period,[]).unbilled,0);
});
test('corrupt saved settings fall back to a disabled estimate with a visible warning',()=>{
  const c=context();
  c.localStorage.setItem(storageKey({...period,client:1,program:'Exploration'}),'{broken');
  const result=c.periodFortemEstimate(period,[]);
  assert.equal(result.unbilled,0);
  assert.match(result.storageWarning,/could not be loaded/);
});
