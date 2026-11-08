/* A contractor operations document, independent of Project's budget and planning report. */
let eosPeriodSourceRows=[],eosPeriodConsumables=[],eosPeriodRows=[],eosPeriodRequest=0,eosPeriodLoading=false,eosPeriodError='',eosPeriodSummary=null;
loadReportsPage=async function(){
 const request=++eosPeriodRequest,version=eosScopeVersion,contractor=activeContractor;
 eosPeriodLoading=true;eosPeriodError='';eosPeriodRows=[];eosPeriodSourceRows=[];eosPeriodConsumables=[];renderEosPeriodReport();
 try{
  if(!contractor)throw Error('Select a contractor to prepare the report.');
  const response=await fetch(API+'/activity-report-data?contractor='+encodeURIComponent(contractor),{cache:'no-store'});
  if(!response.ok)throw Error('Could not load the operations report. Refresh to retry.');
  const bundle=await response.json();if(!Array.isArray(bundle.activities))throw Error('The operations response could not be read.');
  if(request!==eosPeriodRequest||version!==eosScopeVersion)return;
  const rows=bundle.activities.filter(r=>(!r.contractor||r.contractor===contractor)&&!isMccWeeklyReportRow(r)).map(r=>({...r,contractor:r.contractor||contractor}));
  eosPeriodSourceRows=EosProduction.cleanRows(rows).rows;eosPeriodConsumables=bundle.consumables||[];
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
function eosPeriodRegister(rows,options){
 const groups=new Map();
 for(const row of rows){
  const key=EosShiftCharges.key(row);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 return [...groups.values()].map(rows=>({row:rows[0],summary:EosProduction.summarise(rows,options),holes:[...new Set(rows.map(r=>r.hole_num).filter(Boolean))].join(', ')})).sort((a,b)=>EosProduction.date(a.row.date).localeCompare(EosProduction.date(b.row.date))||String(a.row.drill_rig||'').localeCompare(String(b.row.drill_rig||''))||String(a.row.shift||'').localeCompare(String(b.row.shift||'')));
}
function renderEosPeriodReport(){
 const from=document.getElementById('eos-period-from').value,to=document.getElementById('eos-period-to').value,rig=document.getElementById('eos-period-rig').value;
 const error=from&&to&&from>to?'The start date must be on or before the end date.':eosPeriodError;
 const unavailable=eosPeriodLoading||error;
 productionSet('eos-period-message',eosPeriodLoading?'Preparing operations report…':error);
 document.getElementById('eos-period-print').disabled=!!unavailable;
 document.getElementById('eos-period-document').hidden=!!unavailable;
 if(unavailable){eosPeriodSummary=null;renderEosStandbyDetails(null,false);document.getElementById('eos-print-page-style')?.remove();clearEosWeather();return;}
 const rows=eosPeriodRows.filter(r=>{const date=EosProduction.date(r.date);return date&&(!from||date>=from)&&(!to||date<=to)&&(!rig||String(r.drill_rig||'Not recorded').trim()===rig);});
 const options={...eosStandbyOptions(eosPeriodRows),completionEvents:EosProduction.completionEvents(eosPeriodRows)};
 const s=EosProduction.summarise(rows,options);eosPeriodSummary=s;
 const n=productionNumber,showTables=document.getElementById('eos-period-show-tables').checked,showCharges=document.getElementById('eos-period-show-charges').checked;
 const charges=EosShiftCharges.summarise(eosPeriodSourceRows,eosPeriodConsumables);
 document.getElementById('eos-period-charges-heading').hidden=!showCharges;document.getElementById('eos-period-charges-note').hidden=!showCharges;
 productionSet('eos-period-contractor',activeContractor);
 productionSet('eos-period-context',eosScopeLabel());
 productionSet('eos-period-dates',from||to?[from?productionDisplayDate(from,false):'Start',to?productionDisplayDate(to,false):'Latest'].join(' – '):'No dated records');
 productionSet('eos-period-rigs-label',rig||'All rigs');
 updateEosPrintHeader();
 const drilling=contractorCategory(contractorByName(activeContractor))==='Drilling';
 productionSet('eos-period-narrative',rows.length?(drilling?n(s.metres)+' m · '+s.holeCount+' holes · ':n(s.hours)+' h · ')+s.reportCount+' plods · '+s.projects.length+' projects':'No records for these filters.');
 renderEosCostTimeInsights(s,rows,charges,drilling);
 const metrics=drilling?[['Cored',n(s.core),'m'],['Chipped / open hole',n(s.chip),'m'],['Holes completed',s.completedHoles,''],[eosIncludeNonChargeableStandby?'Standby':'Chargeable standby',n(s.standbyHours),'h'],['Drilling time',n(s.drillingHours),'h'],['Source plods',s.reportCount,'']]:[['Recorded activity',n(s.hours),'h'],[eosIncludeNonChargeableStandby?'Standby':'Chargeable standby',n(s.standbyHours),'h'],['Source plods',s.reportCount,'']];
 document.getElementById('eos-period-metrics').innerHTML=metrics.map(([label,value,unit])=>'<div><span>'+label+'</span><strong>'+value+' <small>'+unit+'</small></strong></div>').join('');
 document.getElementById('eos-completed-holes').hidden=!drilling;
 productionSet('eos-completed-holes-count',String(s.completedHoles));
 document.getElementById('eos-completed-holes-body').innerHTML=s.completedRows.slice().sort((a,b)=>EosProduction.date(a.date).localeCompare(EosProduction.date(b.date))).map(r=>'<tr><td>'+esc(r.hole_num)+'<small>'+esc(r.project||'Unassigned project')+'</small></td><td>'+esc(productionDisplayDate(r.date,true))+'<small>'+esc(r.drill_rig||'Rig not recorded')+'</small></td><td>'+esc(r.notes||'')+'<small>'+esc(r.source_file||'Manual entry')+'</small></td></tr>').join('')||'<tr><td colspan="3">No confirmed completions in this selection.</td></tr>';
 const undated=eosPeriodRows.filter(r=>!EosProduction.date(r.date)).length;
 productionSet('eos-period-quality',[s.untimedDrillingMetres?n(s.untimedDrillingMetres)+' m without drilling duration are excluded from penetration rates.':'',s.missingTime?s.missingTime+' entries have no usable duration; time totals may be incomplete.':'',s.other?n(s.other)+' m are other or unclassified.':'',s.invalidMetres?s.invalidMetres+' invalid or negative metre values are excluded.':'',undated?undated+' undated entries are excluded.':''].filter(Boolean).join(' '));
 document.getElementById('eos-period-production-chart').hidden=!drilling;document.getElementById('eos-period-performance-section').hidden=!drilling;
 prepareEosWeather(s);
 document.getElementById('eos-period-chart').innerHTML=productionChart(s,'eos-period-chart-status');
 for(const [id,rows,keys,unit] of [['eos-period-project-chart',s.projects,drilling?undefined:['hours'],drilling?'m':'h']])document.getElementById(id).innerHTML=eosBarChart(rows,keys,unit);
 document.getElementById('eos-period-time-chart').innerHTML=eosDailyTimeChart(s);
 document.getElementById('eos-period-standby-chart').innerHTML=eosStandbyChart(s);
 renderEosStandbyDetails(s,showCharges);
 document.getElementById('eos-period-performance').innerHTML=eosPerformanceFigures(s);document.getElementById('eos-period-rate-chart').innerHTML=eosRateChart(s);document.getElementById('eos-period-daily').innerHTML=showTables?eosDailyRows(s):'';
 productionSet('eos-period-standby-note',eosStandbyNote(s));renderEosOtherActivities('eos-period',s);
 document.getElementById('eos-period-projects').innerHTML=showTables?productionSummaryRows(s.projects):'';
 productionSet('eos-period-standby-summary',n(s.standbyHours)+' hours'+(s.standbyPercent===null?'':', '+n(s.standbyPercent)+'% of displayed activity time')+'.'+(s.missingStandbyTime?' '+s.missingStandbyTime+' standby entries have no usable duration.':''));
 document.getElementById('eos-period-standby').innerHTML=!showTables?'':s.reasons.map(r=>'<tr><td>'+esc(r.label)+(r.missing?' · '+r.missing+' missing duration':'')+'</td><td class="num">'+n(r.hours)+'</td><td class="num">'+r.rows+'</td></tr>').join('')||'<tr><td colspan="3">No standby recorded.</td></tr>';
 document.getElementById('eos-period-register').innerHTML=eosPeriodRegister(rows,options).map(({row:r,summary:s,holes})=>'<tr><td>'+esc(productionDisplayDate(r.date,true))+'<small>'+esc(r.shift||'Shift not recorded')+'</small></td><td>'+esc(r.project||'Unassigned project')+'<small>'+esc(r.drill_rig||'Rig not recorded')+'</small></td><td>'+esc(r.source_file||'Manual entry')+'<small>'+esc(holes||'Hole not recorded')+'</small></td>'+['core','chip','other','standbyHours','hours'].map(k=>'<td class="num">'+n(s[k])+(k==='hours'&&s.missingTime?' *':'')+'</td>').join('')+(showCharges?eosShiftChargeCell(charges.get(EosShiftCharges.key(r))):'')+'</tr>').join('')||'<tr><td colspan="'+(showCharges?9:8)+'">No shifts recorded.</td></tr>';
 productionSet('eos-period-generated','Prepared '+new Date().toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short',timeZone:'Australia/Brisbane'})+' AEST');
}
printPeriodReport=function(){if(!eosPeriodSummary)return;prepareEosPrint();window.print();};
let eosPrintScroll=null;
function prepareEosPrint(){if(isPageActive('reports')&&eosPeriodSummary){
 const main=document.querySelector('main');
 if(!eosPrintScroll)eosPrintScroll={x:window.scrollX,y:window.scrollY,mainX:main.scrollLeft,mainY:main.scrollTop};
 main.scrollTo(0,0);window.scrollTo(0,0);
 document.body.classList.add('eos-period-print');updateEosPrintHeader();document.getElementById('eos-print-page-style').media='print';
}}
window.addEventListener('beforeprint',prepareEosPrint);
window.addEventListener('afterprint',()=>{document.body.classList.remove('eos-period-print');const style=document.getElementById('eos-print-page-style');if(style)style.media='not all';if(eosPrintScroll){const position=eosPrintScroll;eosPrintScroll=null;document.querySelector('main').scrollTo(position.mainX,position.mainY);window.scrollTo(position.x,position.y);}});

function toggleEosPeriodTables(){renderEosPeriodReport();document.querySelectorAll('#eos-period-document .eos-period-data-table').forEach(el=>el.hidden=!document.getElementById('eos-period-show-tables').checked);}

function eosShiftChargeCell(charge){
 if(!charge)return '<td class="num eos-shift-charge">—</td>';
 const incomplete=charge.unpriced||charge.sharedMaterials||charge.excluded;
 const value=charge.priced?cur(charge.total)+(incomplete?' *':''):'—';
 const notes=[charge.unpriced?charge.unpriced+' unpriced lines':'',charge.sharedMaterials?'Shared materials not allocated':'',charge.excluded?'Weekly-billed lines excluded':''].filter(Boolean);
 return '<td class="num eos-shift-charge">'+value+(notes.length?'<small>'+esc(notes.join(' · '))+'</small>':'')+'</td>';
}

// Repeat the actual branded HTML header through the print table's header group.
// Page margins reserve paper space only; the header keeps its screen typography and layout.
function updateEosPrintHeader(){
 let style=document.getElementById('eos-print-page-style');if(!style){style=document.createElement('style');style.id='eos-print-page-style';style.media='not all';document.head.append(style);}
 style.textContent='@page{size:A4 portrait;margin:12mm 12mm 14mm;}';
}

function renderEosCostTimeInsights(s,rows,charges,drilling){
 const el=document.getElementById('eos-cost-time-insights');el.hidden=!drilling;if(!drilling)return;
 const cost=EosShiftCharges.periodCost(rows,charges,s.metres),active=s.drillingHours,inactive=Math.max(0,s.displayedHours-active),pct=s.displayedHours>0?active/s.displayedHours*100:null;
 const money=v=>v==null?'—':v.toLocaleString('en-AU',{style:'currency',currency:'AUD'}),n=productionNumber;
 el.innerHTML='<div class="eos-cost-per-m"><span>Cost per metre'+(cost.partial?' · partial':'')+'</span><strong>'+money(cost.perMetre)+' <small>/ m</small></strong><small>EOS charges + consumables · ex GST</small></div><div class="eos-drilling-time"><div class="eos-time-labels"><strong>Active drilling '+(pct==null?'—':n(pct)+'%')+'</strong><span>Inactive '+(pct==null?'—':n(100-pct)+'%')+'</span></div><div class="eos-utilisation-bar" role="img" aria-label="'+(pct==null?'No recorded activity time':'Active drilling '+n(pct)+' percent; inactive '+n(100-pct)+' percent')+'"><i style="width:'+(pct||0)+'%"></i></div><div class="eos-time-labels"><span>'+n(active)+' h drilling</span><span>'+n(inactive)+' h other included activity</span></div><small>Uses displayed activity time and current standby exclusions.</small></div>'+(cost.partial?'<p class="eos-document-note">Cost per metre is partial: some charges are missing or cannot be uniquely allocated.</p>':'');
}
