(function(root){
 const pending=s=>!['Results received','Reviewed','Cancelled'].includes(s.status);
 function summary(samples,today){const active=samples.filter(s=>s.status!=='Cancelled');return {count:active.length,pending:active.filter(pending).length,overdue:active.filter(s=>pending(s)&&s.due_on&&s.due_on<today).length,unpriced:active.filter(s=>s.projected_cost==null).length,projected:active.reduce((sum,s)=>sum+(s.projected_cost==null?0:Number(s.projected_cost)),0)};}
 const api={pending,summary};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LabsModel=api;
})(globalThis);
