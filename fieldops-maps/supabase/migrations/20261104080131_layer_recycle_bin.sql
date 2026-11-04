-- Removed layers leave the active tables atomically. Old clients and SYNC cannot revive them.
create table maps_private.layer_trash (
 id uuid primary key, map_id uuid not null references public.maps(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id),
 layer_data jsonb not null, feature_data jsonb not null default '[]',
 deleted_at timestamptz not null default now(), deleted_by uuid references auth.users(id) on delete set null,
 expires_at timestamptz not null default now()+interval '30 days'
);
create index layer_trash_workspace on maps_private.layer_trash(workspace_id,deleted_at);
create index layer_trash_project on maps_private.layer_trash(map_id);
create index layer_trash_expiry on maps_private.layer_trash(expires_at);
alter table maps_private.layer_trash enable row level security;
revoke all on maps_private.layer_trash from public,anon,authenticated;

create function maps_private.layer_bin(p_workspace uuid,p_action text,p_layer uuid default null,p_target uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.layers;t maps_private.layer_trash;m public.maps;destination public.maps;result jsonb;
begin
 if auth.uid() is null or coalesce(maps_private.ws_role(p_workspace),'') not in ('owner','admin','editor') then raise exception 'Workspace editing access required' using errcode='42501';end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.layer_data->>'name','map_id',b.map_id,'project',p.name,'deleted_at',b.deleted_at,'expires_at',b.expires_at,'can_change',not (b.layer_data->'metadata' ? 'annotation') or maps_private.ws_manage(p_workspace)) order by b.deleted_at desc),'[]') into result
  from maps_private.layer_trash b join public.maps p on p.id=b.map_id
  where b.workspace_id=p_workspace and b.expires_at>now() and maps_private.ws_project(b.map_id);
  return result;
 elsif p_action='empty' then
  if not maps_private.ws_manage(p_workspace) then raise exception 'Workspace admin required to empty the basket' using errcode='42501';end if;
  delete from maps_private.layer_trash where workspace_id=p_workspace;return '{}'::jsonb;
 elsif p_action='trash' then
  select * into l from public.layers where id=p_layer;
  if not found or not maps_private.ws_project(l.map_id) then raise exception 'Layer not found or access denied' using errcode='42501';end if;
  select * into m from public.maps where id=l.map_id and workspace_id=p_workspace for update;
  if not found then raise exception 'Project not in this workspace';end if;
  select * into l from public.layers where id=p_layer for update;
  if not found then raise exception 'Layer already removed. Refresh the project.';end if;
  if l.metadata ? 'annotation' and not maps_private.ws_manage(p_workspace) then raise exception 'Workspace admin required for annotations' using errcode='42501';end if;
  insert into maps_private.layer_trash(id,map_id,workspace_id,layer_data,feature_data,deleted_by)
  values(l.id,l.map_id,p_workspace,to_jsonb(l),coalesce((select jsonb_agg(to_jsonb(f)) from public.features f where layer_id=l.id),'[]'),auth.uid());
  delete from public.layers where id=l.id;
  update public.maps set layer_layout=coalesce((select jsonb_agg(case when jsonb_typeof(n)='object' then jsonb_set(n,'{children}',coalesce((select jsonb_agg(c) from jsonb_array_elements(coalesce(n->'children','[]')) c where c<>to_jsonb(l.id::text)),'[]')) else n end) from jsonb_array_elements(layer_layout) n where n<>to_jsonb(l.id::text)),'[]') where id=m.id;
  return jsonb_build_object('id',l.id,'map_id',m.id);
 elsif p_action in ('restore','purge') then
  -- Lock projects before the archive row, matching publication and removal lock ordering.
  select * into t from maps_private.layer_trash where id=p_layer and workspace_id=p_workspace;
  if not found or not maps_private.ws_project(t.map_id) then raise exception 'Deleted layer not found or access denied' using errcode='42501';end if;
  perform id from public.maps where id in (t.map_id,coalesce(p_target,t.map_id)) order by id for update;
  select * into t from maps_private.layer_trash where id=p_layer and workspace_id=p_workspace for update;
  if not found then raise exception 'This item has already been restored or deleted';end if;
  if t.layer_data->'metadata' ? 'annotation' and not maps_private.ws_manage(p_workspace) then raise exception 'Workspace admin required for annotations' using errcode='42501';end if;
  if p_action='purge' then delete from maps_private.layer_trash where id=t.id;return jsonb_build_object('id',t.id);end if;
  if t.expires_at<=now() then raise exception 'The 30-day restore period has expired';end if;
  select * into destination from public.maps where id=coalesce(p_target,t.map_id) and workspace_id=p_workspace;
  if not found or not maps_private.ws_project(destination.id) then raise exception 'Destination project access required' using errcode='42501';end if;
  insert into public.layers select (jsonb_populate_record(null::public.layers,t.layer_data||jsonb_build_object('map_id',destination.id))).*;
  insert into public.features(id,layer_id,geometry,properties) overriding system value
  select f.id,f.layer_id,f.geometry,f.properties from jsonb_populate_recordset(null::public.features,t.feature_data) f;
  update public.maps set layer_layout=layer_layout||jsonb_build_array(t.id::text) where id=destination.id;
  delete from maps_private.layer_trash where id=t.id;
  return jsonb_build_object('id',t.id,'map_id',destination.id);
 else raise exception 'Unknown basket action';end if;
end $$;
create function public.maps_layer_bin(p_workspace uuid,p_action text,p_layer uuid default null,p_target uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select maps_private.layer_bin(p_workspace,p_action,p_layer,p_target); $$;
revoke all on function maps_private.layer_bin(uuid,text,uuid,uuid),public.maps_layer_bin(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function maps_private.layer_bin(uuid,text,uuid,uuid),public.maps_layer_bin(uuid,text,uuid,uuid) to authenticated;

create or replace function maps_private.guard_annotation_write() returns trigger language plpgsql security invoker set search_path='' as $$
declare protected boolean:=false; p uuid;w uuid;begin
 if tg_table_name='layers' then
  if tg_op<>'INSERT' then protected:=coalesce(old.metadata ? 'annotation',false);p:=old.map_id;end if;
  if tg_op<>'DELETE' then protected:=protected or coalesce(new.metadata ? 'annotation',false);p:=new.map_id;end if;
 else
  select map_id,metadata ? 'annotation' into p,protected from public.layers where id=case when tg_op='DELETE' then old.layer_id else new.layer_id end;
 end if;
 -- A missing parent during DELETE is a foreign-key cascade from an already-authorized project deletion.
 if tg_op='DELETE' and p is not null and not exists(select 1 from public.maps where id=p) then return old;end if;
 select workspace_id into w from public.maps where id=p;
 if protected and not maps_private.ws_manage(w) then raise exception 'Only workspace admins can change annotations' using errcode='42501';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;

-- Only the database scheduler/owner may run expiry. Features are inside each archive row.
create function maps_private.purge_expired_layers() returns bigint language plpgsql security invoker set search_path='' as $$
declare count_deleted bigint;begin delete from maps_private.layer_trash where expires_at<=now();get diagnostics count_deleted=row_count;return count_deleted;end $$;
revoke all on function maps_private.purge_expired_layers() from public,anon,authenticated;
create extension if not exists pg_cron;
select cron.schedule('fieldmaps-expire-deleted-layers','17 * * * *','select maps_private.purge_expired_layers()');
