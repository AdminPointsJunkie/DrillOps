create or replace function maps_private.geometry_geojson_text(p_geometry extensions.geometry)
returns text language plpgsql immutable strict security invoker set search_path='' as $$
declare result text;
begin
 begin return extensions.st_asgeojson(p_geometry);
 exception when internal_error then
  if extensions.geometrytype(p_geometry)<>'GEOMETRYCOLLECTION' then raise;end if;
 end;
 select string_agg(maps_private.geometry_geojson_text(extensions.st_geometryn(p_geometry,n)),',' order by n)
 into result from generate_series(1,extensions.st_numgeometries(p_geometry)) n;
 return '{"type":"GeometryCollection","geometries":['||coalesce(result,'')||']}';
end $$;
revoke all on function maps_private.geometry_geojson_text(extensions.geometry) from public,anon;
grant execute on function maps_private.geometry_geojson_text(extensions.geometry) to authenticated;
create or replace function maps_private.geometry_geojson(p_geometry extensions.geometry)
returns jsonb language sql immutable strict security invoker set search_path='' as $$
 select maps_private.geometry_geojson_text(p_geometry)::jsonb;
$$;
create or replace function public.layer_geojson(p_layer_id uuid) returns jsonb
language sql stable security invoker set search_path='' set statement_timeout='45s' as $$
 select json_build_object('type','FeatureCollection','features',
 coalesce(json_agg(json_build_object('type','Feature','id',id,
 'geometry',maps_private.geometry_geojson_text(geometry)::json,'properties',properties) order by id),'[]'::json))::jsonb
 from public.features where layer_id=p_layer_id;
$$;
-- Include the small project settings while constructing the manifest, avoiding
-- copying a multi-megabyte geometry tree again in each BEFORE INSERT trigger.
do $migration$ declare original text; revised text;begin
 original:=pg_get_functiondef('public.sync_map(uuid,uuid,bigint,jsonb)'::regprocedure);
 revised:=replace(original,'''default_crs_label'',m.default_crs_label)', '''default_crs_label'',m.default_crs_label,''map_settings'',coalesce(m.map_settings,''{}''::jsonb))');
 revised:=replace(revised,'''layer_layout'',m.layer_layout,''layers'',items)', '''layer_layout'',m.layer_layout,''layers'',items,''supporting_files'',coalesce(m.supporting_files,''[]''::jsonb))');
 if revised=original then raise exception 'Expected manifest construction was not found';end if;
 execute revised;
end $migration$;
create or replace function maps_private.publish_map_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
declare settings jsonb;begin
 select coalesce(map_settings,'{}') into settings from public.maps where id=new.map_id;
 if new.manifest#>'{project,map_settings}' is distinct from settings then
  new.manifest:=jsonb_set(new.manifest,'{project,map_settings}',settings);
 end if;
 return new;
end $$;
create or replace function maps_private.publish_supporting_files() returns trigger
language plpgsql security invoker set search_path='' as $$
declare items jsonb;begin
 select coalesce(supporting_files,'[]') into items from public.maps where id=new.map_id;
 if new.manifest->'supporting_files' is distinct from items then
  new.manifest:=jsonb_set(new.manifest,'{supporting_files}',items);
 end if;
 new.raster_paths:=new.raster_paths||coalesce(array(select f->>'path' from jsonb_array_elements(items) f),'{}'::text[]);
 return new;
end $$;
notify pgrst,'reload schema';
