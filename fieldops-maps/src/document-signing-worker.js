import {createSigningIdentity,signDocument} from './document-signing-core.js';
self.onmessage=async({data})=>{
 try{const result=await (data.action==='identity'?createSigningIdentity(data.payload):signDocument(data.payload));self.postMessage({result});}
 catch(error){self.postMessage({error:error.message||'Could not sign this document.'});}
};
