-- Existing workspaces become projects without moving maps or their stored files.
-- A personal workspace is private to its profile; shared projects remain in place.
create table public.personal_workspaces (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.personal_workspaces enable row level security;
revoke all on public.personal_workspaces from public, anon, authenticated;
grant select on public.personal_workspaces to authenticated;
create policy own_workspace on public.personal_workspaces for select to authenticated using(user_id=(select auth.uid()));
insert into public.personal_workspaces(user_id) select id from auth.users;
create function maps_private.personal_workspace_created() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.personal_workspaces(user_id) values(new.id) on conflict do nothing;return new;end $$;
revoke all on function maps_private.personal_workspace_created() from public,anon,authenticated;
create trigger personal_workspace_created after insert on auth.users for each row execute function maps_private.personal_workspace_created();
alter table public.workspaces add column owner_id uuid default auth.uid() references auth.users(id) on delete restrict;
update public.workspaces w set owner_id=(select m.user_id from public.workspace_members m where m.workspace_id=w.id and m.role='owner' order by m.created_at,m.user_id limit 1);
create index workspaces_owner on public.workspaces(owner_id);
create table public.map_shares (
 map_id uuid not null references public.maps(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),primary key(map_id,user_id)
);
create index map_shares_creator on public.map_shares(created_by);
create index map_shares_user on public.map_shares(user_id,map_id);
alter table public.map_shares enable row level security;
revoke all on public.map_shares from public,anon,authenticated;
create policy shares_via_checked_functions on public.map_shares for all to authenticated using(false) with check(false);
-- All writes go through the checked sharing function.
create function maps_private.map_shared(p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select maps_private.drillops_has_app('fieldmaps') and exists(
 select 1 from public.map_shares s join public.maps m on m.id=s.map_id join public.workspaces w on w.id=m.workspace_id join auth.users u on u.id=s.user_id
 where s.map_id=p and s.user_id=auth.uid() and w.status='active' and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
 -- A suspended project membership overrides an individual map grant.
 and not exists(select 1 from public.workspace_members wm where wm.workspace_id=w.id and wm.user_id=u.id and wm.status='suspended'));
$$;
create or replace function maps_private.ws_project(p uuid,published boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce((select
 maps_private.ws_role(m.workspace_id) in ('owner','admin','editor')
 or (published and (maps_private.ws_role(m.workspace_id)='operator' or maps_private.map_shared(m.id)))
 from public.maps m where m.id=p),false);
$$;
-- Preserve the context contract for existing clients, adding the private workspace.
create or replace function maps_private.ws_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 return jsonb_build_object('personal_workspace',jsonb_build_object('user_id',auth.uid(),'name','My workspace'),
 'platform_admin',maps_private.ws_platform(),'workspaces',coalesce((select jsonb_agg(jsonb_build_object(
 'id',w.id,'name',w.name,'status',w.status,'owner_id',w.owner_id,
 'share_count',case when maps_private.ws_manage(w.id) then (select count(distinct grants.user_id) from (
 select wm.user_id from public.workspace_members wm where wm.workspace_id=w.id and wm.status='active'
 union select ms.user_id from public.map_shares ms join public.maps m on m.id=ms.map_id where m.workspace_id=w.id
 and not exists(select 1 from public.workspace_members wm where wm.workspace_id=w.id and wm.user_id=ms.user_id and wm.status='suspended')
 ) grants join auth.users u on u.id=grants.user_id where grants.user_id is distinct from w.owner_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) else null end,
 'public_link_count',case when maps_private.ws_manage(w.id) then (select count(*) from public.map_view_links ml join public.maps m on m.id=ml.map_id where m.workspace_id=w.id and ml.enabled) else null end,
 'preview_map_id',(select m.id from public.maps m join public.project_previews pp on pp.map_id=m.id where m.workspace_id=w.id and maps_private.ws_project(m.id) order by pp.updated_at desc limit 1),
 'role',coalesce(maps_private.ws_role(w.id),'map_viewer'),
 'access',case when w.owner_id=auth.uid() then 'owned' when maps_private.ws_role(w.id) is not null then 'project' else 'map' end) order by w.name)
 from public.workspaces w where exists(select 1 from public.workspace_members wm where wm.workspace_id=w.id and wm.user_id=auth.uid() and maps_private.ws_role(w.id) is not null)
 or exists(select 1 from public.maps m where m.workspace_id=w.id and maps_private.map_shared(m.id))),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'workspace',w.name,'role',i.role,'expires_at',i.expires_at)) from public.workspace_invitations i join public.workspaces w on w.id=i.workspace_id join auth.users u on lower(u.email)=i.email where u.id=auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and i.status='pending' and i.expires_at>now() and i.delivery='sent' and w.status='active'),'[]'::jsonb));
