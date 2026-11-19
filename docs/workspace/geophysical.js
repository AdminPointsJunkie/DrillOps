/* Contractor category selects the report; all metrics share the selected scope. */
(()=>{
 window.addEventListener('beforeprint',()=>{if(document.querySelector('.page.active.service-report-active')){document.body.classList.add('geo-print');const old=document.getElementById('eos-print-page-style');if(old)old.media='not all';}});
 window.addEventListener('afterprint',()=>document.body.classList.remove('geo-print'));
 const originalHome=loadEosOverview,originalReport=loadReportsPage;let request=0;
 const type=()=>contractorCategory(contractorByName(activeContractor));
 const n=(v,d=1)=>v===null?'—':Number(v).toLocaleString('en-AU',{maximumFractionDigits:d});
 const money=v=>Number(v).toLocaleString('en-AU',{style:'currency',currency:'AUD'});
 const scopeKey=()=>JSON.stringify([activeContractor,eosScope,window.businessImportDestination?.()]);
 function selectView(id,service){
  const page=document.getElementById(id);page.classList.toggle('service-report-active',service);
  let panel=page.querySelector('.service-report');if(!panel){panel=document.createElement('section');panel.className='service-report';page.append(panel);}panel.hidden=!service;return panel;
 }
 function table(head,rows){return `<div class="tbl-scroll"><table class="geo-table"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${esc(String(c??'—'))}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${head.length}">No records for this selection.</td></tr>`}</tbody></table></div>`;}
 function metric(label,value,note){return `<div><span>${esc(label)}</span><strong>${esc(String(value))}</strong><small>${esc(note)}</small></div>`;}
 function bars(rows,key,unit){const max=Math.max(0,...rows.map(r=>r[key]));return `<div class="geo-bars">${rows.map(r=>`<div><div class="geo-bar-label"><span>${esc(r.label)}</span><strong>${n(r[key])} ${unit}</strong></div><div class="geo-track"><span style="width:${max?r[key]/max*100:0}%"></span></div></div>`).join('')||'<p>No recorded data.</p>'}</div>`;}
 function trend(days){
  if(!days.length)return '<p>No dated activity in this period.</p>';
  const w=1000,h=230,l=58,b=42,t=20,plot=w-l-20,max=Math.max(1,...days.map(d=>d.metres)),step=plot/days.length,scale=(h-b-t)/max;
  return `<svg class="geo-trend" viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily instrument logging pass metres"><title>Daily instrument logging pass metres; repeated passes included</title>${[0,.25,.5,.75,1].map(f=>`<path d="M${l} ${h-b-max*f*scale}H980" stroke="#dfe6df"/><text x="${l-8}" y="${h-b-max*f*scale+4}" text-anchor="end">${n(max*f,0)}</text>`).join('')}${days.map((d,i)=>`<rect x="${l+i*step+step*.18}" y="${h-b-d.metres*scale}" width="${step*.64}" height="${d.metres*scale}" fill="#315d49"><title>${esc(d.date)}: ${n(d.metres)} m · ${d.runs} runs</title></rect>${i%Math.ceil(days.length/10)===0||i===days.length-1?`<text x="${l+(i+.5)*step}" y="${h-15}" text-anchor="middle">${esc(d.date.slice(5))}</text>`:''}`).join('')}</svg>`;
 }
 function loggingReport(s,contractor,scope,from,to){
  const pct=v=>v===null?'—':n(v)+'%',period=(from||'All dates')+' to '+(to||'latest');
  return `<article class="geo-document"><header class="geo-cover"><p class="geo-eyebrow">DrillOps EOS / Geophysical logging</p><h2>${esc(contractor)} performance report</h2><p>${esc(scope)} · ${esc(period)}</p><p class="geo-intro">${s.reports} e-tickets · ${s.runs} instrument runs across ${s.holes} logged holes · ${n(s.recordedHours)} recorded activity hours.</p></header>
   <section class="geo-section"><h3>01 / Logging output</h3><div class="eos-metrics geo-primary">${metric('Holes logged',s.holes,'Unique holes with an instrument run; not a completion count')}${metric('Instrument pass metres',n(s.metres)+' m','Sum of valid run intervals; includes repeated passes')}${metric('Logging utilisation',pct(s.utilisation),'Instrument logging hours ÷ all recorded activity hours')}</div>
   <div class="eos-metrics geo-secondary">${metric('Instrument runs',s.runs,s.dummyRuns+' dummy / clearance runs shown separately')}${metric('Logging hours',n(s.loggingHours)+' h',n(s.recordedHours)+' h total recorded time')}${metric('Interval recording',pct(s.intervalCompleteness),s.missingIntervals+' runs lack a usable interval')}${metric('Known unit-days',s.unitDays,'Distinct dated units; missing / multi-unit entries excluded')}</div>
   <p class="geo-note">Utilisation includes travel, standby, setup and support time in its denominator. Unrecorded time is unknown; it is not treated as available time.</p><h4>Daily logging output</h4>${trend(s.daily)}</section>
   <section class="geo-section"><h3>02 / Tool performance &amp; measured coverage</h3><div class="eos-metrics geo-secondary">${metric('Logged interval rate',s.rate===null?'—':n(s.rate)+' m/h',s.pairedRuns+' instrument runs with both valid intervals and positive duration')}${metric('Unique measured coverage',n(s.coverage)+' m','Overlapping depth intervals merged per hole in this selection')}</div>
   <p class="geo-note">Coverage is the union of recorded instrument intervals, not planned-hole completion or accepted data. Tool codes remain as supplied; dummy runs are excluded from instrument metres and rates.</p>
   ${table(['Tool / sonde family','Runs','Pass metres (m)','Logging hours','Missing intervals'],s.tools.map(t=>[t.label,t.runs,n(t.metres),n(t.hours),t.missingIntervals]))}
   <details open><summary>Hole-level coverage</summary>${table(['Hole','Campaign / program','Runs','Pass metres (m)','Unique coverage (m)','Logging hours','Tools'],s.holeRows.map(h=>[h.label,h.project+' / '+h.program,h.runs,n(h.metres),n(h.coverage),n(h.hours),h.tools.join(', ')]))}</details></section>
   <section class="geo-section"><h3>03 / Time allocation</h3>${bars(s.categories,'hours','h')}<p class="geo-note">Categories use the recorded activity description. Downtime is shown only where explicitly recorded. Weather or access comments remain in the source details; they are not automatically reclassified as equipment failure.</p></section>
   <section class="geo-section"><h3>04 / Charges &amp; review status</h3><div class="eos-metrics geo-secondary">${metric('Estimated charges · ex GST',money(s.estimate),'Quote-based WFD charge rows; not approved invoices')}${metric('Other recorded charges',money(s.recordedCharges),'Operational row costs only; excludes WFD estimates')}${metric('Tickets with estimates withheld',s.withheldReports,'Source unit, date or duration requires review')}</div><p class="geo-note">Estimates may exclude accommodation and other items. Quote validity, rental periods and daily allocation between holes require confirmation. No invoice reconciliation or cost-per-metre target is implied.</p>
   <div class="geo-quality" role="status">${s.issues.length?`${s.issues.length} data checks require review.`:'No structural data checks identified.'} ${s.missingTimes} activities lack a usable duration; ${s.reviewReports} tickets carry importer review notes.${s.duplicates?' '+s.duplicates+' repeated row IDs excluded.':''}</div>
   <details ${s.issues.length?'open':''}><summary>Data checks (${s.issues.length})</summary>${table(['Date','Hole / task','Check','Source'],s.issues.map(i=>[i.row.date,i.row.hole_num,i.issue,i.row.source_file]))}</details>
   <p class="geo-note">Log acceptance, planned-tool completion, first-pass success, turnaround time and confirmed equipment availability are not measured: the e-tickets do not establish those outcomes. No unsupported targets are applied.</p></section>
   <section class="geo-section"><h3>05 / Daily figures &amp; e-ticket register</h3>${table(['Date','Logged holes','Instrument runs','Pass metres (m)','Logging hours','Recorded hours'],s.daily.map(d=>[d.date,d.holes,d.runs,n(d.metres),n(d.loggingHours),n(d.hours)]))}
   ${table(['E-ticket','Date','Hole / task','Unit','Instrument runs','Recorded hours','Source'],s.register.map(r=>[r.ticket,r.date||'Undated',r.hole,r.unit||'Not recorded',r.runs,n(r.hours),r.source]))}</section>
   <details class="geo-section"><summary>Source activity &amp; importer notes (${s.operations.length})</summary>${table(['Date','Hole / task','Activity / tool','From → to (m)','Duration','Notes / source'],s.operations.map(r=>[r.date,r.hole_num,[r.code,ServiceProduction.sonde(r)].filter(Boolean).join(' / '),(r.metres_from??'—')+' → '+(r.metres_to??'—'),r.total_time||'Not recorded',(r.notes||'')+' | '+(r.source_file||'Manual entry')]))}</details>
   <footer class="geo-footer">DrillOps EOS · Recorded geophysical activity · Prepared ${esc(new Date().toLocaleDateString('en-AU',{timeZone:'Australia/Brisbane'}))}</footer></article>`;
 }
 async function load(id){
  const category=type(),contractor=activeContractor,seq=++request,key=scopeKey(),panel=selectView(id,true),logging=category==='Geophysical Logging';
  panel.innerHTML=`<div class="eos-page-heading"><h1>${esc(contractor)} · ${logging?'Logging':'Service'} report</h1></div><p role="status">Loading service records…</p>`;
  try{
   const response=await fetch(API+'/activity-report-data?contractor='+encodeURIComponent(contractor),{cache:'no-store'});if(!response.ok)throw Error('Could not load service records. Refresh to retry.');
   const data=await response.json();if(seq!==request||key!==scopeKey())return;
   const rows=(data.activities||[]).filter(r=>(!r.contractor||r.contractor===contractor)&&EosProduction.scopeMatch(r,eosScope));
   const scope=window.businessImportDestination?.()?.label||eosScopeLabel(),dates=rows.map(r=>ServiceProduction.date(r.date)).filter(Boolean).sort();
   panel.innerHTML=`<div class="eos-page-heading geo-toolbar"><div><p>EOS / ${esc(category)}</p><h1>${esc(contractor)} · ${logging?'Logging':'Service'} report</h1><p>${esc(scope)}</p></div><div><button class="btn-ghost" data-refresh>Refresh</button><button class="btn-ghost" data-print>Print / save PDF</button></div></div><div class="eos-controls geo-toolbar"><label>From <input type="date" data-from value="${dates[0]||''}"></label><label>To <input type="date" data-to value="${dates.at(-1)||''}"></label><button class="btn-ghost" data-all>All dates</button><a href="./eos.html?view=importer">Import reports</a></div><div data-results></div>`;
   panel.querySelector('[data-refresh]').onclick=()=>load(id);panel.querySelector('[data-print]').onclick=()=>window.print();
   function render(){
    const from=panel.querySelector('[data-from]').value,to=panel.querySelector('[data-to]').value,result=panel.querySelector('[data-results]');
    if(from&&to&&from>to){result.innerHTML='<p role="alert">Choose an end date on or after the start date.</p>';return;}
    const filtered=rows.filter(r=>{const d=ServiceProduction.date(r.date);return (!from&&!to)||!!d&&(!from||d>=from)&&(!to||d<=to);});
    const s=ServiceProduction.summarise(filtered,category);
    const undated=rows.filter(r=>!ServiceProduction.date(r.date)).length;
    result.innerHTML=((from||to)&&undated?`<p class="geo-quality">${undated} rows have no usable date and are excluded by this range. Choose All dates to review them.</p>`:'')+(filtered.length?'':'<p class="geo-quality" role="status">No records for this selection.</p>')+(logging?loggingReport(s,contractor,scope,from,to):`<div class="eos-metrics">${metric('Service reports',s.reports,'Recorded source reports')}${metric('Recorded hours',n(s.hours)+' h','Valid activity durations')}${metric('Recorded charges',money(s.charges),'Not invoice totals')}</div>${table(['Date','Task','Activity','Hours','Source'],s.operations.map(r=>[r.date,r.hole_num,r.notes,r.total_time,r.source_file]))}`);
   }
   panel.querySelectorAll('input').forEach(input=>input.onchange=render);panel.querySelector('[data-all]').onclick=()=>{panel.querySelectorAll('input').forEach(i=>i.value='');render();};render();
  }catch(error){if(seq===request&&key===scopeKey()){panel.innerHTML=`<p role="alert">${esc(error.message)}</p><button class="btn-ghost" data-retry>Retry</button>`;panel.querySelector('[data-retry]').onclick=()=>load(id);}}
 }
 loadEosOverview=function(){if(type()!=='Drilling')return load('page-app-home');request++;selectView('page-app-home',false);return originalHome();};
 loadReportsPage=function(...args){if(type()!=='Drilling')return load('page-reports');request++;selectView('page-reports',false);return originalReport(...args);};
})();
