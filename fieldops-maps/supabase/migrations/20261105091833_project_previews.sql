create table public.project_previews (
 map_id uuid primary key references public.maps(id) on delete cascade,
 image text not null check (octet_length(image)<=200000 and image ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$'),
 updated_at timestamptz not null default now()
);
alter table public.project_previews enable row level security;
grant select,insert,update,delete on public.project_previews to authenticated;
create policy preview_read on public.project_previews for select to authenticated using (maps_private.ws_project(map_id));
create policy preview_insert on public.project_previews for insert to authenticated with check (maps_private.ws_project(map_id));
create policy preview_update on public.project_previews for update to authenticated using (maps_private.ws_project(map_id)) with check (maps_private.ws_project(map_id));
create policy preview_delete on public.project_previews for delete to authenticated using (maps_private.ws_project(map_id));
comment on table public.project_previews is 'Small editor project thumbnails, separate from published map data and draft revisions.';
