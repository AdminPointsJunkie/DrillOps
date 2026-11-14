-- A project's canonical owner retains full membership and future billing responsibility.
-- Existing owners are already consistent; fail rather than silently reassign anyone.
do $$ begin
 if exists(select 1 from public.workspaces w where w.owner_id is null or not exists(
  select 1 from public.workspace_members m where m.workspace_id=w.id and m.user_id=w.owner_id and m.role='owner' and m.status='active'))
 or exists(select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.role='owner' and m.user_id<>w.owner_id)
 then raise exception 'Review project ownership before applying this migration';end if;
end $$;
alter table public.workspaces alter column owner_id set not null;
create unique index workspace_single_owner on public.workspace_members(workspace_id) where role='owner';

create function maps_private.check_project_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid;owner_user uuid;begin
 if tg_table_name='workspaces' then w:=new.id;
 else w:=case when tg_op='DELETE' then old.workspace_id else new.workspace_id end;end if;
 select owner_id into owner_user from public.workspaces where id=w for update;
 if not found then return null;end if; -- Whole-project deletion may cascade memberships.
 if not exists(select 1 from public.workspace_members where workspace_id=w and user_id=owner_user and role='owner' and status='active')
 or exists(select 1 from public.workspace_members where workspace_id=w and role='owner' and user_id<>owner_user)
 then raise exception 'A project must keep its active owner. Invite an admin to share project management.' using errcode='23514';end if;
 if tg_table_name='workspace_members' then
  if tg_op='UPDATE' and old.workspace_id<>new.workspace_id
  and exists(select 1 from public.workspaces p where p.id=old.workspace_id and not exists(select 1 from public.workspace_members m where m.workspace_id=p.id and m.user_id=p.owner_id and m.role='owner' and m.status='active'))
  then raise exception 'The previous project must keep its active owner' using errcode='23514';end if;
 end if;
 return null;
end $$;
revoke all on function maps_private.check_project_owner() from public,anon,authenticated;
create constraint trigger project_owner_required after insert or update of owner_id on public.workspaces deferrable initially deferred for each row execute function maps_private.check_project_owner();
create constraint trigger project_owner_membership after insert or update or delete on public.workspace_members deferrable initially deferred for each row execute function maps_private.check_project_owner();

create function maps_private.prevent_owner_invite() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.role='owner' and new.status='pending' then raise exception 'A project has one owner. Invite an admin to share project management.' using errcode='23514';end if;
 return new;
end $$;
revoke all on function maps_private.prevent_owner_invite() from public,anon,authenticated;
create trigger project_invite_role before insert or update on public.workspace_invitations for each row execute function maps_private.prevent_owner_invite();

-- No account ID parameter: callers can only report their own owned projects.
create function maps_private.account_usage() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare projects jsonb:='[]';w record;usage jsonb;uploads numeric:=0;stored numeric:=0;vectors numeric:=0;files bigint:=0;maps bigint:=0;meter jsonb;begin
 if not maps_private.drillops_has_app('fieldmaps') then raise exception 'Sign in with an active FieldMaps account' using errcode='42501';end if;
 for w in select p.id,p.name,(select count(*) from public.maps m where m.workspace_id=p.id) map_count
 from public.workspaces p where p.owner_id=auth.uid() and maps_private.ws_role(p.id)='owner' order by p.name loop
  usage:=maps_private.workspace_usage(w.id);
  projects:=projects||jsonb_build_array(jsonb_build_object('id',w.id,'name',w.name,'map_count',w.map_count,'usage',usage));
  uploads:=uploads+coalesce((usage->>'upload_bytes')::numeric,0);stored:=stored+coalesce((usage->>'file_bytes')::numeric,0);
  vectors:=vectors+coalesce((usage->>'vector_bytes')::numeric,0);files:=files+coalesce((usage->>'file_count')::bigint,0);maps:=maps+w.map_count;
 end loop;
 meter:=maps_private.upload_month(null);
 return jsonb_build_object('account_id',auth.uid(),'projects',projects,'map_count',maps,'upload_bytes',uploads,'file_bytes',stored,'vector_bytes',vectors,'file_count',files,'generated_at',now())
 ||(meter-'upload_bytes');
end $$;
create function public.account_usage() returns jsonb language sql security invoker set search_path='' as $$select maps_private.account_usage()$$;
revoke all on function maps_private.account_usage(),public.account_usage() from public,anon,authenticated;
grant execute on function maps_private.account_usage(),public.account_usage() to authenticated;
