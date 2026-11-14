import {registerUpload} from './upload-meter.js';
export function signedDocumentName(name){return name;}
export async function saveSignedDocument({db,project,file,userId,result,method,operationId,guard=()=>true}){
 if(!guard())throw Error('Map or account access changed. Reopen the document.');
 const name=signedDocumentName(file.name),path=`${userId}/${project.id}/supporting/${operationId}/signed.pdf`,bucket=db.storage.from('gis-files');
 await registerUpload(db,project.id,path);
 const blob=new Blob([result.output],{type:'application/pdf'});
 if(blob.size>50*1024*1024)throw Error('The signed PDF exceeds the 50 MB limit.');
 const uploaded=await bucket.upload(path,blob,{contentType:'application/pdf',upsert:false});
 // A lost response may leave the immutable file uploaded. Verify it before retrying registration.
 // Attached files are immutable: Storage may return 403 rather than 409 on a retry.
 // Reuse only an accessible object whose bytes match this exact signing operation.
 const verified=await bucket.download(path);if(verified.error)throw uploaded.error||verified.error;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await verified.data.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
 if(hash!==result.outputHash)throw Error('The saved PDF could not be verified. The original document is unchanged.');
 if(!guard())throw Error('Map or account access changed. The original document is unchanged.');
 const response=await db.rpc('maps_record_document_signature',{p_map:project.id,p_operation:operationId,p_source:file.path,p_file:{name,path,size:blob.size,type:'application/pdf'},p_signature:{method,source_sha256:result.sourceHash,output_sha256:result.outputHash,certificate_fingerprint:result.certificateFingerprint}});
 if(response.error)throw response.error;
 if(guard())project.supporting_files=response.data.files;
 return response.data;
}
