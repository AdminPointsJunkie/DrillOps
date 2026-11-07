/* A contractor operations document, independent of Project's budget and planning report. */
let eosPeriodRows=[],eosPeriodRequest=0,eosPeriodLoading=false,eosPeriodError='',eosPeriodSummary=null;
loadReportsPage=async function(){
 const request=++eosPeriodRequest,version=eosScopeVersion,contractor=activeContractor;
 eosPeriodLoading=true;eosPeriodError='';eosPeriodRows=[];renderEosPeriodReport();
 try{
  if(!contractor)throw Error('Select a contractor to prepare the report.');
  const response=await fetch(API+'/activity-report-data?contractor='+encodeURIComponent(contractor),{cache:'no-store'});
  if(!response.ok)throw Error('Could not load the operations report. Refresh to retry.');
  const bundle=await response.json();if(!Array.isArray(bundle.activities))throw Error('The operations response could not be read.');
  if(request!==eosPeriodRequest||version!==eosScopeVersion)return;
  const rows=bundle.activities.filter(r=>(!r.contractor||r.contractor===contractor)&&!isMccWeeklyReportRow(r)).map(r=>({...r,contractor:r.contractor||contractor}));
  rememberEosProjects(rows);eosPeriodRows=EosProduction.cleanRows(rows.filter(r=>EosProduction.scopeMatch(r,eosScope))).rows;
  const select=document.getElementById('eos-period-rig'),previous=select.value;
  select.innerHTML='<option value="">All rigs</option>'+[...new Set(eosPeriodRows.map(r=>String(r.drill_rig||'Not recorded').trim()))].sort().map(r=>'<option value="'+attr(r)+'">'+esc(r)+'</option>').join('');select.value=previous;if(select.selectedIndex<0)select.value='';
  eosPeriodLoading=false;setEosPeriodRange(document.getElementById('eos-period-preset').value);
 }catch(error){if(request!==eosPeriodRequest||version!==eosScopeVersion)return;eosPeriodLoading=false;eosPeriodError=error.message;renderEosPeriodReport();}
};
function setEosPeriodRange(preset){
 document.getElementById('eos-period-preset').value=preset;
 if(preset!=='custom'){
  const dates=eosPeriodRows.map(r=>EosProduction.date(r.date)).filter(Boolean).sort();
  document.getElementById('eos-period-from').value=dates.length?(preset==='month'?dates.at(-1).slice(0,7)+'-01':dates[0]):'';
  document.getElementById('eos-period-to').value=dates.at(-1)||'';
 }
 renderEosPeriodReport();
}
function eosPeriodRegister(rows){
 const groups=new Map();
 for(const row of rows){
  const key=JSON.stringify([row.contractor,row.project||'',row.date,row.source_file||'',row.drill_rig||'',row.shift||'']);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 return [...groups.values()].map(rows=>({row:rows[0],summary:EosProduction.summarise(rows),holes:[...new Set(rows.map(r=>r.hole_num).filter(Boolean))].join(', ')})).sort((a,b)=>EosProduction.date(a.row.date).localeCompare(EosProduction.date(b.row.date))||String(a.row.drill_rig||'').localeCompare(String(b.row.drill_rig||''))||String(a.row.shift||'').localeCompare(String(b.row.shift||'')));
}
function renderEosPeriodReport(){
 const from=document.getElementById('eos-period-from').value,to=document.getElementById('eos-period-to').value,rig=document.getElementById('eos-period-rig').value;
 const error=from&&to&&from>to?'The start date must be on or before the end date.':eosPeriodError;
 const unavailable=eosPeriodLoading||error;
 productionSet('eos-period-message',eosPeriodLoading?'Preparing operations report…':error);
 document.getElementById('eos-period-print').disabled=!!unavailable;
 document.getElementById('eos-period-document').hidden=!!unavailable;
 if(unavailable){eosPeriodSummary=null;return;}
 const rows=eosPeriodRows.filter(r=>{const date=EosProduction.date(r.date);return date&&(!from||date>=from)&&(!to||date<=to)&&(!rig||String(r.drill_rig||'Not recorded').trim()===rig);});
 const s=EosProduction.summarise(rows);eosPeriodSummary=s;
 const n=productionNumber;
 productionSet('eos-period-contractor',activeContractor);
 productionSet('eos-period-context',eosScopeLabel());
 productionSet('eos-period-dates',from||to?[from?productionDisplayDate(from,false):'Start',to?productionDisplayDate(to,false):'Latest'].join(' – '):'No dated records');
 productionSet('eos-period-rigs-label',rig||'All rigs');
 const drilling=contractorCategory(contractorByName(activeContractor))==='Drilling';
 productionSet('eos-period-narrative',rows.length?(drilling?n(s.metres)+' m · '+s.holeCount+' holes · ':n(s.hours)+' h · ')+s.reportCount+' plods · '+s.projects.length+' projects':'No records for these filters.');
 const metrics=drilling?[['Cored',n(s.core),'m'],['Chipped / open hole',n(s.chip),'m'],['Other / unclassified',n(s.other),'m'],['Standby',n(s.standbyHours),'h'],['Drilling time',n(s.drillingHours),'h'],['Source plods',s.reportCount,'']]:[['Recorded activity',n(s.hours),'h'],['Standby',n(s.standbyHours),'h'],['Source plods',s.reportCount,'']];
 document.getElementById('eos-period-metrics').innerHTML=metrics.map(([label,value,unit])=>'<div><span>'+label+'</span><strong>'+value+' <small>'+unit+'</small></strong></div>').join('');
 const undated=eosPeriodRows.filter(r=>!EosProduction.date(r.date)).length;
 productionSet('eos-period-quality',[s.missingTime?s.missingTime+' entries have no usable duration; time totals may be incomplete.':'',s.other?n(s.other)+' m are other or unclassified.':'',s.invalidMetres?s.invalidMetres+' invalid or negative metre values are excluded.':'',undated?undated+' undated entries are excluded.':''].filter(Boolean).join(' '));
 document.getElementById('eos-period-production-chart').hidden=!drilling;
 document.getElementById('eos-period-chart').innerHTML=productionChart(s,'eos-period-chart-status');
 for(const [id,rows,keys,unit] of [['eos-period-rig-chart',s.rigs,drilling?undefined:['hours'],drilling?'m':'h'],['eos-period-project-chart',s.projects,drilling?undefined:['hours'],drilling?'m':'h'],['eos-period-standby-chart',s.reasons,['hours'],'h']])document.getElementById(id).innerHTML=eosBarChart(rows,keys,unit);
 document.getElementById('eos-period-time-chart').innerHTML=eosTimeChart(s);
 document.getElementById('eos-period-rigs').innerHTML=productionSummaryRows(s.rigs);
 document.getElementById('eos-period-projects').innerHTML=productionSummaryRows(s.projects);
 productionSet('eos-period-standby-summary',n(s.standbyHours)+' hours'+(s.standbyPercent===null?'':', '+n(s.standbyPercent)+'% of recorded activity time')+'.'+(s.missingStandbyTime?' '+s.missingStandbyTime+' standby entries have no usable duration.':''));
 document.getElementById('eos-period-standby').innerHTML=s.reasons.map(r=>'<tr><td>'+esc(r.label)+(r.missing?' · '+r.missing+' missing duration':'')+'</td><td class="num">'+n(r.hours)+'</td><td class="num">'+r.rows+'</td></tr>').join('')||'<tr><td colspan="3">No standby recorded.</td></tr>';
 document.getElementById('eos-period-register').innerHTML=eosPeriodRegister(rows).map(({row:r,summary:s,holes})=>'<tr><td>'+esc(productionDisplayDate(r.date,true))+'<small>'+esc(r.shift||'Shift not recorded')+'</small></td><td>'+esc(r.project||'Unassigned project')+'<small>'+esc(r.drill_rig||'Rig not recorded')+'</small></td><td>'+esc(r.source_file||'Manual entry')+'<small>'+esc(holes||'Hole not recorded')+'</small></td>'+['core','chip','other','standbyHours','hours'].map(k=>'<td class="num">'+n(s[k])+(k==='hours'&&s.missingTime?' *':'')+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="8">No shifts recorded.</td></tr>';
 productionSet('eos-period-generated','Prepared '+new Date().toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short',timeZone:'Australia/Brisbane'})+' AEST');
}
printPeriodReport=function(){if(!eosPeriodSummary)return;document.body.classList.add('eos-period-print');window.print();};
window.addEventListener('beforeprint',()=>{if(isPageActive('reports'))document.body.classList.add('eos-period-print');});
window.addEventListener('afterprint',()=>document.body.classList.remove('eos-period-print'));

function toggleEosPeriodTables(){document.querySelectorAll('#eos-period-document .eos-period-data-table').forEach(el=>el.hidden=!document.getElementById('eos-period-show-tables').checked);}
