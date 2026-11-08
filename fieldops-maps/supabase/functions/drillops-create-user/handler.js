const ownerId='c636e8ab-01d4-458e-a455-6f329dae6bf1';
const allowedApps=['fieldmaps','eos','account','project','field'];
export function createHandler(createClient,env){return async req=>{
 const origin=req.headers.get('Origin')||'';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 if(origin&&!['https://www.drillops.com.au','https://drillops.com.au'].includes(origin))return new Response(null,{status:403});
 if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'});
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const authorization=req.headers.get('Authorization')||'';
 if(!/^Bearer \S+$/.test(authorization))return reply({error:'Sign in to DrillOps first.'},401);
 try{
  const db=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await db.auth.getUser(authorization.slice(7));
  if(authError||!identity.user)return reply({error:'Your session expired. Sign in again.'},401);
  if(identity.user.id!==ownerId)return reply({error:'Owner access required.'},403);
  const {data:access,error:accessError}=await db.rpc('drillops_access');
  if(accessError)return reply({error:'Access could not be checked. Please retry.'},503);
  if(!access?.owner||!access.active)return reply({error:'Owner access required.'},403);
  let input;try{input=await req.json();}catch{return reply({error:'Invalid form.'},400);}
  const name=typeof input?.name==='string'?input.name.trim():'',email=typeof input?.email==='string'?input.email.trim().toLowerCase():'',password=input?.password,apps=input?.apps;
  if(!name||name.length>120||!/^\S+@\S+\.\S+$/.test(email)||email.length>254)return reply({error:'Enter a name and valid email address.'},400);
  if(typeof password!=='string'||password.length<8||password.length>128)return reply({error:'Use a password between 8 and 128 characters.'},400);
  if(!Array.isArray(apps)||!apps.length||apps.length>5||apps.some(a=>!allowedApps.includes(a)))return reply({error:'Choose at least one valid app.'},400);
  const service=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  // The database trigger creates the chosen grants in the same transaction as the user.
  const {data,error}=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name},app_metadata:{drillops_created_by:identity.user.id,drillops_initial_apps:[...new Set(apps)]}});
  if(error){const duplicate=['email_exists','user_already_exists'].includes(error.code)||/already.*registered|already.*exists/i.test(error.message);return reply({error:duplicate?'This email already has a DrillOps account. Edit their access in the user list.':'Account could not be created. Check the details and password, then retry.'},duplicate?409:400);}
  return reply({id:data.user.id,email:data.user.email},201);
 }catch{return reply({error:'Account creation is temporarily unavailable. Refresh the user list before retrying.'},503);}
};}
