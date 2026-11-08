/* Shared planning dates; never manufacture a start date for an unscheduled hole. */
(function(root){
 const text=v=>String(v??'').trim(),DAY=86400000;
 function date(v){const s=text(v);let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m){const a=s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);if(a)m=['',a[3],a[2].padStart(2,'0'),a[1].padStart(2,'0')];}if(!m)return '';const iso=m[1]+'-'+m[2]+'-'+m[3],d=new Date(iso+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===iso?iso:'';}
 const number=v=>v!==null&&v!==undefined&&text(v)!==''&&Number.isFinite(+v)?+v:null;
 const add=(iso,n)=>new Date(Date.parse(iso+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
 const diff=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/DAY);
 function build(source,scope){
  const rows=source.filter(b=>(!scope.project||text(b.project)===text(scope.project))&&(!scope.program||text(b.program)===text(scope.program))&&(!b.planned_year||text(b.planned_year)===text(scope.year))).map(b=>{
   const start=date(b.scheduled_start),savedEnd=date(b.scheduled_end),duration=number(b.days_budgeted),derived=!!(start&&!savedEnd&&!text(b.scheduled_end)&&duration>0),end=derived?add(start,Math.ceil(duration)-1):savedEnd,rig=text(b.assigned_rig||b.drill_rig),invalid=!!((text(b.scheduled_start)&&!start)||(text(b.scheduled_end)&&!savedEnd)||(start&&end&&end<start));
   return {key:String(b.id??JSON.stringify([b.contractor,b.project,b.program,b.hole_id])),b,hole:text(b.hole_id)||'Unnamed hole',site:text(b.site_id),rig,start,end,derived,invalid,scheduled:!!(rig&&start&&end&&!invalid),status:text(b.status)||'Planned',days:start&&end&&!invalid?diff(start,end)+1:null,clashes:[]};
  });
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(a.scheduled&&b.scheduled&&a.status!=='Cancelled'&&b.status!=='Cancelled'&&a.rig===b.rig&&a.start<=b.end&&b.start<=a.end){a.clashes.push(b.key);b.clashes.push(a.key);}}
  return rows.sort((a,b)=>(number(a.b.drill_order)??9999)-(number(b.b.drill_order)??9999)||a.hole.localeCompare(b.hole,undefined,{numeric:true}));
 }
 function lanes(rows){const ends=[];return rows.slice().sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end)).map(r=>{let lane=ends.findIndex(end=>end<r.start);if(lane<0)lane=ends.length;ends[lane]=r.end;return {...r,lane};});}
 function groups(rows){const groups=new Map();for(const r of rows){const key=JSON.stringify([r.b.project,r.rig]);if(!groups.has(key))groups.set(key,{key,project:r.b.project,rig:r.rig,rows:[]});groups.get(key).rows.push(r);}return [...groups.values()].sort((a,b)=>a.project.localeCompare(b.project)||a.rig.localeCompare(b.rig,undefined,{numeric:true}));}
 const norm=v=>text(v).toUpperCase().replace(/^(IB|CD)-(?=\d{2}-)/,'');
 function combine(entries,planner){
  const cancelled=new Set(planner.filter(b=>text(b.status).toLowerCase()==='cancelled').flatMap(b=>[b.site_id,b.hole_id].filter(Boolean).map(v=>JSON.stringify([b.project,b.program,norm(v)]))));
  const bookings=entries.map(r=>({...r,id:'booking-'+r.id,schedule_id:r.id}));
  const covered=new Set(bookings.flatMap(r=>[r.hole_id,r.site_id].filter(Boolean).map(v=>JSON.stringify([r.project,r.program,norm(v)]))));
  const seen=new Map();for(const b of planner){if(text(b.status).toLowerCase()==='cancelled'||!b.project)continue;const ids=[b.hole_id,b.site_id].filter(Boolean).map(norm);if(ids.some(v=>covered.has(JSON.stringify([b.project,b.program,v]))||cancelled.has(JSON.stringify([b.project,b.program,v]))))continue;const key=JSON.stringify([b.project,b.program,norm(b.site_id||b.hole_id)]),old=seen.get(key);if(!old||(!/^\d/.test(b.hole_id)&&/^\d/.test(old.hole_id)))seen.set(key,b);}
  return bookings.concat([...seen.values()]);
 }
 const api={date,add,diff,build,lanes,groups,combine};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RigScheduler=api;
})(globalThis);
