import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
const canonical='https://dzthwvxrltkltfvubvld.supabase.co';
const legacy='https://hgovycdpiiumcscljkrd.supabase.co';
const legacyKey='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhnb3Z5Y2RwaWl1bWNzY2xqa3JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDQ3NTUsImV4cCI6MjA5MzU4MDc1NX0.c_seiCfIfVDEVJYK5ZHOoNZ8e1PkasLUHeZt-vPC26A';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
 if(req.method!=='POST')return json({detail:'Method not allowed'},405);
 const authorization=req.headers.get('Authorization')||'';
 if(!/^Bearer \S+$/.test(authorization))return json({detail:'Authentication required'},401);
 let issuer:string;try{const token=authorization.slice(7),part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');issuer=JSON.parse(atob(part)).iss;}catch{return json({detail:'Invalid session'},401);}
 const provider=issuer===canonical+'/auth/v1'?'canonical':issuer===legacy+'/auth/v1'?'legacy':null;
 if(!provider)return json({detail:'Unknown identity provider'},401);
 // The unverified issuer only selects a fixed, allowlisted verifier. No claims are trusted.
 try{
  const response=await fetch((provider==='canonical'?canonical:legacy)+'/auth/v1/user',{headers:{Authorization:authorization,apikey:provider==='canonical'?Deno.env.get('SUPABASE_ANON_KEY')!:legacyKey},signal:AbortSignal.timeout(8000)});
  if(response.status>=500)return json({detail:'Sign-in verification unavailable'},503);
  if(!response.ok)return json({detail:'Invalid or expired session'},401);
  const user=await response.json();if(!user.id)return json({detail:'Invalid session'},401);
  const service=createClient(canonical,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await service.rpc('drillops_identity_access',{provider,subject:user.id});
  if(error)return json({detail:'Access lookup unavailable'},503);
  if(!data||!data.active)return json({detail:'Your DrillOps account has no active access'},403);
  return json(data);
 }catch{return json({detail:'Sign-in verification unavailable'},503);}
});
