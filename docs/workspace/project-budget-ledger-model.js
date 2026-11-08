(function(root){
 const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 const cents=v=>Math.round(v*100),norm=v=>String(v??'').trim().toLowerCase();
 function plannerMatch(h,source,plannerRows,scope){
  if(plannerRows===null)return {planner_status:'Unavailable',planner_linked:false};
  const eligible=plannerRows.filter(r=>!r.planning_source_fallback&&norm(r.project)===norm(scope.project||source.project)&&norm(r.program)===norm(scope.program||'Exploration')&&String(r.planned_year??r.year)===String(scope.year||source.year)&&(!r.client_id||!scope.clientId||String(r.client_id)===String(scope.clientId)));
  const exact=eligible.filter(r=>norm(r.hole_id)===norm(h.hole_id));
  const ids=new Set([h.hole_id,h.site_id].map(norm).filter(Boolean));
  const matches=exact.length?exact:eligible.filter(r=>[r.hole_id,r.site_id,...(r.activity_hole_ids||[])].some(v=>ids.has(norm(v))));
  if(matches.length!==1)return {planner_status:matches.length?'Ambiguous match':'Not linked',planner_linked:false};
  const status=String(matches[0].status||'').trim();
  return {planner_status:({planned:'Planned','in progress':'In Progress',complete:'Complete',cancelled:'Cancelled'})[norm(status)]||status||'Not recorded',planner_linked:!!status,planner_hole:matches[0].hole_id};
 }
 function build(source,{search='',status='',plannerRows=null,scope={}}={}){
  const definitions=Array.isArray(source.contractors)?source.contractors:[],detail=new Map((source.holes||[]).map(r=>[String(r[1]),r]));
  const categories=[['drilling_budget_total','Drilling'],['earthworks_budget_total','Earthworks'],['geophysical_budget_total','Geophysical'],['geological_support_budget_total','Geological support'],['misc_budget_total','Other']];
  const columns=definitions.length?definitions.map(c=>({key:c.key,label:c.name,sub:c.source_line||''})):categories.map(([key,label])=>({key,label,sub:''}));
  const all=(source.boreholes||[]).map((h,index)=>{
   const raw=detail.get(String(h.hole_id)),values=definitions.length?definitions.map((_,i)=>number(raw?.[3+i])):categories.map(([key])=>number(h[key]));
   const total=number(h.budget_total),complete=values.every(v=>v!==null),sum=complete?values.reduce((a,b)=>a+cents(b),0):null;
   const live=plannerMatch(h,source,plannerRows,scope);
   return {...h,...live,potentialSaving:live.planner_linked?(live.planner_status==='Cancelled'?total:0):null,index,values,total,rounding:total!==null&&sum!==null?(cents(total)-sum)/100:null};
  });
  const query=search.trim().toLowerCase(),rows=all.filter(r=>(!status||r.planner_status===status)&&(!query||[r.hole_id,r.site_id,r.purpose,r.classification].join(' ').toLowerCase().includes(query)));
  const sum=key=>rows.every(r=>key(r)!==null)?rows.reduce((a,r)=>a+cents(key(r)),0)/100:null;
  const cancelled=rows.filter(r=>r.planner_status==='Cancelled'&&r.planner_linked),potentialSaving=plannerRows===null||(rows.length>0&&rows.every(r=>!r.planner_linked))||cancelled.some(r=>r.total===null)?null:cancelled.reduce((sum,r)=>sum+cents(r.total),0)/100;
  return {rows,columns,potentialSaving,cancelledCount:cancelled.length,unlinked:rows.filter(r=>!r.planner_linked).length,plannerUnavailable:plannerRows===null,statuses:[...new Set(all.map(r=>r.planner_status).filter(Boolean))],count:all.length,hasContractors:!!definitions.length,showRounding:all.some(r=>r.rounding!==null&&r.rounding!==0),totals:{values:columns.map((_,i)=>sum(r=>r.values[i])),rounding:sum(r=>r.rounding),total:sum(r=>r.total)},missing:rows.filter(r=>r.values.some(v=>v===null)).length};
 }
 const api={build,plannerMatch};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ProjectBudgetLedger=api;
})(typeof globalThis!=='undefined'?globalThis:this);