end $$;
create function maps_private.create_personal_project(project_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if not maps_private.drillops_has_app('fieldmaps') or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'Sign in with a verified FieldMaps account' using errcode='42501';end if;
 if project_name is null or length(trim(project_name)) not between 1 and 120 then raise exception 'Enter a project name';end if;
 insert into public.workspaces(name,owner_id) values(trim(project_name),auth.uid()) returning id into w;
 insert into public.workspace_members(workspace_id,user_id,role,display_name) select w,id,'owner',coalesce(raw_user_meta_data->>'full_name','') from auth.users where id=auth.uid();
 return w;
end $$;
create function public.create_personal_project(p_name text) returns uuid language sql security invoker set search_path='' as $$ select maps_private.create_personal_project(p_name); $$;
-- Exact-email sharing to registered accounts. No notification is sent automatically.
create function maps_private.share_access(kind text,target uuid,action text,email text default null,recipient uuid default null,access_role text default 'operator') returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; r uuid; result jsonb;begin
 perform pg_advisory_xact_lock(76283942);
 if kind='map' then select workspace_id into w from public.maps where id=target;
 elsif kind='project' then w:=target;
 else raise exception 'Unknown sharing type';end if;
 if not coalesce(maps_private.ws_manage(w),false) and not (kind='map' and maps_private.ws_project(target) and exists(select 1 from public.maps where id=target and owner_id=auth.uid())) then raise exception 'Only the owner or project admin can manage sharing' using errcode='42501';end if;
 if action='grant' then
  select id into r from auth.users u where lower(u.email)=lower(trim(share_access.email)) and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now());
  if r is null then raise exception 'No verified account with that email. Use a viewing link for someone without an account.';end if;
  if kind='map' then insert into public.map_shares(map_id,user_id,created_by) values(target,r,auth.uid()) on conflict do nothing;
  else
   if access_role not in ('operator','editor') then raise exception 'Choose view or edit access';end if;
   if exists(select 1 from public.workspace_members where workspace_id=w and user_id=r and role in ('owner','admin')) then raise exception 'Manage this person in project settings';end if;
   insert into public.workspace_members(workspace_id,user_id,role,display_name) select w,r,access_role,coalesce(raw_user_meta_data->>'full_name','') from auth.users where id=r
   on conflict(workspace_id,user_id) do update set role=excluded.role,status='active';
  end if;
 elsif action='revoke' then
  if kind='map' then delete from public.map_shares where map_id=target and user_id=recipient;
  else
   if recipient=auth.uid() or exists(select 1 from public.workspace_members where workspace_id=w and user_id=recipient and role in ('owner','admin')) then raise exception 'Manage this person in project settings';end if;
   delete from public.project_members pm using public.maps m where pm.map_id=m.id and m.workspace_id=w and pm.user_id=recipient;
   delete from public.workspace_members where workspace_id=w and user_id=recipient;
  end if;
 elsif action<>'list' then raise exception 'Unknown sharing action';end if;
 if kind='map' then select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'role','operator') order by u.email),'[]') into result from public.map_shares s join auth.users u on u.id=s.user_id where s.map_id=target;
 else select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'role',s.role,'status',s.status) order by u.email),'[]') into result from public.workspace_members s join auth.users u on u.id=s.user_id where s.workspace_id=w;end if;
 if action<>'list' then insert into public.workspace_events(workspace_id,actor_id,action,detail) values(w,auth.uid(),kind||'.share.'||action,jsonb_build_object('target',target,'user_id',coalesce(r,recipient)));end if;
 return result;
end $$;
create function public.share_access(p_kind text,p_target uuid,p_action text,p_email text default null,p_recipient uuid default null,p_role text default 'operator') returns jsonb language sql security invoker set search_path='' as $$ select maps_private.share_access(p_kind,p_target,p_action,p_email,p_recipient,p_role); $$;
revoke all on function maps_private.map_shared(uuid),maps_private.create_personal_project(text),public.create_personal_project(text),maps_private.share_access(text,uuid,text,text,uuid,text),public.share_access(text,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function maps_private.map_shared(uuid),maps_private.create_personal_project(text),public.create_personal_project(text),maps_private.share_access(text,uuid,text,text,uuid,text),public.share_access(text,uuid,text,text,uuid,text) to authenticated;
