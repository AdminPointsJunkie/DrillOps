-- Preserve collapsed CAD line entities without relaxing geometry validation.
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
 bounds=p_layer->'bounds',feature_count=n where id=p_layer_id;
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

