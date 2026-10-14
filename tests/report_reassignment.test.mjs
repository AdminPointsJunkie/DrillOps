import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../docs/report.html',import.meta.url),'utf8');
const start=html.indexOf('async function resolveReassignedDepcoReport(');
const fn=html.slice(start,html.indexOf('\nasync function loadReport()',start));
test('DEPCO PCD metres remain visible after assigning the contract code',()=>{
 const c={num:v=>Number(v)||0};vm.createContext(c);
 vm.runInContext(html.match(/function isDrilledMetresRow\(row\)\{[^\n]+/)[0],c);
 assert.equal(c.isDrilledMetresRow({code:'DEPCO_A_PCD_125_175_011',total_metres:32.9}),true);
 assert.equal(c.isDrilledMetresRow({code:'DEPCO_A_SETUP_PACKUP_SITE_037',total_metres:0}),false);
});
function fixture(day,overrides={}){
 const source=`DDR_Depco DR17_202610${day}.pdf`,date=`${day}/10/2026`;
 const rows=[{contractor:'DEPCO Drilling',source_file:source,date,program:'Exploration',...overrides}];
 const urls=[];
 const c={contractor:'Allianz Drilling',source,reportDate:date,program:'Exploration',API:'api',URLSearchParams,
  isoReportDate:v=>v,fetchJson:async()=>rows,window:{location:{search:'?contractor=Allianz+Drilling&date='+date+'&source='+source+'&nav=old',replace:url=>urls.push(url)}}};
 vm.createContext(c);vm.runInContext(fn,c);return {c,urls};
}
test('all three stale report links resolve to the saved DEPCO data and discard stale navigation',async()=>{
 for(const day of ['08','09','10']){
  const {c,urls}=fixture(day);assert.equal(await c.resolveReassignedDepcoReport(),true);
  const params=new URLSearchParams(urls[0].split('?')[1]);
  assert.equal(params.get('contractor'),'DEPCO Drilling');assert.equal(params.get('source'),c.source);assert.equal(params.has('nav'),false);
 }
});
test('another source, date or program cannot redirect the report',async()=>{
 for(const patch of [{source_file:'another.pdf'},{date:'11/10/2026'},{program:'Gas Riser'}]){
  const {c,urls}=fixture('10',patch);assert.equal(await c.resolveReassignedDepcoReport(),false);assert.equal(urls.length,0);
 }
});
