-- One current attachment, with immutable previous versions in private history.
alter table maps_private.document_signatures add column document_id uuid,add column original_entry jsonb;
create index document_signatures_document_history on maps_private.document_signatures(map_id,document_id,signed_at desc);
create or replace function maps_private.record_document_signature(p_map uuid,p_operation uuid,p_source text,p_file jsonb,p_signature jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.maps; original jsonb; entry jsonb; receipt maps_private.document_signatures; bytes bigint; doc_id uuid; begin
 if auth.uid() is null or not maps_private.ws_project(p_map) then raise exception 'Map editing access required' using errcode='42501';end if;
 select * into m from public.maps where id=p_map for update;
 if not found then raise exception 'Map unavailable';end if;
 select * into receipt from maps_private.document_signatures where map_id=p_map and operation_id=p_operation;
 if found then
  if receipt.signer_id is distinct from auth.uid() or receipt.source_path is distinct from p_source or receipt.output_path is distinct from p_file->>'path' or receipt.output_sha256 is distinct from p_signature->>'output_sha256' or receipt.source_sha256 is distinct from p_signature->>'source_sha256' or receipt.method is distinct from p_signature->>'method' or receipt.certificate_fingerprint is distinct from p_signature->>'certificate_fingerprint' then raise exception 'Signing operation does not match';end if;
  return jsonb_build_object('files',m.supporting_files,'receipt',to_jsonb(receipt));
 end if;
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

create function public.maps_document_history(p_map uuid,p_document uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not maps_private.ws_project(p_map) then raise exception 'Map editing access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('file',original_entry,'replaced_at',signed_at) order by signed_at desc) from maps_private.document_signatures where map_id=p_map and document_id=p_document),'[]'::jsonb);
end $$;
revoke all on function public.maps_document_history(uuid,uuid) from public,anon;
grant execute on function public.maps_document_history(uuid,uuid) to authenticated;

create or replace function maps_private.ws_file(path text,writing boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare w uuid;role text;begin
 if auth.uid() is null then return false;end if;
 select workspace_id into w from maps_private.file_accounts where file_accounts.path=ws_file.path;
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
