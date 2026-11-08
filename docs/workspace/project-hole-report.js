/* Project owns this report; EOS retains its independent contractor Production Report. */
(function(){
 if(WORKSPACE_APP!=='project')return;
 let data=null,model=null,request=0,loadedScope='';
 const el=id=>document.getElementById(id),money=v=>v==null?'—':Number(v).toLocaleString('en-AU',{style:'currency',currency:'AUD'}),n=(v,d=1)=>v==null?'—':Number(v).toLocaleString('en-AU',{maximumFractionDigits:d});
 const currentScope=()=>projectBudgetScope(),scopeKey=s=>JSON.stringify(s);
 const difference=v=>'<span class="'+(v<0?'phr-negative':'')+'">'+money(v)+'</span>';
 const table=(headers,rows,foot='')=>'<table class="phr-table"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody>'+(foot?'<tfoot>'+foot+'</tfoot>':'')+'</table>';
 const cell=(v,numeric=false)=>'<td'+(numeric?' class="num"':'')+'>'+v+'</td>';
 const kpi=(label,value,note,id='')=>'<div class="phr-kpi"><span>'+label+'</span><strong'+(id?' id="'+id+'"':'')+'>'+value+'</strong><small>'+note+'</small></div>';
 function contractorRows(rows){return rows.map(r=>'<tr>'+cell(esc(r.name))+cell(money(r.budget),true)+cell(money(r.eos)+(r.unpriced?'<small>'+r.unpriced+' unpriced</small>':''),true)+cell(money(r.invoiced),true)+cell(money(r.accruals),true)+cell(money(r.combined),true)+cell(difference(r.planLessCombined),true)+cell(difference(r.invoiceLessEos),true)+'</tr>');}
 const contractorHeaders=['Contractor / budget line','Planned budget','EOS charges','Accounts invoiced','Open accruals','Invoiced + accruals','Plan less total','Invoiced less EOS'];
 function monthlyChart(m){
  const width=1000,height=240,pad=80,values=m.monthly.flatMap(r=>[r.eos,r.invoices,r.accruals]),low=Math.min(0,...values),high=Math.max(1,...values),span=high-low,step=(width-pad-20)/Math.max(1,m.monthly.length),y=v=>20+(high-v)/span*155,base=y(0);
  const ticks=[low,(low+high)/2,high].map(v=>'<line class="grid" x1="'+pad+'" y1="'+y(v)+'" x2="980" y2="'+y(v)+'"/><text x="70" y="'+(y(v)+4)+'" text-anchor="end">'+(Math.max(Math.abs(low),high)>=1000?'$'+n(v/1000,1)+'k':'$'+n(v,0))+'</text>').join('');
  return '<div class="phr-legend"><span><i style="background:#237a65"></i>EOS charges</span><span><i style="background:#758bb3"></i>Accounts invoices · all contractors</span><span><i style="background:#d79b3c"></i>Open accruals</span></div><svg class="phr-chart" role="img" aria-label="Monthly EOS charges and Accounts invoice actuals, excluding GST" viewBox="0 0 '+width+' '+height+'">'+ticks+m.monthly.map((r,i)=>{const x=pad+i*step+step*.18,w=step*.18;return ['eos','invoices','accruals'].map((key,j)=>'<rect style="fill:'+['#237a65','#758bb3','#d79b3c'][j]+'" class="'+(j?'invoice':'eos')+'" x="'+(x+j*(w+3))+'" y="'+Math.min(base,y(r[key]))+'" width="'+w+'" height="'+Math.abs(y(r[key])-base)+'"><title>'+esc(r.month+' '+key+' '+money(r[key]))+'</title></rect>').join('')+'<text x="'+(x+w)+'" y="210" text-anchor="middle">'+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(r.month.slice(5))-1]+'</text>';}).join('')+'</svg>';
 }
 function drillingDifference(h){
  if(h.drillingActual==null||h.drillBudget==null)return '—';
  const delta=(Math.round(h.drillingActual*100)-Math.round(h.drillBudget*100))/100;
  return (delta>0?'+':delta<0?'−':'')+money(Math.abs(delta));
 }
 function holeCostChart(rows){
  if(!rows.length)return '<p class="phr-note">No holes have recorded drilling metres in the selected period.</p>';
  const max=Math.max(1,...rows.flatMap(h=>[Math.abs(h.drillBudget||0),Math.abs(h.drillingActual||0)]));
  return '<div class="phr-legend"><span><i style="background:#d9e4dc"></i>Drilling budget</span><span><i style="background:#237a65"></i>Within budget</span><span><i style="background:#eab308"></i>Up to 10% over</span><span><i style="background:#f97316"></i>10–25% over</span><span><i style="background:#dc2626"></i>Over 25%</span></div><div class="phr-cost-compact"><div class="phr-cost-row phr-cost-head"><span>Hole</span><span>Drilling budget / actual</span><span>Drilling actual / budget</span><span>Difference (+ over / − under)</span><span>Total EOS cost</span></div>'+rows.map(h=>'<div class="phr-cost-row"><b>'+esc(h.id)+(h.borehole.site_id&&h.borehole.site_id!==h.id?' <span class="phr-site-id">· '+esc(h.borehole.site_id)+'</span>':'')+'</b><div class="phr-cost-bars"><i style="width:'+Math.max(0,(h.drillBudget||0)/max*100)+'%"></i><i class="actual" title="'+attr(ProjectHoleReport.drillingOverrun(h.drillingActual,h.drillBudget).label)+'" style="background:'+ProjectHoleReport.drillingOverrun(h.drillingActual,h.drillBudget).color+';width:'+Math.max(0,(h.drillingActual||0)/max*100)+'%"></i></div><span>'+money(h.drillingActual)+' / '+money(h.drillBudget)+'</span><span class="phr-drilling-difference">'+drillingDifference(h)+'</span><strong>'+money(h.eos)+(h.unpriced?'<small>'+h.unpriced+' unpriced</small>':'')+'</strong></div>').join('')+'</div>';
 }
 function rigComparisons(m,rigs){
  const costs=new Map(m.rigCosts.map(r=>[r.key,r])),cost=r=>costs.get(JSON.stringify([r.contractor,r.label])),maxMetres=Math.max(1,...m.production.rigs.map(r=>r.metres)),maxCost=Math.max(1,...m.rigCosts.map(r=>Math.max(0,r.perMetre||0)));
  if(!rigs.length)return '<p class="phr-note">No rig activity recorded in the selected dates.</p>';
  const label=r=>esc(r.contractor+' · '+r.label);
  const pairs=rigs.map(r=>{const c=cost(r),value=c?.perMetre;return '<div class="phr-rig-row phr-rig-metres"><div><span>'+label(r)+'</span><strong>'+n(r.metres)+' m</strong></div><div class="phr-rig-track">'+['core','chip','other'].map((k,i)=>'<i title="'+attr(k+': '+n(r[k])+' m')+'" style="background:'+['#237a65','#a9d4bd','#cbd2cc'][i]+';width:'+r[k]/maxMetres*100+'%"></i>').join('')+'</div></div><div class="phr-rig-row phr-rig-cost"><div><span>'+label(r)+'</span><strong title="'+(c?.partial?'Partial: some costs cannot be assigned or are missing.':'Recorded EOS costs divided by metres drilled.')+'">'+money(value)+(value==null?'':' / m')+(c?.partial?' · partial':'')+'</strong></div><div class="phr-rig-track"><i style="background:#237a65;width:'+Math.max(0,value||0)/maxCost*100+'%"></i></div></div>';}).join('');
  return '<div class="phr-rig-grid"><h3>Metres drilled by rig</h3><h3>Cost per metre by rig</h3><div class="phr-legend"><span><i style="background:#237a65"></i>Cored</span><span><i style="background:#a9d4bd"></i>Chipped</span><span><i style="background:#cbd2cc"></i>Other</span></div><div class="phr-legend">EOS charges + consumables · ex GST</div>'+pairs+'</div>'+(m.unallocatedRigMaterials?'<p class="phr-note">'+m.unallocatedRigMaterials+' consumable entries could not be assigned to a single rig.</p>':'');
 }
 function render(){
  if(!data||loadedScope!==scopeKey(currentScope()))return;
  const scope=currentScope(),from=el('period-range-from').value,to=el('period-range-to').value;
  if(!from||!to||from>to||from.slice(0,4)!==String(scope.year)||to.slice(0,4)!==String(scope.year)){el('period-report-meta').textContent='Choose a valid date range within '+scope.year+'.';el('project-hole-print').disabled=true;el('page-reports').querySelector('.phr-content').hidden=true;return;}
  model=ProjectHoleReport.build(data,scope,{from,to});const m=model;
  el('period-report-meta').textContent=[scope.project,scope.program,from+' to '+to].join(' · ');
  el('phr-budget-kpis').innerHTML=kpi('Approved budget',money(m.approvedBudget),'Original approved funding','phr-approved')+kpi('Planned Holes',money(m.plannedBudget),'Original budgets excluding cancelled holes','phr-planned')+kpi('Unallocated Budget',money(m.remainingBudget),'Approved budget minus Planned Holes','phr-remaining')+kpi('EOS charges',money(m.eosTotal),m.unpriced?m.unpriced+' unpriced lines excluded':'Includes worked day-rate charges · ex GST','phr-eos-total')+kpi('Accounts invoiced',money(m.invoiced),'All project invoice subtotals · ex GST','phr-invoiced')+kpi('Invoiced + accruals',money(m.invoicedAndAccruals),money(m.accrualTotal)+' open estimated accruals','phr-invoice-balance');
  el('phr-production-meta').textContent=m.production.reportCount+' EOS reports · '+m.production.completedHoles+' holes completed in EOS';
  el('phr-production-kpis').innerHTML=kpi('Active contractors',new Set(m.production.rows.map(r=>r.contractor).filter(Boolean)).size,'With EOS reports in selected dates')+kpi('Active rigs',m.production.rigs.filter(r=>r.label!=='Not recorded').length,'With EOS reports in selected dates')+kpi('Total metres',n(m.production.metres)+' m','Cored, chipped and other metres')+kpi('Drilling hours',n(m.production.drillingHours)+' h','Recorded drilling time')+kpi('Metres / drilling hour',n(m.production.penetration,2)+' m/h','Metres with recorded drilling duration')+kpi('Total PLOD cost',money(m.drillingEosTotal),m.unpriced?'Partial · '+m.unpriced+' unpriced lines':'EOS activities + consumables · ex GST');
  el('phr-rig-comparisons').innerHTML=rigComparisons(m,m.production.rigs);

  el('phr-monthly-chart').innerHTML=monthlyChart(m);
  el('phr-hole-cost-chart').innerHTML=holeCostChart(m.metrics.filter(h=>h.production.metres>0));
  el('phr-contractors').innerHTML=table(contractorHeaders,contractorRows(m.contractors));
  el('phr-source-note').textContent='';
  el('phr-report-heading').innerHTML=DrillOpsReport.header('Project','Hole-by-hole report',m.scope.project+' · '+m.scope.program,m.from+' to '+m.to);
  el('page-reports').querySelector('.phr-content').hidden=false;el('project-hole-print').disabled=false;
  renderPeriodMap(m.metrics.filter(h=>h.production.metres>0).map(h=>h.borehole));
 }
 async function load(preserveRange){
  const token=++request,scope=currentScope(),key=scopeKey(scope);data=null;model=null;
  el('page-reports').querySelector('.phr-content').hidden=true;el('project-hole-print').disabled=true;
  el('period-report-meta').textContent=scope.project?'Loading budget, EOS production and Accounts invoices…':'Choose a project using the bottom-left sidebar selector.';
  if(!scope.project)return;
  if(!preserveRange||loadedScope!==key){el('period-range-from').value=scope.year+'-01-01';el('period-range-to').value=scope.year+'-12-31';}
  const read=async path=>{const r=await fetch(API+path,{cache:'no-store'});if(!r.ok)throw new Error('Report source could not load');return r.json();};
  try{
   const q='?project='+encodeURIComponent(scope.project)+'&program='+encodeURIComponent(scope.program);
   const [evidence,planner,source,allocations]=await Promise.all([read('/project-hole-report-data'+q),read('/boreholes?contractor=Company'),loadProjectWorkbook(scope),read('/project-budgets?contractor=Company')]);
   if(token!==request||key!==scopeKey(currentScope()))return;
   if(!Array.isArray(planner)||!Array.isArray(allocations)||!['activities','consumables','invoices','invoice_lines','ambiguous_consumables'].every(k=>Array.isArray(evidence[k])))throw new Error('Invalid report source');
   data={evidence,planner,source,allocations};loadedScope=key;render();
  }catch(error){if(token!==request||key!==scopeKey(currentScope()))return;el('period-report-meta').textContent='Report data could not be loaded. Use Update report to retry.';}
 }
 function print(){
  if(!model||el('project-hole-print').disabled||loadedScope!==scopeKey(currentScope()))return;
  const win=window.open('','_blank');if(!win){toast('Allow the print report to open in a new tab.','warn');return;}
  const m=model,pages=[],chunk=(rows,size)=>Array.from({length:Math.max(1,Math.ceil(rows.length/size))},(_,i)=>rows.slice(i*size,(i+1)*size));
  pages.push('<h1>Project performance</h1>'+el('phr-budget-kpis').outerHTML+'<h2>EOS production <small>'+esc(el('phr-production-meta').textContent)+'</small></h2>'+el('phr-production-kpis').outerHTML+monthlyChart(m));
  for(const rows of chunk(m.accrualRows||[],16))if(rows.length)pages.push('<h1>Estimated accruals</h1>'+table(['Month','Supplier','PO','Amount'],rows.map(r=>'<tr>'+cell(esc(String(r.period).slice(0,7)))+cell(esc(r.supplier))+cell(esc(r.po_number||'—'))+cell(money(r.amount),true)+'</tr>')));
  for(const rigs of chunk(m.production.rigs,7))if(rigs.length)pages.push('<h1>Production by contractor &amp; rig</h1>'+rigComparisons(m,rigs));
  for(const rows of chunk(m.metrics.filter(h=>h.production.metres>0),10))if(rows.length)pages.push('<h1>Planned vs actual hole costs</h1>'+holeCostChart(rows));
  for(const rows of chunk(m.contractors,14))pages.push('<h1>Contractor reconciliation</h1>'+table(contractorHeaders,contractorRows(rows)));
  if(periodMapPrintHoles.length){const map=el('period-map-print'),old=map.getAttribute('style');map.style.cssText='display:block;position:absolute;visibility:hidden;width:1000px;height:420px';renderPeriodPrintMap();pages.unshift('<h1>Project hole locations</h1><div class="print-location-map">'+map.innerHTML+'</div>');if(old===null)map.removeAttribute('style');else map.setAttribute('style',old);}
  const header=DrillOpsReport.header('Project','Hole-by-hole report',m.scope.project+' · '+m.scope.program,m.from+' to '+m.to);
  const styles=printStyles();
  win.document.open();win.document.write('<!doctype html><html><head><meta charset="utf-8">'+DrillOpsReport.fonts+'<title>'+esc(m.scope.project)+' · Hole-by-hole report</title><style>'+styles+DrillOpsReport.css+'</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div>'+pages.map((body,i)=>'<section class="sheet">'+header+body+'<footer><span>Hole-by-hole report · '+esc(new Date().toLocaleDateString('en-AU',{timeZone:'Australia/Brisbane'}))+'</span><span>Page '+(i+1)+' of '+pages.length+'</span></footer></section>').join('')+'</body></html>');win.document.close();win.focus();
 }
 function printStyles(){return '.phr-rig-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:24px;row-gap:0}.phr-rig-grid h3{font-size:13px}.phr-rig-row{margin:14px 0}.phr-rig-row>div:first-child{display:flex;justify-content:space-between;gap:12px;font-size:10px}.phr-rig-track{display:flex;height:10px;background:#edf1ed;margin-top:5px}.phr-rig-track i{display:block;height:100%} .phr-table thead th{text-align:left!important} .phr-site-id{font-weight:400;color:#657873;font-size:9px}  .phr-cost-row{display:grid;grid-template-columns:130px minmax(80px,1fr) 165px 110px 110px;gap:12px;align-items:center;padding:7px 0;border-bottom:1px solid #e5ece8;font-size:10px}.phr-cost-row>span:nth-child(n+3),.phr-cost-row>strong{text-align:right}.phr-cost-head{color:#657873;font-size:9px}.phr-cost-bars{display:grid;gap:3px}.phr-cost-bars i{display:block;height:5px;background:#d9e4dc}.phr-cost-bars .actual{background:#237a65}.phr-cost-row small{display:block;font-size:8px;color:#80551e} *{box-sizing:border-box}body{margin:0;background:#e9eeeb;color:#173b36;font:11px Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.toolbar{text-align:center;padding:16px}.toolbar button{padding:12px 24px;background:#173b36;color:white;border:0;border-radius:6px;cursor:pointer}.sheet{width:297mm;min-height:210mm;margin:16px auto;padding:10mm 12mm 15mm;background:white;position:relative;break-after:page}.sheet:last-child{break-after:auto}header{display:flex;justify-content:space-between;align-items:center;text-align:right;border-bottom:2px solid #173b36;padding-bottom:11px;margin-bottom:20px}.brand{font-size:25px;letter-spacing:-1px;font-weight:800;text-align:left}.brand span{color:#6c9986}header small{display:block;font-size:10px;letter-spacing:0;color:#657873;margin-top:5px}.brand small{font-size:8px;letter-spacing:2px}h1{font-size:24px;margin:12px 0 18px}h2{font-size:15px;margin:16px 0 12px}h2 small{font-size:10px;font-weight:400;color:#657873;margin-left:15px}.phr-note{font-size:10px;color:#657873;line-height:1.6}.phr-kpis,#phr-budget-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}.phr-kpi{padding:12px;border:1px solid #dce5e1;border-radius:7px}.phr-kpi span,.phr-kpi small{display:block;font-size:9px;color:#657873}.phr-kpi strong{display:block;font-size:23px;margin:7px 0}.phr-production,#phr-production-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.phr-table{width:100%;border-collapse:collapse;font-size:10px}.phr-table th,.phr-table td{padding:10px 6px;border-bottom:1px solid #dce5e1;text-align:left;vertical-align:top}.phr-table th{background:#edf3ef;color:#506b5f}.phr-table .num{text-align:right;white-space:nowrap}.phr-table small{display:block;font-size:8px;color:#657873;margin-top:4px}.phr-negative{color:#a04430}.phr-chart{width:100%;display:block;max-height:430px}.sheet:has(#phr-budget-kpis) .phr-chart{max-height:205px}.phr-chart text{font-size:11px;fill:#657873}.phr-chart .value{fill:#173b36;font-size:10px}.grid{stroke:#e5ece8}.plan{fill:#d9e4dc}.core,.eos{fill:#237a65}.chip{fill:#b4c9b7}.invoice{fill:#758bb3}.phr-legend{display:flex;gap:18px;margin:12px 0;font-size:10px;color:#657873}.phr-legend i{display:inline-block;width:11px;height:8px;margin-right:5px}.phr-allocation{display:flex;gap:50px;margin:25px 0}.phr-allocation strong{display:block;font-size:24px;margin:10px 0}.phr-allocation small{display:block;color:#657873;max-width:420px;line-height:1.5}.print-location-map{position:relative;width:1000px;height:420px;overflow:hidden}.print-location-map img{position:absolute}.print-map-marker{position:absolute;width:10px;height:10px;border:2px solid white;border-radius:50%;transform:translate(-50%,-50%);z-index:2}.print-map-label{position:absolute;transform:translate(9px,-50%);font-size:10px;background:white;padding:2px;z-index:3}.print-map-attribution{position:absolute;bottom:0;right:0;background:white;font-size:8px}.phr-chart-heading{font-size:14px;margin-top:25px}.phr-issues{font-size:11px;color:#80551e;line-height:1.6}footer{position:absolute;bottom:8mm;left:12mm;right:12mm;display:flex;justify-content:space-between;border-top:1px solid #dce5e1;padding-top:8px;color:#657873;font-size:9px}@page{size:A4 landscape;margin:0}@media print{.toolbar{display:none}body{background:white}.sheet{margin:0;height:210mm;min-height:0}}';}
 const sections=[...el('page-reports').querySelectorAll('.phr-panel')];
 let collapsed={};try{collapsed=JSON.parse(localStorage.getItem('drillops_project_report_sections')||'{}')||{};}catch(_){}
 function toggleSection(panel,open){
  const button=panel.querySelector('.phr-section-toggle'),body=panel.querySelector('.phr-section-body');
  body.hidden=!open;button.setAttribute('aria-expanded',String(open));collapsed[panel.dataset.section]=!open;
  try{localStorage.setItem('drillops_project_report_sections',JSON.stringify(collapsed));}catch(_){}
  if(open&&panel.querySelector('#period-map'))requestAnimationFrame(()=>fitPeriodMapToBounds());
 }
 sections.forEach((panel,index)=>{
  const heading=panel.querySelector('.phr-title'),key=heading.querySelector('h2').textContent;
  panel.dataset.section=key;
  const body=document.createElement('div');body.className='phr-section-body';body.id='phr-section-'+index;
  while(heading.nextSibling)body.append(heading.nextSibling);
  panel.append(body);
  const button=document.createElement('button');button.type='button';button.className='phr-section-toggle';button.setAttribute('aria-controls',body.id);
  while(heading.firstChild)button.append(heading.firstChild);heading.append(button);
  button.addEventListener('click',()=>toggleSection(panel,body.hidden));toggleSection(panel,!collapsed[key]);
 });
 document.querySelectorAll('[data-phr-expand]').forEach(button=>button.addEventListener('click',()=>sections.forEach(panel=>toggleSection(panel,button.dataset.phrExpand==='true'))));
 window.loadReportsPage=load;window.renderPeriodReport=render;window.printPeriodReport=print;
})();
