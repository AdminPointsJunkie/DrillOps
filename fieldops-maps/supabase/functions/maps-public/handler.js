export function publicMapHandler(createClient,env){
 return async req=>{
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return reply(405,{error:'Use POST'});
  try{const text=await req.text();if(text.length>512)return reply(400,{error:'Invalid link'});let body;try{body=JSON.parse(text);}catch{return reply(400,{error:'Invalid link'});}
   if(!/^[a-f0-9]{64}$/.test(body.token||''))return reply(404,{error:'This viewing link is unavailable.'});
   const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   const share=await db.from('map_view_links').select('map_id').eq('token',body.token).eq('enabled',true).maybeSingle();if(share.error||!share.data)return reply(404,{error:'This viewing link is unavailable.'});
   const project=await db.from('maps').select('workspace_id').eq('id',share.data.map_id).maybeSingle();if(project.error||!project.data)return reply(404,{error:'This map is unavailable.'});
   const workspace=await db.from('workspaces').select('status').eq('id',project.data.workspace_id).maybeSingle();if(workspace.error||workspace.data?.status!=='active')return reply(404,{error:'This map is unavailable.'});
   const release=await db.from('map_releases').select('manifest,version,published_at').eq('map_id',share.data.map_id).order('version',{ascending:false}).limit(1).maybeSingle();if(release.error||!release.data)return reply(404,{error:'This map has not been synced yet.'});
   const manifest=structuredClone(release.data.manifest);
   for(const layer of manifest.layers||[]){
    // The public viewer exposes published map data, never private source or attachment files.
    if(layer.fc)for(const feature of layer.fc.features||[]){for(const key of Object.keys(feature.properties||{}))if(key.startsWith('_'))delete feature.properties[key];}
    if(layer.raster_path){const signed=await db.storage.from('gis-files').createSignedUrl(layer.raster_path,60);if(signed.error)throw Error('Map imagery unavailable');layer.url=signed.data.signedUrl;}
    delete layer.raster_path;delete layer.source_raster_path;delete layer.original_paths;
   }
   return reply(200,{...manifest,version:release.data.version,published_at:release.data.published_at});
  }catch{return reply(500,{error:'The shared map could not load. Try again.'});}
 };
}
