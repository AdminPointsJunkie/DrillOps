let eosCalendarData=null,eosCalendarRequest=0,eosCalendarOwner='',eosCalendarSelected='';
const calendarEl=id=>document.getElementById('eos-calendar-'+id);
function calendarCost(reports){const cost=EosCalendar.total(reports);return cost.priced?cur(cost.amount)+(cost.partial?' *':''):reports.length?'Unpriced':'—';}
async function loadEosCalendar(){
 const request=++eosCalendarRequest,version=eosScopeVersion,contractor=activeContractor,owner=JSON.stringify([contractor,eosScope]);
 calendarEl('content').hidden=true;calendarEl('message').textContent='Loading report calendar…';eosCalendarData=null;
 try{
  if(!contractor)throw Error('Select a contractor to view reports.');
  const response=await fetch(API+'/activity-report-data?contractor='+encodeURIComponent(contractor),{cache:'no-store'});
  if(!response.ok)throw Error('Could not load the report calendar. Refresh to retry.');
  const bundle=await response.json();if(!Array.isArray(bundle.activities))throw Error('The report data could not be read. Refresh to retry.');
  if(request!==eosCalendarRequest||version!==eosScopeVersion)return;
  const rows=bundle.activities.filter(r=>(!r.contractor||r.contractor===contractor)&&!isMccWeeklyReportRow(r));
  eosCalendarData=EosCalendar.build(rows,Array.isArray(bundle.consumables)?bundle.consumables:[],eosScope,contractor);rememberEosProjects(rows);
  const select=calendarEl('rig'),old=owner===eosCalendarOwner?select.value:'';
  select.innerHTML='<option value="">All rigs</option>'+eosCalendarData.rigs.map(r=>'<option value="'+attr(r)+'">'+esc(r)+'</option>').join('');select.value=old;if(select.selectedIndex<0)select.value='';
  if(!calendarEl('month').value||owner!==eosCalendarOwner){calendarEl('month').value=eosCalendarData.reports.at(-1)?.date.slice(0,7)||new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Brisbane'}).slice(0,7);eosCalendarSelected='';}
  eosCalendarOwner=owner;calendarEl('message').textContent='';calendarEl('content').hidden=false;renderEosCalendar();
 }catch(error){if(request!==eosCalendarRequest||version!==eosScopeVersion)return;calendarEl('message').textContent=error.message;eosCalendarData=null;calendarEl('grid').innerHTML='';calendarEl('detail').hidden=true;}
}
function latestEosCalendarMonth(){if(!eosCalendarData)return;const rig=calendarEl('rig').value,rows=eosCalendarData.reports.filter(r=>!rig||r.rig===rig);if(rows.length)calendarEl('month').value=rows.at(-1).date.slice(0,7);renderEosCalendar();}
function moveEosCalendarMonth(delta){const month=calendarEl('month').value;if(!EosCalendar.monthDays(month).length)return;const date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+delta);calendarEl('month').value=date.toISOString().slice(0,7);renderEosCalendar();}
function calendarVisibleReports(){const rig=calendarEl('rig').value,shift=calendarEl('shift').value,month=calendarEl('month').value;return (eosCalendarData?.reports||[]).filter(r=>r.date.startsWith(month)&&(!rig||r.rig===rig)&&(!shift||r.shift===shift));}
function renderEosCalendar(){
 if(!eosCalendarData)return;
 const month=calendarEl('month').value,days=EosCalendar.monthDays(month),rig=calendarEl('rig').value,shift=calendarEl('shift').value,rows=calendarVisibleReports(),rigs=rig?[rig]:eosCalendarData.rigs;
 calendarEl('grid').innerHTML='';calendarEl('detail').hidden=true;
 if(!days.length){calendarEl('heading').textContent='Choose a month';calendarEl('summary').textContent='';return;}
 calendarEl('heading').textContent=new Date(days[0]+'T00:00:00Z').toLocaleDateString('en-AU',{month:'long',year:'numeric',timeZone:'UTC'});
 calendarEl('summary').textContent=rows.length+' report'+(rows.length===1?'':'s')+' · '+new Set(rows.map(r=>r.date)).size+' days with reports · '+activeContractor;
 calendarEl('quality').textContent=eosCalendarData.undated?eosCalendarData.undated+' activity entries have no usable date and cannot appear on the calendar.':'';
 const offset=(new Date(days[0]+'T00:00:00Z').getUTCDay()+6)%7;
 calendarEl('grid').innerHTML=Array.from({length:offset},()=>'<div class="eos-calendar-padding" aria-hidden="true"></div>').join('')+days.map(date=>{
  const daily=rows.filter(r=>r.date===date);
  const rigsHtml=rigs.map(name=>{
   const found=daily.filter(r=>r.rig===name),types=shift?[shift]:['day','night',...(found.some(r=>r.shift==='other')?['other']:[])];
   return '<span class="eos-calendar-rig"><strong>'+esc(name)+'</strong><span class="eos-calendar-markers">'+types.map(type=>{const n=found.filter(r=>r.shift===type).length,label=type==='day'?'D':type==='night'?'N':'?';return '<span class="eos-calendar-marker '+(n?'loaded':'empty')+'" title="'+attr(name+' · '+type+' · '+(n?n+' report'+(n===1?'':'s')+' loaded':'No report loaded'))+'">'+label+' '+(n?'✓':'—')+'</span>';}).join('')+'</span></span>';
  }).join('');
  return '<button type="button" class="eos-calendar-day '+(daily.length?'has-reports':'no-reports')+'" data-date="'+date+'" aria-pressed="'+(eosCalendarSelected===date)+'"><span class="eos-calendar-day-heading"><time datetime="'+date+'">'+Number(date.slice(-2))+'</time><small>'+daily.length+' loaded</small></span><span class="eos-calendar-rigs">'+(rigsHtml||'<span>No rigs recorded</span>')+'</span><span class="eos-calendar-cost">'+esc(calendarCost(daily))+'</span></button>';
 }).join('');
 if(eosCalendarSelected.startsWith(month))renderEosCalendarDay(eosCalendarSelected);else eosCalendarSelected='';
}
function renderEosCalendarDay(date){
 eosCalendarSelected=date;const rows=calendarVisibleReports().filter(r=>r.date===date);
 calendarEl('detail').hidden=false;calendarEl('detail-title').textContent=productionDisplayDate(date,true)+' · '+rows.length+' reports · '+calendarCost(rows);
 document.querySelectorAll('.eos-calendar-day').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.date===date)));
 calendarEl('detail-body').innerHTML=rows.map(r=>{
  const source=r.row.source_file||'',params=new URLSearchParams({contractor:r.row.contractor,program:eosScope.program||r.row.program||'',date:r.row.sourceDate,hole:source?'':r.row.hole_num||'',source,title:source||'Daily report'});
  return '<a class="eos-calendar-report" href="report.html?'+attr(params.toString())+'" target="_blank" rel="noopener"><span><strong>'+esc(r.rig)+' <small>'+esc(r.row.shift||'Shift not recorded')+'</small></strong><span>'+esc(r.row.project||'Unassigned project')+' · '+esc(source||'Manual entry')+'</span></span><span>'+esc(calendarCost([r]))+' <span aria-hidden="true">↗</span></span></a>';
 }).join('')||'<p>No reports loaded for this day and the selected filters.</p>';
}
function closeEosCalendarDay(){const date=eosCalendarSelected;eosCalendarSelected='';calendarEl('detail').hidden=true;const tile=document.querySelector('.eos-calendar-day[data-date="'+date+'"]');tile?.setAttribute('aria-pressed','false');tile?.focus();}
calendarEl('grid').addEventListener('click',event=>{const tile=event.target.closest('[data-date]');if(!tile)return;renderEosCalendarDay(tile.dataset.date);calendarEl('detail').scrollIntoView({behavior:'smooth',block:'nearest'});});
