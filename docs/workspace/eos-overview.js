/* CorePlan-informed plod workflow; independent EOS presentation and existing API data. */
let eosOverviewActivityRows=[],eosOverviewReady=false;
function renderEosOverviewTime(){
 if(!eosOverviewReady)return;
 const summary=EosProduction.summarise(eosOverviewActivityRows,eosStandbyOptions());
 document.getElementById('eos-time-usage').innerHTML=eosTimeChart(summary);document.getElementById('eos-overview-standby').innerHTML=eosStandbyChart(summary);
 document.getElementById('eos-overview-production').innerHTML=productionChart(summary,'eos-overview-chart-status');document.getElementById('eos-overview-rigs').innerHTML=eosBarChart(summary.rigs);
 renderEosOtherActivities('eos-overview',summary);productionSet('eos-overview-standby-note',eosStandbyNote(summary));productionSet('eos-completed',summary.completedHoles);
}
let eosOverviewRows=[],eosOverviewStatus='all',eosOverviewRequest=0;
function eosApproval(report){return (getStoredReportApproval(report.date,reportRecordHole(report),report.sourceFile,report.contractor)||{}).status||'pending';}
async function loadEosOverview(){
 const current=++eosOverviewRequest,scopeVersion=eosScopeVersion;
 const message=document.getElementById('eos-overview-message');if(!message)return;
 renderEosScopeControls();document.getElementById('eos-overview-contractor-name').textContent=activeContractor;
 document.getElementById('eos-scope').textContent=eosScopeLabel();
 message.textContent='Loading recorded shifts…';
 for(const id of ['total','metres','completed','hours','cost'])document.getElementById('eos-'+id).textContent='—';
 document.getElementById('eos-overview-other-chart').innerHTML='';productionSet('eos-overview-other-summary','');document.getElementById('eos-overview-production').innerHTML='';document.getElementById('eos-overview-rigs').innerHTML='';document.getElementById('eos-time-usage').textContent='';eosOverviewActivityRows=[];eosOverviewReady=false;document.getElementById('eos-overview-standby').textContent='';productionSet('eos-overview-standby-note','');
 try{
  const response=await fetch(API+'/activity-report-data?contractor='+encodeURIComponent(activeContractor),{cache:'no-store'});
  if(!response.ok)throw new Error('Reports could not be loaded. Refresh to try again.');
  const bundle=await response.json();if(current!==eosOverviewRequest||scopeVersion!==eosScopeVersion)return;
  if(!bundle||!Array.isArray(bundle.activities))throw new Error('The report response could not be read. Refresh to try again.');
  applyActivityReportBundle(bundle);rememberEosProjects(bundle.activities);
  const activities=filterWorkspaceActivities(activitiesData).filter(r=>!isMccWeeklyReportRow(r));
  eosOverviewRows=groupDailyReports(activities,filterRowsForActiveProgram(consumablesData)).sort((a,b)=>reportIso(b.date).localeCompare(reportIso(a.date)));

  const sum=key=>eosOverviewRows.reduce((s,r)=>s+Number(r[key]||0),0);
  document.getElementById('eos-total').textContent=eosOverviewRows.length.toLocaleString();
  document.getElementById('eos-metres').textContent=sum('metres').toLocaleString('en-AU',{maximumFractionDigits:1})+' m';
  document.getElementById('eos-hours').textContent=sum('hours').toLocaleString('en-AU',{maximumFractionDigits:1})+' h';
  const missing=sum('unpriced');document.getElementById('eos-cost').textContent=cur(sum('cost'))+(missing?' *':'');
  document.getElementById('eos-cost-note').textContent=missing?'* '+missing+' unpriced lines; recorded charges only':'Calculated report charges · AUD';
  eosOverviewActivityRows=activities;eosOverviewReady=true;renderEosOverviewTime();
  message.textContent='';
 }catch(error){if(current!==eosOverviewRequest||scopeVersion!==eosScopeVersion)return;eosOverviewRows=[];message.textContent=error.message;}
}
// Plod filters act on actual report values, rather than opening an unrelated filter panel.
const eosPlodFilters=[['Status','eos-plod-status'],['Shift','eos-plod-shift'],['Rig','eos-plod-rig']];
eosPlodFilters.forEach(([label,id])=>{
 const old=[...document.querySelectorAll('#page-activities .filter-chip')].find(b=>b.textContent.trim()===label);
 if(!old)return;
 const select=document.createElement('select');select.id=id;select.className='filter-chip';select.setAttribute('aria-label',label);select.innerHTML='<option value="">All '+label.toLowerCase()+'s</option>';select.addEventListener('change',()=>filterDailyReportRows());old.replaceWith(select);
});
const originalEosSummary=renderDailyReportSummary;
// Import time is independent of the handwritten operational date.
function eosImportDay(value){
 const date=new Date(value);if(!value||Number.isNaN(date.getTime()))return '';
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Brisbane',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
function eosReportImportedAt(report){
 if(!report.sourceFile||report.sourceFile==='Manual entry')return null;
 const times=(report.rows||[]).map(r=>r.created_at?Date.parse(r.created_at):NaN).filter(Number.isFinite);
 return times.length?new Date(Math.min(...times)).toISOString():null;
}
function eosMatchesImportDate(report,period,date,now=new Date()){
 if(!period)return true;
 const day=eosImportDay(eosReportImportedAt(report));if(!day)return false;
 const target=period==='date'?date:eosImportDay(new Date(now.getTime()-(period==='yesterday'?86400000:0)));
 return !!target&&day===target;
}
const importFilter=document.createElement('label');
importFilter.innerHTML='Imported <select id="eos-import-period" aria-label="Imported"><option value="">Any time</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="date">Choose date</option></select> <input id="eos-import-date" aria-label="Import date" type="date" hidden> <small title="Import dates use Australia/Brisbane time">AEST</small>';
document.querySelector('#page-activities .report-register-filters').append(importFilter);
document.getElementById('eos-import-period').addEventListener('change',()=>{document.getElementById('eos-import-date').hidden=document.getElementById('eos-import-period').value!=='date';filterDailyReportRows();});
document.getElementById('eos-import-date').addEventListener('change',()=>filterDailyReportRows());
const importResults=document.createElement('p');importResults.id='eos-import-results';importResults.setAttribute('role','status');importResults.hidden=true;
importFilter.parentElement.after(importResults);
renderDailyReportSummary=function(rows){
 if(!isPageActive('activities'))return;
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
 const period=document.getElementById('eos-import-period')?.value||'',date=document.getElementById('eos-import-date')?.value||'';
 let visible=0;
 document.querySelectorAll('#report-body tr.report-row').forEach(row=>{
  const report=reports.get(row.dataset.reportKey);
  const matches=report&&(!search||row.dataset.search.includes(search))&&(!status||eosApproval(report)===status)&&(!shift||report.shift===shift)&&(!rig||report.rig===rig)&&eosMatchesImportDate(report,period,date);
  row.style.display=matches?'':'none';if(matches)visible++;else {const check=row.querySelector('.row-check');if(check)check.checked=false;}
  const cell=row.querySelector('.plod-cell');
  if(cell&&!cell.querySelector('.report-import-time')){const stamp=eosReportImportedAt(report);const small=document.createElement('small');small.className='report-import-time';small.style.cssText='display:block;flex-basis:100%;color:var(--muted);font-weight:400';cell.style.flexWrap='wrap';small.textContent=stamp?'Imported '+new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(stamp))+' AEST':'Import date unavailable';cell.append(small);}
 });
 const feedback=document.getElementById('eos-import-results');if(feedback){feedback.hidden=!period;feedback.textContent=visible+' report'+(visible===1?'':'s')+' match the selected filters. Import dates use Brisbane time.';}
 updateBulkReportSelection();
};

const originalEosClearFilters=clearDarReportFilters;
clearDarReportFilters=function(){for(const [,id] of eosPlodFilters)document.getElementById(id).value='';document.getElementById('eos-import-period').value='';document.getElementById('eos-import-date').value='';document.getElementById('eos-import-date').hidden=true;return originalEosClearFilters();};
