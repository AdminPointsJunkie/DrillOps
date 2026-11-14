import {signDocument,createSigningIdentity} from '../src/document-signing-core.js';
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const encode=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
globalThis.FieldMapsSigning={
 async sign(input){
  try { const result=await signDocument({...input,source:decode(input.source),png:input.png?decode(input.png):undefined,p12:input.p12?decode(input.p12):undefined});return {...result,output:encode(result.output)}; }
  catch(error){return {error:error.message};}
 },
 async identity(input){try {const result=await createSigningIdentity(input);return {p12:encode(result.p12),fingerprint:result.fingerprint};}catch(error){return {error:error.message};}}
};
