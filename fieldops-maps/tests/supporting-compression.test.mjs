import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {prepareSupportingUpload,verifySupportingUpload} from '../src/supporting-compression.js';
import {uploadSupportingFiles} from '../src/supporting-files.js';

test('lossless storage preserves every byte, including signature-like PDF content',async()=>{
 const file=new File(['%PDF-1.7\n/ByteRange [0 14 99 123] /Contents <0123>\n','original drawing data '.repeat(10000)],'Signed.pdf',{type:'application/pdf'});
 const prepared=await prepareSupportingUpload(file);assert.equal(prepared.encoding,'gzip');assert.ok(prepared.size<file.size*.95);
 assert.equal(prepared.body.get('contentEncoding'),'gzip');const stored=prepared.body.get('');assert.equal(stored.type,'application/pdf');
 const decoded=gunzipSync(new Uint8Array(await stored.arrayBuffer()));assert.deepEqual(new Uint8Array(decoded),new Uint8Array(await file.arrayBuffer()));
 await verifySupportingUpload({download:async()=>({data:new Blob([decoded])})},'path',prepared);
 await assert.rejects(verifySupportingUpload({download:async()=>({data:stored})},'path',prepared),/could not be verified/);
 decoded[100]^=1;await assert.rejects(verifySupportingUpload({download:async()=>({data:new Blob([decoded])})},'path',prepared),/did not match/);
});
test('already compressed or small files retain their original body',async()=>{
 for(const file of [new File(['small'],'notes.txt'),new File([randomBytes(200000)],'already-compressed.pdf')]){
  const p=await prepareSupportingUpload(file);assert.equal(p.body,file);assert.equal(p.size,file.size);assert.equal(p.encoding,undefined);
 }
});
test('uploads register verified compressed size and never attach a corrupted download',async()=>{
 const file=new File(['Signed original '.repeat(10000)],'Plan.pdf',{type:'application/pdf'});let stored,attached,removed=0,corrupt=false;
 const bucket={upload:async(_,body)=>{stored=body;return {};},download:async()=>({data:corrupt?new Blob(['corrupt']):file}),remove:async()=>{removed++;return {};}};
 const db={storage:{from:()=>bucket},rpc:async(name,args)=>{if(name==='register_file_upload')return {};attached=args.p_file;return {data:[attached]};}};
 const project={id:'map',supporting_files:[]};await uploadSupportingFiles({db,project,userId:'user',files:[file]});
 assert.equal(attached.size,stored.get('').size);assert.equal(attached.original_size,file.size);assert.equal(attached.content_encoding,'gzip');assert.equal(removed,0);
 attached=null;corrupt=true;await assert.rejects(uploadSupportingFiles({db,project,userId:'user',files:[file]}),/verified/);assert.equal(attached,null);assert.equal(removed,1);
});
