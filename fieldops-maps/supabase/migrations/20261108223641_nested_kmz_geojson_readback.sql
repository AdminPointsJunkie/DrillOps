-- PostGIS rejects nested GeometryCollections in ST_AsGeoJSON. Preserve the
-- collection hierarchy, component order and Z values without rewriting data.
create or replace function maps_private.geometry_geojson(p_geometry extensions.geometry)
returns jsonb language plpgsql immutable strict security invoker set search_path='' as $$
declare result jsonb;
begin
 begin
  return extensions.st_asgeojson(p_geometry)::jsonb;
 exception when internal_error then
  if extensions.geometrytype(p_geometry)<>'GEOMETRYCOLLECTION' then raise;end if;
 end;
 select coalesce(jsonb_agg(maps_private.geometry_geojson(extensions.st_geometryn(p_geometry,n)) order by n),'[]'::jsonb)
 into result from generate_series(1,extensions.st_numgeometries(p_geometry)) n;
 return jsonb_build_object('type','GeometryCollection','geometries',result);
end $$;
revoke all on function maps_private.geometry_geojson(extensions.geometry) from public,anon;
grant execute on function maps_private.geometry_geojson(extensions.geometry) to authenticated;
create or replace function public.layer_geojson(p_layer_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('type','FeatureCollection','features',
 coalesce(jsonb_agg(jsonb_build_object('type','Feature','id',id,
 'geometry',maps_private.geometry_geojson(geometry),'properties',properties) order by id),'[]'::jsonb))
 from public.features where layer_id=p_layer_id;
$$;
notify pgrst,'reload schema';
