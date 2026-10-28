-- Company isolation is enforced using live memberships, never user-editable JWT claims.
create table maps_private.platform_admins(user_id uuid primary key references auth.users(id) on delete restrict);
alter table maps_private.platform_admins enable row level security;
revoke all on maps_private.platform_admins from public,anon,authenticated;
create table public.workspaces(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 120),status text not null default 'active' check(status in ('active','suspended')),created_at timestamptz not null default now());
create table public.workspace_members(workspace_id uuid not null references public.workspaces(id) on delete restrict,user_id uuid not null references auth.users(id) on delete cascade,role text not null check(role in ('owner','admin','editor','operator')),status text not null default 'active' check(status in ('active','suspended')),display_name text not null default '',created_at timestamptz not null default now(),primary key(workspace_id,user_id));
create index workspace_members_user on public.workspace_members(user_id,workspace_id);
create table public.workspace_invitations(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),email text not null,name text not null default '',role text not null check(role in ('owner','admin','editor','operator')),projects uuid[] not null default '{}',status text not null default 'pending' check(status in ('pending','accepted','revoked')),expires_at timestamptz not null default now()+interval '7 days',created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),last_sent_at timestamptz,attempt_at timestamptz,attempt_id uuid,delivery text not null default 'not_sent',accepted_by uuid references auth.users(id));
create unique index workspace_invitation_pending on public.workspace_invitations(workspace_id,lower(email)) where status='pending';
create table public.workspace_events(id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),actor_id uuid references auth.users(id),action text not null,detail jsonb not null default '{}',created_at timestamptz not null default now());
create index workspace_events_recent on public.workspace_events(workspace_id,created_at desc);
alter table public.maps add column workspace_id uuid references public.workspaces(id);
-- All existing users shared the same administrative domain. Preserve it as DrillOps.
do $$ declare w uuid; john uuid; begin
 select id into strict john from auth.users where lower(email)='oleary.john@icloud.com';
 insert into maps_private.platform_admins values(john);
 insert into public.workspaces(name) values('DrillOps') returning id into w;
 insert into public.workspace_members(workspace_id,user_id,role,status,display_name)
 select w,id,case when id=john then 'owner' when raw_app_meta_data->>'maps_role'='admin' then 'admin' when raw_app_meta_data->>'maps_role'='editor' then 'editor' else 'operator' end,case when coalesce(raw_app_meta_data->>'maps_role','pending') in ('pending','suspended') then 'suspended' else 'active' end,coalesce(raw_user_meta_data->>'full_name','') from auth.users;
 update public.maps set workspace_id=w;
 insert into public.workspace_events(workspace_id,actor_id,action,detail) values(w,john,'workspace.migrated',jsonb_build_object('name','DrillOps'));
