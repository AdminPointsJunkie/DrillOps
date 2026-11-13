export function deleteMapHandler(createClient,env){
 return async req=>{
  const headers={'Access-Control-Allow-Origin':'https://www.drillops.com.au','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Use POST.'});
  try{
   const authorization=req.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Sign in to delete a map.'});
   const caller=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
   const auth=await caller.auth.getUser();if(auth.error||!auth.data.user)return reply(401,{error:'Sign in to delete a map.'});
   const body=await req.json();if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.map_id||'')||body.confirm!==true)return reply(400,{error:'Confirm the map to delete.'});
   const prepared=await caller.rpc('maps_delete_map',{p_map:body.map_id,p_action:'prepare'});if(prepared.error)return reply(403,{error:prepared.error.message});
   // Privileged Storage access is used only for the server-authorized cleanup manifest.
   const service=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   const paths=prepared.data.paths;
   for(let i=0;i<paths.length;i+=100){const result=await service.storage.from('gis-files').remove(paths.slice(i,i+100));if(result.error)throw Error('File cleanup failed. Retry Delete map to finish. '+result.error.message);}
   const finished=await caller.rpc('maps_delete_map',{p_map:body.map_id,p_action:'finish'});if(finished.error)throw Error(finished.error.message);
   return reply(200,finished.data);
  }catch(error){return reply(500,{error:error.message||'Deletion could not finish. Retry Delete map.'});}
 };
}
