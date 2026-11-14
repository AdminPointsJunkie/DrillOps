// HTTP content encoding preserves the complete original, including PDF signatures.
// Never re-encode document pages, pictures or Office archive contents.
export async function prepareSupportingUpload(file){
 const original={body:file,size:file.size};
 if(file.size<32768||!globalThis.CompressionStream||!globalThis.crypto?.subtle||!file.stream)return original;
 try{
  const compressed=await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  if(compressed.size>file.size*.95||file.size-compressed.size<1024)return original;
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  const body=new FormData();body.append('cacheControl','3600');body.append('contentEncoding','gzip');
  body.append('',new Blob([compressed],{type:file.type||'application/octet-stream'}),file.name);
  return {body,size:compressed.size,encoding:'gzip',originalSize:file.size,digest};
 }catch{return original;}
}

export async function verifySupportingUpload(bucket,path,prepared){
 if(!prepared.encoding)return;
 const {data,error}=await bucket.download(path);if(error)throw error;
 if(data.size!==prepared.originalSize)throw Error('The compressed file could not be verified. Please retry the upload.');
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',await data.arrayBuffer()));
 if(!digest.every((byte,i)=>byte===new Uint8Array(prepared.digest)[i]))throw Error('The uploaded file did not match the original. Please retry the upload.');
}
