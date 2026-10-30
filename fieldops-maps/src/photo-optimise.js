// Preserve documents and non-photo imagery. JPEG photos are resized before upload.
export async function optimisePhoto(file,{maxSide=2048,quality=.82}={}){
 if(!/^image\/jpeg$/i.test(file.type)||typeof createImageBitmap!=='function')return {file};
 const bitmap=await createImageBitmap(file);
 try{async function render(side,q){const scale=Math.min(1,side/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',q));if(!blob)throw Error('Photo optimisation failed');return blob;}
  const image=await render(maxSide,quality),thumb=await render(256,.7);
  return {file:image.size<file.size?new File([image],file.name,{type:'image/jpeg'}):file,thumbnail:new File([thumb],'thumbnail.jpg',{type:'image/jpeg'}),originalBytes:file.size};
 }finally{bitmap.close();}
}
