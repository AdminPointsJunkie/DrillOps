-- Signing permission does not grant map, layer or release editing access.
create table maps_private.document_signers (
 map_id uuid not null references public.maps(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 granted_by uuid not null, granted_at timestamptz not null default now(),
 primary key(map_id,user_id)
);
alter table maps_private.document_signers enable row level security;
revoke all on maps_private.document_signers from public,anon,authenticated;

create function maps_private.can_sign_document(p_map uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and maps_private.ws_project(p_map,true)
 and (maps_private.ws_project(p_map) or exists(select 1 from maps_private.document_signers where map_id=p_map and user_id=auth.uid()))
 and not exists(select 1 from maps_private.map_deletions where map_id=p_map);
$$;
revoke all on function maps_private.can_sign_document(uuid) from public,anon;
grant execute on function maps_private.can_sign_document(uuid) to authenticated;

create function maps_private.set_document_signer(p_map uuid,p_user uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 select workspace_id into w from public.maps where id=p_map for update;
 if auth.uid() is null or not coalesce(maps_private.ws_manage(w),false) then raise exception 'Project administrator access required' using errcode='42501';end if;
 if p_enabled then
  if not exists(select 1 from public.workspace_members m join public.project_members p on p.user_id=m.user_id where p.map_id=p_map and m.workspace_id=w and m.user_id=p_user and m.status='active') then raise exception 'Choose an active assigned project member';end if;
  insert into maps_private.document_signers(map_id,user_id,granted_by) values(p_map,p_user,auth.uid()) on conflict do nothing;
 else delete from maps_private.document_signers where map_id=p_map and user_id=p_user;end if;
end $$;
create function public.maps_set_document_signer(p_map uuid,p_user uuid,p_enabled boolean) returns void language sql security invoker set search_path='' as $$select maps_private.set_document_signer(p_map,p_user,p_enabled);$$;
revoke all on function maps_private.set_document_signer(uuid,uuid,boolean),public.maps_set_document_signer(uuid,uuid,boolean) from public,anon;
grant execute on function maps_private.set_document_signer(uuid,uuid,boolean),public.maps_set_document_signer(uuid,uuid,boolean) to authenticated;

create function maps_private.current_documents(p_map uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not maps_private.ws_project(p_map,true) or exists(select 1 from maps_private.map_deletions where map_id=p_map) then raise exception 'Project access required' using errcode='42501';end if;
 return (select jsonb_build_object('files',supporting_files,'can_sign',maps_private.can_sign_document(p_map)) from public.maps where id=p_map);
end $$;
create function public.maps_current_documents(p_map uuid) returns jsonb language sql security invoker set search_path='' as $$select maps_private.current_documents(p_map);$$;
revoke all on function maps_private.current_documents(uuid),public.maps_current_documents(uuid) from public,anon;
grant execute on function maps_private.current_documents(uuid),public.maps_current_documents(uuid) to authenticated;

-- Only registered, per-operation signed PDFs are writable by an authorised signer.
create function maps_private.signing_upload_allowed(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from maps_private.map_uploads u join maps_private.file_accounts a on a.path=u.path
 join public.maps m on m.id=u.map_id and m.workspace_id=a.workspace_id
 where u.path=p_path and a.user_id=auth.uid() and maps_private.can_sign_document(u.map_id)
 and p_path ~ ('^'||auth.uid()::text||'/'||u.map_id::text||'/supporting/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/signed[.]pdf$'));
$$;
revoke all on function maps_private.signing_upload_allowed(text) from public,anon;
grant execute on function maps_private.signing_upload_allowed(text) to authenticated;
create policy gis_document_signing_insert on storage.objects for insert to authenticated
 with check(bucket_id='gis-files' and maps_private.signing_upload_allowed(name));

-- Keep the existing editing path and add a narrowly scoped signing registration path.
alter function maps_private.register_file_upload(uuid,text) rename to register_file_upload_before_signing;
create function maps_private.register_file_upload(p_map uuid,p_path text) returns void
language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if maps_private.ws_project(p_map) then perform maps_private.register_file_upload_before_signing(p_map,p_path);return;end if;
 perform 1 from public.maps where id=p_map for update;
 if not maps_private.can_sign_document(p_map) or p_path !~ ('^'||auth.uid()::text||'/'||p_map::text||'/supporting/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/signed[.]pdf$') or p_path is null then raise exception 'Document signing access required' using errcode='42501';end if;
 select workspace_id into w from public.maps where id=p_map;
 insert into maps_private.file_accounts values(p_path,w,auth.uid()) on conflict do nothing;
 if not exists(select 1 from maps_private.file_accounts where path=p_path and workspace_id=w and user_id=auth.uid()) then raise exception 'File belongs to a different account' using errcode='42501';end if;
 insert into maps_private.map_uploads values(p_path,p_map) on conflict do nothing;
end $$;
revoke all on function maps_private.register_file_upload(uuid,text),maps_private.register_file_upload_before_signing(uuid,text) from public,anon,authenticated;
grant execute on function maps_private.register_file_upload(uuid,text) to authenticated;
-- Recreate the wrapper because SQL functions may retain the renamed function's OID.
create or replace function public.register_file_upload(p_map uuid,p_path text) returns void language sql security invoker set search_path='' as $$select maps_private.register_file_upload(p_map,p_path);$$;

-- Read current documents independently of releases; retain existing history/edit rules.
alter function maps_private.ws_file(text,boolean) rename to ws_file_before_signing;
create or replace function maps_private.ws_file_before_signing(path text,writing boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare w uuid;role text;begin
 if auth.uid() is null then return false;end if;
 select workspace_id into w from maps_private.file_accounts where file_accounts.path=ws_file_before_signing.path;
 if w is not null then
  role:=maps_private.ws_role(w);
  if role is null or (writing and role not in ('owner','admin','editor')) then return false;end if;
 end if;
 if exists(select 1 from maps_private.document_signatures s where s.source_path=path or s.output_path=path) then
  if writing then return false;end if;
  if exists(select 1 from maps_private.document_signatures s where (s.source_path=path or s.output_path=path) and maps_private.ws_project(s.map_id)) then return true;end if;
 end if;
 if exists(select 1 from public.maps m where m.supporting_files @> jsonb_build_array(jsonb_build_object('path',path))) then
  if writing then return false;end if;
  if exists(select 1 from public.maps m where m.supporting_files @> jsonb_build_array(jsonb_build_object('path',path)) and maps_private.ws_project(m.id)) then return true;end if;
 end if;
 return maps_private.ws_file_before_meter(path,writing);
end $$;

create function maps_private.ws_file(path text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return false;end if;
 if not writing then
  if maps_private.signing_upload_allowed(path) then return true;end if;
  if exists(select 1 from public.maps m where m.supporting_files @> jsonb_build_array(jsonb_build_object('path',path)) and maps_private.ws_project(m.id,true) and not exists(select 1 from maps_private.map_deletions d where d.map_id=m.id)) then return true;end if;
 end if;
 return maps_private.ws_file_before_signing(path,writing);
end $$;
revoke all on function maps_private.ws_file(text,boolean),maps_private.ws_file_before_signing(text,boolean) from public,anon,authenticated;
grant execute on function maps_private.ws_file(text,boolean) to authenticated;
alter policy gis_file_read on storage.objects using(bucket_id='gis-files' and maps_private.ws_file(name));
alter policy gis_file_insert on storage.objects with check(bucket_id='gis-files' and split_part(name,'/',1)=auth.uid()::text and maps_private.ws_file(name,true));
alter policy gis_file_update on storage.objects using(bucket_id='gis-files' and maps_private.ws_file(name,true)) with check(bucket_id='gis-files' and maps_private.ws_file(name,true));
alter policy gis_file_delete on storage.objects using(bucket_id='gis-files' and maps_private.ws_file(name,true));
create or replace function maps_private.ws_path_allowed(path text,w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and maps_private.ws_file(path)
 and not exists(select 1 from maps_private.map_deletions d where path=any(d.paths))
 and not exists(select 1 from maps_private.file_accounts a where a.path=ws_path_allowed.path and a.workspace_id<>w)
 and not exists(select 1 from public.layers l join public.maps m on m.id=l.map_id where (l.raster_path=path or l.original_paths ? path) and m.workspace_id<>w)
 and not exists(select 1 from public.map_releases r join public.maps m on m.id=r.map_id where r.raster_paths @> array[path] and m.workspace_id<>w);
$$;

create or replace function maps_private.record_document_signature(p_map uuid,p_operation uuid,p_source text,p_file jsonb,p_signature jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.maps; original jsonb; entry jsonb; receipt maps_private.document_signatures; bytes bigint; doc_id uuid; begin
 if auth.uid() is null or not maps_private.can_sign_document(p_map) then raise exception 'Document signing access required' using errcode='42501';end if;
 select * into m from public.maps where id=p_map for update;
 if not maps_private.can_sign_document(p_map) then raise exception 'Document signing access required' using errcode='42501';end if;
 if not found then raise exception 'Map unavailable';end if;
 select * into receipt from maps_private.document_signatures where map_id=p_map and operation_id=p_operation;
 if found then
  if receipt.signer_id is distinct from auth.uid() or receipt.source_path is distinct from p_source or receipt.output_path is distinct from p_file->>'path' or receipt.output_sha256 is distinct from p_signature->>'output_sha256' or receipt.source_sha256 is distinct from p_signature->>'source_sha256' or receipt.method is distinct from p_signature->>'method' or receipt.certificate_fingerprint is distinct from p_signature->>'certificate_fingerprint' then raise exception 'Signing operation does not match';end if;
  return jsonb_build_object('files',m.supporting_files,'receipt',to_jsonb(receipt));
 end if;
 if p_file->>'path' is distinct from auth.uid()::text||'/'||p_map::text||'/supporting/'||p_operation::text||'/signed.pdf' or not maps_private.signing_upload_allowed(p_file->>'path') then raise exception 'Register this signing operation before saving';end if;
 select f into original from jsonb_array_elements(m.supporting_files) f where f->>'path'=p_source;
 if original is null or original->>'name' !~* '\.pdf$' then raise exception 'The original PDF is no longer attached to this map';end if;
 if p_operation is null or coalesce(p_signature->>'method','') not in ('typed','drawn','certificate') or coalesce(p_signature->>'source_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_signature->>'output_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid signature record';end if;
 if p_signature->>'method'='certificate' and coalesce(p_signature->>'certificate_fingerprint','') !~ '^[a-f0-9]{64}$' then raise exception 'Certificate fingerprint required';end if;
 if coalesce(p_file->>'name','') !~* '\.pdf$' or length(p_file->>'name')>240 or p_file->>'name' ~ '[/\\]' or p_file->>'type' is distinct from 'application/pdf' or split_part(p_file->>'path','/',1) is distinct from auth.uid()::text or split_part(p_file->>'path','/',2) is distinct from p_map::text or split_part(p_file->>'path','/',3) is distinct from 'supporting' or coalesce(p_file->>'path','')=p_source then raise exception 'Upload a new signed PDF to this map';end if;
 select (metadata->>'size')::bigint into bytes from storage.objects where bucket_id='gis-files' and name=p_file->>'path';
 if bytes is null or bytes<1 or bytes>52428800 or bytes is distinct from (p_file->>'size')::bigint then raise exception 'Signed PDF upload is incomplete';end if;
 if exists(select 1 from jsonb_array_elements(m.supporting_files) f where f->>'path'=p_file->>'path') then raise exception 'This PDF is already attached';end if;
 doc_id:=coalesce((original->>'document_id')::uuid,gen_random_uuid());
 insert into maps_private.document_signatures(map_id,operation_id,signer_id,source_path,output_path,method,source_sha256,output_sha256,certificate_fingerprint,document_id,original_entry)
 values(p_map,p_operation,auth.uid(),p_source,p_file->>'path',p_signature->>'method',p_signature->>'source_sha256',p_signature->>'output_sha256',p_signature->>'certificate_fingerprint',doc_id,original) returning * into receipt;
 entry=jsonb_build_object('document_id',doc_id,'version',coalesce((original->>'version')::integer,1)+1,'name',original->>'name','path',p_file->>'path','size',bytes,'type','application/pdf','uploaded_at',receipt.signed_at,'group',coalesce(original->>'group',''),'signature',jsonb_build_object('id',receipt.id,'method',receipt.method,'signer_id',receipt.signer_id,'signed_at',receipt.signed_at,'source_name',original->>'name','source_sha256',receipt.source_sha256,'output_sha256',receipt.output_sha256,'certificate_fingerprint',receipt.certificate_fingerprint));
 update public.maps set supporting_files=(select jsonb_agg(case when value->>'path'=p_source then entry else value end order by ordinal) from jsonb_array_elements(supporting_files) with ordinality as files(value,ordinal)) where id=p_map returning supporting_files into m.supporting_files;
 return jsonb_build_object('files',m.supporting_files,'receipt',to_jsonb(receipt));
end $$;


create function maps_private.get_document_signers(p_map uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare w uuid;begin
 select workspace_id into w from public.maps where id=p_map;
 if auth.uid() is null or not coalesce(maps_private.ws_manage(w),false) then raise exception 'Project administrator access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(nullif(m.display_name,''),u.email),'enabled',exists(select 1 from maps_private.document_signers s where s.map_id=p_map and s.user_id=m.user_id)) order by m.display_name,u.email)
 from public.workspace_members m join auth.users u on u.id=m.user_id join public.project_members p on p.user_id=m.user_id and p.map_id=p_map
 where m.workspace_id=w and m.status='active' and m.role='operator'),'[]'::jsonb);
end $$;
create function public.maps_document_signers(p_map uuid) returns jsonb language sql security invoker set search_path='' as $$select maps_private.get_document_signers(p_map);$$;
revoke all on function maps_private.get_document_signers(uuid),public.maps_document_signers(uuid) from public,anon;
grant execute on function maps_private.get_document_signers(uuid),public.maps_document_signers(uuid) to authenticated;
