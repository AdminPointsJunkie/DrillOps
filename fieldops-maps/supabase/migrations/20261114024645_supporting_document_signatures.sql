create table maps_private.document_signatures (
 id uuid primary key default gen_random_uuid(),
 map_id uuid not null references public.maps(id) on delete cascade,
 operation_id uuid not null,
 signer_id uuid not null,
 signed_at timestamptz not null default now(),
 source_path text not null,
 output_path text not null,
 method text not null check(method in ('typed','drawn','certificate')),
 source_sha256 text not null,
 output_sha256 text not null,
 certificate_fingerprint text,
 unique(map_id,operation_id),unique(output_path)
);
alter table maps_private.document_signatures enable row level security;
revoke all on maps_private.document_signatures from public,anon,authenticated;

-- The audit identity and receipt time come from the authenticated server session.
-- Hashes/fingerprint are client supplied, not an independent certificate validation.
create function maps_private.record_document_signature(p_map uuid,p_operation uuid,p_source text,p_file jsonb,p_signature jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.maps; original jsonb; entry jsonb; receipt maps_private.document_signatures; bytes bigint; begin
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
 insert into maps_private.document_signatures(map_id,operation_id,signer_id,source_path,output_path,method,source_sha256,output_sha256,certificate_fingerprint)
 values(p_map,p_operation,auth.uid(),p_source,p_file->>'path',p_signature->>'method',p_signature->>'source_sha256',p_signature->>'output_sha256',p_signature->>'certificate_fingerprint') returning * into receipt;
 entry=jsonb_build_object('name',p_file->>'name','path',p_file->>'path','size',bytes,'type','application/pdf','uploaded_at',receipt.signed_at,'group',coalesce(original->>'group',''),'signature',jsonb_build_object('id',receipt.id,'method',receipt.method,'signer_id',receipt.signer_id,'signed_at',receipt.signed_at,'source_name',original->>'name','source_sha256',receipt.source_sha256,'output_sha256',receipt.output_sha256,'certificate_fingerprint',receipt.certificate_fingerprint));
 update public.maps set supporting_files=supporting_files||jsonb_build_array(entry) where id=p_map returning supporting_files into m.supporting_files;
 return jsonb_build_object('files',m.supporting_files,'receipt',to_jsonb(receipt));
end $$;
revoke all on function maps_private.record_document_signature(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function maps_private.record_document_signature(uuid,uuid,text,jsonb,jsonb) to authenticated;
create function public.maps_record_document_signature(p_map uuid,p_operation uuid,p_source text,p_file jsonb,p_signature jsonb)
returns jsonb language sql security invoker set search_path='' as $$select maps_private.record_document_signature(p_map,p_operation,p_source,p_file,p_signature)$$;
revoke all on function public.maps_record_document_signature(uuid,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.maps_record_document_signature(uuid,uuid,text,jsonb,jsonb) to authenticated;
