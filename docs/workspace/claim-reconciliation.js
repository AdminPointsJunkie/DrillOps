(()=>{
 if(!document.getElementById('page-claim-reconciliation'))return;
 const el=id=>document.getElementById(id),base='/reconciliation/depco-claims';
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>v==null?'Unpriced':Number(v).toLocaleString('en-AU',{style:'currency',currency:'AUD'});
 const number=v=>v==null||v===''?'—':Number(v).toLocaleString('en-AU',{maximumFractionDigits:3});
 const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v.slice(8)+'/'+v.slice(5,7)+'/'+v.slice(0,4):v;
 let report=null,version=0,canSave=false,busy=false;
 async function api(path,options={}){const response=await fetch(API+base+path,{cache:'no-store',...options});if(!response.ok){let message='The reconciliation could not be loaded.';try{message=(await response.json()).detail||message;}catch{}throw new Error(message);}return response;}
 function setSave(){el('claim-save').disabled=busy||!canSave||!el('claim-file').files.length;el('claim-file').disabled=busy||!canSave;}
 function clear(){report=null;el('claim-report').hidden=true;el('claim-export').disabled=true;el('claim-print').disabled=true;}
 function message(text){el('claim-message').hidden=!text;el('claim-message').textContent=text;}
 function sourceTable(rows,claim){
  if(!rows.length)return '<p class="claim-empty">No '+(claim?'claim':'DrillOps')+' lines for this day.</p>';
  return '<table><thead><tr><th>Hole / campaign</th><th>Activity and source</th><th>Hours / metres</th><th class="num">Quantity</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+escape(r.hole||r.hole_num||'No hole')+'<small>'+escape(r.campaign_name||r.project||'')+'</small></td><td class="claim-description">'+escape(r.description||r.code||r.consumable||'Unclassified')+'<small>'+escape(r.notes||r.source_file||'')+'</small><small>'+escape(r.rate_basis||'')+'</small></td><td>'+escape(r.total_time?String(r.total_time)+' h':'—')+'<small>'+(r.total_metres==null?'':escape(number(r.total_metres))+' m')+'</small></td><td class="num">'+escape(number(r.quantity))+'</td><td class="num">'+escape(money(r.unit_rate))+'</td><td class="num '+(r.line_cost==null?'claim-unpriced':'')+'">'+escape(money(r.line_cost))+'</td></tr>').join('')+'</tbody></table>';
 }
 function pairedTable(pairs){
  return '<table><thead><tr><th>Claim activity / hole</th><th>DrillOps activity / hole</th><th>Quantity claim / actual</th><th>Validation rate / actual</th><th>Expected / actual</th><th>Difference</th><th>Result</th></tr></thead><tbody>'+pairs.map(p=>{
   const c=p.claim,e=p.eos;
   return '<tr><td class="claim-description">'+escape(c?.description||'No claim line')+'<small>'+escape(c?.hole||'No hole')+'</small><small>'+escape(c?.notes||'')+'</small></td><td class="claim-description">'+escape(e?.description||'No DrillOps line')+'<small>'+escape(e?.hole||'No hole')+'</small><small>'+escape(e?.notes||'')+'</small><small>'+escape(e?.source_file||'')+'</small></td><td>'+number(c?.quantity)+' / '+number(e?.total_metres??e?.quantity)+'<small>'+escape(e?.total_time||'')+' h</small></td><td>'+money(c?.validation_rate)+' / '+money(e?.unit_rate)+'<small>'+escape(c?.validation_source||'')+'</small></td><td>'+money(c?.expected_cost)+' / '+money(e?.line_cost)+'<small>Submitted '+money(c?.line_cost)+'</small></td><td>'+money(p.difference)+'</td><td>'+escape(p.status)+'<small>'+escape(p.issues.join('; '))+'</small><small>'+escape(p.reason)+'</small></td></tr>';
  }).join('')+'</tbody></table>';
 }
 function filteredDays(){
  const status=el('claim-status').value,term=el('claim-search').value.trim().toLowerCase();
  return report.daily.filter(r=>(status==='all'||(status==='matched')===(r.status==='Matched'))&&(!term||[date(r.key),r.key,...r.claim_rows.map(l=>l.hole),...r.eos_rows.map(l=>l.hole)].join(' ').toLowerCase().includes(term)));
 }
 function renderDays(){
  if(!report)return;
  el('claim-days').innerHTML=filteredDays().map(r=>'<details class="claim-day" data-day="'+escape(r.key)+'"><summary><span class="claim-day-date">'+escape(date(r.key))+'<small>'+r.claim_count+' claim / '+r.eos_count+' DrillOps lines · expand details</small></span><span class="claim-day-number"><small>Validation expected</small>'+money(r.expected)+'</span><span class="claim-day-number"><small>DrillOps priced</small>'+money(r.eos)+'</span><span class="claim-day-number"><small>Difference</small>'+money(r.expected==null?null:r.expected-r.eos)+'</span><span class="claim-day-status '+(r.status==='Matched'?'matched':'')+'">'+escape(r.status)+'</span></summary><div class="claim-day-detail"></div></details>').join('')||'<p class="claim-empty">No days match these filters.</p>';
  el('claim-days').querySelectorAll('details').forEach(node=>node.addEventListener('toggle',()=>{
   if(!node.open||node.dataset.rendered)return;
   const day=report.daily.find(r=>r.key===node.dataset.day);
   node.querySelector('.claim-day-detail').innerHTML='<p class="claim-note">'+escape(day.campaigns.join(' · ')||'No matching DrillOps campaign')+(day.unpriced?' · '+day.unpriced+' unpriced DrillOps lines':'')+'</p><h4>Activity reconciliation</h4><div class="claim-table-scroll">'+pairedTable(day.activity_pairs)+'</div><h4>Claim charge lines</h4><div class="claim-table-scroll">'+sourceTable(day.claim_rows,true)+'</div><h4>Existing DrillOps lines</h4><div class="claim-table-scroll">'+sourceTable(day.eos_rows,false)+'</div>';
   node.dataset.rendered='true';
  }));
 }
 function render(){
  const t=report.totals;
  el('claim-report').hidden=false;message('');el('claim-export').disabled=false;el('claim-print').disabled=false;
  el('claim-scope').textContent=report.project+' · All campaigns · '+date(report.period_start)+'–'+date(report.period_end)+'. The campaign selector does not narrow this multi-campaign claim.';
  el('claim-verdict').classList.toggle('matched',report.reconciled);
  el('claim-verdict').textContent=report.reconciled?'Reconciled — every activity and daily total matches.':t.review_activities+' activities need review · '+t.review_days+' day'+(t.review_days===1?'':'s')+' need review · '+t.matched_days+' matched · '+t.unpriced_lines+' unpriced lines'+(t.outside_lines?' · '+t.outside_lines+' entries outside the claim period':'')+'. The claim is not reconciled.';
  el('claim-totals').innerHTML=[['Submitted claim',money(t.claim_in_period),t.claim_lines+' lines in period'],['Validation expected',money(t.expected_priced),t.validation_missing?t.validation_missing+' lines missing rates — subtotal incomplete':'Includes preserved $0 exceptions'],['DrillOps priced',money(t.eos_priced),t.unpriced_lines+' unpriced lines'],['Activity matches',t.matched_activities+' / '+t.activity_pairs,t.matched_days+' / '+report.daily.length+' days fully matched']].map(([label,value,note])=>'<div class="claim-card"><div class="claim-card-label">'+label+'</div><div class="claim-card-value">'+value+'</div><div class="claim-card-note">'+note+'</div></div>').join('');
  el('claim-source-label').textContent=report.filename+' · Workbook total '+money(t.claim_total)+' · Outside period '+money(t.outside_period)+' · Refreshed '+new Date(report.generated_at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'});
  el('claim-issues-title').textContent=report.warnings.length+' source / pricing issues to review';
  el('claim-issues-list').innerHTML=report.warnings.length?report.warnings.map(w=>'<li>'+escape(w.issue)+'</li>').join(''):'<li>No source or pricing warnings.</li>';
  el('claim-holes').innerHTML='<table><thead><tr><th>Hole</th><th>Campaign</th><th class="num">Claim</th><th class="num">DrillOps priced</th><th class="num">Difference</th><th>Unpriced lines</th></tr></thead><tbody>'+report.holes.map(r=>'<tr><td>'+escape(r.key||'No hole')+'</td><td>'+escape(r.campaigns.join(' · '))+'</td><td class="num">'+money(r.claim)+'</td><td class="num">'+money(r.eos)+'</td><td class="num">'+money(r.difference)+'</td><td>'+r.unpriced+'</td></tr>').join('')+'</tbody></table>';
  el('claim-outside').hidden=!report.outside_rows.length;
  el('claim-outside-table').innerHTML=sourceTable(report.outside_rows,true);
  renderDays();
 }
 async function loadReport(id,current){
  clear();if(!id){message('No saved claims in this project. Save a Depco Exploration workbook to compare it with live costs.');return;}
  message('Comparing every activity and daily total with live DrillOps costs…');
  try{const data=await(await api('/'+encodeURIComponent(id))).json();if(current!==version)return;report=data;render();}
  catch(error){if(current===version){clear();message(error.message);}}
 }
 window.loadClaimReconciliation=async function(selectedId){
  const current=++version;clear();message('Loading saved claims…');canSave=false;setSave();
  try{
   const data=await(await api('')).json();if(current!==version)return;
   canSave=data.can_save;setSave();const prior=selectedId||el('claim-select').value;
   el('claim-select').innerHTML=data.claims.map(c=>'<option value="'+Number(c.id)+'">'+escape(c.filename)+' · '+escape(c.project)+'</option>').join('')||'<option value="">No saved claims</option>';
   if(data.claims.some(c=>String(c.id)===String(prior)))el('claim-select').value=prior;
   await loadReport(el('claim-select').value,current);
  }catch(error){if(current===version)message(error.message);}
 };
 el('claim-select').addEventListener('change',()=>loadReport(el('claim-select').value,++version));
 el('claim-refresh').addEventListener('click',()=>loadClaimReconciliation());
 el('claim-file').addEventListener('change',setSave);
 el('claim-save').addEventListener('click',async()=>{
  const file=el('claim-file').files[0];if(!file||busy||!canSave)return;
  if(!/\.xlsx$/i.test(file.name)){message('Choose an XLSX claim workbook.');return;}
  busy=true;setSave();const current=version;message('Saving the source claim for comparison…');
  try{const form=new FormData();form.append('file',file);const saved=await(await api('',{method:'POST',body:form})).json();if(current!==version)return;el('claim-file').value='';await loadClaimReconciliation(saved.id);}
  catch(error){if(current===version)message(error.message);}finally{busy=false;setSave();}
 });
 function downloadBlob(blob,filename){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 el('claim-download').addEventListener('click',async()=>{if(!report)return;const id=report.id,filename=report.filename;try{downloadBlob(await(await api('/'+id+'/source')).blob(),filename);}catch(error){message(error.message);}});
 el('claim-export').addEventListener('click',()=>{
  if(!report)return;
  const cell=value=>{let text=String(value??'');if(typeof value==='string'&&/^[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
  const rows=[['Date','Hole','Claim activity','DrillOps activity','Claim quantity','DrillOps quantity','DrillOps hours','Validation rate','DrillOps rate','Submitted amount','Expected amount','DrillOps amount','Difference','Status','Issues','Validation source','Claim source','DrillOps source'],...filteredDays().flatMap(d=>d.activity_pairs.map(p=>{const c=p.claim,e=p.eos;return [date(d.key),(c||e).hole,c?.description,e?.description,c?.quantity,e?.total_metres??e?.quantity,e?.total_time,c?.validation_rate,e?.unit_rate,c?.line_cost,c?.expected_cost,e?.line_cost,p.difference,p.status,p.issues.join('; '),c?.validation_source,c?.notes,e?.source_file];}))];
  downloadBlob(new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'depco-activity-reconciliation.csv');
 });
 el('claim-print').addEventListener('click',()=>window.print());
 ['claim-status','claim-search'].forEach(id=>el(id).addEventListener(id==='claim-search'?'input':'change',renderDays));
})();
