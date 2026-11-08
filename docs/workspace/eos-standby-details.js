/* Details use the report's already filtered, deduplicated, chargeable standby entries. */
let eosStandbyDetailSummary=null,eosStandbyDetailCharges=false;
const standbyEl=id=>document.getElementById('eos-standby-'+id);
function standbyRecordedCharge(entries){
 let total=0,priced=0,missing=0;
 for(const row of entries){
  const raw=row.line_cost;
  if(row.is_cost_source===false||row.is_cost_source==='false'||raw==null||String(raw).trim()===''||!Number.isFinite(Number(raw))){missing++;continue;}
  total+=Number(raw);priced++;
 }
 return priced?cur(total)+(missing?' *':''):'Unpriced';
}
function renderEosStandbyDetails(summary,showCharges){
 eosStandbyDetailSummary=summary;eosStandbyDetailCharges=showCharges;
 standbyEl('show-charges').checked=showCharges;
 standbyEl('details-summary').textContent=summary?summary.reasons.length+' reason'+(summary.reasons.length===1?'':'s')+' · '+productionNumber(summary.standbyHours,2)+' h':'';
 if(!summary){standbyEl('reasons').replaceChildren();standbyEl('detail-note').textContent='';return;}
 standbyEl('detail-note').textContent=eosStandbyNote(summary)+(showCharges?' · Recorded activity charges only. * Partial pricing; materials are excluded.':'');
 if(standbyEl('details').open)renderEosStandbyReasons();
}
function renderEosStandbyReasons(){
 const container=standbyEl('reasons'),reasons=eosStandbyDetailSummary?.reasons||[];
 const opened=new Set([...container.querySelectorAll('details[open]')].map(el=>el.dataset.reason));
 container.innerHTML=reasons.map((reason,index)=>'<details class="eos-standby-reason" data-reason="'+attr(reason.label)+'" data-index="'+index+'"'+(opened.has(reason.label)?' open':'')+'><summary><span><strong>'+esc(reason.label)+'</strong><small>'+reason.rows+' entr'+(reason.rows===1?'y':'ies')+(reason.missing?' · '+reason.missing+' missing duration':'')+'</small></span><span class="eos-standby-reason-figures"><strong>'+productionNumber(reason.hours,2)+' h</strong>'+(eosStandbyDetailCharges?'<small>'+esc(standbyRecordedCharge(reason.entries))+'</small>':'')+'</span></summary><div class="eos-standby-entries"></div></details>').join('')||'<p class="eos-document-note">No standby entries for these filters.</p>';
 for(const detail of container.querySelectorAll('details')){
  detail.addEventListener('toggle',()=>renderEosStandbyEntries(detail));
  if(detail.open)renderEosStandbyEntries(detail);
 }
}
function renderEosStandbyEntries(detail){
 const body=detail.querySelector('.eos-standby-entries');
 if(!detail.open){body.replaceChildren();return;}
 const reason=eosStandbyDetailSummary?.reasons[Number(detail.dataset.index)];if(!reason||reason.label!==detail.dataset.reason)return;
 const rows=[...reason.entries].sort((a,b)=>EosProduction.date(a.date).localeCompare(EosProduction.date(b.date))||String(a.drill_rig||'').localeCompare(String(b.drill_rig||''))||String(a.shift||'').localeCompare(String(b.shift||'')));
 body.innerHTML='<div class="tbl-scroll"><table class="eos-standby-entry-table"><thead><tr><th>Date / shift</th><th>Rig / project</th><th>Activity / notes</th><th class="num">Hours</th>'+(eosStandbyDetailCharges?'<th class="num">Charges (AUD)</th>':'')+'</tr></thead><tbody>'+rows.map(r=>{
  const hours=EosProduction.hours(r),status=EosProduction.standbyChargeability(r);
  return '<tr><td>'+esc(productionDisplayDate(r.date,true))+'<small>'+esc(r.shift||'Shift not recorded')+'</small></td><td>'+esc(r.drill_rig||'Rig not recorded')+'<small>'+esc(r.project||'Unassigned project')+(r.hole_num?' · '+esc(r.hole_num):'')+'</small></td><td>'+esc(r.notes||r.code||'No notes recorded')+'<small>'+esc(r.code||'No activity code')+'</small><small>'+esc(r.source_file||'Manual entry')+(status==='non-chargeable'?' · Non-chargeable':'')+'</small></td><td class="num">'+(hours===null?'Not recorded':productionNumber(hours,2))+'</td>'+(eosStandbyDetailCharges?'<td class="num">'+esc(standbyRecordedCharge([r]))+'</td>':'')+'</tr>';
 }).join('')+'</tbody></table></div>';
}
function expandEosStandbyReasons(expanded){for(const detail of standbyEl('reasons').querySelectorAll('details')){detail.open=expanded;renderEosStandbyEntries(detail);}}
standbyEl('details').addEventListener('toggle',()=>{if(standbyEl('details').open)renderEosStandbyReasons();else standbyEl('reasons').replaceChildren();});
