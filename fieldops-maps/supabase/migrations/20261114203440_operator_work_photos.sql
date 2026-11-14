-- Assigned field operators may append work photos and completed forms, without editing maps or templates.
create table maps_private.field_document_submissions (
 id uuid primary key default gen_random_uuid(), map_id uuid not null references public.maps(id) on delete cascade,
 operation_id uuid not null, user_id uuid not null, kind text not null check(kind in ('photo','form')),
 received_at timestamptz not null default now(), request jsonb not null, file jsonb not null,
 unique(map_id,operation_id)
);
alter table maps_private.field_document_submissions enable row level security;
revoke all on maps_private.field_document_submissions from public,anon,authenticated;
create function maps_private.can_submit_field_document(p_map uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and maps_private.ws_project(p_map,true)
 and (maps_private.ws_project(p_map) or exists(select 1 from public.maps m join public.project_members p on p.map_id=m.id
 where m.id=p_map and p.user_id=auth.uid() and maps_private.ws_role(m.workspace_id)='operator'))
 and not exists(select 1 from maps_private.map_deletions where map_id=p_map);
$$;
revoke all on function maps_private.can_submit_field_document(uuid) from public,anon;
grant execute on function maps_private.can_submit_field_document(uuid) to authenticated;
create function maps_private.field_document_upload_allowed(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from maps_private.map_uploads u join maps_private.file_accounts a on a.path=u.path
 join public.maps m on m.id=u.map_id and m.workspace_id=a.workspace_id
 where u.path=p_path and a.user_id=auth.uid() and maps_private.can_submit_field_document(u.map_id)
 and p_path ~ ('^'||auth.uid()::text||'/'||u.map_id::text||'/supporting/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/(photo[.]jpg|form[.]pdf)$'));
$$;
revoke all on function maps_private.field_document_upload_allowed(text) from public,anon;
grant execute on function maps_private.field_document_upload_allowed(text) to authenticated;
create policy gis_field_document_insert on storage.objects for insert to authenticated
 with check(bucket_id='gis-files' and maps_private.field_document_upload_allowed(name));

alter function maps_private.register_file_upload(uuid,text) rename to register_file_upload_before_field_documents;
create function maps_private.register_file_upload(p_map uuid,p_path text) returns void language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if p_path is null or p_path !~ '/(photo[.]jpg|form[.]pdf)$' then perform maps_private.register_file_upload_before_field_documents(p_map,p_path);return;end if;
 if not maps_private.can_submit_field_document(p_map) then raise exception 'Assigned project access is required for field uploads' using errcode='42501';end if;
 perform 1 from public.maps where id=p_map for update;
 if not maps_private.can_submit_field_document(p_map) or p_path !~ ('^'||auth.uid()::text||'/'||p_map::text||'/supporting/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/(photo[.]jpg|form[.]pdf)$') then raise exception 'Invalid field upload path' using errcode='42501';end if;
 select workspace_id into w from public.maps where id=p_map;
 insert into maps_private.file_accounts values(p_path,w,auth.uid()) on conflict do nothing;
 if not exists(select 1 from maps_private.file_accounts where path=p_path and workspace_id=w and user_id=auth.uid()) then raise exception 'File belongs to another account' using errcode='42501';end if;
 insert into maps_private.map_uploads values(p_path,p_map) on conflict do nothing;
end $$;
revoke all on function maps_private.register_file_upload(uuid,text),maps_private.register_file_upload_before_field_documents(uuid,text) from public,anon,authenticated;
grant execute on function maps_private.register_file_upload(uuid,text) to authenticated;
create or replace function public.register_file_upload(p_map uuid,p_path text) returns void language sql security invoker set search_path='' as $$select maps_private.register_file_upload(p_map,p_path);$$;

create or replace function maps_private.ws_file(path text,writing boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return false;end if;
 if not writing then
  if maps_private.signing_upload_allowed(path) or maps_private.field_document_upload_allowed(path) then return true;end if;
  if exists(select 1 from public.maps m where m.supporting_files @> jsonb_build_array(jsonb_build_object('path',path)) and maps_private.ws_project(m.id,true) and not exists(select 1 from maps_private.map_deletions d where d.map_id=m.id)) then return true;end if;
 end if;
 return maps_private.ws_file_before_signing(path,writing);
end $$;

create or replace function maps_private.current_documents(p_map uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not maps_private.ws_project(p_map,true) or exists(select 1 from maps_private.map_deletions where map_id=p_map) then raise exception 'Project access required' using errcode='42501';end if;
 return (select jsonb_build_object('files',supporting_files,'can_sign',maps_private.can_sign_document(p_map),'can_submit_field_documents',maps_private.can_submit_field_document(p_map)) from public.maps where id=p_map);
end $$;

create function maps_private.submit_field_document(p_kind text,p_map uuid,p_operation uuid,p_file jsonb,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.maps; prior maps_private.field_document_submissions; payload jsonb; entry jsonb; original jsonb; bytes bigint; expected text; receipt_id uuid:=gen_random_uuid();received timestamptz:=now(); k text;begin
 if not maps_private.can_submit_field_document(p_map) then raise exception 'Assigned project upload access required' using errcode='42501';end if;
 select * into m from public.maps where id=p_map for update;
 if not maps_private.can_submit_field_document(p_map) then raise exception 'Project upload access changed' using errcode='42501';end if;
 payload:=jsonb_build_object('file',p_file,'details',p_details);
 select * into prior from maps_private.field_document_submissions where map_id=p_map and operation_id=p_operation;
 if found then
  if prior.user_id is distinct from auth.uid() or prior.kind is distinct from p_kind or prior.request is distinct from payload then raise exception 'Upload operation does not match';end if;
  return jsonb_build_object('files',m.supporting_files,'receipt',jsonb_build_object('id',prior.id,'operation_id',prior.operation_id,'received_at',prior.received_at,'signed_at',prior.received_at,'output_sha256',prior.request->'details'->>'output_sha256'));
 end if;
 if p_operation is null or p_kind not in ('photo','form') or jsonb_typeof(p_file) is distinct from 'object' or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>16384 then raise exception 'Invalid field submission';end if;
 expected:=auth.uid()::text||'/'||p_map::text||'/supporting/'||p_operation::text||case when p_kind='photo' then '/photo.jpg' else '/form.pdf' end;
 if p_file->>'path' is distinct from expected or not maps_private.field_document_upload_allowed(expected)
 or coalesce(p_file->>'name','')='' or length(p_file->>'name')>240 or p_file->>'name' ~ '[/\\]'
 or coalesce(p_details->>'output_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Register the immutable field upload before saving';end if;
 select (metadata->>'size')::bigint into bytes from storage.objects where bucket_id='gis-files' and name=expected;
 if bytes is null or bytes<1 or bytes is distinct from (p_file->>'size')::bigint then raise exception 'Field upload is incomplete';end if;
 if jsonb_array_length(m.supporting_files)>=200 then raise exception 'This project has reached its supporting file limit';end if;
 if p_kind='photo' then
  if p_file->>'type' is distinct from 'image/jpeg' or p_file->>'name' !~* '[.]jpg$' or bytes>2097152
   or p_details->>'datum' is distinct from 'WGS84' or coalesce(p_details->>'captured_at','')='' then raise exception 'Invalid work photo';end if;
  perform (p_details->>'captured_at')::timestamptz;
  if coalesce((p_details->>'width')::int,0) not between 1 and 1920 or coalesce((p_details->>'height')::int,0) not between 1 and 1920 then raise exception 'Work photos must be reduced to 1920 pixels or smaller';end if;
  if (p_details->>'latitude' is null) <> (p_details->>'longitude' is null) then raise exception 'Incomplete GPS coordinates';end if;
  if p_details->>'latitude' is not null and (not ((p_details->>'latitude')::numeric between -90 and 90) or not ((p_details->>'longitude')::numeric between -180 and 180)) then raise exception 'Invalid GPS coordinates';end if;
  if p_details->>'azimuth' is not null and (not ((p_details->>'azimuth')::numeric>=0 and (p_details->>'azimuth')::numeric<360) or coalesce(p_details->>'azimuth_reference','') not in ('true','magnetic')) then raise exception 'Invalid azimuth';end if;
  entry:=p_file||jsonb_build_object('group','Work-area photos','uploaded_at',received,'photo',p_details||jsonb_build_object('uploader_id',auth.uid(),'received_at',received));
 else
  if p_file->>'type' is distinct from 'application/pdf' or p_file->>'name' !~* '[.]pdf$' or bytes>52428800
   or coalesce(p_details->>'template_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_details->>'source_sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_details->>'method','') not in ('typed','drawn','certificate') then raise exception 'Invalid completed form';end if;
  if p_details->>'method'='certificate' and coalesce(p_details->>'certificate_fingerprint','') !~ '^[a-f0-9]{64}$' then raise exception 'Certificate fingerprint required';end if;
  select f into original from jsonb_array_elements(m.supporting_files) f where f->>'path'=p_details->>'template_path' and f->'form_template'='true'::jsonb;
  if original is null then raise exception 'This template has changed or is no longer available. Review the current template before submitting.';end if;
  entry:=p_file||jsonb_build_object('group','Completed forms','uploaded_at',received,'form_template',false,'form_submission',p_details||jsonb_build_object('template_name',original->>'name','signer_id',auth.uid(),'signed_at',received));
 end if;
 insert into maps_private.field_document_submissions(id,map_id,operation_id,user_id,kind,request,file) values(receipt_id,p_map,p_operation,auth.uid(),p_kind,payload,entry);
 update public.maps set supporting_files=supporting_files||jsonb_build_array(entry) where id=p_map returning supporting_files into m.supporting_files;
 return jsonb_build_object('files',m.supporting_files,'receipt',jsonb_build_object('id',receipt_id,'operation_id',p_operation,'received_at',received,'signed_at',received,'output_sha256',p_details->>'output_sha256'));
end $$;
revoke all on function maps_private.submit_field_document(text,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function maps_private.submit_field_document(text,uuid,uuid,jsonb,jsonb) to authenticated;
create function public.maps_submit_field_document(p_kind text,p_map uuid,p_operation uuid,p_file jsonb,p_details jsonb) returns jsonb language sql security invoker set search_path='' as $$select maps_private.submit_field_document(p_kind,p_map,p_operation,p_file,p_details);$$;
revoke all on function public.maps_submit_field_document(text,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.maps_submit_field_document(text,uuid,uuid,jsonb,jsonb) to authenticated;

create function maps_private.set_form_template(p_map uuid,p_path text,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb;begin
 if not maps_private.ws_project(p_map) then raise exception 'Desktop project editing access required' using errcode='42501';end if;
 perform 1 from public.maps where id=p_map for update;
 if not exists(select 1 from public.maps m cross join lateral jsonb_array_elements(m.supporting_files) f where m.id=p_map and f->>'path'=p_path and f->>'name' ~* '[.]pdf$' and f->'form_submission' is null) then raise exception 'Choose a blank PDF form template';end if;
 update public.maps set supporting_files=(select jsonb_agg(case when f->>'path'=p_path then f||jsonb_build_object('form_template',coalesce(p_enabled,false)) else f end order by ordinal) from jsonb_array_elements(supporting_files) with ordinality a(f,ordinal)) where id=p_map returning supporting_files into items;
 return items;
end $$;
create function public.maps_set_form_template(p_map uuid,p_path text,p_enabled boolean) returns jsonb language sql security invoker set search_path='' as $$select maps_private.set_form_template(p_map,p_path,p_enabled);$$;
revoke all on function maps_private.set_form_template(uuid,text,boolean),public.maps_set_form_template(uuid,text,boolean) from public,anon;
grant execute on function maps_private.set_form_template(uuid,text,boolean),public.maps_set_form_template(uuid,text,boolean) to authenticated;
