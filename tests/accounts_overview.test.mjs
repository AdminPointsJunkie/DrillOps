import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const M=createRequire(import.meta.url)('../docs/workspace/accounts-overview-model.js');
const inv=(supplier,month,amount=100,project='Example')=>({contractor:supplier,billing_month:month,subtotal:amount,project,program:'Exploration',invoice_number:'TEST'});
const eos=(supplier,month,amount=100,project='Example')=>({contractor:supplier,month,eos_total:amount,project,program:'Exploration',report_count:1});
const m=M.build([inv('Mitchells Drilling','2026-09'),inv('DEPCO','2026-10',-20),inv('Weatherfords','2026-10',10.01),inv('Precision','2026-10',20.02),inv('Fortem','2026-12')],[eos('Mitchells','2026-09',100,'Another'),eos('DEPCO Drilling','2026-10'),eos('Mitchells','2026-08',0),eos('DEPCO','2026-11')],{year:'2026',today:'2026-11-08'});
assert.equal(m.net,210.03);assert.equal(m.count,4);assert.equal(m.gaps.length,2);assert.equal(m.rows[0].cells[8].status,'partial');assert.equal(m.rows[1].cells[9].status,'gap');assert.equal(m.rows[3].cells[11].status,'received');assert.equal(m.rows[2].latestMonth,'2026-10');assert.equal(m.suppliers.find(x=>x.name==='Weatherford / Precision').total,30.03);assert.equal(M.date('31/02/2026'),'');assert.equal(M.period({invoice_date:'8 Nov 2026'}),'2026-11');
console.log('PASS actuals, credits, aliases, project gaps, zero-charge exclusion and future receipts');