end $$;
alter table public.maps alter column workspace_id set not null;
create index maps_workspace on public.maps(workspace_id);
create table public.project_members(map_id uuid not null references public.maps(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,primary key(map_id,user_id));
create index project_members_user on public.project_members(user_id,map_id);
insert into public.project_members select map_id,user_id from public.map_operators on conflict do nothing;

create function maps_private.ws_platform() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and exists(select 1 from maps_private.platform_admins p join auth.users u on u.id=p.user_id where p.user_id=auth.uid() and (u.banned_until is null or u.banned_until<=now())); $$;
create function maps_private.ws_role(w uuid) returns text language sql stable security definer set search_path='' as $$ select case when maps_private.ws_platform() then 'owner' else (select m.role from public.workspace_members m join public.workspaces c on c.id=m.workspace_id join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and c.status='active' and (u.banned_until is null or u.banned_until<=now())) end; $$;
create function maps_private.ws_manage(w uuid) returns boolean language sql stable security invoker set search_path='' as $$ select coalesce(maps_private.ws_role(w) in ('owner','admin'),false); $$;
create function maps_private.ws_project(p uuid,published boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce((select case when maps_private.ws_manage(m.workspace_id) then true when maps_private.ws_role(m.workspace_id)='editor' then m.owner_id=auth.uid() or exists(select 1 from public.project_members a where a.map_id=m.id and a.user_id=auth.uid()) when published and maps_private.ws_role(m.workspace_id)='operator' then exists(select 1 from public.project_members a where a.map_id=m.id and a.user_id=auth.uid()) else false end from public.maps m where m.id=p),false);
$$;
create function maps_private.ws_default() returns uuid language sql stable security definer set search_path='' as $$ select case when count(*)=1 then min(id::text)::uuid end from public.workspaces where auth.uid() is not null and maps_private.ws_role(id) in ('owner','admin','editor'); $$;
alter table public.maps alter column workspace_id set default maps_private.ws_default();
create or replace function maps_private.current_role() returns text language sql stable security definer set search_path='' as $$ select case when maps_private.ws_platform() then 'admin' when exists(select 1 from public.workspaces where maps_private.ws_manage(id)) then 'admin' when exists(select 1 from public.workspaces where maps_private.ws_role(id)='editor') then 'editor' when exists(select 1 from public.workspaces where maps_private.ws_role(id)='operator') then 'operator' else 'pending' end; $$;
create or replace function public.maps_admin() returns boolean language sql stable security invoker set search_path='' as $$ select maps_private.ws_platform(); $$;
-- Disable legacy global-account mutation endpoints, including direct private-schema calls.
revoke all on function public.maps_accounts(),public.maps_update_account(uuid,text,text,uuid[]),maps_private.accounts(),maps_private.update_account(uuid,text,text,uuid[]) from public,anon,authenticated;

-- Remove the previous globally-scoped rules before adding company-scoped rules.
do $$ declare p record; begin
 for p in select * from pg_policies where schemaname='public' and tablename in ('maps','layers','features','map_operators','map_releases') loop execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);end loop;
 for p in select * from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('gis_owner','gis_admin_access','operator_raster_read','operator_no_upload','operator_no_file_update','operator_no_file_delete','active_account_files') loop execute format('drop policy %I on storage.objects',p.policyname);end loop;
end $$;
revoke all on public.maps,public.layers,public.features,public.map_operators,public.map_releases,public.workspaces,public.workspace_members,public.workspace_invitations,public.project_members,public.workspace_events from anon,authenticated;
grant select,insert,update,delete on public.maps,public.layers,public.features to authenticated;
grant select,insert on public.map_releases to authenticated;
grant select on public.workspaces,public.workspace_members,public.workspace_invitations,public.project_members,public.workspace_events to authenticated;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.project_members enable row level security;
alter table public.workspace_events enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(maps_private.ws_role(id) is not null);
create policy members_read on public.workspace_members for select to authenticated using(maps_private.ws_manage(workspace_id) or (user_id=auth.uid() and maps_private.ws_role(workspace_id) is not null));
create policy invitations_read on public.workspace_invitations for select to authenticated using(maps_private.ws_manage(workspace_id));
create policy project_members_read on public.project_members for select to authenticated using(maps_private.ws_project(map_id) or (user_id=auth.uid() and maps_private.ws_project(map_id,true)));
create policy events_read on public.workspace_events for select to authenticated using(maps_private.ws_manage(workspace_id));
create policy maps_read on public.maps for select to authenticated using(maps_private.ws_project(id));
create policy maps_create on public.maps for insert to authenticated with check(owner_id=auth.uid() and maps_private.ws_role(workspace_id) in ('owner','admin','editor'));
create policy maps_change on public.maps for update to authenticated using(maps_private.ws_project(id)) with check(maps_private.ws_project(id));
create policy maps_remove on public.maps for delete to authenticated using(maps_private.ws_manage(workspace_id));
create policy layers_access on public.layers for all to authenticated using(maps_private.ws_project(map_id)) with check(maps_private.ws_project(map_id));
create policy features_access on public.features for all to authenticated using(exists(select 1 from public.layers l where l.id=layer_id)) with check(exists(select 1 from public.layers l where l.id=layer_id));
create policy release_read on public.map_releases for select to authenticated using(maps_private.ws_project(map_id,true));
create policy release_create on public.map_releases for insert to authenticated with check(published_by=auth.uid() and maps_private.ws_project(map_id));

create function maps_private.ws_file(path text,writing boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return false;end if;
 if exists(select 1 from public.map_releases where raster_paths @> array[path]) then
  if writing then return false;end if;
  return exists(select 1 from public.map_releases r where r.raster_paths @> array[path] and maps_private.ws_project(r.map_id,true));
 end if;
 if exists(select 1 from public.layers where raster_path=path or original_paths ? path) then
  if writing then return not exists(select 1 from public.layers l where (l.raster_path=path or l.original_paths ? path) and not maps_private.ws_project(l.map_id));end if;
  return exists(select 1 from public.layers l where (l.raster_path=path or l.original_paths ? path) and maps_private.ws_project(l.map_id));
 end if;
 return split_part(path,'/',1)=auth.uid()::text and (maps_private.ws_platform() or exists(select 1 from public.workspaces where maps_private.ws_role(id) in ('owner','admin','editor')));
end $$;
create policy gis_file_read on storage.objects for select to authenticated using(bucket_id='gis-files' and maps_private.ws_file(name));
create policy gis_file_insert on storage.objects for insert to authenticated with check(bucket_id='gis-files' and split_part(name,'/',1)=auth.uid()::text and maps_private.ws_file(name,true));
create policy gis_file_update on storage.objects for update to authenticated using(bucket_id='gis-files' and maps_private.ws_file(name,true)) with check(bucket_id='gis-files' and maps_private.ws_file(name,true));
create policy gis_file_delete on storage.objects for delete to authenticated using(bucket_id='gis-files' and maps_private.ws_file(name,true));
create function maps_private.ws_path_allowed(path text,w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and maps_private.ws_file(path) and not exists(select 1 from public.layers l join public.maps m on m.id=l.map_id where (l.raster_path=path or l.original_paths ? path) and m.workspace_id<>w) and not exists(select 1 from public.map_releases r join public.maps m on m.id=r.map_id where r.raster_paths @> array[path] and m.workspace_id<>w);
$$;
create function maps_private.ws_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare w uuid; path text;begin
 if tg_table_name='maps' then
  if tg_op='UPDATE' and (new.workspace_id is distinct from old.workspace_id or new.owner_id is distinct from old.owner_id) then raise exception 'Project company and creator cannot be reassigned here' using errcode='42501';end if;
 elsif tg_table_name='features' then
  if tg_op='UPDATE' and new.layer_id<>old.layer_id then raise exception 'Feature layer cannot be reassigned' using errcode='42501';end if;
 elsif tg_table_name='layers' then
  if tg_op='UPDATE' and new.map_id<>old.map_id then raise exception 'Layer project cannot be reassigned' using errcode='42501';end if;
  select workspace_id into w from public.maps where id=new.map_id;
  if tg_op='INSERT' or new.raster_path is distinct from old.raster_path or new.original_paths is distinct from old.original_paths then
   for path in select jsonb_array_elements_text(coalesce(new.original_paths,'[]')) union select new.raster_path where new.raster_path is not null loop
    if not maps_private.ws_path_allowed(path,w) then raise exception 'File is not available to this workspace' using errcode='42501';end if;
   end loop;
  end if;
 elsif tg_table_name='map_releases' then
  select workspace_id into w from public.maps where id=new.map_id;
  foreach path in array new.raster_paths loop if not maps_private.ws_path_allowed(path,w) then raise exception 'Snapshot file is not available to this workspace' using errcode='42501';end if;end loop;
 end if;return new;
end $$;
create trigger workspace_map_guard before update on public.maps for each row execute function maps_private.ws_guard();
create trigger workspace_layer_guard before insert or update on public.layers for each row execute function maps_private.ws_guard();
create trigger workspace_feature_guard before update on public.features for each row execute function maps_private.ws_guard();
create trigger workspace_release_guard before insert on public.map_releases for each row execute function maps_private.ws_guard();
create or replace function maps_private.guard_annotation_write() returns trigger language plpgsql security invoker set search_path='' as $$
declare protected boolean:=false; p uuid;w uuid;begin
 if tg_table_name='layers' then
  if tg_op<>'INSERT' then protected:=coalesce(old.metadata ? 'annotation',false);p:=old.map_id;end if;
  if tg_op<>'DELETE' then protected:=protected or coalesce(new.metadata ? 'annotation',false);p:=new.map_id;end if;
 else
  select map_id,metadata ? 'annotation' into p,protected from public.layers where id=case when tg_op='DELETE' then old.layer_id else new.layer_id end;
 end if;
 select workspace_id into w from public.maps where id=p;
 if protected and not maps_private.ws_manage(w) then raise exception 'Only workspace admins can change annotations' using errcode='42501';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;

create function maps_private.ws_context() returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 return jsonb_build_object('platform_admin',maps_private.ws_platform(),'workspaces',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'role',maps_private.ws_role(id)) order by name) from public.workspaces where maps_private.ws_role(id) is not null),'[]'::jsonb),'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'workspace',w.name,'role',i.role,'expires_at',i.expires_at)) from public.workspace_invitations i join public.workspaces w on w.id=i.workspace_id join auth.users u on lower(u.email)=i.email where u.id=auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and i.status='pending' and i.expires_at>now() and i.delivery='sent' and w.status='active'),'[]'::jsonb));
end $$;
create function maps_private.ws_settings(w uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if not maps_private.ws_manage(w) then raise exception 'Workspace admin access required' using errcode='42501';end if;
 return jsonb_build_object('workspace',(select to_jsonb(c) from public.workspaces c where id=w),'role',maps_private.ws_role(w),'platform_admin',maps_private.ws_platform(),'people',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'email',u.email,'name',m.display_name,'role',m.role,'status',m.status,'confirmed',u.email_confirmed_at is not null,'platform_admin',exists(select 1 from maps_private.platform_admins p where p.user_id=u.id),'projects',coalesce((select jsonb_agg(a.map_id) from public.project_members a join public.maps p on p.id=a.map_id where a.user_id=m.user_id and p.workspace_id=w),'[]'::jsonb)) order by u.email) from public.workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=w),'[]'::jsonb),'projects',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'owner_id',owner_id,'last_synced_at',last_synced_at) order by name) from public.maps where workspace_id=w),'[]'::jsonb),'invitations',coalesce((select jsonb_agg(to_jsonb(i)-'attempt_id' order by created_at desc) from public.workspace_invitations i where workspace_id=w),'[]'::jsonb),'events',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc) from (select id,action,detail,created_at,actor_id from public.workspace_events where workspace_id=w order by created_at desc limit 100) e),'[]'::jsonb));
