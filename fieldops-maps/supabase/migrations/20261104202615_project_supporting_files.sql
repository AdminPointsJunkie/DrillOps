alter table public.maps add column supporting_files jsonb not null default '[]'::jsonb;
alter table public.maps add constraint supporting_files_array check(jsonb_typeof(supporting_files)='array' and jsonb_array_length(supporting_files)<=200);

-- Documents are immutable objects, referenced separately from GIS layers.
create function maps_private.validate_supporting_files() returns trigger language plpgsql security invoker set search_path='' as $$
declare f jsonb;bytes bigint;seen text[]:='{}';begin
 if tg_op='UPDATE' and new.supporting_files is not distinct from old.supporting_files then return new;end if;
 if jsonb_typeof(new.supporting_files)<>'array' or jsonb_array_length(new.supporting_files)>200 then raise exception 'Use up to 200 supporting files per project';end if;
 for f in select jsonb_array_elements(new.supporting_files) loop
  if jsonb_typeof(f)<>'object' or coalesce(f->>'name','') !~* '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|jpg|jpeg|png|gif|webp|heic|heif)$'
   or length(f->>'name')>240 or coalesce(f->>'path','')='' or split_part(f->>'path','/',2)<>new.id::text or split_part(f->>'path','/',3)<>'supporting'
   or (f->>'path')=any(seen) then raise exception 'Invalid supporting file';end if;
  if not maps_private.ws_path_allowed(f->>'path',new.workspace_id) then raise exception 'Project file access required' using errcode='42501';end if;
  select (metadata->>'size')::bigint into bytes from storage.objects where bucket_id='gis-files' and name=f->>'path';
  if bytes is null or bytes<1 or bytes>52428800 or (f->>'size')::bigint is distinct from bytes then raise exception 'Supporting files must be uploaded and no larger than 50 MB';end if;
  seen:=array_append(seen,f->>'path');
 end loop;
 if tg_op='UPDATE' then new.draft_revision:=old.draft_revision+1;end if;
 return new;
end $$;
create trigger supporting_files_validate before insert or update of supporting_files on public.maps for each row execute function maps_private.validate_supporting_files();
revoke all on function maps_private.validate_supporting_files() from public,anon,authenticated;

create function public.maps_supporting_file(p_map uuid,p_action text,p_file jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.maps;items jsonb;begin
 if auth.uid() is null or not maps_private.ws_project(p_map) then raise exception 'Project editing access required' using errcode='42501';end if;
 select * into m from public.maps where id=p_map for update;
 if not found then raise exception 'Project unavailable';end if;
 if p_action='add' then
  -- Retrying an uncertain response is safe and never duplicates an attachment.
  if exists(select 1 from jsonb_array_elements(m.supporting_files) f where f->>'path'=p_file->>'path') then return m.supporting_files;end if;
  items:=m.supporting_files||jsonb_build_array(p_file);
 elsif p_action='remove' then
  select coalesce(jsonb_agg(f),'[]'::jsonb) into items from jsonb_array_elements(m.supporting_files) f where f->>'path' is distinct from p_file->>'path';
 else raise exception 'Unknown supporting-file action';end if;
 update public.maps set supporting_files=items where id=p_map;
 return items;
end $$;
revoke all on function public.maps_supporting_file(uuid,text,jsonb) from public,anon;
grant execute on function public.maps_supporting_file(uuid,text,jsonb) to authenticated;

create or replace function maps_private.ws_file(path text,writing boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare w uuid;role text;begin
 if auth.uid() is null then return false;end if;
 select workspace_id into w from maps_private.file_accounts where file_accounts.path=ws_file.path;
 if w is not null then
  role:=maps_private.ws_role(w);
  if role is null or (writing and role not in ('owner','admin','editor')) then return false;end if;
 end if;
 if exists(select 1 from public.maps m where m.supporting_files @> jsonb_build_array(jsonb_build_object('path',path))) then
  if writing then return false;end if;
  if exists(select 1 from public.maps m where m.supporting_files @> jsonb_build_array(jsonb_build_object('path',path)) and maps_private.ws_project(m.id)) then return true;end if;
 end if;
 return maps_private.ws_file_before_meter(path,writing);
end $$;
create index maps_supporting_paths on public.maps using gin(supporting_files jsonb_path_ops);

create function maps_private.publish_supporting_files() returns trigger language plpgsql security invoker set search_path='' as $$
declare items jsonb;begin
 select supporting_files into items from public.maps where id=new.map_id;
 new.manifest:=jsonb_set(new.manifest,'{supporting_files}',coalesce(items,'[]'));
 new.raster_paths:=new.raster_paths||coalesce(array(select f->>'path' from jsonb_array_elements(items) f),'{}'::text[]);
 return new;
end $$;
-- Runs before the existing workspace release guard; the same immutable file access rules apply.
create trigger supporting_files_publish before insert on public.map_releases for each row execute function maps_private.publish_supporting_files();
revoke all on function maps_private.publish_supporting_files() from public,anon,authenticated;

create or replace function maps_private.release_manifest(p_map_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.map_releases;begin
 if auth.uid() is null or not maps_private.ws_project(p_map_id,true) then raise exception 'Published project access required' using errcode='42501';end if;
 select * into r from public.map_releases where map_id=p_map_id order by version desc limit 1;
 if not found then raise exception 'No published release';end if;
 return jsonb_build_object('schema_version',2,'id',r.id,'version',r.version,'published_at',r.published_at,'project',r.manifest->'project','layer_layout',r.manifest->'layer_layout','supporting_files',coalesce(r.manifest->'supporting_files','[]'),'layers',coalesce((select jsonb_agg(jsonb_build_object('id',l->>'id','hash',md5(l::text),'kind',l->>'kind','name',l->>'name','visible',l->'visible','bounds',l->'bounds','bytes',octet_length(l::text))) from jsonb_array_elements(r.manifest->'layers') l),'[]'::jsonb));
end $$;
