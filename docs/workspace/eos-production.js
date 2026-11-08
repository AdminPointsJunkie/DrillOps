/* The Production page uses activity data, including zero-metre standby rows. */
let eosProductionRequest=0,eosProductionLoading=false,eosProductionError='',eosProductionSummary=null;
const productionNumber=(value,digits=1)=>Number(value||0).toLocaleString('en-AU',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const productionSet=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
let eosIncludeNonChargeableStandby=false;
const eosStandbyOptions=completionSource=>({includeNonChargeable:eosIncludeNonChargeableStandby,completionSource});
function setEosStandbyPreference(value){
 eosIncludeNonChargeableStandby=!!value;document.querySelectorAll('[data-eos-standby-toggle]').forEach(input=>input.checked=eosIncludeNonChargeableStandby);
 if(isPageActive('production'))renderDailyProduction();else if(isPageActive('reports'))renderEosPeriodReport();else if(isPageActive('app-home'))renderEosOverviewTime();
}
const productionBit=row=>String(row.bit_type||'').trim()||'Unspecified';
populateProductionDimensionFilters=function(){
 for(const [id,getter,label] of [['production-rig',r=>String(r.drill_rig||'Unspecified').trim(),'All rigs'],['production-drill-type',productionBit,'All bit types']]){
  const select=document.getElementById(id),current=select.value,values=[...new Set(productionRawData.map(getter))].sort();
  select.innerHTML='<option value="">'+label+'</option>'+values.map(v=>'<option value="'+attr(v)+'">'+esc(v)+'</option>').join('');select.value=current;if(select.selectedIndex<0)select.value='';
 }
};
loadDailyProduction=async function(){
 const request=++eosProductionRequest,scopeVersion=eosScopeVersion,contractor=activeContractor;
 eosProductionLoading=true;eosProductionError='';productionRawData=[];renderDailyProduction();
 const names=contractor?[contractor]:[];
 try{
  if(!names.length)throw Error('Select a contractor to view production.');
  const bundles=await Promise.all(names.map(async name=>{
   const response=await fetch(API+'/activity-report-data?contractor='+encodeURIComponent(name),{cache:'no-store'});
   if(!response.ok)throw Error('Could not load '+name+'. Refresh to retry; incomplete totals are not shown.');
   const bundle=await response.json();if(!Array.isArray(bundle.activities))throw Error('The production response could not be read.');
   return bundle.activities.filter(r=>(!r.contractor||r.contractor===name)&&!isMccWeeklyReportRow(r)).map(r=>({...r,contractor:r.contractor||name}));
  }));
  if(request!==eosProductionRequest||scopeVersion!==eosScopeVersion)return;
  const all=bundles.flat();rememberEosProjects(all);
  productionRawData=EosProduction.cleanRows(all.filter(r=>EosProduction.scopeMatch(r,eosScope))).rows;
  populateProductionDimensionFilters();eosProductionLoading=false;
  setProductionDatePreset(document.getElementById('production-date-preset').value);
 }catch(error){if(request!==eosProductionRequest||scopeVersion!==eosScopeVersion)return;eosProductionLoading=false;eosProductionError=error.message;productionRawData=[];renderDailyProduction();}
};
setProductionDatePreset=function(preset){
 const dates=productionRawData.map(r=>EosProduction.date(r.date)).filter(Boolean).sort();
 const from=document.getElementById('production-from'),to=document.getElementById('production-to');document.getElementById('production-date-preset').value=preset;
 if(preset!=='custom'){
  from.value='';to.value='';
  if(dates.length){const latest=dates.at(-1);to.value=latest;
   if(preset==='latest-month')from.value=latest.slice(0,7)+'-01';
   else if(preset==='last-30'){const start=new Date(latest+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-29);from.value=start.toISOString().slice(0,10);}
   else if(preset==='year')from.value=latest.slice(0,4)+'-01-01';
   else if(preset==='all')from.value=dates[0];
  }
 }
 renderDailyProduction();
};
function productionChart(summary,statusId='production-chart-status'){
 const byMonth=summary.daily.length>45,groups=new Map();
 for(const day of summary.daily){const key=byMonth?day.label.slice(0,7):day.label;if(!groups.has(key))groups.set(key,{date:key,core:0,chip:0,other:0});const group=groups.get(key);for(const k of ['core','chip','other'])group[k]+=day[k];}
 const data=[...groups.values()],max=Math.max(0,...data.map(d=>d.core+d.chip+d.other));
 productionSet(statusId,byMonth?'Monthly totals':'Daily totals');
 if(!max)return '<p class="production-empty">No metres recorded for these filters.</p>';
 const w=1000,h=240,left=54,right=14,top=16,bottom=42,plot=w-left-right,bar=plot/Math.max(data.length,1),scale=(h-top-bottom)/max;
 const colours={core:'#315d49',chip:'#8caf96',other:'#cbd2cc'};
 let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+(byMonth?'Monthly':'Daily')+' cored, chipped and other metres"><title>Recorded production by '+(byMonth?'month':'day')+'</title>';
 for(let i=0;i<=4;i++){const value=max*i/4,y=h-bottom-value*scale;svg+='<path d="M'+left+' '+y+'H'+(w-right)+'" stroke="#e2e8e2"/><text x="'+(left-9)+'" y="'+(y+4)+'" text-anchor="end">'+Math.round(value).toLocaleString('en-AU')+'</text>';}
 data.forEach((d,i)=>{let stacked=0;for(const kind of ['core','chip','other']){const value=d[kind];if(!value)continue;const height=value*scale;svg+='<rect x="'+(left+i*bar+bar*.18)+'" y="'+(h-bottom-(stacked+value)*scale)+'" width="'+(bar*.64)+'" height="'+height+'" fill="'+colours[kind]+'"><title>'+esc(d.date+' · '+kind+': '+productionNumber(value)+' m')+'</title></rect>';stacked+=value;}
  if(i%Math.ceil(data.length/12)===0||i===data.length-1)svg+='<text x="'+(left+i*bar+bar/2)+'" y="'+(h-15)+'" text-anchor="middle">'+esc(byMonth?d.date:productionDisplayDate(d.date,true))+'</text>';
 });
 const producing=data.filter(d=>d.core+d.chip+d.other>0),average=producing.reduce((sum,d)=>sum+d.core+d.chip+d.other,0)/producing.length;
 const y=h-bottom-average*scale;svg+='<path class="eos-average-line" d="M'+left+' '+y+'H'+(w-right)+'" stroke="#a57b35" stroke-width="2" stroke-dasharray="7 5"/><text class="eos-average-label" x="'+(w-right-4)+'" y="'+Math.max(12,y-7)+'" text-anchor="end">Avg / production '+(byMonth?'month':'day')+': '+productionNumber(average)+' m</text>';
 return svg+'</svg>';
}
function productionSummaryRows(rows,rigs=false){return rows.map(r=>'<tr><td>'+esc(rigs?r.contractor+' / '+r.label:r.label)+'</td>'+['core','chip','other','metres','completedHoles','standbyHours','hours'].map(k=>'<td class="num">'+productionNumber(r[k],k==='completedHoles'?0:1)+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="8" class="production-empty">No recorded activities for these filters.</td></tr>';}
renderDailyProduction=function(){
 const rig=document.getElementById('production-rig').value,bit=document.getElementById('production-drill-type').value,from=document.getElementById('production-from').value,to=document.getElementById('production-to').value,contractor=activeContractor;
 const rangeError=from&&to&&from>to?'The start date must be on or before the end date.':'';
 const unavailable=eosProductionLoading||eosProductionError||rangeError;
 productionSet('production-message',eosProductionLoading?'Loading recorded production…':eosProductionError||rangeError);
 document.getElementById('production-print').disabled=!!unavailable;
 productionFilteredData=unavailable?[]:productionRawData.filter(r=>{const date=EosProduction.date(r.date);return date&&(!from||date>=from)&&(!to||date<=to)&&(!rig||String(r.drill_rig||'Unspecified').trim()===rig)&&(!bit||productionBit(r)===bit);});
 const showTables=document.getElementById('production-show-tables').checked;
 const summary=EosProduction.summarise(productionFilteredData,eosStandbyOptions(productionRawData));eosProductionSummary=unavailable?null:summary;
 productionSet('production-context',eosScopeLabel());
 productionSet('production-report-filters',[contractor||'No contractor selected',rig||'All rigs',bit||'All bit types',from||to?(from?productionDisplayDate(from,false):'Start')+' – '+(to?productionDisplayDate(to,false):'Latest'):'All available dates'].join(' · '));
 const value=(n,suffix='')=>unavailable?'—':productionNumber(n)+suffix;
 productionSet('production-kpi-metres',value(summary.metres,' m'));productionSet('production-kpi-core',value(summary.core,' m'));productionSet('production-kpi-chip',value(summary.chip,' m'));productionSet('production-kpi-standby',value(summary.standbyHours,' h'));
 productionSet('production-kpi-days',unavailable?'—':summary.productionDays);productionSet('production-kpi-recorded-days',unavailable?'—':summary.recordedDays);productionSet('production-kpi-completed',unavailable?'—':summary.completedHoles);productionSet('production-kpi-drilling-hours',value(summary.drillingHours,' h'));
 productionSet('production-kpi-counts',unavailable?'—':summary.reportCount+' / '+summary.rigs.length+' / '+summary.holeCount);
 productionSet('production-kpi-best',value(summary.best?.metres,' m'));productionSet('production-kpi-best-date',summary.best?productionDisplayDate(summary.best.label,true):'No production in range');
 productionSet('production-unclassified',summary.other?productionNumber(summary.other)+' m other / unclassified':'Cored + chipped + other recorded metres');
 productionSet('production-standby-share',summary.standbyPercent===null?'No recorded hours':productionNumber(summary.standbyPercent)+'% of '+productionNumber(summary.displayedHours)+' displayed hours');
 productionSet('production-standby-context',summary.missingStandbyTime?summary.missingStandbyTime+' entries without duration':'Hours by recorded reason');
 productionSet('production-standby-label',eosIncludeNonChargeableStandby?'Standby':'Chargeable standby');productionSet('production-standby-note',eosStandbyNote(summary));
 const undated=productionRawData.filter(r=>!EosProduction.date(r.date)).length;
 const quality=[summary.other?productionNumber(summary.other)+' m are other or unclassified; they have not been assumed to be core or chip.':'',summary.untimedDrillingMetres?productionNumber(summary.untimedDrillingMetres)+' m have no drilling duration and are excluded from penetration rates.':'',summary.missingTime?summary.missingTime+' entries have no usable duration; hours and standby shares may be incomplete.':'',undated?undated+' undated entries are excluded from this dated report.':'',summary.invalidMetres?summary.invalidMetres+' invalid or negative metre values are excluded from metre totals.':''].filter(Boolean);
 productionSet('production-quality',unavailable?'':quality.join(' '));
 document.getElementById('production-chart').innerHTML=unavailable?'':productionChart(summary);
 document.getElementById('production-projects').innerHTML=unavailable||!showTables?'':productionSummaryRows(summary.projects);
 document.getElementById('production-rigs').innerHTML=unavailable||!showTables?'':productionSummaryRows(summary.rigs,true);
 document.getElementById('production-standby-reasons').innerHTML=unavailable||!showTables?'':summary.reasons.map(r=>'<tr><td>'+esc(r.label)+(r.missing?' · '+r.missing+' missing duration':'')+'</td><td class="num">'+productionNumber(r.hours)+'</td><td class="num">'+(summary.standbyHours?productionNumber(r.hours/summary.standbyHours*100)+'%':'—')+'</td><td class="num">'+r.rows+'</td></tr>').join('')||'<tr><td colspan="4" class="production-empty">No standby recorded for these filters.</td></tr>';
 for(const [id,rows,keys,unit] of [['production-project-chart',summary.projects],['production-rig-chart',summary.rigs]])document.getElementById(id).innerHTML=unavailable?'':eosBarChart(rows,keys,unit);
 document.getElementById('production-time-chart').innerHTML=unavailable?'':eosTimeChart(summary);
 document.getElementById('production-standby-chart').innerHTML=unavailable?'':eosStandbyChart(summary);
 for(const [id,html] of [['production-performance',eosPerformanceFigures(summary)],['production-rate-chart',eosRateChart(summary)],['production-daily',showTables?eosDailyRows(summary):'']])document.getElementById(id).innerHTML=unavailable?'':html;
 renderEosMoves('production',summary,unavailable);
 productionSet('production-row-count',productionFilteredData.length);renderProductionDetails();
 productionSet('production-generated','Prepared '+new Date().toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short',timeZone:'Australia/Brisbane'})+' AEST');
};
function renderProductionDetails(){
 const visible=document.getElementById('production-show-detail').checked;document.getElementById('production-detail').hidden=!visible;
 document.getElementById('production-body').innerHTML=visible?productionFilteredData.slice().sort((a,b)=>EosProduction.date(a.date).localeCompare(EosProduction.date(b.date))).map(r=>'<tr><td>'+esc(r.project||'Unassigned project')+'<small>'+esc(r.contractor)+'</small></td><td>'+esc(productionDisplayDate(r.date,true))+'<small>'+esc(r.shift||'')+'</small></td><td>'+esc(r.drill_rig||'Not recorded')+'<small>'+esc(r.hole_num||'')+'</small></td><td>'+esc(r.source_file||'Manual entry')+'<small>'+esc(r.code||'No code')+'</small></td><td>'+({core:'Cored',chip:'Chipped',other:'Other / unclassified'}[EosProduction.method(r)])+'</td><td class="num">'+(Number.isFinite(Number(r.total_metres))&&r.total_metres!=null?productionNumber(r.total_metres):'—')+'</td><td class="num">'+(EosProduction.hours(r)===null?'Not recorded':productionNumber(EosProduction.hours(r)))+'</td><td>'+esc(EosProduction.standby(r)||'—')+(EosProduction.standby(r)?'<small>'+esc(EosProduction.standbyChargeability(r))+'</small>':'')+'</td></tr>').join(''):'';
}
function toggleProductionDetail(){renderProductionDetails();}
function printProductionReport(){if(!eosProductionSummary)return;document.body.classList.add('eos-production-print');window.print();}
window.addEventListener('beforeprint',()=>{if(document.getElementById('page-production').classList.contains('active'))document.body.classList.add('eos-production-print');});
window.addEventListener('afterprint',()=>document.body.classList.remove('eos-production-print'));
downloadProductionCsv=function(){
 if(!eosProductionSummary||!productionFilteredData.length){toast('No recorded activities to export.');return;}
 const rows=[['Project','Program','Contractor','Date','Shift','Rig','Hole','Source plod','Code','Bit type','Production type','Metres','Recorded hours','Standby reason','Standby chargeability','Included in standby total','Site move type','Hole completed'],...productionFilteredData.map(r=>[r.project,r.program,r.contractor,EosProduction.date(r.date),r.shift,r.drill_rig,r.hole_num,r.source_file,r.code,r.bit_type,EosProduction.method(r),r.total_metres,EosProduction.hours(r),EosProduction.standby(r),EosProduction.standby(r)?EosProduction.standbyChargeability(r):'',EosProduction.standby(r)?EosProduction.standbyIncluded(r,eosStandbyOptions()):'',EosProduction.siteMove(r),eosProductionSummary.completedRows.includes(r)])];
 const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@\t\r-]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='EOS-production-'+(document.getElementById('production-from').value||'all')+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
};
/* Shared visual summaries for Production and the printable operations report. */
function eosBarChart(rows,keys=['core','chip','other'],unit='m'){
 const names={chargeableHours:'Chargeable',nonChargeableHours:'Non-chargeable',moveOnlyHours:'Site move',combinedMoveHours:'Move + setup'};
 const total=r=>keys.reduce((sum,k)=>sum+(Number(r[k])||0),0),max=Math.max(0,...rows.map(total));
 if(!rows.length)return '<p class="production-empty">No records for these filters.</p>';
 return '<div class="eos-bars">'+rows.map(r=>'<div class="eos-bar-row"><div class="eos-bar-label"><span>'+esc(r.label)+'</span><strong>'+productionNumber(total(r))+' <small>'+unit+'</small></strong></div><div class="eos-bar-track" role="img" aria-label="'+attr(r.label+': '+keys.map(k=>(names[k]||k)+' '+productionNumber(r[k])+' '+unit).join(', '))+'">'+keys.map(k=>'<span class="eos-bar-'+k+'" style="width:'+(max?Math.max(0,Number(r[k])||0)/max*100:0)+'%" title="'+attr((names[k]||k)+': '+productionNumber(r[k])+' '+unit)+'"></span>').join('')+'</div></div>').join('')+'</div>';
}
function eosTimeChart(s){
 const chartHours=s.displayedHours??s.hours;
 const parts=[{label:'Drilling',hours:s.drillingHours,colour:'#315d49'},{label:'Standby',hours:s.standbyHours,colour:'#c5aa70'},{label:'Site moves',hours:s.movingHours||0,colour:'#7c98ad'},{label:'Other activity',hours:Math.max(0,chartHours-s.drillingHours-s.standbyHours-(s.movingHours||0)),colour:'#cbd2cc'}],circ=2*Math.PI*54;let offset=0;
 const circles=parts.map(p=>{const length=chartHours?p.hours/chartHours*circ:0,svg='<circle cx="74" cy="74" r="54" fill="none" stroke="'+p.colour+'" stroke-width="17" stroke-dasharray="'+length+' '+(circ-length)+'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 74 74)"/>';offset+=length;return svg;}).join('');
 return '<div class="eos-time-chart"><svg viewBox="0 0 148 148" role="img" aria-label="Displayed activity hours"><title>'+parts.map(p=>p.label+': '+productionNumber(p.hours)+' hours').join(', ')+'</title><circle cx="74" cy="74" r="54" fill="none" stroke="#edf1ed" stroke-width="17"/>'+circles+'<text x="74" y="73" text-anchor="middle" class="eos-time-total">'+productionNumber(chartHours)+'</text><text x="74" y="91" text-anchor="middle">displayed hours</text></svg><div>'+parts.map(p=>'<div class="eos-time-key"><i style="background:'+p.colour+'"></i><span>'+p.label+'</span><strong>'+productionNumber(p.hours)+' h</strong></div>').join('')+'</div></div>';
}
function toggleProductionTables(){renderDailyProduction();document.querySelectorAll('#production-report .production-data-table').forEach(el=>el.hidden=!document.getElementById('production-show-tables').checked);}

function eosStandbyNote(s){
 const parts=[s.includeNonChargeable?'Chargeable + non-chargeable standby':'Chargeable standby only'];
 if(!s.includeNonChargeable&&s.nonChargeableStandbyHours)parts.push(productionNumber(s.nonChargeableStandbyHours)+' h non-chargeable excluded');
 if(s.unpaidFatigueHours)parts.push('Uncharged fatigue management excluded');
 if(s.unconfirmedStandbyRows)parts.push(s.unconfirmedStandbyRows+' entries awaiting a rate excluded ('+productionNumber(s.unconfirmedStandbyHours)+' h)');
 return parts.join(' · ');
}
function eosStandbyChart(s){
 const wet=s.reasons.find(r=>r.label==='Wet weather')?.hours||0;
 return '<div class="eos-standby-totals"><div><span>Wet weather</span><strong>'+productionNumber(wet)+' <small>h</small></strong></div><div><span>Other standby</span><strong>'+productionNumber(Math.max(0,s.standbyHours-wet))+' <small>h</small></strong></div></div>'+(s.includeNonChargeable?'<div class="eos-standby-legend"><span>● Chargeable</span><span>● Non-chargeable</span></div>':'')+eosBarChart(s.reasons,['chargeableHours','nonChargeableHours'],'h');
}
function eosPerformanceFigures(s){
 const rate=v=>v===null?'—':productionNumber(v),n=productionNumber;
 const figures=[['Penetration rate',rate(s.penetration),'m / drilling h'],['Core penetration',rate(s.corePenetration),'m / core drilling h'],['Chip penetration',rate(s.chipPenetration),'m / chip drilling h'],['Metres / production day',n(s.average),'m / day'],['Cored / production day',n(s.averageCore),'m / day'],['Chipped / production day',n(s.averageChip),'m / day'],['Metres / producing rig-day',n(s.averagePerRigDay),'m / rig-day'],['Site-move time',n(s.movingHours),'h · '+n(s.movingPerDay)+' h / recorded day']];
 return figures.map(([label,value,unit])=>'<div><span>'+label+'</span><strong>'+value+'</strong><small>'+unit+'</small></div>').join('');
}
function eosDailyRows(s){
 return s.daily.map(d=>'<tr><td>'+esc(productionDisplayDate(d.label,true))+'</td>'+['core','chip','metres','drillingHours','penetration','completedHoles','standbyHours','movingHours'].map(k=>'<td class="num">'+(d[k]===null?'—':productionNumber(d[k],k==='completedHoles'?0:1))+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="9">No dated records.</td></tr>';
}
function renderEosMoves(prefix,s,unavailable=false){
 document.getElementById(prefix+'-move-chart').innerHTML=unavailable?'':eosBarChart(s.rigs.filter(r=>r.movingHours>0).map(r=>({...r,moveOnlyHours:r.movingHours-r.combinedMoveHours})),['moveOnlyHours','combinedMoveHours'],'h');
 productionSet(prefix+'-move-summary',unavailable?'':productionNumber(s.movingHours)+' h · '+s.moves.length+' recorded entries');
 productionSet(prefix+'-move-note',unavailable?'':[s.combinedMoveHours?productionNumber(s.combinedMoveHours)+' h combines moving and setup; no time split was recorded.':'Site-to-site rig moves; crew travel is excluded.',s.missingMoveTime?s.missingMoveTime+' move entries have no usable duration.':''].filter(Boolean).join(' '));
 document.getElementById(prefix+'-moves').innerHTML=unavailable||!document.getElementById(prefix==='production'?'production-show-tables':'eos-period-show-tables').checked?'':s.moves.map(r=>'<tr><td>'+esc(productionDisplayDate(r.date,true))+'<small>'+esc(r.drill_rig||'Rig not recorded')+'</small></td><td>'+esc(r.project||'Unassigned project')+'<small>'+esc(r.hole_num||'')+'</small></td><td>'+esc(r.notes||r.code)+'<small>'+(r.moveType==='combined'?'Move + setup':'Site move')+'</small></td><td class="num">'+(r.moveHours===null?'—':productionNumber(r.moveHours))+'</td></tr>').join('')||'<tr><td colspan="4">No site moves recorded.</td></tr>';
}
function eosRateChart(s){
 const data=s.daily,valid=data.filter(d=>d.penetration!==null),max=Math.max(0,...valid.map(d=>d.penetration),s.penetration||0);
 if(!max)return '<p class="production-empty">No metres with recorded drilling time for these filters.</p>';
 const w=1000,h=230,left=54,right=18,top=20,bottom=40,plot=w-left-right,scale=(h-top-bottom)/max;
 const x=i=>left+(i+.5)*plot/Math.max(data.length,1),y=v=>h-bottom-v*scale;
 let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Daily penetration rate in metres per drilling hour"><title>Daily penetration and weighted period average</title>';
 for(let i=0;i<=4;i++){const v=max*i/4;svg+='<path d="M'+left+' '+y(v)+'H'+(w-right)+'" stroke="#e2e8e2"/><text x="'+(left-8)+'" y="'+(y(v)+4)+'" text-anchor="end">'+productionNumber(v)+'</text>';}
 let path='',pen=false;data.forEach((d,i)=>{if(d.penetration===null){pen=false;return;}path+=(pen?'L':'M')+x(i)+' '+y(d.penetration)+' ';pen=true;});
 svg+='<path d="'+path+'" fill="none" stroke="#315d49" stroke-width="2.5"/>';
 data.forEach((d,i)=>{if(d.penetration!==null)svg+='<circle cx="'+x(i)+'" cy="'+y(d.penetration)+'" r="3.5" fill="#315d49"><title>'+esc(d.label+': '+productionNumber(d.penetration)+' m / drilling h')+'</title></circle>';if(i%Math.ceil(data.length/12)===0||i===data.length-1)svg+='<text x="'+x(i)+'" y="'+(h-12)+'" text-anchor="middle">'+esc(productionDisplayDate(d.label,true))+'</text>';});
 if(s.penetration!==null)svg+='<path class="eos-average-line" d="M'+left+' '+y(s.penetration)+'H'+(w-right)+'" stroke="#a57b35" stroke-width="2" stroke-dasharray="7 5"/><text class="eos-average-label" x="'+(w-right-4)+'" y="'+Math.max(12,y(s.penetration)-8)+'" text-anchor="end">Period: '+productionNumber(s.penetration)+' m / drilling h</text>';
 return svg+'</svg>';
}
