(function(root){
 const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 const cents=v=>Math.round(v*100);
 function build(source,{search='',status=''}={}){
  const definitions=Array.isArray(source.contractors)?source.contractors:[],detail=new Map((source.holes||[]).map(r=>[String(r[1]),r]));
  const categories=[['drilling_budget_total','Drilling'],['earthworks_budget_total','Earthworks'],['geophysical_budget_total','Geophysical'],['geological_support_budget_total','Geological support'],['misc_budget_total','Other']];
  const columns=definitions.length?definitions.map(c=>({key:c.key,label:c.name,sub:c.source_line||''})):categories.map(([key,label])=>({key,label,sub:''}));
  const all=(source.boreholes||[]).map((h,index)=>{
   const raw=detail.get(String(h.hole_id)),values=definitions.length?definitions.map((_,i)=>number(raw?.[3+i])):categories.map(([key])=>number(h[key]));
   const total=number(h.budget_total),complete=values.every(v=>v!==null),sum=complete?values.reduce((a,b)=>a+cents(b),0):null;
   return {...h,index,values,total,rounding:total!==null&&sum!==null?(cents(total)-sum)/100:null};
  });
  const query=search.trim().toLowerCase(),rows=all.filter(r=>(!status||r.source_status===status)&&(!query||[r.hole_id,r.site_id,r.purpose,r.classification].join(' ').toLowerCase().includes(query)));
  const sum=key=>rows.every(r=>key(r)!==null)?rows.reduce((a,r)=>a+cents(key(r)),0)/100:null;
  return {rows,columns,statuses:[...new Set(all.map(r=>r.source_status).filter(Boolean))],count:all.length,hasContractors:!!definitions.length,showRounding:all.some(r=>r.rounding!==null&&r.rounding!==0),totals:{values:columns.map((_,i)=>sum(r=>r.values[i])),rounding:sum(r=>r.rounding),total:sum(r=>r.total)},missing:rows.filter(r=>r.values.some(v=>v===null)).length};
 }
 const api={build};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ProjectBudgetLedger=api;
})(typeof globalThis!=='undefined'?globalThis:this);
