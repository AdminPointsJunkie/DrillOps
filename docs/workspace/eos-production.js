/* The Production page uses activity data, including zero-metre standby rows. */
let eosProductionRequest=0,eosProductionLoading=false,eosProductionError='',eosProductionSummary=null;
const productionNumber=(value,digits=1)=>Number(value||0).toLocaleString('en-AU',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const productionSet=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
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
 });return svg+'</svg>';
}
function productionSummaryRows(rows,rigs=false){return rows.map(r=>'<tr><td>'+esc(rigs?r.contractor+' / '+r.label:r.label)+'</td>'+['core','chip','other','metres','standbyHours','hours'].map(k=>'<td class="num">'+productionNumber(r[k])+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="7" class="production-empty">No recorded activities for these filters.</td></tr>';}
renderDailyProduction=function(){
 const rig=document.getElementById('production-rig').value,bit=document.getElementById('production-drill-type').value,from=document.getElementById('production-from').value,to=document.getElementById('production-to').value,contractor=activeContractor;
 const rangeError=from&&to&&from>to?'The start date must be on or before the end date.':'';
 const unavailable=eosProductionLoading||eosProductionError||rangeError;
 productionSet('production-message',eosProductionLoading?'Loading recorded production…':eosProductionError||rangeError);
 document.getElementById('production-print').disabled=!!unavailable;
 productionFilteredData=unavailable?[]:productionRawData.filter(r=>{const date=EosProduction.date(r.date);return date&&(!from||date>=from)&&(!to||date<=to)&&(!rig||String(r.drill_rig||'Unspecified').trim()===rig)&&(!bit||productionBit(r)===bit);});
 const summary=EosProduction.summarise(productionFilteredData);eosProductionSummary=unavailable?null:summary;
 productionSet('production-context',eosScopeLabel());
 productionSet('production-report-filters',[contractor||'No contractor selected',rig||'All rigs',bit||'All bit types',from||to?(from?productionDisplayDate(from,false):'Start')+' – '+(to?productionDisplayDate(to,false):'Latest'):'All available dates'].join(' · '));
 const value=(n,suffix='')=>unavailable?'—':productionNumber(n)+suffix;
 productionSet('production-kpi-metres',value(summary.metres,' m'));productionSet('production-kpi-core',value(summary.core,' m'));productionSet('production-kpi-chip',value(summary.chip,' m'));productionSet('production-kpi-standby',value(summary.standbyHours,' h'));
 productionSet('production-kpi-days',unavailable?'—':summary.productionDays);productionSet('production-kpi-average',value(summary.average,' m'));productionSet('production-kpi-drilling-hours',value(summary.drillingHours,' h'));
 productionSet('production-kpi-counts',unavailable?'—':summary.reportCount+' / '+summary.rigs.length+' / '+summary.holeCount);
 productionSet('production-kpi-best',value(summary.best?.metres,' m'));productionSet('production-kpi-best-date',summary.best?productionDisplayDate(summary.best.label,true):'No production in range');
 productionSet('production-unclassified',summary.other?productionNumber(summary.other)+' m other / unclassified':'Cored + chipped + other recorded metres');
 productionSet('production-standby-share',summary.standbyPercent===null?'No recorded hours':productionNumber(summary.standbyPercent)+'% of '+productionNumber(summary.hours)+' recorded hours');
 productionSet('production-standby-context',summary.missingStandbyTime?summary.missingStandbyTime+' standby entries have no usable duration':'Includes zero-metre standby entries');
 const undated=productionRawData.filter(r=>!EosProduction.date(r.date)).length;
 const quality=[summary.other?productionNumber(summary.other)+' m are other or unclassified; they have not been assumed to be core or chip.':'',summary.missingTime?summary.missingTime+' entries have no usable duration; hours and standby shares may be incomplete.':'',undated?undated+' undated entries are excluded from this dated report.':'',summary.invalidMetres?summary.invalidMetres+' invalid or negative metre values are excluded from metre totals.':''].filter(Boolean);
 productionSet('production-quality',unavailable?'':quality.join(' '));
 document.getElementById('production-chart').innerHTML=unavailable?'':productionChart(summary);
 document.getElementById('production-projects').innerHTML=unavailable?'':productionSummaryRows(summary.projects);
 document.getElementById('production-rigs').innerHTML=unavailable?'':productionSummaryRows(summary.rigs,true);
 document.getElementById('production-standby-reasons').innerHTML=unavailable?'':summary.reasons.map(r=>'<tr><td>'+esc(r.label)+(r.missing?' · '+r.missing+' missing duration':'')+'</td><td class="num">'+productionNumber(r.hours)+'</td><td class="num">'+(summary.standbyHours?productionNumber(r.hours/summary.standbyHours*100)+'%':'—')+'</td><td class="num">'+r.rows+'</td></tr>').join('')||'<tr><td colspan="4" class="production-empty">No standby recorded for these filters.</td></tr>';
 for(const [id,rows,keys,unit] of [['production-project-chart',summary.projects],['production-rig-chart',summary.rigs],['production-standby-chart',summary.reasons,['hours'],'h']])document.getElementById(id).innerHTML=unavailable?'':eosBarChart(rows,keys,unit);
 document.getElementById('production-time-chart').innerHTML=unavailable?'':eosTimeChart(summary);
 productionSet('production-row-count',productionFilteredData.length);renderProductionDetails();
 productionSet('production-generated','Prepared '+new Date().toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short',timeZone:'Australia/Brisbane'})+' AEST');
};
function renderProductionDetails(){
 const visible=document.getElementById('production-show-detail').checked;document.getElementById('production-detail').hidden=!visible;
 document.getElementById('production-body').innerHTML=visible?productionFilteredData.slice().sort((a,b)=>EosProduction.date(a.date).localeCompare(EosProduction.date(b.date))).map(r=>'<tr><td>'+esc(r.project||'Unassigned project')+'<small>'+esc(r.contractor)+'</small></td><td>'+esc(productionDisplayDate(r.date,true))+'<small>'+esc(r.shift||'')+'</small></td><td>'+esc(r.drill_rig||'Not recorded')+'<small>'+esc(r.hole_num||'')+'</small></td><td>'+esc(r.source_file||'Manual entry')+'<small>'+esc(r.code||'No code')+'</small></td><td>'+({core:'Cored',chip:'Chipped',other:'Other / unclassified'}[EosProduction.method(r)])+'</td><td class="num">'+(Number.isFinite(Number(r.total_metres))&&r.total_metres!=null?productionNumber(r.total_metres):'—')+'</td><td class="num">'+(EosProduction.hours(r)===null?'Not recorded':productionNumber(EosProduction.hours(r)))+'</td><td>'+esc(EosProduction.standby(r)||'—')+'</td></tr>').join(''):'';
}
function toggleProductionDetail(){renderProductionDetails();}
function printProductionReport(){if(!eosProductionSummary)return;document.body.classList.add('eos-production-print');window.print();}
window.addEventListener('beforeprint',()=>{if(document.getElementById('page-production').classList.contains('active'))document.body.classList.add('eos-production-print');});
window.addEventListener('afterprint',()=>document.body.classList.remove('eos-production-print'));
downloadProductionCsv=function(){
 if(!eosProductionSummary||!productionFilteredData.length){toast('No recorded activities to export.');return;}
 const rows=[['Project','Program','Contractor','Date','Shift','Rig','Hole','Source plod','Code','Bit type','Production type','Metres','Recorded hours','Standby reason'],...productionFilteredData.map(r=>[r.project,r.program,r.contractor,EosProduction.date(r.date),r.shift,r.drill_rig,r.hole_num,r.source_file,r.code,r.bit_type,EosProduction.method(r),r.total_metres,EosProduction.hours(r),EosProduction.standby(r)])];
 const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@\t\r-]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='EOS-production-'+(document.getElementById('production-from').value||'all')+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
};
/* Shared visual summaries for Production and the printable operations report. */
function eosBarChart(rows,keys=['core','chip','other'],unit='m'){
 const total=r=>keys.reduce((sum,k)=>sum+(Number(r[k])||0),0),max=Math.max(0,...rows.map(total));
 if(!rows.length)return '<p class="production-empty">No records for these filters.</p>';
 return '<div class="eos-bars">'+rows.map(r=>'<div class="eos-bar-row"><div class="eos-bar-label"><span>'+esc(r.label)+'</span><strong>'+productionNumber(total(r))+' <small>'+unit+'</small></strong></div><div class="eos-bar-track" role="img" aria-label="'+attr(r.label+': '+keys.map(k=>k+' '+productionNumber(r[k])+' '+unit).join(', '))+'">'+keys.map(k=>'<span class="eos-bar-'+k+'" style="width:'+(max?Math.max(0,Number(r[k])||0)/max*100:0)+'%" title="'+attr(k+': '+productionNumber(r[k])+' '+unit)+'"></span>').join('')+'</div></div>').join('')+'</div>';
}
function eosTimeChart(s){
 const parts=[{label:'Drilling',hours:s.drillingHours,colour:'#315d49'},{label:'Standby',hours:s.standbyHours,colour:'#c5aa70'},{label:'Other activity',hours:Math.max(0,s.hours-s.drillingHours-s.standbyHours),colour:'#cbd2cc'}],circ=2*Math.PI*54;let offset=0;
 const circles=parts.map(p=>{const length=s.hours?p.hours/s.hours*circ:0,svg='<circle cx="74" cy="74" r="54" fill="none" stroke="'+p.colour+'" stroke-width="17" stroke-dasharray="'+length+' '+(circ-length)+'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 74 74)"/>';offset+=length;return svg;}).join('');
 return '<div class="eos-time-chart"><svg viewBox="0 0 148 148" role="img" aria-label="Recorded activity hours"><title>'+parts.map(p=>p.label+': '+productionNumber(p.hours)+' hours').join(', ')+'</title><circle cx="74" cy="74" r="54" fill="none" stroke="#edf1ed" stroke-width="17"/>'+circles+'<text x="74" y="73" text-anchor="middle" class="eos-time-total">'+productionNumber(s.hours)+'</text><text x="74" y="91" text-anchor="middle">recorded hours</text></svg><div>'+parts.map(p=>'<div class="eos-time-key"><i style="background:'+p.colour+'"></i><span>'+p.label+'</span><strong>'+productionNumber(p.hours)+' h</strong></div>').join('')+'</div></div>';
}
function toggleProductionTables(){document.querySelectorAll('#production-report .production-data-table').forEach(el=>el.hidden=!document.getElementById('production-show-tables').checked);}
