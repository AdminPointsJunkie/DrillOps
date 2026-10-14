import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../docs/report.html',import.meta.url),'utf8');
const c={};vm.createContext(c);
vm.runInContext(html.slice(html.indexOf('function displayReportDate('),html.indexOf('function updateStoredNavigationDate(')),c);
test('report dates always display day/month/year including previously saved ISO dates',()=>{
 for(const input of ['2026-10-08','08-10-2026','8/10/2026','08/10/2026'])assert.equal(c.displayReportDate(input),'08/10/2026');
 for(const input of ['31/02/2026','10/14/2026','not a date',''])assert.equal(c.displayReportDate(input),'');
 assert.equal(c.displayReportDate('29/02/2028'),'29/02/2028');
});
