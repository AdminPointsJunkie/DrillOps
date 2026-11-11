-- Library entries are explicit snapshots, with project or personal access.
alter table public.workspace_layer_library add column visibility text not null default 'project' check(visibility in ('project','private'));
alter table public.workspaces add column library_default_visibility text not null default 'project' check(library_default_visibility in ('project','private'));
create table public.library_layer_shares (
 layer_id uuid not null references public.workspace_layer_library(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(layer_id,user_id)
);
create index library_shares_recipient on public.library_layer_shares(user_id,layer_id);
alter table public.library_layer_shares enable row level security;
revoke all on public.library_layer_shares from public,anon,authenticated;
grant select on public.library_layer_shares to authenticated;
create policy own_library_shares on public.library_layer_shares for select to authenticated using(user_id=(select auth.uid()));
-- Definer lookup avoids recursive RLS and keeps grants and account status authoritative.
create function maps_private.library_access(p uuid,manage boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select maps_private.drillops_has_app('fieldmaps') and exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) and exists(
 select 1 from public.workspace_layer_library l where l.id=p and (
 l.created_by=auth.uid() or (l.visibility='project' and case when manage then maps_private.ws_manage(l.workspace_id) else maps_private.ws_role(l.workspace_id) is not null end)
 or (not manage and not l.archived and exists(select 1 from public.library_layer_shares s where s.layer_id=l.id and s.user_id=auth.uid()))));
$$;
revoke all on function maps_private.library_access(uuid,boolean) from public,anon;
grant execute on function maps_private.library_access(uuid,boolean) to authenticated;
drop policy library_read on public.workspace_layer_library;
drop policy library_save on public.workspace_layer_library;
drop policy library_manage on public.workspace_layer_library;
create policy library_read on public.workspace_layer_library for select to authenticated using(maps_private.library_access(id) and (not archived or maps_private.library_access(id,true)));
create function maps_private.library_asset_owned(path text) returns boolean language sql stable security definer set search_path='' as $$
 select path is null or exists(select 1 from storage.objects o where o.bucket_id='layer-library' and o.name=path and o.owner_id=auth.uid()::text);
$$;
revoke all on function maps_private.library_asset_owned(text) from public,anon;
grant execute on function maps_private.library_asset_owned(text) to authenticated;
create policy library_save on public.workspace_layer_library for insert to authenticated with check(maps_private.library_asset_owned(asset_path) and created_by=auth.uid() and maps_private.ws_role(workspace_id) in ('owner','admin','editor'));
create policy library_manage on public.workspace_layer_library for update to authenticated using(maps_private.library_access(id,true)) with check(maps_private.library_access(id,true));
-- Snapshot ownership, source and visibility cannot be reassigned by an update.
revoke update on public.workspace_layer_library from authenticated;
grant update(archived) on public.workspace_layer_library to authenticated;
-- Qualify object names: unqualified names can bind to inner tables instead.
drop policy library_asset_read on storage.objects;
drop policy library_asset_write on storage.objects;
drop policy library_asset_cleanup on storage.objects;
create policy library_asset_read on storage.objects for select to authenticated using(bucket_id='layer-library' and exists(select 1 from public.workspace_layer_library l where l.asset_path=objects.name));
create policy library_asset_write on storage.objects for insert to authenticated with check(bucket_id='layer-library' and owner_id=auth.uid()::text and exists(select 1 from public.workspaces w where w.id::text=split_part(objects.name,'/',1) and maps_private.ws_role(w.id) in ('owner','admin','editor')));
create policy library_asset_cleanup on storage.objects for delete to authenticated using(bucket_id='layer-library' and owner_id=auth.uid()::text and exists(select 1 from public.workspaces w where w.id::text=split_part(objects.name,'/',1) and maps_private.ws_role(w.id) in ('owner','admin','editor')) and not exists(select 1 from public.workspace_layer_library l where l.asset_path=objects.name));
create function maps_private.library_share_access(p_layer uuid,p_action text,p_email text default null,p_recipient uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r uuid;result jsonb;begin
 if not coalesce(maps_private.library_access(p_layer,true),false) then raise exception 'Only the layer owner or project admin can manage sharing' using errcode='42501';end if;
 if p_action='grant' then
  if exists(select 1 from public.workspace_layer_library where id=p_layer and archived) then raise exception 'Restore the layer before sharing';end if;
  select id into r from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null and (banned_until is null or banned_until<=now()) and deleted_at is null and not coalesce(is_anonymous,false);
  if r is null then raise exception 'No verified account with that email';end if;
  insert into public.library_layer_shares(layer_id,user_id) values(p_layer,r) on conflict do nothing;
 elsif p_action='revoke' then delete from public.library_layer_shares where layer_id=p_layer and user_id=p_recipient;
 elsif p_action<>'list' then raise exception 'Unknown sharing action';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email) order by u.email),'[]') into result from public.library_layer_shares s join auth.users u on u.id=s.user_id where s.layer_id=p_layer;
 return result;
end $$;
create function public.library_share_access(p_layer uuid,p_action text,p_email text default null,p_recipient uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select maps_private.library_share_access(p_layer,p_action,p_email,p_recipient); $$;
create function maps_private.set_library_default(p_workspace uuid,p_visibility text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(maps_private.ws_manage(p_workspace),false) then raise exception 'Project admin access required' using errcode='42501';end if;
 if p_visibility not in ('project','private') or p_visibility is null then raise exception 'Choose a library access option';end if;
 update public.workspaces set library_default_visibility=p_visibility where id=p_workspace;
end $$;
create function public.set_library_default(p_workspace uuid,p_visibility text) returns void language sql security invoker set search_path='' as $$ select maps_private.set_library_default(p_workspace,p_visibility); $$;
revoke all on function maps_private.library_share_access(uuid,text,text,uuid),public.library_share_access(uuid,text,text,uuid),maps_private.set_library_default(uuid,text),public.set_library_default(uuid,text) from public,anon;
grant execute on function maps_private.library_share_access(uuid,text,text,uuid),public.library_share_access(uuid,text,text,uuid),maps_private.set_library_default(uuid,text),public.set_library_default(uuid,text) to authenticated;
