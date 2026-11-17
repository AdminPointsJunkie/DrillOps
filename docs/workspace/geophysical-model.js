/* Service metrics never treat logging intervals as newly drilled metres. */
(function(root){
 function hours(r){const m=String(r.total_time||'').match(/^(\d+):(\d{2})$/);return m?Number(m[1])+Number(m[2])/60:0;}
 function summarise(rows,type){
  const operations=rows.filter(r=>!String(r.code||'').startsWith('WFD_'));
  const logging=operations.filter(r=>String(r.code||'').toUpperCase()==='P200'||/logging run/i.test(r.notes||''));
  const intervals=logging.filter(r=>r.metres_from!==null&&r.metres_from!==undefined&&r.metres_from!==''&&r.metres_to!==null&&r.metres_to!==undefined&&r.metres_to!==''&&Number.isFinite(Number(r.metres_from))&&Number.isFinite(Number(r.metres_to)));
  const reports=new Set(rows.map(r=>[r.source_file||'Manual entry',r.date||'Undated',(String(r.notes||'').match(/Source page (\d+)/i)||[])[1]||''].join('|')));
  const holes=new Set(logging.map(r=>String(r.hole_num||'').trim()).filter(h=>h&&!/^(n\/?a|unknown|induction|-+)$/i.test(h)));
  return {reports:reports.size,holes:holes.size,metres:intervals.reduce((n,r)=>n+Math.abs(Number(r.metres_to)-Number(r.metres_from)),0),hours:(type==='Geophysical Logging'?logging:operations).reduce((n,r)=>n+hours(r),0),charges:rows.reduce((n,r)=>n+(Number(r.line_cost)||0),0),unpriced:rows.filter(r=>r.line_cost===null||r.line_cost===undefined).length,missingIntervals:logging.length-intervals.length,operations,logging};
 }
 root.ServiceProduction={summarise};
})(globalThis);
