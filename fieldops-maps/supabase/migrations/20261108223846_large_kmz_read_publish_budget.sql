-- Large KMZ readback and publication need the same bounded budget as import.
alter function public.layer_geojson(uuid) set statement_timeout='45s';
alter function public.sync_map(uuid,uuid,bigint,jsonb) set statement_timeout='45s';
notify pgrst,'reload schema';
