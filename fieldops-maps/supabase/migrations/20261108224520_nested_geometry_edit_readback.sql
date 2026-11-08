-- Reuse the nested-collection serializer in editing, version history and optional
-- published-layer generalisation. CREATE OR REPLACE retains existing grants and
-- security modes; all existing permission and revision checks remain in place.
do $migration$
declare signature text; original text; revised text;
begin
 foreach signature in array array[
 'maps_private.release_layer(uuid,uuid,double precision,text[])',
 'public.replace_vector_versioned(uuid,jsonb,jsonb,text,uuid)',
 'maps_private.fieldops_apply_edit(uuid,uuid,uuid,jsonb,jsonb)'
 ] loop
  original:=pg_get_functiondef(signature::regprocedure);
  revised:=replace(original,'extensions.st_asgeojson(geometry)::jsonb','maps_private.geometry_geojson(geometry)');
  revised:=replace(revised,'extensions.st_asgeojson(f.geometry)::jsonb','maps_private.geometry_geojson(f.geometry)');
  revised:=replace(revised,'extensions.st_asgeojson(geom)::jsonb','maps_private.geometry_geojson(geom)');
  revised:=replace(revised,'extensions.st_asgeojson(geom,9)::jsonb','maps_private.geometry_geojson(geom)');
  if revised=original then raise exception 'Expected geometry serializer not found in %',signature;end if;
  execute revised;
 end loop;
end $migration$;
notify pgrst,'reload schema';
