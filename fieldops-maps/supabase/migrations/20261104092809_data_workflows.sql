-- Recoverable data replacements, separated from published manifests.
create table public.layer_data_versions (
 id uuid primary key default gen_random_uuid(),
 layer_id uuid not null references public.layers(id) on delete cascade,
 created_at timestamptz not null default now(),
 layer jsonb not null, features jsonb not null
);
create index layer_data_versions_layer on public.layer_data_versions(layer_id,created_at desc);
alter table public.layer_data_versions enable row level security;
create policy version_editors on public.layer_data_versions for all to authenticated
 using (exists(select 1 from public.layers l where l.id=layer_id))
 with check (exists(select 1 from public.layers l where l.id=layer_id));
grant select,insert,delete on public.layer_data_versions to authenticated;
revoke all on public.layer_data_versions from anon;
create function public.replace_vector_versioned(p_layer_id uuid,p_layer jsonb,p_features jsonb,p_expected text default '',p_restore uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_layer public.layers; previous public.layer_data_versions; token text:=gen_random_uuid()::text; backup_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first';end if;
 select * into current_layer from public.layers where id=p_layer_id and kind='vector' for update;
 if not found then raise exception 'Layer unavailable or access denied';end if;
 if coalesce(current_layer.metadata->>'data_revision','')<>coalesce(p_expected,'') then raise exception 'Layer data changed. Refresh and review the replacement again.';end if;
 if p_restore is not null then
  select * into previous from public.layer_data_versions where id=p_restore and layer_id=p_layer_id;
  if not found then raise exception 'Previous version is no longer available';end if;
  p_layer:=previous.layer;p_features:=previous.features;
 end if;
 insert into public.layer_data_versions(layer_id,layer,features)
 select p_layer_id,to_jsonb(current_layer),coalesce(jsonb_agg(jsonb_build_object('type','Feature','geometry',extensions.st_asgeojson(f.geometry)::jsonb,'properties',f.properties) order by f.id),'[]')
 from public.features f where f.layer_id=p_layer_id returning id into backup_id;
 -- Keep current presentation even when rolling data back.
 p_layer:=p_layer||jsonb_build_object('name',current_layer.name,'metadata',coalesce(p_layer->'metadata','{}')||jsonb_build_object('style',current_layer.metadata->'style','data_revision',token));
 perform public.replace_vector(p_layer_id,p_layer,p_features);
 delete from public.layer_data_versions where layer_id=p_layer_id and id not in(select id from public.layer_data_versions where layer_id=p_layer_id order by created_at desc,id desc limit 3);
 return jsonb_build_object('version',backup_id,'data_revision',token,'layer',p_layer,'features',p_features);
end $$;
revoke all on function public.replace_vector_versioned(uuid,jsonb,jsonb,text,uuid) from public,anon;
grant execute on function public.replace_vector_versioned(uuid,jsonb,jsonb,text,uuid) to authenticated;
create table public.map_style_presets (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 created_by uuid not null default auth.uid() references auth.users(id),
 name text not null check(length(trim(name)) between 1 and 100), style jsonb not null,
 created_at timestamptz not null default now()
);
create index map_style_presets_workspace on public.map_style_presets(workspace_id);
alter table public.map_style_presets enable row level security;
create policy preset_read on public.map_style_presets for select to authenticated using(maps_private.ws_role(workspace_id) in ('owner','admin','editor'));
create policy preset_insert on public.map_style_presets for insert to authenticated with check(created_by=auth.uid() and maps_private.ws_role(workspace_id) in ('owner','admin','editor'));
create policy preset_delete on public.map_style_presets for delete to authenticated using(maps_private.ws_manage(workspace_id) or (created_by=auth.uid() and maps_private.ws_role(workspace_id)='editor'));
grant select,insert,delete on public.map_style_presets to authenticated;
revoke all on public.map_style_presets from anon;
create function public.apply_map_style(p_ids uuid[],p_style jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if auth.uid() is null then raise exception 'Sign in first';end if;
 if cardinality(p_ids)<1 or cardinality(p_ids)>100 then raise exception 'Choose 1 to 100 layers';end if;
 perform 1 from public.layers where id=any(p_ids) and kind='vector' order by id for update;
 select count(*) into n from public.layers where id=any(p_ids) and kind='vector';
 if n<>cardinality(p_ids) then raise exception 'A selected layer is unavailable';end if;
 update public.layers set color=p_style->>'color',opacity=(p_style->>'opacity')::real,metadata=metadata||jsonb_build_object('style',(p_style->'style')||jsonb_build_object('view',metadata->'style'->'view','popup',metadata->'style'->'popup')) where id=any(p_ids);
end $$;
revoke all on function public.apply_map_style(uuid[],jsonb) from public,anon;
grant execute on function public.apply_map_style(uuid[],jsonb) to authenticated;
create table public.map_view_links (
 map_id uuid primary key references public.maps(id) on delete cascade,
 token text not null unique default replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),
 enabled boolean not null default false, created_at timestamptz not null default now()
);
alter table public.map_view_links enable row level security;
create policy share_editors on public.map_view_links for all to authenticated using(maps_private.ws_project(map_id)) with check(maps_private.ws_project(map_id));
grant select,insert,update,delete on public.map_view_links to authenticated;
revoke all on public.map_view_links from anon;
