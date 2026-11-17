import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context={};vm.createContext(context);vm.runInContext(readFileSync(new URL('../docs/workspace/geophysical-model.js',import.meta.url),'utf8'),context);
const rows=[
 {source_file:'scan.pdf',date:'2026-08-22',code:'P200',hole_num:'IB666C',metres_from:1,metres_to:249,total_time:'00:45',line_cost:0,notes:'Source page 1'},
 {source_file:'scan.pdf',date:'2026-08-22',code:'P200',hole_num:'IB666C',metres_from:247.6,metres_to:125,total_time:'01:45',line_cost:0,notes:'Source page 1'},
 {source_file:'scan.pdf',date:'2026-08-22',code:'L300',total_time:'00:30',line_cost:0,notes:'Source page 1'},
 {source_file:'scan.pdf',date:'2026-08-22',code:'WFD_Callout_Day',total_time:'10:00',line_cost:2650,notes:'Source page 1'},
 {source_file:'scan.pdf',date:'2026-08-22',code:'N100',total_time:'01:00',line_cost:null,notes:'Source page 2'},
];
const s=context.ServiceProduction.summarise(rows,'Geophysical Logging');
assert.equal(s.reports,2);assert.equal(s.holes,1);assert.equal(s.metres,370.6);assert.equal(s.hours,2.5);assert.equal(s.charges,2650);assert.equal(s.unpriced,1);
assert.equal(context.ServiceProduction.summarise(rows,'Labour').hours,4);
assert.equal(context.ServiceProduction.summarise([{code:'P200',metres_from:null,metres_to:50}],'Geophysical Logging').missingIntervals,1);
console.log('PASS logging passes, reverse runs, distinct reports, operational hours and quote charges');
