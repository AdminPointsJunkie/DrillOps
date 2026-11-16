-- Public operator signup has a server-controlled destination. No client-supplied
-- workspace or role is accepted. Existing accounts and memberships are untouched.
create table maps_private.operator_signup_destination (
 route text primary key check (route='operator'),
 workspace_id uuid not null references public.workspaces(id) on delete restrict
);
alter table maps_private.operator_signup_destination enable row level security;
revoke all on maps_private.operator_signup_destination from public,anon,authenticated;
do $$
declare destination uuid;
begin
 if (select count(*) from public.workspaces where name='Argo NR' and status='active')<>1 then
  raise exception 'Expected exactly one active Argo NR project';
 end if;
 select id into destination from public.workspaces where name='Argo NR' and status='active';
 insert into maps_private.operator_signup_destination values('operator',destination);
end $$;

create or replace function maps_private.mark_field_operator() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.raw_user_meta_data->>'fieldmaps_signup'='operator' then
  new.raw_app_meta_data=coalesce(new.raw_app_meta_data,'{}'::jsonb)||
   jsonb_build_object('fieldmaps_account_type','operator','fieldmaps_app_only',true);
 end if;
 return new;
end $$;

create function maps_private.join_operator_signup_project() returns trigger
language plpgsql security definer set search_path='' as $$
declare destination uuid;
begin
 if new.raw_app_meta_data->>'fieldmaps_app_only'='true'
    and new.raw_app_meta_data->>'fieldmaps_account_type'='operator' then
  select d.workspace_id into destination from maps_private.operator_signup_destination d
   join public.workspaces w on w.id=d.workspace_id where d.route='operator' and w.status='active';
  if destination is null then raise exception 'Operator signup is temporarily unavailable';end if;
  insert into public.workspace_members(workspace_id,user_id,role,status,display_name)
   values(destination,new.id,'operator','active',trim(new.raw_user_meta_data->>'full_name'));
  -- Do not inherit any broader suite entitlement supplied by another signup flow.
  update maps_private.drillops_access set apps=array['fieldmaps']::text[] where user_id=new.id;
 end if;
 return new;
end $$;
revoke all on function maps_private.join_operator_signup_project() from public,anon,authenticated;
-- Runs after consent validation and the existing access/profile provisioning triggers.
create trigger zz_join_operator_signup_project after insert on auth.users
 for each row execute function maps_private.join_operator_signup_project();

-- Freeze native-app classification on the Auth session, just like the existing
-- mobile-session policy. A mobile browser is not the native FieldMaps app.
create function maps_private.fieldmaps_native_agent(agent text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(agent,'') ~* '^(FieldMaps(%20| )By(%20| )DrillOps|DrillOps)/[0-9]';
$$;
revoke all on function maps_private.fieldmaps_native_agent(text) from public,anon,authenticated;
alter table maps_private.fieldmaps_session_devices add column is_fieldmaps_native boolean not null default false;
update maps_private.fieldmaps_session_devices d set is_fieldmaps_native=maps_private.fieldmaps_native_agent(s.user_agent)
 from auth.sessions s where s.id=d.session_id;
create or replace function maps_private.record_fieldmaps_session() returns trigger
language plpgsql security definer set search_path='' as $$
declare mobile boolean:=maps_private.fieldmaps_mobile_agent(new.user_agent);
 native_app boolean:=maps_private.fieldmaps_native_agent(new.user_agent);
 app_only boolean;
begin
 select coalesce(raw_app_meta_data->>'fieldmaps_app_only'='true',false) into app_only from auth.users where id=new.user_id;
 insert into maps_private.fieldmaps_session_devices(session_id,is_mobile,is_fieldmaps_native) values(new.id,mobile,native_app);
 if mobile and (not app_only or native_app) then
  insert into maps_private.fieldmaps_active_sessions(user_id,session_id,signed_in_at)
  values(new.user_id,new.id,coalesce(new.created_at,clock_timestamp()))
  on conflict(user_id) do update set session_id=excluded.session_id,signed_in_at=excluded.signed_in_at
  where excluded.signed_in_at>=fieldmaps_active_sessions.signed_in_at;
 end if;
 return new;
end $$;
create or replace function maps_private.fieldmaps_session_current() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from auth.sessions s
  join maps_private.fieldmaps_session_devices d on d.session_id=s.id
  join auth.users u on u.id=s.user_id
  where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
  and (s.not_after is null or s.not_after>now())
  and (coalesce(u.raw_app_meta_data->>'fieldmaps_app_only','false')<>'true'
       or (d.is_fieldmaps_native and u.email_confirmed_at is not null))
  and (not d.is_mobile or exists(
   select 1 from maps_private.fieldmaps_active_sessions a
   where a.user_id=s.user_id and a.session_id=s.id)));
$$;
