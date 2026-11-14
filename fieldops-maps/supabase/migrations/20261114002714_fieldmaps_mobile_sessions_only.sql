-- Device scope is a login UX policy, not a replacement for account/RLS permissions.
-- Freeze the Auth-recorded client classification at sign-in; token refresh cannot
-- turn an evicted mobile session into an unrestricted desktop session.
create function maps_private.fieldmaps_mobile_agent(agent text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(agent,'') ~* '(android|iphone|ipad|ipod|mobile|^FieldMaps(%20| )By(%20| )DrillOps/|^FieldCamTracker/|^DrillOps/)';
$$;
revoke all on function maps_private.fieldmaps_mobile_agent(text) from public,anon,authenticated;
create table maps_private.fieldmaps_session_devices (
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 is_mobile boolean not null
);
alter table maps_private.fieldmaps_session_devices enable row level security;
revoke all on maps_private.fieldmaps_session_devices from public,anon,authenticated;
insert into maps_private.fieldmaps_session_devices(session_id,is_mobile)
 select id,maps_private.fieldmaps_mobile_agent(user_agent) from auth.sessions;

create or replace function maps_private.record_fieldmaps_session() returns trigger
language plpgsql security definer set search_path='' as $$
declare mobile boolean:=maps_private.fieldmaps_mobile_agent(new.user_agent);
begin
 insert into maps_private.fieldmaps_session_devices(session_id,is_mobile) values(new.id,mobile);
 if mobile then
  insert into maps_private.fieldmaps_active_sessions(user_id,session_id,signed_in_at)
  values(new.user_id,new.id,coalesce(new.created_at,clock_timestamp()))
  on conflict(user_id) do update set session_id=excluded.session_id,signed_in_at=excluded.signed_in_at
  where excluded.signed_in_at>=fieldmaps_active_sessions.signed_in_at;
 end if;
 return new;
end $$;

-- Remove desktop winners, but preserve tombstones for already-ended logins:
-- ending a winning mobile login must never reactivate an older one.
delete from maps_private.fieldmaps_active_sessions a
 using maps_private.fieldmaps_session_devices d where d.session_id=a.session_id and not d.is_mobile;
insert into maps_private.fieldmaps_active_sessions(user_id,session_id,signed_in_at)
 select distinct on(s.user_id) s.user_id,s.id,coalesce(s.created_at,'epoch'::timestamptz)
 from auth.sessions s join maps_private.fieldmaps_session_devices d on d.session_id=s.id
 where d.is_mobile order by s.user_id,s.created_at desc nulls last,s.id desc
 on conflict(user_id) do update set session_id=excluded.session_id,signed_in_at=excluded.signed_in_at
 where excluded.signed_in_at>=fieldmaps_active_sessions.signed_in_at;

create or replace function maps_private.fieldmaps_session_current() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from auth.sessions s
  join maps_private.fieldmaps_session_devices d on d.session_id=s.id
  where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
  and (s.not_after is null or s.not_after>now())
  and (not d.is_mobile or exists(
   select 1 from maps_private.fieldmaps_active_sessions a
   where a.user_id=s.user_id and a.session_id=s.id)));
$$;
