-- Preserve attachment ownership and publish only validated, immutable file references.
create or replace function public.replace_vector(p_layer_id uuid,p_layer jsonb,p_features jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare n integer; invalid_reason text; invalid_handle text;
begin
 if auth.uid() is null then raise exception 'Sign in to save layers'; end if;
 perform 1 from public.layers where id=p_layer_id and kind='vector' for update;
 if not found then raise exception 'Layer not found or access denied'; end if;
 n:=jsonb_array_length(p_features);
 if n is null or n=0 or n>20000 then raise exception 'Import between 1 and 20,000 features per layer'; end if;
 update public.layers set name=p_layer->>'name',source_crs=p_layer->>'source_crs',
 vertical_datum=coalesce(p_layer->>'vertical_datum','Unknown'),metadata=coalesce(p_layer->'metadata','{}'),
 original_paths=coalesce(p_layer->'original_paths',original_paths),bounds=p_layer->'bounds',feature_count=n where id=p_layer_id;
 delete from public.features where layer_id=p_layer_id;
 insert into public.features(layer_id,geometry,properties)
 with parsed as (
  select extensions.st_setsrid(extensions.st_geomfromgeojson(f->'geometry'),4326) g,coalesce(f->'properties','{}') props
  from jsonb_array_elements(p_features) f
 ), checked as (
  select *,coalesce(p_layer->'metadata'->>'format','')='DXF'
   and extensions.geometrytype(g)='LINESTRING' and extensions.st_npoints(g)>=2
   and extensions.st_length(g)=0
   and extensions.st_zmin(extensions.box3d(g)) is not distinct from extensions.st_zmax(extensions.box3d(g)) collapsed
  from parsed
 )
 select p_layer_id,case when collapsed then extensions.st_startpoint(g) else g end,
  case when collapsed then props||jsonb_build_object('_drillops_geometry_note','Collapsed DXF line preserved as a point') else props end
 from checked;
 select extensions.st_isvalidreason(geometry),properties->>'EntityHandle' into invalid_reason,invalid_handle
 from public.features where layer_id=p_layer_id and
 (not extensions.st_isvalid(geometry) or extensions.st_isempty(geometry)
 or extensions.st_xmin(extensions.box3d(geometry)) < -180 or extensions.st_xmax(extensions.box3d(geometry)) > 180
 or extensions.st_ymin(extensions.box3d(geometry)) < -90 or extensions.st_ymax(extensions.box3d(geometry)) > 90) limit 1;
 if found then raise exception 'Layer could not save: %. %',
  coalesce('CAD entity '||invalid_handle,'Invalid geometry'),
  case when invalid_reason='Valid Geometry' then 'Coordinates are empty or outside longitude/latitude limits. Check the source CRS.' else invalid_reason end;
 end if;
 return p_layer_id;
end $$;
revoke all on function public.replace_vector(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.replace_vector(uuid,jsonb,jsonb) to authenticated;


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
  item:=jsonb_build_object('id',l.id,'name',l.name,'kind',l.kind,'source_crs',l.source_crs,'vertical_datum',l.vertical_datum,
   'color',l.color,'opacity',l.opacity,'visible',l.visible,'bounds',l.bounds,
   'metadata',jsonb_build_object('annotation',l.metadata->'annotation','style',l.metadata->'style','xyz',l.metadata->'xyz','xyzView',l.metadata->'xyzView','crs_label',l.metadata->'crs_label'));
  if l.kind='vector' then
   item:=item||jsonb_build_object('fc',public.layer_geojson(l.id));
   -- Immutable files are retained by release storage policies, including after draft removal.
   for target in select distinct a->>'path'
    from jsonb_array_elements(item->'fc'->'features') f
    cross join lateral jsonb_array_elements(coalesce(f->'properties'->'_fieldmaps_files','[]')) a loop
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