end $$;
create function maps_private.ws_mutate(w uuid,action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;role_value text;status_value text;ids uuid[];oldrole text;result jsonb:='{}';i public.workspace_invitations;begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(76283942);
 if action='create' then
  if not maps_private.ws_platform() then raise exception 'Platform admin required' using errcode='42501';end if;
  insert into public.workspaces(name) values(trim(p->>'name')) returning id into w;
  insert into public.workspace_members(workspace_id,user_id,role,display_name) select w,id,'owner',coalesce(raw_user_meta_data->>'full_name','') from auth.users where id=auth.uid();
  result:=jsonb_build_object('id',w);
 elsif action='accept' then
  select * into i from public.workspace_invitations where id=(p->>'id')::uuid for update;
  if not found or i.status<>'pending' or i.delivery<>'sent' or i.expires_at<=now() or not exists(select 1 from auth.users where id=auth.uid() and lower(email)=i.email and email_confirmed_at is not null and (banned_until is null or banned_until<=now())) or not exists(select 1 from public.workspaces where id=i.workspace_id and status='active') then raise exception 'Invitation is unavailable or belongs to another account' using errcode='42501';end if;
  w:=i.workspace_id;
  insert into public.workspace_members(workspace_id,user_id,role,display_name) values(w,auth.uid(),i.role,i.name) on conflict do nothing;
  if not found then raise exception 'This account is already a member; ask the workspace admin to review access';end if;
  insert into public.project_members(map_id,user_id) select id,auth.uid() from public.maps where workspace_id=w and id=any(i.projects) on conflict do nothing;
  update public.workspace_invitations set status='accepted',accepted_by=auth.uid() where id=i.id;result:=jsonb_build_object('id',w);
 else
  if not maps_private.ws_manage(w) then raise exception 'Workspace admin access required' using errcode='42501';end if;
  if action='rename' then update public.workspaces set name=trim(p->>'name') where id=w;
  elsif action='status' then
   if not maps_private.ws_platform() then raise exception 'Platform admin required' using errcode='42501';end if;
   update public.workspaces set status=p->>'status' where id=w;
  elsif action in ('member','remove_member') then
   target:=(p->>'user_id')::uuid;
   select role into oldrole from public.workspace_members where workspace_id=w and user_id=target for update;
   if not found then raise exception 'Member not found';end if;
   if target=auth.uid() or exists(select 1 from maps_private.platform_admins where user_id=target) then raise exception 'This protected account cannot be changed here' using errcode='42501';end if;
   role_value:=p->>'role';status_value:=p->>'status';
   if (oldrole='owner' or role_value='owner') and maps_private.ws_role(w)<>'owner' then raise exception 'Only owners can manage owners' using errcode='42501';end if;
   if oldrole='owner' and not exists(select 1 from public.workspace_members where workspace_id=w and user_id<>target and role='owner' and status='active') then raise exception 'Keep at least one active owner';end if;
   if length(coalesce(p->>'name',''))>160 then raise exception 'Name is too long';end if;
   if action='remove_member' then delete from public.workspace_members where workspace_id=w and user_id=target;
   else
    ids:=array(select jsonb_array_elements_text(coalesce(p->'projects','[]'))::uuid);
    if exists(select 1 from unnest(ids) x where not exists(select 1 from public.maps where id=x and workspace_id=w)) then raise exception 'Project belongs to another workspace' using errcode='42501';end if;
    update public.workspace_members set role=role_value,status=status_value,display_name=trim(coalesce(p->>'name','')) where workspace_id=w and user_id=target;
   end if;
   delete from public.project_members where user_id=target and map_id in(select id from public.maps where workspace_id=w);
   if action='member' and role_value in ('editor','operator') then insert into public.project_members(map_id,user_id) select distinct unnest(ids),target;end if;
  elsif action='project_access' then
   target:=(p->>'project_id')::uuid;
   if not exists(select 1 from public.maps where id=target and workspace_id=w) then raise exception 'Project not found' using errcode='42501';end if;
   ids:=array(select jsonb_array_elements_text(coalesce(p->'users','[]'))::uuid);
   if exists(select 1 from unnest(ids) x where not exists(select 1 from public.workspace_members where workspace_id=w and user_id=x and status='active' and role in ('editor','operator'))) then raise exception 'Choose active workspace editors or operators' using errcode='42501';end if;
   delete from public.project_members where map_id=target;insert into public.project_members(map_id,user_id) select target,unnest(ids) on conflict do nothing;
  elsif action='invite' then
   role_value:=p->>'role';if role_value='owner' and maps_private.ws_role(w)<>'owner' then raise exception 'Only owners can invite owners' using errcode='42501';end if;
   if length(p->>'email')>254 or coalesce(p->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(coalesce(p->>'name',''))>160 then raise exception 'Enter a valid name and email';end if;
   if exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=w and lower(u.email)=lower(trim(p->>'email'))) then raise exception 'Already a member. Edit their access under People.';end if;
   ids:=array(select jsonb_array_elements_text(coalesce(p->'projects','[]'))::uuid);
   if exists(select 1 from unnest(ids) x where not exists(select 1 from public.maps where id=x and workspace_id=w)) then raise exception 'Project belongs to another workspace' using errcode='42501';end if;
   insert into public.workspace_invitations(workspace_id,email,name,role,projects,created_by) values(w,lower(trim(p->>'email')),trim(coalesce(p->>'name','')),role_value,ids,auth.uid()) returning id into target;result:=jsonb_build_object('id',target);
  elsif action='revoke' then
   update public.workspace_invitations set status='revoked' where id=(p->>'id')::uuid and workspace_id=w and status='pending';if not found then raise exception 'Pending invitation not found';end if;
  else raise exception 'Unknown action';end if;
 end if;
 insert into public.workspace_events(workspace_id,actor_id,action,detail) values(w,auth.uid(),action,jsonb_strip_nulls(jsonb_build_object('user_id',target,'role',role_value,'status',status_value,'name',p->>'name','invitation_id',p->>'id')));
 return result;
end $$;

create function maps_private.ws_dispatch(id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ declare i public.workspace_invitations;attempt uuid:=gen_random_uuid();begin
 select * into i from public.workspace_invitations where workspace_invitations.id=ws_dispatch.id for update;
 if not found or not maps_private.ws_manage(i.workspace_id) then raise exception 'Workspace admin access required' using errcode='42501';end if;
 if i.role='owner' and maps_private.ws_role(i.workspace_id)<>'owner' then raise exception 'Only owners can send owner invitations' using errcode='42501';end if;
 if i.status<>'pending' then raise exception 'Invitation is no longer pending';end if;
 if i.attempt_at>now()-interval '60 seconds' then raise exception 'Wait one minute before resending';end if;
 update public.workspace_invitations set attempt_at=now(),attempt_id=attempt,delivery='sending',expires_at=now()+interval '7 days' where workspace_invitations.id=i.id;
 return jsonb_build_object('email',i.email,'name',i.name,'attempt',attempt,'existing',exists(select 1 from auth.users where lower(email)=i.email and email_confirmed_at is not null));
end $$;
create function maps_private.ws_delivery(id uuid,attempt uuid,ok boolean) returns void language plpgsql security definer set search_path='' as $$ begin
 update public.workspace_invitations set delivery=case when ok then 'sent' else 'failed' end,last_sent_at=case when ok then now() else last_sent_at end where workspace_invitations.id=ws_delivery.id and attempt_id=attempt and status='pending';
end $$;
-- Explicit invoker API wrappers keep privileged code outside the exposed schema.
create function public.workspace_context() returns jsonb language sql security invoker set search_path='' as $$ select maps_private.ws_context(); $$;
create function public.workspace_settings(p_workspace uuid) returns jsonb language sql security invoker set search_path='' as $$ select maps_private.ws_settings(p_workspace); $$;
create function public.workspace_mutate(p_workspace uuid,p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select maps_private.ws_mutate(p_workspace,p_action,p_payload); $$;
create function public.workspace_invitation_dispatch(p_invitation uuid) returns jsonb language sql security invoker set search_path='' as $$ select maps_private.ws_dispatch(p_invitation); $$;
create function public.workspace_invitation_delivery(p_invitation uuid,p_attempt uuid,p_ok boolean) returns void language sql security invoker set search_path='' as $$ select maps_private.ws_delivery(p_invitation,p_attempt,p_ok); $$;
-- Grants are explicit: members cannot directly alter memberships, invites, companies or audit rows.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='maps_private' and p.proname like 'ws_%') or (n.nspname='public' and p.proname like 'workspace_%') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.signature::text not like '%ws_delivery(%' and f.signature::text not like '%workspace_invitation_delivery(%' and f.signature::text not like '%ws_guard(%' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
grant usage on schema maps_private to service_role;
grant execute on function maps_private.ws_delivery(uuid,uuid,boolean),public.workspace_invitation_delivery(uuid,uuid,boolean) to service_role;
-- Include the workspace ID in published project listings without exposing draft maps.
create function maps_private.ws_published() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(project||jsonb_build_object('workspace_id',workspace_id,'release_id',id,'published_version',version,'last_synced_at',published_at) order by project->>'name'),'[]'::jsonb) from (select distinct on(r.map_id) r.id,r.version,r.published_at,r.manifest->'project' project,m.workspace_id from public.map_releases r join public.maps m on m.id=r.map_id where auth.uid() is not null and maps_private.ws_project(r.map_id,true) order by r.map_id,r.version desc) q;
$$;
revoke all on function maps_private.ws_published() from public,anon;grant execute on function maps_private.ws_published() to authenticated;
create or replace function public.maps_published_projects() returns jsonb language sql stable security invoker set search_path='' as $$ select maps_private.ws_published(); $$;

-- Indexed file ownership checks avoid scanning every project attachment on downloads.
create index layers_raster_path on public.layers(raster_path) where raster_path is not null;
create index layers_original_paths on public.layers using gin(original_paths);
create index release_raster_paths on public.map_releases using gin(raster_paths);
create index workspace_invitation_recipient on public.workspace_invitations(email) where status='pending';
