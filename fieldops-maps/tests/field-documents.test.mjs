import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../supabase/migrations',import.meta.url));const db=new PGlite();
await db.exec(`
create role anon;create role authenticated;
create schema auth;create schema maps_private;create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table auth.users(id uuid primary key,email text default 'fixture@example.invalid');
create table public.maps(id uuid primary key,workspace_id uuid,owner_id uuid,supporting_files jsonb default '[]',draft_revision int default 1);
create table public.workspace_members(workspace_id uuid,user_id uuid,role text,status text,display_name text default '');
create table public.project_members(map_id uuid,user_id uuid);
create table public.layers(map_id uuid,raster_path text,original_paths jsonb);
create table public.map_releases(map_id uuid,raster_paths text[]);
create table maps_private.file_accounts(path text primary key,workspace_id uuid,user_id uuid);
create table maps_private.map_uploads(path text,map_id uuid,primary key(path,map_id));
create table maps_private.map_deletions(map_id uuid,paths text[]);
create table storage.objects(bucket_id text,name text primary key,metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema auth,maps_private,storage to authenticated;
grant select,insert,update,delete on storage.objects to authenticated;
create function maps_private.ws_role(w uuid) returns text language sql stable security definer as $$select role from public.workspace_members where workspace_id=w and user_id=auth.uid() and status='active'$$;
create function maps_private.ws_manage(w uuid) returns boolean language sql stable as $$select coalesce(maps_private.ws_role(w) in ('owner','admin'),false)$$;
create function maps_private.ws_project(p uuid,published boolean default false) returns boolean language sql stable security definer as $$select coalesce((select maps_private.ws_manage(workspace_id) or (maps_private.ws_role(workspace_id)='editor' and owner_id=auth.uid()) or (published and maps_private.ws_role(workspace_id)='operator') from public.maps where id=p),false)$$;
create function maps_private.ws_file_before_meter(path text,writing boolean default false) returns boolean language sql stable security definer as $$select split_part(path,'/',1)=auth.uid()::text and exists(select 1 from public.workspace_members where user_id=auth.uid() and role in ('owner','admin','editor') and status='active')$$;
create function maps_private.ws_file(path text,writing boolean default false) returns boolean language sql stable security definer as $$select maps_private.ws_file_before_meter(path,writing)$$;
create function maps_private.ws_path_allowed(path text,w uuid) returns boolean language sql stable security definer as $$select maps_private.ws_file(path)$$;
create function maps_private.register_file_upload(p_map uuid,p_path text) returns void language plpgsql security definer as $$begin if not maps_private.ws_project(p_map) then raise exception 'denied';end if; insert into maps_private.file_accounts select p_path,workspace_id,auth.uid() from public.maps where id=p_map on conflict do nothing;insert into maps_private.map_uploads values(p_path,p_map) on conflict do nothing;end$$;
create function public.register_file_upload(p_map uuid,p_path text) returns void language sql security invoker as $$select maps_private.register_file_upload(p_map,p_path)$$;
create policy gis_file_read on storage.objects for select to authenticated using(maps_private.ws_file(name));
create policy gis_file_insert on storage.objects for insert to authenticated with check(maps_private.ws_file(name,true));
create policy gis_file_update on storage.objects for update to authenticated using(maps_private.ws_file(name,true));
create policy gis_file_delete on storage.objects for delete to authenticated using(maps_private.ws_file(name,true));
`);
await db.exec(readFileSync(root+'/20261114024645_supporting_document_signatures.sql','utf8'));
await db.exec(readFileSync(root+'/20261114034000_document_current_version.sql','utf8'));
const support=readFileSync(root+'/20261104202615_project_supporting_files.sql','utf8');
await db.exec(support.slice(support.indexOf('create function maps_private.validate_supporting_files'),support.indexOf('create function public.maps_supporting_file')));
await db.exec(readFileSync(root+'/'+readdirSync(root).find(x=>x.endsWith('_native_document_signing.sql')),'utf8'));
await db.exec(readFileSync(root+'/'+readdirSync(root).find(x=>x.endsWith('_signing_assignment_recheck.sql')),'utf8'));
await db.exec(readFileSync(root+'/'+readdirSync(root).find(x=>x.endsWith('_operator_work_photos.sql')),'utf8'));

