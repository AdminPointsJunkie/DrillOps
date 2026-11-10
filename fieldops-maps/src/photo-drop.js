const photoName=/\.(jpe?g|png|webp|heic|heif)$/i;
const photoType=/^image\/(jpeg|png|webp|heic|heif)$/i;

export function isPhotoFile(file){return photoName.test(file.name||'')||photoType.test(file.type||'');}

// Images with georeferencing sidecars remain GIS rasters, together with their sidecars.
export function splitPhotoFiles(files){
 const all=Array.from(files),names=new Set(all.map(file=>file.name.toLowerCase()));
 const photos=[],other=[];
 for(const file of all){
  const name=file.name.toLowerCase(),stem=name.replace(/\.[^.]+$/,''),ext=name.split('.').at(-1);
  const sidecars=[stem+'.wld',name+'.wld',name+'.aux.xml',stem+'.'+ext+'w',stem+'.'+ext[0]+ext.at(-1)+'w'];
  (isPhotoFile(file)&&!sidecars.some(name=>names.has(name))?photos:other).push(file);
 }
 return {photos,other};
}

export async function routeMapFiles(files,{getScope,importPhotos,importLayers},dropLocation=null){
 const {photos,other}=splitPhotoFiles(files),scope=getScope();
 if(photos.length&&(!await importPhotos(photos)||scope!==getScope()))return;
 if(other.length)await importLayers(other,dropLocation);
}

export async function readPhotoLocation(file){
 try{
  const module=await import('exifr'),gps=module.gps||module.default.gps;
  const result=await gps(await file.arrayBuffer());
  if(Number.isFinite(result?.latitude)&&Number.isFinite(result?.longitude)&&Math.abs(result.latitude)<=90&&Math.abs(result.longitude)<=180){
   return {lat:result.latitude,lng:result.longitude};
  }
 }catch{}
 return null;
}

export async function downscaleLocalPhoto(file){
 if(file.size>50*1024*1024)throw Error(`${file.name} exceeds 50 MB.`);
 if(!isPhotoFile(file))throw Error('Choose JPEG, PNG, WebP or HEIC photos.');
 let bitmap;
 try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}
 catch(error){
  if(!/\.(heic|heif)$/i.test(file.name||'')&&!/^image\/hei[cf]$/i.test(file.type||''))throw error;
  const {heicTo}=await import('heic-to/csp');
  bitmap=await createImageBitmap(await heicTo({blob:file,type:'image/jpeg',quality:.9}));
 }
 try{
  if(bitmap.width*bitmap.height>80000000)throw Error('Resize photos larger than 80 megapixels before importing.');
  const render=async(side,quality)=>{
   const ratio=Math.min(1,side/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
   const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
   if(!blob)throw Error('Photo could not be resized.');return blob;
  };
  return {id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,'')+'.jpg',blob:await render(2048,.85),thumbnail:await render(256,.75)};
 }finally{bitmap.close();}
}

export async function importPhotoBatch(files,{scope,isCurrent,storage,readLocation=readPhotoLocation,resize=downscaleLocalPhoto,progress=()=>{}}){
 if(!scope)throw Error('Sign in and choose a project first.');
 if(files.length>100||files.reduce((n,file)=>n+file.size,0)>300*1024*1024)throw Error('Drop up to 100 photos and 300 MB at a time.');
 const result={saved:[],unlocated:[],errors:[],cancelled:false};
 for(const [index,file] of files.entries()){
  if(!isCurrent()){result.cancelled=true;break;}
  progress(index+1,files.length);
  try{
   if(file.size>50*1024*1024)throw Error('Photo exceeds 50 MB.');
   // Read the original, because drawing to canvas removes EXIF metadata.
   const location=await readLocation(file);
   if(!isCurrent()){result.cancelled=true;break;}
   const photo=await resize(file);
   if(!isCurrent()){result.cancelled=true;break;}
   const pin={id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,'')||'Photo',note:'',source:'photo',photos:[photo]};
   if(!location){result.unlocated.push(pin);continue;}
   Object.assign(pin,location,{locationSource:'metadata'});
   await storage.save(scope,pin);result.saved.push(pin);
  }catch(error){result.errors.push({name:file.name,message:error.message||'Photo could not be imported.'});}
 }
 return result;
}
