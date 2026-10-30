-- Local-only TIFF policy for new cloud writes. Existing data is not deleted.
create function maps_private.reject_cloud_tiff() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_TABLE_SCHEMA='storage' then
  if new.bucket_id='gis-files' and (new.name ~* '\.tiff?$' or coalesce(new.metadata->>'mimetype','') ~* 'image/(x-)?tiff') then raise exception 'GeoTIFFs are local-only and cannot be uploaded';end if;
 else
  if new.kind='raster' and not (new.metadata ? 'xyz') and (coalesce(new.metadata->>'local_only','false')='true' or coalesce(new.metadata->>'format','') ~* '^(GTiff|GeoTIFF|COG)$' or exists(select 1 from jsonb_array_elements_text(coalesce(new.metadata->'source_names','[]')) n where n ~* '\.tiff?$')) then raise exception 'GeoTIFFs and their previews are local-only';end if;
 end if;return new;
end $$;
revoke all on function maps_private.reject_cloud_tiff() from public,anon,authenticated;
create trigger fieldmaps_no_tiff_storage before insert or update on storage.objects for each row execute function maps_private.reject_cloud_tiff();
create trigger fieldmaps_no_tiff_layer before insert or update on public.layers for each row execute function maps_private.reject_cloud_tiff();

-- Keep only the latest three shared releases after a successful new publication.
-- Drafts and uploaded objects are retained; old device receipt references cascade.
create function maps_private.retain_recent_releases() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not maps_private.ws_project(new.map_id) then raise exception 'Project administrator required' using errcode='42501';end if;
 delete from public.map_releases where map_id=new.map_id and id in (select id from public.map_releases where map_id=new.map_id order by version desc offset 3);
 return new;
end $$;
revoke all on function maps_private.retain_recent_releases() from public,anon,authenticated;
create trigger fieldmaps_release_retention after insert on public.map_releases for each row execute function maps_private.retain_recent_releases();

