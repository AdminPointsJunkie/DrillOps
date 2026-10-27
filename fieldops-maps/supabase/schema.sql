create extension if not exists postgis with schema extensions;
create table public.maps (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 name text not null check (length(name) between 1 and 160), created_at timestamptz not null default now()
);
create index maps_owner_idx on public.maps(owner_id);
create table public.layers (
 id uuid primary key default gen_random_uuid(), map_id uuid not null references public.maps(id) on delete cascade,
 name text not null, kind text not null check(kind in ('vector','raster')), source_crs text not null,
 vertical_datum text not null default 'Unknown', metadata jsonb not null default '{}',
 color text not null default '#147d72', opacity real not null default 0.8 check(opacity between 0 and 1),
 visible boolean not null default true, feature_count integer not null default 0,
 original_paths jsonb not null default '[]', raster_path text, bounds jsonb,
 created_at timestamptz not null default now()
);
create index layers_map_idx on public.layers(map_id);
create table public.features (
 id bigint generated always as identity primary key,
 layer_id uuid not null references public.layers(id) on delete cascade,
 geometry extensions.geometry not null check(extensions.st_srid(geometry)=4326), properties jsonb not null default '{}'
);
create index features_layer_idx on public.features(layer_id);
create index features_geometry_idx on public.features using gist(geometry);
alter table public.maps enable row level security;
alter table public.layers enable row level security;
alter table public.features enable row level security;
create policy maps_owner on public.maps for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy layers_owner on public.layers for all to authenticated using(exists(select 1 from public.maps m where m.id=map_id and m.owner_id=(select auth.uid()))) with check(exists(select 1 from public.maps m where m.id=map_id and m.owner_id=(select auth.uid())));
create policy features_owner on public.features for all to authenticated using(exists(select 1 from public.layers l join public.maps m on m.id=l.map_id where l.id=layer_id and m.owner_id=(select auth.uid()))) with check(exists(select 1 from public.layers l join public.maps m on m.id=l.map_id where l.id=layer_id and m.owner_id=(select auth.uid())));
grant select,insert,update,delete on public.maps,public.layers,public.features to authenticated;
grant usage,select on sequence public.features_id_seq to authenticated;
create function public.import_vector(p_layer jsonb,p_features jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare lid uuid := gen_random_uuid(); n integer;
begin
 if auth.uid() is null then raise exception 'Sign in to save layers'; end if;
 n:=jsonb_array_length(p_features);
 if n=0 or n>20000 then raise exception 'Import between 1 and 20,000 features per layer'; end if;
 insert into public.layers(id,map_id,name,kind,source_crs,vertical_datum,metadata,color,feature_count,original_paths,bounds)
 values(lid,(p_layer->>'map_id')::uuid,p_layer->>'name','vector',p_layer->>'source_crs',coalesce(p_layer->>'vertical_datum','Unknown'),coalesce(p_layer->'metadata','{}'),coalesce(p_layer->>'color','#147d72'),n,coalesce(p_layer->'original_paths','[]'),p_layer->'bounds');
 insert into public.features(layer_id,geometry,properties)
 select lid,extensions.st_setsrid(extensions.st_geomfromgeojson(f->'geometry'),4326),coalesce(f->'properties','{}') from jsonb_array_elements(p_features) f;
 if exists(select 1 from public.features where layer_id=lid and (not extensions.st_isvalid(geometry) or extensions.st_isempty(geometry) or extensions.st_xmin(extensions.box3d(geometry)) < -180 or extensions.st_xmax(extensions.box3d(geometry)) > 180 or extensions.st_ymin(extensions.box3d(geometry)) < -90 or extensions.st_ymax(extensions.box3d(geometry)) > 90)) then raise exception 'Invalid or out-of-range geometry. Review source coordinates.'; end if;
 return lid;
end $$;
create function public.layer_geojson(p_layer_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('type','FeatureCollection','features',coalesce(jsonb_agg(jsonb_build_object('type','Feature','id',id,'geometry',extensions.st_asgeojson(geometry)::jsonb,'properties',properties)),'[]'::jsonb)) from public.features where layer_id=p_layer_id;
$$;
revoke all on function public.import_vector(jsonb,jsonb),public.layer_geojson(uuid) from public,anon;
grant execute on function public.import_vector(jsonb,jsonb),public.layer_geojson(uuid) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit) values('gis-files','gis-files',false,52428800);
create policy gis_owner on storage.objects for all to authenticated using(bucket_id='gis-files' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='gis-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