const admin='00000000-0000-0000-0000-000000000001',operator='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003',map='10000000-0000-0000-0000-000000000001',workspace='20000000-0000-0000-0000-000000000001';
const template=admin+'/'+map+'/supporting/template.pdf';
await db.exec(`insert into auth.users(id) values('${admin}'),('${operator}'),('${other}');insert into public.workspace_members(workspace_id,user_id,role,status) values('${workspace}','${admin}','owner','active'),('${workspace}','${operator}','operator','active'),('20000000-0000-0000-0000-000000000002','${other}','operator','active');insert into public.maps(id,workspace_id,owner_id) values('${map}','${workspace}','${admin}');insert into public.project_members values('${map}','${operator}');select set_config('test.uid','${admin}',false);insert into storage.objects values('gis-files','${template}','{"size":123}');update public.maps set supporting_files='[{"name":"Inspection.pdf","path":"${template}","size":123,"type":"application/pdf"}]' where id='${map}';`);
async function as(user){await db.exec(`reset role;select set_config('test.uid','${user}',false);set role authenticated;`);}
async function denied(sql){await assert.rejects(db.exec(sql));}
await as(admin);await db.exec(`select maps_set_form_template('${map}','${template}',true)`);
await as(operator);await denied(`select maps_set_form_template('${map}','${template}',false)`);
assert.equal((await db.query(`select maps_current_documents('${map}') as x`)).rows[0].x.can_submit_field_documents,true);
const outputs=[];
async function submit(kind,id,details){
 const path=operator+'/'+map+'/supporting/'+id+(kind==='photo'?'/photo.jpg':'/form.pdf');
 await db.exec(`select register_file_upload('${map}','${path}');insert into storage.objects values('gis-files','${path}','{"size":456}')`);
 const file={name:kind==='photo'?'Work photo.jpg':'Inspection completed.pdf',path,size:456,type:kind==='photo'?'image/jpeg':'application/pdf'};
 const sql=`select maps_submit_field_document('${kind}','${map}','${id}','${JSON.stringify(file)}','${JSON.stringify(details)}') as x`;
 const first=(await db.query(sql)).rows[0].x,second=(await db.query(sql)).rows[0].x;
 assert.equal(first.receipt.id,second.receipt.id);outputs.push({sql,path});return first;
}
const photo={output_sha256:'a'.repeat(64),datum:'WGS84',captured_at:'2026-11-15T10:11:12Z',width:1920,height:1440,latitude:-27.4,longitude:153.1,azimuth:42,azimuth_reference:'true'};
const first=await submit('photo','30000000-0000-0000-0000-000000000001',photo);assert.equal(first.files.length,2);assert.equal(first.files[1].group,'Work-area photos');
const details={output_sha256:'b'.repeat(64),source_sha256:'c'.repeat(64),template_sha256:'d'.repeat(64),template_path:template,method:'typed',certificate_fingerprint:null};
const second=await submit('form','30000000-0000-0000-0000-000000000002',details);assert.equal(second.files.length,3);assert.equal(second.files[0].path,template);assert.equal(second.files[0].form_template,true);assert.equal(second.files[2].group,'Completed forms');assert.equal(second.files[2].form_template,false);
const third=await submit('form','30000000-0000-0000-0000-000000000003',details);assert.equal(third.files.length,4);assert.equal(third.files.filter(f=>f.path===template).length,1);
await denied(outputs[0].sql.replace('"azimuth":42','"azimuth":43'));
assert.equal((await db.query(`update storage.objects set metadata='{"size":1}' where name='${outputs[0].path}' returning name`)).rows.length,0);
await denied(`select register_file_upload('${map}','${operator}/${map}/supporting/invalid/photo.jpg')`);
await as(admin);await db.exec(`select maps_set_form_template('${map}','${template}',false)`);
await as(operator);
await assert.rejects(submit('form','30000000-0000-0000-0000-000000000004',details),/template has changed/);
// Retrying a previously committed submission remains valid even if its template is later retired.
assert.equal((await db.query(outputs[1].sql)).rows[0].x.receipt.output_sha256,details.output_sha256);
await db.exec('reset role');await db.exec(`delete from public.project_members where user_id='${operator}'`);
await as(operator);await denied(outputs[0].sql);
await as(other);await denied(outputs[1].sql);await denied(`select maps_current_documents('${map}')`);
await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from maps_private.field_document_submissions')).rows[0].n,3);
console.log('PASS work-photo and completed-form upload permissions, immutable files, retries, separate submissions, preserved template, retired template and revoked assignments');
await db.close();
