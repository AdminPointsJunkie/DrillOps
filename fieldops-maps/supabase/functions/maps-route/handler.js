const profiles={driving:'driving-car',cycling:'cycling-regular',walking:'foot-walking'};
const coordinate=c=>Array.isArray(c)&&c.length===2&&c.every(Number.isFinite)&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90;
export function routeHandler(createClient,env,{fetcher=fetch,now=Date.now}={}){
 const recent=new Map();
 return async req=>{
  const headers={'Access-Control-Allow-Origin':'https://www.drillops.com.au','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Use POST.'});
  try{
   const authorization=req.headers.get('Authorization');
   if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Sign in to use online routing.'});
   const caller=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
   const auth=await caller.auth.getUser();if(auth.error||!auth.data.user)return reply(401,{error:'Sign in to use online routing.'});
   const text=await req.text();if(text.length>12000)return reply(413,{error:'Use up to 25 route stops.'});
   let body;try{body=JSON.parse(text);}catch{return reply(400,{error:'Invalid route request.'});}
   const {map_id,mode,coordinates}=body;
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(map_id||'')||!Object.hasOwn(profiles,mode)||!Array.isArray(coordinates)||coordinates.length<2||coordinates.length>25||!coordinates.every(coordinate))return reply(400,{error:'Choose a saved project, a travel mode and 2–25 valid stops.'});
   // Draft-map SELECT uses the current workspace/project edit-access policy.
   // No service-role bypass and no authorization from stale JWT metadata.
   const access=await caller.from('maps').select('id').eq('id',map_id).maybeSingle();
   if(access.error||!access.data)return reply(403,{error:'You no longer have editing access to this project.'});
   if(!env.ORS_API_KEY)return reply(503,{error:'Online routing needs its free openrouteservice account connected. Imported tracks are still available.'});
   const time=now(),uid=auth.data.user.id;
   for(const [id,times] of recent)if(times.at(-1)<time-60000)recent.delete(id);
   const calls=(recent.get(uid)||[]).filter(t=>t>time-60000);
   if(calls.length>=12)return reply(429,{error:'Please wait a minute before calculating more routes.'});
   recent.set(uid,[...calls,time]);
   const response=await fetcher('https://api.openrouteservice.org/v2/directions/'+profiles[mode]+'/geojson',{method:'POST',headers:{Authorization:env.ORS_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({coordinates,instructions:false,elevation:false}),redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!response.ok){
    if([403,429].includes(response.status))return reply(429,{error:'The free routing allowance is unavailable or exhausted. Try later or use imported tracks.'});
    return reply(502,{error:response.status===400||response.status===404?'No road route was found. Move the stops closer to connected roads.':'The routing service is unavailable. Try again later.'});
   }
   const result=await response.json(),feature=result.features?.[0],geometry=feature?.geometry;
   if(geometry?.type!=='LineString'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length<2||geometry.coordinates.length>100000||!geometry.coordinates.every(coordinate))return reply(502,{error:'The routing service returned an invalid route.'});
   return reply(200,{type:'FeatureCollection',features:[{type:'Feature',geometry,properties:{mode,distance_m:feature.properties?.summary?.distance,method:'openrouteservice',attribution:'© openrouteservice by HeiGIT | © OpenStreetMap contributors',license:'CC-BY-SA-4.0'}}]});
  }catch(error){return reply(502,{error:error?.name==='TimeoutError'?'Routing took too long. Try fewer stops.':'Online routing could not be completed. Please retry.'});}
 };
}
