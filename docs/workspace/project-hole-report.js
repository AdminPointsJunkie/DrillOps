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
 function contractorRows(rows){return rows.map(r=>'<tr>'+cell(esc(r.name))+cell(money(r.budget),true)+cell(money(r.eos)+(r.unpriced?'<small>'+r.unpriced+' unpriced</small>':''),true)+cell(money(r.invoiced),true)+cell(difference(r.planLessInvoices),true)+cell(difference(r.invoiceLessEos),true)+'</tr>');}
 const contractorHeaders=['Contractor / budget line','Planned budget','EOS charges','Accounts invoiced','Plan less invoiced','Invoiced less EOS'];
 function monthlyChart(m){
  const width=1000,height=240,pad=80,values=m.monthly.flatMap(r=>[r.eos,r.invoices]),low=Math.min(0,...values),high=Math.max(1,...values),span=high-low,step=(width-pad-20)/Math.max(1,m.monthly.length),y=v=>20+(high-v)/span*155,base=y(0);
  const ticks=[low,(low+high)/2,high].map(v=>'<line class="grid" x1="'+pad+'" y1="'+y(v)+'" x2="980" y2="'+y(v)+'"/><text x="70" y="'+(y(v)+4)+'" text-anchor="end">'+(Math.max(Math.abs(low),high)>=1000?'$'+n(v/1000,1)+'k':'$'+n(v,0))+'</text>').join('');
  return '<div class="phr-legend"><span><i style="background:#237a65"></i>EOS charges</span><span><i style="background:#758bb3"></i>Accounts invoices · all contractors</span></div><svg class="phr-chart" role="img" aria-label="Monthly EOS charges and Accounts invoice actuals, excluding GST" viewBox="0 0 '+width+' '+height+'">'+ticks+m.monthly.map((r,i)=>{const x=pad+i*step+step*.18,w=step*.25;return ['eos','invoices'].map((key,j)=>'<rect class="'+(j?'invoice':'eos')+'" x="'+(x+j*(w+3))+'" y="'+Math.min(base,y(r[key]))+'" width="'+w+'" height="'+Math.abs(y(r[key])-base)+'"><title>'+esc(r.month+' '+key+' '+money(r[key]))+'</title></rect>').join('')+'<text x="'+(x+w)+'" y="210" text-anchor="middle">'+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(r.month.slice(5))-1]+'</text>';}).join('')+'</svg>';
 }
 function holeCostChart(rows){
  if(!rows.length)return '';
  const max=Math.max(1,...rows.flatMap(h=>[Math.abs(h.plannedBudget||0),Math.abs(h.eos||0)])),scale=620/max;
  return '<h3 class="phr-chart-heading">Planned vs actual hole costs</h3><div class="phr-legend"><span><i style="background:#d9e4dc"></i>Planned hole budget</span><span><i style="background:#237a65"></i>Actual · recorded EOS charges</span></div><svg class="phr-chart" role="img" aria-label="EOS charges against planned budgets per hole" viewBox="0 0 1000 '+(rows.length*42+26)+'">'+rows.map((h,i)=>{const y=i*42+14;return '<text x="120" y="'+(y+12)+'" text-anchor="end">'+esc(h.id)+'</text><rect class="plan" x="135" y="'+y+'" width="'+Math.max(0,(h.plannedBudget||0)*scale)+'" height="8"/><rect class="eos" x="135" y="'+(y+12)+'" width="'+Math.max(0,(h.eos||0)*scale)+'" height="10"/><text class="value" x="780" y="'+(y+15)+'">'+money(h.eos)+' / '+money(h.plannedBudget)+'</text>';}).join('')+'</svg><p class="phr-note">EOS covers loaded drilling work and consumables; full hole budgets also include support contractors.</p>';
 }
 function render(){
  if(!data||loadedScope!==scopeKey(currentScope()))return;
  const scope=currentScope(),from=el('period-range-from').value,to=el('period-range-to').value;
  if(!from||!to||from>to||from.slice(0,4)!==String(scope.year)||to.slice(0,4)!==String(scope.year)){el('period-report-meta').textContent='Choose a valid date range within '+scope.year+'.';el('project-hole-print').disabled=true;el('page-reports').querySelector('.phr-content').hidden=true;return;}
  model=ProjectHoleReport.build(data,scope,{from,to});const m=model;
  el('period-report-meta').textContent=[scope.project,scope.program,from+' to '+to].join(' · ');
  el('phr-budget-kpis').innerHTML=kpi('Approved budget',money(m.approvedBudget),'Original approved funding','phr-approved')+kpi('Planned Holes',money(m.plannedBudget),'Original budgets excluding cancelled holes','phr-planned')+kpi('Unallocated Budget',money(m.remainingBudget),'Approved budget minus Planned Holes','phr-remaining')+kpi('EOS charges',money(m.eosTotal),m.unpriced?m.unpriced+' unpriced lines excluded':'Recorded activities and consumables · ex GST','phr-eos-total')+kpi('Accounts invoiced',money(m.invoiced),'All project invoice subtotals · ex GST','phr-invoiced')+kpi('Plan less invoiced',money(m.planLessInvoices),'Full hole plan minus all project invoices','phr-invoice-balance');
  el('phr-production-meta').textContent=m.production.reportCount+' EOS reports · '+m.production.completedHoles+' holes completed in EOS';
  el('phr-production-kpis').innerHTML=kpi('Total metres',n(m.production.metres)+' m',n(m.production.other)+' m other / unclassified')+kpi('Cored',n(m.production.core)+' m','Recorded EOS production')+kpi('Chipped',n(m.production.chip)+' m','Recorded EOS production')+kpi('Penetration',n(m.production.penetration,2)+' m/h',n(m.production.drillingHours)+' drilling hours');
  el('phr-monthly-chart').innerHTML=monthlyChart(m);
  el('phr-hole-cost-chart').innerHTML=holeCostChart(m.metrics);
  el('phr-contractors').innerHTML=table(contractorHeaders,contractorRows(m.contractors));
  el('phr-source-note').textContent='Budget: '+m.source+'. EOS: loaded production reports. Accounts: current invoice ledger, excluding GST. Budgets cover the full project plan; EOS uses the selected dates and the invoice total includes all project billing periods; the monthly chart shows selected billing months. No forecasts or accruals.';
  el('page-reports').querySelector('.phr-content').hidden=false;el('project-hole-print').disabled=false;
  renderPeriodMap(m.metrics.map(h=>h.borehole));
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
  for(const rows of chunk(m.metrics,10))pages.push('<h1>Planned vs actual hole costs</h1>'+holeCostChart(rows));
  for(const rows of chunk(m.contractors,14))pages.push('<h1>Contractor reconciliation</h1><p class="phr-note">Planned budgets, EOS charges and invoice actuals are separate comparisons. All amounts exclude GST.</p>'+table(contractorHeaders,contractorRows(rows)));
  if(periodMapPrintHoles.length){const map=el('period-map-print'),old=map.getAttribute('style');map.style.cssText='display:block;position:absolute;visibility:hidden;width:1000px;height:420px';renderPeriodPrintMap();pages.unshift('<h1>Project hole locations</h1><div class="print-location-map">'+map.innerHTML+'</div>');if(old===null)map.removeAttribute('style');else map.setAttribute('style',old);}
  const header='<header><div class="brand">Drill<span>Ops</span><small>PROJECT</small></div><div><b>'+esc(m.scope.project)+' · '+esc(m.scope.program)+'</b><small>'+esc(m.from+' to '+m.to)+'</small></div></header>';
  const styles=printStyles();
  win.document.open();win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+esc(m.scope.project)+' · Hole-by-hole report</title><style>'+styles+'</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div>'+pages.map((body,i)=>'<section class="sheet">'+header+body+'<footer><span>Hole-by-hole report · '+esc(new Date().toLocaleDateString('en-AU',{timeZone:'Australia/Brisbane'}))+'</span><span>Page '+(i+1)+' of '+pages.length+'</span></footer></section>').join('')+'</body></html>');win.document.close();win.focus();
 }
 function printStyles(){return '*{box-sizing:border-box}body{margin:0;background:#e9eeeb;color:#173b36;font:11px Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.toolbar{text-align:center;padding:16px}.toolbar button{padding:12px 24px;background:#173b36;color:white;border:0;border-radius:6px;cursor:pointer}.sheet{width:297mm;min-height:210mm;margin:16px auto;padding:10mm 12mm 15mm;background:white;position:relative;break-after:page}.sheet:last-child{break-after:auto}header{display:flex;justify-content:space-between;align-items:center;text-align:right;border-bottom:2px solid #173b36;padding-bottom:11px;margin-bottom:20px}.brand{font-size:25px;letter-spacing:-1px;font-weight:800;text-align:left}.brand span{color:#6c9986}header small{display:block;font-size:10px;letter-spacing:0;color:#657873;margin-top:5px}.brand small{font-size:8px;letter-spacing:2px}h1{font-size:24px;margin:12px 0 18px}h2{font-size:15px;margin:16px 0 12px}h2 small{font-size:10px;font-weight:400;color:#657873;margin-left:15px}.phr-note{font-size:10px;color:#657873;line-height:1.6}.phr-kpis,#phr-budget-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}.phr-kpi{padding:12px;border:1px solid #dce5e1;border-radius:7px}.phr-kpi span,.phr-kpi small{display:block;font-size:9px;color:#657873}.phr-kpi strong{display:block;font-size:23px;margin:7px 0}.phr-production,#phr-production-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.phr-table{width:100%;border-collapse:collapse;font-size:10px}.phr-table th,.phr-table td{padding:10px 6px;border-bottom:1px solid #dce5e1;text-align:left;vertical-align:top}.phr-table th{background:#edf3ef;color:#506b5f}.phr-table .num{text-align:right;white-space:nowrap}.phr-table small{display:block;font-size:8px;color:#657873;margin-top:4px}.phr-negative{color:#a04430}.phr-chart{width:100%;display:block;max-height:430px}.sheet:has(#phr-budget-kpis) .phr-chart{max-height:205px}.phr-chart text{font-size:11px;fill:#657873}.phr-chart .value{fill:#173b36;font-size:10px}.grid{stroke:#e5ece8}.plan{fill:#d9e4dc}.core,.eos{fill:#237a65}.chip{fill:#b4c9b7}.invoice{fill:#758bb3}.phr-legend{display:flex;gap:18px;margin:12px 0;font-size:10px;color:#657873}.phr-legend i{display:inline-block;width:11px;height:8px;margin-right:5px}.phr-allocation{display:flex;gap:50px;margin:25px 0}.phr-allocation strong{display:block;font-size:24px;margin:10px 0}.phr-allocation small{display:block;color:#657873;max-width:420px;line-height:1.5}.print-location-map{position:relative;width:1000px;height:420px;overflow:hidden}.print-location-map img{position:absolute}.print-map-marker{position:absolute;width:10px;height:10px;border:2px solid white;border-radius:50%;transform:translate(-50%,-50%);z-index:2}.print-map-label{position:absolute;transform:translate(9px,-50%);font-size:10px;background:white;padding:2px;z-index:3}.print-map-attribution{position:absolute;bottom:0;right:0;background:white;font-size:8px}.phr-chart-heading{font-size:14px;margin-top:25px}.phr-issues{font-size:11px;color:#80551e;line-height:1.6}footer{position:absolute;bottom:8mm;left:12mm;right:12mm;display:flex;justify-content:space-between;border-top:1px solid #dce5e1;padding-top:8px;color:#657873;font-size:9px}@page{size:A4 landscape;margin:0}@media print{.toolbar{display:none}body{background:white}.sheet{margin:0;height:210mm;min-height:0}}';}
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
