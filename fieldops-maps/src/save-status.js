export function createSaveStatus(onChange=()=>{}){
 const jobs=new Map();
 const state=()=>({pending:[...jobs.values()].some(j=>j.pending),failed:[...jobs.values()].filter(j=>j.error).length});
 function run(key,action){
  const previous=jobs.get(key),job={action,pending:true,error:null};jobs.set(key,job);onChange(state());
  job.promise=(previous?.promise||Promise.resolve()).catch(()=>{}).then(action).then(value=>{
   if(jobs.get(key)===job)jobs.delete(key);return value;
  }).catch(error=>{job.error=error;throw error;}).finally(()=>{job.pending=false;onChange(state());});
  return job.promise;
 }
 return {run,state,async retry(){await Promise.all([...jobs].filter(([,j])=>j.error).map(([key,j])=>run(key,j.action)));},
  async flush(){await Promise.all([...jobs.values()].map(j=>j.promise));},clear(){jobs.clear();onChange(state());}};
}
