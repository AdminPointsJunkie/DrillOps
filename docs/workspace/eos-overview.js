/* CorePlan-informed plod workflow; independent EOS presentation and existing API data. */
let eosOverviewRows=[],eosOverviewStatus='all',eosOverviewRequest=0;
function eosApproval(report){return (getStoredReportApproval(report.date,reportRecordHole(report),report.sourceFile,report.contractor)||{}).status||'pending';}
function renderEosPlods(){
 const labels={pending:'Awaiting approval',approved:'Approved',rejected:'Rejected',query:'Query'};
 const rows=eosOverviewRows.filter(r=>eosOverviewStatus==='all'||eosApproval(r)===eosOverviewStatus).slice(0,12);
 document.querySelectorAll('[data-eos-status]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.eosStatus===eosOverviewStatus)));
 document.getElementById('eos-recent-body').innerHTML=rows.map(r=>{const status=eosApproval(r);return '<tr><td><button class="eos-plod-link" data-key="'+attr(r.key)+'">'+esc(r.id)+'</button></td><td>'+esc(r.date)+'<small>'+esc(r.shift||'Shift not recorded')+'</small></td><td>'+esc(r.rig||'Rig not recorded')+'<small>'+esc(r.hole||'Hole not recorded')+'</small></td><td><span class="eos-status '+(Object.hasOwn(labels,status)?status:'pending')+'">'+esc(labels[status]||status)+'</span></td><td class="num">'+Number(r.metres||0).toLocaleString('en-AU',{maximumFractionDigits:2})+'</td><td class="num">'+(r.unpriced===r.rows.length?'Not priced':cur(r.cost))+(r.unpriced&&r.unpriced!==r.rows.length?' *':'')+'</td></tr>';}).join('')||'<tr><td colspan="6" class="eos-empty">No matching plods recorded.</td></tr>';
}
async function loadEosOverview(){
 const current=++eosOverviewRequest;
 const message=document.getElementById('eos-overview-message');if(!message)return;
 const select=document.getElementById('eos-overview-contractor');select.innerHTML=filteredContractors().map(c=>'<option value="'+attr(c.name)+'">'+esc(c.name)+'</option>').join('');select.value=activeContractor;
 document.getElementById('eos-scope').textContent=workspaceScopeLabel();
 message.textContent='Loading recorded shifts…';
 for(const id of ['total','metres','hours','cost'])document.getElementById('eos-'+id).textContent='—';
 document.getElementById('eos-recent-body').innerHTML='';document.getElementById('eos-time-usage').textContent='';
 try{
  const response=await fetch(API+'/activity-report-data?contractor='+encodeURIComponent(activeContractor),{cache:'no-store'});
  if(!response.ok)throw new Error('Reports could not be loaded. Refresh to try again.');
  const bundle=await response.json();if(current!==eosOverviewRequest)return;
  if(!bundle||!Array.isArray(bundle.activities))throw new Error('The report response could not be read. Refresh to try again.');
  applyActivityReportBundle(bundle);
  const activities=filterWorkspaceActivities(activitiesData).filter(r=>!isMccWeeklyReportRow(r));
  eosOverviewRows=groupDailyReports(activities,filterRowsForActiveProgram(consumablesData)).sort((a,b)=>reportIso(b.date).localeCompare(reportIso(a.date)));
  dailyReportsData=eosOverviewRows;
  const sum=key=>eosOverviewRows.reduce((s,r)=>s+Number(r[key]||0),0);
  document.getElementById('eos-total').textContent=eosOverviewRows.length.toLocaleString();
  document.getElementById('eos-metres').textContent=sum('metres').toLocaleString('en-AU',{maximumFractionDigits:1})+' m';
  document.getElementById('eos-hours').textContent=sum('hours').toLocaleString('en-AU',{maximumFractionDigits:1})+' h';
  const missing=sum('unpriced');document.getElementById('eos-cost').textContent=cur(sum('cost'))+(missing?' *':'');
  document.getElementById('eos-cost-note').textContent=missing?'* '+missing+' unpriced lines; recorded charges only':'Calculated report charges · AUD';
  const categories={};eosOverviewRows.forEach(r=>Object.entries(r.categories||{}).forEach(([key,n])=>categories[key]=(categories[key]||0)+Number(n||0)));
  const total=Object.values(categories).reduce((a,b)=>a+b,0);
  document.getElementById('eos-time-usage').innerHTML=Object.entries(categories).sort((a,b)=>b[1]-a[1]).map(([key,hours])=>'<div class="eos-time-row"><div><span>'+esc(String(key).replaceAll('_',' '))+'</span><strong>'+hours.toFixed(1)+' h</strong></div><progress max="'+Math.max(total,1)+'" value="'+Math.max(hours,0)+'" aria-label="'+attr(key)+' hours"></progress></div>').join('')||'<p class="eos-empty">No time entries recorded.</p>';
  message.textContent='';renderEosPlods();
 }catch(error){if(current!==eosOverviewRequest)return;eosOverviewRows=[];message.textContent=error.message;}
}
document.querySelectorAll('[data-eos-status]').forEach(b=>b.addEventListener('click',()=>{eosOverviewStatus=b.dataset.eosStatus;renderEosPlods();}));
document.getElementById('eos-recent-body').addEventListener('click',e=>{const b=e.target.closest('[data-key]');if(b)openDailyReportDetailByKey(b.dataset.key);});
// Plod filters act on actual report values, rather than opening an unrelated filter panel.
const eosPlodFilters=[['Status','eos-plod-status'],['Shift','eos-plod-shift'],['Rig','eos-plod-rig']];
eosPlodFilters.forEach(([label,id])=>{
 const old=[...document.querySelectorAll('#page-activities .filter-chip')].find(b=>b.textContent.trim()===label);
 if(!old)return;
 const select=document.createElement('select');select.id=id;select.className='filter-chip';select.setAttribute('aria-label',label);select.innerHTML='<option value="">All '+label.toLowerCase()+'s</option>';select.addEventListener('change',()=>filterDailyReportRows());old.replaceWith(select);
});
const originalEosSummary=renderDailyReportSummary;
renderDailyReportSummary=function(rows){
 originalEosSummary(rows);
 const values={status:[['pending','Awaiting approval'],['approved','Approved'],['rejected','Rejected'],['query','Query']],shift:[...new Set(dailyReportsData.map(r=>r.shift).filter(Boolean))].sort().map(v=>[v,v]),rig:[...new Set(dailyReportsData.map(r=>r.rig).filter(Boolean))].sort().map(v=>[v,v])};
 for(const [key,options] of Object.entries(values)){
  const select=document.getElementById('eos-plod-'+key);const previous=select.value;
  select.innerHTML='<option value="">All '+({status:'statuses',shift:'shifts',rig:'rigs'}[key])+'</option>'+options.map(([value,label])=>'<option value="'+attr(value)+'">'+esc(label)+'</option>').join('');select.value=previous;if(select.selectedIndex<0)select.value='';
 }
 filterDailyReportRows();
};
filterDailyReportRows=function(){
 const search=(document.getElementById('report-search')?.value||'').trim().toLowerCase();
 const status=document.getElementById('eos-plod-status')?.value||'',shift=document.getElementById('eos-plod-shift')?.value||'',rig=document.getElementById('eos-plod-rig')?.value||'';
 const reports=new Map(dailyReportsData.map(r=>[r.key,r]));
 document.querySelectorAll('#report-body tr.report-row').forEach(row=>{const report=reports.get(row.dataset.reportKey);row.style.display=report&&(!search||row.dataset.search.includes(search))&&(!status||eosApproval(report)===status)&&(!shift||report.shift===shift)&&(!rig||report.rig===rig)?'':'none';});
};

const originalEosClearFilters=clearDarReportFilters;
clearDarReportFilters=function(){for(const [,id] of eosPlodFilters)document.getElementById(id).value='';return originalEosClearFilters();};
