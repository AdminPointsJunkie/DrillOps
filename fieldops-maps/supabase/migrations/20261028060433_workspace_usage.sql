create function maps_private.workspace_usage(w uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or maps_private.ws_role(w) is null then raise exception 'Company membership required' using errcode='42501';end if;
 with paths as (
  select l.raster_path path from public.layers l join public.maps m on m.id=l.map_id where m.workspace_id=w and l.raster_path is not null
  union select jsonb_array_elements_text(l.original_paths) from public.layers l join public.maps m on m.id=l.map_id where m.workspace_id=w
  union select unnest(r.raster_paths) from public.map_releases r join public.maps m on m.id=r.map_id where m.workspace_id=w
 ), files as (select o.metadata from paths p join storage.objects o on o.name=p.path and o.bucket_id='gis-files')
 select jsonb_build_object('generated_at',now(),'file_count',count(*),'file_bytes',coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end),0),
 'vector_bytes',(select coalesce(sum(pg_column_size(f)),0) from public.features f join public.layers l on l.id=f.layer_id join public.maps m on m.id=l.map_id where m.workspace_id=w)) into result from files;
 return result;
end $$;
create function public.workspace_usage(p_workspace uuid) returns jsonb language sql security invoker set search_path='' as $$ select maps_private.workspace_usage(p_workspace); $$;
revoke all on function maps_private.workspace_usage(uuid),public.workspace_usage(uuid) from public,anon,authenticated;
grant execute on function maps_private.workspace_usage(uuid),public.workspace_usage(uuid) to authenticated;
