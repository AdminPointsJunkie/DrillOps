import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {extractSignature} from '@signpdf/utils';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {createSigningIdentity,signDocument,digest} from '../src/document-signing-core.js';
import {saveSignedDocument} from '../src/document-signing-save.js';
const password='test-only-password-2026',name='Test Signer',email='test@example.invalid';
const document=await PDFDocument.create();document.addPage([595,842]);const source=await document.save();
const input={source,name,email,pageIndex:0,x:40,y:140,text:name};
let identity;
test('free identity signs a PDF and independent CMS verification detects tampering',async()=>{
 identity=await createSigningIdentity({name,email,password});assert.equal(identity.fingerprint.length,64);
 const result=await signDocument({...input,method:'certificate',p12:identity.p12,password});assert.equal(result.certificateFingerprint,identity.fingerprint);assert.equal(result.certificateSubject,name);assert.equal(result.sourceHash,await digest(source));
 const {signature,signedData,ByteRange}=extractSignature(Buffer.from(result.output));assert.equal(ByteRange[2]+ByteRange[3],result.output.length);
 const folder=await mkdtemp(join(tmpdir(),'fieldmaps-sign-'));
 try{
  await writeFile(join(folder,'signature.der'),Buffer.from(signature,'binary'));await writeFile(join(folder,'content.bin'),signedData);
  const openssl=process.env.OPENSSL_BIN||(existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
  const args=['cms','-verify','-binary','-noverify','-inform','DER','-in',join(folder,'signature.der'),'-content',join(folder,'content.bin'),'-out',join(folder,'verified.bin')];
  const verified=spawnSync(openssl,args,{encoding:'utf8'});assert.equal(verified.status,0,verified.stderr||String(verified.error));
  signedData[15]^=1;await writeFile(join(folder,'content.bin'),signedData);assert.notEqual(spawnSync(openssl,args,{encoding:'utf8'}).status,0);
 }finally{await rm(folder,{recursive:true,force:true});}
 await assert.rejects(signDocument({...input,source:result.output,method:'typed'}),/already contains a certificate signature/);
});
test('typed and drawn signatures preserve source bytes and produce readable PDF copies',async()=>{
 const before=await digest(source),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 for(const method of ['typed','drawn']){const result=await signDocument({...input,method,png});assert.equal((await PDFDocument.load(result.output)).getPageCount(),1);assert.notEqual(result.outputHash,before);}
 assert.equal(await digest(source),before);
});
test('invalid passwords, expired certificates, blank signatures and bad placement are rejected',async()=>{
 identity??=await createSigningIdentity({name,email,password});
 await assert.rejects(createSigningIdentity({name,email,password:'short'}),/at least 12/);
 await assert.rejects(signDocument({...input,method:'certificate',p12:identity.p12,password:'wrong'}),/password could not be read/);
 await assert.rejects(signDocument({...input,method:'certificate',p12:identity.p12,password,now:'2040-01-01T00:00:00Z'}),/not currently valid/);
 await assert.rejects(signDocument({...input,method:'typed',text:''}),/Enter your signature/);
 await assert.rejects(signDocument({...input,method:'drawn'}),/Draw your signature/);
 await assert.rejects(signDocument({...input,method:'typed',x:NaN}),/valid signature position/);
});
test('save retries identical immutable bytes after a lost commit response without duplicating or deleting originals',async()=>{
 const result=await signDocument({...input,method:'typed'}),file={name:'Plan.pdf',path:'user/map/supporting/original/plan.pdf'},project={id:'map',supporting_files:[file]},stored=new Map();let commits=0;const registrations=[];
 const db={storage:{from:()=>({upload:async(path,blob)=>{if(stored.has(path))return{error:{statusCode:403}};stored.set(path,blob);return{};},download:async path=>({data:stored.get(path)}),remove:()=>assert.fail('Original must not be deleted')})},rpc:async(name,args)=>{if(name==='register_file_upload')return{};registrations.push(args);if(!commits++){return{error:Error('Response lost')};}return{data:{files:[{...args.p_file,name:file.name,version:2}]}};}};
 const args={db,project,file,userId:'user',result,method:'typed',operationId:'operation'};
 await assert.rejects(saveSignedDocument(args),/Response lost/);await saveSignedDocument(args);assert.equal(stored.size,1);assert.deepEqual(registrations[0],registrations[1]);assert.equal(project.supporting_files.length,1);assert.equal(project.supporting_files[0].name,file.name);assert.notEqual(project.supporting_files[0].path,file.path);assert.equal(project.supporting_files[0].version,2);
});
test('save rejects altered stored bytes and revoked access before recording a signature',async()=>{
 const result=await signDocument({...input,method:'typed'});let records=0;
 const db={storage:{from:()=>({upload:async()=>({}),download:async()=>({data:new Blob(['wrong bytes'])})})},rpc:async name=>{if(name!=='register_file_upload')records++;return{};}};
 const args={db,project:{id:'map'},file:{name:'Plan.pdf',path:'source'},userId:'user',result,method:'typed',operationId:'operation'};
 await assert.rejects(saveSignedDocument(args),/could not be verified/);await assert.rejects(saveSignedDocument({...args,guard:()=>false}),/access changed/);assert.equal(records,0);
});