-- Small manifest: check permissions on every call, even when clients have cached content.
create function maps_private.release_manifest(p_map_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.map_releases;begin
 if auth.uid() is null or not maps_private.ws_project(p_map_id,true) then raise exception 'Published project access required' using errcode='42501';end if;
 select * into r from public.map_releases where map_id=p_map_id order by version desc limit 1;
 if not found then raise exception 'No published release';end if;
 return jsonb_build_object('schema_version',2,'id',r.id,'version',r.version,'published_at',r.published_at,'project',r.manifest->'project','layer_layout',r.manifest->'layer_layout','layers',coalesce((select jsonb_agg(jsonb_build_object('id',l->>'id','hash',md5(l::text),'kind',l->>'kind','name',l->>'name','visible',l->'visible','bounds',l->'bounds','bytes',octet_length(l::text))) from jsonb_array_elements(r.manifest->'layers') l),'[]'::jsonb));
end $$;
create function public.maps_release_manifest(p_map_id uuid) returns jsonb language sql security invoker set search_path='' as $$select maps_private.release_manifest(p_map_id);$$;

-- Optional field selection and display-only generalisation. Exact geometry is the default.
create function maps_private.release_layer(p_release uuid,p_layer uuid,p_tolerance double precision default 0,p_fields text[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.map_releases;item jsonb;f jsonb;features jsonb:='[]';props jsonb;geom extensions.geometry;begin
 select * into r from public.map_releases where id=p_release;
 if auth.uid() is null or r.id is null or not maps_private.ws_project(r.map_id,true) then raise exception 'Published release access required' using errcode='42501';end if;
 if p_tolerance is null or p_tolerance not in (0,2,10,50) or coalesce(cardinality(p_fields),0)>100 then raise exception 'Invalid display options';end if;
 select value into item from jsonb_array_elements(r.manifest->'layers') where value->>'id'=p_layer::text;
 if item is null then raise exception 'Layer is not in this release';end if;
 if item->>'kind'='vector' and (p_tolerance>0 or p_fields is not null) then
  for f in select value from jsonb_array_elements(item->'fc'->'features') loop
   props:=f->'properties';
   if p_fields is not null then select coalesce(jsonb_object_agg(key,value),'{}') into props from jsonb_each(props) where key=any(p_fields) or left(key,1)='_';end if;
   if p_tolerance>0 and f->'geometry'<>'null'::jsonb then
    geom:=extensions.st_setsrid(extensions.st_geomfromgeojson(f->'geometry'),4326);
    -- Avoid Mercator poles. Tolerance is in projected display metres, not survey distance.
    if extensions.st_ymin(extensions.box3d(geom))>-85 and extensions.st_ymax(extensions.box3d(geom))<85 then
     geom:=extensions.st_transform(extensions.st_simplifypreservetopology(extensions.st_transform(geom,3857),p_tolerance),4326);
     f:=jsonb_set(f,'{geometry}',extensions.st_asgeojson(geom,9)::jsonb);
    end if;
   end if;
   features:=features||jsonb_build_array(jsonb_set(f,'{properties}',props));
  end loop;
  item:=jsonb_set(item,'{fc,features}',features)||jsonb_build_object('display_tolerance',p_tolerance,'selected_fields',to_jsonb(p_fields));
 end if;
 return item;
end $$;
create function public.maps_release_layer(p_release uuid,p_layer uuid,p_tolerance double precision default 0,p_fields text[] default null) returns jsonb language sql security invoker set search_path='' as $$select maps_private.release_layer(p_release,p_layer,p_tolerance,p_fields);$$;
revoke all on function maps_private.release_manifest(uuid),public.maps_release_manifest(uuid),maps_private.release_layer(uuid,uuid,double precision,text[]),public.maps_release_layer(uuid,uuid,double precision,text[]) from public,anon,authenticated;
grant execute on function maps_private.release_manifest(uuid),public.maps_release_manifest(uuid),maps_private.release_layer(uuid,uuid,double precision,text[]),public.maps_release_layer(uuid,uuid,double precision,text[]) to authenticated;

create or replace function public.sync_map(p_map_id uuid,p_release_id uuid,p_expected_revision bigint,p_rasters jsonb default '{}')
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
  if l.kind='raster' and not (l.metadata ? 'xyz') and (coalesce(l.metadata->>'local_only','false')='true' or coalesce(l.metadata->>'format','') ~* '^(GTiff|GeoTIFF|COG)$' or exists(select 1 from jsonb_array_elements_text(coalesce(l.metadata->'source_names','[]')) n where n ~* '\.tiff?$')) then continue;end if;
  item:=jsonb_build_object('id',l.id,'name',l.name,'kind',l.kind,'source_crs',l.source_crs,'vertical_datum',l.vertical_datum,
   'color',l.color,'opacity',l.opacity,'visible',l.visible,'bounds',l.bounds,
   'metadata',jsonb_build_object('annotation',l.metadata->'annotation','style',l.metadata->'style','xyz',l.metadata->'xyz','xyzView',l.metadata->'xyzView','crs_label',l.metadata->'crs_label'));
  if l.kind='vector' then
   item:=item||jsonb_build_object('fc',public.layer_geojson(l.id));
   -- Immutable files are retained by release storage policies, including after draft removal.
   for target in select distinct file_path
    from jsonb_array_elements(item->'fc'->'features') f
    cross join lateral jsonb_array_elements(coalesce(f->'properties'->'_fieldmaps_files','[]')) a
    cross join lateral (select a->>'path' file_path union select a->>'thumbnail_path' where a->>'thumbnail_path' is not null) refs loop
    if target is null or not (coalesce(l.original_paths,'[]') ? target)
     or not exists(select 1 from storage.objects where bucket_id='gis-files' and name=target)
    then raise exception 'A location attachment is missing or unavailable. Refresh the project and try again.'; end if;
    paths:=array_append(paths,target);
   end loop;
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
