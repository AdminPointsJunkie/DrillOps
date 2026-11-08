/* Shared visual summaries for Overview and the printable Production Report. */
const productionNumber=(value,digits=1)=>Number(value||0).toLocaleString('en-AU',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const productionSet=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
let eosIncludeNonChargeableStandby=false;
const eosStandbyOptions=completionSource=>({includeNonChargeable:eosIncludeNonChargeableStandby,completionSource});
function setEosStandbyPreference(value){
 eosIncludeNonChargeableStandby=!!value;document.querySelectorAll('[data-eos-standby-toggle]').forEach(input=>input.checked=eosIncludeNonChargeableStandby);
 if(isPageActive('reports'))renderEosPeriodReport();else if(isPageActive('app-home'))renderEosOverviewTime();
}
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
function eosBarChart(rows,keys=['core','chip','other'],unit='m'){
 const names={chargeableHours:'Chargeable',nonChargeableHours:'Non-chargeable',moveOnlyHours:'Site move',combinedMoveHours:'Move + setup'};
 const total=r=>keys.reduce((sum,k)=>sum+(Number(r[k])||0),0),max=Math.max(0,...rows.map(total));
 if(!rows.length)return '<p class="production-empty">No records for these filters.</p>';
 return '<div class="eos-bars">'+rows.map(r=>'<div class="eos-bar-row"><div class="eos-bar-label"><span>'+esc(r.label)+'</span><strong>'+productionNumber(total(r))+' <small>'+unit+'</small></strong></div><div class="eos-bar-track" role="img" aria-label="'+attr(r.label+': '+keys.map(k=>(names[k]||k)+' '+productionNumber(r[k])+' '+unit).join(', '))+'">'+keys.map(k=>'<span class="eos-bar-'+k+'" style="width:'+(max?Math.max(0,Number(r[k])||0)/max*100:0)+'%" title="'+attr((names[k]||k)+': '+productionNumber(r[k])+' '+unit)+'"></span>').join('')+'</div></div>').join('')+'</div>';
}
function eosTimeChart(s){
 const chartHours=s.displayedHours??s.hours;
 const parts=[{label:'Drilling',hours:s.drillingHours,colour:'#315d49'},{label:'Standby',hours:s.standbyHours,colour:'#c5aa70'},{label:'Site moves',hours:s.movingHours||0,colour:'#7c98ad'},{label:'Other activity',hours:s.otherHours??Math.max(0,chartHours-s.drillingHours-s.standbyHours-(s.movingHours||0)),colour:'#cbd2cc'}],circ=2*Math.PI*54;let offset=0;
 const circles=parts.map(p=>{const length=chartHours?p.hours/chartHours*circ:0,svg='<circle cx="74" cy="74" r="54" fill="none" stroke="'+p.colour+'" stroke-width="17" stroke-dasharray="'+length+' '+(circ-length)+'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 74 74)"/>';offset+=length;return svg;}).join('');
 return '<div class="eos-time-chart"><svg viewBox="0 0 148 148" role="img" aria-label="Displayed activity hours"><title>'+parts.map(p=>p.label+': '+productionNumber(p.hours)+' hours').join(', ')+'</title><circle cx="74" cy="74" r="54" fill="none" stroke="#edf1ed" stroke-width="17"/>'+circles+'<text x="74" y="73" text-anchor="middle" class="eos-time-total">'+productionNumber(chartHours)+'</text><text x="74" y="91" text-anchor="middle">displayed hours</text></svg><div>'+parts.map(p=>'<div class="eos-time-key"><i style="background:'+p.colour+'"></i><span>'+p.label+'</span><strong>'+productionNumber(p.hours)+' h</strong></div>').join('')+'</div></div>';
}
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
 const figures=[['Penetration rate',rate(s.penetration),'m / drilling h'],['Core penetration',rate(s.corePenetration),'m / core drilling h'],['Chip penetration',rate(s.chipPenetration),'m / chip drilling h'],['Metres / production day',n(s.average),'m / day'],['Cored / production day',n(s.averageCore),'m / day']];
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

function renderEosOtherActivities(prefix,summary,unavailable=false){
 const host=document.getElementById(prefix+'-other-chart');if(!host)return;
 host.innerHTML=unavailable?'':eosBarChart(summary.otherActivities.filter(r=>r.hours>0),['hours'],'h');
 productionSet(prefix+'-other-summary',unavailable?'':productionNumber(summary.otherHours)+' h · by recorded activity code');
}
