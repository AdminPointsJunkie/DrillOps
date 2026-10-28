// Random installation reference; no hardware fingerprint or authentication token is sent.
export async function reportWebDevice(db,workspace,release=null,env=globalThis){
 if(!workspace)return false;
 try{
  let id=env.localStorage.getItem('fieldmaps-device-id');
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id||'')){id=env.crypto.randomUUID();env.localStorage.setItem('fieldmaps-device-id',id);}
  const ua=env.navigator.userAgent||'';
  const os=/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS / iPadOS':/Windows/.test(ua)?'Windows':/Macintosh/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'Unknown';
  const {error}=await db.rpc('report_map_device',{p_workspace:workspace,p_device:id,p_details:{client:'web',model:'Web browser',os,user_agent:ua,app_version:'web-2026-10-29'},p_release:release,p_mode:'viewed'});
  return !error;
 }catch{return false;}// Reporting must never prevent a map from opening.
}
