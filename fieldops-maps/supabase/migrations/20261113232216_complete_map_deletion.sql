-- Map deletion keeps a retryable manifest until Storage API removal is verified.
create table maps_private.map_uploads(path text not null,map_id uuid not null references public.maps(id) on delete cascade,primary key(path,map_id));
create table maps_private.map_deletions(map_id uuid primary key references public.maps(id) on delete cascade,paths text[] not null,created_at timestamptz not null default now());
alter table maps_private.map_uploads enable row level security;
alter table maps_private.map_deletions enable row level security;
revoke all on maps_private.map_uploads,maps_private.map_deletions from public,anon,authenticated;

create function maps_private.map_file_paths() returns table(map_id uuid,path text) language sql stable security definer set search_path='' as $$
 with snapshots as (
 select l.map_id,to_jsonb(l) data from public.layers l
 union all select l.map_id,v.layer from public.layer_data_versions v join public.layers l on l.id=v.layer_id
 union all select t.map_id,t.layer_data from maps_private.layer_trash t
 union all select r.map_id,l from public.map_releases r cross join lateral jsonb_array_elements(coalesce(r.manifest->'layers','[]')) l
 ), paths as (
 select s.map_id,s.data->>'raster_path' path from snapshots s
 union select s.map_id,p from snapshots s cross join lateral jsonb_array_elements_text(coalesce(s.data->'original_paths','[]')) p
 union select r.map_id,unnest(r.raster_paths) from public.map_releases r
 union select m.id,f->>'path' from public.maps m cross join lateral jsonb_array_elements(m.supporting_files) f
 union select r.map_id,f->>'path' from public.map_releases r cross join lateral jsonb_array_elements(coalesce(r.manifest->'supporting_files','[]')) f
 union select u.map_id,u.path from maps_private.map_uploads u
 ) select distinct p.map_id,p.path from paths p where p.path is not null and p.path<>'';
$$;
revoke all on function maps_private.map_file_paths() from public,anon,authenticated;
insert into maps_private.map_uploads select path,map_id from maps_private.map_file_paths() on conflict do nothing;

-- Record uploads before they are attached to a layer, so failed/abandoned uploads are included.
create or replace function maps_private.register_file_upload(p_map uuid,p_path text) returns void language plpgsql security definer set search_path='' as $$
declare w uuid;existing maps_private.file_accounts;begin
 if not maps_private.ws_project(p_map) or split_part(p_path,'/',1) is distinct from auth.uid()::text or length(p_path)>1024 then raise exception 'Project upload access required' using errcode='42501';end if;
 perform 1 from public.maps where id=p_map for update;
 if exists(select 1 from maps_private.map_deletions where map_id=p_map) then raise exception 'Map deletion is in progress. Retry Delete map to finish.';end if;
 select workspace_id into w from public.maps where id=p_map;
 insert into maps_private.file_accounts values(p_path,w,auth.uid()) on conflict do nothing;
 select * into existing from maps_private.file_accounts where path=p_path;
 if existing.workspace_id<>w or existing.user_id<>auth.uid() or not maps_private.ws_path_allowed(p_path,w) then raise exception 'File belongs to a different company' using errcode='42501';end if;
 insert into maps_private.map_uploads values(p_path,p_map) on conflict do nothing;
end $$;

create function maps_private.guard_map_deletion() returns trigger language plpgsql security definer set search_path='' as $$
declare p uuid;begin
 if tg_table_name='maps' then p:=case when tg_op='DELETE' then old.id else new.id end;
 elsif tg_table_name='layers' then p:=case when tg_op='DELETE' then old.map_id else new.map_id end;
 else select map_id into p from public.layers where id=case when tg_op='DELETE' then old.layer_id else new.layer_id end;end if;
 if p is not null then
  perform 1 from public.maps where id=p for update;
  if exists(select 1 from maps_private.map_deletions where map_id=p) and current_setting('maps.delete_cleanup',true) is distinct from p::text then raise exception 'Map deletion is in progress. Retry Delete map to finish.';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function maps_private.guard_map_deletion() from public,anon,authenticated;
create trigger guard_map_deletion before update or delete on public.maps for each row execute function maps_private.guard_map_deletion();
create trigger guard_map_deletion before insert or update or delete on public.layers for each row execute function maps_private.guard_map_deletion();
create trigger guard_map_deletion before insert or update or delete on public.features for each row execute function maps_private.guard_map_deletion();

-- Do not allow a file awaiting removal to be attached to another map.
create or replace function maps_private.ws_path_allowed(path text,w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and maps_private.ws_file(path)
 and not exists(select 1 from maps_private.map_deletions d where path=any(d.paths))
 and not exists(select 1 from maps_private.file_accounts a where a.path=ws_path_allowed.path and a.workspace_id<>w)
 and not exists(select 1 from public.layers l join public.maps m on m.id=l.map_id where (l.raster_path=path or l.original_paths ? path) and m.workspace_id<>w)
 and not exists(select 1 from public.map_releases r join public.maps m on m.id=r.map_id where r.raster_paths @> array[path] and m.workspace_id<>w);
$$;

create function maps_private.delete_map(p_map uuid,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.maps;files text[];begin
 select * into m from public.maps where id=p_map for update;
 if auth.uid() is null or m.id is null or not maps_private.ws_manage(m.workspace_id) then raise exception 'Map administrator access required' using errcode='42501';end if;
 if p_action='prepare' then
  select paths into files from maps_private.map_deletions where map_id=p_map;
  if files is null then
   select coalesce(array_agg(distinct f.path),'{}') into files from maps_private.map_file_paths() f where f.map_id=p_map
    and not exists(select 1 from maps_private.map_file_paths() other where other.map_id<>p_map and other.path=f.path);
   insert into maps_private.map_deletions(map_id,paths) values(p_map,files);
  end if;
  return jsonb_build_object('id',p_map,'paths',files);
 elsif p_action='finish' then
  select paths into files from maps_private.map_deletions where map_id=p_map;
  if files is null then raise exception 'Prepare map deletion first';end if;
  if exists(select 1 from storage.objects where bucket_id='gis-files' and name=any(files)) then raise exception 'File cleanup is incomplete. Retry Delete map.';end if;
  delete from maps_private.upload_events where path=any(files);
  delete from maps_private.file_accounts where path=any(files);
  perform set_config('maps.delete_cleanup',p_map::text,true);
  delete from public.maps where id=p_map;
  return jsonb_build_object('id',p_map,'deleted',true,'files_removed',cardinality(files));
 else raise exception 'Unknown deletion action';end if;
end $$;
create function public.maps_delete_map(p_map uuid,p_action text) returns jsonb language sql security invoker set search_path='' as $$select maps_private.delete_map(p_map,p_action);$$;
revoke all on function maps_private.delete_map(uuid,text),public.maps_delete_map(uuid,text) from public,anon,authenticated;
grant execute on function maps_private.delete_map(uuid,text),public.maps_delete_map(uuid,text) to authenticated;
-- Older browser bundles must not bypass file cleanup.
revoke delete on public.maps from authenticated;
