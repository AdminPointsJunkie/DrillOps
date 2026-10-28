// Bind storage paths to the authorised project before transmitting any bytes.
export async function registerUpload(db,mapId,path){
 const {error}=await db.rpc('register_file_upload',{p_map:mapId,p_path:path});
 if(error)throw error;
}
