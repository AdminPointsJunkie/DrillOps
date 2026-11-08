/* Monetary comparisons use ex-GST values; rig allocations require source evidence. */
(function(root){
 const number=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
 const key=r=>JSON.stringify([r.project||'',r.program||'',r.contractor||'',r.month||'Unknown month']);
 function group(data){
  const groups=new Map();
  const get=r=>{const k=key(r);if(!groups.has(k))groups.set(k,{project:r.project||'',program:r.program||'',contractor:r.contractor,month:r.month,rigs:[],eos:0,invoiced:0,unpriced:0,missingAmounts:0,invoiceCount:0,dateFallbacks:0,hasEos:false});return groups.get(k);};
  for(const r of data.eos||[]){const g=get(r);g.hasEos=true;g.rigs.push(r);g.eos+=Math.round((number(r.eos_total)||0)*100);g.unpriced+=Number(r.unpriced)||0;}
  for(const r of data.invoices||[]){const g=get(r);g.invoiced+=Math.round((number(r.invoice_total)||0)*100);g.invoiceCount+=Number(r.invoice_count)||0;g.missingAmounts+=Number(r.missing_amounts)||0;g.dateFallbacks+=Number(r.date_fallbacks)||0;}
  return [...groups.values()].map(g=>({...g,eos:g.eos/100,invoiced:g.invoiced/100,variance:g.hasEos&&g.invoiceCount&&!g.unpriced&&!g.missingAmounts?(g.invoiced-g.eos)/100:null})).sort((a,b)=>b.month.localeCompare(a.month)||a.project.localeCompare(b.project)||a.contractor.localeCompare(b.contractor));
 }
 const api={group};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EosReconciliation=api;
})(typeof globalThis!=='undefined'?globalThis:this);
