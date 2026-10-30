create function maps_private.raster_reuse(p_map_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or not maps_private.ws_project(p_map_id) then raise exception 'Project access required' using errcode='42501';end if;
 select coalesce(jsonb_object_agg(l->>'id',jsonb_build_object('source',l->>'source_raster_path','path',l->>'raster_path')),'{}') into result
 from (select manifest from public.map_releases where map_id=p_map_id order by version desc limit 1) r cross join lateral jsonb_array_elements(r.manifest->'layers') l where l->>'source_raster_path' is not null;
 return coalesce(result,'{}');
end $$;
create function public.maps_raster_reuse(p_map_id uuid) returns jsonb language sql security invoker set search_path='' as $$select maps_private.raster_reuse(p_map_id);$$;
revoke all on function maps_private.raster_reuse(uuid),public.maps_raster_reuse(uuid) from public,anon,authenticated;
grant execute on function maps_private.raster_reuse(uuid),public.maps_raster_reuse(uuid) to authenticated;
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
   if target is null or (target<>auth.uid()::text||'/sync/'||p_release_id::text||'/'||l.id::text||'.png' and not exists(select 1 from jsonb_array_elements(coalesce(r.manifest->'layers','[]')) previous where previous->>'id'=l.id::text and previous->>'source_raster_path'=l.raster_path and previous->>'raster_path'=target))
   or not exists(select 1 from storage.objects where bucket_id='gis-files' and name=target)
   then raise exception 'A raster snapshot is missing. Try SYNC again.'; end if;
   paths:=array_append(paths,target);item:=item||jsonb_build_object('raster_path',target,'source_raster_path',l.raster_path);
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
