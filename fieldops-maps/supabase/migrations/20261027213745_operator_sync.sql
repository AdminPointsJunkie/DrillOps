alter table public.maps add column draft_revision bigint not null default 0,
 add column last_synced_revision bigint, add column last_synced_at timestamptz;

create table public.map_operators (
 map_id uuid references public.maps(id) on delete cascade not null,
 user_id uuid references auth.users(id) on delete cascade not null,
 primary key(map_id,user_id)
);
create index map_operators_user_idx on public.map_operators(user_id);
alter table public.map_operators enable row level security;
create policy operator_assignment_read on public.map_operators for select to authenticated
 using(user_id=(select auth.uid()) or exists(select 1 from public.maps where id=map_id));
create policy operator_assignment_manage on public.map_operators for all to authenticated
 using(exists(select 1 from public.maps where id=map_id))
 with check(exists(select 1 from public.maps where id=map_id));
grant select,insert,update,delete on public.map_operators to authenticated;

create table public.map_releases (
 id uuid primary key, map_id uuid not null references public.maps(id) on delete cascade,
 version bigint not null, source_revision bigint not null,
 published_at timestamptz not null default now(), published_by uuid not null default auth.uid() references auth.users(id),
 manifest jsonb not null, raster_paths text[] not null default '{}', unique(map_id,version)
);
alter table public.map_releases enable row level security;
create policy release_read on public.map_releases for select to authenticated using (
 exists(select 1 from public.maps where id=map_id) or
 exists(select 1 from public.map_operators o where o.map_id=map_releases.map_id and o.user_id=(select auth.uid())));
create policy release_create on public.map_releases for insert to authenticated
 with check(published_by=(select auth.uid()) and exists(select 1 from public.maps where id=map_id));
grant select,insert on public.map_releases to authenticated;
create policy operator_raster_read on storage.objects for select to authenticated
 using(bucket_id='gis-files' and exists(select 1 from public.map_releases r where name=any(r.raster_paths)));

-- Operator accounts cannot write draft data, even by making themselves an owner.
create policy operator_no_drafts on public.maps as restrictive for all to authenticated
 using(coalesce(auth.jwt()->'app_metadata'->>'maps_role','')<>'operator')
 with check(coalesce(auth.jwt()->'app_metadata'->>'maps_role','')<>'operator');
create policy operator_no_drafts on public.layers as restrictive for all to authenticated
 using(coalesce(auth.jwt()->'app_metadata'->>'maps_role','')<>'operator')
 with check(coalesce(auth.jwt()->'app_metadata'->>'maps_role','')<>'operator');
create policy operator_no_drafts on public.features as restrictive for all to authenticated
 using(coalesce(auth.jwt()->'app_metadata'->>'maps_role','')<>'operator')
 with check(coalesce(auth.jwt()->'app_metadata'->>'maps_role','')<>'operator');
create policy operator_no_upload on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'gis-files' or coalesce(auth.jwt()->'app_metadata'->>'maps_role','')<>'operator');
create policy operator_no_file_update on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'gis-files' or coalesce(auth.jwt()->'app_metadata'->>'maps_role','')<>'operator')
 with check(bucket_id<>'gis-files' or coalesce(auth.jwt()->'app_metadata'->>'maps_role','')<>'operator');
create policy operator_no_file_delete on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'gis-files' or coalesce(auth.jwt()->'app_metadata'->>'maps_role','')<>'operator');

create function public.map_draft_changed() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.name is distinct from old.name or new.default_crs is distinct from old.default_crs
 or new.default_crs_label is distinct from old.default_crs_label or new.layer_layout is distinct from old.layer_layout
 then new.draft_revision=old.draft_revision+1; end if;
 return new;
end $$;
create trigger map_draft_changed before update on public.maps for each row execute function public.map_draft_changed();
create function public.layer_draft_changed() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='DELETE' then update public.maps set draft_revision=draft_revision+1 where id=old.map_id;
 else update public.maps set draft_revision=draft_revision+1 where id=new.map_id; end if;
 return null;
