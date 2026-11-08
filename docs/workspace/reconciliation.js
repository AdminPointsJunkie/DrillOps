(function(){
 if(!document.getElementById('page-reconciliation'))return;
 const el=id=>document.getElementById(id),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>Number(v).toLocaleString('en-AU',{style:'currency',currency:'AUD'});
 let rows=[],request=0,ready=false;
 const projectKey=r=>JSON.stringify([r.project,r.program]);
 function projectLabel(r){
  const matches=(typeof projects==='undefined'?[]:projects).filter(p=>p.name===r.project&&p.program===r.program);
  return [r.project||'Unassigned project',matches.length===1?matches[0].year:'',r.program].filter(Boolean).join(' · ');
 }
 function options(id,values,label,empty){const select=el(id),old=select.value;select.innerHTML='<option value="">'+empty+'</option>'+[...values].sort((a,b)=>a[1].localeCompare(b[1])).map(([value,text])=>'<option value="'+escape(value)+'">'+escape(text)+'</option>').join('');select.value=old;if(select.selectedIndex<0)select.value='';}
 function render(){
  if(!ready)return;
  const selected=rows.filter(r=>(!el('recon-project').value||projectKey(r)===el('recon-project').value)&&(!el('recon-contractor').value||r.contractor===el('recon-contractor').value)&&(!el('recon-month').value||r.month===el('recon-month').value));
  const eos=selected.reduce((s,r)=>s+Math.round(r.eos*100),0)/100,inv=selected.reduce((s,r)=>s+Math.round(r.invoiced*100),0)/100;
  const incomplete=selected.some(r=>r.unpriced||r.missingAmounts),unmatched=selected.some(r=>!r.hasEos||!r.invoiceCount);
  el('recon-totals').innerHTML=[['EOS charges loaded',money(eos),incomplete?'Recorded amounts; some lines unpriced':'Activities and consumables'],['Invoice actuals',money(inv),'Net of credits, ex GST'],['Invoiced − EOS',incomplete?'Incomplete':money(inv-eos),unmatched?'Includes months without matching reports or invoices':'Difference, not an overcharge determination']].map(([title,value,note])=>'<div class="ledger-card"><div class="ledger-card-label">'+title+'</div><div class="ledger-card-value">'+value+'</div><div class="ledger-card-note">'+note+'</div></div>').join('');
  el('recon-results').innerHTML=selected.map(r=>{
   const max=Math.max(Math.abs(r.eos),Math.abs(r.invoiced),1);
   const bar=(label,value,kind)=>'<div class="recon-bar"><span>'+label+'</span><div><i class="'+kind+'" style="width:'+Math.min(100,Math.abs(value)/max*100)+'%"></i></div><strong>'+money(value)+'</strong></div>';
   const flags=[r.unpriced?r.unpriced+' EOS lines without a recorded charge':'',r.missingAmounts?r.missingAmounts+' invoices missing subtotals':'',r.dateFallbacks?r.dateFallbacks+' invoices using invoice month':'',!r.hasEos?'No EOS reports loaded for this month':'',!r.invoiceCount?'No invoices recorded for this month':''].filter(Boolean);
   return '<article class="recon-card"><header><div><h3>'+escape(r.contractor)+'</h3><p>'+escape(projectLabel(r))+' · '+escape(r.month)+'</p></div><strong>'+(r.variance===null?'Not fully matched':money(r.variance)+' difference')+'</strong></header>'+bar('EOS loaded',r.eos,'eos')+bar('Invoiced',r.invoiced,'invoice')+(flags.length?'<p class="recon-flags">'+escape(flags.join(' · '))+'</p>':'')+'<details><summary>Rig breakdown · '+r.rigs.length+' rigs / allocations</summary><div class="tbl-scroll"><table><thead><tr><th>Rig</th><th>Reports</th><th>EOS charges · ex GST</th><th>Unpriced lines</th></tr></thead><tbody>'+r.rigs.map(rig=>'<tr><td>'+escape(rig.rig)+'</td><td>'+Number(rig.report_count)+'</td><td>'+(rig.eos_total===null?'Not recorded':money(rig.eos_total))+'</td><td>'+Number(rig.unpriced)+'</td></tr>').join('')+'</tbody></table></div><p>Invoice charges are not allocated to individual rigs in the invoice register.</p></details></article>';
  }).join('')||'<p class="ledger-notice">No records match these filters.</p>';
 }
 window.loadMonthlyReconciliation=async function(){
  const current=++request;ready=false;el('recon-message').hidden=false;el('recon-message').textContent='Loading monthly reconciliation…';el('recon-totals').replaceChildren();el('recon-results').replaceChildren();
  try{
   const response=await fetch(API+'/reconciliation/monthly',{cache:'no-store'});if(!response.ok)throw new Error('Reconciliation could not load. Refresh to retry.');
   const data=await response.json();if(!Array.isArray(data.eos)||!Array.isArray(data.invoices))throw new Error('Reconciliation response could not be read.');if(current!==request)return;
   rows=EosReconciliation.group(data);ready=true;
   options('recon-project',new Map(rows.map(r=>[projectKey(r),projectLabel(r)])),null,'All projects');
   options('recon-contractor',new Map(rows.map(r=>[r.contractor,r.contractor])),null,'All EOS contractors');
   options('recon-month',new Map(rows.map(r=>[r.month,r.month])),null,'All months');
   el('recon-message').hidden=true;render();
  }catch(error){if(current!==request)return;rows=[];el('recon-message').textContent=error.message;}
 };
 ['recon-project','recon-contractor','recon-month'].forEach(id=>el(id).addEventListener('change',render));
})();
