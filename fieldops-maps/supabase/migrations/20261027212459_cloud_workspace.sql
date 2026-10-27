-- Persist map organisation centrally; keep all data scoped to owners or the main admin.
alter table public.maps add column if not exists layer_layout jsonb not null default '[]'
 check (jsonb_typeof(layer_layout)='array');

create or replace function public.maps_admin() returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(auth.jwt()->'app_metadata'->>'maps_role'='admin',false);
$$;
revoke all on function public.maps_admin() from public,anon;
grant execute on function public.maps_admin() to authenticated;
create policy maps_admin_access on public.maps for all to authenticated
 using ((select public.maps_admin())) with check ((select public.maps_admin()));
create policy layers_admin_access on public.layers for all to authenticated
 using ((select public.maps_admin())) with check ((select public.maps_admin()));
create policy features_admin_access on public.features for all to authenticated
 using ((select public.maps_admin())) with check ((select public.maps_admin()));
create policy gis_admin_access on storage.objects for all to authenticated
 using (bucket_id='gis-files' and (select public.maps_admin()))
 with check (bucket_id='gis-files' and (select public.maps_admin()));

create or replace function public.replace_vector(p_layer_id uuid,p_layer jsonb,p_features jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare n integer;
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
 select p_layer_id,extensions.st_setsrid(extensions.st_geomfromgeojson(f->'geometry'),4326),coalesce(f->'properties','{}')
 from jsonb_array_elements(p_features) f;
 if exists(select 1 from public.features where layer_id=p_layer_id and
 (not extensions.st_isvalid(geometry) or extensions.st_isempty(geometry)
 or extensions.st_xmin(extensions.box3d(geometry)) < -180 or extensions.st_xmax(extensions.box3d(geometry)) > 180
 or extensions.st_ymin(extensions.box3d(geometry)) < -90 or extensions.st_ymax(extensions.box3d(geometry)) > 90))
 then raise exception 'Invalid or out-of-range geometry. Review source coordinates.'; end if;
 return p_layer_id;
end $$;
revoke all on function public.replace_vector(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.replace_vector(uuid,jsonb,jsonb) to authenticated;

create or replace function public.import_vector(p_layer jsonb,p_features jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare lid uuid := coalesce((p_layer->>'id')::uuid,gen_random_uuid());
begin
 if auth.uid() is null then raise exception 'Sign in to save layers'; end if;
 insert into public.layers(id,map_id,name,kind,source_crs,vertical_datum,metadata,color,opacity,visible,original_paths,bounds)
 values(lid,(p_layer->>'map_id')::uuid,p_layer->>'name','vector',p_layer->>'source_crs',
 coalesce(p_layer->>'vertical_datum','Unknown'),coalesce(p_layer->'metadata','{}'),
 coalesce(p_layer->>'color','#147d72'),coalesce((p_layer->>'opacity')::real,.85),
 coalesce((p_layer->>'visible')::boolean,true),coalesce(p_layer->'original_paths','[]'),p_layer->'bounds');
 perform public.replace_vector(lid,p_layer,p_features);
 return lid;
end $$;
revoke all on function public.import_vector(jsonb,jsonb) from public,anon;
grant execute on function public.import_vector(jsonb,jsonb) to authenticated;
