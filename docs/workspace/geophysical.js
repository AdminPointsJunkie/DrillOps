/* Contractor type selects the report, independently of the contractor name. */
(()=>{
 const originalHome=loadEosOverview,originalReport=loadReportsPage;let request=0;
 const type=()=>contractorCategory(contractorByName(activeContractor));
 function selectView(id,service){
  const page=document.getElementById(id);page.classList.toggle('service-report-active',service);
  let panel=page.querySelector('.service-report');if(!panel){panel=document.createElement('section');panel.className='service-report';page.append(panel);}panel.hidden=!service;return panel;
 }
 async function load(id){
  const category=type(),contractor=activeContractor,seq=++request,panel=selectView(id,true),logging=category==='Geophysical Logging';
  panel.innerHTML=`<div class="eos-page-heading"><div><p>EOS / ${esc(category)}</p><h1>${esc(contractor)} · ${logging?'Logging':'Service'} report</h1></div><button class="btn-ghost" data-refresh>Refresh</button></div><p role="status">Loading service records…</p>`;
  panel.querySelector('[data-refresh]').onclick=()=>load(id);
  try{
   const response=await fetch(API+'/activity-report-data?contractor='+encodeURIComponent(contractor),{cache:'no-store'});if(!response.ok)throw Error('Could not load service records. Refresh to retry.');
   const data=await response.json();if(seq!==request||contractor!==activeContractor)return;
   const rows=(data.activities||[]).filter(r=>(!r.contractor||r.contractor===contractor)&&EosProduction.scopeMatch(r,eosScope));
   const scope=window.businessImportDestination?.();
   panel.innerHTML=`<div class="eos-page-heading"><div><p>EOS / ${esc(category)}</p><h1>${esc(contractor)} · ${logging?'Logging':'Service'} report</h1><p>${esc(scope?.label||'Selected workspace and project filters')}</p></div><div><button class="btn-ghost" data-refresh>Refresh</button><button class="btn-ghost" data-print>Print report</button></div></div><div class="eos-controls"><label>From <input type="date" data-from></label><label>To <input type="date" data-to></label><a href="./eos.html?view=importer">Import reports</a></div><div data-results></div>`;
   panel.querySelector('[data-refresh]').onclick=()=>load(id);panel.querySelector('[data-print]').onclick=()=>window.print();
   function render(){
    const from=panel.querySelector('[data-from]').value,to=panel.querySelector('[data-to]').value;
    const filtered=rows.filter(r=>{const d=EosProduction.date(r.date);return (!from||d>=from)&&(!to||(d&&d<=to));});
    const s=ServiceProduction.summarise(filtered,category),n=v=>Number(v).toLocaleString('en-AU',{maximumFractionDigits:2}),money=v=>Number(v).toLocaleString('en-AU',{style:'currency',currency:'AUD'});
    const metrics=logging?[['Reports recorded',s.reports],['Holes logged',s.holes],['Logged interval metres',n(s.metres)+' m'],['Logging hours',n(s.hours)+' h'],['Recorded charges',money(s.charges)]]:[['Service reports',s.reports],['Recorded hours',n(s.hours)+' h'],['Recorded charges',money(s.charges)]];
    panel.querySelector('[data-results]').innerHTML=`<div class="eos-metrics">${metrics.map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><p>${logging?'Logged metres sum the length of each recorded logging pass, including repeat passes. Logging hours include logging runs only; induction, travel and quote charge lines are excluded.':'Hours use recorded activity durations; charges use recorded report costs.'} Reports count source pages and dates. ${s.unpriced?n(s.unpriced)+' entries have no recorded price. ':''}${s.missingIntervals?n(s.missingIntervals)+' logging runs have no usable interval.':''}</p><h2>${logging?'Logging runs and field activity':'Service activity'}</h2>${filtered.length?'':'<p>No reports recorded for this selection.</p>'}<div style="overflow:auto"><table style="width:100%"><thead><tr><th>Date</th><th>Hole</th><th>Activity / tool</th>${logging?'<th>From → To (m)</th>':''}<th>Duration</th><th>Source</th></tr></thead><tbody>${s.operations.map(r=>`<tr><td>${esc(r.date||'Not recorded')}</td><td>${esc(r.hole_num||'—')}</td><td>${esc(r.code||'')} · ${esc(r.notes||'')}</td>${logging?`<td>${esc(r.metres_from??'—')} → ${esc(r.metres_to??'—')}</td>`:''}<td>${esc(r.total_time||'—')}</td><td>${esc(r.source_file||'Manual entry')}</td></tr>`).join('')}</tbody></table></div><h2>Recorded charges</h2><p>${money(s.charges)}${s.unpriced?' · incomplete pricing':''}</p><p>Amounts are report charges, not invoice totals.</p>`;
   }
   panel.querySelectorAll('input').forEach(input=>input.onchange=render);render();
  }catch(error){if(seq===request)panel.querySelector('[role=status]').textContent=error.message;}
 }
 loadEosOverview=function(){if(type()!=='Drilling')return load('page-app-home');request++;selectView('page-app-home',false);return originalHome();};
 loadReportsPage=function(){if(type()!=='Drilling')return load('page-reports');request++;selectView('page-reports',false);return originalReport();};
})();
