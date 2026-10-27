export function inviteHandler(createClient,env){
 return async req=>{
  const headers={'Access-Control-Allow-Origin':'https://www.drillops.com.au','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Use POST'});
  try{
   const authorization=req.headers.get('Authorization');
   if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Sign in required'});
   const caller=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
   const auth=await caller.auth.getUser();if(auth.error||!auth.data.user)return reply(401,{error:'Sign in required'});
   const admin=await caller.rpc('maps_admin');if(admin.error||admin.data!==true)return reply(403,{error:'Admin access required'});
   const body=await req.json();const email=String(body.email||'').trim(),name=String(body.name||'').trim();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||name.length>160)return reply(400,{error:'Enter a valid name and email'});
   const service=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   const result=await service.auth.admin.inviteUserByEmail(email,{data:{full_name:name},redirectTo:'https://www.drillops.com.au/maps/'});
   if(result.error)return reply(400,{error:result.error.message});
   // Newly invited accounts have no GIS access until an admin assigns a role.
   return reply(200,{id:result.data.user.id});
  }catch{return reply(500,{error:'Invitation could not be confirmed. Refresh the people list before retrying.'});}
 };
}
