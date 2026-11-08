(function(root){
 const day=86400000,iso=d=>d.toISOString().slice(0,10),norm=v=>String(v||'').trim().toLowerCase(),key=r=>JSON.stringify([Number(r.project_id),norm(r.contractor),norm(r.person)]);
 function build(rosters,entries,month,contractor,project,locations=[]){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return {people:[],planned:0,worked:0,plannedDays:0,workedDays:0,conflicts:0,dates:[]};
  const start=new Date(month+'-01T00:00:00Z'),end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)),dates=Array.from({length:end.getUTCDate()},(_,i)=>iso(new Date(+start+i*day))),filtered=r=>(!contractor||norm(r.contractor)===norm(contractor));
  const versions=rosters.filter(filtered),days=entries.filter(filtered),keys=[...new Set([...versions,...days.filter(r=>r.work_date.startsWith(month))].map(key))];let planned=0,worked=0,plannedDays=0,workedDays=0;
  const people=keys.map(k=>{const rules=versions.filter(r=>key(r)===k).sort((a,b)=>b.effective_from.localeCompare(a.effective_from)),saved=days.filter(r=>key(r)===k),who=rules[0]||saved[0];let visible=false;
   const cells=dates.map(date=>{const rule=rules.find(r=>r.effective_from<=date),valid=rule&&(!rule.effective_to||date<=rule.effective_to),entry=saved.find(r=>r.work_date===date);
    const distance=valid?Math.round((Date.parse(date)-Date.parse(rule.anchor_date))/day):0,cycle=valid?Number(rule.days_on)+Number(rule.days_off):1,on=valid&&((distance%cycle)+cycle)%cycle<Number(rule.days_on);
    const status=entry?.status||(on?'Planned':'Off'),units=entry?Number(entry.units):on?1:0,rate=entry?Number(entry.day_rate):valid?Number(rule.day_rate):1600,cost=Math.round(units*rate*100)/100;
    const follow=(valid?rule:rules.find(r=>r.follow_rig)),matches=follow?.follow_rig?locations.filter(l=>l.date===date&&norm(l.contractor)===norm(follow.follow_contractor)&&norm(l.drill_rig)===norm(follow.follow_rig)):[];
    const ids=[...new Set(matches.map(l=>l.project_id))],allocation=follow?.follow_rig?(ids.length===1&&ids[0]!=null?Number(ids[0]):null):Number(who.project_id),sites=[...new Set(matches.map(l=>l.site).filter(Boolean))].join(', ');
    const included=!project||(project==='unallocated'?allocation==null:allocation===Number(project));if((valid||entry)&&included)visible=true;
    if(!included)return {date,status:'Filtered',units:0,rate,cost:0,entry,rule:valid?rule:null,conflict:false,allocation,sites,included:false};
    if(status==='Worked'){worked+=cost;workedDays+=units;}if(status==='Planned'){planned+=cost;plannedDays+=units;}
    return {date,status,units,rate,cost,entry,rule:valid?rule:null,conflict:false,allocation,sites,included:true,allocationReason:follow?.follow_rig?(matches.length?(allocation==null?'Multiple or unmatched projects':'Matched rig report'):'Awaiting rig report'):'Fixed project'};});
   return {...who,key:k,cells,visible};}).filter(p=>p.visible).sort((a,b)=>a.person.localeCompare(b.person)||Number(a.project_id)-Number(b.project_id));
  let conflicts=0;for(const date of dates){const groups=new Map();for(const p of people){const c=p.cells.find(c=>c.date===date);if(!['Planned','Worked'].includes(c.status)||!c.units)continue;const k=norm(p.contractor)+'|'+norm(p.person);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}for(const cells of groups.values())if(cells.length>1){conflicts++;cells.forEach(c=>c.conflict=true);}}
  return {people,dates,planned,worked,plannedDays,workedDays,conflicts};
 }
 const api={build,key};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DayRatesModel=api;
})(globalThis);
