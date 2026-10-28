export function inviteHandler(createClient,env){
 return async req=>{
  const headers={'Access-Control-Allow-Origin':'https://www.drillops.com.au','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Use POST'});
  try{
   const authorization=req.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Sign in required'});
   const caller=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
   const auth=await caller.auth.getUser();if(auth.error||!auth.data.user)return reply(401,{error:'Sign in required'});
   const body=await req.json(),id=String(body.invitation_id||'');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return reply(400,{error:'Choose a workspace invitation. Refresh Workspace settings.'});
   // Resolve recipient, role and company from the authorized database record, not request fields.
   const dispatch=await caller.rpc('workspace_invitation_dispatch',{p_invitation:id});if(dispatch.error)return reply(403,{error:dispatch.error.message});
   const invitation=dispatch.data;if(!invitation?.email||!invitation.attempt)return reply(403,{error:'Invitation unavailable'});
   const service=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   let result;
   try{result=invitation.existing
    ?await service.auth.signInWithOtp({email:invitation.email,options:{shouldCreateUser:false,emailRedirectTo:'https://www.drillops.com.au/maps/'}})
    :await service.auth.admin.inviteUserByEmail(invitation.email,{data:{full_name:invitation.name},redirectTo:'https://www.drillops.com.au/maps/'});
   }catch{await service.rpc('workspace_invitation_delivery',{p_invitation:id,p_attempt:invitation.attempt,p_ok:false});return reply(502,{error:'Email delivery could not be confirmed. Retry from Invitations.'});}
   const recorded=await service.rpc('workspace_invitation_delivery',{p_invitation:id,p_attempt:invitation.attempt,p_ok:!result.error});
   if(result.error)return reply(400,{error:result.error.message});
   if(recorded.error)return reply(500,{error:'Email sent, but invitation status could not be saved. Resend from Invitations to recover.'});
   return reply(200,{id});
  }catch{return reply(500,{error:'Invitation could not be confirmed. Check Invitations before retrying.'});}
 };
}
