-- Independent workspace snapshots; deleting a source project cannot remove them.
create table public.workspace_layer_library (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(name) between 1 and 160),
 description text not null default '' check(length(description)<=2000),
 category text not null default 'General' check(length(category) between 1 and 60),
 kind text not null check(kind in ('vector','raster','tiles')),
 presentation jsonb not null default '{}' check(jsonb_typeof(presentation)='object'),
 asset_path text,
 asset_bytes bigint not null default 0 check(asset_bytes between 0 and 52428800),
 feature_count integer not null default 0 check(feature_count>=0),
 archived boolean not null default false,
 created_by uuid references auth.users(id) on delete set null default auth.uid(),
 created_at timestamptz not null default now(),
 check(asset_path is null or asset_path=workspace_id::text||'/'||id::text||'/data'),
 check((kind='tiles' and asset_path is null) or (kind<>'tiles' and asset_path is not null))
);
create index workspace_library_lookup on public.workspace_layer_library(workspace_id,archived,created_at desc);
create index workspace_library_creator on public.workspace_layer_library(created_by);
alter table public.workspace_layer_library enable row level security;
revoke all on public.workspace_layer_library from anon,authenticated;
grant select,insert,update on public.workspace_layer_library to authenticated;
create policy library_read on public.workspace_layer_library for select to authenticated
 using (maps_private.ws_role(workspace_id) in ('owner','admin','editor') and (not archived or maps_private.ws_manage(workspace_id)));
create policy library_save on public.workspace_layer_library for insert to authenticated
 with check (maps_private.ws_manage(workspace_id) and created_by=auth.uid());
create policy library_manage on public.workspace_layer_library for update to authenticated
 using (maps_private.ws_manage(workspace_id)) with check (maps_private.ws_manage(workspace_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('layer-library','layer-library',false,52428800,array['application/geo+json','application/json','image/png','image/jpeg','image/webp']);
-- Compare workspace IDs as text: malformed object names never cause UUID cast errors.
create policy library_asset_read on storage.objects for select to authenticated using (
 bucket_id='layer-library' and (exists(select 1 from public.workspace_layer_library l where l.asset_path=name) or exists(select 1 from public.workspaces w where w.id::text=split_part(name,'/',1) and maps_private.ws_manage(w.id)))
);
create policy library_asset_write on storage.objects for insert to authenticated with check (
 bucket_id='layer-library' and exists(select 1 from public.workspaces w where w.id::text=split_part(name,'/',1) and maps_private.ws_manage(w.id))
);
create policy library_asset_cleanup on storage.objects for delete to authenticated using (
 bucket_id='layer-library' and exists(select 1 from public.workspaces w where w.id::text=split_part(name,'/',1) and maps_private.ws_manage(w.id))
 and not exists(select 1 from public.workspace_layer_library l where l.asset_path=name)
);