end $$;
create trigger layer_draft_changed after insert or update or delete on public.layers for each row execute function public.layer_draft_changed();
create function public.feature_draft_changed() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.maps set draft_revision=draft_revision+1 where id in
 (select distinct l.map_id from public.layers l join changed c on c.layer_id=l.id);
 return null;
end $$;
create trigger feature_insert_changed after insert on public.features referencing new table as changed for each statement execute function public.feature_draft_changed();
create trigger feature_update_changed after update on public.features referencing new table as changed for each statement execute function public.feature_draft_changed();
create trigger feature_delete_changed after delete on public.features referencing old table as changed for each statement execute function public.feature_draft_changed();
revoke all on function public.map_draft_changed(),public.layer_draft_changed(),public.feature_draft_changed() from public,anon,authenticated;

create function public.sync_map(p_map_id uuid,p_release_id uuid,p_expected_revision bigint,p_rasters jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.maps; r public.map_releases; l public.layers; items jsonb:='[]'; item jsonb; target text; paths text[]:='{}'; v bigint;
begin
 if auth.uid() is null then raise exception 'Sign in before syncing'; end if;
 select * into m from public.maps where id=p_map_id for update;
 if not found then raise exception 'Project not found or access denied'; end if;
 if m.draft_revision<>p_expected_revision then raise exception 'Project changed while syncing. Try SYNC again.'; end if;
 select * into r from public.map_releases where map_id=p_map_id order by version desc limit 1;
 if found and r.source_revision=m.draft_revision then
  return jsonb_build_object('id',r.id,'version',r.version,'published_at',r.published_at,'source_revision',r.source_revision);
 end if;
 v:=coalesce(r.version,0)+1;
 for l in select * from public.layers where map_id=p_map_id and id::text in (
  select case when jsonb_typeof(n)='string' then n#>>'{}' else child#>>'{}' end
  from jsonb_array_elements(m.layer_layout) n
  left join lateral jsonb_array_elements(case when jsonb_typeof(n)='object' then coalesce(n->'children','[]') else '[]'::jsonb end) child on true
 ) order by created_at,id loop
  item:=jsonb_build_object('id',l.id,'name',l.name,'kind',l.kind,'source_crs',l.source_crs,'vertical_datum',l.vertical_datum,
   'color',l.color,'opacity',l.opacity,'visible',l.visible,'bounds',l.bounds,
   'metadata',jsonb_build_object('style',l.metadata->'style','xyz',l.metadata->'xyz','xyzView',l.metadata->'xyzView','crs_label',l.metadata->'crs_label'));
  if l.kind='vector' then item:=item||jsonb_build_object('fc',public.layer_geojson(l.id));
  elsif not (l.metadata ? 'xyz') then
   target:=p_rasters->>l.id::text;
   if target is null or target<>auth.uid()::text||'/sync/'||p_release_id::text||'/'||l.id::text||'.png'
   or not exists(select 1 from storage.objects where bucket_id='gis-files' and name=target)
   then raise exception 'A raster snapshot is missing. Try SYNC again.'; end if;
   paths:=array_append(paths,target);item:=item||jsonb_build_object('raster_path',target);
  end if;
  items:=items||jsonb_build_array(item);
 end loop;
 insert into public.map_releases(id,map_id,version,source_revision,manifest,raster_paths)
 values(p_release_id,p_map_id,v,m.draft_revision,jsonb_build_object('schema_version',1,'project',jsonb_build_object('id',m.id,'name',m.name,'default_crs',m.default_crs,'default_crs_label',m.default_crs_label),'layer_layout',m.layer_layout,'layers',items),paths)
 returning * into r;
 update public.maps set last_synced_revision=m.draft_revision,last_synced_at=r.published_at where id=p_map_id;
 return jsonb_build_object('id',r.id,'version',r.version,'published_at',r.published_at,'source_revision',r.source_revision);
end $$;
revoke all on function public.sync_map(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.sync_map(uuid,uuid,bigint,jsonb) to authenticated;
