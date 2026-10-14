import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../docs/report.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('const reportContractCodes='),html.indexOf('function activityRowPatch('));
function fixture({locked=false,fail=false}={}){
 const row={id:12,contractor:'DEPCO Drilling',project:'Round 2',program:'Exploration',code:'SETUP',total_time:'0:30',line_cost:315.25};
 const rates=[{cost_code:'SETUP',name:'Setup',charge:630.5,unit:'hour'},{cost_code:'STANDBY',name:'Standby',charge:485,unit:'hour'}];
 const calls=[],renders=[],alerts=[],messages=[];
 const control={value:'STANDBY',closest:()=>({dataset:{id:'12'}})};
 const c={API:'api',reportRows:[row],reportConsumables:[],reportCrew:[],sheetLock:{locked},esc:String,attr:String,cur:v=>'$'+v,
  fetchJson:async()=>rates,document:{querySelectorAll:()=>[control]},alert:v=>alerts.push(v),
  fetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return {ok:!fail,text:async()=>'Save rejected',json:async()=>({...row,code:'STANDBY',unit_rate:485,line_cost:242.5})};},
  updateCachedActivity:(id,updated)=>Object.assign(row,updated),broadcastActivityUpdate:r=>messages.push({...r}),renderReport:rows=>renders.push(rows[0].line_cost)};
 vm.createContext(c);vm.runInContext(code,c);
 return {c,row,control,calls,renders,alerts,messages};
}
test('dropdown uses current contract, retains selected code and disables locked reports',async()=>{
 const {c,row}=fixture();await c.loadReportContractCodes([row]);
 assert.match(c.reportCodeCell(row),/value="SETUP" selected/);
 assert.match(c.reportCodeCell(row),/Standby \[STANDBY\]/);
 c.sheetLock.locked=true;assert.match(c.reportCodeCell(row),/ disabled>/);
});
test('selection atomically saves code and reprices then refreshes totals and broadcasts',async()=>{
 const {c,control,calls,renders,messages,row}=fixture();await c.saveReportCode(control);
 assert.equal(calls[0].url,'api/activities/12/contract-code');assert.equal(calls[0].body.code,'STANDBY');
 assert.equal(row.code,'STANDBY');assert.equal(row.line_cost,242.5);assert.deepEqual(renders,[242.5]);assert.equal(messages.length,1);
});
test('failure restores saved selection and price; locked reports cannot save',async()=>{
 const f=fixture({fail:true});await f.c.saveReportCode(f.control);
 assert.equal(f.row.code,'SETUP');assert.deepEqual(f.renders,[315.25]);assert.equal(f.alerts.length,1);
 const locked=fixture({locked:true});await locked.c.saveReportCode(locked.control);assert.equal(locked.calls.length,0);
});
